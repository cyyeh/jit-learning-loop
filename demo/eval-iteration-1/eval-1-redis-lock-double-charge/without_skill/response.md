I fixed it, and I tested the fix against a real Postgres. Before the fix, every double-click charged twice. After it, each order is charged once. Your teammate had the right instinct, but I put the lock in Postgres instead of Redis. Here's the reasoning so you can decide whether you agree.

## What's going wrong

```
click 1: read order -> "pending" -> charge card (300-900ms) ........ -> mark paid
click 2:      read order -> "pending" -> charge card ........ -> mark paid
```

The handler checks the status first and writes it back much later. There's almost a second of charging in between, and a second click easily lands inside that gap. Both requests see "pending", so both charge the card.

You need one thing that all copies of the code agree on: "someone is already paying this order." You run 4 workers × 3 replicas, which is 12 separate processes on 3 machines, and the two clicks usually land in different ones. So an in-memory lock (like Python's `asyncio.Lock`) can't work, because each process would have its own. The lock has to live somewhere they all share. That's why your teammate said Redis.

## What a "Redis lock" is

It's just a key that means "taken", created with a command that only succeeds if the key doesn't already exist:

```python
token = uuid4().hex
got_it = await redis.set(f"lock:pay:{order_id}", token, nx=True, px=30_000)
if not got_it:
    return 409                            # someone else holds the lock
try:
    order = await get_order(order_id)     # the status check must be INSIDE the lock
    if order.status == "paid": ...
    receipt = await charge_card(...)
    await mark_paid(...)
finally:
    # delete the key, but only if it's still ours (a Lua script runs atomically in Redis)
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then "
                     "return redis.call('del', KEYS[1]) end return 0",
                     1, f"lock:pay:{order_id}", token)
```

- **`nx=True`**: "only set this if it doesn't exist." Redis runs commands one at a time, so if two requests send this at the same moment, exactly one gets it. That's the whole lock.
- **`px=30_000`**: Redis deletes the key by itself after 30s, so a crashed worker can't hold the lock forever.
- **`token` plus the compare-and-delete**: this stops you from deleting someone else's lock if yours already expired.

"Just put a lock around it" hides a trap: the status check has to be inside the lock. If you only wrap `charge_card`, both clicks still read "pending" first, and then they just take turns charging.

## Why I used Postgres instead

A Redis lock can work here, but it has sharp edges that matter when money is involved:

1. **The expiry is a guess.** If a charge ever takes longer than the lock's lifetime, the lock silently disappears in the middle of the charge and the next click gets in. For example, httpx's default timeout is 5s per step, and providers do have slow days.
2. **It forgets after a crash.** If a worker dies after charging but before `mark_paid`, the lock expires, the order still says "pending", and the next click charges again.
3. **It's a second source of truth** in a different system, and a Redis failover can lose a key that was just set.

Postgres can do the same "only one can win" step directly on the order row, which is already the source of truth:

```sql
UPDATE orders SET status = 'paying'
WHERE id = $1 AND status = 'pending'
RETURNING ...
```

The check and the write are a single statement, so there's no gap for a second request to slip into. If two of these hit the same row at once, Postgres makes the second one wait until the first commits. Then it re-checks the `WHERE` clause, sees `'paying'`, and updates 0 rows. It's the same idea as Redis's `nx`, but there's no expiry to tune and no extra system in the payment path. The "someone is paying" marker also survives a crash.

The changes are in `evals/files/checkout/db.py` and `evals/files/checkout/app.py`. There's a new `claim_for_payment()` (the statement above) and a `release_claim()` that resets the order to pending if the charge fails. In `pay()`, only the request that wins the claim calls the card. Any other click gets `already_paid` or a `409 payment_in_progress`.

## How I checked it

I started a temporary Postgres 18 and ran the old and new handlers from separate OS processes (like your workers). A fake provider added 300–900ms of latency and recorded every charge. The test harness was throwaway and isn't in the repo.

| Scenario | Before | After |
|---|---|---|
| Double-click, 150ms apart (10 orders) | 2 charges each | 1 charge each; the second click got 409 |
| 12 processes hit the same order at once (5 orders) | **12 charges each** | 1 charge each |
| Charge fails, then the user retries | — | the order went back to pending, the retry charged once, and a later click got `already_paid` |

## Before you ship

1. **`'paying'` is a new status value.** If `orders.status` has a CHECK constraint or an enum type, it needs a migration. Also look for other code that reads `status` (admin pages, reports, emails) and make sure it treats `'paying'` as not paid yet.
2. **Frontend:** the second click now gets a 409. Make sure the UI doesn't show an error while the first click is succeeding: ignore the 409, or poll the order. Disabling the button on click is also worth doing, but it's not the fix, because retries, two tabs and flaky networks all get around it.
3. **Orders stuck in `'paying'`:** if a worker dies mid-charge, the order stays in `'paying'`. That's deliberate (a stuck order is better than a second charge), but someone needs a way to fix it by hand: check the provider, then mark the order paid or reset it. An alert for orders in `'paying'` for more than a few minutes would catch these.
4. **The gap this doesn't close:** if the charge request times out, we don't know whether the provider actually charged. The code resets the order to pending, which is the same as today, so a retry could still charge twice. Neither a Redis lock nor this lock fixes that. The real fix is an **idempotency key**: you send an ID with the charge, and if the provider sees the same ID twice, it returns the original charge instead of making a new one. **Does `payments.internal` support something like that?** If it does, it's a small change in `payments.py` and I can add it.

If you or your teammate would still rather use Redis (say, to keep the schema unchanged), I can write that version properly. But I'd still keep the in-lock status check and push for the idempotency key.
