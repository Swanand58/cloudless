"""Encrypted message model."""

import secrets
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc)


def generate_message_id() -> str:
    """Generate a secure random message ID."""
    return secrets.token_urlsafe(16)


class Message(Base):
    """Encrypted message model.

    Messages are E2E encrypted - the server only stores the ciphertext
    and cannot read the message contents.
    """

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=generate_message_id
    )
    room_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("rooms.id"), nullable=False
    )
    sender_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("users.id"), nullable=False
    )
    # Encrypted message content (base64 encoded ciphertext)
    # Format: nonce (24 bytes) || ciphertext
    encrypted_content: Mapped[str] = mapped_column(Text, nullable=False)
    # Nonce used for encryption (base64 encoded, 24 bytes for XChaCha20)
    nonce: Mapped[str] = mapped_column(String(44), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    # Whether message has been delivered to all recipients
    delivered: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relationships
    room: Mapped["Room"] = relationship("Room", back_populates="messages")

    def __repr__(self) -> str:
        return f"<Message {self.id} in room {self.room_id}>"


# Import Room for type hints - avoid circular import at runtime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.room import Room
