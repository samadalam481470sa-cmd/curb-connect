"""Settings read from environment variables (or a .env file loaded by the shell)."""

import os
import secrets
import warnings
from dataclasses import dataclass, field
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parent.parent


def _list(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _secret_key() -> str:
    key = os.environ.get("SECRET_KEY", "")
    if key:
        if len(key) < 32:
            raise RuntimeError("SECRET_KEY must be at least 32 characters.")
        return key
    if os.environ.get("APP_ENV", "development") == "production":
        raise RuntimeError("SECRET_KEY is required in production.")
    warnings.warn("SECRET_KEY is not set; using a random key, so logins reset when the server restarts.")
    return secrets.token_urlsafe(48)


@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: os.environ.get("DATABASE_URL", f"sqlite:///{SERVER_ROOT / 'data' / 'curbconnect.db'}")
    )
    secret_key: str = field(default_factory=_secret_key)
    access_token_minutes: int = field(default_factory=lambda: int(os.environ.get("ACCESS_TOKEN_MINUTES", "720")))
    upload_dir: Path = field(default_factory=lambda: Path(os.environ.get("UPLOAD_DIR", SERVER_ROOT / "data" / "uploads")))
    max_upload_bytes: int = field(default_factory=lambda: int(os.environ.get("MAX_UPLOAD_MB", "25")) * 1024 * 1024)
    cors_origins: list[str] = field(
        default_factory=lambda: _list(os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"))
    )
    app_url: str = field(default_factory=lambda: os.environ.get("APP_URL", "http://localhost:5173"))


settings = Settings()
