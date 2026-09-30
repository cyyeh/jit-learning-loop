"""SQLite storage. The database file comes from NOTES_DB (default: notes.db)."""
import os
import sqlite3
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL REFERENCES users(id),
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,               -- SHA-256 of the bearer token; the token itself is never stored
    user_id    INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL,               -- unix seconds
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


@contextmanager
def connect():
    conn = sqlite3.connect(os.environ.get("NOTES_DB", "notes.db"))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with connect() as conn:
        conn.executescript(SCHEMA)


def create_user(email: str, password_hash: str) -> int:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, ?)", (email, password_hash)
        )
        return cur.lastrowid


def get_user_by_email(email: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        return dict(row) if row else None


def get_user(user_id: int) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def create_session(token_hash: str, user_id: int, expires_at: int) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (token_hash, user_id, expires_at),
        )


def get_session_user_id(token_hash: str, now: int) -> int | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?", (token_hash, now)
        ).fetchone()
        return row["user_id"] if row else None


def delete_session(token_hash: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


def delete_expired_sessions(now: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))


def list_notes(owner_id: int) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, owner_id, title, body, created_at FROM notes WHERE owner_id = ? ORDER BY id",
            (owner_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def create_note(owner_id: int, title: str, body: str) -> dict:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO notes (owner_id, title, body) VALUES (?, ?, ?)", (owner_id, title, body)
        )
        row = conn.execute(
            "SELECT id, owner_id, title, body, created_at FROM notes WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return dict(row)


def get_note(note_id: int) -> dict | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT id, owner_id, title, body, created_at FROM notes WHERE id = ?", (note_id,)
        ).fetchone()
        return dict(row) if row else None


def delete_note(note_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
