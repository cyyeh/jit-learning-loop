// Tests for skills/jit-learning-loop/scripts/learning-log.mjs.
// Run with: node --test scripts/learning-log.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "skills/jit-learning-loop/scripts/learning-log.mjs");
const demoLog = join(root, "demo/double-charge/project/LEARNING_LOG.md");

const run = (args, input) => spawnSync(process.execPath, [script, ...args], { input, encoding: "utf8" });
const tempLog = () => join(mkdtempSync(join(tmpdir(), "learning-log-")), "LEARNING_LOG.md");

const ENTRY = `Task: Stop double-charge when users double-click Pay
Unknown types: concept (race), API (SET NX PX)
Learned:
1. Check-then-act across concurrent requests is a race.
2. Release must check ownership, or you free someone
   else's lock.
Next time: read about fencing tokens.
Level: 1, try 2
`;

test("list summarizes each entry, including a Traditional Chinese level line", () => {
  const r = run(["list", "--log", demoLog]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "2026-09-29 · Redis lock / check-then-act race · level 1, try 2 next");
});

test("find returns matching entries and the level to calibrate from", () => {
  const r = run(["find", "--log", demoLog, "redis"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^## 2026-09-29 · Redis lock/);
  assert.match(r.stdout, /Most recent match: 2026-09-29 · Redis lock \/ check-then-act race, level 1, try 2 next\./);

  const none = run(["find", "--log", demoLog, "kafka"]);
  assert.equal(none.status, 0);
  assert.match(none.stdout, /No entries .* mention: kafka/);
});

test("a missing log is reported, not an error", () => {
  const r = run(["find", "--log", tempLog(), "redis"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No learning log at/);
});

test("add creates the log and puts newer entries on top", () => {
  const log = tempLog();
  assert.equal(run(["add", "--log", log, "--topic", "Redis locking", "--date", "2026-03-14"], ENTRY).status, 0);
  const second = run(["add", "--log", log, "--topic", "Kubernetes restarts", "--date", "2026-05-02"],
    "Task: pods restarting\nLearned:\n1. OOMKilled/137 means over the memory limit.\nLevel: 2\n");
  assert.equal(second.status, 0, second.stderr);

  const text = readFileSync(log, "utf8");
  assert.match(text, /^# Learning log\n/);
  assert.ok(text.indexOf("## 2026-05-02 · Kubernetes restarts") < text.indexOf("## 2026-03-14 · Redis locking"));
  assert.ok(text.includes(ENTRY.trim()), "entry body is kept verbatim");
  assert.ok(text.endsWith("Level: 1, try 2\n"));
});

test("add keeps an existing header and line endings", () => {
  const log = tempLog();
  writeFileSync(log, "# My log\r\n\r\nNotes go here.\r\n\r\n## 2026-01-01 · Old\r\nTask: x\r\nLearned:\r\n1. y\r\nLevel: 3\r\n");
  assert.equal(run(["add", "--log", log, "--topic", "New", "--date", "2026-02-02"], ENTRY).status, 0);
  const text = readFileSync(log, "utf8");
  assert.ok(text.startsWith("# My log\r\n\r\nNotes go here.\r\n\r\n## 2026-02-02 · New\r\n"));
  assert.ok(text.includes("\r\n\r\n## 2026-01-01 · Old\r\n"));
  assert.ok(!/[^\r]\n/.test(text), "no bare LF line endings");
});

test("add rejects entries that break the format", () => {
  const log = tempLog();
  const tooMany = run(["add", "--log", log, "--topic", "t"], "Task: x\nLearned:\n1. a\n2. b\n3. c\n4. d\nLevel: 1\n");
  assert.equal(tooMany.status, 1);
  assert.match(tooMany.stderr, /4 lessons/);

  const noLevel = run(["add", "--log", log, "--topic", "t"], "Task: x\nLearned:\n1. a\nLevel: soon\n");
  assert.equal(noLevel.status, 1);
  assert.match(noLevel.stderr, /level of 1, 2 or 3/);

  assert.equal(run(["add", "--log", log], ENTRY).status, 1, "needs --topic");
  assert.equal(run(["add", "--log", log, "--topic", "t", "--date", "14/03/2026"], ENTRY).status, 1);
  assert.throws(() => readFileSync(log), "nothing was written");
});
