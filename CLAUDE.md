# CLAUDE.md

This repo develops a single Claude Code skill: `skills/jit-learning-loop/`. It is packaged as a plugin (`.claude-plugin/`), so the repo root is also the plugin root.

## Source of truth

- `docs/methodology.zh-TW.md` is the original essay. The skill is its operational distillation. When changing the skill's behavior, check it still agrees with the essay's core question: *which cognitive work does the user keep, so next time they need less help?*
- `SKILL.md` must stay under ~500 lines. Put depth in `references/` and point to it from `SKILL.md`, saying when to read it.
- Frontmatter allows only `name`, `description`, `license`, `allowed-tools`, `metadata` and `compatibility`. The description must be ≤1024 characters with no angle brackets.

## Cross-agent compatibility

The skill is distributed with `npx skills add cyyeh/jit-learning-loop` to any agent that implements the [Agent Skills spec](https://agentskills.io/specification), not just Claude Code. Keep it portable:

- **Skill files stay agent-neutral.** Don't name specific tools (Bash, Read, subagents), slash commands, or Claude-only features in `skills/`. Say "the agent", "read the file", "run the test".
- **Frontmatter stays single-line and plain.** Some agents parse it naively: no block scalars, no `: ` or ` #` inside the description.
- **Trigger words go first in the description.** Codex shortens descriptions when many skills are installed.
- **Agent-specific extras are optional side files** (`agents/openai.yaml` for Codex). The skill must work without them.
- `node scripts/validate.mjs` enforces the frontmatter rules. CI also checks that `npx skills add . --list` discovers the skill.

## Iterating with skill-creator

Use the `skill-creator` skill for the eval loop. The conventions for this repo:

- Test prompts live in `evals/evals.json`, fixtures in `evals/files/`. Eval prompts refer to fixtures by repo-relative path.
- Put run outputs in `jit-learning-loop-workspace/iteration-N/` at the repo root. This is gitignored.
- Baseline for a new behavior: `without_skill`. When revising, snapshot the current skill into the workspace first and use it as `old_skill`.
- This skill is **interactive**: a good first turn *stops* at the prediction checkpoint. Single-turn eval runs should save the agent's full first reply to `outputs/response.md`. Grade the checkpoint behavior; don't penalize an unfinished fix.
- Many expectations are judgment calls (tone, "minimum" model size). Grade those qualitatively in the viewer rather than forcing pass/fail.

## Validate

```bash
node scripts/validate.mjs
npx skills add . --list
```

## Language

Write skill files in English (they are model-facing). The skill tells Claude to reply in the user's language, keeping technical terms in English. Eval 4 checks this with a Traditional Chinese prompt.
