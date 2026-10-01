# The four types of unknown

Read this when a task's gaps are hard to classify, or when a task mixes several types.

Most tasks contain more than one type. Tag each gap separately. Codebase and API gaps are usually cheap to close, so handle them inline. Concept gaps get the mental model (step 2). Behavior gaps drive the hypothesis-and-prediction checkpoint (step 3).

## Contents

- [Concept unknown](#concept-unknown)
- [API unknown](#api-unknown)
- [Codebase unknown](#codebase-unknown)
- [Behavior unknown](#behavior-unknown)
- [Fundamentals vs. just-in-time topics](#fundamentals-vs-just-in-time-topics)

---

## Concept unknown

**Sounds like:** "Why does this async function have a race condition?" "What's the difference between a Pod and a container?" Or the user is surprised by behavior that is actually by design.

**Strategy:**
1. Find the nearest known anchor ("you know DB transactions, so...").
2. Build the model as relationships, not definitions: a small diagram or a chain of cause and effect.
3. Name the spot where the analogy to the anchor breaks. The bug or the design decision usually lives there.

**Leave to the user:** predicting consequences. "Given this model, what happens if two consumers are in the same group?"

**Trap:** over-explaining. Stop at three to five concepts. Name the next layer down without teaching it.

**Example:** First time using Kafka, duplicates after deploy.
- Anchor: a job queue with workers.
- Where it breaks: messages aren't removed when read. Each consumer group keeps its own *offset*, a bookmark, and commits it separately from processing. Anything processed after the last commit gets processed again after a restart.

---

## API unknown

**Sounds like:** "How do I configure tool calling in the latest SDK?" "What's the flag for X?" "How do I do Y with library Z?"

**Strategy:**
1. Check which version is actually installed before answering. `installed.mjs` looks in the project's `node_modules`, Python environment (its `.venv` first), `go.mod` and `Cargo.lock`, and prints the version and where its source is on disk; if nothing is installed, the version a lockfile or `requirements.txt` pins:

   ```bash
   node <skill-dir>/scripts/installed.mjs kafka-python --in <project-dir>
   ```

   No Node, or another ecosystem: read the lockfile, or ask which version they run.
2. Read the docs or source for *that* version (the printed source path is the code that will actually run). SDKs move fast, and answering from memory produces confident code for an API that no longer exists.
3. Give a minimal runnable example, then adapt it to the task.

**Leave to the user:** a link to the exact doc page or source file you used, so they learn where the answer lives, not just what it is.

**Trap:** version drift, and inventing parameters. If you can't check the docs, say so.

**Transfer value:** usually low. The specific API is local knowledge. What transfers is the *shape*: "most Kafka clients auto-commit on a timer by default; check that first".

---

## Codebase unknown

**Sounds like:** "Where does this repo set up the connection pool?" "What calls this function?" "How is auth wired in here?"

**Strategy:**
1. Explore: grep, trace imports, follow the entry point.
2. Show the path as a chain, not a directory dump: `route /orders → OrdersController.list → OrderService.query → OrderRepo (uses a shared pool from db/pool.ts)`.
3. Name the repo's *conventions* ("services never touch the ORM directly; repos do"). Conventions are the part that helps with the next change.

**Leave to the user:** at level 2 or higher, ask them to guess where it lives before you show them. A wrong guess tells you (and them) which convention they're missing.

**Trap:** treating codebase knowledge as transferable. File locations are local. The architectural pattern (unit of work, hexagonal layering, the event-sourcing layout) *can* transfer. Log only that part.

---

## Behavior unknown

**Sounds like:** "sometimes", "only in prod", "intermittent", "after deploy", "under load", "it worked yesterday".

**Strategy:** this is where engineering happens: model → prediction → experiment.
1. State two or three hypotheses, each grounded in the model from step 2.
2. For each, name the evidence that would tell it apart: a log line, a metric, a query plan, a timing pattern.
3. Get the user's prediction (checkpoint), then instrument or experiment.
4. Say which hypotheses the evidence ruled out. A ruled-out hypothesis is progress too.

**Leave to the user:** the prediction, and reading the evidence. If they already pasted evidence (a stack trace, `kubectl describe`, a slow-query log), ask them to interpret it before you do.

**Trap:** going from a plausible explanation straight to a fix without evidence. Plausible explanations are cheap. If the fix "works" but you never confirmed the cause, say so plainly.

**Example:**

```text
Hypothesis: two concurrent requests read the same old state.
Prediction: both log lines show the same version number.
Test: fire two requests 50ms apart; inspect the SQL trace.
```

---

## Fundamentals vs. just-in-time topics

Some topics suit on-the-fly learning. For them, a minimum model built during the task is usually enough:

- a new library or SDK
- framework APIs
- repo architecture
- unfamiliar tooling
- deployment procedures

Others deserve a deeper foundation, because if the base model is thin, the user can't tell when an agent's answer is wrong:

- concurrency
- database transactions and isolation
- networking
- distributed systems
- algorithms and complexity
- type systems
- security
- operating systems

When a gap lands in the second group, still give the minimum model and finish the task. Then add one line such as: "This sits on a fundamental (transaction isolation). Today's model is enough for this fix, but it's worth a proper read before you rely on it; <pointer>." Suggest something concrete: a chapter, a paper, or a classic talk. Don't turn the task into that study session.
