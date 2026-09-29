# Learning Log

## 2026-09-29 · Redis lock / check-then-act race
Task: 修 checkout 在使用者連點 Pay 時 double charge 的問題
Unknown types: concept（race、distributed lock、TTL）、API（redis-py `lock()` = `SET NX PX` + Lua release）、behavior（為什麼只是「偶爾」）
Learned:
1. Single-thread 的 async 不等於一次只處理一個 request：每個 `await` 都是讓出點。只要出現 check → `await` → act，就是 race，單一 process 也一樣。另外，只跑在一個 process 裡的測試抓不到跨 process 的 bug。
2. Lock 保護的是「決定」，不是某個 function call：用來做決定的那次讀取（「付過了嗎？」）必須在拿到 lock **之後**才做。在 lock 外讀到的資料，進了 lock 就可能已經過時，這時 lock 只是讓兩次 charge 排隊執行，擋不掉。
3. 有 TTL 的 lock 其實是一份租約（lease）：它能避免 deadlock，但持有者太慢時會過期。release 一定要比對 ownership token，不然會刪掉別人的 lock，後面的人就跟著進來了。牽涉到錢時，真正的保證要放在副作用那一端（`Idempotency-Key`），不是 lock。
Next time: 自己在 `charge_card` 加上 `Idempotency-Key`，寫完交給 agent review。之後讀：DDIA 的 "Transactions" 和 "The Trouble with Distributed Systems"，以及 Kleppmann 的 "How to do distributed locking"（fencing token）。
Level: 1。下一個 concurrency bug 試 level 2（先自己提出做法）；`Idempotency-Key` 這個後續由你實作、agent 只 review。
