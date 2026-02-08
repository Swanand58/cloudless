"""File transfer model."""

import secrets
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Text, Boolean, BigInteger, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.database import Base


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc)


def generate_transfer_id() -> str:
    """Generate a secure random transfer ID."""
    return secrets.token_urlsafe(16)


class TransferStatus(enum.Enum):
    """Status of a file transfer."""

    PENDING = "pending"  # Waiting for upload
    UPLOADING = "uploading"  # Currently uploading
    READY = "ready"  # Ready for download
    DOWNLOADING = "downloading"  # Currently being downloaded
    COMPLETED = "completed"  # Successfully transferred
    EXPIRED = "expired"  # Expired before download
    CANCELLED = "cancelled"  # Cancelled by sender


class TransferMode(enum.Enum):
    """Mode of file transfer."""

    P2P = "p2p"  # Direct peer-to-peer via WebRTC
    RELAY = "relay"  # Server relay (encrypted)


class FileTransfer(Base):
    """File transfer record.

    Files are E2E encrypted - the server only stores encrypted blobs
    and cannot read file contents or even the original filename.
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
    # Encrypted filename (base64 encoded ciphertext)
    encrypted_filename: Mapped[str] = mapped_column(Text, nullable=False)
    # Encrypted mime type (base64 encoded ciphertext)
    encrypted_mimetype: Mapped[str | None] = mapped_column(Text, nullable=True)
    # File size in bytes (this is visible to server for storage management)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # Path to encrypted file on disk (for relay mode)
    storage_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Transfer mode
    mode: Mapped[TransferMode] = mapped_column(
        Enum(TransferMode), default=TransferMode.RELAY
    )
    # Transfer status
    status: Mapped[TransferStatus] = mapped_column(
        Enum(TransferStatus), default=TransferStatus.PENDING
    )
    # Nonce used for file encryption (base64 encoded)
    nonce: Mapped[str] = mapped_column(String(44), nullable=False)
    # Number of chunks (for large file transfers)
    total_chunks: Mapped[int] = mapped_column(default=1)
    uploaded_chunks: Mapped[int] = mapped_column(default=0)
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Download tracking
    download_count: Mapped[int] = mapped_column(default=0)
    max_downloads: Mapped[int] = mapped_column(default=1)

    # Relationships
    room: Mapped["Room"] = relationship("Room", back_populates="transfers")

    @property
    def is_expired(self) -> bool:
        """Check if transfer has expired."""
        if self.status == TransferStatus.EXPIRED:
            return True
        if self.expires_at:
            # Handle both naive and aware datetimes from the DB
            now = datetime.now(timezone.utc)
            expires = self.expires_at
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if now > expires:
                return True
        return False

    @property
    def can_download(self) -> bool:
        """Check if file can be downloaded."""
        if self.status != TransferStatus.READY:
            return False
        if self.is_expired:
            return False
        if self.download_count >= self.max_downloads:
            return False
        return True

    def __repr__(self) -> str:
        return f"<FileTransfer {self.id} status={self.status.value}>"


# Import Room for type hints - avoid circular import at runtime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.room import Room
