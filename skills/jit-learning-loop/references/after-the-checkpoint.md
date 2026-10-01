# After the checkpoint: steps 4–7

Read this before any of steps 4–7, whenever they come:

- **The user answered the step-3 checkpoint, or said "skip".** Start at step 4.
- **Something is on fire.** Read it before the fix: step 4's rules hold under pressure too. Give a one-line "why" per step, then run steps 5–7 as a debrief once things are stable.
- **They ask what to take away from finished work.** Go to step 7, using step 5's lens (key idea, invariants, failure modes) to find the lessons.

Later turns run: evidence vs. prediction → the change → the diff explained → three questions → lessons. Use short headings so each phase is easy to scan, and keep each one tight: faster than a tutorial, and more left behind than a bare fix.

## 4. Investigate and implement

**At level 2 or 3, their checkpoint answer is a plan.** Critique it first (what's right, what's missing, what would break, with a hint before naming what's missing) and let them revise. Then build their version together, or at level 3 let them build it while you review with questions ("what happens if this runs twice?") before corrections. Don't swap in your own design.

Otherwise, work at full speed; this is where the agent's productivity belongs. Run the experiment or gather the evidence, then compare it with their prediction: where it matched, where it didn't, and why the difference is interesting. A wrong prediction is the most informative moment of the task, so name exactly which part of their model it corrects. Say which hypotheses the evidence ruled out and which one survived.

Then make the smallest change that fixes the problem, with tests as usual. If there's a better fix than the one the user or a teammate suggested (say, an idempotency key instead of a distributed lock), raise it with the trade-off. Don't quietly swap it in.

Before calling it done (once any urgent mitigation is out), prove the new test catches the bug: it must fail without the fix, on its own assertion rather than an import error, and pass with it. A test that passes either way tests nothing, and the red-then-green pair is the user's evidence that the fix works, not just yours. At level 3, ask them to show you the pair instead.

In a git repo where the fix's files hold nothing but the fix, stash just those files under a name (`--include-untracked` covers a file the fix created), check the stash is really there, and only then go on:

```bash
git stash push --include-untracked -m red-check -- <fix files>
git stash list -1
<test command> <new test>
git stash pop
<test command>
```

`git stash list -1` must show `red-check`. If it doesn't, nothing was stashed: stop, because the next `pop` would apply the user's own stash. Never pop a stash you didn't just create, and if `pop` reports a conflict, stop and tell the user (the stash is kept). With no git, or the user's own edits in those files: copy the fixed files aside, undo the fix, run the test, then copy them back. Report both results.

## 5. Explain the diff

Don't walk through whole files. Explain only what changed, as if they'll have to maintain it six months from now:

1. **What changed:** which files and places, briefly. `git status --short` lists them, new files included; leave out anything that was already changed before you started.
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

Keep only lessons that would make a **different** problem faster next time. "The lock lives in `payments/checkout.py`" is local; "releasing a lock needs an ownership check" transfers. Write the lessons in the user's language, but keep the field names (`Task:`, `Learned:`, `Level:`...) in English so the next agent and the script can read them. If they handled the checkpoints well, suggest moving up a level in the `Level:` line (`fading.md` has the signals).

Always show the entry. Write it to a log only if the user keeps one or agrees to start one; ask once where it lives (`LEARNING_LOG.md` in the repo root is a sensible default). To add it to their log, write the entry without its `##` line to a temporary file outside the repo (a file, not `echo`, so the shell can't run backticks in the lessons), run `add`, then delete the file. `add` checks the entry first. If you're only showing it and unsure of the format, `check` runs the same checks without writing anything. Without Node, check the format by eye and add it at the top of the log by hand.

```bash
node <skill-dir>/scripts/learning-log.mjs add --log LEARNING_LOG.md --topic "Redis lock / check-then-act race" --file <entry-file>
node <skill-dir>/scripts/learning-log.mjs check --file <entry-file>
```

`learning-log.md` (next to this file) has the template, more examples, the local-vs-transferable test, and what the script checks.
