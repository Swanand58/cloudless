"""File transfer routes."""

import os
import aiofiles
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.models.transfer import FileTransfer, TransferStatus, generate_transfer_id
from app.routers.auth import get_current_user
from app.routers.rooms import verify_room_membership
from app.routers.websocket import manager as ws_manager
from app.services.cleanup import delete_transfer

router = APIRouter(prefix="/transfers", tags=["transfers"])

# Each stored chunk is nonce (24 bytes) + ciphertext + auth tag (16 bytes)
MAX_SEALED_CHUNK_SIZE = settings.chunk_size + 40


# Request/Response models
class InitTransferRequest(BaseModel):
    """Initialize transfer request body."""

    room_id: str
    encrypted_meta: str = Field(
        ...,
        max_length=200_000,
        description="Base64 encoded encrypted metadata (name, type, hash, thumbnail)",
    )
    file_size: int = Field(..., gt=0, le=settings.max_file_size_mb * 1024 * 1024)


class TransferResponse(BaseModel):
    """Transfer response body."""

    id: str
    room_id: str
    sender_id: str
    sender_name: str
    encrypted_meta: str
    file_size: int
    status: str
    total_chunks: int
    created_at: datetime


class ChunkUploadResponse(BaseModel):
    """Chunk upload response body."""

    transfer_id: str
    chunk_index: int
    uploaded_chunks: int
    total_chunks: int
    status: str


# Helper functions
def transfer_response(transfer: FileTransfer, sender_name: str) -> TransferResponse:
    """Build a transfer response."""
    return TransferResponse(
        id=transfer.id,
        room_id=transfer.room_id,
        sender_id=transfer.sender_id,
        sender_name=sender_name,
        encrypted_meta=transfer.encrypted_meta,
        file_size=transfer.file_size,
        status=transfer.status.value,
        total_chunks=transfer.total_chunks,
        created_at=transfer.created_at,
    )


async def get_transfer_or_404(db: AsyncSession, transfer_id: str) -> FileTransfer:
    """Load a transfer by ID."""
    result = await db.execute(
        select(FileTransfer).where(FileTransfer.id == transfer_id)
    )
    transfer = result.scalar_one_or_none()

    if not transfer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transfer not found",
        )

    return transfer


async def read_body_capped(request: Request, limit: int) -> bytes:
    """Read the request body, refusing anything larger than limit bytes."""
    body = bytearray()
    async for part in request.stream():
        body += part
        if len(body) > limit:
            raise HTTPException(
                status_code=413,
                detail="Chunk too large",
            )
    return bytes(body)


# Routes
@router.post("", response_model=TransferResponse)
async def init_transfer(
    request: InitTransferRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Initialize a new file transfer."""
    await verify_room_membership(db, request.room_id, current_user.id)

    # Refuse new uploads once the disk budget is spent
    result = await db.execute(select(func.coalesce(func.sum(FileTransfer.file_size), 0)))
    if result.scalar_one() + request.file_size > settings.max_storage_gb * 1024**3:
        raise HTTPException(
            status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
            detail="Server storage is full",
        )

    transfer = FileTransfer(
        id=generate_transfer_id(),
        room_id=request.room_id,
        sender_id=current_user.id,
        encrypted_meta=request.encrypted_meta,
        file_size=request.file_size,
        status=TransferStatus.UPLOADING,
        total_chunks=(request.file_size + settings.chunk_size - 1) // settings.chunk_size,
    )

    db.add(transfer)
    await db.flush()

    return transfer_response(transfer, current_user.display_name)


@router.post("/{transfer_id}/chunks/{chunk_index}", response_model=ChunkUploadResponse)
async def upload_chunk(
    transfer_id: str,
    chunk_index: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload an encrypted file chunk as the raw request body.

    Safe to retry: re-sending a chunk overwrites it and is not counted twice.
    """
    transfer = await get_transfer_or_404(db, transfer_id)

    # Verify sender
    if transfer.sender_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the sender can upload chunks",
        )

    # Verify chunk index
    if chunk_index < 0 or chunk_index >= transfer.total_chunks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid chunk index: {chunk_index}",
        )

    became_ready = False
    uploaded_chunks = transfer.total_chunks

    if transfer.status == TransferStatus.UPLOADING:
        content = await read_body_capped(request, MAX_SEALED_CHUNK_SIZE)
        if not content:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty chunk",
            )

        # Write to a temp name first so a half-written chunk is never counted
        transfer.storage_dir.mkdir(parents=True, exist_ok=True)
        chunk_path = transfer.chunk_path(chunk_index)
        temp_path = chunk_path.with_suffix(".tmp")
        async with aiofiles.open(temp_path, "wb") as f:
            await f.write(content)
        os.replace(temp_path, chunk_path)

        uploaded_chunks = sum(
            1 for p in transfer.storage_dir.iterdir() if p.suffix != ".tmp"
        )
        if uploaded_chunks >= transfer.total_chunks:
            transfer.status = TransferStatus.READY
            became_ready = True

        # Commit the changes
        await db.commit()

    # Tell the room once the file is complete
    if became_ready:
        await ws_manager.broadcast_to_room(
            transfer.room_id,
            {
                "type": "new_transfer",
                "transfer_id": transfer.id,
                "sender_id": current_user.id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

    return ChunkUploadResponse(
        transfer_id=transfer.id,
        chunk_index=chunk_index,
        uploaded_chunks=uploaded_chunks,
        total_chunks=transfer.total_chunks,
        status=transfer.status.value,
    )


@router.get("/{transfer_id}/download")
async def download_file(
    transfer_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream an encrypted file as its stored chunks, in order."""
    transfer = await get_transfer_or_404(db, transfer_id)
    await verify_room_membership(db, transfer.room_id, current_user.id)

    if transfer.status != TransferStatus.READY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transfer not ready: {transfer.status.value}",
        )

    paths = [transfer.chunk_path(i) for i in range(transfer.total_chunks)]
    try:
        total_size = sum(p.stat().st_size for p in paths)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="File is no longer available",
        )

    def iter_chunks():
        for path in paths:
            yield path.read_bytes()

    return StreamingResponse(
        iter_chunks(),
        media_type="application/octet-stream",
        headers={"Content-Length": str(total_size)},
    )


@router.get("/room/{room_id}", response_model=list[TransferResponse])
async def list_room_transfers(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List completed transfers in a room, oldest first.

    ponytail: returns every transfer with its thumbnail in one response.
    Paginate if rooms grow to many hundreds of images.
    """
    room = await verify_room_membership(db, room_id, current_user.id)
    names = {m.user_id: m.user.display_name for m in room.members}

    result = await db.execute(
        select(FileTransfer)
        .where(
            FileTransfer.room_id == room_id,
            FileTransfer.status == TransferStatus.READY,
        )
        .order_by(FileTransfer.created_at)
    )

    return [
        transfer_response(t, names.get(t.sender_id, "Unknown"))
        for t in result.scalars().all()
    ]


@router.delete("/{transfer_id}")
async def cancel_transfer(
    transfer_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a transfer and delete its data (sender only)."""
    transfer = await get_transfer_or_404(db, transfer_id)

    if transfer.sender_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the sender can cancel a transfer",
        )

    await delete_transfer(db, transfer)
    return {"message": "Transfer cancelled"}
