## 你的預測 vs. 實際結果

測試用假的 provider（固定 500ms）、假的 DB、fakeredis，完整輸出在 `artifacts/04-repro-before-fix.txt`。

- **間隔 1 秒**：你猜 1 次，實際也是 **1 次** ✓。B 讀到 `paid`，回 `already_paid`。
- **間隔 50ms**：你猜 1 次，實際是 **2 次**。而且這是在**同一個 process、同一個 thread、同一個 event loop** 裡跑出來的：

```text
      4ms  A  get_order -> status=pending
      4ms  A  charge_card: request sent to provider
     55ms  B  get_order -> status=pending      ← A 還在等 provider，event loop 先去跑 B
     55ms  B  charge_card: request sent to provider
    506ms  A  charge_card: CHARGED 4200 -> ch_1
    555ms  B  charge_card: CHARGED 4200 -> ch_2
```

**這個預測錯得很有價值。** 「asyncio 是 single-thread」沒錯，但 single-thread 的意思是「同一瞬間只有一行 Python 在執行」，不是「一次只處理一個 request」。每個 `await` 都是讓出點：A 在 `await charge_card(...)` 等網路回應的那 500ms，thread 是閒著的，event loop 就拿去跑 B。可以想成一個服務生顧很多桌：A 桌點完菜送進廚房，他不會站在廚房門口等，會先去幫 B 桌點菜。從頭到尾只有一個人，但同時有兩張單在跑。async 能用一個 thread 撐很多 request 靠的就是這個，race 也是從這裡來的。

你對的那一半：
- 跨 process 當然也會 race，所以才需要 Redis，`asyncio.Lock` 不夠。
- single-thread 確實給了一個保證：**兩個 `await` 之間**的程式碼不會被別的 coroutine 插隊。可惜我們的 check 和 write 中間隔了好幾個 `await`。

**Prod 證據：** 兩筆 charge 相差 180ms，而且第一個 request 回 200，代表兩個 request 在時間上重疊、也都成功了，這是 H1 的樣子。H2（失敗後重試）的特徵是第一個 request 失敗，這筆不是。`pg.py` 接 primary，所以 H3 排除。不過你只看了一筆，H2 在 prod 還是可能偶爾發生，而這次的 fix 擋不住它（見下面的 failure modes）。

## 改了什麼

- `checkout/app.py`：`pay()` 整段用 per-order 的 Redis lock 包起來
- `checkout/redis_client.py`（新檔）：共用的 Redis client，讀 `REDIS_URL`
- `tests/`（新）：in-memory fakes 加 6 個 test，改完全部通過（`artifacts/04-tests-after-fix.txt`）。50ms 的 case 現在是 B 拿到 409，只扣一次。執行方式：`.venv/bin/python -m pytest tests`

核心就這幾行：

```python
lock = redis.lock(f"lock:pay:{order_id}", timeout=PAY_LOCK_TTL_S, blocking=False)
if not await lock.acquire():                  # SET key token NX PX 30000
    return JSONResponse(status_code=409, content={"status": "payment_in_progress"})
try:
    order = await get_order(order_id)         # check 在 lock 裡面
    ...                                        # charge_card → mark_paid（沒動）
finally:
    await lock.release()                       # token 比對過才刪
```

**redis-py 的 `lock()` 做的就是上次講的那三件事。** 我看了裝好的版本（redis-py 8.1.0，`.venv/lib/python3.12/site-packages/redis/asyncio/lock.py`）：`do_acquire()` 就是 `self.redis.set(self.name, token, nx=True, px=timeout)`，token 是一個 UUID；`release()` 跑一段 Lua script，GET、比對 token、相同才 DEL，不同就丟 `LockNotOwnedError`。所以我用內建的，沒有自己手寫，因為 Lua release 是手寫最容易寫錯的部分。有一個坑要記住：`redis.lock(name)` 的 `timeout` 預設是 `None`，也就是**沒有 TTL**，worker 一掛，那張 order 就永遠鎖住了。所以有一個 test 專門檢查 lock 的 PTTL。

## 為什麼這樣改

- **lock 包住整個 handler，不只包 `charge_card`**：check 一定要在 lock 裡面。你同事說「包在外面」是對的。
- **不等待，直接回 409**：第二下點擊不需要等，第一下的結果就是答案。如果改成 blocking，B 會卡著一條連線等上最多 900ms，最後也只是回 `already_paid`。前端要把 409 當成「付款處理中」，不要當成錯誤，這點值得跟前端講一聲。
- **key 是 per order**：不同 order 之間不會互相擋（有 test）。
- **TTL 30 秒**：`charge_card` 用的是 httpx 預設的 `Timeout(5.0)`，connect、read、write、pool 各 5 秒，所以最壞情況可能超過 5 秒，30 秒留了很大的餘裕。代價是 worker 在付款途中掛掉的話，那張 order 最多 30 秒內付不了。
- **沒採用 `asyncio.Lock`**：它只在一個 process 裡有效，而你們有 12 個 process。

## Key idea

要讓 check-then-act 變成 atomic：「check → act」這一整段，同一時間只能有一個執行者。`SET NX` 在 Redis 裡本身是 atomic 的，我們把它當成擋在整段前面的一道門。

## Invariants 與 failure modes

1. **check 必須在 lock 裡。** 只要有人把 `get_order` 移到 `acquire` 前面，race 就回來了。
2. **TTL 要大於最慢的一次 `pay()`。** TTL 一過期，別人就拿得到 lock。症狀是 log 出現 `pay lock for order … expired before release`，出事時先搜這行。
3. **所有 process 都連同一個 Redis primary。** `REDIS_URL` 設錯（各連各的，或連到 replica），lock 就形同虛設。另外 Redis failover 時 lock 可能會遺失，因為 replication 是 async 的。這正是 Kleppmann 那篇文章在談的事。
4. **Redis 掛掉時**：`acquire` 丟 exception，回 500，不扣款（fail closed）。對付款來說這是對的方向，但 checkout 的可用性從此跟 Redis 綁在一起了。
5. **沒擋住的：** provider 已經扣款成功，但 request 在 `mark_paid` 之前失敗了（H2）。這時 lock 已經放掉、order 還是 `pending`，再按一次就會再扣一次。

## 更強的那一層（我沒有直接加）

牽涉到錢時，真正的保證應該放在 provider 端：charge 時帶一個 idempotency key（例如 `pay-{order_id}`），provider 看到同一個 key 就回傳同一筆 charge，不會再扣一次。H1、H2、TTL 過期、Redis failover 都擋得住。代價是要看 `payments.internal` 有沒有支援，它的 API 我這邊看不到。另一個選項是在 Postgres 做條件式 `UPDATE orders SET status='charging' WHERE id=$1 AND status='pending'`，不需要 Redis 也沒有 TTL，但要多一個 status，還要處理卡在 `charging` 的 order。

我的建議：lock 先留著，它修掉的正是 prod 證據指向的問題。如果 provider 支援 idempotency key，再把它加上去當第二層。你知道 `payments.internal` 有支援嗎？

## 三個問題

1. 有人說「Redis 太重了，換成 `asyncio.Lock()` 就好」，而且這樣改完 `tests/` 還是會全部通過。prod 上會發生什麼事？為什麼測試全過不代表沒事？
2. Review 時有人覺得 409 對使用者不友善，改成 `blocking=True`（B 等 A 做完再繼續），還順手把 `get_order` 移到 `acquire` 前面，說是「省一次 round-trip」。使用者連點時會發生什麼事？
3. 如果 `PAY_LOCK_TTL_S` 被改成 0.5，某天 provider 慢到 900ms，使用者又連點。會扣幾次？A 走到 `release()` 那行時會發生什麼事？

想好後把答案丟給我，我幫你看推理過程。
