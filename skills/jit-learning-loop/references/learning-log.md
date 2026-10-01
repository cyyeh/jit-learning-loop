# Learning log

Read this when writing the step-7 entry, setting up a log for the first time, or when the helper script's behavior needs explaining.

The log should be *short*. A long note is written once and never read again. A three-line entry gets reread the next time the topic comes up, and that is also when you (the agent) use it to calibrate the assistance level.

## Template

```text
## YYYY-MM-DD · <topic>
Task: <one line: what was actually being done>
Unknown types: <concept / API / codebase / behavior>
Learned:
1. <transferable lesson>
2. <transferable lesson>
3. <optional>
Next time: <what to try or read before the next encounter>
Level: <1 | 2 | 3>, <suggested level for next encounter>
```

## Transferable or local?

Ask of every lesson: **"Next time I hit a *different* problem, will I be faster because I learned this?"**

| Local (mention it, don't log it as a lesson) | Transferable (log it) |
|---|---|
| "The lock is in `payments/checkout.py`" | "Check-then-act across concurrent requests is a race" |
| "Our Kafka topic is `invoices`" | "Auto-commit on a timer means at-least-once. Handlers must be idempotent." |
| "Set `memory: 1Gi` in `deploy/orders.yaml`" | "Exit code 137 plus OOMKilled means the container went over its memory limit, not that the app crashed" |
| "Add `prefetch_related('items__product')` on line 12" | "An N+1 hides wherever a template walks a relation. Follow every `.` in the template." |

Local knowledge still matters for the current repo. If it's worth keeping, it belongs in the repo's docs or agent instructions file (AGENTS.md, CLAUDE.md and similar), not in a personal learning log.

## More examples

```text
## 2026-03-14 · Redis locking
Task: Stop double-charge when users double-click Pay
Unknown types: concept (race), API (SET NX PX)
Learned:
1. SET NX can implement a simple lock.
2. Release must check ownership, or you free someone else's lock.
3. A TTL prevents deadlock but introduces a lease-expiry race.
Next time: read about fencing tokens / Redlock for stronger guarantees.
Level: 1, try 2
```

```text
## 2026-05-02 · Kubernetes restarts
Task: orders-api pods restarting every ~20 min
Unknown types: concept (Pod vs container lifecycle), behavior (why restarts)
Learned:
1. Restart Count goes up when the *container* restarts inside the same Pod. A new Pod name means the controller replaced the Pod.
2. `Last State: Terminated / OOMKilled / 137` means the kernel killed it for going over the memory limit. Look at the memory trend, not the app logs.
3. Liveness probe failures can be a *symptom* of memory pressure (GC pauses), not a separate cause.
Next time: `kubectl top pod` plus the memory graph before touching any config.
Level: 1, try 2
```

## Where the log lives

Ask the user once. Reasonable defaults:

- **Per repo:** `LEARNING_LOG.md` at the repo root, if the team is happy to share lessons.
- **Personal, across projects:** a single file the user names (for example `~/notes/learning-log.md`). This is better for fading, because topics recur across repos.

Append new entries at the top so the most recent is read first. Don't reorganize or rewrite old entries unless asked.

## The helper script

`scripts/learning-log.mjs` in this skill's folder handles the mechanical parts (Node 18+, no dependencies). `--log` defaults to `LEARNING_LOG.md` in the current directory. Without Node, do the same by hand.

Step 0, what does the log already say about this topic?

```bash
node <skill-dir>/scripts/learning-log.mjs list --log LEARNING_LOG.md              # every topic and its level
node <skill-dir>/scripts/learning-log.mjs find --log LEARNING_LOG.md redis lock   # matching entries, best first, suggested level
```

`find` matches any of the words, so pass a few (`redis lock race`). English words match at word starts ("lock" finds "locking", not "blocking"); other scripts match anywhere. It can't judge relevance or translate: if nothing matches, `list` the topics and decide yourself whether one is related.

Step 7, add the entry. Write it to a temporary file outside the repo, with no `##` line (the script adds `## <date> · <topic>`), and delete the file afterwards:

```text
Task: Stop double-charge when users double-click Pay
Unknown types: concept (race), API (SET NX PX)
Learned:
1. Check-then-act across concurrent requests is a race, whatever the language or framework.
2. Release must check ownership, or you free someone else's lock.
Next time: read about fencing tokens before the next lock.
Level: 1, try 2
```

```bash
node <skill-dir>/scripts/learning-log.mjs add --log LEARNING_LOG.md --topic "Redis locking" --file <entry-file>
```

Use `--file` rather than `echo` or a shell string, because the shell would run any backticks in the lessons. (The entry can also come on stdin through a quoted heredoc, `<<'EOF'`.) `add` creates the log if it's missing and inserts the entry above the newest one without changing anything else in the file. It refuses an entry with no `Task:`, no `Learned:`, zero or more than three numbered lessons, no level of 1–3, a `##` line inside it, or an identical copy already in the log. Only dated `## YYYY-MM-DD · ...` headings count as entries, so a `## How to use this log` section or a fenced template in the header is left alone. If some entries lack their own dated heading, `list` and `find` say so and `add` refuses to guess where "newest first" goes; give those entries headings first. Keep the field names (`Task:`, `Learned:`, `Level:`) in English even when the lessons are in another language, so the script and the next agent can read them.
