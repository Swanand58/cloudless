"""Cleanup service for expired rooms and abandoned uploads."""

import shutil
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.transfer import FileTransfer, TransferStatus
from app.models.message import Message
from app.models.room import Room, RoomMember

logger = logging.getLogger(__name__)

# An upload with no READY status after this long is considered abandoned
STALE_UPLOAD_AFTER = timedelta(hours=1)


async def delete_transfer(db: AsyncSession, transfer: FileTransfer):
    """Delete a transfer's chunks from disk and its database row."""
    shutil.rmtree(transfer.storage_dir, ignore_errors=True)
    await db.delete(transfer)


async def purge_room(db: AsyncSession, room: Room):
    """Delete everything a room holds and deactivate it."""
    result = await db.execute(
        select(FileTransfer).where(FileTransfer.room_id == room.id)
    )
    transfers = result.scalars().all()
    for transfer in transfers:
        await delete_transfer(db, transfer)

    await db.execute(delete(Message).where(Message.room_id == room.id))
    await db.execute(delete(RoomMember).where(RoomMember.room_id == room.id))
    room.is_active = False

    logger.info("Room %s purged: %d files deleted", room.id, len(transfers))


class CleanupService:
    """Service to clean up expired rooms and abandoned uploads."""

    def __init__(self, interval_seconds: int = 3600):
        """Initialize cleanup service.

        Args:
            interval_seconds: How often to run cleanup (default: 1 hour)
        """
        self.interval = interval_seconds
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self):
        """Start the cleanup service background task."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self):
        """Stop the cleanup service."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run_loop(self):
        """Main cleanup loop."""
        while self._running:
            try:
                await self.cleanup()
            except Exception:
                # Log error but don't crash
                logger.exception("Cleanup failed")
            await asyncio.sleep(self.interval)

    async def cleanup(self):
        """Run cleanup tasks."""
        async with async_session() as db:
            await self._cleanup_expired_rooms(db)
            await self._cleanup_stale_uploads(db)
            await db.commit()
        await self._cleanup_orphaned_files()

    async def _cleanup_expired_rooms(self, db: AsyncSession):
        """Purge rooms past their expiry, with their files and messages."""
        now = datetime.now(timezone.utc)

        result = await db.execute(
            select(Room).where(
                and_(
                    Room.expires_at != None,
                    Room.expires_at < now,
                    Room.is_active == True,
                )
            )
        )
        for room in result.scalars().all():
            await purge_room(db, room)

    async def _cleanup_stale_uploads(self, db: AsyncSession):
        """Delete uploads that were started but never finished."""
        threshold = datetime.now(timezone.utc) - STALE_UPLOAD_AFTER

        result = await db.execute(
            select(FileTransfer).where(
                and_(
                    FileTransfer.status == TransferStatus.UPLOADING,
                    FileTransfer.created_at < threshold,
                )
            )
        )
        for transfer in result.scalars().all():
            await delete_transfer(db, transfer)

    async def _cleanup_orphaned_files(self):
        """Remove any orphaned files in the uploads directory."""
        if not settings.upload_dir.exists():
            return

        # Get all transfer IDs from database
        async with async_session() as db:
            result = await db.execute(select(FileTransfer.id))
            valid_ids = {row[0] for row in result.fetchall()}

        # Check upload directory for orphans
        for item in settings.upload_dir.iterdir():
            if item.is_dir() and item.name not in valid_ids:
                # Orphaned directory - delete it
                shutil.rmtree(item, ignore_errors=True)


# Singleton instance
cleanup_service = CleanupService()
