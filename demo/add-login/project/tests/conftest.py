import pytest
from fastapi.testclient import TestClient

from notes.app import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("NOTES_DB", str(tmp_path / "test.db"))
    with TestClient(app) as c:  # runs the lifespan, which creates the tables
        yield c


def signup_and_login(client, email, password):
    user = client.post("/signup", json={"email": email, "password": password}).json()
    r = client.post("/login", json={"email": email, "password": password})
    assert r.status_code == 200
    return {**user, "password": password, "token": r.json()["access_token"]}


@pytest.fixture
def alice(client):
    return signup_and_login(client, "alice@example.com", "correct horse")


@pytest.fixture
def bob(client):
    return signup_and_login(client, "bob@example.com", "battery staple")
