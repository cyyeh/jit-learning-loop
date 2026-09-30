# Demo: recorded jit-learning-loop sessions

**Live page:** https://cyyeh.github.io/jit-learning-loop/ (English / 繁體中文 toggle with `?lang=en` or `?lang=zh`; pick a scenario with `?demo=add-login`, the default, or `?demo=double-charge`)

Each scenario is the record of an agent with the `jit-learning-loop` skill doing real work in a real project while helping the learner build a mental model they can reuse.

| Scenario | Kind | The learner |
|---|---|---|
| [`add-login/`](add-login/) | Build a feature | A React developer who has never built auth has to add login to a notes API before the mobile app launches. A teammate says "just use JWT." |
| [`double-charge/`](double-charge/) | Fix a bug | An engineer who has never used a Redis lock has to fix a checkout that sometimes charges customers twice. |

## Contents

Every scenario folder has the same layout:

| Path | What's in it |
|---|---|
| `transcript/NN-user.md` | The learner's messages (original, Traditional Chinese) |
| `transcript/NN-agent.md` | The agent's replies, verbatim (original, Traditional Chinese) |
| `transcript/en/` | Faithful English translation of every turn; code, commands and output unchanged |
| `transcript/artifacts/` | Raw output of the commands the agent ran: experiments, test runs |
| `project/` | The project at the end of the session, with its tests and `LEARNING_LOG.md` (+ `LEARNING_LOG.en.md`) |
| `changes.diff` | Full diff against the code the session started from |

Also here:

| Path | What's in it |
|---|---|
| `eval-iteration-1/` | Benchmark, grades and raw replies for 4 scenarios × with/without the skill |
| `index.html` | The GitHub Pages site; it reads the files above at runtime |

## add-login: build a feature you've never built

The session starts from a small FastAPI + SQLite notes API whose web app sent the user's id in an `X-User-Id` header (`changes.diff` is the full change against it). Because this is a feature to build, step 3 of the loop compares candidate approaches (a JWT vs. an opaque session token stored in SQLite) instead of hypotheses about a bug. The simulated learner carries deliberate common misconceptions: that a JWT is encrypted, that the server can void a JWT at logout, that a 6-digit reset code stored as SHA-256 is safe because session tokens are stored that way, and that uvicorn workers share a module-level secret. Experiments overturned all four, and on the evidence the agent built session tokens rather than the JWT the teammate suggested. Recorded on 2026-09-30.

The agent ran its experiments (JWT vs. session token, two real uvicorn workers, a random JWT secret, cracking a 6-digit code) in a scratch directory, so only their output is kept, in `transcript/artifacts/`.

## double-charge: fix a bug you don't understand yet

The checkout code comes from `evals/files/checkout/` (`changes.diff` is against it). The simulated learner carries deliberate common misconceptions: that asyncio is single-threaded so there's no race, that moving the check outside the lock makes no difference, and that release would delete someone else's lock. They show how the skill handles predictions that experiments overturn. Recorded on 2026-09-29.

## How they were recorded

- **Agent:** Claude (`claude-opus-5-5`) as a subagent loaded `skills/jit-learning-loop/SKILL.md` and worked in the scenario's `project/` for real. It read code, created a virtualenv, wrote tests, ran them and changed code. It saved every reply and command output itself.
- **User:** another Claude played the learner, with deliberate common misconceptions (listed per scenario above).
- **Language:** recorded in Traditional Chinese. The English version is a translation.

## Run it yourself

```bash
cd demo/add-login/project        # or demo/double-charge/project
uv venv && uv pip install -r requirements.txt
.venv/bin/python -m pytest tests
```

Preview the page locally: `python3 -m http.server -d demo`, then open http://localhost:8000.

To add a scenario, give it a folder with the layout above and an entry in `SCENARIOS` in `index.html`. The first entry is the page's default.

---

# Demo：真實錄製的 jit-learning-loop session

**線上版：** https://cyyeh.github.io/jit-learning-loop/?lang=zh（用 `?demo=add-login`（預設）或 `?demo=double-charge` 選情境）

- `add-login/`（做新功能）：平常寫 React 的工程師，第一次做 auth 就要在 mobile app 上線前替 notes API 加上登入。同事說「用 JWT 就好」。
- `double-charge/`（修 bug）：第一次碰 Redis lock 的工程師，要修 checkout 偶爾 double charge 的問題。

每個情境資料夾裡：

- `transcript/`：每一輪的原文（繁體中文）；`transcript/en/` 是英文翻譯
- `transcript/artifacts/`：Agent 跑過的指令輸出
- `project/`：session 結束時的 code、test 和 `LEARNING_LOG.md`
- `changes.diff`：相對於起始 code 的完整 diff

`eval-iteration-1/` 是 4 個情境 × 有／沒有 skill 的 benchmark 與原始回覆。

**怎麼錄的：** Agent 那一方是載入 skill 的 Claude subagent 的真實輸出；使用者那一方由另一個 Claude 扮演學習者，並刻意帶了常見誤解。
