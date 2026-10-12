"""WebSocket router for real-time communication."""

import asyncio
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import async_session
from app.models.room import Room, RoomMember
from app.models.message import Message
from app.services.auth import auth_service

router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)

# Seconds a new connection has to send its auth message
AUTH_TIMEOUT = 10

# Base64 ciphertext limit for one chat message. The client allows 4000
# characters, which is at most 12KB of UTF-8 and about 16KB encoded.
MAX_CHAT_LENGTH = 24_000
MAX_NONCE_LENGTH = 44


class ConnectionManager:
    """Manages WebSocket connections for rooms."""

    def __init__(self):
        # room_id -> {user_id -> WebSocket}
        self.rooms: dict[str, dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: str, user_id: str):
        """Register an accepted, authenticated connection in a room."""
        self.rooms.setdefault(room_id, {})[user_id] = websocket

        # Update online status in database and get member info
        public_key = None
        display_name = None
        async with async_session() as db:
            result = await db.execute(
                select(RoomMember)
                .where(
                    RoomMember.room_id == room_id,
                    RoomMember.user_id == user_id,
                )
                .options(selectinload(RoomMember.user))
            )
            member = result.scalar_one_or_none()
            if member:
                member.is_online = True
                member.last_seen = datetime.now(timezone.utc)
                public_key = member.public_key
                display_name = member.user.display_name if member.user else None
                await db.commit()

        # Notify others in room - include public key for E2E encryption setup
        await self.broadcast_to_room(
            room_id,
            {
                "type": "user_joined",
                "user_id": user_id,
                "public_key": public_key,
                "display_name": display_name,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            exclude_user=user_id,
        )

    async def disconnect(self, websocket: WebSocket, room_id: str, user_id: str):
        """Remove a connection from a room.

        Does nothing if the user has since reconnected on a newer socket.
        """
        if self.rooms.get(room_id, {}).get(user_id) is not websocket:
            return

        del self.rooms[room_id][user_id]
        if not self.rooms[room_id]:
            del self.rooms[room_id]

        # Update online status in database and get user info
        display_name = None
        async with async_session() as db:
            result = await db.execute(
                select(RoomMember).where(
                    RoomMember.room_id == room_id,
                    RoomMember.user_id == user_id,
                ).options(selectinload(RoomMember.user))
            )
            member = result.scalar_one_or_none()
            if member:
                member.is_online = False
                member.last_seen = datetime.now(timezone.utc)
                display_name = member.user.display_name if member.user else None
                await db.commit()

        # Notify others in room
        await self.broadcast_to_room(
            room_id,
            {
                "type": "user_left",
                "user_id": user_id,
                "display_name": display_name,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

    async def broadcast_to_room(
        self,
        room_id: str,
        message: dict,
        exclude_user: str | None = None,
    ):
        """Broadcast a message to all users in a room."""
        if room_id not in self.rooms:
            return

        disconnected = []
        for user_id, websocket in list(self.rooms[room_id].items()):
            if user_id == exclude_user:
                continue
            try:
                await websocket.send_json(message)
            except Exception:
                disconnected.append((websocket, user_id))

        # Clean up disconnected users
        for websocket, user_id in disconnected:
            await self.disconnect(websocket, room_id, user_id)

    def get_online_users(self, room_id: str) -> list[str]:
        """Get list of online users in a room."""
        if room_id not in self.rooms:
            return []
        return list(self.rooms[room_id].keys())


# Global connection manager
manager = ConnectionManager()


@router.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    """WebSocket endpoint for room communication.

    The first message must be {"type": "auth", "token": <access token>}.
    The token is not passed in the URL, where it would end up in proxy logs.

    Message types after that:
    - chat: Encrypted chat message
    - typing: User is typing indicator
    - ping: Keep-alive
    """
    await websocket.accept()

    # Authenticate
    try:
        first = await asyncio.wait_for(websocket.receive_json(), timeout=AUTH_TIMEOUT)
    except (asyncio.TimeoutError, WebSocketDisconnect, ValueError):
        first = None

    token = first.get("token") if isinstance(first, dict) and first.get("type") == "auth" else None

    async with async_session() as db:
        user = await auth_service.get_user_from_token(db, token) if token else None
        if not user:
            await websocket.close(code=4001, reason="Invalid token")
            return

        # Verify room membership
        result = await db.execute(
            select(Room)
            .where(Room.id == room_id, Room.is_active == True)
            .options(selectinload(Room.members))
        )
        room = result.scalar_one_or_none()

        if not room or room.is_expired:
            await websocket.close(code=4004, reason="Room not found")
            return

        if not any(m.user_id == user.id for m in room.members):
            await websocket.close(code=4003, reason="Not a member")
            return

    user_id = user.id

    # Connect to room
    await manager.connect(websocket, room_id, user_id)

    try:
        # Send current online users
        await websocket.send_json(
            {
                "type": "online_users",
                "users": manager.get_online_users(room_id),
            }
        )

        while True:
            # Receive message
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "chat":
                # Encrypted chat message
                encrypted_content = data.get("encrypted_content")
                nonce = data.get("nonce")

                if not isinstance(encrypted_content, str) or not isinstance(nonce, str):
                    continue
                if (
                    not encrypted_content
                    or len(encrypted_content) > MAX_CHAT_LENGTH
                    or not nonce
                    or len(nonce) > MAX_NONCE_LENGTH
                ):
                    continue

                # Store message in database
                async with async_session() as db:
                    message = Message(
                        room_id=room_id,
                        sender_id=user_id,
                        encrypted_content=encrypted_content,
                        nonce=nonce,
                    )
                    db.add(message)
                    await db.commit()

                # Broadcast to room (exclude sender - they already have optimistic local copy)
                await manager.broadcast_to_room(
                    room_id,
                    {
                        "type": "chat",
                        "message_id": message.id,
                        "sender_id": user_id,
                        "sender_name": user.display_name,
                        "encrypted_content": encrypted_content,
                        "nonce": nonce,
                        "timestamp": message.created_at.isoformat(),
                    },
                    exclude_user=user_id,
                )

            elif msg_type == "typing":
                # Typing indicator
                await manager.broadcast_to_room(
                    room_id,
                    {
                        "type": "typing",
                        "user_id": user_id,
                        "user_name": user.display_name,
                        "is_typing": bool(data.get("is_typing", False)),
                    },
                    exclude_user=user_id,
                )

            elif msg_type == "ping":
                # Keep-alive ping
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error in room %s", room_id)
    finally:
        await manager.disconnect(websocket, room_id, user_id)
