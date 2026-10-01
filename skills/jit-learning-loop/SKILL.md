---
name: jit-learning-loop
description: Learn-while-doing mode for coding tasks. Use when the user wants to understand, not just finish - new to the library, system or codebase, asking to learn as they go, wanting their own plan or code critiqued so they learn, or wanting lessons from finished work. Ships the task and leaves a reusable mental model. Skip for plain get-it-done requests.
license: Apache-2.0
---

# Just-in-Time Learning Loop

Help someone finish a real engineering task *and* leave with a reusable mental model, so next time they need less help. One question drives every step: **which part of the cognitive work should the user keep this time?**

## Ground rules

- **Ship the task.** Learning inside real work, not a course: three to five concepts, scoped to this task. If it reads like a tutorial, cut it.
- **Pause only at the two checkpoints:** prediction (step 3) and comprehension (step 6). Keep moving everywhere else.
- **Match the user's language;** keep technical terms in English (offset, liveness probe, race condition).
- **Respect urgency.** Prod on fire: fix or mitigate first, one-line "why" per step, steps 5–7 as a debrief.

## Levels

Help should fade on a topic over time. Levels belong to a topic, not a person; the user can set one ("level 2 on this").

| Level | When | Who does what |
|---|---|---|
| **1 · Guided** | First encounter | You explain, implement and test. They predict and read the diff. |
| **2 · Shared** | Seen it before, or they bring a plan | They propose first. You critique their reasoning, then build together. |
| **3 · Review** | Familiar | They implement. You ask questions and find flaws, not rewrite. |

At levels 2–3, don't take over a mostly-right plan. Say what's right, what's missing and what would break; for what's missing, point to where to look before naming it. Stuck: a hint, a stronger hint, then the answer. Unclear level: read `references/fading.md`.

## The loop

### 0. Calibrate (silently)

Pick the level from their phrasing ("never used Redis" vs. "I think the fix is X, can you check?") and any plan they bring; when unsure, level 1. Note the anchors they know (HTTP, SQL, queues) to hang the new model on. A learning log's entries on this topic say where they left off; read it, or for a long log:

```bash
node <skill-dir>/scripts/learning-log.mjs find --log LEARNING_LOG.md redis lock   # entries + suggested level
node <skill-dir>/scripts/learning-log.mjs list --log LEARNING_LOG.md              # all topics, if find misses
```

### 1. Map the gap before any code

In a few lines: **Have** (the anchors this task builds on) and **Missing** (each new concept, tagged with its type).

| Type | Sounds like | Strategy |
|---|---|---|
| **Concept** | "How does X work?" | A model anchored to something known, and where the analogy breaks |
| **API** | "How do I call X?" | Docs or source for the *installed* version, then a minimal example |
| **Codebase** | "Where does this repo do X?" | Trace from the entry point, shown as a chain |
| **Behavior** | "Why does it do X at runtime?" | Hypotheses, predictions, then an experiment |

Treat a behavior unknown as a concept unknown and you get a nice explanation and no diagnosis. Hard to classify: read `references/unknown-types.md`. A gap in a **fundamental** (concurrency, transactions, networking, distributed systems, algorithms, type systems, security, OS) gets one line naming what to study later: fundamentals plus just-in-time, not instead.

### 2. Give the minimum viable mental model

The gap map's concepts and how they relate, usually as a small text diagram:

```text
Deployment ──manages──▶ ReplicaSet ──keeps N of──▶ Pod ──contains──▶ Container
Container exits (crash, OOMKilled) → kubelet restarts it in the same Pod → Restart Count +1
```

Anchor it to what they know ("a consumer group is like workers sharing a job queue, except...") and say where the analogy breaks; the bug often lives there. Name what you left out.

### 3. Hypotheses and prediction (checkpoint)

Two or three hypotheses (debugging) or approaches (building), each with the evidence that would tell it apart. Read the code and what they gave you; the revealing experiment and any code change wait. Then ask them to commit:

- **Evidence not collected yet:** a prediction. "If H1 is right, what do the logs show for two requests 50ms apart? A one-line guess is fine, or say 'skip'."
- **Evidence already pasted:** have them read it. "Look at `Last State`. Which hypothesis does it support, and which does it rule out?"
- **Level 2–3:** their approach and reasoning before yours.

End your turn there. A prediction only teaches if made before the answer is visible, so your model and hypotheses must leave it open; when it sits in evidence they pasted, reading it is the exercise. "Skip" or a hurry means carry on: the checkpoint is an offer, not a gate.

A level-1 first reply, every section tight:

```markdown
## What this task needs
Have: HTTP handlers, SQL reads/writes
Missing: check-then-act race (concept · fundamental: concurrency), Redis SET NX PX (API)

## Minimum model
<small diagram + 2–4 sentences, anchored to what they know>

## Hypotheses
H1: ...  → would show ...
H2: ...  → would show ...

**Your turn:** <one prediction or evidence-reading question>. Or say "skip".
```

### 4–7. After the checkpoint

When they answer or skip, read `references/after-the-checkpoint.md`, then:

4. **Investigate and implement** at full speed: evidence vs. their prediction, then the smallest fix with tests. Raise a better fix than the suggested one, with its trade-off.
5. **Explain the diff:** what changed, why there, the key idea, invariants and failure modes.
6. **Check understanding (checkpoint):** three transfer questions, answers left out.
7. **Keep 1–3 transferable lessons** in a learning-log entry, added with the script's `add`.
