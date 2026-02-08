"""Authentication routes."""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User, InviteCode
from app.services.auth import auth_service

router = APIRouter(prefix="/auth", tags=["authentication"])
security = HTTPBearer()


# Request/Response models
class LoginRequest(BaseModel):
    """Login request body."""

    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8)


class RegisterRequest(BaseModel):
    """Registration request body."""

    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_]+$")
    password: str = Field(..., min_length=8, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=100)
    invite_code: str = Field(..., min_length=1)


class TokenResponse(BaseModel):
    """Token response body."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    """User response body."""

    id: str
    username: str
    display_name: str
    is_admin: bool
    created_at: datetime


class RefreshRequest(BaseModel):
    """Token refresh request body."""

    refresh_token: str


class ChangePasswordRequest(BaseModel):
    """Change password request body."""

    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=128)


class CreateInviteRequest(BaseModel):
    """Create invite code request body."""

    max_uses: int = Field(default=1, ge=1, le=100)
    expires_in_days: int | None = Field(default=7, ge=1, le=365)
    note: str | None = Field(default=None, max_length=255)


class InviteResponse(BaseModel):
    """Invite code response body."""

    code: str
    max_uses: int
    use_count: int
    expires_at: datetime | None
    note: str | None
    created_at: datetime


# Dependencies
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Dependency to get the current authenticated user."""
    token = credentials.credentials
    user_id = auth_service.verify_token(token, "access")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = await auth_service.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def get_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Dependency to get the current admin user."""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


# Routes
@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate user and return tokens."""
    user = await auth_service.authenticate_user(db, request.username, request.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return TokenResponse(
        access_token=auth_service.create_access_token(user.id),
        refresh_token=auth_service.create_refresh_token(user.id),
    )


@router.post("/register", response_model=TokenResponse)
async def register(request: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user with an invite code."""
    user, error = await auth_service.register_user(
        db,
        username=request.username,
        password=request.password,
        display_name=request.display_name,
        invite_code=request.invite_code,
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    return TokenResponse(
        access_token=auth_service.create_access_token(user.id),
        refresh_token=auth_service.create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(request: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Refresh access token using refresh token."""
    user_id = auth_service.verify_token(request.refresh_token, "refresh")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    user = await auth_service.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return TokenResponse(
        access_token=auth_service.create_access_token(user.id),
        refresh_token=auth_service.create_refresh_token(user.id),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current user profile."""
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        is_admin=current_user.is_admin,
        created_at=current_user.created_at,
    )


@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change the current user's password."""
    from app.services.crypto import crypto_service

    # Verify current password
    if not crypto_service.verify_password(request.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    # Ensure new password is different
    if request.current_password == request.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from current password",
        )

    # Update password
    current_user.password_hash = crypto_service.hash_password(request.new_password)
    await db.commit()

    return {"message": "Password changed successfully"}


@router.post("/invites", response_model=InviteResponse)
async def create_invite(
    request: CreateInviteRequest,
    current_user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new invite code (admin only)."""
    invite = await auth_service.create_invite_code(
        db,
        created_by=current_user.id,
        max_uses=request.max_uses,
        expires_in_days=request.expires_in_days,
        note=request.note,
    )

    return InviteResponse(
        code=invite.code,
        max_uses=invite.max_uses,
        use_count=invite.use_count,
        expires_at=invite.expires_at,
        note=invite.note,
        created_at=invite.created_at,
    )


@router.get("/invites", response_model=list[InviteResponse])
async def list_invites(
    current_user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """List invite codes (admin only)."""
    result = await db.execute(
        select(InviteCode)
        .where(InviteCode.created_by == current_user.id)
        .order_by(InviteCode.created_at.desc())
    )
    invites = result.scalars().all()

    return [
        InviteResponse(
            code=invite.code,
            max_uses=invite.max_uses,
            use_count=invite.use_count,
            expires_at=invite.expires_at,
            note=invite.note,
            created_at=invite.created_at,
        )
        for invite in invites
    ]
