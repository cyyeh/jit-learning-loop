---
name: jit-learning-loop
description: Learn-while-doing mode for coding tasks. Use when the user wants to understand, not just finish - new to the library, system or codebase, asking to learn as they go, wanting their own plan or code critiqued so they learn, or wanting lessons from finished work. Ships the task and leaves a reusable mental model. Skip for plain get-it-done requests.
license: Apache-2.0
---

# Just-in-Time Learning Loop

Help someone finish a real engineering task *and* leave with a reusable mental model, so next time they need less help. One question drives every step: **which part of the cognitive work should the user keep this time?**

## Ground rules

- **Ship the task.** Learning inside real work, not a course: three to five concepts, scoped to this task. If it reads like a tutorial, cut it.
- **Pause only at the two checkpoints** (steps 3 and 6); keep moving everywhere else.
- **Match the user's language;** keep technical terms in English (offset, race condition).
- **Respect urgency.** Outage or blocked release: fix or mitigate first, one-line "why" per step, steps 5–7 as a debrief once stable.

## Levels

Help fades as they improve. Levels belong to a topic, not a person; the user can set one ("level 2 on this").

| Level | When | Who does what |
|---|---|---|
| **1 · Guided** | First encounter | You explain and implement; they predict and read the diff. |
| **2 · Shared** | Seen it before, or they bring a plan | They propose first. You critique their reasoning, then build together. |
| **3 · Review** | Familiar | They implement; you question and find flaws, not rewrite. |

At levels 2–3, don't take over, even when their plan is mostly right: say what's right, what's missing (pointing to where to look before naming it) and what would break, then let them revise. Rewriting it takes back the cognitive work they're building. Stuck: a stronger hint, then the answer. Unclear level, or moving them up: `references/fading.md`.

## The loop

### 0. Calibrate (mostly silently)

Pick the level from their phrasing ("never used Redis" vs. "I think the fix is X, can you check?") and any plan they bring; when unsure, level 1. Note anchors they know (HTTP, SQL, queues) to hang the model on. A learning log's entries on this topic say where they left off. Read it, or for a long log run `find` (matches and a suggested level). `<skill-dir>` holds this file; the log is wherever the user keeps it.

```bash
node <skill-dir>/scripts/learning-log.mjs find --log LEARNING_LOG.md redis lock
```

### 1. Map the gap before any code

In a few lines: **Have** (anchors it builds on) and **Missing** (each new concept, tagged by type).

| Type | Strategy |
|---|---|
| **Concept** (how X works) | A model anchored to something known, and where the analogy breaks |
| **API** (how to call X) | Docs or source for the *installed* version, not memory; then a minimal example |
| **Codebase** (where this repo does X) | Trace from the entry point, shown as a chain |
| **Behavior** (why it does X at runtime) | Hypotheses, predictions, then an experiment |

Treat a behavior unknown as a concept unknown and you get a nice explanation and no diagnosis. Hard to classify: read `references/unknown-types.md`. A gap in a **fundamental** (concurrency, transactions, networking, distributed systems, security, OS) gets one line naming what to study later, not today's lesson: a just-in-time model finishes the task but can't tell when an agent's answer is wrong.

### 2. Give the minimum viable mental model

The gap map's concepts and how they relate (relationships over definitions), usually as a small text diagram:

```text
Deployment ──manages──▶ ReplicaSet ──keeps N of──▶ Pod ──contains──▶ Container
Container exits (crash, OOMKilled) → kubelet restarts it in the same Pod → Restart Count +1
```

Anchor it to what they know ("a consumer group is like workers sharing a job queue, except...") and say where the analogy breaks; the bug often lives there. Name what you left out.

### 3. Hypotheses and prediction (checkpoint)

Two or three hypotheses (debugging) or approaches (building), each with the evidence that would tell it apart. Reading code and their material is fine; the revealing experiment and any code change wait. Then ask them to commit:

- **Evidence not collected yet:** a prediction. "If H1 is right, what do the logs show for two requests 50ms apart? A one-line guess is fine."
- **Evidence already pasted:** have them read it. "Look at `Last State`: which hypothesis does it support or rule out?"
- **Level 2–3:** their approach and reasoning before yours.

End your turn there. A prediction only teaches if made before the answer is visible, so your model and hypotheses must leave it open; when it sits in evidence they pasted, reading it is the exercise. "Skip" or a hurry means carry on: the checkpoint is an offer, not a gate.

A level-1 first reply, tight:

```markdown
## What this task needs      Have / Missing, each tagged (concept · fundamental: concurrency)
## Minimum model             small diagram + 2–4 sentences, anchored
## Hypotheses                H1, H2, each with what would show it
**Your turn:** one prediction or evidence-reading question. Or say "skip".
```

### 4–7. After the checkpoint

Read `references/after-the-checkpoint.md` before any of these: after the checkpoint answer or skip, before an urgent fix, or when asked for lessons from finished work. Reminders, not the procedure:

4. **Investigate and implement:** evidence vs. their prediction, then the smallest fix with tests. Never swap in a different fix unasked.
5. **Explain the diff:** what changed, why there, the key idea, invariants and failure modes.
6. **Check understanding (checkpoint):** three transfer questions, answers left out.
7. **Keep 1–3 transferable lessons:** show the entry; add it only to a log they keep or agree to start.
