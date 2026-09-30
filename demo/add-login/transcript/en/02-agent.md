Sure. Adding auth to this repo is actually a small change, but there's one decision to make before touching code: **JWT or session token**. You said you don't want to ship auth you don't understand, and that decision is the heart of it. So this round I'll lay out the map and the model first, and end by asking you for a prediction. Next round I'll run the experiments and change code.

## What this task needs

**You already have:** HTTP headers, sending `Authorization: Bearer ...` with `fetch` on the frontend, the DevTools Network tab.

**Missing:**
- authentication vs. authorization: "who you are" and "what you're allowed to do" are two different things (concept)
- how login trades a password for a token, and how the token gets verified: JWT vs. session token (concept; today's main decision)
- how to write it with PyJWT, or with Python's `secrets` + SQLite (API; I'll check the docs for the installed version when we build it)
- where this repo decides "who you are" (codebase; I've already looked, see below)

This sits on a fundamental: **security**. Today's model is enough to do this task right, but before launch it's worth spending an evening on OWASP's *Authentication Cheat Sheet* and *Session Management Cheat Sheet*; if we end up choosing JWT, add RFC 8725 (JWT Best Current Practices).

## The repo today

```text
the 4 /notes routes ──Depends──▶ current_user_id()   (notes/app.py:38)
                                   └─ returns the X-User-Id header's value, trusted as is
get_note / delete_note ──▶ 404 if owner_id != user_id    ← authorization; this part is right
passwords.verify_password()                              ← already written (scrypt + constant-time compare), unused so far
```

`current_user_id` is the only place in the whole app that decides "who you are," so the change will be concentrated: add `/login` (and `/logout`), and replace what `current_user_id` does. I've already set up the venv, and the existing 3 tests all pass (`artifacts/02-baseline-tests.txt`). They all use `X-User-Id` as the identity; later they'll change to logging in first.

One thing to agree on up front: from launch day, the server can no longer accept `X-User-Id` (as long as it still accepts it, the hole is still there), so the web frontend has to switch to logging in first and sending a Bearer token in the same release. That part happens to be the side you know.

## Minimum model

The problem today isn't "no check." The owner check is correct, but the user_id it trusts is filled in by the client itself. Anyone can hit *Copy as cURL* on a request in DevTools, change `X-User-Id: 1` to `2`, and they're bob. What's missing is authentication: the server has to be able to confirm that this identity is **proof it issued itself**, not the client's own claim.

```text
Once:     POST /login {email, password}
            └─▶ verify_password() ✓ ─▶ server issues a token to the client

Every request after that:
  Authorization: Bearer <token>
            └─▶ current_user_id() verifies the token ─▶ user_id ─▶ owner check (already there)

There are two ways to "verify the token":
  A. JWT            the token itself says {sub: 1, exp: expiry time}, followed by a signature
                    verify = recompute the signature with the server's secret, compare, check exp. No DB lookup.
  B. Session token  the token is just a meaningless random string
                    verify = look it up in the DB's sessions table: "whose is this, has it expired?"
```

A signature is a value computed over the token's content with a secret only the server knows (HS256 is HMAC-SHA256). Without the secret, you can't compute the right signature.

One correction to the `Authorization: Bearer ...` you know: **Bearer is the envelope, not the contents.** It means "whoever holds it is the owner": whoever has this string, the server treats as that user. It's more like a concert ticket than an ID card checked against your face. Whether the envelope holds a JWT or a random string, the client code on web and mobile is exactly the same. So "use JWT" and "use a Bearer token" are two different things, and whichever of A or B we pick, your mobile colleague adds the same header.

Not covered yet (all important, but none of them affects choosing between A and B): rate limiting on `/login`, password reset, where the web app keeps the token (memory / localStorage / httpOnly cookie). And one thing that isn't a choice: production must use HTTPS. A Bearer token over plain HTTP is like handing your ticket to a passer-by.

## Two candidate approaches

| | **A. JWT** (stateless) | **B. Session token stored in SQLite** (stateful) |
|---|---|---|
| What the client gets after login | `xxxxx.yyyyy.zzzzz` (header, content, signature) | a 32-byte random string (`secrets.token_urlsafe(32)`) |
| What the server has to keep | one secret (an environment variable) | a `sessions` table: token, user_id, expiry |
| How each request is verified | check signature + exp, no DB | one lookup in the `sessions` table |
| Biggest selling point | verification without the DB: many servers and many services can each verify without shared storage | no signing secret or algorithm to configure correctly; the code is reads and writes on one table |
| alice's phone is stolen, and that phone must be logged out right now | **?** | **?** |

Two kinds of evidence decide between A and B:

- **Architecture facts:** the top of `app.py` says "one VM, 2 uvicorn workers, sharing one SQLite file," and every notes request opens SQLite anyway. How much A's biggest selling point is worth on this architecture is something you can weigh yourself.
- **Behavior:** the two question marks in the table's last row are what I'm asking you to predict below.

About "everyone does it": your mobile colleague isn't wrong. JWT is very common, especially when several services each need to verify the same token, or when you integrate third-party login (an OpenID Connect ID token is a JWT). B is the older approach, and plenty of sites still use it. Neither is wrong; the question is which has fewer pitfalls under your conditions. It's worth asking them one thing: did they say JWT because the app needs to read the token's contents itself, or because another service needs to verify this token? If so, that counts in A's favor.

There's also a C: hand the whole thing to a third-party identity provider (Auth0, Firebase Auth, Cognito and the like). It comes with password reset and MFA, but signup would have to be rewired, and you'd still need to understand how to verify the tokens it issues (usually JWTs). You already have signup and scrypt hashing, and launch is next month, so I won't go into it this time, unless the PM also wants social login or MFA.

## Your turn

Next I'll build a minimal version of both A and B (in scratch, without touching your repo), have alice (id=1) log in and get a token, and then actually run the three things below. Guess first; a few words per question is fine, or say "skip":

1. **Read:** can someone without the server secret (for example, anyone who sees this token in DevTools) read alice's user id in the token? A? B?
2. **Tamper:** (A) change `sub` in the token's content from `1` to bob's `2`, then send `GET /notes`. What does the server return?
3. **Revoke:** alice's phone is stolen, and you want the token on that phone to stop working right now. What can A and B each do on the server side? Afterwards, when the thief sends `GET /notes` with the same token, what does each return?

Question 3 is the two question marks in the table, and it's also the biggest difference between A and B. Once you reply, I'll run the experiments and compare them with your predictions, then we'll decide together which one to use before changing code.
