"""Login sessions: opaque bearer tokens backed by the sessions table.

The client gets a random token and sends it as `Authorization: Bearer <token>`.
The token means nothing by itself; the sessions table says whose it is and
until when. Logging out deletes the row, so the token (and every copy of it)
stops working on the next request.

Only the SHA-256 of the token is stored, so a leaked database or backup does
not contain working tokens. A fast hash is enough here, unlike passwords: the
token is 32 random bytes, far too many possibilities to guess by brute force.
"""
import hashlib
import secrets
import time

from . import db

SESSION_TTL_SECONDS = 30 * 24 * 3600  # 30 days: mobile users expect to stay logged in


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create(user_id: int) -> str:
    """Start a session for user_id and return the bearer token (shown to the client once)."""
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    db.delete_expired_sessions(now)
    db.create_session(_hash(token), user_id, now + SESSION_TTL_SECONDS)
    return token


def user_id_for(token: str) -> int | None:
    """The user this token belongs to, or None if it is unknown, revoked or expired."""
    return db.get_session_user_id(_hash(token), int(time.time()))


def revoke(token: str) -> None:
    db.delete_session(_hash(token))
