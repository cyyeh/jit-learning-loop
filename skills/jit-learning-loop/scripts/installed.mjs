#!/usr/bin/env node
// Finds the version of a library the user's project actually has, and where
// its source lives, so an API answer comes from that version's docs or code
// rather than from memory (the API row of step 1 in SKILL.md).
// Zero dependencies; Node 18+.
//
//   node installed.mjs PACKAGE [--in DIR] [--lang node|python|go|rust]
//
// Searches DIR (default: the current directory) and its parents, stopping at
// the repository root (the first folder with .git) and never above $HOME:
//   node    node_modules/PACKAGE, else package-lock.json
//   python  the active or project virtualenv's interpreter, else the system
//           one (labelled as such), plus pins in requirements*.txt
//   go      `go list -m` when Go is installed (offline, no toolchain
//           download), else go.mod, including replace directives
//   rust    every Cargo.lock entry for the crate, with where its code lives
// Prints one block per ecosystem where PACKAGE turns up. "installed" means the
// code is on disk; "declared" means only a lockfile or pin names the version.
//
// It runs the project's Python interpreter (to read package metadata) and Go,
// if present. It never imports the package itself or runs project code.
import { readFileSync, existsSync, readdirSync, statSync, lstatSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const USAGE = "usage: installed.mjs PACKAGE [--in DIR] [--lang node|python|go|rust]";
const LANGS = ["node", "python", "go", "rust"];
const HOME = resolve(homedir());

class UsageError extends Error {}
const fail = (msg) => {
  throw new UsageError(msg);
};

function parseArgs(argv) {
  const opts = { dir: process.cwd(), langs: LANGS, explicit: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--in" || arg === "--lang") {
      if (i + 1 >= argv.length) fail(`${arg} needs a value`);
      const value = argv[++i];
      if (arg === "--in") {
        if (!value) fail("--in needs a directory");
        opts.dir = resolve(value);
        const hint = value.startsWith("~") ? ' (the shell only expands "~" when it is unquoted)' : "";
        if (!existsSync(opts.dir)) fail(`no such directory: ${opts.dir}${hint}`);
        if (!statSync(opts.dir).isDirectory()) fail(`not a directory: ${opts.dir}`);
      } else if (LANGS.includes(value)) {
        opts.langs = [value];
        opts.explicit = true;
      } else fail(`--lang must be one of ${LANGS.join(", ")}`);
    } else if (arg.startsWith("--")) fail(`unknown option ${arg}`);
    else rest.push(arg);
  }
  if (rest.length !== 1 || !rest[0]) fail("give exactly one package name");
  return { pkg: rest[0], ...opts };
}

// DIR and its parents, up to and including the repository root, never $HOME
// or above (so a stray ~/venv or /tmp/.venv can't stand in for the project's).
function* upward(dir) {
  for (let d = dir, first = true; ; d = dirname(d), first = false) {
    if (!first && (d === HOME || dirname(d) === d)) return;
    yield d;
    if (existsSync(join(d, ".git")) || dirname(d) === d) return;
  }
}

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const listDir = (d) => {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
};

// ---------- node ----------

function findNode(pkg, dir) {
  for (const d of upward(dir)) {
    const manifest = join(d, "node_modules", ...pkg.split("/"), "package.json");
    const json = existsSync(manifest) && readJson(manifest);
    if (json?.version) return [{ name: pkg, status: "installed", version: json.version, source: dirname(manifest), via: "node_modules" }];
  }
  for (const d of upward(dir)) {
    const lock = readJson(join(d, "package-lock.json"));
    const version = lock?.packages?.[`node_modules/${pkg}`]?.version ?? lock?.dependencies?.[pkg]?.version;
    if (version) return [{ name: pkg, status: "declared", version, via: join(d, "package-lock.json") }];
    for (const other of ["yarn.lock", "pnpm-lock.yaml"]) {
      const path = join(d, other);
      if (existsSync(path) && readFileSync(path, "utf8").includes(pkg)) {
        return [{ name: pkg, status: "named", via: path }];
      }
    }
  }
  return [];
}

// ---------- python ----------

const PY_MARKERS = ["pyproject.toml", "setup.py", "setup.cfg", "Pipfile", "requirements.txt", "requirements", ".venv", "venv"];
const looksLikePython = (dir) =>
  Boolean(process.env.VIRTUAL_ENV || process.env.CONDA_PREFIX) ||
  [...upward(dir)].some((d) => PY_MARKERS.some((m) => existsSync(join(d, m))) || listDir(d).some((f) => /^requirements.*\.txt$/.test(f)));

const venvPython = (prefix) =>
  ["bin/python", "Scripts/python.exe", "python.exe"].map((p) => join(prefix, p)).find((p) => {
    try {
      return lstatSync(p) && true;
    } catch {
      return false;
    }
  });

// The interpreter that runs the project: an active env, else a virtualenv in
// the project, else the system one. A project env that's broken is reported,
// not silently replaced by the system Python.
function pythonInterpreter(dir) {
  for (const [label, prefix] of [["VIRTUAL_ENV", process.env.VIRTUAL_ENV], ["CONDA_PREFIX", process.env.CONDA_PREFIX]]) {
    if (prefix) return { path: venvPython(prefix) ?? join(prefix, "bin/python"), label: `$${label} (${prefix})`, project: true };
  }
  for (const d of upward(dir)) {
    for (const name of [".venv", "venv", "env"]) {
      const prefix = join(d, name);
      if (!existsSync(join(prefix, "pyvenv.cfg"))) continue;
      return { path: venvPython(prefix) ?? join(prefix, "bin/python"), label: prefix, project: true };
    }
  }
  return { path: "python3", fallback: "python", label: "system python3, no project virtualenv found", project: false };
}

// Never imports the package: it reads distribution metadata and locates files.
// The project folder is dropped from sys.path first, so a project file named
// like a stdlib module (json.py, email/) can't run.
const PY_PROBE = String.raw`
import sys
sys.path[:] = [p for p in sys.path if p not in ("", ".")]
import json, os, re, importlib.metadata as m, importlib.util as u
q = re.sub(r"\[.*\]$", "", sys.argv[1])
norm = lambda s: re.sub(r"[-_.]+", "-", s).lower()
try:
    dist = m.distribution(q)
except m.PackageNotFoundError:
    dist = None
    if "." not in q:
        names = getattr(m, "packages_distributions", lambda: {})().get(q, [])
        dist = m.distribution(names[0]) if names else None
if dist is None:
    print("@@INSTALLED@@null")
    sys.exit()
name = dist.metadata["Name"]
files = [str(f) for f in (dist.files or [])]
top = (dist.read_text("top_level.txt") or "").split()
if not top:
    top = sorted({f.split("/")[0] for f in files if "/" in f and f.endswith(".py") and not f.split("/")[0].endswith((".dist-info", ".egg-info", ".data"))})
    top += sorted({f[:-3] for f in files if "/" not in f and f.endswith(".py")})
prefer = [t for t in top if norm(t) in (norm(q), norm(name))] or [t for t in top if not t.startswith("_")] or top
src = None
for t in prefer:
    for cand in (t, t + ".py"):
        p = str(dist.locate_file(cand))
        if os.path.exists(p):
            src = p
            break
    if src:
        break
if src is None and prefer and "." not in prefer[0]:
    spec = u.find_spec(prefer[0])
    if spec and spec.origin and spec.origin not in ("built-in", "frozen"):
        src = os.path.dirname(spec.origin) if spec.origin.endswith("__init__.py") else spec.origin
print("@@INSTALLED@@" + json.dumps({"name": name, "version": dist.version, "source": src or str(dist.locate_file(""))}))
`;

function probePython(python, pkg) {
  const r = spawnSync(python, ["-B", "-c", PY_PROBE, pkg], {
    encoding: "utf8",
    cwd: tmpdir(),
    timeout: 15000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (r.error) return { error: r.error.code === "ENOENT" ? "not found" : r.error.message };
  const line = r.stdout.split("\n").reverse().find((l) => l.startsWith("@@INSTALLED@@"));
  if (r.status !== 0 || !line) return { error: `exited with ${r.status ?? r.signal}${r.stderr ? `: ${r.stderr.trim().split("\n").pop()}` : ""}` };
  return { info: safeJson(line.slice("@@INSTALLED@@".length)) };
}

function pythonPins(pkg, dir) {
  const name = escapeRe(pkg.replace(/\[.*\]$/, "").toLowerCase()).replace(/(?:\\\.|[-_])+/g, "[-_.]+");
  const pins = [];
  for (const d of upward(dir)) {
    const files = [
      ...listDir(d).filter((f) => /^requirements.*\.txt$/.test(f)).map((f) => join(d, f)),
      ...listDir(join(d, "requirements")).filter((f) => f.endsWith(".txt")).map((f) => join(d, "requirements", f)),
    ];
    for (const file of files) {
      const re = new RegExp(`^\\s*${name}\\s*(?:\\[[^\\]]*\\])?\\s*===?\\s*([^\\s;#,]+)`, "im");
      const pin = readFileSync(file, "utf8").match(re);
      if (pin) pins.push({ version: pin[1], via: file });
    }
  }
  return pins;
}

function findPython(pkg, dir, explicit) {
  if (!explicit && !looksLikePython(dir)) return [];
  const pins = pythonPins(pkg, dir);
  const interp = pythonInterpreter(dir);
  let probe = probePython(interp.path, pkg);
  if (probe.error === "not found" && interp.fallback) probe = probePython(interp.fallback, pkg);
  const results = [];
  if (probe.error && interp.project) {
    results.push({ status: "broken", name: pkg, via: interp.label, note: `its Python couldn't run (${probe.error}); not falling back to the system Python` });
  } else if (probe.info) {
    const pinned = pins.find((p) => p.version !== probe.info.version);
    results.push({
      status: "installed",
      name: probe.info.name,
      version: probe.info.version,
      source: probe.info.source,
      via: interp.label,
      note: pinned ? `but ${pinned.via} pins ${pinned.version}: check which one their deployment runs` : undefined,
    });
  }
  if (!results.some((r) => r.status === "installed")) {
    for (const pin of pins) results.push({ status: "declared", name: pkg, version: pin.version, via: pin.via });
  }
  return results;
}

// ---------- go ----------

function goModule(pkg, mod) {
  const lines = readFileSync(mod, "utf8").split("\n");
  const requires = [];
  const replaces = new Map();
  let block = null;
  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    const open = line.match(/^(require|replace|exclude|retract)\s*\($/);
    if (open) {
      block = open[1];
      continue;
    }
    if (line === ")") {
      block = null;
      continue;
    }
    const single = line.match(/^(require|replace|exclude|retract)\s+(.*)$/);
    const kind = single ? single[1] : block;
    const body = single ? single[2] : line;
    if (kind === "require") {
      const m = body.match(/^(\S+)\s+(v\S+)/);
      if (m) requires.push({ path: m[1], version: m[2] });
    } else if (kind === "replace") {
      const m = body.match(/^(\S+)(?:\s+v\S+)?\s*=>\s*(\S+)(?:\s+(v\S+))?/);
      if (m) replaces.set(m[1], { path: m[2], version: m[3] });
    }
  }
  const q = pkg.toLowerCase();
  const short = (p) => p.toLowerCase().replace(/\/v\d+$/, "").split("/").pop();
  const match =
    requires.find((r) => r.path.toLowerCase() === q) ??
    requires.filter((r) => q.startsWith(`${r.path.toLowerCase()}/`)).sort((a, b) => b.path.length - a.path.length)[0] ??
    requires.find((r) => short(r.path) === q);
  return match && { ...match, replace: replaces.get(match.path) };
}

function findGo(pkg, dir) {
  for (const d of upward(dir)) {
    const mod = join(d, "go.mod");
    if (!existsSync(mod)) continue;
    const req = goModule(pkg, mod);
    if (!req) return [];
    // Ask Go itself (it knows replace, vendoring and workspaces), offline and
    // without letting it fetch a newer toolchain.
    const r = spawnSync("go", ["list", "-m", "-json", req.path], {
      encoding: "utf8",
      cwd: d,
      timeout: 15000,
      // GOFLAGS cleared: Go's default (-mod=readonly, or vendor) never rewrites go.mod.
      env: { ...process.env, GOTOOLCHAIN: "local", GOPROXY: "off", GOFLAGS: "" },
    });
    const info = !r.error && r.status === 0 ? safeJson(r.stdout) : null;
    if (info?.Path) {
      const rep = info.Replace;
      const target = rep ?? info;
      return [{
        name: info.Path,
        status: target.Dir ? "installed" : "declared",
        version: target.Version ?? info.Version ?? "(local)",
        source: target.Dir,
        via: "go list -m",
        note: rep ? `replaced by ${rep.Path}${rep.Version ? ` ${rep.Version}` : ""}: that's the code that builds` : undefined,
      }];
    }
    // No Go (or it couldn't answer offline): read go.mod.
    const rep = req.replace;
    if (rep?.path.startsWith(".") || rep?.path.startsWith("/")) {
      return [{ name: req.path, status: "installed", version: "(local)", source: resolve(d, rep.path), via: mod, note: `replaced by the local folder ${rep.path}: that's the code that builds` }];
    }
    const target = rep ? { path: rep.path, version: rep.version ?? req.version } : req;
    const cache = process.env.GOMODCACHE || join(process.env.GOPATH || join(HOME, "go"), "pkg", "mod");
    const source = join(cache, `${target.path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`)}@${target.version}`);
    return [{
      name: req.path,
      status: existsSync(source) ? "installed" : "declared",
      version: target.version,
      source: existsSync(source) ? source : undefined,
      via: mod,
      note: rep ? `replaced by ${rep.path} ${target.version}: that's the code that builds` : undefined,
    }];
  }
  return [];
}

// ---------- rust ----------

function findRust(pkg, dir) {
  for (const d of upward(dir)) {
    const lock = join(d, "Cargo.lock");
    if (!existsSync(lock)) continue;
    const norm = (s) => s.toLowerCase().replace(/_/g, "-");
    const packages = readFileSync(lock, "utf8")
      .replace(/\r\n/g, "\n")
      .split(/^\[\[package\]\]$/m)
      .slice(1)
      .map((block) => ({
        name: block.match(/^name = "([^"]+)"$/m)?.[1],
        version: block.match(/^version = "([^"]+)"$/m)?.[1],
        source: block.match(/^source = "([^"]+)"$/m)?.[1],
        deps: [...(block.match(/^dependencies = \[([\s\S]*?)\]$/m)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
      }));
    const hits = packages.filter((p) => p.name && norm(p.name) === norm(pkg));
    if (!hits.length) return [];
    // Direct dependencies of the workspace's own crates (the ones without a source).
    const direct = new Set(packages.filter((p) => !p.source).flatMap((p) => p.deps));
    const registry = join(process.env.CARGO_HOME || join(HOME, ".cargo"), "registry", "src");
    return hits.map((p) => {
      const isDirect = direct.has(p.name) || direct.has(`${p.name} ${p.version}`) || [...direct].some((dep) => dep.startsWith(`${p.name} ${p.version} `));
      const note = hits.length > 1 ? (isDirect ? "a direct dependency of this workspace" : "pulled in by another crate") : undefined;
      if (!p.source) return { name: p.name, status: "installed", version: p.version, source: "a local path crate in this workspace", via: lock, note };
      if (p.source.startsWith("git+")) return { name: p.name, status: "declared", version: p.version, via: lock, note: [`from ${p.source.replace(/#.*$/, "")}`, note].filter(Boolean).join("; ") };
      const source = listDir(registry).map((index) => join(registry, index, `${p.name}-${p.version}`)).find(existsSync);
      return { name: p.name, status: source ? "installed" : "declared", version: p.version, source, via: lock, note };
    });
  }
  return [];
}

// ---------- main ----------

function describe(lang, r) {
  const note = r.note ? `\n  note: ${r.note}` : "";
  if (r.status === "installed") return `${lang}: ${r.name} ${r.version} installed (via ${r.via})${r.source ? `\n  source: ${r.source}` : ""}${note}`;
  if (r.status === "declared") return `${lang}: ${r.name} ${r.version} declared in ${r.via}, but its code isn't on disk here; read that version's docs or tagged source.${note}`;
  if (r.status === "named") return `${lang}: ${r.name} is named in ${r.via}; read it for the version.`;
  return `${lang}: ${r.name}: project environment ${r.via} is broken: ${r.note}.`;
}

try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
  } else {
    const found = [];
    const checked = [];
    for (const lang of opts.langs) {
      if (lang === "python" && !opts.explicit && !looksLikePython(opts.dir)) continue;
      checked.push(lang);
      const results = { node: findNode, python: findPython, go: findGo, rust: findRust }[lang](opts.pkg, opts.dir, opts.explicit);
      for (const r of results) found.push(describe(lang, r));
    }
    const skipped = checked.includes("python") || !opts.langs.includes("python") ? "" : " (no Python project here; --lang python checks the system Python)";
    console.log(
      found.length
        ? found.join("\n")
        : `${opts.pkg}: not found in ${checked.join(", ")} under ${opts.dir}${skipped}. Ask which version they run, or check their lockfile, before relying on docs from memory.`,
    );
  }
} catch (err) {
  console.error(`installed: ${err.message}${err instanceof UsageError ? `\n${USAGE}` : ""}`);
  process.exit(1);
}
