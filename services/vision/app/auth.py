"""Service-to-service authentication: a shared bearer token (VISION_SERVICE_TOKEN).

Only the Fieldline API calls this worker; browsers never do. The token is compared in constant
time and is never logged. A missing or short token fails closed (503) instead of opening the
worker up.
"""

from __future__ import annotations

import hmac

from fastapi import Request

from app.problems import VisionProblem
from app.settings import MIN_TOKEN_LENGTH, Settings

_CHALLENGE = {"WWW-Authenticate": 'Bearer realm="fieldline-vision"'}


def require_service_token(request: Request) -> None:
    settings: Settings = request.app.state.vision.settings
    if settings.auth_state != "configured":
        raise VisionProblem(
            503,
            "service_auth_not_configured",
            f"The vision worker has no usable VISION_SERVICE_TOKEN (at least {MIN_TOKEN_LENGTH} characters); "
            "it refuses all analysis requests until one is configured.",
            retryable=False,
        )
    header = request.headers.get("authorization", "")
    scheme, _, presented = header.partition(" ")
    if scheme.lower() != "bearer" or not presented.strip():
        raise VisionProblem(401, "unauthorized", "A service bearer token is required.", headers=_CHALLENGE)
    presented_bytes = presented.strip().encode()
    matched = False
    for token in settings.accepted_tokens():
        # Evaluate every candidate so timing does not reveal which slot matched.
        matched |= hmac.compare_digest(presented_bytes, token.encode())
    if not matched:
        raise VisionProblem(401, "unauthorized", "The service bearer token is not valid.", headers=_CHALLENGE)
