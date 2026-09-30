1. 還有效。`sessions` 表只看 `token_hash` 和 `expires_at`，跟密碼完全沒關係，改密碼不會動到它。要「改密碼 = 所有裝置登出」的話，就在改密碼的流程裡、更新完 `password_hash` 之後加一行 `DELETE FROM sessions WHERE user_id = ?`。

2. 6 位數字只有一百萬種組合，攻擊者可以一直打 reset API 暴力猜，所以要加 rate limit，或錯幾次就讓那個碼作廢。存 SHA-256 我覺得沒問題吧？sessions 也是這樣存的，hash 過之後就算 DB 外洩也看不到原本的碼。

3. 2 個 worker 應該沒差：它們跑的是同一個 app，module 只會 import 一次，`secrets.token_hex(32)` 產生的 secret 大家共用。每次 deploy 重啟之後 secret 會換，舊 token 全部失效，所有人都要重新登入。

另外，改密碼（含所有裝置登出）這個我想下次自己做做看，做完再給你 review。learning log 我之前沒在記，就照你說的放 repo 根目錄的 `LEARNING_LOG.md`。
