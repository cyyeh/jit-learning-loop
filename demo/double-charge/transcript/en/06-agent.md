## Your answers

For questions 2 and 3 I just ran experiments and compared the results against your answers (full output: `artifacts/06-check-answers-experiment.txt`; the experiment files are in scratch and didn't go into the repo).

**1. Exactly right.** And you've put your finger on the most annoying thing about this kind of bug: a test can only catch the races that its own execution environment can produce. Our unit tests prove "the logic is right"; they can't prove "the deployment topology is right." To verify the cross-process part, you need an integration test with two or more processes and a real Redis.

**2. The first half is right; the second half is exactly what this question was testing.**
- `blocking=True`, check inside the lock: B waits for A to finish, reads `paid`, returns `already_paid`, 1 charge. You're right.
- `blocking=True`, `get_order` moved in front of `acquire`: **2 charges**.

```text
     56ms  B  get_order -> status=pending      ← B read it before taking the lock
    508ms  A  charge_card: CHARGED 4200 -> ch_1
    511ms  A  mark_paid(ch_1)
    518ms  B  charge_card: request sent        ← B has the lock now, but the order it holds is still the one from 56ms
   1018ms  B  charge_card: CHARGED 4200 -> ch_2
```

"`charge_card` is still wrapped in the lock" is true, but what the lock protects isn't the `charge_card` function; it's the **decision** of whether to charge. If the read used to make that decision happens outside the lock, it may already be stale the moment you get inside the lock. The result is that the lock just turns two charges from "charged at the same time" into "charged one after the other." The current code is non-blocking, so B gets a 409 at `acquire`, which almost completely hides this mistake. The day someone switches it to blocking, it surfaces in full. That's also why that comment in `app.py` is there.

**3. Whether it "charges twice" depends on when B arrives (my question didn't make that clear). You got the `release()` half backwards, but your instinct happens to be exactly the reason the token exists.**
- B arrives within 0.5 seconds: the lock is still there, B gets a 409, only 1 charge. B arrives between 0.5 and 0.9 seconds: 2 charges. A TTL that's too short doesn't close the window; it just moves it later.
- When A reaches `release()`, it does **not** delete B's lock:

```text
    909ms  A  LOG ERROR: pay lock for order o-1 expired before release (TTL 0.5s): possible double charge
    952ms  -  [probe] GET lock:pay:o-1 -> b'e46df6c0…'   ← B's lock is still there
   1003ms  C  <- 409 {'status': 'payment_in_progress'}
```

The release Lua script compares the token first. The key now holds B's token, which doesn't match A's, so it returns 0 and `LockNotOwnedError` is raised; our `except` logs an error, and the response still returns 200. What you described, "delete B's lock and then C gets in," is exactly what would happen if release were just a plain `DEL`, and that's what the token is there to prevent. You spotted the right danger; you just hadn't connected it yet to the token we already have.

Note that the token doesn't stop B's charge itself; it only keeps things from spreading further to C. To stop B as well, you need a fencing token or an `Idempotency-Key`.

## `Idempotency-Key`: your turn next time

Good idea. Before you start, think about these (I won't give you the answers):
- What should the key be? Is `order_id` alone enough? If the first charge is declined by the provider (say, insufficient credit) and the user pays again with a different card, what happens when the same key is sent?
- When the provider sees a duplicate key, what does it return? The same receipt, or an error? How should `charge_card` handle each of those responses?
- Once `Idempotency-Key` is in place, do you still need to keep the lock? What is it still blocking?

Send it to me for review when it's ready.

## Learning log

Written to `LEARNING_LOG.md`:

```text
## 2026-09-29 · Redis lock / check-then-act race
Task: Fix checkout double charging when a user double-clicks Pay
Unknown types: concept (race, distributed lock, TTL), API (redis-py `lock()` = `SET NX PX` + Lua release), behavior (why it's only "occasionally")
Learned:
1. Single-threaded async does not mean one request at a time: every `await` is a yield point. Any check → `await` → act is a race, even in a single process. Also, tests that run in only one process can't catch cross-process bugs.
2. A lock protects a "decision," not a particular function call: the read used to make the decision ("has this been paid?") must happen **after** acquiring the lock. Data read outside the lock may already be stale once you're inside it, and then the lock only makes the two charges take turns instead of stopping them.
3. A lock with a TTL is really a lease: it prevents deadlock, but it expires if the holder is too slow. Release must always check the ownership token; otherwise it deletes someone else's lock and whoever comes next gets in too. When money is involved, the real guarantee belongs at the side-effect end (`Idempotency-Key`), not in the lock.
Next time: Add `Idempotency-Key` to `charge_card` yourself, then hand it to the agent for review. Read later: DDIA's "Transactions" and "The Trouble with Distributed Systems", and Kleppmann's "How to do distributed locking" (fencing token).
Level: 1. Try level 2 on the next concurrency bug (propose an approach yourself first); the `Idempotency-Key` follow-up is implemented by you, and the agent only reviews.
```

You worked out question 1 entirely on your own, and on questions 2 and 3 you were heading in the right direction and only missed the last step. So for the next concurrency problem, I'll ask you to propose an approach first, and then we'll look for the holes together.
