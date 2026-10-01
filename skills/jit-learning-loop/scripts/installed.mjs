#!/usr/bin/env node
// Finds the version of a library the user's project actually has, and where
// its source lives, so an API answer comes from that version's docs or code
// rather than from memory (the API row of step 1 in SKILL.md).
// Zero dependencies; Node 18+.
//
//   node installed.mjs PACKAGE [--in DIR] [--lang node|python|go|rust]
//
// Looks in DIR (default: the current directory) and its parents:
//   node    node_modules/PACKAGE, else package-lock.json
//   python  the project's .venv / venv interpreter, else python3 / python;
//           else a pin in requirements*.txt
//   go      go.mod, plus the module cache if it's downloaded
//   rust    Cargo.lock, plus ~/.cargo/registry/src if it's downloaded
// Prints one block per ecosystem where PACKAGE turns up. "Installed" means the
// code is on disk; "declared" means only a lockfile or pin names the version.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const USAGE = "usage: installed.mjs PACKAGE [--in DIR] [--lang node|python|go|rust]";
const LANGS = ["node", "python", "go", "rust"];

function parseArgs(argv) {
  const opts = { dir: process.cwd(), langs: LANGS };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--in" || arg === "--lang") {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      const value = argv[++i];
      if (arg === "--in") opts.dir = resolve(value);
      else if (LANGS.includes(value)) opts.langs = [value];
      else throw new Error(`--lang must be one of ${LANGS.join(", ")}`);
    } else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else rest.push(arg);
  }
  if (rest.length !== 1) throw new Error("give exactly one package name");
  if (!existsSync(opts.dir) || !statSync(opts.dir).isDirectory()) throw new Error(`no such directory: ${opts.dir}`);
  return { pkg: rest[0], ...opts };
}

// DIR, then each parent up to the filesystem root.
function* upward(dir) {
  for (let d = dir; ; d = dirname(d)) {
    yield d;
    if (dirname(d) === d) return;
  }
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

function findNode(pkg, dir) {
  for (const d of upward(dir)) {
    const manifest = join(d, "node_modules", ...pkg.split("/"), "package.json");
    const json = existsSync(manifest) && readJson(manifest);
    if (json?.version) return { status: "installed", version: json.version, source: dirname(manifest), via: "node_modules" };
  }
  for (const d of upward(dir)) {
    const lock = readJson(join(d, "package-lock.json"));
    const version = lock?.packages?.[`node_modules/${pkg}`]?.version ?? lock?.dependencies?.[pkg]?.version;
    if (version) return { status: "declared", version, via: join(d, "package-lock.json") };
  }
  return null;
}

function pythonCandidates(dir) {
  const found = [];
  for (const d of upward(dir)) {
    for (const venv of [".venv", "venv", "env"]) {
      for (const bin of ["bin/python", "Scripts/python.exe"]) {
        const path = join(d, venv, bin);
        if (existsSync(path)) found.push(path);
      }
    }
  }
  return [...found, "python3", "python"];
}

// Accepts a distribution name ("kafka-python") or an import name ("kafka").
const PY_PROBE = `
import json, sys, importlib.metadata as m, importlib.util as u
name = sys.argv[1]
try:
    dist = m.distribution(name)
except m.PackageNotFoundError:
    dists = getattr(m, "packages_distributions", lambda: {})().get(name, [])
    dist = m.distribution(dists[0]) if dists else None
if dist is None:
    print("null"); sys.exit()
top = (dist.read_text("top_level.txt") or "").split()
if not top:
    top = sorted({str(f).split("/")[0] for f in (dist.files or []) if str(f).endswith(".py") and "/" in str(f)})
mod = top[0] if top else name.replace("-", "_")
spec = u.find_spec(mod)
src = spec.origin if spec and spec.origin else str(dist.locate_file(""))
if src.endswith("__init__.py"):
    src = src[: -len("__init__.py") - 1]
print(json.dumps({"version": dist.version, "source": src}))
`;

function findPython(pkg, dir) {
  for (const python of pythonCandidates(dir)) {
    const r = spawnSync(python, ["-c", PY_PROBE, pkg], { encoding: "utf8", cwd: dir });
    if (r.error || r.status !== 0) continue;
    const info = safeParse(r.stdout);
    if (info) return { status: "installed", ...info, via: python };
    if (python.includes("/") || python.includes("\\")) break; // the project's own env decides
  }
  const name = pkg.toLowerCase().replace(/[-_.]+/g, "[-_.]");
  for (const d of upward(dir)) {
    let files = [];
    try {
      files = readdirSync(d).filter((f) => /^requirements.*\.txt$/.test(f));
    } catch {}
    for (const f of files) {
      const pin = readFileSync(join(d, f), "utf8").match(new RegExp(`^\\s*${name}\\s*(?:\\[[^\\]]*\\])?\\s*==\\s*([^\\s;#]+)`, "im"));
      if (pin) return { status: "declared", version: pin[1], via: join(d, f) };
    }
  }
  return null;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function goModCache() {
  if (process.env.GOMODCACHE) return process.env.GOMODCACHE;
  const r = spawnSync("go", ["env", "GOMODCACHE"], { encoding: "utf8" });
  if (!r.error && r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return join(process.env.GOPATH || join(homedir(), "go"), "pkg", "mod");
}

function findGo(pkg, dir) {
  for (const d of upward(dir)) {
    const mod = join(d, "go.mod");
    if (!existsSync(mod)) continue;
    // Require lines, single or in a block; replace directives (=>) don't count.
    const requires = readFileSync(mod, "utf8")
      .split("\n")
      .filter((line) => !line.includes("=>"))
      .map((line) => line.match(/^\s*(?:require\s+)?([^\s()]+)\s+(v\S+)/))
      .filter(Boolean);
    const hit = requires.find(([, path]) => path === pkg) ?? requires.find(([, path]) => path.endsWith(`/${pkg}`));
    if (!hit) return null;
    const [, path, version] = hit;
    // The module cache escapes upper-case letters as "!" + lower-case.
    const source = join(goModCache(), `${path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`)}@${version}`);
    return existsSync(source) ? { status: "installed", version, source, via: mod, module: path } : { status: "declared", version, via: mod, module: path };
  }
  return null;
}

function findRust(pkg, dir) {
  for (const d of upward(dir)) {
    const lock = join(d, "Cargo.lock");
    if (!existsSync(lock)) continue;
    const block = readFileSync(lock, "utf8")
      .split(/^\[\[package\]\]/m)
      .find((b) => new RegExp(`^name = "${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"$`, "m").test(b));
    const version = block?.match(/^version = "([^"]+)"$/m)?.[1];
    if (!version) return null;
    const registry = join(process.env.CARGO_HOME || join(homedir(), ".cargo"), "registry", "src");
    let source;
    try {
      for (const index of readdirSync(registry)) {
        const candidate = join(registry, index, `${pkg}-${version}`);
        if (existsSync(candidate)) source = candidate;
      }
    } catch {}
    return source ? { status: "installed", version, source, via: lock } : { status: "declared", version, via: lock };
  }
  return null;
}

const FINDERS = { node: findNode, python: findPython, go: findGo, rust: findRust };

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`installed: ${err.message}\n${USAGE}`);
    process.exit(1);
  }
  if (opts.help) return console.log(USAGE);

  const results = opts.langs.map((lang) => [lang, FINDERS[lang](opts.pkg, opts.dir)]).filter(([, r]) => r);
  if (!results.length) {
    console.log(
      `${opts.pkg}: not found in ${opts.langs.join(", ")} under ${opts.dir}. Ask which version they run, or check their lockfile, before relying on docs from memory.`,
    );
    return;
  }
  for (const [lang, r] of results) {
    const name = r.module ?? opts.pkg;
    if (r.status === "installed") {
      console.log(`${lang}: ${name} ${r.version} installed (via ${r.via})\n  source: ${r.source}`);
    } else {
      console.log(`${lang}: ${name} ${r.version} declared in ${r.via}, but its code isn't on disk here; read that version's docs or tagged source.`);
    }
  }
}

main();
