"""WebSocket router for real-time communication."""

import json
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db, async_session
from app.models.user import User
from app.models.room import Room, RoomMember
from app.models.message import Message
from app.services.auth import auth_service

router = APIRouter(tags=["websocket"])


class ConnectionManager:
    """Manages WebSocket connections for rooms."""

    def __init__(self):
        # room_id -> {user_id -> WebSocket}
        self.rooms: dict[str, dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: str, user_id: str):
        """Connect a user to a room."""
        await websocket.accept()

        if room_id not in self.rooms:
            self.rooms[room_id] = {}

        self.rooms[room_id][user_id] = websocket

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

    async def disconnect(self, room_id: str, user_id: str):
        """Disconnect a user from a room."""
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            del self.rooms[room_id][user_id]

            # Clean up empty rooms
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
        for user_id, websocket in self.rooms[room_id].items():
            if user_id == exclude_user:
                continue
            try:
                await websocket.send_json(message)
            except Exception:
                disconnected.append(user_id)

        # Clean up disconnected users
        for user_id in disconnected:
            await self.disconnect(room_id, user_id)

    async def send_to_user(self, room_id: str, user_id: str, message: dict):
        """Send a message to a specific user in a room."""
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            try:
                await self.rooms[room_id][user_id].send_json(message)
            except Exception:
                await self.disconnect(room_id, user_id)

    def get_online_users(self, room_id: str) -> list[str]:
        """Get list of online users in a room."""
        if room_id not in self.rooms:
            return []
        return list(self.rooms[room_id].keys())


# Global connection manager
manager = ConnectionManager()


@router.websocket("/ws/{room_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: str,
    token: str = Query(...),
):
    """WebSocket endpoint for room communication.

    Message types:
    - chat: Encrypted chat message
    - signal: WebRTC signaling (offer, answer, ice-candidate)
    - typing: User is typing indicator
    - transfer_update: File transfer status update
    """
    # Verify token
    user_id = auth_service.verify_token(token, "access")
    if not user_id:
        await websocket.close(code=4001, reason="Invalid token")
        return

    # Verify room membership
    async with async_session() as db:
        result = await db.execute(
            select(Room)
            .where(Room.id == room_id, Room.is_active == True)
            .options(selectinload(Room.members).selectinload(RoomMember.user))
        )
        room = result.scalar_one_or_none()

        if not room:
            await websocket.close(code=4004, reason="Room not found")
            return

        is_member = any(m.user_id == user_id for m in room.members)
        if not is_member:
            await websocket.close(code=4003, reason="Not a member")
            return

        # Get user info
        user = next((m.user for m in room.members if m.user_id == user_id), None)
        if not user:
            await websocket.close(code=4003, reason="User not found")
            return

    # Connect to room
    await manager.connect(websocket, room_id, user_id)

    # Send current online users
    await websocket.send_json(
        {
            "type": "online_users",
            "users": manager.get_online_users(room_id),
        }
    )

    try:
        while True:
            # Receive message
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "chat":
                # Encrypted chat message
                encrypted_content = data.get("encrypted_content")
                nonce = data.get("nonce")

                if not encrypted_content or not nonce:
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

            elif msg_type == "signal":
                # WebRTC signaling
                target_user = data.get("target_user")
                signal_type = data.get("signal_type")  # offer, answer, ice-candidate
                signal_data = data.get("signal_data")

                if not target_user or not signal_type or not signal_data:
                    continue

                # Forward to target user
                await manager.send_to_user(
                    room_id,
                    target_user,
                    {
                        "type": "signal",
                        "from_user": user_id,
                        "signal_type": signal_type,
                        "signal_data": signal_data,
                    },
                )

            elif msg_type == "typing":
                # Typing indicator
                is_typing = data.get("is_typing", False)
                await manager.broadcast_to_room(
                    room_id,
                    {
                        "type": "typing",
                        "user_id": user_id,
                        "user_name": user.display_name,
                        "is_typing": is_typing,
                    },
                    exclude_user=user_id,
                )

            elif msg_type == "transfer_update":
                # File transfer status update
                transfer_id = data.get("transfer_id")
                status = data.get("status")
                progress = data.get("progress")

                await manager.broadcast_to_room(
                    room_id,
                    {
                        "type": "transfer_update",
                        "transfer_id": transfer_id,
                        "user_id": user_id,
                        "status": status,
                        "progress": progress,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )

            elif msg_type == "ping":
                # Keep-alive ping
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        await manager.disconnect(room_id, user_id)
    except Exception as e:
        print(f"WebSocket error: {e}")
        await manager.disconnect(room_id, user_id)
