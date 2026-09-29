# Eval iteration 1

4 個情境，有 skill 和沒有 skill 各跑一次（同一個模型，只比較第一輪回覆）。完整摘要見 [`benchmark.md`](benchmark.md)。

| 情境 | 有 skill | 沒有 skill |
|---|---|---|
| 1 · Redis lock double charge | 8/8 | 3/8 |
| 2 · k8s OOMKilled restarts | 6/6 | 3/6 |
| 3 · Django N+1（level 2：使用者自己提方案） | 6/6 | 5/6 |
| 4 · Kafka 重複寄信（繁中） | 7/7 | 4/7 |

每個情境的資料夾裡：

- `eval_metadata.json`：prompt 和 assertions
- `with_skill/`、`without_skill/`：
  - `response.md`：原始回覆
  - `grading.json`：逐條評分與依據
  - `changed-files/`：如果 agent 改了 code 才會有

Prompt 和測試資料在 repo 的 `evals/`。
