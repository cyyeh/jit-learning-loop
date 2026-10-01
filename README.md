# jit-learning-loop

An [Agent Skill](https://agentskills.io) for **learning what the task needs, while doing the task.** It works with any coding agent that supports the [Agent Skills spec](https://agentskills.io/specification): Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode and more.

The usual agentic-coding loop is:

```text
don't know → agent does it → it runs → next task
```

The task ships, but next time you need exactly the same help. This skill changes the loop to:

```text
don't know → agent narrows the unknown → you build a mental model
           → you and the agent implement → you verify → a reusable model is left behind
```

The question it keeps asking is: *which part of the cognitive work should you keep this time, so you need less help next time?*

**▶ [See it in action](https://cyyeh.github.io/jit-learning-loop/?lang=en)**: two full recorded sessions (English and Traditional Chinese). In [one](https://cyyeh.github.io/jit-learning-loop/?demo=add-login&lang=en), a frontend engineer who has never built auth adds login to an API and comes away understanding what they shipped. In [the other](https://cyyeh.github.io/jit-learning-loop/?demo=double-charge&lang=en), an engineer new to Redis locks fixes a double-charge bug. The raw transcripts, test output and final code are in [`demo/`](demo/).

## What the skill does

| Step | What happens |
|---|---|
| 0 · Calibrate | Picks an assistance level (guided, shared or review) and finds what you already know |
| 1 · Gap map | Lists what you have and what's missing, tagged by type: **concept / API / codebase / behavior**. Flags fundamentals worth deeper study. |
| 2 · Minimum model | 3–5 concepts and how they relate. Not a tutorial. |
| 3 · Predict ✋ | 2–3 hypotheses, then *you* predict (or read the evidence) before the experiment runs |
| 4 · Implement | The agent works at full speed and compares the evidence with your prediction |
| 5 · Explain the diff | What changed, why there, the key idea, invariants and failure modes |
| 6 · Check ✋ | Three questions that test transfer, not recall |
| 7 · Lessons | 1–3 *transferable* lessons in a short learning log |

✋ marks a checkpoint where the agent hands the turn back to you. You can always say "skip".

**Fading:** on the first encounter with a topic the agent does about 80% of the work. By the third, you implement and it reviews.

## Install

### Any coding agent (via [`npx skills`](https://github.com/vercel-labs/skills))

This is the recommended install. It works in Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, Windsurf, Amp, Cline and [the other agents `skills` supports](https://github.com/vercel-labs/skills#supported-agents).

```bash
# Current project, for the agents detected on this machine
npx skills add cyyeh/jit-learning-loop

# Globally, for every agent you use
npx skills add cyyeh/jit-learning-loop -g

# Only for specific agents
npx skills add cyyeh/jit-learning-loop -a claude-code -a codex -a cursor
```

Update later with `npx skills update jit-learning-loop`.

### Claude Code plugin (alternative)

In Claude Code you can also install it as a plugin:

```text
/plugin marketplace add cyyeh/jit-learning-loop
/plugin install jit-learning-loop@jit-learning-loop
```

### Local development (symlink)

```bash
./scripts/install.sh                   # Claude Code: ${CLAUDE_CONFIG_DIR:-~/.claude}/skills
./scripts/install.sh <skills-dir>      # any other agent's skills directory
```

This links `skills/jit-learning-loop` into the skills directory, so edits here take effect immediately. To install a copy instead, `npx skills add ./ -a <agent>` installs from your local checkout.

## Use

It triggers on its own when you signal that you want to learn along the way:

```text
I've never used Kafka. Our consumer sends duplicate emails after deploy. Help me fix it, but I want to understand it.
我第一次碰 k8s，pod 一直 restart，幫我查，我想邊做邊學
Here's my plan for the N+1 fix. Check my reasoning before I do it?
```

Or invoke it by name: `/jit-learning-loop` in Claude Code, `$jit-learning-loop` in Codex, or your agent's equivalent. You can also set the level ("level 2 on this one").

## Repo layout

```text
skills/jit-learning-loop/    the skill (what `npx skills add` installs)
  SKILL.md                   loaded when triggered
  references/                loaded on demand
    unknown-types.md         signals, strategies and traps for each unknown type; fundamentals list
    after-the-checkpoint.md  steps 4-7 in full, read before any of them (after the first checkpoint, an urgent fix, or a lessons request)
    fading.md                assistance levels, how to choose one, worked example
    learning-log.md          template, local vs. transferable, examples
  scripts/                   optional helpers (Node, no deps)
    learning-log.mjs         look up past entries and levels; check or add an entry
    installed.mjs            which version of a library the project really has, and where its source is
  agents/openai.yaml         optional Codex / ChatGPT display metadata
.claude-plugin/              optional Claude Code plugin + marketplace manifests
evals/
  evals.json                 test prompts + expectations for skill-creator runs
  files/                     fixtures: checkout race, k8s OOMKilled, Django N+1, Kafka duplicates
docs/
  methodology.zh-TW.md       the source essay this skill was distilled from (Traditional Chinese)
  methodology.en.md          English translation of the essay
demo/                        recorded sessions + GitHub Pages site (one folder per scenario, eval snapshot)
scripts/
  validate.mjs               Agent Skills spec check (no dependencies; runs in CI)
  learning-log.test.mjs      tests for the skill's helpers (run in CI)
  installed.test.mjs
  install.sh                 dev symlink installer (any agent's skills directory)
```

## Developing the skill

```bash
node scripts/validate.mjs                    # spec check: name, description and body length, YAML safety, reference paths
node --test scripts/*.test.mjs              # tests for the skill's helper scripts
npx skills add . --list                      # confirm the skills CLI discovers it
```

CI runs all three on every push. See [AGENTS.md](AGENTS.md) for how to iterate with `skill-creator`: run the evals with and without the skill, review the outputs in the viewer, and revise.

## License

[Apache-2.0](LICENSE) © 2026 Jimmy Yeh
