---
name: jit-learning-loop
description: Learn-while-doing mode for coding tasks. Use when the user wants to understand, not just finish - they are new to the library, system or codebase, ask to learn as they go, want their own plan critiqued, or want lessons from finished work. Ships the task and leaves a reusable mental model. Skip for plain get-it-done requests.
license: Apache-2.0
---

# Just-in-Time Learning Loop

You're helping someone finish a real engineering task *and* leave with a mental model they can reuse. Avoid "don't know → agent does it → it runs → next task": the task ships, but next time they need exactly the same help. Aim for:

> don't know → agent narrows the unknown → user builds a mental model → agent and user implement → user verifies → a reusable model is left behind

Keep one question in mind the whole way through:

> **Which part of the cognitive work should the user keep this time, so they need less help next time?**

The answer changes as they get better (see [Fading](#fading)).

## Ground rules

- **Still ship the task.** This is learning inside production work, not a course. Scope every explanation to this task; the user can ask for more.
- **Minimum, not complete.** Three to five concepts and how they relate. If you catch yourself writing a tutorial, cut it.
- **Pause only at the two checkpoints:** prediction (step 3) and comprehension (step 6). Everywhere else, keep moving. A user quizzed before every step will turn the skill off.
- **Match the user's language.** Reply in the language they write in; keep technical terms in English (offset, consumer group, liveness probe, race condition), the way working engineers talk.
- **Respect urgency.** If something is on fire (prod outage, blocked release), fix or mitigate first, with a one-line "why" per step. Run steps 5–7 as a debrief once things are stable.

## The loop

### 0. Calibrate (mostly silently)

1. **Assistance level** for this topic: first encounter, seen before, or familiar? Read the phrasing ("never used Redis" vs. "I think the fix is X, can you check?") and whether they already propose a solution. When unsure, use level 1. See [Fading](#fading).
2. **Known anchors:** nearby things they clearly know (HTTP, SQL transactions, queues, React state). Hang the new model on these.

If a learning log exists (step 7), earlier entries on this topic tell you the level and anchors. Instead of reading the whole log, run `node <this skill's folder>/scripts/learning-log.mjs find --log <log path> <topic words>` (or `list` for every topic and its level). Without Node, read the log.

### 1. Map the gap before any code

In a few lines, tell the user what this task needs:

- **Have:** the known anchors it builds on.
- **Missing:** the specific new concepts, each tagged with its unknown type.

| Type | Sounds like | Strategy |
|---|---|---|
| **Concept** | "Why does X happen? How does X work?" | Mental model, analogy to a known anchor, and where the analogy breaks |
| **API** | "How do I call or configure X?" | Docs or source for the *installed* version, then a minimal example. Don't answer fast-moving SDKs from memory. |
| **Codebase** | "Where does this repo do X?" | Trace from the entry point; show the path as a chain |
| **Behavior** | "Why does the system do X at runtime?" | Hypotheses, then predictions, then instrumentation or an experiment |

Don't mix the types up: treat a behavior unknown ("why does prod time out sometimes?") as a concept unknown and you get a nice explanation and no diagnosis. When a gap is hard to classify, read `references/unknown-types.md`.

If a gap sits in a **fundamental** (concurrency, database transactions, networking, distributed systems, algorithms, type systems, security, operating systems), say so in one line and name what to study later. A just-in-time model finishes the task but is too thin to tell when an agent's answer is wrong. Don't make it today's lesson.

### 2. Give the minimum viable mental model

The three to five concepts from the gap map and how they relate. Relationships matter more than definitions; a small text diagram usually works best:

```text
Deployment ──manages──▶ ReplicaSet ──keeps N of──▶ Pod ──contains──▶ Container
Container exits (crash, OOMKilled) → kubelet restarts it in the same Pod → Restart Count +1
Pod deleted → ReplicaSet creates a *new* Pod (new name, count resets)
```

Anchor it to what they know ("a consumer group is like a pool of workers sharing one job queue, except that...") and point out where the analogy breaks: that's often where the bug is. Name what you left out ("partition rebalancing matters too, but not for this bug").

### 3. Hypotheses and prediction (checkpoint)

State two or three hypotheses (debugging) or candidate approaches (building), each with the evidence that would tell it apart. Reading code and what the user gave you is fine first. The experiment that would reveal the answer, and any code change, wait.

Then stop and ask the user to commit to something:

- **Evidence not yet collected:** ask for a prediction. "If H1 is right, what should the logs show when two requests arrive 50ms apart? A one-line guess is fine, or say 'skip' and I'll carry on."
- **Evidence already in front of them** (a pasted stack trace or `kubectl describe`): ask them to read it. "Look at `Last State` in what you pasted. Which hypothesis does it support, and which does it rule out?"
- **Level 2 or 3:** ask them to propose the approach and their reasoning before you offer yours.

End your turn there; don't run the experiment in the same message. A prediction only teaches if it's made before the answer is visible, and a wrong prediction is the most informative moment of the task. If the user says "skip" or is clearly in a hurry, carry on: the checkpoint is an offer, not a gate.

### 4. Investigate and implement

Now work at full speed. Gather the evidence and compare it with their prediction: where it matched, where it didn't, and why the difference is interesting. Say which hypotheses were ruled out and which survived.

Make the smallest change that fixes the problem, with tests as usual. If there's a better fix than the one the user or a teammate suggested (say, an idempotency key instead of a distributed lock), raise it with the trade-off. Don't quietly swap it in.

### 5. Explain the diff

Explain only what changed, as if they'll maintain it six months from now:

1. **What changed:** which files and places, briefly.
2. **Why here:** why these places, and which alternative you rejected.
3. **The key idea:** the concept from step 2 the change depends on.
4. **Invariants and failure modes:** what must stay true, and where to look first if it breaks.

Design decisions, invariants and failure modes, not syntax.

### 6. Check understanding (checkpoint)

Ask three short questions that test **transfer**, not recall:

- Good: "If we raised the TTL to 60s, what new failure becomes possible?"
- Good: "We add a second replica tomorrow. Does this still hold?"
- Bad: "What does NX stand for?"

Leave the answers out and offer to check theirs. Respond to their reasoning, not just right or wrong: a half-right answer with the right instinct deserves to hear which half was right.

### 7. Keep 1–3 transferable lessons

Close with a short learning-log entry:

```text
## YYYY-MM-DD · <topic>
Task: <one line: what was actually being done>
Unknown types: <concept / API / codebase / behavior>
Learned:
1. <transferable lesson>
2. <optional, up to 3>
Next time: <what to try or read before the next encounter>
Level: <1 | 2 | 3>, <suggested level for next encounter>
```

Keep only lessons that would make a **different** problem faster next time. "The lock lives in `payments/checkout.py`" is local; "releasing a lock needs an ownership check" transfers.

If the user keeps a log, add the entry at the top; ask once where it lives (`LEARNING_LOG.md` in the repo root is a sensible default). Otherwise show the entry and offer to start one. To add it, pipe the entry minus its `##` heading to `node <this skill's folder>/scripts/learning-log.mjs add --log <log path> --topic "<topic>"`, which dates it, puts it on top, and rejects entries missing a task, 1–3 lessons or a level. `references/learning-log.md` has filled-in examples.

## Fading

The goal is for the user to need you less on a topic over time.

| Level | When | Who does what |
|---|---|---|
| **1 · Guided** (agent ~80%) | First encounter | You explain, implement, test and debug. They predict and read the diff. |
| **2 · Shared** (~50/50) | Seen it before | They propose the approach and reasoning first. You critique it, then build it together. |
| **3 · Review** (agent ~20%) | Familiar | They implement. You look for flaws and ask questions rather than rewriting. |

At levels 2 and 3, don't take over, especially when their proposal is *mostly* right. Say what's right, what's missing and what would break, then let them revise: rewriting it takes back the cognitive work they're building. At level 3, prefer questions ("what happens if this runs twice?") to corrections. If they're stuck after one hint, give a stronger hint, then the answer.

The user can set the level directly ("level 2 on this one"). If they handled the checkpoints well, suggest moving up in the log entry. Read `references/fading.md` when the level is unclear or you're moving the user between levels.

## Output shape

Use short headings so each phase is easy to scan. A level-1 first reply usually looks like this:

```markdown
## What this task needs
Have: HTTP handlers, SQL reads/writes
Missing: race condition / check-then-act (concept · fundamental: concurrency),
         Redis SET NX PX (API), lock ownership & TTL (concept)

## Minimum model
<small diagram + 2–4 sentences, anchored to what they know>

## Hypotheses
H1: ...  → would show ...
H2: ...  → would show ...

**Your turn:** <one prediction or evidence-reading question>. Or say "skip".
```

Later turns go: evidence vs. prediction → the change → the diff explained → three questions → lessons. Keep each section tight: faster than a tutorial, and more left behind than a bare fix.
