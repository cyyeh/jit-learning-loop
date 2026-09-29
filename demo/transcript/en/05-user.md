1. If we switch to `asyncio.Lock()`, the lock only exists in a single process's memory. Prod has 12 processes, so if the two clicks get sent to different processes, each one gets its own lock and it charges twice all the same. The tests pass because they all run in the same process.

2. With `blocking=True`, B waits until A is done before continuing, so it should still only charge once, it's just that B responds more slowly? Moving `get_order` in front of `acquire` I don't think makes any difference, because `charge_card` is still wrapped in the lock.

3. It'll charge twice, because the lock expires after 0.5 seconds and B can get the lock. When A gets to `release()`... I guess it'll delete B's lock? Then if there's also a C, it gets even worse.

Also, I asked around: `payments.internal` does support an `Idempotency-Key` header. But I'd like to try adding that myself next time, and then you can just review it for me.

Please write the learning log to `LEARNING_LOG.md` in the repo root.
