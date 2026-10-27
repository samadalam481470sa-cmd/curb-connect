"""Runtime settings, read once from the environment (and an optional git-ignored .env file).

Misconfiguration fails fast at startup with a clear message, except for the service token: a
missing or too-short token keeps the worker up (health stays reachable) but every protected
endpoint fails closed with 503 until it is fixed.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

APP_DIR = Path(__file__).resolve().parent
SERVICE_DIR = APP_DIR.parent
DATA_DIR = APP_DIR / "data"

DEFAULT_QUALITY_CONFIG = DATA_DIR / "photo_quality_thresholds.v1.json"
DEFAULT_MODEL_REGISTRY = DATA_DIR / "model_registry.json"

# A shared secret shorter than this is treated as not configured (fail closed).
MIN_TOKEN_LENGTH = 32

AuthState = Literal["configured", "not_configured", "too_short"]


def read_env_file(path: Path) -> dict[str, str]:
    """Minimal KEY=VALUE reader for a local .env file (comments and blank lines ignored).

    Kept dependency-free on purpose; it does not expand variables or handle multi-line values.
    """
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export ") :].strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        values[key] = value
    return values


def normalize_origin(url: str) -> str:
    """Return scheme://host:port for an http(s) URL; raise ValueError otherwise."""
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError(f"origin must use http or https: {url!r}")
    if parts.username or parts.password:
        raise ValueError("origin must not contain credentials")
    host = (parts.hostname or "").lower()
    if not host:
        raise ValueError(f"origin has no host: {url!r}")
    port = parts.port or (443 if scheme == "https" else 80)
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    return f"{scheme}://{host}:{port}"


def _int(env: Mapping[str, str], key: str, default: int, minimum: int = 1) -> int:
    raw = env.get(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{key} must be an integer, got {raw!r}") from exc
    if value < minimum:
        raise ValueError(f"{key} must be >= {minimum}, got {value}")
    return value


def _float(env: Mapping[str, str], key: str, default: float) -> float:
    raw = env.get(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{key} must be a number, got {raw!r}") from exc
    if not value > 0:
        raise ValueError(f"{key} must be > 0, got {value}")
    return value


def _bool(env: Mapping[str, str], key: str) -> bool:
    raw = (env.get(key) or "").strip().lower()
    if raw in ("", "0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    raise ValueError(f"{key} must be true/false, got {raw!r}")


@dataclass(frozen=True)
class Settings:
    env: str = "development"
    service_token: str | None = None
    # Accepted alongside service_token while a rotation is in progress.
    previous_service_token: str | None = None
    # Whole request body limit (multipart overhead included) and object-reference download limit.
    max_upload_bytes: int = 25 * 1024 * 1024
    # Decoded pixel limit (width * height), checked from the header before any pixel is decoded.
    max_image_pixels: int = 50_000_000
    # Bounded concurrent analyses per process (AIQ-089-API) and how long a request may queue.
    max_concurrency: int = 2
    queue_timeout_seconds: float = 10.0
    quality_config_path: Path = DEFAULT_QUALITY_CONFIG
    model_registry_path: Path = DEFAULT_MODEL_REGISTRY
    # Origins (scheme://host:port) the worker may download object references from. Empty
    # disables object references entirely (multipart uploads still work).
    object_fetch_allowed_origins: tuple[str, ...] = ()
    object_fetch_timeout_seconds: float = 10.0
    # Global kill switch: every recognizer abstains regardless of the registry (AIQ-090-API).
    automation_kill_switch: bool = False
    log_level: str = "INFO"

    @property
    def auth_state(self) -> AuthState:
        if not self.service_token:
            return "not_configured"
        if len(self.service_token) < MIN_TOKEN_LENGTH:
            return "too_short"
        return "configured"

    def accepted_tokens(self) -> tuple[str, ...]:
        tokens = []
        for token in (self.service_token, self.previous_service_token):
            if token and len(token) >= MIN_TOKEN_LENGTH:
                tokens.append(token)
        return tuple(tokens)

    @property
    def docs_enabled(self) -> bool:
        return self.env in ("development", "test")

    @classmethod
    def from_env(
        cls,
        environ: Mapping[str, str] | None = None,
        env_file: Path | None = SERVICE_DIR / ".env",
    ) -> Settings:
        merged: dict[str, str] = {}
        if env_file is not None:
            merged.update(read_env_file(env_file))
        merged.update(os.environ if environ is None else environ)

        origins_raw = merged.get("VISION_OBJECT_FETCH_ALLOWED_ORIGINS", "")
        origins = tuple(
            dict.fromkeys(normalize_origin(item) for item in origins_raw.split(",") if item.strip())
        )
        env_name = (merged.get("VISION_ENV") or "development").strip().lower()
        if env_name not in ("development", "test", "staging", "production"):
            raise ValueError(f"VISION_ENV must be development|test|staging|production, got {env_name!r}")

        return cls(
            env=env_name,
            service_token=(merged.get("VISION_SERVICE_TOKEN") or "").strip() or None,
            previous_service_token=(merged.get("VISION_SERVICE_TOKEN_PREVIOUS") or "").strip() or None,
            max_upload_bytes=_int(merged, "VISION_MAX_UPLOAD_BYTES", cls.max_upload_bytes),
            max_image_pixels=_int(merged, "VISION_MAX_IMAGE_PIXELS", cls.max_image_pixels),
            max_concurrency=_int(merged, "VISION_MAX_CONCURRENCY", cls.max_concurrency),
            queue_timeout_seconds=_float(merged, "VISION_QUEUE_TIMEOUT_SECONDS", cls.queue_timeout_seconds),
            quality_config_path=Path(merged.get("VISION_QUALITY_CONFIG") or DEFAULT_QUALITY_CONFIG),
            model_registry_path=Path(merged.get("VISION_MODEL_REGISTRY") or DEFAULT_MODEL_REGISTRY),
            object_fetch_allowed_origins=origins,
            object_fetch_timeout_seconds=_float(
                merged, "VISION_OBJECT_FETCH_TIMEOUT_SECONDS", cls.object_fetch_timeout_seconds
            ),
            automation_kill_switch=_bool(merged, "VISION_AUTOMATION_KILL_SWITCH"),
            log_level=(merged.get("VISION_LOG_LEVEL") or "INFO").strip().upper(),
        )
