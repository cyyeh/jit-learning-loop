修好了。我也在本機用真的 Kafka 重現了問題，再驗證修正有效。下面先講發生了什麼事，再講怎麼修。

## 先建立一個觀念：Kafka 不知道你寄了信

Kafka 只記一件事：每個 consumer group 在每個 partition 上的 **committed offset**。你可以把它想成一張「書籤」，意思是「下次從第幾筆開始讀」。

Consumer 重啟，或 partition 被分給另一個 replica 時，都會從書籤的位置接著讀。所以**書籤之後、process 死掉之前做過的事，全部會再做一次**。以寄信來說，就是再寄一次。

所以要回答兩個問題：你的書籤多久更新一次？process 又是怎麼死的？

## 問題 1：書籤其實是「每一批」才更新一次，不是每 5 秒

`enable_auto_commit=True, auto_commit_interval_ms=5000` 看起來像「每 5 秒自動存一次書籤」。但 kafka-python 的 auto-commit **只會在 `poll()` 裡面觸發**，沒有背景 thread 幫你 commit。原始碼在 `kafka/coordinator/consumer.py`：`poll()` 裡呼叫 `_maybe_auto_commit_offsets_async()`。

`for msg in consumer:` 底下是這樣跑的：先呼叫一次 `poll()` 拿一批（最多 `max_poll_records=500` 筆），再一筆一筆交給你。整批跑完，才會呼叫下一次 `poll()`。

500 筆 × 每封 200ms ≈ **100 秒**。所以書籤最多會落後將近 100 秒，也就是將近 500 封信。5 秒那個設定實際上沒有作用：我把它改成 100ms 測過，重複的數量一封都沒少。

## 問題 2：deploy 時，process 是直接被殺掉的

Kubernetes 做 rolling update 時會對舊 pod 送 `SIGTERM`。Python 預設不處理 SIGTERM，process 會當場結束，不會跑任何收尾：

- 它不會再進 `poll()`，所以這一批已經寄出的信不會被 commit。
- 它不會呼叫 `consumer.close()`，所以不會通知 broker「我離開了」（LeaveGroup）。broker 要等 `session_timeout_ms`（預設 10 秒）都沒收到 heartbeat，才會判定它死了，然後 rebalance。

把這兩件事接起來，deploy 當下的時間線大概是：

```
t=0s     pod A 呼叫 poll() 拿到一批，書籤停在這批的開頭
t=0–40s  寄出 200 封信（書籤沒有動）
t=40s    deploy：SIGTERM → pod A 當場結束
t=50s    broker 等不到 heartbeat → rebalance，partition 交給 pod B
t=50s    pod B 從書籤開始讀 → 這 200 封信又寄一次
```

平常不會出事，因為 pod 不會死，每一批跑完就會 commit。**deploy 幾乎是唯一會在一批跑到一半時殺掉 process 的時機**，所以重複信只會出現在 deploy 之後。

## 我怎麼確認的

我在本機起了一個 3 個 partition 的 Kafka，把 `send_invoice_email` 換成假的（sleep 200ms 後記一筆）。接著跑 3 個 replica，在還有 600 張 invoice 等著寄的時候，模擬一次 Kubernetes rolling deploy：先起新 pod，再對舊 pod 送 SIGTERM，grace period 30 秒。

| 版本 | 實際寄出 | 收到重複信的客戶 | 漏寄 |
|---|---|---|---|
| 原本的 code | 820 封 | 220 位 | 0 |
| 原本的 code，auto-commit interval 改成 100ms | 820 封 | 220 位 | 0 |
| 修正後 | 600 封 | 0 | 0 |
| 修正後，舊 pod 改成直接 SIGKILL（模擬 OOM） | 600 封 | 0 | 0 |

原本的 code 只 deploy 一次，就有超過三分之一的客戶收到兩封。

## 修正（`evals/files/kafka-consumer/consumer.py`）

一共三個改動，各自對應上面的一個原因。

**1. 關掉 auto-commit，每寄完一封就 commit 那一封。** 這樣書籤最多只落後「正在寄的那一封」。

```python
send_invoice_email(invoice["customer_email"], invoice["pdf_url"])
consumer.commit({tp: OffsetAndMetadata(msg.offset + 1, "")})
```

要 `+1`，是因為 committed offset 的意思是「下一筆要讀的」。每次 commit 是一次到 broker 的 round trip，大約幾 ms，跟 200ms 的 SMTP 比可以忽略。

這裡有個陷阱：**不能只寫 `consumer.commit()`**。不帶參數時，它會 commit 這次 `poll()` 拿到的**整批**，包含還沒寄的信。這樣 process 一死，那些信就永遠不會寄出，問題會從「重複寄」變成「漏寄」，更糟。

**2. 處理 SIGTERM。** handler 只設一個 flag：讓目前這封寄完、commit 完，再離開迴圈。最後呼叫 `consumer.close()` 送出 LeaveGroup，partition 會馬上交給別的 replica，不用等 10 秒。handler 故意不直接 raise exception，因為那樣可能讓一封信寄到一半就被中斷。為了讓程式每秒至少檢查一次 flag（包含 topic 沒有新訊息的時候），我把 `for msg in consumer` 改成 `poll(timeout_ms=1000)` 迴圈。測試中舊 pod 收到 SIGTERM 後 0.1 秒就正常結束，遠低於 30 秒的 grace period。

**3. `max_poll_records` 從 500 改成 20。** 有了 1 和 2 之後，這已經不是重複信的原因，但還是值得改，理由有兩個：

- rebalance 時，整個 group 要等每個 consumer 都回到 `poll()` 才能完成。一批要跑 100 秒，代表每次 deploy 整個 group 最久會卡 100 秒。
- 如果 SMTP 變慢到一封超過 600ms，一批 500 筆就會超過 `max_poll_interval_ms`（預設 300 秒），consumer 會被踢出 group。這樣就算沒有 deploy，也會重複寄。

改成 20 筆後，一批大約 4 秒。

## 還沒解決的部分：這是 at-least-once，不是 exactly-once

修完之後，只剩一種情況會重複：信已經寄出、還沒 commit 的那幾 ms 之間，process 被硬殺（SIGKILL、OOM、node 掛掉）。這種情況每次最多重複 1 封。

這個洞 Kafka 本身補不起來。「寄信」和「存書籤」是兩個不同系統的動作，沒辦法保證它們一起成功或一起失敗。Kafka 的 exactly-once（transactions）只涵蓋 Kafka 寫到 Kafka 的情況，SMTP 不在範圍內。業界的做法是讓處理本身變成 **idempotent**：寄信前用 invoice id 查「寄過了沒」，寄完記錄下來，例如 DB 裡的 `emailed_at` 欄位，或 Redis 的 `SET NX`。

這段我沒有加，因為要看你們手上有什麼：message 裡除了 `customer_email` 和 `pdf_url`，有 invoice id 嗎？billing 那邊有 DB 可以記錄「已寄出」嗎？有的話我可以接著幫你加。

## 另外兩件小事

- 重現時我發現 kafka-python 2.0.2 在 Python 3.12 以上連 import 都會失敗（`No module named 'kafka.vendor.six.moves'`）。你們現在能跑，代表 Python 是 3.11 以下。哪天升級 Python，要跟著升級 kafka-python。新版的 `OffsetAndMetadata` 多了一個欄位（我確認的是 3.0.11），到時候那一行要改成 `OffsetAndMetadata(msg.offset + 1, "", -1)`。
- 以上是在本機 Kafka 加假寄信函式上測的，沒有在你們的環境跑過。上線後可以看 log 裡有沒有 `received signal 15` 這一行，確認 pod 是正常收尾的。

如果想檢查自己懂了沒，可以想想看：假如只做改動 1（每封 commit），不處理 SIGTERM，deploy 時最多會重複幾封？付出的代價又是什麼？
