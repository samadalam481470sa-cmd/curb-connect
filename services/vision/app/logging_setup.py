"""Structured JSON logs (one object per line on stdout), safe for central ingestion (AIQ-088).

Never logged: image bytes, file names, signed object URLs, bearer tokens, EXIF values (GPS,
capture time), request bodies, query strings. Structured fields pass through `redact()` as a
second line of defence in case a future caller adds a sensitive key by mistake.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

from app import SERVICE_NAME, __version__

# Keys whose values are always replaced, at any nesting depth (compared case-insensitively).
SENSITIVE_KEYS = frozenset(
    {
        "authorization",
        "token",
        "servicetoken",
        "url",
        "objecturl",
        "filename",
        "file_name",
        "gps",
        "gpsinfo",
        "capturedat",
        "password",
        "secret",
        "cookie",
        "signature",
        "image",
        "body",
        "data",
        "bytes",
    }
)
REDACTED = "[redacted]"
_MAX_STRING = 512


def redact(value: Any, depth: int = 0) -> Any:
    if depth > 6:
        return REDACTED
    if isinstance(value, dict):
        return {
            str(k): (REDACTED if str(k).lower() in SENSITIVE_KEYS else redact(v, depth + 1)) for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v, depth + 1) for v in value[:50]]
    if isinstance(value, (bytes, bytearray, memoryview)):
        return REDACTED
    if isinstance(value, str) and len(value) > _MAX_STRING:
        return value[:_MAX_STRING] + "...[truncated]"
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "service": SERVICE_NAME,
            "serviceVersion": __version__,
            "logger": record.name,
            "event": getattr(record, "event", None) or record.getMessage(),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            for key, value in redact(fields).items():
                payload.setdefault(key, value)
        if record.exc_info and record.exc_info[0] is not None:
            payload["exceptionType"] = record.exc_info[0].__name__
            payload["traceback"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, separators=(",", ":"), ensure_ascii=False)


def log_event(logger: logging.Logger, level: int, event: str, **fields: Any) -> None:
    logger.log(level, event, extra={"event": event, "fields": fields})


_HANDLER_MARK = "_fieldline_vision_json"


def configure_logging(level: str = "INFO") -> None:
    """Route this service's and uvicorn's logs through the JSON formatter (idempotent)."""
    root = logging.getLogger()
    if not any(getattr(h, _HANDLER_MARK, False) for h in root.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        setattr(handler, _HANDLER_MARK, True)
        root.addHandler(handler)
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error"):
        uv = logging.getLogger(name)
        uv.handlers.clear()
        uv.propagate = True
    # uvicorn's access log prints client addresses and full request lines (query strings may hold
    # signed URLs). The request middleware emits a redacted `http_request` event instead.
    access = logging.getLogger("uvicorn.access")
    access.handlers.clear()
    access.propagate = False
    access.disabled = True
