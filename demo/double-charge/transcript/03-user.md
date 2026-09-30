50ms 我猜 **1 次**吧？FastAPI 是 async，而 asyncio 不是 single-thread 嗎？同一個 process 裡一次應該只會跑一個 request，所以同一個 process 裡不會 race，只有兩個 request 被分到不同 process 才會出事。間隔 1 秒的話應該就是 1 次。

prod 我查了一筆：兩筆 charge 相差大約 180ms，第一個 request 回 200。`pg.py` 我看了，pool 接的是 primary，不是 replica。
