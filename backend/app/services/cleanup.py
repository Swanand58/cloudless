"""Cleanup service for expired files and transfers."""

import os
import shutil
import asyncio
from datetime import datetime, timezone
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.transfer import FileTransfer, TransferStatus
from app.models.room import Room


class CleanupService:
    """Service to clean up expired files and transfers."""

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
            except Exception as e:
                # Log error but don't crash
                print(f"Cleanup error: {e}")
            await asyncio.sleep(self.interval)

    async def cleanup(self):
        """Run cleanup tasks."""
        async with async_session() as db:
            await self._cleanup_expired_transfers(db)
            await self._cleanup_expired_rooms(db)
            await self._cleanup_orphaned_files()
            await db.commit()

    async def _cleanup_expired_transfers(self, db: AsyncSession):
        """Clean up expired file transfers."""
        now = datetime.now(timezone.utc)

        # Find expired transfers
        result = await db.execute(
            select(FileTransfer).where(
                and_(
                    FileTransfer.expires_at != None,
                    FileTransfer.expires_at < now,
                    FileTransfer.status.not_in(
                        [TransferStatus.EXPIRED, TransferStatus.CANCELLED]
                    ),
                )
            )
        )
        expired_transfers = result.scalars().all()

        for transfer in expired_transfers:
            # Delete storage
            if transfer.storage_path and os.path.exists(transfer.storage_path):
                shutil.rmtree(transfer.storage_path)
            transfer.status = TransferStatus.EXPIRED

        # Also clean up completed transfers older than file_expiry_hours
        expiry_threshold = now - timedelta(hours=settings.file_expiry_hours)
        result = await db.execute(
            select(FileTransfer).where(
                and_(
                    FileTransfer.status == TransferStatus.COMPLETED,
                    FileTransfer.completed_at != None,
                    FileTransfer.completed_at < expiry_threshold,
                )
            )
        )
        completed_transfers = result.scalars().all()

        for transfer in completed_transfers:
            if transfer.storage_path and os.path.exists(transfer.storage_path):
                shutil.rmtree(transfer.storage_path)

    async def _cleanup_expired_rooms(self, db: AsyncSession):
        """Deactivate expired rooms."""
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
        expired_rooms = result.scalars().all()

        for room in expired_rooms:
            room.is_active = False

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
                shutil.rmtree(item)


# Import timedelta
from datetime import timedelta

# Singleton instance
cleanup_service = CleanupService()
