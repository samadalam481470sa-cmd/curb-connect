"""Image input: multipart upload or object reference (signed URL from the Fieldline API).

Multipart: `file` (the image) and optional `context` (a JSON string). No other parts allowed.
JSON:      {"objectRef": {"url", "sha256", "objectId"?}, "context": {...}}.

Object references are fetched only from configured origins, without redirects or proxies, with
the body size limit and a timeout, and the bytes must match the declared SHA-256. The URL is a
bearer credential: it is never logged, echoed, or included in error details.
"""

from __future__ import annotations

import hashlib
import hmac
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Generic, Literal, TypeVar
from urllib.parse import urlsplit

from pydantic import BaseModel, ValidationError
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException
from starlette.requests import Request

from app import __version__
from app.problems import VisionProblem, validation_errors
from app.schemas.common import ObjectRef, ProblemFieldError
from app.settings import Settings, normalize_origin

C = TypeVar("C", bound=BaseModel)

_CONTEXT_PART_LIMIT = 256 * 1024


@dataclass(frozen=True)
class ImagePayload(Generic[C]):
    data: bytes
    context: C
    source: Literal["multipart", "object_ref"]
    object_id: str | None


def _media_type(request: Request) -> str:
    return request.headers.get("content-type", "").split(";", 1)[0].strip().lower()


def _parse_context(raw: str | None, model: type[C], *, required: bool) -> C:
    if raw is None or raw.strip() == "":
        if required:
            raise VisionProblem(
                400, "validation_failed", "The `context` part is required for this endpoint.",
                errors=None,
            )
        return model()
    try:
        return model.model_validate_json(raw)
    except ValidationError as exc:
        raise VisionProblem(
            400, "validation_failed", "The `context` part does not match the expected schema.",
            errors=validation_errors(exc, "context"),
        ) from exc


async def read_image_payload(
    request: Request,
    *,
    context_model: type[C],
    json_model: type[BaseModel],
    context_required: bool,
    settings: Settings,
) -> tuple[ImagePayload[C], ObjectRef | None]:
    """Parse the request. For object references, returns the ref; the caller fetches it off the
    event loop with `fetch_object` (blocking I/O)."""
    media_type = _media_type(request)
    if media_type == "multipart/form-data":
        try:
            form = await request.form(max_files=1, max_fields=1, max_part_size=_CONTEXT_PART_LIMIT)
        except (StarletteHTTPException, MultiPartException) as exc:
            detail = getattr(exc, "detail", None) or getattr(exc, "message", "unreadable")
            raise VisionProblem(400, "invalid_multipart", f"Malformed multipart body: {detail}") from exc
        try:
            unexpected = sorted(set(form.keys()) - {"file", "context"})
            if unexpected:
                raise VisionProblem(
                    400, "validation_failed", "Only the `file` and `context` parts are accepted.",
                    errors=[ProblemFieldError(path=name[:64], message="unexpected part") for name in unexpected],
                )
            upload = form.get("file")
            if not isinstance(upload, UploadFile):
                raise VisionProblem(400, "validation_failed", "A `file` part containing the image is required.")
            data = await upload.read()
            raw_context = form.get("context")
            if isinstance(raw_context, UploadFile):
                raise VisionProblem(400, "validation_failed", "`context` must be a JSON text part, not a file.")
            context = _parse_context(raw_context, context_model, required=context_required)
        finally:
            await form.close()
        return ImagePayload(data=data, context=context, source="multipart", object_id=None), None

    if media_type == "application/json":
        body = await request.body()
        try:
            parsed = json_model.model_validate_json(body)
        except ValidationError as exc:
            raise VisionProblem(
                400, "validation_failed", "The request does not match the expected schema.",
                errors=validation_errors(exc, "body"),
            ) from exc
        ref: ObjectRef = parsed.object_ref  # type: ignore[attr-defined]
        context: C = parsed.context  # type: ignore[attr-defined]
        return ImagePayload(data=b"", context=context, source="object_ref", object_id=ref.object_id), ref

    raise VisionProblem(
        415, "unsupported_media_type",
        "Send multipart/form-data (file + context) or application/json (objectRef + context).",
    )


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None  # a redirect could point anywhere (SSRF): treat it as a failure


_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def fetch_object(ref: ObjectRef, settings: Settings) -> bytes:
    """Download an object reference (blocking; run in a worker thread)."""
    if not settings.object_fetch_allowed_origins:
        raise VisionProblem(422, "object_ref_disabled", "Object references are not enabled on this worker; upload the file instead.")
    try:
        origin = normalize_origin(ref.url)
    except ValueError as exc:
        raise VisionProblem(400, "object_ref_invalid", "The object reference is not an http(s) URL without credentials.") from exc
    if origin not in settings.object_fetch_allowed_origins:
        raise VisionProblem(422, "object_ref_origin_not_allowed", "The object reference points at an origin this worker may not read from.")
    if urlsplit(ref.url).fragment:
        raise VisionProblem(400, "object_ref_invalid", "The object reference must not contain a fragment.")

    request = urllib.request.Request(
        ref.url, method="GET", headers={"Accept": "image/*", "User-Agent": f"fieldline-vision/{__version__}"}
    )
    limit = settings.max_upload_bytes
    try:
        with _OPENER.open(request, timeout=settings.object_fetch_timeout_seconds) as response:
            declared = response.headers.get("Content-Length")
            if declared is not None and declared.isdigit() and int(declared) > limit:
                raise VisionProblem(413, "payload_too_large", f"The referenced object exceeds the {limit} byte limit.")
            data = response.read(limit + 1)
    except VisionProblem:
        raise
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 401, 403, 404, 410):
            raise VisionProblem(
                422, "object_ref_unavailable",
                f"The object store refused the reference (HTTP {exc.code}); it may be expired or deleted. Request a fresh reference.",
            ) from exc
        if 300 <= exc.code < 400:
            raise VisionProblem(502, "object_fetch_failed", "The object store answered with a redirect, which is not followed.", retryable=False) from exc
        raise VisionProblem(502, "object_fetch_failed", f"The object store returned HTTP {exc.code}.", retry_after_seconds=2) from exc
    except (TimeoutError, socket.timeout) as exc:
        raise VisionProblem(504, "object_fetch_timeout", "Timed out downloading the referenced object.", retry_after_seconds=2) from exc
    except (urllib.error.URLError, OSError) as exc:
        raise VisionProblem(502, "object_fetch_failed", "Could not connect to the object store.", retry_after_seconds=2) from exc

    if len(data) > limit:
        raise VisionProblem(413, "payload_too_large", f"The referenced object exceeds the {limit} byte limit.")
    digest = hashlib.sha256(data).hexdigest()
    if not hmac.compare_digest(digest, ref.sha256):
        raise VisionProblem(422, "object_ref_checksum_mismatch", "The downloaded bytes do not match the declared SHA-256.")
    return data
