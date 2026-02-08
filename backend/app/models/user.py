"""User and invite code models."""

import secrets
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc)


def generate_user_id() -> str:
    """Generate a secure random user ID."""
    return secrets.token_urlsafe(16)


def generate_invite_code() -> str:
    """Generate a secure random invite code."""
    return secrets.token_urlsafe(12)


class User(Base):
    """User account model."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=generate_user_id
    )
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(100))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    last_login: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relationships
    created_invites: Mapped[list["InviteCode"]] = relationship(
        "InviteCode", back_populates="created_by_user", foreign_keys="InviteCode.created_by"
    )
    room_memberships: Mapped[list["RoomMember"]] = relationship(
        "RoomMember", back_populates="user"
    )

    def __repr__(self) -> str:
        return f"<User {self.username}>"


class InviteCode(Base):
    """Invite code for new user registration."""

    __tablename__ = "invite_codes"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=generate_invite_code
    )
    code: Mapped[str] = mapped_column(
        String(24), unique=True, index=True, default=generate_invite_code
    )
    created_by: Mapped[str] = mapped_column(
        String(32), ForeignKey("users.id"), nullable=False
    )
    used_by: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("users.id"), nullable=True
    )
    max_uses: Mapped[int] = mapped_column(default=1)
    use_count: Mapped[int] = mapped_column(default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    created_by_user: Mapped["User"] = relationship(
        "User", back_populates="created_invites", foreign_keys=[created_by]
    )

    @property
    def is_valid(self) -> bool:
        """Check if invite code is still valid."""
        if self.use_count >= self.max_uses:
            return False
        if self.expires_at:
            # Make expires_at timezone-aware if it isn't
            expires = self.expires_at
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > expires:
                return False
        return True

    def __repr__(self) -> str:
        return f"<InviteCode {self.code}>"


# Import RoomMember for relationship - avoid circular import
from app.models.room import RoomMember  # noqa: E402, F401
