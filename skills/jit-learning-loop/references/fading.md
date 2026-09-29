# Fading: removing the scaffolding

Read this when deciding which assistance level to use, or when moving a user between levels.

The idea comes from education research on *scaffolding and fading*. Support is heavy at first, then gradually removed, so the learner ends up doing the whole task alone. Without fading, an agent speeds up *task completion*. With it, the agent speeds up *skill acquisition*.

## The levels

| Level | Split | Agent does | User does |
|---|---|---|---|
| 1 · Guided | agent ~80% | explain, implement, write tests, debug | predict, read the diff, answer the check questions |
| 2 · Shared | ~50/50 | critique the user's proposal, fill gaps, pair on the implementation | propose the approach and reasoning *first* |
| 3 · Review | agent ~20% | find flaws, ask probing questions | design and implement |

## Choosing a level

Signals, strongest first:

1. **An explicit request.** "Level 2 on this", "just review mine", "walk me through it from scratch".
2. **The learning log.** An earlier entry on this topic that ends in "try level 2 next" or later.
3. **The request itself.** A user who arrives with a proposal ("I think the fix is `select_related`...") is at level 2 or higher, whatever the log says. Respect the proposal.
4. **Vocabulary.** Using the domain's terms correctly suggests familiarity. Using them loosely or not at all suggests level 1.

When unsure, start at level 1 but leave room: "Want to take a guess at the approach first, or should I lay it out?"

Levels belong to a *topic*, not a person. Someone can be at level 3 in SQL and level 1 in Kubernetes on the same day.

## Worked example: React Server Components across three encounters

**First encounter (level 1).** The user asks to move data fetching into server components.
- Gap map: "Have: React hooks, fetch, SSR basics. Missing: the server/client component boundary (concept), `'use client'` and what can cross the boundary (API)."
- Minimum model: server components render once on the server with no state and no effects; client components hydrate. Props crossing the boundary must be serializable.
- The agent implements it, explains the diff, and asks: "Why can't you pass an `onClick` from a server component to a client one?"
- Log: "Level 1. Try level 2 next time."

**Second encounter (level 2).** A new page needs the same treatment.
- The agent doesn't propose first: "Which components here do you think should be server components, and why?"
- The user says: "ProductList is server because it only fetches and renders. AddToCart is client because of useState. ProductCard... server?"
- The agent critiques: "Right on the first two. ProductCard has an onMouseEnter prefetch, so it has to be client, or you split that handler out into a small client child. What's the trade-off between those two options?"
- They implement it together.

**Third encounter (level 3).** The user builds the page alone and asks for a review.
- The agent asks questions rather than rewriting: "What happens to this context provider now that its parent is a server component?"
- It points out flaws with severity. It doesn't rewrite the code.

## Anti-patterns

- **Taking over at level 2.** The proposal is 80% right, so the agent "just fixes the rest" by rewriting it. Instead, name the 20% and let the user close it.
- **Endless questions at level 3.** If they're stuck after one hint, give a stronger hint, then the answer. The goal is learning, not making them feel tested.
- **Staying at level 1 forever.** If the user answered the checks well last time, say so and move them up.
- **Fading during an incident.** When prod is down, drop to level 1 for speed and run the higher-level exercise in the debrief.
