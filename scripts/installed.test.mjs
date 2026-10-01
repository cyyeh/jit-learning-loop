// Tests for skills/jit-learning-loop/scripts/installed.mjs.
// Run with: node --test scripts/installed.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "skills/jit-learning-loop/scripts/installed.mjs");
const cleanEnv = { ...process.env, VIRTUAL_ENV: "", CONDA_PREFIX: "" };
delete cleanEnv.VIRTUAL_ENV;
delete cleanEnv.CONDA_PREFIX;
const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...cleanEnv, ...env } });

// A throwaway project. The .git folder bounds the upward search, like a real repo.
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "installed-"));
  mkdirSync(join(dir, ".git"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const hasPython = spawnSync("python3", ["-c", "import importlib.metadata"]).status === 0;
const isWindows = process.platform === "win32";

// A fake installed distribution on PYTHONPATH: dist "fake-dist" ships the
// modules "fakemod" and "_fake_helper".
function fakeSitePackages() {
  return project({
    "site/fake_dist-1.2.3.dist-info/METADATA": "Metadata-Version: 2.1\nName: fake-dist\nVersion: 1.2.3\n",
    "site/fake_dist-1.2.3.dist-info/top_level.txt": "_fake_helper\nfakemod\n",
    "site/fake_dist-1.2.3.dist-info/RECORD": "fakemod/__init__.py,,\n_fake_helper/__init__.py,,\n",
    "site/fakemod/__init__.py": "raise SystemExit('fakemod must never be imported')\n",
    "site/_fake_helper/__init__.py": "",
  });
}

test("node: installed package (scoped too) from a parent folder, else package-lock", () => {
  const dir = project({
    "node_modules/express/package.json": '{"name":"express","version":"4.19.2"}',
    "node_modules/@scope/kit/package.json": '{"name":"@scope/kit","version":"1.0.0"}',
    "packages/app/index.js": "",
  });
  const r = run(["express", "--in", join(dir, "packages/app"), "--lang", "node"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^node: express 4\.19\.2 installed \(via node_modules\)\n  source: .*node_modules[\\/]express$/m);
  assert.match(run(["@scope/kit", "--in", dir, "--lang", "node"]).stdout, /@scope\/kit 1\.0\.0 installed/);

  const locked = project({ "package-lock.json": JSON.stringify({ packages: { "node_modules/redis": { version: "4.6.13" } } }) });
  assert.match(run(["redis", "--in", locked, "--lang", "node"]).stdout, /node: redis 4\.6\.13 declared in .*package-lock\.json/);
});

test("python: finds a distribution by its name or its import name, and points at the right module", { skip: !hasPython }, () => {
  const site = join(fakeSitePackages(), "site");
  const dir = project({ "pyproject.toml": "" });
  for (const query of ["fake-dist", "fake_dist", "fakemod"]) {
    const r = run([query, "--in", dir], { PYTHONPATH: site });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^python: fake-dist 1\.2\.3 installed \(via system python3, no project virtualenv found\)\n  source: .*[\\/]fakemod$/m, query);
  }
});

test("python: never runs project files or writes bytecode into the project", { skip: !hasPython }, () => {
  const site = join(fakeSitePackages(), "site");
  const dir = project({
    "requirements.txt": "",
    "json.py": "open('RAN-json', 'w').close()\n",
    "email/__init__.py": "open('RAN-email', 'w').close()\n",
  });
  const r = run(["fake-dist", "--in", dir], { PYTHONPATH: site });
  assert.match(r.stdout, /fake-dist 1\.2\.3 installed/);
  const left = readdirSync(dir);
  assert.ok(!left.some((f) => f.startsWith("RAN-") || f === "__pycache__"), `project files ran or bytecode was written: ${left}`);
  assert.ok(!existsSync(join(tmpdir(), "RAN-json")));
});

test("python: reports a pin, and flags it when the installed version differs", { skip: !hasPython }, () => {
  const site = join(fakeSitePackages(), "site");
  const pinned = project({ "requirements/base.txt": "fake-dist[extra]===1.0.0 ; python_version > '3'\n" });
  const r = run(["fake-dist", "--in", pinned], { PYTHONPATH: site });
  assert.match(r.stdout, /fake-dist 1\.2\.3 installed .*\n.*\n  note: but .*base\.txt pins 1\.0\.0/);

  const notInstalled = project({ "requirements.txt": "not_a_real_pkg_xyz==2.0.2  # pinned\nc++==1\n" });
  assert.match(run(["not-a-real-pkg-xyz", "--in", notInstalled]).stdout, /python: not-a-real-pkg-xyz 2\.0\.2 declared in .*requirements\.txt/);
});

test("python: a broken project virtualenv is reported, never replaced by the system Python", { skip: !hasPython || isWindows }, () => {
  const failing = project({ ".venv/pyvenv.cfg": "home = /nowhere\n", ".venv/bin/python": "#!/bin/sh\nexit 3\n", "requirements.txt": "pip==1.0\n" });
  chmodSync(join(failing, ".venv/bin/python"), 0o755);
  const r = run(["pip", "--in", failing]);
  assert.match(r.stdout, /python: pip: project environment .*\.venv is broken: its Python couldn't run \(exited with 3\); not falling back/);
  assert.match(r.stdout, /python: pip 1\.0 declared in .*requirements\.txt/);
  assert.doesNotMatch(r.stdout, /via system python3/);

  const dangling = project({ ".venv/pyvenv.cfg": "home = /nowhere\n" });
  mkdirSync(join(dangling, ".venv/bin"));
  symlinkSync("/nonexistent/python3.9", join(dangling, ".venv/bin/python"));
  assert.match(run(["pip", "--in", dangling]).stdout, /project environment .*\.venv is broken/);
});

test("python: skipped outside Python projects unless asked for", () => {
  const dir = project({ "package.json": "{}" });
  const r = run(["pip", "--in", dir]);
  assert.match(r.stdout, /not found in node, go, rust .*--lang python checks the system Python/);
});

test("go: reads go.mod, honours replace, and matches short and import paths", () => {
  const cache = project({ "github.com/!burnt!sushi/toml@v1.3.2/decode.go": "", "github.com/myfork/toml@v1.4.0/decode.go": "" });
  const dir = project({
    "go.mod": [
      "module example.com/app",
      "go 1.99.0",
      "require github.com/jackc/pgx/v5 v5.5.1",
      "require (",
      "\tgithub.com/BurntSushi/toml v1.3.2",
      "\tgithub.com/redis/go-redis/v9 v9.5.1 // indirect",
      "\tgolang.org/x/net v0.20.0",
      ")",
      "exclude (",
      "\tgithub.com/bad/mod v0.1.0",
      ")",
      "replace github.com/redis/go-redis/v9 => ../go-redis",
      "",
    ].join("\n"),
  });
  // An empty PATH means no `go` binary, so the go.mod fallback is what's tested.
  const env = { GOMODCACHE: cache, PATH: "" };
  assert.match(run(["github.com/burntsushi/toml", "--in", dir, "--lang", "go"], env).stdout, /^go: github\.com\/BurntSushi\/toml v1\.3\.2 installed .*\n  source: .*!burnt!sushi[\\/]toml@v1\.3\.2$/m);
  assert.match(run(["pgx", "--in", dir, "--lang", "go"], env).stdout, /go: github\.com\/jackc\/pgx\/v5 v5\.5\.1 declared/);
  assert.match(run(["golang.org/x/net/http2", "--in", dir, "--lang", "go"], env).stdout, /go: golang\.org\/x\/net v0\.20\.0/);
  assert.match(run(["go-redis", "--in", dir, "--lang", "go"], env).stdout, /installed .*\n  source: .*go-redis\n  note: replaced by the local folder \.\.\/go-redis/);
  assert.match(run(["github.com/bad/mod", "--in", dir, "--lang", "go"], env).stdout, /not found/, "exclude isn't a requirement");

  writeFileSync(join(dir, "go.mod"), "module example.com/app\nrequire github.com/BurntSushi/toml v1.3.2\nreplace github.com/BurntSushi/toml => github.com/myfork/toml v1.4.0\n");
  assert.match(run(["toml", "--in", dir, "--lang", "go"], env).stdout, /v1\.4\.0 installed .*\n  source: .*myfork[\\/]toml@v1\.4\.0\n  note: replaced by github\.com\/myfork\/toml/);
});

test("go: asking Go never downloads a toolchain or rewrites go.mod", { skip: spawnSync("go", ["version"]).error !== undefined }, () => {
  const text = "module example.com/app\n\ngo 1.99.0\n\nrequire github.com/BurntSushi/toml v1.3.2\n";
  const dir = project({ "go.mod": text });
  const started = Date.now();
  const r = run(["toml", "--in", dir, "--lang", "go"], { GOMODCACHE: project({}) });
  assert.ok(Date.now() - started < 15000, "no toolchain download");
  assert.match(r.stdout, /go: github\.com\/BurntSushi\/toml v1\.3\.2 declared/);
  assert.equal(spawnSync("cat", [join(dir, "go.mod")], { encoding: "utf8" }).stdout, text);
});

test("rust: lists every locked version, says which is direct, and where each comes from", () => {
  const cargo = project({ "registry/src/index.crates.io-6f17d22bba15001f/syn-2.0.48/Cargo.toml": "" });
  const dir = project({
    "Cargo.lock": [
      "[[package]]", 'name = "app"', 'version = "0.1.0"', 'dependencies = [', ' "syn 2.0.48",', ' "tokio-util",', ' "local-crate",', "]", "",
      "[[package]]", 'name = "syn"', 'version = "1.0.109"', 'source = "registry+https://github.com/rust-lang/crates.io-index"', "",
      "[[package]]", 'name = "syn"', 'version = "2.0.48"', 'source = "registry+https://github.com/rust-lang/crates.io-index"', "",
      "[[package]]", 'name = "tokio-util"', 'version = "0.7.10"', 'source = "git+https://github.com/tokio-rs/tokio?rev=abc#abc123"', "",
      "[[package]]", 'name = "local-crate"', 'version = "0.2.0"', "",
    ].join("\n"),
  });
  const syn = run(["syn", "--in", dir, "--lang", "rust"], { CARGO_HOME: cargo }).stdout;
  assert.match(syn, /rust: syn 1\.0\.109 declared .*\n  note: pulled in by another crate/);
  assert.match(syn, /rust: syn 2\.0\.48 installed .*\n  source: .*syn-2\.0\.48\n  note: a direct dependency of this workspace/);
  assert.match(run(["tokio_util", "--in", dir, "--lang", "rust"], { CARGO_HOME: cargo }).stdout, /rust: tokio-util 0\.7\.10 declared .*\n  note: from git\+https:\/\/github\.com\/tokio-rs\/tokio\?rev=abc/);
  assert.match(run(["local-crate", "--in", dir, "--lang", "rust"], { CARGO_HOME: cargo }).stdout, /local-crate 0\.2\.0 installed .*\n  source: a local path crate/);
});

test("not found says to ask or check the lockfile; bad usage fails clearly", () => {
  const dir = project({ "README.md": "" });
  const r = run(["nothing-here", "--in", dir, "--lang", "node"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /not found in node .*Ask which version they run, or check their lockfile/);
  assert.equal(run([]).status, 1);
  assert.equal(run(["a", "b"]).status, 1);
  assert.equal(run(["a", "--lang", "cobol"]).status, 1);
  assert.match(run(["a", "--in", join(dir, "missing")]).stderr, /no such directory/);
  assert.match(run(["a", "--in", join(dir, "README.md")]).stderr, /not a directory/);
  assert.match(run(["a", "--in", ""]).stderr, /--in needs a directory/);
  assert.match(run(["--help"]).stdout, /^usage:/);
});
