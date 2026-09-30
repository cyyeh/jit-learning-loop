## What this task needs

**You already have:** FastAPI handlers, SQL reads and writes, Redis as a cache (the `SET key value EX 60` kind)

**Still missing:**
- **check-then-act race condition** (concept · fundamental: concurrency): why a double-click turns into two charges
- **Why the lock has to be "distributed"** (codebase + concept): `app.py` says the deployment is 4 workers × 3 replicas, i.e. 12 processes
- **What a Redis lock actually is**: `SET … NX PX` plus a release that carries a token (API + concept)
- **Lock TTL expiry** (concept): where Redis locks most often go wrong
- **Which situation "occasionally" actually is** (behavior): what the hypotheses below deal with

> This problem sits on two fundamentals: concurrency and distributed systems. Today's model is enough to fix the bug, but it's worth reading properly later: the "Transactions" and "The Trouble with Distributed Systems" chapters of DDIA (*Designing Data-Intensive Applications*), and Martin Kleppmann's "How to do distributed locking".

## Minimum model

The current flow is `POST /orders/{id}/pay → get_order → check status → charge_card (300–900ms) → mark_paid`.

```text
Time ─────────────────────────────────────────────────────▶
Request A: read status=pending ──── charge_card (~600ms) ────▶ write paid
Request B:     read status=pending ──── charge_card ────▶ write paid
               ▲ double-click gap ~100ms: A hasn't written paid yet, so B reads the old state
               → both pass the check → card charged twice
```

1. **Check-then-act**: "check status" and "charge + write paid" are two separate steps, with the whole of `charge_card` sandwiched between them. Any second request that lands in that 300–900ms window causes a double charge. That's why it happens "occasionally," and why double-clicks hit it so easily.
2. **What the lock has to block**: for a given order, only one request at a time may be running the whole "check → charge → write paid" sequence. Note that the "check" has to be inside the lock too; wrapping only `charge_card` isn't enough. Python's `asyncio.Lock` only works within a single process's memory, but you have 12 processes, and the load balancer may send the two clicks to different replicas. So the lock has to live somewhere all 12 processes can see. That's the role Redis (or Postgres) plays here.
3. **A Redis lock is just the `SET` you already know, with two extra conditions:**
   ```text
   SET lock:order:123 <random-token> NX PX 5000
   ```
   - `NX`: write only if the key doesn't exist. If 12 processes grab for it at the same time, only one gets `OK` and all the others get `nil`. Redis executes one command at a time, so the "check whether it's there + write it" step is atomic in itself, which is exactly the piece our code is missing.
   - `PX 5000`: expires automatically after 5 seconds. If the process holding the lock dies, the lock doesn't stay stuck forever.
   - `random-token`: on release, first check "is this still my lock?" and only then delete it; otherwise you might delete someone else's.
4. **Where the cache analogy breaks down**: when a cache TTL expires, the worst case is one miss and one recompute. When a lock TTL expires, it means "the protection is gone, but the holder doesn't know it." If `charge_card` hangs for longer than the TTL, another request can take the lock and charge the card again. A cache that's wrong is just slow; a lock that's wrong charges the customer twice.

Not covered yet: Redlock (multiple Redis instances), fencing token, transaction isolation level. This bug doesn't need them yet; I'll point them out later when we reach a place where they're useful.

## Hypotheses

"Occasionally double charges" doesn't necessarily have just one cause, and your coworker's lock only blocks one of them, so we need to tell them apart first:

- **H1 · Concurrent race (the diagram above)**: two requests overlap in time. → You'd see: two charges less than 1 second apart, and both requests return 200 `"paid"`. **A Redis lock blocks this.**
- **H2 · Retry after failure**: the provider actually charged successfully, but this request failed before `mark_paid` (httpx timeout, worker restart, DB error), so the order is still `pending`, and the user clicks again or the frontend retries automatically. → You'd see: the first request returns a 5xx or times out, and the two requests don't overlap in time. **A Redis lock can't block this**, because the lock was already released when the first request ended. This one needs an idempotency key.
- **H3 · Stale read**: if `get_order` reads from a read replica with replication lag, the second request can read `pending` even if it arrives **after** the first one has finished. → You'd see: the second request starts after the first one has returned `"paid"`, and the card still gets charged. (`checkout/pg.py` isn't in the repo, so I can't tell whether the pool connects to the primary or a replica. If you know, let me know.)

I won't go into fixes yet. Once we've confirmed which one it is (or which ones), we'll choose together between a Redis lock, a conditional `UPDATE` in the DB, and sending an idempotency key to the payment provider.

## Your turn

Next I'll write a reproduction test that doesn't need a real Redis/Postgres: a fake `charge_card` that always sleeps 500ms, with two requests sent at the same `pending` order.

**Make a prediction:** with the two requests **50ms** apart, how many times will the provider be charged? And **1 second** apart? A one-line guess is fine, or say "skip" and I'll just run it.

(If you can look at prod data: pick one double charge and check the time gap between the two charges, plus the status code of the first request. Those two numbers alone tell H1 and H2 apart.)
