1. Still valid. The `sessions` table only looks at `token_hash` and `expires_at`; it has nothing to do with the password, so changing the password doesn't touch it. For "change password = log out every device," add one line to the change-password flow, right after updating `password_hash`: `DELETE FROM sessions WHERE user_id = ?`.

2. Six digits is only a million combinations, so an attacker can keep hitting the reset API and brute-force it. It needs a rate limit, or the code should be voided after a few wrong tries. Storing SHA-256 seems fine to me, though? That's how sessions are stored too, and once it's hashed, even if the DB leaks nobody can see the original code.

3. The 2 workers shouldn't matter: they run the same app, the module is only imported once, and everyone shares the secret that `secrets.token_hex(32)` generated. After each deploy restart the secret changes, all the old tokens stop working, and everyone has to log in again.

Also, I'd like to try building change password (including logging out every device) myself next time, and then you review it. I haven't been keeping a learning log, so let's put it where you suggested: `LEARNING_LOG.md` in the repo root.
