# After the checkpoint: steps 4–7

Read this when the user has answered the step-3 checkpoint (or said "skip"), or when an incident is stable and it's time for the debrief. Later turns run: evidence vs. prediction → the change → the diff explained → three questions → lessons. Keep each section tight: faster than a tutorial, and more left behind than a bare fix.

## 4. Investigate and implement

Now work at full speed; this is where the agent's productivity belongs. Run the experiment or gather the evidence, then compare it with their prediction: where it matched, where it didn't, and why the difference is interesting. A wrong prediction is the most informative moment of the task, so name exactly which part of their model it corrects. Say which hypotheses the evidence ruled out and which one survived.

Then make the smallest change that fixes the problem, with tests as usual. If there's a better fix than the one the user or a teammate suggested (say, an idempotency key instead of a distributed lock), raise it with the trade-off. Don't quietly swap it in.

At level 2 or 3, the user proposed the approach; build it with them rather than replacing it. At level 3 they implement and you review: ask questions ("what happens if this runs twice?") before correcting.

## 5. Explain the diff

Don't walk through whole files. Explain only what changed, as if they'll have to maintain it six months from now:

1. **What changed:** which files and places, briefly.
2. **Why here:** why these places and not others, and which alternative you rejected.
3. **The key idea:** the one concept from the minimum model that the change depends on.
4. **Invariants and failure modes:** what must stay true for this to keep working, and where to look first if it breaks.

Design decisions, invariants and failure modes, not syntax.

## 6. Check understanding (checkpoint)

Ask three short questions that test **transfer**, not recall:

- Good: "If we raised the TTL to 60s, what new failure becomes possible?"
- Good: "We add a second replica tomorrow. Does this still hold?"
- Bad: "What does NX stand for?"

Leave the answers out, offer to check theirs, and end your turn. When they answer, respond to their reasoning, not just right or wrong. A half-right answer with the right instinct deserves to hear which half was right. If a quick experiment would settle an answer better than your word, run it.

## 7. Keep 1–3 transferable lessons

Close with a short learning-log entry:

```text
## 2026-03-14 · Redis lock / check-then-act race
Task: Stop double-charge when users double-click Pay
Unknown types: concept (race, lock ownership), API (Redis SET NX PX)
Learned:
1. Check-then-act across concurrent requests is a race, whatever language or framework.
2. SET NX + TTL gives a simple lock, but release must check ownership (a token) or you free someone else's lock.
3. TTL prevents deadlock but opens a lease-expiry race. For money, prefer idempotency at the DB level.
Next time: look at fencing tokens if a lock guards anything that must be exactly-once.
Level: 1, try level 2 on the next concurrency bug
```

Keep only lessons that would make a **different** problem faster next time. "The lock lives in `payments/checkout.py`" is local; "releasing a lock needs an ownership check" transfers. Write the lessons in the user's language, but keep the field names (`Task:`, `Learned:`, `Level:`...) in English so the next agent and the script can read them. If they handled the checkpoints well, suggest moving up a level in the `Level:` line.

If the user keeps a log, add the entry at the top; ask once where it lives (`LEARNING_LOG.md` in the repo root is a sensible default). Otherwise show the entry and offer to start one. To add it, write the entry without its `##` line to a temporary file outside the repo (a file, not `echo`, so the shell can't run backticks in the lessons), then:

```bash
node <skill-dir>/scripts/learning-log.mjs add --log LEARNING_LOG.md --topic "Redis lock / check-then-act race" --file <entry-file>
```

It adds the dated heading, puts the entry above the newest one without touching the rest of the file, and rejects an entry missing a task, 1–3 numbered lessons or a level. Delete the temporary file afterwards. Without Node, edit the log directly. `learning-log.md` (next to this file) has the template, more examples and the local-vs-transferable test in detail.
