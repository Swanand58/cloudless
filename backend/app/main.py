"""FastAPI application entry point."""

import logging
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db, close_db
from app.routers import auth_router, rooms_router, transfer_router
from app.routers.websocket import router as websocket_router
from app.middleware.security import SecurityHeadersMiddleware
from app.services.cleanup import cleanup_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    await init_db()
    await reset_online_status()
    await create_initial_admin()
    await cleanup_service.start()

    yield

    # Shutdown
    await cleanup_service.stop()
    await close_db()


async def reset_online_status():
    """Nobody is connected right after a start, whatever the last run left."""
    from sqlalchemy import update
    from app.database import async_session
    from app.models.room import RoomMember

    async with async_session() as db:
        await db.execute(update(RoomMember).values(is_online=False))
        await db.commit()


async def create_initial_admin():
    """Create initial admin user if database is empty."""
    from sqlalchemy import select
    from app.database import async_session
    from app.models.user import User
    from app.services.crypto import crypto_service

    async with async_session() as db:
        # Check if any users exist
        result = await db.execute(select(User).limit(1))
        if result.scalar_one_or_none():
            return  # Users exist, skip

        password = settings.admin_password or secrets.token_urlsafe(12)

        # Create admin user
        admin = User(
            username="admin",
            password_hash=crypto_service.hash_password(password),
            display_name="Administrator",
            is_admin=True,
        )
        db.add(admin)
        await db.commit()

        if settings.admin_password:
            logger.warning("Initial admin user 'admin' created with ADMIN_PASSWORD")
        else:
            # Shown once; it is not stored anywhere in plain text
            logger.warning(
                "Initial admin user created. Username: admin  Password: %s  "
                "(change it in Settings)",
                password,
            )


# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    description="Secure self-hosted file transfer application with end-to-end encryption",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,  # Disable docs in production
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
)

# Security headers and rate limiting
app.add_middleware(SecurityHeadersMiddleware)

# CORS is only needed in local development, where the frontend runs on its
# own port. Added last so it wraps the middleware above and answers preflights.
if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

# Include routers
app.include_router(auth_router, prefix="/api")
app.include_router(rooms_router, prefix="/api")
app.include_router(transfer_router, prefix="/api")
app.include_router(websocket_router, prefix="/api")


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "app": settings.app_name}
