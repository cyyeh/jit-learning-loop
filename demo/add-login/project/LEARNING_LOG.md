# Learning log

新的在最上面。只留下次遇到「不同」問題時也用得上的 lessons。

## 2026-09-30 · Backend auth：login 與 session
Task: 在 mobile 上線前，把 prototype 的 `X-User-Id` 換成真正的 login（bearer session token）
Unknown types: concept（authn vs. authz、JWT vs. session token、hash）、API（FastAPI `HTTPBearer`）、codebase（`current_user_id`）、behavior（多個 worker process 之間的 state）
Learned:
1. JWT 是 signed，不是 encrypted，而且是 stateless：拿到的人都讀得到 payload；要在 exp 之前撤銷，就得在 server 端記 state（一張表），而那正是 session token 本來的做法。JWT 的價值在「好幾個 service 要各自驗 token、又沒有共用 storage」的時候。
2. Hash 只能藏住 entropy 夠高的秘密。32 bytes 隨機值：快的 SHA-256 就夠。password、PIN、6 位數驗證碼：所有可能值都能離線試完，要用慢的 salted hash，再加上線上限制（嘗試次數、rate limit、短效期），或乾脆提高 entropy。
3. 每個 worker 是獨立的 process，各有自己的記憶體。module 層級的 state（隨機產生的 secret、in-memory dict、cache）不會共享；所有 worker 都必須一致的東西，要放 DB 或 config / env。
Next time: 自己做「改密碼 + 所有裝置登出」，做完再 review。上線前讀 OWASP Session Management Cheat Sheet。
Level: 1，下次 auth 相關 task 試 level 2
