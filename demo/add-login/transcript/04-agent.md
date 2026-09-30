實驗跑完了（`artifacts/04-jwt-vs-session.txt`，放在 scratch，沒動你的 repo）。你說跑完直接做，所以 B 已經做好也測過了。下面依序是：實驗 vs. 預測、為什麼選 B、改了什麼、diff 解說，最後是三個問題。

## 實驗 vs. 你的預測

| | 你的預測 | 實際結果 |
|---|---|---|
| 1 讀，A | 讀不出來（有加密） | **讀得出來**：`{"sub":"1","exp":1790733286}` |
| 1 讀，B | 讀不出來 | 讀不出來，解開是 32 bytes 亂數 |
| 2 改 `sub`，A | 401 | 401，server log：`InvalidSignatureError` |
| 3 logout 後小偷重送，A | 401 | **200 `{"user_id":1}`**，而且還能再用 3600 秒 |
| 3 logout 後小偷重送，B | 401 | 401 |

**第 1 題是這次最值得記的地方。** JWT 是**簽章 (signed)**，不是**加密 (encrypted)**。前兩段只是 base64url 編碼，在瀏覽器 console 用 `atob()` 就解得開（遇到 `-`、`_` 先換成 `+`、`/`），不需要任何 secret。簽章保證的是 integrity（內容沒被改過、確實是 server 發的），不保證 confidentiality（別人看不到）。你第 2 題答對，理由也完全正確，那正好是簽章負責的那一半。實務上的推論：JWT payload 裡不要放任何不想讓拿到 token 的人看到的東西。（另外有加密版的 JWE，但很少用。）

**第 3 題你的直覺對一半。** 「logout 就該讓 server 作廢 token」這個要求是對的。卡住的地方是：A 的 server 要把「作廢」記在哪？A 的設計就是 server 不記任何 token，所以實驗裡 A 的 `/logout` 函式本體只能寫 `pass`：回了 204，但什麼都沒變。要讓 A 能作廢，只有三條路：

- 在 DB 放一張黑名單，每個 request 都查一次。這樣 A「不查 DB」的賣點就沒了，等於 B 再加上 JWT 的複雜度。
- 換掉 secret。所有使用者會一起被登出。
- 等它過期。把 exp 設很短（例如 15 分鐘），再另外發一個 refresh token，讓 app 不用一直重新登入。但 refresh token 要能撤銷，就得存在 server 端，又回到一張表。

這也是為什麼網路上的 JWT 做法，最後常常長成「access token + refresh token + 一張表」。

## 決定：B，理由

1. **撤銷是 mobile 的硬需求。** 手機會掉、會被偷，「登出」必須讓 token 真的失效。B 天生做得到，A 要多加一層才做得到。
2. **A 的賣點在這裡用不上。** 一台 VM、2 個 worker、共用一個 SQLite 檔；每個 notes request 本來就在查 SQLite，多查一次幾乎沒有成本。你問到的也證實了：app 不讀 token 內容，也沒有別的 service 要驗。
3. **要看懂、要顧的東西比較少。** 沒有 signing secret 要保管，沒有 algorithm 要設對（JWT 經典的 `alg: none` 漏洞就出在這），沒有 refresh flow，也不用加任何 dependency（`secrets`、`hashlib` 都是標準庫）。

什麼時候該回頭考慮 A：有好幾個獨立的 service 都要驗同一個 token，又不想讓它們都連到同一個 session store 的時候。

可以直接轉給 mobile 同事的一句話：「`POST /login` 拿 `access_token`，之後帶 `Authorization: Bearer <token>`；token 是 opaque 字串，不要 parse；收到 401 就回登入頁。」

## 改了什麼

完整 diff：`artifacts/04-diff.txt`

- `notes/sessions.py`（新）：發 token、查 token、撤銷 token，三個函式。
- `notes/db.py`：新增 `sessions` 表和 4 個 query。
- `notes/app.py`：新增 `POST /login`、`POST /logout`；`current_user_id` 改成讀 `Authorization: Bearer`。**`X-User-Id` 完全不再接受。**
- tests：fixtures 改成 signup 後真的 login；原本 3 個 test 本身沒動，只改了 `as_user` helper 的一行；新增 `tests/test_auth.py`（8 個 test）。

驗證：

- 11 個 test 全過：`artifacts/04-tests.txt`
- 用真的 uvicorn 開 2 個 worker、共用一個 SQLite 檔，跟 prod 一樣。token 在一個 worker 發，兩個 worker 都認；在其中一個 logout，兩個都回 401：`artifacts/04-two-workers.txt`
- 故意弄壞四個地方（logout 不刪 row、不檢查過期、存明文 token、把 `X-User-Id` 當 fallback），每一個都有 test 抓到：`artifacts/04-mutation-check.txt`

## Diff 解說

**為什麼改在這裡：** `current_user_id` 是 4 個 notes route 共用的 dependency，只換掉它的內容，route 本身和 owner 檢查都不用動。我沒有改用 middleware 一次擋全部，因為 `/signup`、`/login` 本來就不該要求登入；用 `Depends` 的話，看 route 的參數就知道它要不要登入。

**Key idea：** token 本身沒有意義，`sessions` 表才是「誰正在登入」的唯一真相。登入 = 插入一列，登出 = 刪掉那一列，過期 = `expires_at` 過了。

幾個你之後會被問到的設計決定：

- **DB 只存 token 的 SHA-256。** DB 或備份外洩時，裡面沒有可以直接拿來用的 token。client 送來的 token 先 hash 再查表。
- **登入失敗只有一種訊息。** email 不存在和密碼錯，回一模一樣的 401，不告訴對方是哪一個。（老實說 `/signup` 的 409 已經會透露 email 有沒有註冊，要堵就得兩邊一起改，這次沒做。）
- **Session 30 天到期。** 這是 product 決定，不是技術決定，要改就改 `SESSION_TTL_SECONDS`。目前是固定 30 天，不會因為有在用就自動延長。過期的列會在下次有人 login 時順手刪掉。
- **`/logout` 是 idempotent。** 已經登出或不存在的 token 一樣回 204，app 重送不會出錯。
- **FastAPI 內建的 `HTTPBearer`** 在缺 header 或不是 Bearer 時回 401 + `WWW-Authenticate: Bearer`。這是我看你裝的 0.142.1 原始碼確認的（`.venv/lib/python3.11/site-packages/fastapi/security/http.py`）；舊版 FastAPI 這裡回 403，網路上的舊文章可能跟你看到的不一樣。附帶好處：`/docs` 多了一個 Authorize 按鈕，可以貼 token 直接試。

**Invariants（必須一直成立）和出事時先看哪：**

1. **每個驗 token 的 process 都要看到同一張 `sessions` 表。** 現在 2 個 worker 共用一個 SQLite 檔，所以成立。出事時先確認每個 process 的 `NOTES_DB` 指向同一個檔案。
2. **每個需要登入的 route 都要有 `Depends(current_user_id)`。** 新 route 忘了加，它就是公開的。code review 時看 route 的參數。
3. **token 只走 HTTPS，也不能進 log。** 不要把 `Authorization` header 印到 access log 或 error tracking。拿到 token 的人，就是那個使用者。

## 你那一側（web）要改的

1. 登入表單 → `POST /login`，拿回 `access_token`
2. 每個 request 帶 `Authorization: Bearer <token>`，拿掉 `X-User-Id`
3. 收到 401 → 清掉 token，導回登入頁
4. 登出 → `POST /logout`，再清掉本地的 token

因為 `X-User-Id` 已經不收了，後端和 web 前端要同一次上線。token 在瀏覽器裡要存哪（memory / localStorage / httpOnly cookie）是下一個要做的決定，牽涉 XSS，值得在上線前談一次，但不擋這次的改動。

## 換你了：三個問題

每題一兩句就好。我先不給答案，你回完我再看你的推理。

1. alice 發現密碼外洩，改了密碼。以現在的 code，她舊手機上的 session 還有效嗎？如果 PM 要求「改密碼 = 所有裝置登出」，你會加哪一行 SQL、放在哪個流程裡？
2. 下一個功能是 password reset。同事提議：「reset 碼做成 6 位數字比較好輸入；DB 裡照 sessions 的做法存 SHA-256 就好。」這兩個決定放在一起，哪裡有問題？（想想 password 和 session token 為什麼用不同的 hash。）
3. 假設當初選了 A，有人為了省事，把 JWT secret 寫成 app 啟動時用 `secrets.token_hex(32)` 隨機產生，而不是從環境變數讀。在你們 2 個 worker 的部署下，使用者會看到什麼症狀？每次 deploy 重啟之後呢？

回答完，我會把這次 1–3 個可以帶走的 lessons 整理成一則 learning log。你有在記嗎？沒有的話，我建議放在 repo 根目錄的 `LEARNING_LOG.md`。
