"""Notes API (simplified).

Clients: the web app (React SPA) today. An iOS/Android app launches next
month and will call the same API.
Runs as 2 uvicorn workers on one VM, sharing the SQLite file.

Auth: POST /login exchanges email + password for a bearer token (see
sessions.py). Every other notes route needs `Authorization: Bearer <token>`,
checked in current_user_id(). POST /logout revokes the token.
"""
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from . import db, sessions
from .passwords import hash_password, verify_password


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(lifespan=lifespan)


class SignupIn(BaseModel):
    email: str
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


class NoteIn(BaseModel):
    title: str
    body: str = ""


# Reads `Authorization: Bearer <token>`; a missing or non-Bearer header is a 401.
bearer = HTTPBearer()


def bearer_token(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> str:
    return credentials.credentials


def current_user_id(token: str = Depends(bearer_token)) -> int:
    user_id = sessions.user_id_for(token)
    if user_id is None:
        raise HTTPException(401, "invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    return user_id


@app.post("/signup", status_code=201)
def signup(data: SignupIn):
    if db.get_user_by_email(data.email):
        raise HTTPException(409, "email already registered")
    user_id = db.create_user(data.email, hash_password(data.password))
    return {"id": user_id, "email": data.email}


@app.post("/login")
def login(data: LoginIn):
    user = db.get_user_by_email(data.email)
    # Same answer for "no such email" and "wrong password".
    if user is None or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(401, "invalid email or password")
    return {"access_token": sessions.create(user["id"]), "token_type": "bearer"}


@app.post("/logout", status_code=204)
def logout(token: str = Depends(bearer_token)):
    # Idempotent: logging out an unknown or already-revoked token is still a 204.
    sessions.revoke(token)


@app.get("/notes")
def list_notes(user_id: int = Depends(current_user_id)):
    return db.list_notes(user_id)


@app.post("/notes", status_code=201)
def create_note(data: NoteIn, user_id: int = Depends(current_user_id)):
    return db.create_note(user_id, data.title, data.body)


@app.get("/notes/{note_id}")
def get_note(note_id: int, user_id: int = Depends(current_user_id)):
    note = db.get_note(note_id)
    if note is None or note["owner_id"] != user_id:
        raise HTTPException(404, "note not found")
    return note


@app.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: int, user_id: int = Depends(current_user_id)):
    note = db.get_note(note_id)
    if note is None or note["owner_id"] != user_id:
        raise HTTPException(404, "note not found")
    db.delete_note(note_id)
