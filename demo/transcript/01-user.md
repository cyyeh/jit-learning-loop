我們的 checkout endpoint 偶爾會 double charge，通常是使用者連點兩下 Pay 的時候（code 在 `checkout/`）。同事說「在外面包一個 redis lock 就好」。我 redis 只拿來當 cache 用過，老實說不知道 redis 的 lock 到底是什麼意思。可以幫我修嗎？我想真的搞懂自己在做什麼，不是只貼一段 code。
