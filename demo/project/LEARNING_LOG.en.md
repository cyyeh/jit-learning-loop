# Learning Log

## 2026-09-29 · Redis lock / check-then-act race
Task: Fix checkout double charging when a user double-clicks Pay
Unknown types: concept (race, distributed lock, TTL), API (redis-py `lock()` = `SET NX PX` + Lua release), behavior (why it's only "occasionally")
Learned:
1. Single-threaded async does not mean one request at a time: every `await` is a yield point. Any check → `await` → act is a race, even in a single process. Also, tests that run in only one process can't catch cross-process bugs.
2. A lock protects a "decision," not a particular function call: the read used to make the decision ("has this been paid?") must happen **after** acquiring the lock. Data read outside the lock may already be stale once you're inside it, and then the lock only makes the two charges take turns instead of stopping them.
3. A lock with a TTL is really a lease: it prevents deadlock, but it expires if the holder is too slow. Release must always check the ownership token; otherwise it deletes someone else's lock and whoever comes next gets in too. When money is involved, the real guarantee belongs at the side-effect end (`Idempotency-Key`), not in the lock.
Next time: Add `Idempotency-Key` to `charge_card` yourself, then hand it to the agent for review. Read later: DDIA's "Transactions" and "The Trouble with Distributed Systems", and Kleppmann's "How to do distributed locking" (fencing token).
Level: 1. Try level 2 on the next concurrency bug (propose an approach yourself first); the `Idempotency-Key` follow-up is implemented by you, and the agent only reviews.
