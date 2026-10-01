# AGENTS.md

This repo develops a single [Agent Skill](https://agentskills.io/specification): `skills/jit-learning-loop/`, which installs into any compatible agent. It is also packaged as a Claude Code plugin (`.claude-plugin/`), so the repo root is also the plugin root.

## Source of truth

- `docs/methodology.zh-TW.md` is the original essay (`docs/methodology.en.md` is its English translation; if you change one, update the other). The skill is its operational distillation. When changing the skill's behavior, check it still agrees with the essay's core question: *which cognitive work does the user keep, so next time they need less help?*
- `SKILL.md`'s body must stay within 920 words (`validate.mjs` checks): it loads on every trigger. Put depth in `references/` and point to it from `SKILL.md`, saying when to read it. Steps 4–7 live in `references/after-the-checkpoint.md` because they only matter once the first checkpoint is answered.
- Frontmatter allows only `name`, `description`, `license`, `allowed-tools`, `metadata` and `compatibility`. The description must be ≤1024 characters with no angle brackets.
- Keep the description to 60 words or fewer (`validate.mjs` checks): what the skill does and when to use it. It sits in the agent's context on every turn, so lead with a few trigger words, not a list of example phrases or a summary of the procedure. Those belong in the body.
- Deterministic steps belong in `scripts/` inside the skill, not in prose. `scripts/learning-log.mjs` reads and writes the learning log. Skill scripts are optional helpers: Node, zero dependencies, and `SKILL.md` must still work when they can't run. Tests live in the repo's `scripts/learning-log.test.mjs`.

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
- Evals 5 and 6 are later turns: the prompt points at the recorded `demo/double-charge` transcript as the conversation so far. Run them whenever `references/after-the-checkpoint.md` or the learning-log helper changes, since single-turn evals never reach that file.

## Validate

```bash
node scripts/validate.mjs
node --test scripts/learning-log.test.mjs
npx skills add . --list
```

## Language

Write skill files in English (they are model-facing). The skill tells the agent to reply in the user's language, keeping technical terms in English. Eval 4 checks this with a Traditional Chinese prompt.
