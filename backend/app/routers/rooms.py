"""Room management routes."""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User
from app.models.room import Room, RoomMember, RoomType
from app.routers.auth import get_current_user
from app.services.crypto import crypto_service

router = APIRouter(prefix="/rooms", tags=["rooms"])


# Request/Response models
class CreateRoomRequest(BaseModel):
    """Create room request body."""

    name: str | None = Field(default=None, max_length=100)
    public_key: str = Field(..., description="Base64 encoded X25519 public key")
    allow_relay: bool = Field(default=True)
    expires_in_hours: int | None = Field(default=24, ge=1, le=168)  # Max 1 week


class JoinRoomRequest(BaseModel):
    """Join room request body."""

    code: str = Field(..., min_length=6, max_length=10)
    public_key: str = Field(..., description="Base64 encoded X25519 public key")


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
    room_type: str
    allow_relay: bool
    created_at: datetime
    expires_at: datetime | None
    members: list[MemberResponse]


class RoomListResponse(BaseModel):
    """Room list item response."""

    id: str
    code: str
    name: str | None
    room_type: str
    member_count: int
    created_at: datetime
    expires_at: datetime | None


class SafetyNumberResponse(BaseModel):
    """Safety number for verification."""

    safety_number: str
    emoji_fingerprint_self: list[str]
    emoji_fingerprint_peer: list[str]


# Routes
@router.post("", response_model=RoomResponse)
async def create_room(
    request: CreateRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new transfer room."""
    expires_at = None
    if request.expires_in_hours:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=request.expires_in_hours)

    # Create room
    room = Room(
        name=request.name,
        room_type=RoomType.DIRECT,
        created_by=current_user.id,
        allow_relay=request.allow_relay,
        expires_at=expires_at,
    )
    db.add(room)
    await db.flush()

    # Add creator as first member
    member = RoomMember(
        room_id=room.id,
        user_id=current_user.id,
        public_key=request.public_key,
        is_online=True,
        last_seen=datetime.now(timezone.utc),
    )
    db.add(member)
    await db.flush()

    return RoomResponse(
        id=room.id,
        code=room.code,
        name=room.name,
        room_type=room.room_type.value,
        allow_relay=room.allow_relay,
        created_at=room.created_at,
        expires_at=room.expires_at,
        members=[
            MemberResponse(
                user_id=current_user.id,
                username=current_user.username,
                display_name=current_user.display_name,
                public_key=request.public_key,
                is_online=True,
                joined_at=member.joined_at,
            )
        ],
    )


@router.post("/join", response_model=RoomResponse)
async def join_room(
    request: JoinRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Join an existing room with a code."""
    # Find room by code
    result = await db.execute(
        select(Room)
        .where(Room.code == request.code.upper(), Room.is_active == True)
        .options(selectinload(Room.members).selectinload(RoomMember.user))
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
        # Update public key and online status
        existing_member.public_key = request.public_key
        existing_member.is_online = True
        existing_member.last_seen = datetime.now(timezone.utc)
    else:
        # Add as new member
        member = RoomMember(
            room_id=room.id,
            user_id=current_user.id,
            public_key=request.public_key,
            is_online=True,
            last_seen=datetime.now(timezone.utc),
        )
        db.add(member)
        room.members.append(member)

    await db.flush()

    # Reload to get updated members
    await db.refresh(room)

    return RoomResponse(
        id=room.id,
        code=room.code,
        name=room.name,
        room_type=room.room_type.value,
        allow_relay=room.allow_relay,
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
        .options(selectinload(Room.members))
        .order_by(Room.created_at.desc())
    )
    rooms = result.scalars().all()

    return [
        RoomListResponse(
            id=room.id,
            code=room.code,
            name=room.name,
            room_type=room.room_type.value,
            member_count=len(room.members),
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
    result = await db.execute(
        select(Room)
        .where(Room.id == room_id, Room.is_active == True)
        .options(selectinload(Room.members).selectinload(RoomMember.user))
    )
    room = result.scalar_one_or_none()

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found",
        )

    # Check if user is a member
    is_member = any(m.user_id == current_user.id for m in room.members)
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this room",
        )

    if room.is_expired:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Room has expired",
        )

    return RoomResponse(
        id=room.id,
        code=room.code,
        name=room.name,
        room_type=room.room_type.value,
        allow_relay=room.allow_relay,
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


@router.get("/{room_id}/safety-number/{peer_user_id}", response_model=SafetyNumberResponse)
async def get_safety_number(
    room_id: str,
    peer_user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get safety number for verifying a peer's identity."""
    result = await db.execute(
        select(Room)
        .where(Room.id == room_id, Room.is_active == True)
        .options(selectinload(Room.members))
    )
    room = result.scalar_one_or_none()

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found",
        )

    # Find both members
    self_member = next((m for m in room.members if m.user_id == current_user.id), None)
    peer_member = next((m for m in room.members if m.user_id == peer_user_id), None)

    if not self_member or not peer_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found in room",
        )

    # Generate safety number and emoji fingerprints
    safety_number = crypto_service.generate_safety_number(
        self_member.public_key, peer_member.public_key
    )
    emoji_self = crypto_service.generate_emoji_fingerprint(self_member.public_key)
    emoji_peer = crypto_service.generate_emoji_fingerprint(peer_member.public_key)

    return SafetyNumberResponse(
        safety_number=safety_number,
        emoji_fingerprint_self=emoji_self,
        emoji_fingerprint_peer=emoji_peer,
    )


@router.delete("/{room_id}")
async def delete_room(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete/deactivate a room (only creator can delete)."""
    result = await db.execute(
        select(Room).where(Room.id == room_id, Room.is_active == True)
    )
    room = result.scalar_one_or_none()

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found",
        )

    if room.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the room creator can delete it",
        )

    room.is_active = False
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
