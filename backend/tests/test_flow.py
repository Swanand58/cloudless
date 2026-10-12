"""End-to-end API flow: accounts, two-person rooms, chunked transfers, chat."""

import base64
import os

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]


def fake_public_key() -> str:
    return base64.b64encode(os.urandom(32)).decode()


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def tokens(client):
    """Access tokens for the admin and two invited users."""
    admin = client.post(
        "/api/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD}
    ).json()["access_token"]

    result = {"admin": admin}
    for name in ("bob", "carol"):
        invite = client.post("/api/auth/invites", json={}, headers=auth(admin)).json()
        response = client.post(
            "/api/auth/register",
            json={
                "username": name,
                "password": "password-123",
                "display_name": name.title(),
                "invite_code": invite["code"],
            },
        )
        assert response.status_code == 200, response.text
        result[name] = response.json()["access_token"]
    return result


@pytest.fixture(scope="module")
def room(client, tokens):
    """A room with admin and bob in it."""
    created = client.post(
        "/api/rooms", json={"public_key": fake_public_key()}, headers=auth(tokens["admin"])
    )
    assert created.status_code == 200, created.text
    joined = client.post(
        "/api/rooms/join",
        json={"code": created.json()["code"], "public_key": fake_public_key()},
        headers=auth(tokens["bob"]),
    )
    assert joined.status_code == 200, joined.text
    assert len(joined.json()["members"]) == 2
    return joined.json()


def test_invite_is_single_use(client, tokens):
    admin = tokens["admin"]
    invite = client.post("/api/auth/invites", json={}, headers=auth(admin)).json()
    body = {"password": "password-123", "display_name": "X", "invite_code": invite["code"]}
    assert client.post("/api/auth/register", json={**body, "username": "dave"}).status_code == 200
    assert client.post("/api/auth/register", json={**body, "username": "erin"}).status_code == 400


def test_room_is_capped_at_two(client, tokens, room):
    response = client.post(
        "/api/rooms/join",
        json={"code": room["code"], "public_key": fake_public_key()},
        headers=auth(tokens["carol"]),
    )
    assert response.status_code == 409

    # An outsider cannot read the room either
    assert client.get(f"/api/rooms/{room['id']}", headers=auth(tokens["carol"])).status_code == 403


def test_rejoin_replaces_key_without_adding_member(client, tokens, room):
    new_key = fake_public_key()
    response = client.post(
        "/api/rooms/join",
        json={"code": room["code"], "public_key": new_key},
        headers=auth(tokens["bob"]),
    )
    assert response.status_code == 200
    members = response.json()["members"]
    assert len(members) == 2
    assert new_key in [m["public_key"] for m in members]


def test_room_list_names_the_peer(client, tokens, room):
    rooms = client.get("/api/rooms", headers=auth(tokens["bob"])).json()
    assert [r["peer_name"] for r in rooms if r["id"] == room["id"]] == ["Administrator"]


def test_transfer_round_trip(client, tokens, room):
    admin, bob = auth(tokens["admin"]), auth(tokens["bob"])

    # Two full chunks and a short one
    size = settings.chunk_size * 2 + 1000
    init = client.post(
        "/api/transfers",
        json={"room_id": room["id"], "encrypted_meta": "bWV0YQ==", "file_size": size},
        headers=admin,
    )
    assert init.status_code == 200, init.text
    transfer = init.json()
    assert transfer["total_chunks"] == 3
    url = f"/api/transfers/{transfer['id']}"

    chunks = [os.urandom(settings.chunk_size + 40), os.urandom(settings.chunk_size + 40), os.urandom(1040)]

    # Not listed or downloadable until complete
    assert client.post(f"{url}/chunks/0", content=chunks[0], headers=admin).json()["status"] == "uploading"
    assert client.get(f"/api/transfers/room/{room['id']}", headers=bob).json() == []
    assert client.get(f"{url}/download", headers=bob).status_code == 400

    # A retried chunk must not be counted twice
    retry = client.post(f"{url}/chunks/0", content=chunks[0], headers=admin).json()
    assert (retry["uploaded_chunks"], retry["status"]) == (1, "uploading")

    # Only the sender uploads; oversize and out-of-range chunks are refused
    assert client.post(f"{url}/chunks/1", content=chunks[1], headers=bob).status_code == 403
    assert client.post(f"{url}/chunks/1", content=chunks[1] + b"x", headers=admin).status_code == 413
    assert client.post(f"{url}/chunks/3", content=b"x", headers=admin).status_code == 400

    # Out of order is fine
    assert client.post(f"{url}/chunks/2", content=chunks[2], headers=admin).json()["status"] == "uploading"
    assert client.post(f"{url}/chunks/1", content=chunks[1], headers=admin).json()["status"] == "ready"

    # A late retry after completion still succeeds
    assert client.post(f"{url}/chunks/1", content=chunks[1], headers=admin).json()["status"] == "ready"

    listed = client.get(f"/api/transfers/room/{room['id']}", headers=bob).json()
    assert [t["id"] for t in listed] == [transfer["id"]]
    assert listed[0]["created_at"].endswith(("Z", "+00:00"))

    download = client.get(f"{url}/download", headers=bob)
    assert download.status_code == 200
    assert download.content == b"".join(chunks)

    assert client.get(f"{url}/download", headers=auth(tokens["carol"])).status_code == 403

    # Cancel removes the data
    assert client.delete(url, headers=bob).status_code == 403
    assert client.delete(url, headers=admin).status_code == 200
    assert not (settings.upload_dir / transfer["id"]).exists()
    assert client.get(f"{url}/download", headers=bob).status_code == 404


def test_file_over_limit_is_refused(client, tokens, room):
    response = client.post(
        "/api/transfers",
        json={
            "room_id": room["id"],
            "encrypted_meta": "bWV0YQ==",
            "file_size": settings.max_file_size_mb * 1024 * 1024 + 1,
        },
        headers=auth(tokens["admin"]),
    )
    assert response.status_code == 422


def test_chat_is_delivered_and_kept(client, tokens, room):
    path = f"/api/ws/{room['id']}"
    with client.websocket_connect(path) as bob_ws:
        bob_ws.send_json({"type": "auth", "token": tokens["bob"]})
        assert bob_ws.receive_json()["type"] == "online_users"

        with client.websocket_connect(path) as admin_ws:
            admin_ws.send_json({"type": "auth", "token": tokens["admin"]})
            assert admin_ws.receive_json()["type"] == "online_users"
            assert bob_ws.receive_json()["type"] == "user_joined"

            admin_ws.send_json({"type": "chat", "encrypted_content": "Y2lwaGVy", "nonce": "bm9uY2U="})
            received = bob_ws.receive_json()
            assert received["type"] == "chat"
            assert received["encrypted_content"] == "Y2lwaGVy"

    # The offline peer finds it in the history later
    history = client.get(f"/api/rooms/{room['id']}/messages", headers=auth(tokens["bob"])).json()
    assert [m["encrypted_content"] for m in history] == ["Y2lwaGVy"]
    assert history[0]["sender_name"] == "Administrator"


def test_websocket_rejects_bad_token_and_outsiders(client, tokens, room):
    from starlette.websockets import WebSocketDisconnect

    for token, code in (("nonsense", 4001), (tokens["carol"], 4003)):
        with client.websocket_connect(f"/api/ws/{room['id']}") as ws:
            ws.send_json({"type": "auth", "token": token})
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
            assert closed.value.code == code


def test_password_change_signs_out_old_tokens(client, tokens):
    import time

    old = tokens["carol"]
    time.sleep(1.1)  # Token timestamps have one-second resolution
    changed = client.post(
        "/api/auth/change-password",
        json={"current_password": "password-123", "new_password": "password-456"},
        headers=auth(old),
    )
    assert changed.status_code == 200, changed.text
    assert client.get("/api/auth/me", headers=auth(old)).status_code == 401
    assert client.get("/api/auth/me", headers=auth(changed.json()["access_token"])).status_code == 200


def test_deleting_room_removes_its_content(client, tokens, room):
    assert client.delete(f"/api/rooms/{room['id']}", headers=auth(tokens["bob"])).status_code == 403
    assert client.delete(f"/api/rooms/{room['id']}", headers=auth(tokens["admin"])).status_code == 200
    assert client.get(f"/api/rooms/{room['id']}", headers=auth(tokens["admin"])).status_code == 404
    assert client.get("/api/rooms", headers=auth(tokens["bob"])).json() == []


def test_login_is_rate_limited(client):
    statuses = [
        client.post("/api/auth/login", json={"username": "admin", "password": "wrong-password"}).status_code
        for _ in range(settings.auth_rate_limit_requests + 1)
    ]
    assert statuses[-1] == 429
    assert 401 in statuses
