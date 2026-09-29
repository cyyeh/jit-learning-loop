# Demo: one full jit-learning-loop session

**Live page:** https://cyyeh.github.io/jit-learning-loop/ (English / 繁體中文 toggle; `?lang=en` or `?lang=zh`)

An engineer who has never used a Redis lock needs to fix a checkout that sometimes charges customers twice. This is the record of an agent with the `jit-learning-loop` skill fixing the bug while helping them build a mental model they can reuse.

## Contents

| Path | What's in it |
|---|---|
| `transcript/NN-user.md` | The learner's messages (original, Traditional Chinese) |
| `transcript/NN-agent.md` | The agent's replies, verbatim (original, Traditional Chinese) |
| `transcript/en/` | Faithful English translation of every turn; code, commands and output unchanged |
| `transcript/artifacts/` | Raw output of the commands the agent ran: repro test, tests after the fix, the experiment that checks the learner's answers |
| `project/` | The project at the end of the session: fixed `checkout/`, 6 tests, `LEARNING_LOG.md` (+ `LEARNING_LOG.en.md`) |
| `changes.diff` | Full diff against the original code (`evals/files/checkout/`) |
| `eval-iteration-1/` | Benchmark, grades and raw replies for 4 scenarios × with/without the skill |
| `index.html` | The GitHub Pages site; it reads the files above at runtime |

## How it was recorded

- **Agent:** Claude (`claude-opus-5-5`) as a subagent loaded `skills/jit-learning-loop/SKILL.md` and worked in `project/` for real. It read code, created a virtualenv, wrote tests, ran them and changed code. It saved every reply and command output itself.
- **User:** another Claude played "a backend engineer new to Redis locks", with deliberate common misconceptions: that asyncio is single-threaded so there's no race, that moving the check outside the lock makes no difference, and that release would delete someone else's lock. They show how the skill handles predictions that experiments overturn.
- **Language:** recorded in Traditional Chinese on 2026-09-29. The English version is a translation.

## Run it yourself

```bash
cd demo/project
uv venv && uv pip install -r requirements.txt
.venv/bin/python -m pytest tests
```

Preview the page locally: `python3 -m http.server -d demo`, then open http://localhost:8000.

---

# Demo：一次完整的 jit-learning-loop session

**線上版：** https://cyyeh.github.io/jit-learning-loop/?lang=zh

一位第一次碰 Redis lock 的工程師要修 checkout 的 double charge。這份紀錄呈現 Agent 載入 `jit-learning-loop` skill 之後，如何在修好 bug 的同時，幫他建立可遷移的 mental model。

- `transcript/`：每一輪的原文（繁體中文）；`transcript/en/` 是英文翻譯
- `transcript/artifacts/`：Agent 跑過的指令輸出
- `project/`：修好的 code、6 個 test、`LEARNING_LOG.md`
- `changes.diff`：相對於原始 code 的完整 diff
- `eval-iteration-1/`：4 個情境 × 有／沒有 skill 的 benchmark 與原始回覆

**怎麼錄的：** Agent 那一方是載入 skill 的 Claude subagent 的真實輸出；使用者那一方由另一個 Claude 扮演學習者，並刻意帶了常見誤解。錄製日期：2026-09-29。
