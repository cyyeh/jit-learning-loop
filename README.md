# jit-learning-loop

A Claude Code skill for **learning what the task needs, while doing the task.**

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

**Option A: symlink (best while developing the skill)**

```bash
./scripts/install.sh
```

This links `skills/jit-learning-loop` into `${CLAUDE_CONFIG_DIR:-~/.claude}/skills/`, so edits here take effect immediately.

**Option B: as a plugin**

```text
/plugin marketplace add /Users/cyyeh/Desktop/jit-learning-loop
/plugin install jit-learning-loop@jit-learning-loop
```

Once it's pushed to GitHub, anyone can install it with `/plugin marketplace add <owner>/jit-learning-loop`.

## Use

It triggers on its own when you signal that you want to learn along the way:

```text
I've never used Kafka. Our consumer sends duplicate emails after deploy. Help me fix it, but I want to understand it.
我第一次碰 k8s，pod 一直 restart，幫我查，我想邊做邊學
Here's my plan for the N+1 fix. Check my reasoning before I do it?
```

Or call it directly with `/jit-learning-loop`, and set the level if you like ("level 2 on this one").

## Repo layout

```text
.claude-plugin/          plugin + marketplace manifests
skills/jit-learning-loop/
  SKILL.md               the skill (loaded when triggered)
  references/            loaded on demand
    unknown-types.md     signals, strategies and traps for each unknown type; fundamentals list
    fading.md            assistance levels, how to choose one, worked example
    learning-log.md      template, local vs. transferable, examples
evals/
  evals.json             test prompts + expectations for skill-creator runs
  files/                 fixtures: checkout race, k8s OOMKilled, Django N+1, Kafka duplicates
docs/
  methodology.zh-TW.md   the source essay this skill was distilled from
scripts/install.sh       symlink installer
```

## Developing the skill

See [CLAUDE.md](CLAUDE.md) for how to iterate with `skill-creator`: run the evals with and without the skill, review the outputs in the viewer, and revise.
