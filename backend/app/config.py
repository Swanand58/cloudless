"""Application configuration using pydantic-settings."""

import secrets
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Application
    app_name: str = "Cloudless"
    debug: bool = False

    # Security
    secret_key: str = secrets.token_urlsafe(32)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    # Database
    database_url: str = "sqlite+aiosqlite:///./cloudless.db"

    # File Storage
    upload_dir: Path = Path("./uploads")
    max_file_size_mb: int = 1024  # 1GB max
    file_expiry_hours: int = 24
    chunk_size: int = 64 * 1024  # 64KB chunks

    # Rate Limiting (increased for dev - frontend makes multiple API calls per page)
    rate_limit_requests: int = 300
    rate_limit_window_seconds: int = 60

    # CORS (will be restricted to frontend origin in production)
    cors_origins: list[str] = ["http://localhost:3000"]

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Ensure upload directory exists
        self.upload_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
