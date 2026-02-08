"""File transfer routes."""

import os
import aiofiles
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db, async_session
from app.models.user import User
from app.models.room import Room, RoomMember
from app.models.user import User as UserModel
from app.models.transfer import FileTransfer, TransferStatus, TransferMode, generate_transfer_id
from app.routers.auth import get_current_user
from app.services.crypto import crypto_service
from app.routers.websocket import manager as ws_manager

router = APIRouter(prefix="/transfers", tags=["transfers"])


# Request/Response models
class InitTransferRequest(BaseModel):
    """Initialize transfer request body."""

    room_id: str
    encrypted_filename: str = Field(..., description="Base64 encoded encrypted filename")
    encrypted_mimetype: str | None = Field(
        default=None, description="Base64 encoded encrypted mimetype"
    )
    file_size: int = Field(..., gt=0, le=settings.max_file_size_mb * 1024 * 1024)
    nonce: str = Field(..., description="Base64 encoded nonce for encryption")
    mode: str = Field(default="relay", pattern="^(p2p|relay)$")
    expires_in_hours: int | None = Field(default=24, ge=1, le=168)
    max_downloads: int = Field(default=9999, ge=1, le=9999)


class TransferResponse(BaseModel):
    """Transfer response body."""

    id: str
    room_id: str
    sender_id: str
    sender_name: str
    encrypted_filename: str
    encrypted_mimetype: str | None
    file_size: int
    mode: str
    status: str
    nonce: str
    total_chunks: int
    uploaded_chunks: int
    created_at: datetime
    expires_at: datetime | None
    download_count: int
    max_downloads: int


class ChunkUploadResponse(BaseModel):
    """Chunk upload response body."""

    transfer_id: str
    chunk_index: int
    uploaded_chunks: int
    total_chunks: int
    status: str


# Helper functions
async def verify_room_membership(
    db: AsyncSession, room_id: str, user_id: str
) -> tuple[Room, RoomMember]:
    """Verify user is a member of the room."""
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

    if room.is_expired:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Room has expired",
        )

    member = next((m for m in room.members if m.user_id == user_id), None)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this room",
        )

    return room, member


# Routes
@router.post("", response_model=TransferResponse)
async def init_transfer(
    request: InitTransferRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Initialize a new file transfer."""
    room, _ = await verify_room_membership(db, request.room_id, current_user.id)

    # Check if relay is allowed for this room
    mode = TransferMode(request.mode)
    if mode == TransferMode.RELAY and not room.allow_relay:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Relay transfers not allowed in this room",
        )

    # Calculate number of chunks
    total_chunks = (request.file_size + settings.chunk_size - 1) // settings.chunk_size

    # Calculate expiration
    expires_at = None
    if request.expires_in_hours:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=request.expires_in_hours)

    # Generate transfer ID upfront so we can use it for storage path
    transfer_id = generate_transfer_id()
    
    # Create storage directory for relay mode
    storage_path = None
    if mode == TransferMode.RELAY:
        transfer_dir = settings.upload_dir / transfer_id
        transfer_dir.mkdir(parents=True, exist_ok=True)
        storage_path = str(transfer_dir)

    # Create transfer record
    transfer = FileTransfer(
        id=transfer_id,
        room_id=request.room_id,
        sender_id=current_user.id,
        encrypted_filename=request.encrypted_filename,
        encrypted_mimetype=request.encrypted_mimetype,
        file_size=request.file_size,
        mode=mode,
        status=TransferStatus.PENDING,
        nonce=request.nonce,
        total_chunks=total_chunks,
        expires_at=expires_at,
        max_downloads=request.max_downloads,
        storage_path=storage_path,
    )

    db.add(transfer)
    await db.flush()

    return TransferResponse(
        id=transfer.id,
        room_id=transfer.room_id,
        sender_id=transfer.sender_id,
        sender_name=current_user.display_name,
        encrypted_filename=transfer.encrypted_filename,
        encrypted_mimetype=transfer.encrypted_mimetype,
        file_size=transfer.file_size,
        mode=transfer.mode.value,
        status=transfer.status.value,
        nonce=transfer.nonce,
        total_chunks=transfer.total_chunks,
        uploaded_chunks=transfer.uploaded_chunks,
        created_at=transfer.created_at,
        expires_at=transfer.expires_at,
        download_count=transfer.download_count,
        max_downloads=transfer.max_downloads,
    )


@router.post("/{transfer_id}/chunks/{chunk_index}", response_model=ChunkUploadResponse)
async def upload_chunk(
    transfer_id: str,
    chunk_index: int,
    chunk: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload an encrypted file chunk."""
    # Get transfer
    result = await db.execute(
        select(FileTransfer).where(FileTransfer.id == transfer_id)
    )
    transfer = result.scalar_one_or_none()

    if not transfer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transfer not found",
        )

    # Verify sender
    if transfer.sender_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the sender can upload chunks",
        )

    # Verify transfer state
    if transfer.status not in [TransferStatus.PENDING, TransferStatus.UPLOADING]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot upload to transfer in state: {transfer.status.value}",
        )

    # Verify chunk index
    if chunk_index < 0 or chunk_index >= transfer.total_chunks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid chunk index: {chunk_index}",
        )

    # Verify relay mode
    if transfer.mode != TransferMode.RELAY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chunk upload only supported for relay transfers",
        )

    # Write chunk to disk
    chunk_path = os.path.join(transfer.storage_path, f"chunk_{chunk_index:06d}")
    async with aiofiles.open(chunk_path, "wb") as f:
        content = await chunk.read()
        await f.write(content)

    # Update transfer status
    transfer.uploaded_chunks += 1
    if transfer.status == TransferStatus.PENDING:
        transfer.status = TransferStatus.UPLOADING

    transfer_ready = False
    if transfer.uploaded_chunks >= transfer.total_chunks:
        transfer.status = TransferStatus.READY
        transfer_ready = True

    # Commit the changes
    await db.commit()

    # Broadcast transfer update via WebSocket when ready
    if transfer_ready:
        await ws_manager.broadcast_to_room(
            transfer.room_id,
            {
                "type": "new_transfer",
                "transfer_id": transfer.id,
                "sender_id": current_user.id,
                "sender_name": current_user.display_name,
                "encrypted_filename": transfer.encrypted_filename,
                "file_size": transfer.file_size,
                "status": transfer.status.value,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

    return ChunkUploadResponse(
        transfer_id=transfer.id,
        chunk_index=chunk_index,
        uploaded_chunks=transfer.uploaded_chunks,
        total_chunks=transfer.total_chunks,
        status=transfer.status.value,
    )


@router.get("/{transfer_id}", response_model=TransferResponse)
async def get_transfer(
    transfer_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get transfer details."""
    result = await db.execute(
        select(FileTransfer)
        .where(FileTransfer.id == transfer_id)
        .options(
            selectinload(FileTransfer.room)
            .selectinload(Room.members)
            .selectinload(RoomMember.user)
        )
    )
    transfer = result.scalar_one_or_none()

    if not transfer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transfer not found",
        )

    # Verify user is in the room
    is_member = any(m.user_id == current_user.id for m in transfer.room.members)
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this room",
        )

    # Get sender name
    sender = next(
        (m.user for m in transfer.room.members if m.user_id == transfer.sender_id),
        None,
    )
    sender_name = sender.display_name if sender else "Unknown"

    return TransferResponse(
        id=transfer.id,
        room_id=transfer.room_id,
        sender_id=transfer.sender_id,
        sender_name=sender_name,
        encrypted_filename=transfer.encrypted_filename,
        encrypted_mimetype=transfer.encrypted_mimetype,
        file_size=transfer.file_size,
        mode=transfer.mode.value,
        status=transfer.status.value,
        nonce=transfer.nonce,
        total_chunks=transfer.total_chunks,
        uploaded_chunks=transfer.uploaded_chunks,
        created_at=transfer.created_at,
        expires_at=transfer.expires_at,
        download_count=transfer.download_count,
        max_downloads=transfer.max_downloads,
    )


@router.get("/{transfer_id}/download")
async def download_file(
    transfer_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download an encrypted file.
    
    Returns the complete file content in memory (suitable for files up to 1GB).
    """
    result = await db.execute(
        select(FileTransfer)
        .where(FileTransfer.id == transfer_id)
        .options(selectinload(FileTransfer.room).selectinload(Room.members))
    )
    transfer = result.scalar_one_or_none()

    if not transfer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transfer not found",
        )

    # Verify user is in the room
    is_member = any(m.user_id == current_user.id for m in transfer.room.members)
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this room",
        )

    # Check if downloadable
    if not transfer.can_download:
        if transfer.is_expired:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="Transfer has expired",
            )
        if transfer.download_count >= transfer.max_downloads:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="Maximum downloads reached",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transfer not ready: {transfer.status.value}",
        )

    # Get values we need
    storage_path = transfer.storage_path
    total_chunks = transfer.total_chunks
    file_size = transfer.file_size
    nonce = transfer.nonce

    # Update download count
    transfer.download_count += 1
    if transfer.download_count >= transfer.max_downloads:
        transfer.status = TransferStatus.COMPLETED
        transfer.completed_at = datetime.now(timezone.utc)
    
    # Commit download count update
    await db.commit()
    
    # Read all chunks into memory
    chunks = []
    for i in range(total_chunks):
        chunk_path = os.path.join(storage_path, f"chunk_{i:06d}")
        async with aiofiles.open(chunk_path, "rb") as f:
            chunks.append(await f.read())
    
    # Combine all chunks
    file_data = b"".join(chunks)

    return Response(
        content=file_data,
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(len(file_data)),
            "X-Transfer-Nonce": nonce,
        },
    )


@router.get("/room/{room_id}", response_model=list[TransferResponse])
async def list_room_transfers(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all transfers in a room."""
    room, _ = await verify_room_membership(db, room_id, current_user.id)

    result = await db.execute(
        select(FileTransfer)
        .where(FileTransfer.room_id == room_id)
        .order_by(FileTransfer.created_at.desc())
    )
    transfers = result.scalars().all()

    # Get member info for sender names
    members_result = await db.execute(
        select(RoomMember)
        .where(RoomMember.room_id == room_id)
        .options(selectinload(RoomMember.user))
    )
    members = {m.user_id: m.user for m in members_result.scalars().all()}

    return [
        TransferResponse(
            id=t.id,
            room_id=t.room_id,
            sender_id=t.sender_id,
            sender_name=members.get(t.sender_id, {}).display_name
            if members.get(t.sender_id)
            else "Unknown",
            encrypted_filename=t.encrypted_filename,
            encrypted_mimetype=t.encrypted_mimetype,
            file_size=t.file_size,
            mode=t.mode.value,
            status=t.status.value,
            nonce=t.nonce,
            total_chunks=t.total_chunks,
            uploaded_chunks=t.uploaded_chunks,
            created_at=t.created_at,
            expires_at=t.expires_at,
            download_count=t.download_count,
            max_downloads=t.max_downloads,
        )
        for t in transfers
    ]


@router.delete("/{transfer_id}")
async def cancel_transfer(
    transfer_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a transfer (sender only)."""
    result = await db.execute(
        select(FileTransfer).where(FileTransfer.id == transfer_id)
    )
    transfer = result.scalar_one_or_none()

    if not transfer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transfer not found",
        )

    if transfer.sender_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the sender can cancel a transfer",
        )

    # Mark as cancelled
    transfer.status = TransferStatus.CANCELLED

    # Clean up storage if relay mode
    if transfer.mode == TransferMode.RELAY and transfer.storage_path:
        import shutil

        if os.path.exists(transfer.storage_path):
            shutil.rmtree(transfer.storage_path)

    return {"message": "Transfer cancelled"}
