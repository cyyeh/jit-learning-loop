# Just-in-time learning loop（原始方法論）

> This is the source text the skill was distilled from. The skill (`skills/jit-learning-loop/`) is the operational version; this file is kept for provenance and for re-deriving the skill if it drifts.
>
> English translation: [`methodology.en.md`](methodology.en.md)

---

可以，而且我認為 **agentic coding 時代最重要的學習能力之一，就是「在解題途中學會剛好需要的東西」**，而不是先把整個技術學完才開始做。

關鍵是不要把流程變成：

> 不會 → Agent 幫我做 → 能跑 → 下一題

而要變成：

> 不會 → Agent 幫我縮小未知範圍 → 我建立 mental model → Agent 協作實作 → 我驗證 → 留下一個可遷移的模型

這可以稱為 **Just-in-time learning loop**。

## 我最推薦的 6 步

### 1. 先辨識「我到底不懂什麼」

Agentic coding 最危險的狀態不是不懂，而是：

> 我不知道自己不懂哪裡。

所以遇到陌生 task，不要第一句就：

> implement this for me

先問：

> 要完成這件事，我需要理解哪些概念？  
> 哪些是我已知技術的延伸，哪些是新的 mental model？  
> 先不要寫 code。

例如你第一次碰 Kafka，不需要「學 Kafka」。

可能只需要知道：

```text
我已經懂：
HTTP request
DB transaction
queue

我現在缺：
consumer group
offset
partition
delivery semantics
```

Agent 的第一個角色是：

**knowledge gap detector**。

---

## 2. 要 Agent 給你「最小充分模型」，不要給完整教程

這非常重要。

不要問：

> Teach me Kubernetes.

而問：

> 我正在 debug Kubernetes pod restart。  
> 請只告訴我完成這個 task 必須知道的 3–5 個概念，以及它們之間的關係。

目標不是 breadth，而是：

> **minimum viable mental model**

例如：

```text
Pod
 ↓ contains
Container
 ↓ exits
Restart policy
 ↓ triggers
Kubelet restart

但如果 Deployment controller 發現 Pod 不存在
 ↓
它又會建立新的 Pod
```

你有這張圖之後，再進 code/config。

這比一次吃五十頁文件有效很多。

---

# 3. 在 Agent 動手以前，先做 prediction

這一步是我認為最容易被忽略、但學習效果最大的。

Agent 說：

> 問題應該是 transaction isolation。

不要直接：

> fix it.

先逼自己回答：

> 如果這個解釋是對的，我預期會看到什麼？

例如：

```text
Hypothesis:
Two concurrent requests read the same old state.

Prediction:
Both logs should show the same version number.

Test:
Run two requests concurrently and inspect SQL trace.
```

然後讓 Agent 幫你做 test。

這時候你其實是在做真正的 engineering：

> model → prediction → experiment

而不是：

> prompt → code。

---

# 4. 讓 Agent 產生 code，但你負責「讀 delta」

不用每一行都從零開始寫。

Agentic coding 最大的 productivity gain 本來就是讓 Agent 寫。

但不要讀整個 repo。

只讀：

> **What changed and why?**

每次 Agent 修改後，固定回答四個問題：

```text
1. 改了哪些地方？
2. 為什麼是這些地方？
3. 最重要的新概念是什麼？
4. 如果這段壞掉，我第一個會查哪裡？
```

甚至可以直接要求 Agent：

> Explain this diff to me as if I need to maintain it six months later. Focus on design decisions, invariants and failure modes, not syntax.

你學到的是 architecture，不是 token。

---

# 5. 使用「逐步撤掉 Agent」的方法

這其實和教育上的 **scaffolding / fading** 很像。

第一次：

```text
Agent 80%
Human 20%
```

Agent：

- 解釋
- 寫 code
- 寫 tests
- debug

你理解。

第二次碰到類似問題：

```text
Agent 50%
Human 50%
```

你先提出 solution，讓 Agent critique。

第三次：

```text
Human 80%
Agent 20%
```

你做，Agent review。

例如第一次學 React Server Components：

### 第一次

> Explain and implement it.

### 第二次

> 我認為這個 component 應該是 server component，原因是 A/B/C。Review my reasoning.

### 第三次

直接自己做，只問：

> Find flaws in this implementation.

這樣 Agent 才是在**加速 skill acquisition**。

否則 Agent 只是在加速 task completion。

---

# 6. 每個 task 結束，只抽取 1–3 個 transferable lessons

不要寫超長筆記。

Agentic coding 的 learning log 可以非常短：

```text
Task:
Fix Redis race condition

Learned:
1. SET NX can implement simple locking.
2. Lock ownership matters when releasing.
3. TTL prevents dead locks but introduces lease-expiry races.

Next time:
Consider Redlock / fencing token for stronger guarantees.
```

最重要的問題是：

> **下次碰到另一個問題，我會因為今天學到什麼而做得更快？**

如果答案是：

> 我知道這個 repo 哪個 file 要改

這是 local knowledge。

如果答案是：

> 我知道 distributed lock 的 invariants

這就是 transferable knowledge。

你應該特別保留後者。

---

# 更進一步：把「未知」分成四種類型

我現在在 agentic coding 裡會建議工程師先判斷 unknown type。

| Unknown | 最有效的 Agent 使用方式 |
|---|---|
| **Concept unknown** | explain / analogy / mental model |
| **API unknown** | docs search / minimal example |
| **Codebase unknown** | repo exploration / dependency tracing |
| **Behavior unknown** | hypothesis / instrumentation / experiment |

這四個不要混在一起。

例如：

> 為什麼這個 async function 有 race condition？

這可能是 **concept unknown**。

> 這個 repo 哪裡初始化 connection pool？

這是 **codebase unknown**。

> 最新的 OpenAI SDK 怎麼設定 tool calling？

這是 **API unknown**。

> 為什麼 production 偶爾 timeout？

這是 **behavior unknown**。

不同類型，learning strategy 完全不同。

---

# 我尤其推薦一個 Agent prompt pattern

你可以把原本：

> Fix this bug.

改成：

```text
Help me solve this, but optimize for both task completion and learning.

First:
1. Identify what I likely need to understand.
2. Give me the minimum mental model.
3. State 2–3 hypotheses.

Then:
4. Show me what evidence would distinguish them.
5. Investigate the codebase.
6. Propose the smallest change.

After implementation:
7. Explain the diff.
8. Give me 3 questions that test whether I actually understand it.
```

這個模式很好用。

因為 Agent 不只是：

**coder**

而同時變成：

**teacher + researcher + reviewer**。

---

# 但有一個更大的觀念轉變

傳統工程師的學習方式比較像：

```text
Study
 ↓
Understand
 ↓
Practice
 ↓
Build
```

Agentic coding 時代可以變成：

```text
Build
 ↓
Encounter unknown
 ↓
Learn minimum model
 ↓
Experiment
 ↓
Implement
 ↓
Reflect
 ↓
Generalize
 ↓
Continue building
```

也就是：

## **Learning becomes embedded inside production.**

你不必先學完 Kubernetes、Rust、DuckDB internals、React compiler 才能開始。

你可以在真正問題出現的 moment 學。

---

## 但有一條界線非常重要

有些東西適合 **on-the-fly learning**：

- 新 library
- 新 SDK
- framework API
- repo architecture
- unfamiliar tooling
- deployment procedure

但有些東西值得建立比較深的 foundation：

- concurrency
- database transactions
- networking
- distributed systems
- algorithms
- type systems
- security
- operating systems

因為如果底層 mental model 太薄，你甚至不知道：

> Agent 給你的答案哪裡不合理。

所以理想模型不是：

> **Just-in-time learning replaces fundamentals**

而是：

> **Fundamentals + Just-in-time specialization**

---

### 最後濃縮成一句

Agentic coding 時代，高效學習不是：

> **「我要不要讓 Agent 幫我？」**

而是每次問：

> **「這次我要把哪一部分 cognitive work 留給自己，才能讓完成這個 task 的同時，我下一次不再需要同樣程度的幫助？」**

這其實就是 Agent 時代很值得訓練的 **learning agency**。對資深工程師尤其重要，因為未來真正稀缺的可能不是「知道最多技術」，而是**進入陌生領域後，能多快建立正確 mental model 並開始有效工作**。
