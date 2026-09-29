會幫你修。不過真正的修法不只是改一個設定，所以先花兩分鐘把模型建起來，再用一個小實驗對答案，最後才動 code。

## 這個任務需要懂什麼

**已經有：** Python、deploy 流程（K8s rolling update 會開新 pod、關舊 pod），還有「email 寄出去就收不回來」的直覺。

**還缺：**
- consumer group、partition、offset、commit 之間怎麼分工（concept）
- kafka-python 2.0.2 的 auto-commit 實際上「什麼時候」送出 commit（API。我已經先讀過 2.0.2 的原始碼確認，等你猜完再對答案）
- deploy 關 pod 的那幾秒，這個 process 實際發生了什麼（behavior，要靠實驗才看得到）
- 為什麼「寄 email」和「記下進度」沒辦法保證同時成功或同時失敗，也就是 at-least-once delivery（concept · **fundamental: distributed systems**）

> 這次建立的模型夠你修完這個 bug，但如果之後要判斷別人（或 agent）說的「exactly-once」是不是真的，就需要 delivery semantics 的基礎。之後可以讀 *Designing Data-Intensive Applications* 的 Stream Processing 章節，裡面 Fault Tolerance 那段有講 exactly-once 和 idempotence。今天先不展開。

## 最小模型

```text
"invoices" topic 的一個 partition = 一條只會往後 append 的 log（讀過也不會刪）

  ...[ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ]...   ← 每格是一張 invoice，有自己的 offset
            ▲                       ▲
     committed offset            position
     = 書籤，存在 Kafka            = 這個 pod 實際處理到哪
       整個 group 共用               只存在 pod 的記憶體裡
            └──── 這一段：email 已經寄了，
                  但 Kafka 不知道 ────┘

consumer group "invoice-mailer" = 你的 3 個 pod
  • 同一時間，一個 partition 只會分給一個 pod
  • 有 pod 加入、離開或死掉 → rebalance → partition 重新分配
  • 接手的 pod 從「書籤」開始讀，不是從前一個 pod 的 position 接著讀
```

- **commit** 就是 consumer 自己告訴 Kafka「書籤移到這裡」。`enable_auto_commit=True` 代表交給 library 定期做，`auto_commit_interval_ms=5000` 是間隔。
- `for msg in consumer` 看起來是一次拿一筆，其實底層是 `poll()` 一次抓回一批（最多 `max_poll_records=500` 筆），再一筆一筆交給你。每筆要寄 ~200ms。

**錨點：** consumer group 很像一群 worker 共用一個 job queue（Celery、SQS、RabbitMQ 那種）。**這個類比失效的地方，正好就是 bug 所在：** job queue 通常是每則訊息各自 ack，Kafka 沒有 per-message ack，每個 partition 只有一個書籤。所以書籤和 position 之間的**整段**，換手時都會重做一次。Kafka 也完全不知道你寄了 email，它只認書籤。

這次先不談：partition assignment strategy、consumer lag、Kafka transactions（它的 exactly-once 管不到 SMTP 這種外部副作用，所以這題用不上）。

## 假設

目前的 code 完全沒有 log，所以現有資訊還分辨不出下面三個假設。能分辨它們的關鍵問題是：**重複的那兩封，是同一個 (partition, offset) 被處理了兩次，還是兩個不同的 offset？**

| | 假設 | 如果成立，會看到 |
|---|---|---|
| **H1** | deploy 關 pod 時，沒有 commit 到最新進度。這支程式沒有處理 SIGTERM，也從來不呼叫 `consumer.close()`，所以不管 process 是收到 SIGTERM 當場結束，還是撐到 grace period 結束才被 SIGKILL，書籤都停在舊位置。接手的 pod 就會把「書籤之後、其實已經寄過」的那一段再寄一次 | 同一個 offset 寄了兩封；第一封是舊 pod 被關**之前**寄的，第二封是**另一個** pod 在 rebalance 之後寄的；重複的是一段**連續**的 offset |
| **H2** | 某個 pod 處理一批花太久（500 × 200ms ≈ 100 秒；SMTP 一變慢，就會超過 `max_poll_interval_ms` 預設的 300 秒），被踢出 group，partition 分給了別人，但它自己還是把手上那批寄完 | 同一個 offset，但兩個 pod **都還活著**；log 裡有 `Heartbeat poll expired, leaving group` 或 `CommitFailedError`；就算沒有 deploy，SMTP 慢的時候也會發生 |
| **H3** | 訊息本來就進了 topic 兩次（例如上游 producer 在 deploy 時 retry） | 同一張 invoice 對應到**兩個不同的 offset** |

我目前最看好 H1，因為它跟 deploy 直接相關。以現在的數字來看，H2 比較不可能發生。H3 檢查成本很低，順手排除就好。

**下一步（等你回覆後）：** 在本機用 Docker 起一個 Kafka，把 `send_invoice_email` 換成假的版本（sleep 200ms，並記下 pod、partition、offset、invoice id），灌 2000 張 invoice。處理到一半時對 consumer 送 SIGTERM，再開另一個 consumer 接手，數數看有幾封重複。確認之後才改 code。

## 換你

假設 H1 是對的：deploy 關掉**一個** pod 時，**最多大概會有幾封** email 被重寄？這個上限主要由下面哪個數字決定？

- `auto_commit_interval_ms=5000`
- `max_poll_records=500`
- 每封 ~200ms

一行猜測就好，像「大約 X 封，由 Y 決定」這樣就行。猜錯完全沒關係，猜錯的地方通常最值得細看。如果想直接往下，說「skip」，我就直接跑實驗、修 code。
