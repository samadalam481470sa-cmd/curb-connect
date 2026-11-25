"""Swath worker configuration (environment only — never commit secrets).

Mirrors apps/mailer/src/config.ts: validated at startup, bad values stop the
process naming the variable, never its value. The database URL is the same
database the API uses (on Render: the curb-connect-db connection string); the
worker writes with it the way the mailer writes with MAILER_DATABASE_URL.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from .mesh import MRMS_BASE_URL


@dataclass(frozen=True)
class SwathConfig:
    database_url: str | None
    mesh_base_url: str
    interval_minutes: int
    host: str
    port: int
    work_dir: str | None


def load_config(env: dict[str, str] | None = None) -> SwathConfig:
    """Read the worker's env contract. `database_url` may be None for --dry-run."""
    source = env if env is not None else os.environ

    def optional(name: str) -> str | None:
        value = (source.get(name) or "").strip()
        return value or None

    interval_raw = (source.get("SWATH_INTERVAL_MINUTES") or "30").strip()
    try:
        interval = int(interval_raw)
    except ValueError:
        raise ValueError(f"SWATH_INTERVAL_MINUTES must be a whole number of minutes, got {interval_raw!r}.") from None
    if not 5 <= interval <= 240:
        raise ValueError("SWATH_INTERVAL_MINUTES must be between 5 and 240.")

    # Render sets PORT; SWATH_PORT wins when both are set (local default 4310).
    port_raw = (source.get("SWATH_PORT") or source.get("PORT") or "4310").strip()
    try:
        port = int(port_raw)
    except ValueError:
        raise ValueError(f"SWATH_PORT must be a port number, got {port_raw!r}.") from None
    if not 1 <= port <= 65535:
        raise ValueError("SWATH_PORT must be between 1 and 65535.")

    return SwathConfig(
        database_url=optional("SWATH_DATABASE_URL"),
        mesh_base_url=(source.get("SWATH_MESH_BASE_URL") or MRMS_BASE_URL).strip(),
        interval_minutes=interval,
        host=(source.get("SWATH_HOST") or "127.0.0.1").strip(),
        port=port,
        work_dir=optional("SWATH_WORK_DIR"),
    )


def require_database_url(config: SwathConfig) -> str:
    """The owner database URL, required for every run that stores a swath."""
    if not config.database_url:
        raise ValueError(
            "SWATH_DATABASE_URL is not set. Set it to the same database the API uses "
            "(on Render: fromDatabase curb-connect-db) or run with --dry-run to skip storing."
        )
    return config.database_url
