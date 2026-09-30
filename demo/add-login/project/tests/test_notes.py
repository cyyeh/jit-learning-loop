def as_user(user):
    return {"Authorization": f"Bearer {user['token']}"}


def test_signup_rejects_duplicate_email(client, alice):
    r = client.post("/signup", json={"email": "alice@example.com", "password": "x"})
    assert r.status_code == 409


def test_create_and_list_notes(client, alice):
    r = client.post("/notes", json={"title": "groceries", "body": "milk"}, headers=as_user(alice))
    assert r.status_code == 201

    r = client.get("/notes", headers=as_user(alice))
    assert [n["title"] for n in r.json()] == ["groceries"]


def test_cannot_read_someone_elses_note(client, alice, bob):
    note = client.post("/notes", json={"title": "diary"}, headers=as_user(alice)).json()

    r = client.get(f"/notes/{note['id']}", headers=as_user(bob))
    assert r.status_code == 404
