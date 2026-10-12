"""File transfer model."""

import secrets
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import String, ForeignKey, Text, BigInteger, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.config import settings
from app.database import Base, UTCDateTime


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc)


def generate_transfer_id() -> str:
    """Generate a secure random transfer ID."""
    return secrets.token_urlsafe(16)


class TransferStatus(enum.Enum):
    """Status of a file transfer."""

    UPLOADING = "uploading"  # Chunks still arriving
    READY = "ready"  # All chunks stored, ready for download


class FileTransfer(Base):
    """File transfer record.

    Files are E2E encrypted - the server only stores encrypted blobs
    and cannot read file contents, names or types. A transfer lives until
    its room expires or the sender cancels it.
    """

    __tablename__ = "file_transfers"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=generate_transfer_id
    )
    room_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("rooms.id"), nullable=False
    )
    sender_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("users.id"), nullable=False
    )
    # Encrypted metadata: base64 of nonce || ciphertext of a JSON object
    # holding name, type, hash and thumbnail
    encrypted_meta: Mapped[str] = mapped_column(Text, nullable=False)
    # Plaintext size in bytes (visible to server for storage management)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[TransferStatus] = mapped_column(
        Enum(TransferStatus), default=TransferStatus.UPLOADING
    )
    total_chunks: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)

    # Relationships
    room: Mapped["Room"] = relationship("Room", back_populates="transfers")

    @property
    def storage_dir(self) -> Path:
        """Directory holding this transfer's encrypted chunks."""
        return settings.upload_dir / self.id

    def chunk_path(self, index: int) -> Path:
        """Path of one encrypted chunk on disk."""
        return self.storage_dir / f"chunk_{index:06d}"

    def __repr__(self) -> str:
        return f"<FileTransfer {self.id} status={self.status.value}>"


# Import Room for type hints - avoid circular import at runtime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.room import Room
