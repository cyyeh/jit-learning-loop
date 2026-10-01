// Tests for skills/jit-learning-loop/scripts/installed.mjs.
// Run with: node --test scripts/installed.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "skills/jit-learning-loop/scripts/installed.mjs");
const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "installed-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const hasPython = spawnSync("python3", ["-c", "import importlib.metadata as m; m.version('pip')"]).status === 0;

test("node: reads the installed package, including scoped ones, from a parent directory", () => {
  const dir = project({
    "node_modules/express/package.json": '{"name":"express","version":"4.19.2"}',
    "node_modules/@scope/kit/package.json": '{"name":"@scope/kit","version":"1.0.0"}',
    "src/app/index.js": "",
  });
  const r = run(["express", "--in", join(dir, "src/app"), "--lang", "node"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^node: express 4\.19\.2 installed \(via node_modules\)\n  source: .*node_modules\/express$/m);
  assert.match(run(["@scope/kit", "--in", dir, "--lang", "node"]).stdout, /@scope\/kit 1\.0\.0 installed/);
});

test("node: falls back to package-lock.json when nothing is installed", () => {
  const dir = project({ "package-lock.json": JSON.stringify({ packages: { "node_modules/redis": { version: "4.6.13" } } }) });
  assert.match(run(["redis", "--in", dir, "--lang", "node"]).stdout, /node: redis 4\.6\.13 declared in .*package-lock\.json, but its code isn't on disk/);
});

test("python: finds an installed distribution and its source folder", { skip: !hasPython }, () => {
  const r = run(["pip", "--lang", "python"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^python: pip \S+ installed \(via python3\)\n  source: .*pip$/m);
});

test("python: falls back to a requirements pin, matching - and _ alike", { skip: !hasPython }, () => {
  const dir = project({ "requirements.txt": "fastapi==0.110.0\nnot_a_real_pkg_xyz[extra]==1.2.3  # pinned\n" });
  const r = run(["not-a-real-pkg-xyz", "--in", dir, "--lang", "python"]);
  assert.match(r.stdout, /python: not-a-real-pkg-xyz 1\.2\.3 declared in .*requirements\.txt/);
});

test("go: reads go.mod and finds the module in the cache, escaping capitals", () => {
  const cache = project({ "github.com/!burnt!sushi/toml@v1.3.2/decode.go": "" });
  const dir = project({
    "go.mod": "module example.com/app\n\ngo 1.22\n\nrequire (\n\tgithub.com/BurntSushi/toml v1.3.2\n\tgithub.com/redis/go-redis/v9 v9.5.1 // indirect\n)\n\nreplace github.com/x/y v1.0.0 => ../y\n",
  });
  const r = run(["toml", "--in", dir, "--lang", "go"], { GOMODCACHE: cache });
  assert.match(r.stdout, /^go: github\.com\/BurntSushi\/toml v1\.3\.2 installed \(via .*go\.mod\)\n  source: .*!burnt!sushi\/toml@v1\.3\.2$/m);
  assert.match(run(["github.com/redis/go-redis/v9", "--in", dir, "--lang", "go"], { GOMODCACHE: cache }).stdout, /v9\.5\.1 declared in .*go\.mod/);
  assert.match(run(["github.com/x/y", "--in", dir, "--lang", "go"], { GOMODCACHE: cache }).stdout, /not found/, "replace lines aren't requirements");
});

test("rust: reads Cargo.lock and finds the crate in the registry", () => {
  const cargo = project({ "registry/src/index.crates.io-6f17d22bba15001f/serde-1.0.197/Cargo.toml": "" });
  const dir = project({ "Cargo.lock": '[[package]]\nname = "serde"\nversion = "1.0.197"\n\n[[package]]\nname = "tokio"\nversion = "1.36.0"\n' });
  assert.match(run(["serde", "--in", dir, "--lang", "rust"], { CARGO_HOME: cargo }).stdout, /rust: serde 1\.0\.197 installed .*\n  source: .*serde-1\.0\.197$/m);
  assert.match(run(["tokio", "--in", dir, "--lang", "rust"], { CARGO_HOME: cargo }).stdout, /rust: tokio 1\.36\.0 declared in .*Cargo\.lock/);
});

test("not found says to ask or check the lockfile, and bad usage fails", () => {
  const dir = project({ "README.md": "" });
  const r = run(["nothing-here", "--in", dir, "--lang", "node"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /not found in node .*Ask which version they run, or check their lockfile/);
  assert.equal(run([]).status, 1);
  assert.equal(run(["a", "b"]).status, 1);
  assert.equal(run(["a", "--lang", "cobol"]).status, 1);
  assert.equal(run(["a", "--in", join(dir, "missing")]).status, 1);
  assert.match(run(["--help"]).stdout, /^usage:/);
});
