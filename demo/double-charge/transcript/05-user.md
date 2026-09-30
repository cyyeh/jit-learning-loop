1. 換成 `asyncio.Lock()` 的話，lock 只存在單一 process 的記憶體裡。prod 有 12 個 process，兩下點擊被分到不同 process 就各拿各的 lock，一樣會扣兩次。測試會過，是因為 test 全部在同一個 process 裡跑。

2. `blocking=True` 的話 B 會等 A 做完才繼續，所以應該還是只扣一次，只是 B 比較慢才回應？`get_order` 移到 `acquire` 前面我覺得沒差，因為 `charge_card` 還是被 lock 包住。

3. 會扣兩次，因為 0.5 秒 lock 就過期了，B 可以拿到 lock。A 走到 `release()` 的時候……應該會把 B 的 lock 刪掉？這樣如果還有 C 就更糟了。

另外我問過了：`payments.internal` 有支援 `Idempotency-Key` header。不過這個我想下次自己試著加加看，到時候你再幫我 review 就好。

learning log 幫我寫在 repo 根目錄的 `LEARNING_LOG.md`。
