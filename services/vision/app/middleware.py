"""Pure ASGI middleware: correlation id + access log, and the request body size limit."""

from __future__ import annotations

import logging
import re
import time
import uuid
from typing import Any

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import __version__
from app.logging_setup import log_event
from app.problems import PROBLEM_CONTENT_TYPE, VisionProblem, problem_body

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:\-]{1,128}$")

access_log = logging.getLogger("vision.http")


async def send_problem(send: Send, problem: VisionProblem, request_id: str) -> None:
    body = problem_body(problem, request_id)
    headers = [
        (b"content-type", PROBLEM_CONTENT_TYPE.encode()),
        (b"content-length", str(len(body)).encode()),
    ]
    headers += [(k.lower().encode(), v.encode()) for k, v in problem.response_headers().items()]
    await send({"type": "http.response.start", "status": problem.status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


class RequestContextMiddleware:
    """Assigns the correlation id (X-Request-Id from the API, else a new UUID), echoes it, adds
    version and no-store headers, converts unhandled errors into a problem+json 500, and writes
    one `http_request` log event per request (path only: no query string, body, or client IP)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get("x-request-id")
        request_id = incoming if incoming and REQUEST_ID_PATTERN.match(incoming) else str(uuid.uuid4())
        state = scope.setdefault("state", {})
        state["request_id"] = request_id
        log_fields: dict[str, Any] = {}
        state["log_fields"] = log_fields

        status: dict[str, int | None] = {"code": None}
        started = time.perf_counter()

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-Id"] = request_id
                headers["X-Vision-Service-Version"] = __version__
                headers["Cache-Control"] = "no-store"
                headers["X-Content-Type-Options"] = "nosniff"
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            # Logged here (with traceback, without request data); not re-raised so the server
            # does not print a second, unstructured traceback.
            access_log.error(
                "unhandled_error",
                exc_info=True,
                extra={"event": "unhandled_error", "fields": {"requestId": request_id, "path": str(scope.get("path", ""))[:200]}},
            )
            if status["code"] is None:
                await send_problem(
                    send_wrapper,
                    VisionProblem(500, "internal_error", "The vision worker failed unexpectedly.", retryable=True),
                    request_id,
                )
        finally:
            code = status["code"] or 500
            level = logging.ERROR if code >= 500 else logging.WARNING if code >= 400 else logging.INFO
            log_event(
                access_log,
                level,
                "http_request",
                requestId=request_id,
                method=scope.get("method"),
                path=str(scope.get("path", ""))[:200],
                status=code,
                durationMs=round((time.perf_counter() - started) * 1000, 2),
                **log_fields,
            )


class BodyTooLarge(VisionProblem):
    def __init__(self, limit: int) -> None:
        super().__init__(
            413,
            "payload_too_large",
            f"The request body exceeds the {limit} byte limit.",
            retryable=False,
        )


class BodyLimitMiddleware:
    """Rejects bodies above `max_bytes`: declared Content-Length is refused before reading; a
    chunked or lying body is cut off as soon as the running total passes the limit."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = scope.get("state", {}).get("request_id", "unknown")
        declared = Headers(scope=scope).get("content-length")
        if declared is not None:
            try:
                declared_bytes = int(declared)
            except ValueError:
                await send_problem(send, VisionProblem(400, "invalid_content_length", "Content-Length is not an integer."), request_id)
                return
            if declared_bytes > self.max_bytes:
                await send_problem(send, BodyTooLarge(self.max_bytes), request_id)
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise BodyTooLarge(self.max_bytes)
            return message

        await self.app(scope, limited_receive, send)
