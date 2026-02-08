"""Room and room membership models."""

import secrets
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.database import Base


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc)


def generate_room_id() -> str:
    """Generate a secure random room ID."""
    return secrets.token_urlsafe(16)


def generate_room_code() -> str:
    """Generate a human-readable room code (6 chars)."""
    # Use only unambiguous characters
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))


class RoomType(enum.Enum):
    """Type of transfer room."""

    DIRECT = "direct"  # One-to-one transfer
    GROUP = "group"  # Multiple participants


class Room(Base):
    """Transfer room model."""

    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=generate_room_id
    )
    code: Mapped[str] = mapped_column(
        String(10), unique=True, index=True, default=generate_room_code
    )
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    room_type: Mapped[RoomType] = mapped_column(
        Enum(RoomType), default=RoomType.DIRECT
    )
    created_by: Mapped[str] = mapped_column(
        String(32), ForeignKey("users.id"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_relay: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relationships
    members: Mapped[list["RoomMember"]] = relationship(
        "RoomMember", back_populates="room", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="room", cascade="all, delete-orphan"
    )
    transfers: Mapped[list["FileTransfer"]] = relationship(
        "FileTransfer", back_populates="room", cascade="all, delete-orphan"
    )

    @property
    def is_expired(self) -> bool:
        """Check if room has expired."""
        if self.expires_at:
            # Make expires_at timezone-aware if it isn't
            expires = self.expires_at
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > expires:
                return True
        return False

    def __repr__(self) -> str:
        return f"<Room {self.code}>"


class RoomMember(Base):
    """Room membership with public key for E2E encryption."""

    __tablename__ = "room_members"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: secrets.token_urlsafe(16)
    )
    room_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("rooms.id"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("users.id"), nullable=False
    )
    # Public key for E2E encryption (base64 encoded X25519 public key)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relationships
    room: Mapped["Room"] = relationship("Room", back_populates="members")
    user: Mapped["User"] = relationship("User", back_populates="room_memberships")

    def __repr__(self) -> str:
        return f"<RoomMember room={self.room_id} user={self.user_id}>"


# Import Message and FileTransfer for relationships - avoid circular import
from app.models.message import Message  # noqa: E402, F401
from app.models.transfer import FileTransfer  # noqa: E402, F401
