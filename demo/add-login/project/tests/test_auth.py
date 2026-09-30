from notes import db


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def login(client, email, password):
    return client.post("/login", json={"email": email, "password": password})


def test_wrong_password_and_unknown_email_get_the_same_401(client, alice):
    wrong_password = login(client, alice["email"], "wrong")
    unknown_email = login(client, "nobody@example.com", "whatever")
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()


def test_x_user_id_header_is_no_longer_trusted(client, alice):
    # The prototype hole: claiming to be someone by sending their id.
    r = client.get("/notes", headers={"X-User-Id": str(alice["id"])})
    assert r.status_code == 401


def test_made_up_token_is_rejected(client, alice):
    r = client.get("/notes", headers=bearer("not-a-real-token"))
    assert r.status_code == 401
    assert r.headers["WWW-Authenticate"] == "Bearer"


def test_logout_kills_every_copy_of_the_token(client, alice):
    stolen_copy = alice["token"]
    assert client.post("/logout", headers=bearer(alice["token"])).status_code == 204
    assert client.get("/notes", headers=bearer(stolen_copy)).status_code == 401


def test_logout_twice_is_still_204(client, alice):
    assert client.post("/logout", headers=bearer(alice["token"])).status_code == 204
    assert client.post("/logout", headers=bearer(alice["token"])).status_code == 204


def test_logout_only_ends_that_one_session(client, alice):
    phone = alice["token"]
    web = login(client, alice["email"], alice["password"]).json()["access_token"]
    client.post("/logout", headers=bearer(phone))
    assert client.get("/notes", headers=bearer(web)).status_code == 200


def test_expired_session_is_rejected(client, alice):
    with db.connect() as conn:
        conn.execute("UPDATE sessions SET expires_at = 0")
    assert client.get("/notes", headers=bearer(alice["token"])).status_code == 401


def test_raw_token_is_never_stored(client, alice):
    with db.connect() as conn:
        rows = [tuple(r) for r in conn.execute("SELECT * FROM sessions")]
    assert rows
    assert not any(alice["token"] in str(value) for row in rows for value in row)
