I read `app.py`, `db.py` and `payments.py` and haven't changed anything yet. The plan: first a small model of what's going on, then one prediction from you, then I'll write the fix and test it.

## What this task needs

**What you already know:** HTTP handlers (FastAPI), SQL reads and writes, and Redis as a cache (`SET` with an expiry).

**What's missing:**
- **Race condition / check-then-act.** A concept, and a fundamental one (concurrency).
- **What a "Redis lock" actually is:** `SET NX`, plus a TTL, plus an owner token. A concept.
- **The redis-py calls to do it.** An API gap. There's no lockfile in this folder, so when I write the code I'll check the docs for the version you run.
- **Whether `payments.internal` accepts an idempotency key.** A question about your system that you can answer faster than I can.
- **Whether every double charge is the double-click race, or some are retries after a failure.** A runtime-behavior question.

This rests on two fundamentals: concurrency and distributed systems. Today's model is enough for this fix. Later it's worth reading *Designing Data-Intensive Applications*, ch. 8 (the sections on process pauses and fencing tokens), and Martin Kleppmann's post "How to do distributed locking".

## Minimum model

**1. The bug is check-then-act.** Line 17 of `app.py` checks the status and lines 21–23 act on it. In between, the DB still says `pending` for 300–900 ms:

```text
t=0     click 1 → worker A: get_order → "pending" ✓ → charge_card ........ mark_paid(r1)
t=150ms click 2 → worker B: get_order → "pending" ✓ → charge_card ........ mark_paid(r2)
                                                        two charges; r2 overwrites r1 in the DB
```

**2. The lock has to live outside Python.** The docstring says 4 workers × 3 replicas, so that's 12 separate processes on 3 machines. Click 1 and click 2 can land on different machines, and an `asyncio.Lock` only exists inside one process. That's why your teammate suggested Redis: all 12 processes can see it.

**3. A Redis lock is a cache key with two extra rules.** It uses the same `SET` command you already use for caching:

```text
acquire:  SET lock:order:123 <random-token> NX PX 30000
            NX = only set it if the key doesn't exist yet. Redis runs commands one at a time,
                 so exactly one caller gets OK and everyone else gets nil.
            PX = expire after 30 s, so a crashed worker can't hold the lock forever.
inside:   re-read the order → if paid, stop → charge → mark_paid
release:  delete the key only if it still holds MY token (check + delete in one small Lua script)
```

**Where the cache analogy breaks:** when a cache key expires early, you just get a harmless miss. When a lock key expires early, two workers both think they hold the lock and neither of them finds out. Two things follow:
- **A TTL that's too short lets double charges back in.** httpx's default timeout is 5 s, so a slow provider call can run well past 900 ms. If the lock expires mid-charge, click 2 gets in and charges again.
- **Releasing without the token check frees someone else's lock.** A worker whose lock already expired would delete the *next* worker's lock.

**4. What no lock can fix.** A lock only stops requests that overlap. Suppose `charge_card` succeeds but the worker dies or times out before `mark_paid`. The order stays `pending`, and the user's retry charges them again. The only fix for that is making the charge itself idempotent: you send the provider a key (e.g. the order id) and it refuses to charge the same key twice. Stripe and Adyen both support this. I don't know whether `payments.internal` does.

I'm leaving out Redlock (locking across several Redis nodes) and fencing tokens. They matter when you need stronger guarantees, but not for this fix.

## Hypotheses

- **H1: concurrent race.** Both requests pass the status check before either one marks the order paid.
  - Evidence: two POSTs for the same order less than ~1 s apart, two charges at the provider, and `orders.receipt_id` pointing to only one of them.
- **H2: retry after a partial failure.** Request 1 charged the card, then failed before `mark_paid` (timeout, 5xx or restart), and the user clicked again.
  - Evidence: an error logged on request 1, and the two POSTs further apart than a charge takes.
- **H3: upstream retry.** The load balancer or a proxy retries a slow POST.
  - Evidence: duplicate requests with the same trace/request id and no second click.

A Redis lock fixes H1 only. An idempotency key fixes all three.

## Fix options (not picking yet)

- **A. Redis lock (your teammate's idea)** around the check, the charge and `mark_paid`.
  - Fixes H1.
  - You'll need to size the TTL, release only with the token check, and add a new response for "payment already in progress".
- **B. Atomic claim in Postgres, no Redis:** `UPDATE orders SET status='charging' WHERE id=$1 AND status='pending' RETURNING ...`.
  - Only one request's UPDATE can match, so this gives the same guarantee as the lock.
  - It uses the DB that's already the source of truth, and there's no TTL to tune.
  - The cost: you need a plan for orders stuck in `charging` after a crash.
- **C. Idempotency key on `charge_card`.**
  - Fixes H1, H2 and H3 at the point where the money actually moves.
  - Only possible if the provider supports it.

My lean: C if it's available, plus A or B. That way a double-click gets a clean "payment in progress" response instead of relying on the provider to dedupe. I'll check with you before replacing your teammate's suggestion.

## Your turn

1. **Prediction.** Next I'll write a repro test against the current code. The DB will be faked in memory, `charge_card` will be faked to take 500 ms, and two pay requests will hit the same order.
   - How many charges do you expect if the second request starts **50 ms** after the first?
   - How many if it starts **700 ms** after?
   - In one line: what in production makes that danger window bigger or smaller?
2. **A fact I need:** does `payments.internal` accept an idempotency key (an `Idempotency-Key` header or similar)? If you have logs for a real double-charged order, it would also help to know whether the two POSTs were under 1 s apart (H1) or further apart with an error on the first (H2).

One-line guesses are fine. Or say "skip" and I'll carry on with the repro test and option A, including the token-checked release, since that's what you asked for.
