"""problem+json errors with stable codes (same envelope as the Fieldline API, BE-073-API).

Details are written for the calling service and may be shown to users: they never contain image
bytes, file names, signed URLs, tokens, or EXIF values.
"""

from __future__ import annotations

import json
import logging
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.common import Problem, ProblemFieldError

PROBLEM_CONTENT_TYPE = "application/problem+json"

log = logging.getLogger("vision.problems")


class VisionProblem(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        detail: str | None = None,
        *,
        title: str | None = None,
        retryable: bool | None = None,
        retry_after_seconds: int | None = None,
        errors: list[ProblemFieldError] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(detail or code)
        self.status = status
        self.code = code
        self.detail = detail
        self.title = title or HTTPStatus(status).phrase
        self.retryable = retryable if retryable is not None else status in (429, 502, 503, 504)
        self.retry_after_seconds = retry_after_seconds
        self.errors = errors
        self.headers = headers or {}

    def to_problem(self, correlation_id: str) -> Problem:
        return Problem(
            title=self.title,
            status=self.status,
            detail=self.detail,
            code=self.code,
            correlation_id=correlation_id,
            retryable=self.retryable,
            retry_after_seconds=self.retry_after_seconds,
            errors=self.errors,
        )

    def response_headers(self) -> dict[str, str]:
        headers = dict(self.headers)
        if self.retry_after_seconds is not None:
            headers["Retry-After"] = str(self.retry_after_seconds)
        return headers


def validation_errors(exc: ValidationError, prefix: str = "") -> list[ProblemFieldError]:
    """Field errors without the offending input values (they may be large or sensitive)."""
    errors = []
    for issue in exc.errors(include_input=False, include_url=False):
        path = ".".join(str(part) for part in issue.get("loc", ()))
        if prefix:
            path = f"{prefix}.{path}" if path else prefix
        errors.append(ProblemFieldError(path=path or "body", message=issue.get("msg", "invalid"), code=issue.get("type")))
    return errors


def request_id_of(request: Request) -> str:
    return str(getattr(request.state, "request_id", "unknown"))


def problem_body(problem: VisionProblem, correlation_id: str) -> bytes:
    payload = problem.to_problem(correlation_id).model_dump(mode="json", exclude_none=True)
    return json.dumps(payload, separators=(",", ":")).encode()


def problem_response(request: Request, problem: VisionProblem) -> JSONResponse:
    payload = problem.to_problem(request_id_of(request)).model_dump(mode="json", exclude_none=True)
    return JSONResponse(
        payload,
        status_code=problem.status,
        media_type=PROBLEM_CONTENT_TYPE,
        headers=problem.response_headers(),
    )


_HTTP_CODES = {404: "not_found", 405: "method_not_allowed", 400: "bad_request"}


def install_problem_handlers(app: FastAPI) -> None:
    async def on_problem(request: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, VisionProblem)
        return problem_response(request, exc)

    async def on_validation(request: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, RequestValidationError)
        errors = [
            ProblemFieldError(
                path=".".join(str(p) for p in err.get("loc", ())) or "request",
                message=str(err.get("msg", "invalid")),
                code=err.get("type"),
            )
            for err in exc.errors()
        ]
        return problem_response(
            request,
            VisionProblem(400, "validation_failed", "The request does not match the expected schema.", errors=errors),
        )

    async def on_http(request: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, StarletteHTTPException)
        code = _HTTP_CODES.get(exc.status_code, "http_error")
        detail = None
        if exc.status_code == 404:
            detail = f"No route for {request.method} {request.url.path[:200]}"
        elif isinstance(exc.detail, str) and exc.status_code < 500:
            detail = exc.detail
        headers: dict[str, Any] = dict(exc.headers or {})
        return problem_response(request, VisionProblem(exc.status_code, code, detail, headers=headers))

    app.add_exception_handler(VisionProblem, on_problem)
    app.add_exception_handler(RequestValidationError, on_validation)
    app.add_exception_handler(StarletteHTTPException, on_http)
