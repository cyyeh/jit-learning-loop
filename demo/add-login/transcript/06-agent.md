三題都看了。第 1 題完全對，第 2 題對一半，第 3 題後半對、前半錯，而錯的那半剛好是這次最值得帶走的一課。第 2、3 題我各跑了一個小實驗（都在 scratch，沒動你的 repo），讓證據說話。

## 1. 完全正確

推理和答案都對：`sessions` 表是「誰正在登入」的唯一真相，裡面沒有任何跟密碼有關的欄位，所以改密碼碰不到它。在更新 `password_hash` 之後加 `DELETE FROM sessions WHERE user_id = ?`，也對。這題就留給你下次自己做（見最後）。

## 2. 線上那半對，離線那半不對

「一百萬種組合，攻擊者可以一直打 API 猜，所以要 rate limit、錯幾次就作廢」：對，這是 online 攻擊，你的直覺很好。再補一個：效期要短（例如 15 分鐘）。

但「存 SHA-256 沒問題」不成立。實驗（`artifacts/06-crack-6-digit.txt`）：

```text
SHA-256, try every 6-digit code: found 396291 after 396,292 guesses in 0.25 s (one CPU core, plain Python)
session token: 32 random bytes = 2**256 = 1.16e+77 possible values
at the same 1,559,114 guesses/s, expected time to hit one: 1.2e+63 years
scrypt (repo params): 37 ms per guess -> all 10**6 codes: 10.3 hours on one core
```

DB 外洩之後，攻擊者不用打你的 API。他在自己的電腦上把一百萬個碼全部 hash 一遍，跟 DB 裡的值比對，0.25 秒就知道原本的碼。rate limit 在這裡完全擋不到，因為他根本沒連你的 server。

你的類比斷在這裡：session token 安全，**不是因為 SHA-256，而是因為 32 bytes 隨機值有 2^256 種可能**，試不完。hash 是單向的，但「單向」只代表不能倒著算，不代表不能**把所有可能的輸入都算一遍**。輸入空間小，hash 就藏不住。這也是 `passwords.py` 用刻意很慢的 scrypt 的原因：同樣試一百萬個，從 0.25 秒變成約 10 小時（單核；攻擊者多開幾台就更快）。

所以 6 位數 reset 碼真正的保護是短效期 + 嘗試次數上限，慢的 hash 只是多爭取時間。另一條路是不用 6 位數，改寄一個帶長隨機 token 的連結。那就跟 sessions 一樣，SHA-256 又夠了。

## 3. restart 那半對，2 個 worker 那半不對

「每次 deploy 重啟後舊 token 全部失效」：對。

「module 只會 import 一次」在**一個 process 裡**是對的。但 `--workers 2` 是**兩個 process**。uvicorn 用 `spawn` 開 worker（我看的是 uvicorn 0.54 的 `uvicorn/_subprocess.py`），每個 worker 是全新的 Python interpreter，各自 import 一次 app，各自跑一次 `secrets.token_hex(32)`。實驗（`artifacts/06-random-secret-2-workers.txt`）：

```text
worker pid=4119 imported this module, secret fingerprint=eece5ad0
worker pid=4118 imported this module, secret fingerprint=3546ff4e
# POST /login answered by pid=4118
# 20 x GET /notes with that token, new connection each time:
     16 200 pid=4118
      4 401 pid=4119
```

兩個 worker、兩個不同的 secret。token 是 4118 簽的，request 打到 4118 就 200，打到 4119 就 401。使用者看到的症狀是「偶爾莫名其妙被登出，重新整理又好了」，而且你在本機多半重現不了，因為 dev 通常只開 1 個 worker。這類 bug 最花時間。

用你熟的東西想：同一個 React app 開兩個 browser tab。同一份 bundle、同一段 code，但每個 tab 有自己的 module 變數和 state，在 tab 1 改了什麼，tab 2 完全看不到。worker 就是那兩個 tab。

這跟上一輪的 invariant 1 是同一件事：每個驗 token 的 process 都要看到同一份 state。B 的 state 是 `sessions` 表，所以放在共用的 SQLite；A 的 state 是 secret，所以要從環境變數讀。如果當初 B 的 sessions 放在 Python dict 裡，也會壞成一模一樣的樣子。

這題碰到一個 fundamental：**process 與記憶體**（operating systems）。今天的 model 夠用，之後值得讀 *Operating Systems: Three Easy Pieces*（免費線上版）講 process 和 process API 的第 4–5 章。第 2 題那塊則推薦 OWASP 的 *Password Storage Cheat Sheet*。

## Learning log

建好了 repo 根目錄的 `LEARNING_LOG.md`，這是第一則：

```text
## 2026-09-30 · Backend auth：login 與 session
Task: 在 mobile 上線前，把 prototype 的 `X-User-Id` 換成真正的 login（bearer session token）
Unknown types: concept（authn vs. authz、JWT vs. session token、hash）、API（FastAPI `HTTPBearer`）、codebase（`current_user_id`）、behavior（多個 worker process 之間的 state）
Learned:
1. JWT 是 signed，不是 encrypted，而且是 stateless：拿到的人都讀得到 payload；要在 exp 之前撤銷，就得在 server 端記 state（一張表），而那正是 session token 本來的做法。JWT 的價值在「好幾個 service 要各自驗 token、又沒有共用 storage」的時候。
2. Hash 只能藏住 entropy 夠高的秘密。32 bytes 隨機值：快的 SHA-256 就夠。password、PIN、6 位數驗證碼：所有可能值都能離線試完，要用慢的 salted hash，再加上線上限制（嘗試次數、rate limit、短效期），或乾脆提高 entropy。
3. 每個 worker 是獨立的 process，各有自己的記憶體。module 層級的 state（隨機產生的 secret、in-memory dict、cache）不會共享；所有 worker 都必須一致的東西，要放 DB 或 config / env。
Next time: 自己做「改密碼 + 所有裝置登出」，做完再 review。上線前讀 OWASP Session Management Cheat Sheet。
Level: 1，下次 auth 相關 task 試 level 2
```

三條都來自你猜錯或只對一半的地方。猜錯的地方，就是 model 需要修的地方。

## 下次：改密碼 + 所有裝置登出（level 2）

好，就這樣做。level 2 的意思是：你先提做法、自己實作，我 review 時用問題指出漏洞，不直接幫你改寫。建議先寫 test（可以照 `test_logout_kills_every_copy_of_the_token` 的樣子），再寫 code，做完把 diff 丟給我。

帶一個問題去做，現在不用回答：**正在改密碼的那台裝置，自己要不要也登出？** 兩種都說得通，重點是你選了之後講得出理由。

上線前還沒做、記得排進去的：

- web 前端改用 Bearer，並且跟後端同一次上線
- 決定 web 端 token 存哪（memory / localStorage / httpOnly cookie）
- `/login` 的 rate limiting
- 讀 OWASP *Session Management Cheat Sheet*
