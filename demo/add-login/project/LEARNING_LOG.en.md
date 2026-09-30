# Learning log

Newest first. Keep only lessons that will still help the next time a *different* problem comes up.

## 2026-09-30 · Backend auth: login and sessions
Task: Before the mobile launch, replace the prototype's `X-User-Id` with real login (bearer session token)
Unknown types: concept (authn vs. authz, JWT vs. session token, hashing), API (FastAPI `HTTPBearer`), codebase (`current_user_id`), behavior (state across multiple worker processes)
Learned:
1. A JWT is signed, not encrypted, and stateless: anyone who gets it can read the payload, and revoking it before exp means keeping state on the server (a table), which is exactly what a session token does in the first place. JWT earns its keep when several services each need to verify the token and there's no shared storage.
2. A hash can only hide a secret with enough entropy. 32 random bytes: a fast SHA-256 is enough. Passwords, PINs, 6-digit codes: every possible value can be tried offline, so use a slow salted hash plus online limits (attempt caps, rate limiting, short expiry), or raise the entropy.
3. Each worker is a separate process with its own memory. Module-level state (a randomly generated secret, an in-memory dict, a cache) isn't shared; anything all workers must agree on belongs in the DB or in config / env.
Next time: Build "change password + log out every device" yourself, then review. Before launch, read the OWASP Session Management Cheat Sheet.
Level: 1, try level 2 on the next auth task
