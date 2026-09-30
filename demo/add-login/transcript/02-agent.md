可以。這個 repo 要加 auth，改動範圍其實不大，但動 code 之前有一個決定要先做：**JWT 還是 session token**。你說不想上線自己看不懂的 auth，重點就在這個決定，所以這一輪我先把地圖和 model 攤開，最後請你做一個預測。下一輪再跑實驗、動 code。

## 這個 task 需要什麼

**已經有：** HTTP headers、前端用 `fetch` 帶 `Authorization: Bearer ...`、DevTools Network tab。

**缺的：**
- authentication vs. authorization：「你是誰」和「你能做什麼」是兩件事（concept）
- login 怎麼用密碼換 token、token 怎麼被驗證：JWT vs. session token（concept，今天主要的決定）
- PyJWT 或 Python `secrets` + SQLite 的寫法（API，動手時對照實際裝的版本查 docs）
- repo 在哪裡決定「你是誰」（codebase，我已經查好，見下）

這落在一個 fundamental：**security**。今天的 model 夠把這個 task 做對，但上線前值得花一個晚上讀 OWASP 的 *Authentication Cheat Sheet* 和 *Session Management Cheat Sheet*；如果最後選 JWT，再加 RFC 8725（JWT Best Current Practices）。

## Repo 現況

```text
/notes 的 4 個 route ──Depends──▶ current_user_id()   (notes/app.py:38)
                                    └─ 回傳 X-User-Id header 的值，直接相信
get_note / delete_note ──▶ owner_id != user_id 就 404    ← authorization，這段寫得對
passwords.verify_password()                              ← 已經寫好（scrypt + constant-time 比對），還沒人用
```

整個 app 只有 `current_user_id` 一個地方在決定「你是誰」，所以改動會很集中：新增 `/login`（和 `/logout`），換掉 `current_user_id` 的內容。venv 我已經建好，現有 3 個 test 全過（`artifacts/02-baseline-tests.txt`）；它們都靠 `X-User-Id` 當身分，之後會改成先 login。

要先講好的一點：上線那天 server 就不能再接受 `X-User-Id`（只要還收，洞就還在），所以 web 前端要在同一版改成先 login、再帶 Bearer。這部分剛好是你熟的那一側。

## Minimum model

現在的問題不是「沒檢查」：owner 檢查沒錯，但它相信的 user_id 是 client 自己填的。任何人在 DevTools 對 request 按 *Copy as cURL*，把 `X-User-Id: 1` 改成 `2`，就是 bob 了。缺的是 authentication：server 要能確認這個身分是**它自己發出去的證明**，不是 client 的自我宣稱。

```text
一次：    POST /login {email, password}
            └─▶ verify_password() ✓ ─▶ server 發一個 token 給 client

之後每個 request：
  Authorization: Bearer <token>
            └─▶ current_user_id() 驗 token ─▶ user_id ─▶ owner 檢查（已經有了）

「驗 token」有兩種做法：
  A. JWT            token 裡直接寫著 {sub: 1, exp: 到期時間}，後面附一段簽章
                    驗 = 用 server 的 secret 重算簽章、比對、看 exp。不查 DB。
  B. Session token  token 只是一串無意義的隨機字
                    驗 = 去 DB 的 sessions 表查「這串是誰的、過期沒」。
```

簽章是用只有 server 知道的 secret，對 token 內容算出來的值（HS256 就是 HMAC-SHA256）。沒有 secret，就算不出對的簽章。

你熟的 `Authorization: Bearer ...` 有一處要修正：**Bearer 是信封，不是內容。** 它的意思是「持有者即本人」：誰拿著這串字，server 就當他是誰。這比較像演唱會門票，而不是要對照臉的身分證。信封裡裝 JWT 或裝隨機字，web 和 mobile 的 client code 一模一樣。所以「用 JWT」和「用 Bearer token」是兩件事，mobile 同事那邊不管選 A 或 B，都是加同一個 header。

先不談（都重要，但不影響 A/B 怎麼選）：`/login` 的 rate limiting、password reset、web 端 token 要存哪（memory / localStorage / httpOnly cookie）。另外有一條不用選：上線一定要 HTTPS，Bearer token 走明文 HTTP，等於把門票遞給路人。

## 兩個候選做法

| | **A. JWT**（stateless） | **B. Session token 存 SQLite**（stateful） |
|---|---|---|
| login 後發給 client | `xxxxx.yyyyy.zzzzz`（header、內容、簽章） | 32 bytes 隨機字串（`secrets.token_urlsafe(32)`） |
| server 要保管 | 一個 secret（環境變數） | 一張 `sessions` 表：token、user_id、到期時間 |
| 每個 request 怎麼驗 | 驗簽章 + exp，不碰 DB | 查一次 `sessions` 表 |
| 最大賣點 | 不查 DB 就能驗：很多台 server、很多個 service 不用共用 storage，也能各自驗證 | 沒有 signing secret 和 algorithm 要設定對，程式就是一張表的讀寫 |
| alice 手機被偷，要立刻登出那支手機 | **?** | **?** |

判斷 A/B 的證據有兩類：

- **架構事實：** `app.py` 開頭寫著「一台 VM、2 個 uvicorn worker、共用同一個 SQLite 檔」，而且每個 notes request 本來就會開 SQLite。A 的最大賣點在這個架構上值多少，你可以自己掂量。
- **行為：** 表格最後一列的兩個問號，就是下面要你預測的。

關於「大家都這樣做」：mobile 同事沒說錯，JWT 很常見，特別是有多個 service 要各自驗同一個 token，或接第三方登入的時候（OpenID Connect 的 ID token 就是 JWT）。B 是更早的做法，現在也還有很多網站在用。兩個都不是錯，問題是在你們的條件下哪個坑比較少。值得問他一句：他說 JWT，是因為 app 要自己讀 token 內容，或有別的 service 要驗這個 token 嗎？如果是，A 會加分。

還有一個 C：整個交給第三方 identity provider（Auth0、Firebase Auth、Cognito 之類）。它會附送 password reset、MFA，但 signup 要重接，你也還是得懂它發的 token（通常就是 JWT）怎麼驗。你已經有 signup 和 scrypt hashing，下個月就要上線，這次我先不展開，除非 PM 也要 social login 或 MFA。

## 換你了

我下一步會把 A 和 B 各做一個最小版本（放在 scratch，不動你的 repo），讓 alice（id=1）登入拿到 token，然後實際跑下面三件事。先猜，每題幾個字就好，或說 "skip"：

1. **讀：** 一個沒有 server secret 的人（例如在 DevTools 看到這個 token 的任何人），讀得出 token 裡 alice 的 user id 嗎？A？B？
2. **改：**（A）把 token 內容裡的 `sub` 從 `1` 改成 bob 的 `2`，再送 `GET /notes`，server 回什麼？
3. **撤銷：** alice 手機被偷，你們想立刻讓那支手機上的 token 失效。A 和 B 各自在 server 端能做什麼？做完之後小偷用同一個 token 送 `GET /notes`，各回什麼？

第 3 題就是表格裡那兩個問號，也是 A、B 最大的差別。你回覆後我跑實驗、對照你的預測，然後我們一起決定用哪個，再動 code。
