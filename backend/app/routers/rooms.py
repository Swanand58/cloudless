"""Room management routes."""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.models.room import Room, RoomMember
from app.models.message import Message
from app.routers.auth import get_current_user
from app.services.cleanup import purge_room

router = APIRouter(prefix="/rooms", tags=["rooms"])

# Rooms are one-to-one: the E2E key is derived between exactly two members
MAX_ROOM_MEMBERS = 2

# ponytail: history is capped, not paginated. Add paging if rooms outgrow it.
MAX_HISTORY_MESSAGES = 500

# Base64 of a 32-byte X25519 public key
PUBLIC_KEY_PATTERN = r"^[A-Za-z0-9+/]{43}=$"


# Request/Response models
class CreateRoomRequest(BaseModel):
    """Create room request body."""

    name: str | None = Field(default=None, max_length=100)
    public_key: str = Field(
        ..., pattern=PUBLIC_KEY_PATTERN, description="Base64 encoded X25519 public key"
    )


class JoinRoomRequest(BaseModel):
    """Join room request body."""

    code: str = Field(..., min_length=6, max_length=10)
    public_key: str = Field(
        ..., pattern=PUBLIC_KEY_PATTERN, description="Base64 encoded X25519 public key"
    )


class MemberResponse(BaseModel):
    """Room member response body."""

    user_id: str
    username: str
    display_name: str
    public_key: str
    is_online: bool
    joined_at: datetime


class RoomResponse(BaseModel):
    """Room response body."""

    id: str
    code: str
    name: str | None
    created_at: datetime
    expires_at: datetime | None
    members: list[MemberResponse]


class RoomListResponse(BaseModel):
    """Room list item response."""

    id: str
    code: str
    name: str | None
    member_count: int
    peer_name: str | None
    created_at: datetime
    expires_at: datetime | None


class MessageResponse(BaseModel):
    """Stored encrypted message, same shape as the WebSocket chat event."""

    message_id: str
    sender_id: str
    sender_name: str
    encrypted_content: str
    nonce: str
    timestamp: datetime


# Helper functions
async def verify_room_membership(db: AsyncSession, room_id: str, user_id: str) -> Room:
    """Load an active room with its members and verify the user is one of them."""
    result = await db.execute(
        select(Room)
        .where(Room.id == room_id, Room.is_active == True)
        .options(selectinload(Room.members).selectinload(RoomMember.user))
        # Refresh members even if this session already holds the room
        .execution_options(populate_existing=True)
    )
    room = result.scalar_one_or_none()

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found",
        )

    if room.is_expired:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Room has expired",
        )

    if not any(m.user_id == user_id for m in room.members):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this room",
        )

    return room


def room_response(room: Room) -> RoomResponse:
    """Build a room response from a room with members and users loaded."""
    return RoomResponse(
        id=room.id,
        code=room.code,
        name=room.name,
        created_at=room.created_at,
        expires_at=room.expires_at,
        members=[
            MemberResponse(
                user_id=m.user_id,
                username=m.user.username,
                display_name=m.user.display_name,
                public_key=m.public_key,
                is_online=m.is_online,
                joined_at=m.joined_at,
            )
            for m in room.members
        ],
    )


# Routes
@router.post("", response_model=RoomResponse)
async def create_room(
    request: CreateRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new transfer room."""
    room = Room(
        name=request.name,
        created_by=current_user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.room_expiry_days),
    )
    db.add(room)
    await db.flush()

    # Add creator as first member
    db.add(
        RoomMember(
            room_id=room.id,
            user_id=current_user.id,
            public_key=request.public_key,
        )
    )
    await db.flush()

    return room_response(await verify_room_membership(db, room.id, current_user.id))


@router.post("/join", response_model=RoomResponse)
async def join_room(
    request: JoinRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Join an existing room with a code.

    Joining again as an existing member replaces that member's public key.
    """
    # Find room by code
    result = await db.execute(
        select(Room)
        .where(Room.code == request.code.upper(), Room.is_active == True)
        .options(selectinload(Room.members))
    )
    room = result.scalar_one_or_none()

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found",
        )

    if room.is_expired:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Room has expired",
        )

    # Check if user is already a member
    existing_member = next(
        (m for m in room.members if m.user_id == current_user.id), None
    )
    if existing_member:
        existing_member.public_key = request.public_key
    elif len(room.members) >= MAX_ROOM_MEMBERS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Room is full",
        )
    else:
        db.add(
            RoomMember(
                room_id=room.id,
                user_id=current_user.id,
                public_key=request.public_key,
            )
        )

    await db.flush()

    return room_response(await verify_room_membership(db, room.id, current_user.id))


@router.get("", response_model=list[RoomListResponse])
async def list_rooms(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List rooms the current user is a member of."""
    result = await db.execute(
        select(Room)
        .join(RoomMember)
        .where(RoomMember.user_id == current_user.id, Room.is_active == True)
        .options(selectinload(Room.members).selectinload(RoomMember.user))
        .order_by(Room.created_at.desc())
    )
    rooms = result.scalars().all()

    return [
        RoomListResponse(
            id=room.id,
            code=room.code,
            name=room.name,
            member_count=len(room.members),
            peer_name=next(
                (
                    m.user.display_name
                    for m in room.members
                    if m.user_id != current_user.id
                ),
                None,
            ),
            created_at=room.created_at,
            expires_at=room.expires_at,
        )
        for room in rooms
        if not room.is_expired
    ]


@router.get("/{room_id}", response_model=RoomResponse)
async def get_room(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get room details."""
    return room_response(await verify_room_membership(db, room_id, current_user.id))


@router.get("/{room_id}/messages", response_model=list[MessageResponse])
async def list_messages(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the room's encrypted chat history, oldest first."""
    room = await verify_room_membership(db, room_id, current_user.id)
    names = {m.user_id: m.user.display_name for m in room.members}

    result = await db.execute(
        select(Message)
        .where(Message.room_id == room_id)
        .order_by(Message.created_at.desc())
        .limit(MAX_HISTORY_MESSAGES)
    )
    messages = result.scalars().all()

    return [
        MessageResponse(
            message_id=m.id,
            sender_id=m.sender_id,
            sender_name=names.get(m.sender_id, "Unknown"),
            encrypted_content=m.encrypted_content,
            nonce=m.nonce,
            timestamp=m.created_at,
        )
        for m in reversed(messages)
    ]


@router.delete("/{room_id}")
async def delete_room(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a room and everything in it (only creator can delete)."""
    room = await verify_room_membership(db, room_id, current_user.id)

    if room.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the room creator can delete it",
        )

    await purge_room(db, room)
    return {"message": "Room deleted"}


@router.post("/{room_id}/leave")
async def leave_room(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Leave a room."""
    result = await db.execute(
        select(RoomMember).where(
            RoomMember.room_id == room_id,
            RoomMember.user_id == current_user.id,
        )
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not a member of this room",
        )

    await db.delete(member)
    return {"message": "Left room"}
