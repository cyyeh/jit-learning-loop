The experiments are done (`artifacts/04-jwt-vs-session.txt`; they ran in scratch, your repo wasn't touched). You said to go ahead once they'd run, so B is already built and tested. In order below: experiment vs. prediction, why B, what changed, the diff explained, and finally three questions.

## The experiment vs. your predictions

| | Your prediction | What actually happened |
|---|---|---|
| 1 Read, A | Can't be read (it's encrypted) | **Readable**: `{"sub":"1","exp":1790733286}` |
| 1 Read, B | Can't be read | Can't be read; decoding it gives 32 random bytes |
| 2 Change `sub`, A | 401 | 401, server log: `InvalidSignatureError` |
| 3 Thief resends after logout, A | 401 | **200 `{"user_id":1}`**, and it stays usable for another 3600 seconds |
| 3 Thief resends after logout, B | 401 | 401 |

**Question 1 is the thing most worth remembering from this round.** A JWT is **signed**, not **encrypted**. The first two parts are just base64url-encoded, and `atob()` in the browser console decodes them (swap `-` and `_` for `+` and `/` first). No secret needed. A signature guarantees integrity (the content hasn't been changed, and the server really issued it), not confidentiality (nobody else can see it). You got question 2 right, with exactly the right reasoning, and that's precisely the half a signature is responsible for. The practical consequence: never put anything in a JWT payload that you don't want whoever holds the token to see. (There's an encrypted variant, JWE, but it's rarely used.)

**On question 3, your instinct is half right.** The requirement "logout should make the server void the token" is correct. Where it gets stuck: where would A's server record the "void"? A is designed so the server doesn't keep any record of tokens, so in the experiment the body of A's `/logout` could only be `pass`: it returned 204, but nothing changed. There are only three ways to make A revocable:

- Put a denylist in the DB and check it on every request. Then A's "no DB lookup" selling point is gone, and you've got B plus the complexity of JWT.
- Rotate the secret. Every user gets logged out at once.
- Wait for it to expire. Set a very short exp (say 15 minutes), and issue a separate refresh token so the app doesn't keep asking for the password. But for the refresh token to be revocable, it has to be stored on the server side, and you're back to a table.

That's also why JWT setups you find online often end up as "access token + refresh token + a table."

## Decision: B, and why

1. **Revocation is a hard requirement for mobile.** Phones get lost and stolen, and "log out" has to actually kill the token. B does that by design; A needs an extra layer to do it.
2. **A's selling point doesn't apply here.** One VM, 2 workers, one shared SQLite file; every notes request already queries SQLite, so one more lookup costs almost nothing. What you found out confirms it: the app doesn't read the token's contents, and no other service needs to verify it.
3. **Less to understand and less to look after.** No signing secret to guard, no algorithm to get right (JWT's classic `alg: none` vulnerability lives there), no refresh flow, and no new dependency (`secrets` and `hashlib` are in the standard library).

When to reconsider A: when several independent services all need to verify the same token and you don't want them all connecting to the same session store.

One sentence you can forward to your mobile colleague as is: "`POST /login` to get an `access_token`, then send `Authorization: Bearer <token>`; the token is an opaque string, don't parse it; on a 401, go back to the login screen."

## What changed

Full diff: `artifacts/04-diff.txt`

- `notes/sessions.py` (new): issue a token, look up a token, revoke a token. Three functions.
- `notes/db.py`: a new `sessions` table and 4 queries.
- `notes/app.py`: new `POST /login` and `POST /logout`; `current_user_id` now reads `Authorization: Bearer`. **`X-User-Id` is no longer accepted at all.**
- tests: the fixtures now really log in after signup; the original 3 tests themselves are unchanged, only one line of the `as_user` helper changed; new `tests/test_auth.py` (8 tests).

Verification:

- All 11 tests pass: `artifacts/04-tests.txt`
- Ran real uvicorn with 2 workers sharing one SQLite file, the same as prod. A token issued by one worker is accepted by both; after logging out on one of them, both return 401: `artifacts/04-two-workers.txt`
- Deliberately broke four things (logout doesn't delete the row, expiry not checked, plaintext token stored, `X-User-Id` kept as a fallback), and a test caught each one: `artifacts/04-mutation-check.txt`

## The diff explained

**Why the change is here:** `current_user_id` is the dependency all 4 notes routes share, so only its contents changed; the routes themselves and the owner check didn't need to. I didn't switch to a middleware that blocks everything at once, because `/signup` and `/login` shouldn't require login in the first place. With `Depends`, a route's parameters tell you whether it requires login.

**Key idea:** the token itself means nothing; the `sessions` table is the single source of truth for "who is logged in." Login = insert a row, logout = delete that row, expiry = `expires_at` has passed.

A few design decisions you'll get asked about later:

- **The DB stores only the token's SHA-256.** If the DB or a backup leaks, there's no token in it that can be used directly. The token the client sends is hashed first, then looked up.
- **Login failure has only one message.** A nonexistent email and a wrong password get exactly the same 401, without telling the caller which one it was. (To be honest, the 409 from `/signup` already reveals whether an email is registered; closing that means changing both, which I didn't do this time.)
- **Sessions expire after 30 days.** That's a product decision, not a technical one; to change it, change `SESSION_TTL_SECONDS`. Right now it's a fixed 30 days and doesn't extend automatically with use. Expired rows get cleaned up the next time anyone logs in.
- **`/logout` is idempotent.** A token that's already logged out or doesn't exist still gets 204, so an app retry won't cause an error.
- **FastAPI's built-in `HTTPBearer`** returns 401 + `WWW-Authenticate: Bearer` when the header is missing or isn't Bearer. I confirmed this in the source of the 0.142.1 you have installed (`.venv/lib/python3.11/site-packages/fastapi/security/http.py`); older FastAPI versions returned 403 here, so older articles online may not match what you see. Side benefit: `/docs` gets an Authorize button where you can paste a token and try things directly.

**Invariants (must always hold), and where to look first when something breaks:**

1. **Every process that verifies tokens must see the same `sessions` table.** Right now the 2 workers share one SQLite file, so it holds. When something breaks, first check that every process's `NOTES_DB` points to the same file.
2. **Every route that requires login must have `Depends(current_user_id)`.** A new route that forgets it is public. In code review, look at the route's parameters.
3. **Tokens only travel over HTTPS and must never end up in logs.** Don't print the `Authorization` header to the access log or error tracking. Whoever gets the token is that user.

## What changes on your side (web)

1. Login form → `POST /login`, get back `access_token`
2. Send `Authorization: Bearer <token>` with every request; remove `X-User-Id`
3. On a 401 → clear the token and go back to the login page
4. Logout → `POST /logout`, then clear the local token

Since `X-User-Id` is no longer accepted, the backend and web frontend have to ship in the same release. Where the browser keeps the token (memory / localStorage / httpOnly cookie) is the next decision to make. It involves XSS and is worth discussing once before launch, but it doesn't block this change.

## Your turn: three questions

A sentence or two each is fine. I'll hold back the answers; once you reply I'll go over your reasoning.

1. alice finds out her password leaked and changes it. With the current code, is the session on her old phone still valid? If the PM asks for "change password = log out every device," what line of SQL would you add, and in which flow?
2. The next feature is password reset. A colleague proposes: "Make the reset code 6 digits so it's easy to type; store its SHA-256 in the DB, the same way sessions do." Put those two decisions together: what's wrong? (Think about why passwords and session tokens use different hashes.)
3. Suppose we'd picked A, and someone, to save effort, made the JWT secret generated at app startup with `secrets.token_hex(32)` instead of read from an environment variable. With your 2-worker deployment, what symptoms would users see? And after each deploy restart?

Once you've answered, I'll put together 1–3 lessons from this session that you can take with you, as a learning log entry. Do you keep one? If not, I suggest `LEARNING_LOG.md` in the repo root.
