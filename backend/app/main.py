"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db, close_db
from app.routers import auth_router, rooms_router, transfer_router
from app.routers.websocket import router as websocket_router
from app.middleware.security import SecurityHeadersMiddleware
from app.services.cleanup import cleanup_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    await init_db()
    await cleanup_service.start()

    # Create initial admin user if none exists
    await create_initial_admin()

    yield

    # Shutdown
    await cleanup_service.stop()
    await close_db()


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

        # Create admin user
        admin = User(
            username="admin",
            password_hash=crypto_service.hash_password("changeme123"),
            display_name="Administrator",
            is_admin=True,
        )
        db.add(admin)
        await db.commit()

        print("=" * 60)
        print("INITIAL ADMIN USER CREATED")
        print("Username: admin")
        print("Password: changeme123")
        print("PLEASE CHANGE THIS PASSWORD IMMEDIATELY!")
        print("=" * 60)


# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    description="Secure self-hosted file transfer application with end-to-end encryption",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,  # Disable docs in production
    redoc_url="/redoc" if settings.debug else None,
)

# Add CORS middleware FIRST (middleware runs in reverse order, so add last)
# This must be before security headers to handle preflight requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.trycloudflare\.com",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Transfer-Nonce"],
)

# Add security headers middleware AFTER CORS
app.add_middleware(SecurityHeadersMiddleware)

# Include routers
app.include_router(auth_router, prefix="/api")
app.include_router(rooms_router, prefix="/api")
app.include_router(transfer_router, prefix="/api")
app.include_router(websocket_router, prefix="/api")


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "app": settings.app_name}


@app.get("/")
async def root():
    """Root endpoint - redirect info."""
    return {
        "message": f"Welcome to {settings.app_name}",
        "docs": "/docs" if settings.debug else "Disabled in production",
        "health": "/api/health",
    }
