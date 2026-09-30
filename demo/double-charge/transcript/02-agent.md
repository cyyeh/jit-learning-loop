## 這個任務需要什麼

**已經有：** FastAPI handler、SQL 讀寫、Redis 當 cache（`SET key value EX 60` 這種）

**還缺：**
- **check-then-act race condition**（concept · fundamental：concurrency）：為什麼連點會變成兩次 charge
- **為什麼要「分散式」的 lock**（codebase + concept）：`app.py` 寫著部署是 4 workers × 3 replicas，也就是 12 個 process
- **Redis lock 到底是什麼**：`SET … NX PX` 加上帶 token 的 release（API + concept）
- **lock 的 TTL 過期**（concept）：Redis lock 最容易出事的地方
- **「偶爾」到底是哪種情況**（behavior）：下面的 hypotheses 要處理的

> 這題踩在 concurrency 和 distributed systems 兩個 fundamental 上。今天的 model 夠把 bug 修好，但之後值得認真讀：DDIA（*Designing Data-Intensive Applications*）的 "Transactions" 和 "The Trouble with Distributed Systems" 兩章，以及 Martin Kleppmann 的 "How to do distributed locking"。

## Minimum model

現在的流程是 `POST /orders/{id}/pay → get_order → 檢查 status → charge_card（300–900ms）→ mark_paid`。

```text
時間 ─────────────────────────────────────────────────────▶
Request A: 讀 status=pending ──── charge_card (~600ms) ────▶ 寫 paid
Request B:     讀 status=pending ──── charge_card ────▶ 寫 paid
               ▲ 雙擊間隔 ~100ms，A 還沒寫 paid，B 讀到的是舊狀態
               → 兩個都通過檢查 → 刷兩次卡
```

1. **Check-then-act**：「檢查 status」和「charge + 寫 paid」是分開的兩步，中間夾著整個 `charge_card`。第二個 request 只要落在這 300–900ms 的窗口裡就會 double charge。所以它是「偶爾」發生，而連點特別容易踩到。
2. **Lock 要擋的是什麼**：同一張 order 的「檢查 → charge → 寫 paid」這一整段，同時只能有一個 request 在跑。注意「檢查」也要在 lock 裡面，只包住 `charge_card` 不夠。Python 的 `asyncio.Lock` 只在單一 process 的記憶體裡有效，但你們有 12 個 process，兩次點擊可能被 load balancer 分到不同 replica。所以 lock 必須放在 12 個 process 都看得到的地方，這就是 Redis（或 Postgres）在這裡的角色。
3. **Redis lock 就是你熟悉的 `SET`，多加兩個條件：**
   ```text
   SET lock:order:123 <random-token> NX PX 5000
   ```
   - `NX`：key 不存在才寫入。12 個 process 同時搶，只有一個拿到 `OK`，其他都拿到 `nil`。Redis 一次只執行一個指令，所以「看有沒有 + 寫進去」這一步本身是 atomic 的，正好補上我們 code 缺的那塊。
   - `PX 5000`：5 秒後自動過期。拿到 lock 的 process 掛了，lock 也不會永遠卡住。
   - `random-token`：release 時要先比對「這還是我的 lock」才刪，不然可能刪到別人的。
4. **和 cache 的類比在哪裡斷掉**：cache 的 TTL 過期，頂多 miss 一次、重算一次。lock 的 TTL 過期則是「保護沒了，但持有者不知道」。如果 `charge_card` 卡住超過 TTL，另一個 request 就能拿到 lock 再刷一次。cache 錯了只是慢，lock 錯了是扣客人兩次錢。

先不講：Redlock（多台 Redis）、fencing token、transaction isolation level。這個 bug 還用不到，之後碰到它們派得上用場的地方我會點出來。

## Hypotheses

「偶爾 double charge」不一定只有一種原因，而你同事的 lock 只擋得住其中一種，所以要先分清楚：

- **H1 · 並發 race（上面那張圖）**：兩個 request 在時間上重疊。→ 會看到：兩筆 charge 相隔不到 1 秒，兩個 request 都回 200 `"paid"`。**Redis lock 擋得住。**
- **H2 · 失敗後重試**：provider 其實扣款成功了，但這個 request 在 `mark_paid` 之前就失敗了（httpx timeout、worker 重啟、DB 錯誤），order 還停在 `pending`，使用者再按一次或前端自動重試。→ 會看到：第一個 request 回 5xx 或 timeout，兩個 request 在時間上不重疊。**Redis lock 擋不住**，因為第一個 request 結束時 lock 已經放掉了。這種要靠 idempotency key。
- **H3 · 讀到舊資料**：如果 `get_order` 讀的是有 replication lag 的 read replica，第二個 request 就算在第一個完成**之後**才到，也可能讀到 `pending`。→ 會看到：第二個 request 在第一個回 `"paid"` 之後才開始，還是被刷了。（`checkout/pg.py` 不在 repo 裡，我看不出 pool 接的是 primary 還是 replica，你知道的話跟我說一聲。）

修法先不展開。確認是哪一個（或哪幾個）之後，再一起在 Redis lock、DB 條件式 `UPDATE`、對 payment provider 帶 idempotency key 之間做選擇。

## 換你

接下來我會寫一個不需要真的 Redis/Postgres 的重現測試：假的 `charge_card` 固定 sleep 500ms，對同一張 `pending` order 打兩個 request。

**預測一下：** 兩個 request 間隔 **50ms** 時，provider 會被 charge 幾次？間隔 **1 秒**時呢？一行猜就好，或說「skip」我就直接跑。

（如果你查得到 prod 資料：挑一筆 double charge，看兩筆 charge 的時間差，以及第一個 request 的 status code。這兩個數字就能直接分辨 H1 和 H2。）
