"""Application configuration using pydantic-settings."""

import secrets
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Values shipped in example files; never acceptable outside debug mode
_PLACEHOLDER_MARKERS = ("change", "your-secret-key", "dev-secret")


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # Tolerate stale keys in an old .env
    )

    # Application
    app_name: str = "Cloudless"
    debug: bool = False

    # Security
    secret_key: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    # Password for the first admin account (random and logged once if unset)
    admin_password: str | None = None

    # Database
    database_url: str = "sqlite+aiosqlite:///./cloudless.db"

    # File Storage
    upload_dir: Path = Path("./uploads")
    max_file_size_mb: int = 50
    max_storage_gb: int = 20  # Total across all rooms
    chunk_size: int = 512 * 1024  # 512KB chunks, must match the frontend

    # Rooms
    room_expiry_days: int = 7

    # Rate Limiting (per client IP)
    rate_limit_requests: int = 300
    rate_limit_window_seconds: int = 60
    auth_rate_limit_requests: int = 10  # login and register

    # CORS - empty in production, where frontend and API share one origin
    cors_origins: list[str] = []

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        weak = len(self.secret_key) < 32 or any(
            marker in self.secret_key for marker in _PLACEHOLDER_MARKERS
        )
        if weak:
            if not self.debug:
                raise ValueError(
                    "SECRET_KEY is missing or a placeholder. "
                    "Generate one with: openssl rand -hex 32"
                )
            # Debug only: sessions will not survive a restart
            self.secret_key = secrets.token_urlsafe(32)

        # Ensure upload directory exists
        self.upload_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
