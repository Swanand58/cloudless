"""Authentication service."""

from datetime import datetime, timezone, timedelta
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User, InviteCode
from app.services.crypto import crypto_service


class AuthService:
    """Authentication and authorization service."""

    @staticmethod
    def _create_token(user_id: str, token_type: str, expires_delta: timedelta) -> str:
        now = datetime.now(timezone.utc)
        to_encode = {
            "sub": user_id,
            "iat": int(now.timestamp()),
            "exp": now + expires_delta,
            "type": token_type,
        }
        return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)

    @staticmethod
    def create_access_token(user_id: str) -> str:
        """Create a JWT access token."""
        return AuthService._create_token(
            user_id, "access", timedelta(minutes=settings.access_token_expire_minutes)
        )

    @staticmethod
    def create_refresh_token(user_id: str) -> str:
        """Create a JWT refresh token."""
        return AuthService._create_token(
            user_id, "refresh", timedelta(days=settings.refresh_token_expire_days)
        )

    @staticmethod
    async def get_user_from_token(
        db: AsyncSession, token: str, token_type: str = "access"
    ) -> User | None:
        """Verify a JWT token and return its user.

        Args:
            db: Database session
            token: JWT token to verify
            token_type: Expected token type ("access" or "refresh")

        Returns:
            User if the token is valid and was issued after the user's last
            password change, None otherwise
        """
        try:
            payload = jwt.decode(
                token, settings.secret_key, algorithms=[settings.jwt_algorithm]
            )
        except JWTError:
            return None

        user_id = payload.get("sub")
        if user_id is None or payload.get("type") != token_type:
            return None

        user = await AuthService.get_user_by_id(db, user_id)
        if not user:
            return None

        changed = user.password_changed_at
        if changed and payload.get("iat", 0) < int(changed.timestamp()):
            return None

        return user

    @staticmethod
    async def authenticate_user(
        db: AsyncSession, username: str, password: str
    ) -> User | None:
        """Authenticate a user by username and password.

        Args:
            db: Database session
            username: Username to authenticate
            password: Password to verify

        Returns:
            User if authenticated, None otherwise
        """
        result = await db.execute(
            select(User).where(User.username == username, User.is_active == True)
        )
        user = result.scalar_one_or_none()

        if not user:
            # Prevent timing attacks by still performing hash operation
            crypto_service.hash_password("dummy_password")
            return None

        if not crypto_service.verify_password(password, user.password_hash):
            return None

        # Rehash password if needed (parameters changed)
        if crypto_service.needs_rehash(user.password_hash):
            user.password_hash = crypto_service.hash_password(password)

        # Update last login
        user.last_login = datetime.now(timezone.utc)

        return user

    @staticmethod
    async def register_user(
        db: AsyncSession,
        username: str,
        password: str,
        display_name: str,
        invite_code: str,
    ) -> tuple[User | None, str]:
        """Register a new user with an invite code.

        Args:
            db: Database session
            username: Desired username
            password: Password
            display_name: Display name
            invite_code: Invite code for registration

        Returns:
            Tuple of (User if successful, error message if failed)
        """
        # Validate invite code
        result = await db.execute(
            select(InviteCode).where(InviteCode.code == invite_code)
        )
        invite = result.scalar_one_or_none()

        if not invite:
            return None, "Invalid invite code"

        if not invite.is_valid:
            return None, "Invite code has expired or been used"

        # Check if username already exists
        result = await db.execute(select(User).where(User.username == username))
        if result.scalar_one_or_none():
            return None, "Username already taken"

        # Validate password strength
        if len(password) < 8:
            return None, "Password must be at least 8 characters"

        # Create user
        user = User(
            username=username,
            password_hash=crypto_service.hash_password(password),
            display_name=display_name,
            is_admin=False,
        )
        db.add(user)
        await db.flush()  # Assigns user.id

        # Mark invite as used
        invite.use_count += 1
        invite.used_by = user.id

        return user, ""

    @staticmethod
    async def create_invite_code(
        db: AsyncSession,
        created_by: str,
        max_uses: int = 1,
        expires_in_days: int | None = 7,
        note: str | None = None,
    ) -> InviteCode:
        """Create a new invite code.

        Args:
            db: Database session
            created_by: User ID of the creator
            max_uses: Maximum number of times code can be used
            expires_in_days: Days until expiration (None for no expiry)
            note: Optional note about who the invite is for

        Returns:
            Created invite code
        """
        expires_at = None
        if expires_in_days:
            expires_at = datetime.now(timezone.utc) + timedelta(days=expires_in_days)

        invite = InviteCode(
            created_by=created_by,
            max_uses=max_uses,
            expires_at=expires_at,
            note=note,
        )
        db.add(invite)
        await db.flush()

        return invite

    @staticmethod
    async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
        """Get a user by ID.

        Args:
            db: Database session
            user_id: User ID

        Returns:
            User if found, None otherwise
        """
        result = await db.execute(
            select(User).where(User.id == user_id, User.is_active == True)
        )
        return result.scalar_one_or_none()


# Singleton instance
auth_service = AuthService()
