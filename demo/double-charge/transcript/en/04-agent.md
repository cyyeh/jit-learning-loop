## Your prediction vs. what actually happened

The test uses a fake provider (fixed 500ms), a fake DB and fakeredis. The full output is in `artifacts/04-repro-before-fix.txt`.

- **1 second apart**: you guessed 1 charge, and it was indeed **1 charge** ✓. B read `paid` and returned `already_paid`.
- **50ms apart**: you guessed 1 charge; it was actually **2 charges**. And this happened within **the same process, the same thread, the same event loop**:

```text
      4ms  A  get_order -> status=pending
      4ms  A  charge_card: request sent to provider
     55ms  B  get_order -> status=pending      ← A is still waiting on the provider, so the event loop runs B first
     55ms  B  charge_card: request sent to provider
    506ms  A  charge_card: CHARGED 4200 -> ch_1
    555ms  B  charge_card: CHARGED 4200 -> ch_2
```

**This prediction was wrong in a very useful way.** "asyncio is single-threaded" is true, but single-threaded means "only one line of Python is executing at any given instant," not "only one request is handled at a time." Every `await` is a yield point: for the 500ms that A spends in `await charge_card(...)` waiting for the network response, the thread is idle, so the event loop uses it to run B. Think of one waiter looking after many tables: once table A has ordered and the order has gone to the kitchen, they don't stand at the kitchen door waiting; they go and take table B's order. There's only one person the whole time, but two orders are in progress at once. That's how async handles many requests with a single thread, and it's also where the race comes from.

The half you got right:
- Of course there are races across processes too, which is why we need Redis; `asyncio.Lock` isn't enough.
- Single-threading does give you one guarantee: code **between two `await`s** can't have another coroutine cut in. Unfortunately, our check and write have several `await`s between them.

**Prod evidence:** the two charges were 180ms apart and the first request returned 200, which means the two requests overlapped in time and both succeeded. That's what H1 looks like. The signature of H2 (retry after failure) is a failed first request, and this case isn't that. `pg.py` connects to the primary, so H3 is ruled out. But you only looked at one case: H2 may still happen occasionally in prod, and this fix doesn't block it (see the failure modes below).

## What changed

- `checkout/app.py`: the whole of `pay()` is wrapped in a per-order Redis lock
- `checkout/redis_client.py` (new file): a shared Redis client that reads `REDIS_URL`
- `tests/` (new): in-memory fakes plus 6 tests, all passing after the change (`artifacts/04-tests-after-fix.txt`). In the 50ms case, B now gets a 409 and the card is charged only once. To run them: `.venv/bin/python -m pytest tests`

The core is just these lines:

```python
lock = redis.lock(f"lock:pay:{order_id}", timeout=PAY_LOCK_TTL_S, blocking=False)
if not await lock.acquire():                  # SET key token NX PX 30000
    return JSONResponse(status_code=409, content={"status": "payment_in_progress"})
try:
    order = await get_order(order_id)         # check is inside the lock
    ...                                        # charge_card → mark_paid (unchanged)
finally:
    await lock.release()                       # deletes only after the token matches
```

**redis-py's `lock()` does exactly the three things I described last time.** I checked the installed version (redis-py 8.1.0, `.venv/lib/python3.12/site-packages/redis/asyncio/lock.py`): `do_acquire()` is just `self.redis.set(self.name, token, nx=True, px=timeout)`, and the token is a UUID; `release()` runs a Lua script that does a GET, compares the token, and DELs only if they match, raising `LockNotOwnedError` if they don't. So I used the built-in one rather than writing my own, because the Lua release is the part that's easiest to get wrong by hand. One gotcha to remember: the `timeout` of `redis.lock(name)` defaults to `None`, which means **no TTL**. If a worker dies, that order stays locked forever. That's why one test specifically checks the lock's PTTL.

## Why it's done this way

- **The lock wraps the whole handler, not just `charge_card`**: the check has to be inside the lock. Your coworker was right to say "around the outside."
- **Don't wait; return 409 immediately**: the second click doesn't need to wait, because the result of the first click is the answer. If this were blocking, B would tie up a connection waiting for up to 900ms, only to return `already_paid` in the end. The frontend should treat 409 as "payment in progress," not as an error. Worth giving the frontend a heads-up about this.
- **The key is per order**: different orders don't block each other (there's a test).
- **TTL of 30 seconds**: `charge_card` uses httpx's default `Timeout(5.0)`, which is 5 seconds each for connect, read, write and pool, so the worst case can exceed 5 seconds. 30 seconds leaves plenty of headroom. The cost: if a worker dies in the middle of a payment, that order can't be paid for up to 30 seconds.
- **Didn't use `asyncio.Lock`**: it only works within one process, and you have 12 processes.

## Key idea

To make check-then-act atomic, only one executor at a time may run the whole "check → act" section. `SET NX` is atomic in Redis by itself, so we use it as a gate in front of that whole section.

## Invariants and failure modes

1. **The check must be inside the lock.** As soon as someone moves `get_order` in front of `acquire`, the race is back.
2. **The TTL must be longer than the slowest `pay()`.** Once the TTL expires, someone else can get the lock. The symptom is `pay lock for order … expired before release` showing up in the logs; when something goes wrong, search for this line first.
3. **All processes connect to the same Redis primary.** If `REDIS_URL` is set wrong (each process connecting to its own, or to a replica), the lock is useless. Also, locks can be lost during a Redis failover, because replication is async. That's exactly what Kleppmann's article is about.
4. **When Redis is down**: `acquire` raises an exception, we return 500, and nothing is charged (fail closed). For payments this is the right direction, but checkout's availability is now tied to Redis.
5. **What this doesn't block:** the provider has already charged successfully, but the request fails before `mark_paid` (H2). At that point the lock has already been released and the order is still `pending`, so clicking again charges again.

## The stronger layer (I didn't go ahead and add it)

When money is involved, the real guarantee belongs on the provider side: send an idempotency key with the charge (e.g. `pay-{order_id}`), and when the provider sees the same key it returns the same charge instead of charging again. That blocks H1, H2, TTL expiry and Redis failover. The catch is that it depends on whether `payments.internal` supports it, and I can't see its API from here. The other option is a conditional `UPDATE orders SET status='charging' WHERE id=$1 AND status='pending'` in Postgres. It needs no Redis and has no TTL, but it adds another status, and you have to handle orders stuck in `charging`.

My recommendation: keep the lock for now; it fixes exactly the problem the prod evidence points to. If the provider supports idempotency keys, add that on top as a second layer. Do you know whether `payments.internal` supports them?

## Three questions

1. Someone says "Redis is too heavy, just switch to `asyncio.Lock()`," and after that change `tests/` still all pass. What happens in prod? Why doesn't all tests passing mean nothing is wrong?
2. During review, someone thinks the 409 is unfriendly to users and changes it to `blocking=True` (B waits for A to finish, then continues), and while they're at it they move `get_order` in front of `acquire`, saying it "saves a round-trip." What happens when a user double-clicks?
3. If `PAY_LOCK_TTL_S` is changed to 0.5, and one day the provider slows down to 900ms and a user double-clicks again: how many charges? What happens when A reaches the `release()` line?

Once you've thought them through, send me your answers and I'll go over your reasoning with you.
