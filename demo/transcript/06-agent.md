## 你的答案

第 2、3 題我直接跑了實驗，拿結果來對照（完整輸出：`artifacts/06-check-answers-experiment.txt`；實驗檔放在 scratch，沒有進 repo）。

**1. 完全正確。** 而且你點出了這類 bug 最麻煩的一點：測試只抓得到它的執行環境本身能產生的 race。我們的 unit test 證明的是「邏輯對」，證明不了「部署拓撲對」。要驗證跨 process 的部分，得用兩個以上的 process 加上真的 Redis 跑 integration test。

**2. 前半對，後半正是這題想考的地方。**
- `blocking=True`、check 在 lock 裡面：B 等 A 做完，讀到 `paid`，回 `already_paid`，扣 1 次。你說得對。
- `blocking=True`、`get_order` 移到 `acquire` 前面：扣 **2 次**。

```text
     56ms  B  get_order -> status=pending      ← B 在拿 lock 之前就讀了
    508ms  A  charge_card: CHARGED 4200 -> ch_1
    511ms  A  mark_paid(ch_1)
    518ms  B  charge_card: request sent        ← B 拿到 lock 了，但手上的 order 還是 56ms 那一份
   1018ms  B  charge_card: CHARGED 4200 -> ch_2
```

「`charge_card` 還是被 lock 包住」這句沒錯，但 lock 要保護的不是 `charge_card` 這個 function，而是「要不要 charge」這個**決定**。做決定用的那次讀取如果在 lock 外面，一進到 lock 裡它就可能已經過時了。結果 lock 只是讓兩次 charge 從「同時扣」變成「排隊扣」。現在的 code 是 non-blocking，B 在 `acquire` 就拿到 409，所以這個錯誤幾乎被遮住了。哪天有人改成 blocking，它就會整個冒出來。這也是 `app.py` 裡那行註解存在的原因。

**3. 「扣兩次」要看 B 什麼時候到（這點是我題目沒寫清楚）。`release()` 那半你答反了，不過你的直覺剛好就是 token 存在的理由。**
- B 在 0.5 秒內到：lock 還在，B 拿到 409，只扣 1 次。B 在 0.5 到 0.9 秒之間到：扣 2 次。TTL 太短並沒有把窗口關掉，只是把它往後挪了。
- A 走到 `release()` 時，**不會**刪掉 B 的 lock：

```text
    909ms  A  LOG ERROR: pay lock for order o-1 expired before release (TTL 0.5s): possible double charge
    952ms  -  [probe] GET lock:pay:o-1 -> b'e46df6c0…'   ← B 的 lock 還在
   1003ms  C  <- 409 {'status': 'payment_in_progress'}
```

release 的 Lua script 會先比對 token。key 裡現在存的是 B 的 token，跟 A 的對不上，所以回 0，丟出 `LockNotOwnedError`，我們的 `except` 記一筆 error，response 照樣回 200。你說的「刪掉 B 的 lock，C 就進來了」，正是 release 如果只是單純 `DEL` 時會發生的事，token 就是為了擋這個。你抓到了對的危險，只是還沒把它和我們手上已經有的 token 連起來。

注意 token 擋不住 B 那一次 charge 本身，它只防止事情繼續蔓延到 C。要連 B 都擋住，就得靠 fencing token 或 `Idempotency-Key`。

## `Idempotency-Key`：下次換你做

好主意。動手之前可以先想想這幾件事（我不給答案）：
- key 要用什麼？只用 `order_id` 夠嗎？如果第一次 charge 被 provider 拒絕（例如額度不足），使用者換一張卡再付，帶著同一個 key 會發生什麼事？
- provider 看到重複的 key，回的是什麼？同一個 receipt，還是一個 error？`charge_card` 要怎麼處理這兩種回應？
- 加上 `Idempotency-Key` 之後，lock 還需要留著嗎？它還在擋什麼？

寫好就丟給我 review。

## Learning log

已經寫進 `LEARNING_LOG.md`：

```text
## 2026-09-29 · Redis lock / check-then-act race
Task: 修 checkout 在使用者連點 Pay 時 double charge 的問題
Unknown types: concept（race、distributed lock、TTL）、API（redis-py `lock()` = `SET NX PX` + Lua release）、behavior（為什麼只是「偶爾」）
Learned:
1. Single-thread 的 async 不等於一次只處理一個 request：每個 `await` 都是讓出點。只要出現 check → `await` → act，就是 race，單一 process 也一樣。另外，只跑在一個 process 裡的測試抓不到跨 process 的 bug。
2. Lock 保護的是「決定」，不是某個 function call：用來做決定的那次讀取（「付過了嗎？」）必須在拿到 lock **之後**才做。在 lock 外讀到的資料，進了 lock 就可能已經過時，這時 lock 只是讓兩次 charge 排隊執行，擋不掉。
3. 有 TTL 的 lock 其實是一份租約（lease）：它能避免 deadlock，但持有者太慢時會過期。release 一定要比對 ownership token，不然會刪掉別人的 lock，後面的人就跟著進來了。牽涉到錢時，真正的保證要放在副作用那一端（`Idempotency-Key`），不是 lock。
Next time: 自己在 `charge_card` 加上 `Idempotency-Key`，寫完交給 agent review。之後讀：DDIA 的 "Transactions" 和 "The Trouble with Distributed Systems"，以及 Kleppmann 的 "How to do distributed locking"（fencing token）。
Level: 1。下一個 concurrency bug 試 level 2（先自己提出做法）；`Idempotency-Key` 這個後續由你實作、agent 只 review。
```

第 1 題你完全靠自己推出來，第 2、3 題都抓到了對的方向，只差最後一步。所以下一個 concurrency 問題，我會先請你提出做法，再一起看哪裡有洞。
