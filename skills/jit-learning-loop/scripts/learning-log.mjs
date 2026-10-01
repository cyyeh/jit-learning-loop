#!/usr/bin/env node
// Reads and writes the learning log (step 0 and step 7 of SKILL.md), so the
// agent doesn't have to load the whole log or hand-place entries.
// Zero dependencies; Node 18+.
//
//   node learning-log.mjs list [--log PATH]
//       One line per entry: date · topic · level.
//   node learning-log.mjs find [--log PATH] [--limit N] TERM...
//       Entries mentioning any TERM (case-insensitive), best match first,
//       plus the level they ended at.
//   node learning-log.mjs add [--log PATH] [--topic TOPIC] [--date YYYY-MM-DD] < entry.txt
//       Checks the entry (Task, 1-3 numbered lessons under Learned, a Level
//       of 1-3), adds the "## date · topic" heading, and inserts it above
//       the newest entry. Creates the log if it doesn't exist.
//
// PATH defaults to LEARNING_LOG.md in the current directory.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const USAGE = `usage:
  learning-log.mjs list [--log PATH]
  learning-log.mjs find [--log PATH] [--limit N] TERM...
  learning-log.mjs add  [--log PATH] [--topic TOPIC] [--date YYYY-MM-DD] < entry.txt`;

const NEW_LOG_HEADER =
  "# Learning log\n\nNewest first. Keep only lessons that will still help the next time a *different* problem comes up.\n";

function die(msg) {
  console.error(`learning-log: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { log: "LEARNING_LOG.md", limit: 3, terms: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = () => {
      if (i + 1 >= rest.length) die(`${arg} needs a value\n${USAGE}`);
      return rest[++i];
    };
    if (arg === "--log") opts.log = value();
    else if (arg === "--limit") opts.limit = Number(value());
    else if (arg === "--topic") opts.topic = value();
    else if (arg === "--date") opts.date = value();
    else if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg.startsWith("--")) die(`unknown option ${arg}\n${USAGE}`);
    else opts.terms.push(arg);
  }
  if (!Number.isInteger(opts.limit) || opts.limit < 1) die("--limit must be a positive integer");
  return { command, opts };
}

function readLog(path) {
  const raw = readFileSync(path, "utf8");
  return { text: raw.replace(/\r\n/g, "\n"), eol: raw.includes("\r\n") ? "\r\n" : "\n" };
}

// Entries are "## " headings; anything before the first one is the header.
function splitEntries(text) {
  const lines = text.split("\n");
  const firstEntry = lines.findIndex((l) => l.startsWith("## "));
  if (firstEntry === -1) return { header: text, entries: [] };
  const entries = [];
  let current = null;
  for (const line of lines.slice(firstEntry)) {
    if (line.startsWith("## ")) {
      current = { lines: [line] };
      entries.push(current);
    } else current.lines.push(line);
  }
  return {
    header: lines.slice(0, firstEntry).join("\n"),
    entries: entries.map((e, index) => describe(e.lines.join("\n").trimEnd(), index)),
  };
}

function describe(text, index) {
  const heading = text.split("\n", 1)[0].slice(3).trim();
  const date = heading.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  const topic = heading.replace(date, "").replace(/^[\s·\-–—|:]+/, "").trim() || heading;
  const levelLine = text.match(/^Level[:：](.*)$/m)?.[1] ?? "";
  // "Level: 1, try level 2 on ..." → level 1, next 2. Works for any language
  // as long as the digits come in that order.
  const [level, next] = [...levelLine.matchAll(/(?<![\d.])([123])(?![\d.])/g)].map((m) => m[1]);
  return { text, index, date, topic, level, next };
}

function levelSummary(e) {
  if (!e.level) return "level not recorded";
  return e.next && e.next !== e.level ? `level ${e.level}, try ${e.next} next` : `level ${e.level}`;
}

function list(opts) {
  if (!existsSync(opts.log)) return console.log(`No learning log at ${opts.log}.`);
  const { entries } = splitEntries(readLog(opts.log).text);
  if (!entries.length) return console.log(`${opts.log} has no entries yet.`);
  for (const e of entries) console.log([e.date, e.topic, levelSummary(e)].filter(Boolean).join(" · "));
}

function find(opts) {
  if (!opts.terms.length) die(`find needs at least one search term\n${USAGE}`);
  if (!existsSync(opts.log)) return console.log(`No learning log at ${opts.log}.`);
  const terms = opts.terms.map((t) => t.toLowerCase());
  const matches = splitEntries(readLog(opts.log).text)
    .entries.map((e) => ({ ...e, score: terms.filter((t) => e.text.toLowerCase().includes(t)).length }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date) || a.index - b.index);
  if (!matches.length) return console.log(`No entries in ${opts.log} mention: ${opts.terms.join(", ")}.`);

  const shown = matches.slice(0, opts.limit);
  console.log(shown.map((e) => e.text).join("\n\n"));
  if (matches.length > shown.length) console.log(`\n(${matches.length - shown.length} more; raise --limit to see them)`);
  const latest = [...matches].sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)[0];
  console.log(`\nMost recent match: ${[latest.date, latest.topic].filter(Boolean).join(" · ")}, ${levelSummary(latest)}.`);
}

function checkEntry(body) {
  const problems = [];
  if (!/^Task[:：]\s*\S/m.test(body)) problems.push('missing a "Task:" line');

  // Lessons run from "Learned:" to the next "Field:" line; a lesson may wrap.
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^Learned[:：]/.test(l));
  if (start === -1) problems.push('missing a "Learned:" line followed by numbered lessons');
  else {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^[A-Z][A-Za-z ]*[:：]/.test(l));
    const lessons = rest.slice(0, end === -1 ? undefined : end).filter((l) => /^\s*(\d+[.)]|[-*])\s+\S/.test(l)).length;
    if (lessons < 1 || lessons > 3) problems.push(`has ${lessons} lessons under "Learned:"; keep 1-3 transferable ones`);
  }

  const level = body.match(/^Level[:：](.*)$/m);
  if (!level) problems.push('missing a "Level:" line');
  else if (!/(?<![\d.])[123](?![\d.])/.test(level[1])) problems.push('"Level:" needs a level of 1, 2 or 3');
  return problems;
}

function add(opts) {
  let body;
  try {
    body = readFileSync(0, "utf8");
  } catch {
    die(`add reads the entry from stdin\n${USAGE}`);
  }
  body = body.replace(/\r\n/g, "\n").trim();
  if (!body) die(`add reads the entry from stdin, and it was empty\n${USAGE}`);

  if (body.startsWith("## ")) {
    if (opts.topic || opts.date) die("the entry already has a ## heading; drop --topic and --date, or drop the heading");
  } else {
    if (!opts.topic) die('add needs --topic (or an entry that starts with a "## date · topic" heading)');
    const date = opts.date ?? new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local time
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die(`--date must be YYYY-MM-DD, got ${date}`);
    body = `## ${date} · ${opts.topic.trim()}\n${body}`;
  }

  const problems = checkEntry(body);
  if (problems.length) die(`entry not added:\n- ${problems.join("\n- ")}`);

  const { text, eol } = existsSync(opts.log) ? readLog(opts.log) : { text: NEW_LOG_HEADER, eol: "\n" };
  const { header, entries } = splitEntries(text);
  const parts = [header.trimEnd(), body, ...entries.map((e) => e.text)].filter(Boolean);
  writeFileSync(opts.log, (parts.join("\n\n") + "\n").replace(/\n/g, eol));
  console.log(`Added "${body.split("\n", 1)[0]}" to the top of ${opts.log}.`);
}

const { command, opts } = parseArgs(process.argv.slice(2));
const commands = { list, find, add };
if (!commands[command]) die(command ? `unknown command ${command}\n${USAGE}` : USAGE);
commands[command](opts);
