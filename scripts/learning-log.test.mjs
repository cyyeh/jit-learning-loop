// Tests for skills/jit-learning-loop/scripts/learning-log.mjs.
// Run with: node --test scripts/learning-log.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync, chmodSync, statSync, lstatSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "skills/jit-learning-loop/scripts/learning-log.mjs");
const demo = (name) => join(root, "demo", name, "project");

const run = (args, input) => spawnSync(process.execPath, [script, ...args], { input: input ?? "", encoding: "utf8" });
const tempDir = () => mkdtempSync(join(tmpdir(), "learning-log-"));
const tempLog = () => join(tempDir(), "LEARNING_LOG.md");
const entryFile = (text) => {
  const path = join(tempDir(), "entry.md");
  writeFileSync(path, text);
  return path;
};
const add = (log, topic, date, entry) => run(["add", "--log", log, "--topic", topic, "--date", date, "--file", entryFile(entry)]);

const ENTRY = `Task: Stop double-charge when users double-click Pay
Unknown types: concept (race), API (\`SET NX PX\`)
Learned:
1. Check-then-act across concurrent requests is a race.
2. Release must check ownership, or you free someone
   else's lock. Run \`date +%Y\` won't execute here.
Next time: read about fencing tokens.
Level: 1, try 2
`;

test("list reads the level from every demo log, in English and Traditional Chinese", () => {
  const expected = {
    "double-charge/LEARNING_LOG.md": "2026-09-29 · Redis lock / check-then-act race · level 1, try 2 next",
    "double-charge/LEARNING_LOG.en.md": "2026-09-29 · Redis lock / check-then-act race · level 1, try 2 next",
    "add-login/LEARNING_LOG.md": "2026-09-30 · Backend auth：login 與 session · level 1, try 2 next",
    "add-login/LEARNING_LOG.en.md": "2026-09-30 · Backend auth: login and sessions · level 1, try 2 next",
  };
  for (const [file, line] of Object.entries(expected)) {
    const [name, log] = file.split("/");
    const r = run(["list", "--log", join(demo(name), log)]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), line, file);
  }
});

test("level parsing ignores ordinals and sentence-ending periods", () => {
  const log = tempLog();
  writeFileSync(
    log,
    [
      "# Log",
      "## 2026-01-04 · a\nLevel: 1.",
      "## 2026-01-03 · b\nLevel: 2nd encounter, still level 1",
      "## 2026-01-02 · c\nLevel: 3",
      "## 2026-01-01 · d\nLevel: soon",
    ].join("\n\n") + "\n",
  );
  assert.deepEqual(run(["list", "--log", log]).stdout.trim().split("\n"), [
    "2026-01-04 · a · level 1",
    "2026-01-03 · b · level 1",
    "2026-01-02 · c · level 3",
    "2026-01-01 · d · level not recorded",
  ]);
});

test("find matches ASCII terms at word starts and summarizes the best match", () => {
  const log = tempLog();
  writeFileSync(
    log,
    `# Log

## 2026-05-01 · Kafka consumer lag
Task: consumer was blocking on a clock skew
Learned:
1. x
Level: 1, try 2

## 2026-03-01 · Redis locking
Task: double charge race
Learned:
1. Locks need ownership.
Level: 3
`,
  );
  const r = run(["find", "--log", log, "redis", "lock", "race"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^## 2026-03-01 · Redis locking/);
  assert.doesNotMatch(r.stdout, /Kafka/, '"lock" must not match "blocking" or "clock"');
  assert.match(r.stdout, /Best match: 2026-03-01 · Redis locking, level 3\./);

  const zh = run(["find", "--log", join(demo("double-charge"), "LEARNING_LOG.md"), "租約"]);
  assert.match(zh.stdout, /Best match: 2026-09-29/);

  const none = run(["find", "--log", log, "kubernetes"]);
  assert.equal(none.status, 0);
  assert.match(none.stdout, /No entries .* mention: kubernetes\. Run "list"/);
});

test("a missing log is reported, not an error", () => {
  const r = run(["find", "--log", tempLog(), "redis"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No learning log at/);
});

test("entries without ## headings are flagged, never silently missed", () => {
  const log = tempLog();
  const original = "# Log\n\nTask: Stop double-charge\nLearned:\n1. A race.\nLevel: 1, try 2\n";
  writeFileSync(log, original);
  assert.match(run(["list", "--log", log]).stdout, /entries without their own "## YYYY-MM-DD · topic" heading/);
  assert.match(run(["find", "--log", log, "race"]).stdout, /entries without their own "## YYYY-MM-DD · topic" heading/);
  const r = add(log, "New", "2026-02-02", ENTRY);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Give those entries headings first/);
  assert.equal(readFileSync(log, "utf8"), original);
});

test("an unheaded entry hiding under a headed one is flagged too", () => {
  const log = tempLog();
  const original = "# Log\n\n## 2026-02-01 · Postgres locks\nTask: a\nLearned:\n1. b\nLevel: 2\n\nTask: Kafka dupes\nLearned:\n1. c\nLevel: 1\n";
  writeFileSync(log, original);
  assert.match(run(["list", "--log", log]).stdout, /without their own/);
  assert.match(run(["find", "--log", log, "kafka"]).stdout, /without their own/);
  assert.equal(add(log, "New", "2026-03-03", ENTRY).status, 1);
  assert.equal(readFileSync(log, "utf8"), original);
});

test("a fenced template or an undated ## section in the header is not an entry", () => {
  const log = tempLog();
  writeFileSync(log, "# Log\n\n## How to use this log\n\n````text\n```\nTask: <what>\nLearned:\n1. <lesson>\nLevel: <1-3>\n```\n## not a heading\n````\n\n## 2026-01-01 · Old\nTask: x\nLearned:\n1. y\nLevel: 3\n");
  assert.equal(run(["list", "--log", log]).stdout.trim(), "2026-01-01 · Old · level 3");
  const r = add(log, "New", "2026-02-02", ENTRY);
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(log, "utf8");
  assert.ok(text.indexOf("## not a heading") < text.indexOf("## 2026-02-02 · New"), "new entry goes below the header");
  assert.ok(text.indexOf("## 2026-02-02 · New") < text.indexOf("## 2026-01-01 · Old"));
});

test("add writes through a symlinked log and keeps its permissions", { skip: process.platform === "win32" }, () => {
  const dir = tempDir();
  const real = join(dir, "real.md");
  const link = join(dir, "link.md");
  writeFileSync(real, "# Log\n");
  chmodSync(real, 0o600);
  symlinkSync(real, link);
  const r = add(link, "New", "2026-02-02", ENTRY);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lstatSync(link).isSymbolicLink(), "link is still a link");
  assert.ok(readFileSync(real, "utf8").includes("## 2026-02-02 · New"));
  assert.equal(statSync(real).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir).sort(), ["link.md", "real.md"], "no temp file left behind");
});

test("add creates the log, puts newer entries on top, and stores the entry verbatim", () => {
  const log = tempLog();
  assert.equal(add(log, "Redis locking", "2026-03-14", ENTRY).status, 0);
  const second = add(log, "Kubernetes restarts", "2026-05-02", "Task: pods restarting\nLearned:\n1. OOMKilled/137 means over the memory limit.\nLevel: 2\n");
  assert.equal(second.status, 0, second.stderr);

  const text = readFileSync(log, "utf8");
  assert.match(text, /^# Learning log\n/);
  assert.ok(text.indexOf("## 2026-05-02 · Kubernetes restarts") < text.indexOf("## 2026-03-14 · Redis locking"));
  assert.ok(text.includes(ENTRY.trim()), "backticks and wrapped lines are kept verbatim");
  assert.ok(text.endsWith("Level: 1, try 2\n"));
});

test("add leaves every existing byte alone: BOM, CRLF, blank lines, fenced ## lines", () => {
  const log = tempLog();
  const before = "﻿# My log\r\n\r\nNotes go here.  \r\n\r\n\r\n## 2026-01-01 · Old\r\nTask: x\r\nLearned:\r\n1. y\r\n```\r\n## not a heading\r\n```\r\nLevel: 3   \r\n\r\n\r\n";
  writeFileSync(log, before);
  const r = add(log, "New", "2026-02-02", ENTRY);
  assert.equal(r.status, 0, r.stderr);
  const after = readFileSync(log, "utf8");
  const insertAt = before.indexOf("## 2026-01-01");
  assert.equal(after.slice(0, insertAt), before.slice(0, insertAt), "header untouched, BOM kept");
  assert.ok(after.endsWith(before.slice(insertAt)), "old entry untouched");
  const added = after.slice(insertAt, after.length - (before.length - insertAt));
  assert.ok(added.startsWith("## 2026-02-02 · New\r\n") && added.endsWith("Level: 1, try 2\r\n\r\n"));
  assert.ok(!/[^\r]\n/.test(added), "new entry uses the file's CRLF line endings");
  assert.equal(run(["list", "--log", log]).stdout.trim(), "2026-02-02 · New · level 1, try 2 next\n2026-01-01 · Old · level 3");
});

test("add counts numbered lessons only, so wrapped lines and sub-points are fine", () => {
  const log = tempLog();
  const r = add(log, "t", "2026-01-01", "Task: x\nLearned:\n1. first\n   - detail\n   - detail\n2. second\nNext time:\n- read a\n- read b\nLevel: 1.\n");
  assert.equal(r.status, 0, r.stderr);
});

test("add rejects entries that break the format, and writes nothing", () => {
  const log = tempLog();
  const cases = [
    ["Task: x\nLearned:\n1. a\n2. b\n3. c\n4. d\nLevel: 1\n", /4 numbered lessons/],
    ["Task: x\nLearned:\nLevel: 1\n", /0 numbered lessons/],
    ["Task: x\nLearned:\n1. a\nLevel: soon\n", /level of 1, 2 or 3/],
    ["Learned:\n1. a\nLevel: 1\n", /missing a "Task:" line/],
    ["Task: x\nLearned:\n1. a\n## Notes\nLevel: 1\n", /split it in two/],
    ["## 2026-01-01 · t\nTask: x\nLearned:\n1. a\nLevel: 1\n", /leave the "## date · topic" heading out/],
    ["", /empty/],
  ];
  for (const [entry, message] of cases) {
    const r = add(log, "t", "2026-01-01", entry);
    assert.equal(r.status, 1, entry);
    assert.match(r.stderr, message);
  }
  assert.match(add(log, "t", "2026-13-45", ENTRY).stderr, /real YYYY-MM-DD date/);
  assert.match(run(["add", "--log", log, "--file", entryFile(ENTRY)]).stderr, /needs --topic/);
  assert.match(run(["add", "--log", log, "--topic", "Redis", "locking", "--file", entryFile(ENTRY)]).stderr, /quote a topic/);
  assert.match(run(["add", "--log", join(tempDir(), "missing", "LOG.md"), "--topic", "t", "--file", entryFile(ENTRY)]).stderr, /folder .* doesn't exist/);
  assert.match(run(["add", "--log", log, "--topic", "a\nb", "--file", entryFile(ENTRY)]).stderr, /single line/);
  assert.ok(!existsSync(log), "nothing was written");
});

test("add refuses to write the same entry twice", () => {
  const log = tempLog();
  assert.equal(add(log, "Redis locking", "2026-03-14", ENTRY).status, 0);
  const again = add(log, "Redis locking", "2026-03-14", ENTRY);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already has this entry/);
});

test("add still reads the entry from stdin when --file is omitted", () => {
  const log = tempLog();
  const r = run(["add", "--log", log, "--topic", "t", "--date", "2026-01-01"], ENTRY);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(readFileSync(log, "utf8").includes(ENTRY.trim()));
});

test("--help works in any position", () => {
  for (const args of [["--help"], ["-h"], ["find", "--help"]]) {
    const r = run(args);
    assert.equal(r.status, 0, args.join(" "));
    assert.match(r.stdout, /^usage:/);
  }
});
