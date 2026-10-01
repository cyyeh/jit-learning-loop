#!/usr/bin/env node
// Reads and writes the learning log (steps 0 and 7 of SKILL.md), so the agent
// can look up one topic in a long log and add entries in the same shape and
// place every time. Zero dependencies; Node 18+.
//
//   node learning-log.mjs list [--log PATH]
//       One line per entry: date · topic · level.
//   node learning-log.mjs find [--log PATH] [--limit N] TERM...
//       Entries mentioning any TERM, best match first, and the level the
//       best match ended at. ASCII terms match at word starts ("lock" finds
//       "locking", not "blocking"); other terms match anywhere.
//   node learning-log.mjs add [--log PATH] --file ENTRY_FILE --topic TOPIC [--date YYYY-MM-DD]
//       Checks the entry (Task, 1-3 numbered lessons under Learned, a Level
//       of 1-3), adds the "## date · topic" heading and inserts it above the
//       newest entry. The rest of the file is left byte-for-byte as it was.
//       Creates the log if it doesn't exist. Reads stdin if --file is omitted.
//
// PATH defaults to LEARNING_LOG.md in the current directory.
import { readFileSync, writeFileSync, existsSync, renameSync, realpathSync, statSync, chmodSync, rmSync } from "node:fs";
import { dirname, basename, join } from "node:path";

const USAGE = `usage:
  learning-log.mjs list [--log PATH]
  learning-log.mjs find [--log PATH] [--limit N] TERM...
  learning-log.mjs add  [--log PATH] --file ENTRY_FILE --topic TOPIC [--date YYYY-MM-DD]`;

const NEW_LOG_HEADER =
  "# Learning log\n\nNewest first. Keep only lessons that will still help the next time a *different* problem comes up.\n";
const FIELD = /^(Task|Unknown types|Learned|Next time|Level)\s*[:：]/i;
// Entries start with a dated "## " heading; other "## " lines are not entries.
const ENTRY_HEADING = /^## .*\d{4}-\d{2}-\d{2}/;
// A level digit, not part of a bigger number, a decimal or an ordinal ("2nd").
const LEVEL_DIGIT = /(?<![\d.])([123])(?!\d|\.\d|st\b|nd\b|rd\b|th\b)/g;

class UsageError extends Error {}
const fail = (msg) => {
  throw new UsageError(msg);
};

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === "-h" || command === "--help") return { command, opts: { help: true } };
  const opts = { log: "LEARNING_LOG.md", limit: 3, terms: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = () => {
      if (i + 1 >= rest.length) fail(`${arg} needs a value`);
      return rest[++i];
    };
    if (arg === "--log") opts.log = value();
    else if (arg === "--limit") opts.limit = Number(value());
    else if (arg === "--topic") opts.topic = value();
    else if (arg === "--date") opts.date = value();
    else if (arg === "--file") opts.file = value();
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg.startsWith("--")) fail(`unknown option ${arg}`);
    else opts.terms.push(arg);
  }
  if (!Number.isInteger(opts.limit) || opts.limit < 1) fail("--limit must be a positive integer");
  if (command !== "find" && opts.terms.length) {
    fail(`unexpected argument "${opts.terms[0]}"${command === "add" ? ' (quote a topic with spaces: --topic "Redis locking")' : ""}`);
  }
  return { command, opts };
}

// Returns the text without a BOM or CRs, plus what's needed to write it back.
function readLog(path) {
  let raw = readFileSync(path, "utf8");
  const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  if (bom) raw = raw.slice(1);
  return { raw, bom, eol: raw.includes("\r\n") ? "\r\n" : "\n", text: raw.replace(/\r\n/g, "\n") };
}

// For each line, whether it sits inside a ``` or ~~~ code fence (fence lines
// included). A fence closes on the same character, at least as long, alone.
function fenced(lines) {
  let open = null;
  return lines.map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (!marker) return open !== null;
    if (open === null) open = marker;
    else if (marker[0] === open[0] && marker.length >= open.length && line.trim() === marker) open = null;
    return true;
  });
}

const unfenced = (lines) => {
  const inFence = fenced(lines);
  return lines.filter((_, i) => !inFence[i]);
};

function entryStarts(lines) {
  const inFence = fenced(lines);
  return lines.flatMap((line, i) => (!inFence[i] && ENTRY_HEADING.test(line) ? [i] : []));
}

function parseLog(text) {
  const lines = text.split("\n");
  const starts = entryStarts(lines);
  const headerLines = lines.slice(0, starts[0] ?? lines.length);
  const entries = starts.map((start, n) => describe(lines.slice(start, starts[n + 1] ?? lines.length).join("\n").trimEnd(), n));
  // Entries written without a dated "## " heading (older or hand-written logs)
  // land in the header or inside the entry above them, where list and find
  // can't tell them apart. A fenced template in the header doesn't count.
  const headless =
    unfenced(headerLines).some((l) => FIELD.test(l)) ||
    entries.some((e) => {
      const fields = unfenced(e.text.split("\n"));
      return fields.filter((l) => /^Task\s*[:：]/i.test(l)).length > 1 || fields.filter((l) => /^Level\s*[:：]/i.test(l)).length > 1;
    });
  return { header: headerLines.join("\n"), entries, headless };
}

function describe(text, index) {
  const heading = text.split("\n", 1)[0].slice(3).trim();
  const date = heading.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  const topic =
    heading.replace(date, "").replace(/\(\s*\)/g, "").replace(/^[\s·\-–—|:]+|[\s·\-–—|:]+$/g, "").trim() || heading;
  const levelLine = text.match(/^Level\s*[:：](.*)$/im)?.[1] ?? "";
  // "Level: 1, try level 2 on ..." → level 1, next 2. Works in any language
  // as long as the current level comes first.
  const [level, next] = [...levelLine.matchAll(LEVEL_DIGIT)].map((m) => m[1]);
  return { text, index, date, topic, level, next };
}

function levelSummary(e) {
  if (!e.level) return "level not recorded";
  return e.next && e.next !== e.level ? `level ${e.level}, try ${e.next} next` : `level ${e.level}`;
}

const label = (e) => [e.date, e.topic].filter(Boolean).join(" · ");
const HEADLESS_NOTE = (log) =>
  `Note: ${log} has entries without their own "## YYYY-MM-DD · topic" heading, which this script can't tell apart. Read the file directly.`;

function loadForReading(log) {
  if (!existsSync(log)) {
    console.log(`No learning log at ${log}. Treat the topic as new (level 1) unless the user says otherwise.`);
    return null;
  }
  return parseLog(readLog(log).text);
}

function list(opts) {
  const parsed = loadForReading(opts.log);
  if (!parsed) return;
  if (!parsed.entries.length && !parsed.headless) console.log(`${opts.log} has no entries yet.`);
  for (const e of parsed.entries) console.log(`${label(e)} · ${levelSummary(e)}`);
  if (parsed.headless) console.log(HEADLESS_NOTE(opts.log));
}

function matcher(term) {
  const t = term.toLowerCase();
  if (/^[\x20-\x7e]+$/.test(t)) {
    const re = new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    return (text) => re.test(text);
  }
  return (text) => text.toLowerCase().includes(t);
}

function find(opts) {
  if (!opts.terms.length) fail("find needs at least one search term");
  const parsed = loadForReading(opts.log);
  if (!parsed) return;
  const tests = opts.terms.map(matcher);
  const matches = parsed.entries
    .map((e) => ({ ...e, score: tests.filter((test) => test(e.text)).length }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date) || a.index - b.index);

  if (!matches.length) {
    console.log(`No entries in ${opts.log} mention: ${opts.terms.join(", ")}. Run "list" and judge whether any topic is related; if none is, start at level 1.`);
  } else {
    const shown = matches.slice(0, opts.limit);
    console.log(shown.map((e) => e.text).join("\n\n"));
    if (matches.length > shown.length) console.log(`\n(${matches.length - shown.length} more; raise --limit to see them)`);
    console.log(`\nBest match: ${label(matches[0])}, ${levelSummary(matches[0])}.`);
    const best = matches[0];
    if (best.level) console.log(`Suggested starting level: ${best.next ?? best.level} (a level the user asks for, or a plan they bring, still wins).`);
    const newest = [...matches].sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)[0];
    if (newest !== matches[0]) console.log(`Most recent match: ${label(newest)}, ${levelSummary(newest)}.`);
  }
  if (parsed.headless) console.log(HEADLESS_NOTE(opts.log));
}

function checkEntry(entry) {
  const problems = [];
  const lines = entry.split("\n");
  if (!lines.some((l) => /^Task\s*[:：]\s*\S/i.test(l))) problems.push('missing a "Task:" line');

  // Lessons run from "Learned:" to the next field. Count the numbered lines;
  // wrapped lines and indented sub-points belong to the lesson above them.
  const start = lines.findIndex((l) => /^Learned\s*[:：]/i.test(l));
  if (start === -1) problems.push('missing a "Learned:" line followed by numbered lessons');
  else {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => FIELD.test(l));
    const block = rest.slice(0, end === -1 ? undefined : end);
    const lessons = block.filter((l) => /^\d+[.)]\s+\S/.test(l)).length;
    if (lessons < 1 || lessons > 3) problems.push(`has ${lessons} numbered lessons under "Learned:"; keep 1-3 transferable ones`);
  }

  const level = entry.match(/^Level\s*[:：](.*)$/im);
  if (!level) problems.push('missing a "Level:" line');
  else if (![...level[1].matchAll(LEVEL_DIGIT)].length) problems.push('"Level:" needs a level of 1, 2 or 3');

  if (unfenced(lines.slice(1)).some((l) => l.startsWith("## "))) problems.push('has a "## " line inside the entry, which would split it in two');
  return problems;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

function readEntry(opts) {
  if (opts.file) return readFileSync(opts.file, "utf8");
  if (process.stdin.isTTY) fail("add needs the entry: pass --file ENTRY_FILE (or pipe it on stdin)");
  return readFileSync(0, "utf8");
}

function add(opts) {
  if (!opts.topic?.trim()) fail("add needs --topic");
  if (/[\r\n]/.test(opts.topic)) fail("--topic must be a single line");
  const date = opts.date ?? today();
  if (!isRealDate(date)) fail(`--date must be a real YYYY-MM-DD date, got "${date}"`);

  let body = readEntry(opts).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if (!body) fail("the entry is empty");
  if (body.startsWith("## ")) fail('leave the "## date · topic" heading out of the entry; --topic and --date make it');
  const entry = `## ${date} · ${opts.topic.trim()}\n${body}`;
  const problems = checkEntry(entry);
  if (problems.length) fail(`entry not added:\n- ${problems.join("\n- ")}`);

  if (!existsSync(dirname(opts.log))) {
    fail(`the folder for ${opts.log} doesn't exist${opts.log.startsWith("~") ? ' (the shell only expands "~" when it is unquoted)' : ""}`);
  }
  const log = existsSync(opts.log) ? readLog(opts.log) : { raw: NEW_LOG_HEADER, bom: "", eol: "\n", text: NEW_LOG_HEADER };
  const { entries, headless } = parseLog(log.text);
  if (headless) {
    fail(`${opts.log} has entries without their own "## YYYY-MM-DD · topic" heading, so where "newest first" goes is unclear. Give those entries headings first, or add this one by hand.`);
  }
  if (entries.some((e) => e.text.slice(e.text.indexOf("\n") + 1).trim() === body)) {
    fail(`${opts.log} already has this entry; nothing added.`);
  }

  // Insert above the first entry (or append), leaving every other byte alone.
  const block = entry.replace(/\n/g, log.eol) + log.eol;
  const first = entryStarts(log.text.split("\n"))[0];
  let updated;
  if (first !== undefined) {
    const offset = log.raw.split("\n").slice(0, first).reduce((n, l) => n + l.length + 1, 0);
    updated = log.raw.slice(0, offset) + block + log.eol + log.raw.slice(offset);
  } else {
    const t = log.text;
    const gap = !t.trim() || t.endsWith("\n\n") ? "" : t.endsWith("\n") ? log.eol : log.eol + log.eol;
    updated = log.raw + gap + block;
  }

  // Write next to the real file (following a symlinked log), keep its mode,
  // and swap it in with a rename so a failed write can't leave half a log.
  const target = existsSync(opts.log) ? realpathSync(opts.log) : opts.log;
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, log.bom + updated);
    if (existsSync(target)) chmodSync(tmp, statSync(target).mode & 0o7777);
    renameSync(tmp, target);
  } finally {
    rmSync(tmp, { force: true });
  }
  console.log(`Added "## ${date} · ${opts.topic.trim()}" as the newest entry in ${opts.log}.`);
}

const commands = { list, find, add };
try {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.help) console.log(USAGE);
  else if (!commands[command]) fail(command ? `unknown command ${command}` : "no command given");
  else commands[command](opts);
} catch (err) {
  if (err instanceof UsageError) console.error(`learning-log: ${err.message}\n${USAGE}`);
  else console.error(`learning-log: ${err.code === "ENOENT" ? `no such file or directory: ${err.path}` : err.message}`);
  process.exit(1);
}
