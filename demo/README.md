# Demo：一次完整的 jit-learning-loop session

**線上版：** https://cyyeh.github.io/jit-learning-loop/

一位第一次碰 Redis lock 的工程師要修 checkout 的 double charge。這個 session 記錄 Agent 載入 `jit-learning-loop` skill 之後，如何在修好 bug 的同時，幫他建立可遷移的 mental model。

## 目錄

| 路徑 | 內容 |
|---|---|
| `transcript/NN-user.md` | 使用者（學習者）每一輪的訊息 |
| `transcript/NN-agent.md` | Agent 每一輪的回覆，原封不動 |
| `transcript/artifacts/` | Agent 跑過的指令輸出（重現測試、修正後的測試、檢驗答案的實驗） |
| `project/` | session 結束時的專案：修好的 `checkout/`、6 個 test、`LEARNING_LOG.md` |
| `changes.diff` | 相對於原始 code（`evals/files/checkout/`）的完整 diff |
| `eval-iteration-1/` | 4 個情境 × 有／沒有 skill 的 benchmark、評分與原始回覆 |
| `index.html` | GitHub Pages 頁面，執行時讀取上面這些檔案來呈現 |

## 怎麼錄的

- **Agent：** Claude（`claude-opus-5-5`）以 subagent 身分載入 `skills/jit-learning-loop/SKILL.md`，在 `project/` 裡真的讀 code、建 virtualenv、寫測試、跑測試、改 code。每一輪的回覆和指令輸出都是它自己存下來的。
- **使用者：** 由另一個 Claude 扮演「第一次碰 Redis lock 的後端工程師」，而且刻意帶了常見的誤解（asyncio 是 single-thread 所以不會 race、把 check 移到 lock 外「沒差」、release 會刪掉別人的 lock），用來示範預測被實驗推翻時，skill 怎麼處理。
- 錄製日期：2026-09-29。

## 自己重跑

```bash
cd demo/project
uv venv && uv pip install -r requirements.txt
.venv/bin/python -m pytest tests
```

本機預覽頁面：`python3 -m http.server -d demo`，再開 http://localhost:8000 。
