#!/usr/bin/env node
// Checks every skills/*/SKILL.md against the Agent Skills spec
// (https://agentskills.io/specification), the common format that
// `npx skills add` installs into Claude Code, Codex, Cursor, Gemini CLI, etc.
// Zero dependencies so it runs anywhere Node does.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");
const MAX_DESCRIPTION_WORDS = 60;
// SKILL.md's body loads on every trigger. Published skills have a median body
// of about 921 words; depth that's only needed later belongs in references/.
const MAX_BODY_WORDS = 920;
const ALLOWED = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

let failures = 0;
const fail = (skill, msg) => {
  failures++;
  console.error(`✗ ${skill}: ${msg}`);
};

for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const file = join(skillsDir, dir.name, "SKILL.md");
  if (!existsSync(file)) continue;

  const text = readFileSync(file, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    fail(dir.name, "missing YAML frontmatter");
    continue;
  }

  // Top-level `key: value` lines only. Keeping every field on one line is
  // deliberate: some agents parse frontmatter naively and choke on block scalars.
  const fields = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2];
    else if (line.trim() && !/^\s/.test(line)) fail(dir.name, `unparseable frontmatter line: ${line}`);
  }

  for (const key of Object.keys(fields)) {
    if (!ALLOWED.has(key)) fail(dir.name, `unknown frontmatter key "${key}"`);
  }

  const { name = "", description = "", compatibility } = fields;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail(dir.name, `name "${name}" must be lowercase letters, digits and single hyphens`);
  if (name.length > 64) fail(dir.name, `name is ${name.length} chars (max 64)`);
  if (name !== dir.name) fail(dir.name, `name "${name}" must match directory name "${dir.name}"`);

  if (!description) fail(dir.name, "description is empty");
  if ([...description].length > 1024) fail(dir.name, `description is ${[...description].length} chars (max 1024)`);
  if (/[<>]/.test(description)) fail(dir.name, "description must not contain angle brackets");
  // The description sits in the agent's context on every turn. Say what the
  // skill does and when to use it; leave trigger-phrase lists to the body.
  const words = description.split(/\s+/).filter(Boolean).length;
  if (words > MAX_DESCRIPTION_WORDS) fail(dir.name, `description is ${words} words (max ${MAX_DESCRIPTION_WORDS}); cut trigger lists and procedure summaries`);
  if (/:\s/.test(description)) fail(dir.name, 'description contains ": ", which breaks unquoted YAML');
  if (/\s#/.test(description)) fail(dir.name, 'description contains " #", which YAML reads as a comment');

  if (compatibility && [...compatibility].length > 500) fail(dir.name, "compatibility exceeds 500 chars");

  const body = text.slice(match[0].length);
  const bodyWords = body.split(/\s+/).filter(Boolean).length;
  if (bodyWords > MAX_BODY_WORDS) fail(dir.name, `SKILL.md body is ${bodyWords} words (max ${MAX_BODY_WORDS}); move depth into references/`);
  for (const ref of new Set((body.match(/(?:references|scripts)\/[\w.-]+/g) ?? []).map((r) => r.replace(/\.+$/, "")))) {
    if (!existsSync(join(skillsDir, dir.name, ref))) fail(dir.name, `SKILL.md points to ${ref}, which doesn't exist`);
  }

  if (!failures) console.log(`✓ ${dir.name} (description ${[...description].length}/1024 chars, ${words}/${MAX_DESCRIPTION_WORDS} words; body ${bodyWords}/${MAX_BODY_WORDS} words)`);
}

process.exit(failures ? 1 : 0);
