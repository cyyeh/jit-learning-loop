I've gone through all three. Question 1 is completely right, question 2 is half right, and on question 3 the second half is right and the first half is wrong, and the wrong half happens to be the most valuable lesson of this session. For questions 2 and 3 I ran a small experiment each (both in scratch, your repo wasn't touched) and let the evidence speak.

## 1. Completely right

Both the reasoning and the answer are right: the `sessions` table is the single source of truth for "who is logged in," and it has no column that has anything to do with the password, so changing the password can't touch it. Adding `DELETE FROM sessions WHERE user_id = ?` after updating `password_hash` is right too. This one is yours to build next time (see the end).

## 2. The online half is right; the offline half isn't

"A million combinations, an attacker can keep hitting the API and guessing, so rate limit and void the code after a few wrong tries": right. That's an online attack, and your instinct is good. One addition: the code should expire quickly (say 15 minutes).

But "storing SHA-256 is fine" doesn't hold. The experiment (`artifacts/06-crack-6-digit.txt`):

```text
SHA-256, try every 6-digit code: found 396291 after 396,292 guesses in 0.25 s (one CPU core, plain Python)
session token: 32 random bytes = 2**256 = 1.16e+77 possible values
at the same 1,559,114 guesses/s, expected time to hit one: 1.2e+63 years
scrypt (repo params): 37 ms per guess -> all 10**6 codes: 10.3 hours on one core
```

Once the DB leaks, the attacker doesn't need to hit your API. They hash all one million codes on their own machine, compare with the value in the DB, and know the original code in 0.25 seconds. A rate limit can't stop that at all, because they never connect to your server.

Here's where your analogy breaks: session tokens are safe **not because of SHA-256, but because 32 random bytes have 2^256 possible values**, far too many to try. A hash is one-way, but "one-way" only means you can't compute it backwards; it doesn't mean you can't **compute every possible input**. When the input space is small, a hash can't hide it. That's also why `passwords.py` uses scrypt, which is deliberately slow: trying the same million goes from 0.25 seconds to about 10 hours (one core; faster if the attacker uses more machines).

So the real protection for a 6-digit reset code is a short expiry + a cap on attempts, and a slow hash only buys time. The other route is to not use 6 digits at all, and email a link with a long random token instead. Then it's just like sessions, and SHA-256 is enough again.

## 3. The restart half is right; the 2-worker half isn't

"After each deploy restart all the old tokens stop working": right.

"The module is only imported once" is true **within one process**. But `--workers 2` is **two processes**. uvicorn starts its workers with `spawn` (I looked at `uvicorn/_subprocess.py` in uvicorn 0.54), so each worker is a brand-new Python interpreter that imports the app once on its own and runs `secrets.token_hex(32)` once on its own. The experiment (`artifacts/06-random-secret-2-workers.txt`):

```text
worker pid=4119 imported this module, secret fingerprint=eece5ad0
worker pid=4118 imported this module, secret fingerprint=3546ff4e
# POST /login answered by pid=4118
# 20 x GET /notes with that token, new connection each time:
     16 200 pid=4118
      4 401 pid=4119
```

Two workers, two different secrets. The token was signed by 4118: a request that lands on 4118 gets 200, one that lands on 4119 gets 401. What users see is "I get logged out out of nowhere now and then, and a refresh fixes it," and you mostly can't reproduce it locally, because dev usually runs only 1 worker. Bugs like this eat the most time.

Think of it with something you know: open the same React app in two browser tabs. Same bundle, same code, but each tab has its own module variables and state, and whatever you change in tab 1, tab 2 can't see at all. The workers are those two tabs.

This is the same thing as invariant 1 from last round: every process that verifies tokens has to see the same state. B's state is the `sessions` table, so it lives in the shared SQLite; A's state is the secret, so it has to be read from an environment variable. If B's sessions had been kept in a Python dict, it would have broken in exactly the same way.

This question touches a fundamental: **processes and memory** (operating systems). Today's model is enough, but later it's worth reading chapters 4–5 of *Operating Systems: Three Easy Pieces* (free online), on processes and the process API. For question 2, I recommend OWASP's *Password Storage Cheat Sheet*.

## Learning log

I've created `LEARNING_LOG.md` in the repo root. This is the first entry:

```text
## 2026-09-30 · Backend auth: login and sessions
Task: Before the mobile launch, replace the prototype's `X-User-Id` with real login (bearer session token)
Unknown types: concept (authn vs. authz, JWT vs. session token, hashing), API (FastAPI `HTTPBearer`), codebase (`current_user_id`), behavior (state across multiple worker processes)
Learned:
1. A JWT is signed, not encrypted, and stateless: anyone who gets it can read the payload, and revoking it before exp means keeping state on the server (a table), which is exactly what a session token does in the first place. JWT earns its keep when several services each need to verify the token and there's no shared storage.
2. A hash can only hide a secret with enough entropy. 32 random bytes: a fast SHA-256 is enough. Passwords, PINs, 6-digit codes: every possible value can be tried offline, so use a slow salted hash plus online limits (attempt caps, rate limiting, short expiry), or raise the entropy.
3. Each worker is a separate process with its own memory. Module-level state (a randomly generated secret, an in-memory dict, a cache) isn't shared; anything all workers must agree on belongs in the DB or in config / env.
Next time: Build "change password + log out every device" yourself, then review. Before launch, read the OWASP Session Management Cheat Sheet.
Level: 1, try level 2 on the next auth task
```

All three come from where you guessed wrong or were only half right. Where you guess wrong is where the model needs fixing.

## Next time: change password + log out every device (level 2)

Good, let's do it that way. Level 2 means: you propose the approach and implement it yourself; when I review, I point out holes with questions and don't rewrite it for you. I suggest writing the test first (you can model it on `test_logout_kills_every_copy_of_the_token`), then the code, and send me the diff when you're done.

Take one question with you; no need to answer it now: **should the device that's changing the password log itself out too?** Either choice makes sense; what matters is that you can explain why once you've chosen.

Not done yet, remember to schedule before launch:

- web frontend switches to Bearer, shipped in the same release as the backend
- decide where the web app keeps the token (memory / localStorage / httpOnly cookie)
- rate limiting on `/login`
- read the OWASP *Session Management Cheat Sheet*
