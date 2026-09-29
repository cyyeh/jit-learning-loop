# The just-in-time learning loop (original methodology)

> English translation of [`methodology.zh-TW.md`](methodology.zh-TW.md), the source text the skill was distilled from. The skill (`skills/jit-learning-loop/`) is the operational version; this file is kept for provenance and for re-deriving the skill if it drifts. Where the two differ, the Traditional Chinese original is authoritative.

---

Yes, and I'd argue that **one of the most important learning skills in the age of agentic coding is learning exactly what you need, in the middle of solving the problem**, instead of learning an entire technology before you start.

The key is not to let the process become:

> don't know → agent does it for me → it runs → next task

but instead:

> don't know → agent helps me narrow down the unknown → I build a mental model → agent and I implement it together → I verify → I'm left with a model I can transfer

You could call this the **just-in-time learning loop**.

## The 6 steps I recommend most

### 1. First, identify what exactly you don't understand

The most dangerous state in agentic coding isn't not knowing. It's this:

> I don't know which parts I don't know.

So when you hit an unfamiliar task, don't open with:

> implement this for me

Ask first:

> Which concepts do I need to understand to get this done?
> Which of them extend technology I already know, and which need a new mental model?
> Don't write code yet.

For example, the first time you touch Kafka, you don't need to "learn Kafka."

You might only need to know:

```text
What I already know:
HTTP request
DB transaction
queue

What I'm missing:
consumer group
offset
partition
delivery semantics
```

The agent's first role is:

**knowledge gap detector**.

---

## 2. Ask the agent for a "minimum sufficient model," not a full tutorial

This matters a lot.

Don't ask:

> Teach me Kubernetes.

Ask:

> I'm debugging a Kubernetes pod restart.
> Tell me only the 3–5 concepts I must know to finish this task, and how they relate to each other.

The goal isn't breadth. It's:

> **minimum viable mental model**

For example:

```text
Pod
 ↓ contains
Container
 ↓ exits
Restart policy
 ↓ triggers
Kubelet restart

But if the Deployment controller notices the Pod no longer exists
 ↓
it creates a new Pod
```

Once you have this picture, go into the code and config.

It works far better than swallowing fifty pages of documentation at once.

---

# 3. Before the agent acts, make a prediction

In my view this is the most overlooked step, and the one with the biggest learning payoff.

The agent says:

> The problem is probably transaction isolation.

Don't just say:

> fix it.

First make yourself answer:

> If this explanation is right, what do I expect to see?

For example:

```text
Hypothesis:
Two concurrent requests read the same old state.

Prediction:
Both logs should show the same version number.

Test:
Run two requests concurrently and inspect SQL trace.
```

Then let the agent run the test for you.

At that point you're doing real engineering:

> model → prediction → experiment

rather than:

> prompt → code.

---

# 4. Let the agent write the code, but you own "reading the delta"

You don't have to write every line from scratch.

Letting the agent write code is where agentic coding's biggest productivity gain comes from in the first place.

But don't read the whole repo.

Read only:

> **What changed and why?**

After each change the agent makes, always answer four questions:

```text
1. What changed?
2. Why these places?
3. What's the most important new concept?
4. If this breaks, where would I look first?
```

You can even ask the agent directly:

> Explain this diff to me as if I need to maintain it six months later. Focus on design decisions, invariants and failure modes, not syntax.

What you learn is architecture, not tokens.

---

# 5. Gradually take the agent away

This closely mirrors **scaffolding / fading** in education.

The first time:

```text
Agent 80%
Human 20%
```

The agent:

- explains
- writes the code
- writes the tests
- debugs

You understand.

The second time you hit a similar problem:

```text
Agent 50%
Human 50%
```

You propose a solution first and let the agent critique it.

The third time:

```text
Human 80%
Agent 20%
```

You do it; the agent reviews.

For example, learning React Server Components for the first time:

### First time

> Explain and implement it.

### Second time

> I think this component should be a server component, because of A/B/C. Review my reasoning.

### Third time

Do it yourself and only ask:

> Find flaws in this implementation.

Only then is the agent **accelerating skill acquisition**.

Otherwise it's only accelerating task completion.

---

# 6. At the end of each task, extract just 1–3 transferable lessons

Don't write long notes.

A learning log for agentic coding can be very short:

```text
Task:
Fix Redis race condition

Learned:
1. SET NX can implement simple locking.
2. Lock ownership matters when releasing.
3. TTL prevents dead locks but introduces lease-expiry races.

Next time:
Consider Redlock / fencing token for stronger guarantees.
```

The most important question is:

> **Next time I hit a different problem, will I be faster because of what I learned today?**

If the answer is:

> I know which file in this repo to change

that's local knowledge.

If the answer is:

> I know the invariants of a distributed lock

that's transferable knowledge.

Make a point of keeping the latter.

---

# Going further: sort your unknowns into four types

In agentic coding, I now suggest engineers first decide which type of unknown they're facing.

| Unknown | Most effective way to use the agent |
|---|---|
| **Concept unknown** | explain / analogy / mental model |
| **API unknown** | docs search / minimal example |
| **Codebase unknown** | repo exploration / dependency tracing |
| **Behavior unknown** | hypothesis / instrumentation / experiment |

Don't mix these four up.

For example:

> Why does this async function have a race condition?

That's probably a **concept unknown**.

> Where does this repo initialize the connection pool?

That's a **codebase unknown**.

> How do I configure tool calling in the latest OpenAI SDK?

That's an **API unknown**.

> Why does production occasionally time out?

That's a **behavior unknown**.

Each type calls for a completely different learning strategy.

---

# One agent prompt pattern I especially recommend

You can change your usual:

> Fix this bug.

into:

```text
Help me solve this, but optimize for both task completion and learning.

First:
1. Identify what I likely need to understand.
2. Give me the minimum mental model.
3. State 2–3 hypotheses.

Then:
4. Show me what evidence would distinguish them.
5. Investigate the codebase.
6. Propose the smallest change.

After implementation:
7. Explain the diff.
8. Give me 3 questions that test whether I actually understand it.
```

This pattern works very well.

Because the agent is no longer just a:

**coder**

but also a:

**teacher + researcher + reviewer**.

---

# But there's a bigger shift in mindset

The traditional way engineers learn looks more like:

```text
Study
 ↓
Understand
 ↓
Practice
 ↓
Build
```

In the age of agentic coding it can become:

```text
Build
 ↓
Encounter unknown
 ↓
Learn minimum model
 ↓
Experiment
 ↓
Implement
 ↓
Reflect
 ↓
Generalize
 ↓
Continue building
```

In other words:

## **Learning becomes embedded inside production.**

You don't have to finish learning Kubernetes, Rust, DuckDB internals or the React compiler before you start.

You can learn at the moment the real problem shows up.

---

## But there's one very important boundary

Some things suit **on-the-fly learning**:

- a new library
- a new SDK
- framework APIs
- repo architecture
- unfamiliar tooling
- deployment procedures

Others deserve a deeper foundation:

- concurrency
- database transactions
- networking
- distributed systems
- algorithms
- type systems
- security
- operating systems

Because if your underlying mental model is too thin, you won't even be able to tell:

> where the agent's answer stops making sense.

So the ideal model isn't:

> **Just-in-time learning replaces fundamentals**

but:

> **Fundamentals + Just-in-time specialization**

---

### In one sentence

In the age of agentic coding, learning effectively isn't about asking:

> **"Should I let the agent help me?"**

It's about asking, every time:

> **"Which part of the cognitive work should I keep for myself this time, so that while I finish this task, I won't need the same level of help next time?"**

This is really **learning agency**, a skill well worth training in the age of agents. It matters especially for senior engineers, because what becomes scarce in the future may not be "knowing the most technologies," but **how quickly you can build a correct mental model after entering an unfamiliar domain and start working effectively**.
