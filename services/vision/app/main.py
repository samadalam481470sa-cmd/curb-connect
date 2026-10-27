"""HTTP entry point for the vision worker (port 4200 in development).

Routes:
  GET  /health, /v1/health      liveness + readiness detail (unauthenticated, no secrets)
  GET  /v1/version              service, metric, threshold, contract and registry versions
  POST /v1/photo-quality        deterministic photo-quality scores and verdict
  POST /v1/curb/recognize       model-agnostic curb contract; abstains without a validated model
  POST /v1/roof/detect          model-agnostic roof contract; abstains without a validated model

Analysis endpoints require the shared service bearer token (VISION_SERVICE_TOKEN).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, FastAPI, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app import (
    CURB_RECOGNITION_CONTRACT_VERSION,
    DHASH_ALGORITHM,
    PHOTO_QUALITY_METRIC_VERSION,
    ROOF_DETECTION_CONTRACT_VERSION,
    SERVICE_NAME,
    __version__,
)
from app.auth import require_service_token
from app.imaging.decode import DecodedImage, decode_image
from app.inputs import ImagePayload, fetch_object, read_image_payload
from app.logging_setup import configure_logging, log_event
from app.middleware import BodyLimitMiddleware, RequestContextMiddleware
from app.models.registry import RegistryState, load_registry
from app.models.runtime import INSTALLED_RUNTIMES, CurbRuntime, RoofRuntime
from app.problems import VisionProblem, install_problem_handlers, request_id_of
from app.quality.assess import assess_photo_quality
from app.quality.config import QualityConfig, load_quality_config
from app.recognition.service import decide, detect_roof, recognize_curb, serving_models
from app.schemas.common import AnalysisRights
from app.schemas.quality import PhotoQualityJsonRequest, PhotoQualityResponse, QualityContext
from app.schemas.recognition import (
    CurbRecognitionResult,
    CurbRecognizeContext,
    CurbRecognizeJsonRequest,
    RoofDetectContext,
    RoofDetectionResult,
    RoofDetectJsonRequest,
)
from app.settings import Settings

log = logging.getLogger("vision.app")


@dataclass
class VisionState:
    settings: Settings
    quality_config: QualityConfig
    registry: RegistryState
    runtimes: Mapping[str, CurbRuntime | RoofRuntime]
    semaphore: asyncio.Semaphore


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    auth: str
    model_registry_valid: bool
    # Registered, enabled, serving models. Empty: every recognizer abstains.
    enabled_models: list[str]


def create_app(
    settings: Settings | None = None,
    *,
    runtimes: Mapping[str, CurbRuntime | RoofRuntime] | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    configure_logging(settings.log_level)
    quality_config = load_quality_config(settings.quality_config_path)  # fail fast on bad thresholds
    registry = load_registry(settings.model_registry_path)
    if not registry.valid:
        log_event(log, logging.ERROR, "model_registry_invalid", error=registry.error)
    state = VisionState(
        settings=settings,
        quality_config=quality_config,
        registry=registry,
        runtimes=dict(INSTALLED_RUNTIMES if runtimes is None else runtimes),
        semaphore=asyncio.Semaphore(settings.max_concurrency),
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):  # type: ignore[no-untyped-def]
        log_event(
            log, logging.INFO, "vision_started", version=__version__, env=settings.env,
            authState=settings.auth_state, thresholds=quality_config.qualified_version,
            enabledModels=serving_models(registry, state.runtimes, kill_switch=settings.automation_kill_switch),
        )
        yield

    app = FastAPI(
        title="Field Pro vision worker",
        version=__version__,
        lifespan=lifespan,
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )
    app.state.vision = state
    install_problem_handlers(app)
    # Outermost first: request context wraps the body limit so 413s carry the request id.
    app.add_middleware(BodyLimitMiddleware, max_bytes=settings.max_upload_bytes + 64 * 1024)
    app.add_middleware(RequestContextMiddleware)

    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service=SERVICE_NAME,
            version=__version__,
            auth=settings.auth_state,
            model_registry_valid=registry.valid,
            enabled_models=serving_models(registry, state.runtimes, kill_switch=settings.automation_kill_switch),
        )

    app.get("/health", response_model=HealthResponse)(health)
    app.get("/v1/health", response_model=HealthResponse)(health)

    @app.get("/v1/version")
    def version() -> dict[str, Any]:
        reg = registry.registry
        return {
            "service": SERVICE_NAME,
            "serviceVersion": __version__,
            "photoQualityMetricVersion": PHOTO_QUALITY_METRIC_VERSION,
            "photoQualityThresholds": quality_config.qualified_version,
            "photoQualityCalibration": quality_config.calibration_status,
            "dhashAlgorithm": DHASH_ALGORITHM,
            "curbRecognitionContract": CURB_RECOGNITION_CONTRACT_VERSION,
            "roofDetectionContract": ROOF_DETECTION_CONTRACT_VERSION,
            "modelRegistryRevision": reg.revision if reg else None,
            "modelRegistryValid": registry.valid,
            "automationKillSwitch": settings.automation_kill_switch,
        }

    async def _load(request: Request, payload: ImagePayload[Any], ref: Any) -> DecodedImage:
        data = payload.data
        if ref is not None:
            data = await run_in_threadpool(fetch_object, ref, settings)
        try:
            await asyncio.wait_for(state.semaphore.acquire(), timeout=settings.queue_timeout_seconds)
        except TimeoutError as exc:
            raise VisionProblem(503, "worker_busy", "The vision worker is at capacity; retry shortly.", retry_after_seconds=2) from exc
        try:
            decoded = await run_in_threadpool(decode_image, data, max_pixels=settings.max_image_pixels)
        finally:
            state.semaphore.release()
        fields = request.scope["state"]["log_fields"]
        fields.update(imageFormat=decoded.format, width=decoded.width, height=decoded.height, byteSize=decoded.byte_size)
        return decoded

    def _check_rights(rights: AnalysisRights | None) -> None:
        if rights is not None and not rights.analyze:
            raise VisionProblem(403, "analysis_not_permitted", "The rights record for this image does not allow machine analysis.")

    auth = [Depends(require_service_token)]

    @app.post("/v1/photo-quality", response_model=PhotoQualityResponse, dependencies=auth)
    async def photo_quality(request: Request) -> PhotoQualityResponse:
        payload, ref = await read_image_payload(
            request, context_model=QualityContext, json_model=PhotoQualityJsonRequest,
            context_required=False, settings=settings,
        )
        _check_rights(payload.context.rights)
        decoded = await _load(request, payload, ref)
        result = await run_in_threadpool(
            assess_photo_quality, decoded, payload.context, quality_config,
            request_id=request_id_of(request), source=payload.source, object_id=payload.object_id,
        )
        request.scope["state"]["log_fields"].update(verdict=result.verdict, reasonCodes=[r.code for r in result.reasons])
        return result

    @app.post("/v1/curb/recognize", response_model=CurbRecognitionResult, dependencies=auth)
    async def curb_recognize(request: Request) -> CurbRecognitionResult:
        payload, ref = await read_image_payload(
            request, context_model=CurbRecognizeContext, json_model=CurbRecognizeJsonRequest,
            context_required=True, settings=settings,
        )
        _check_rights(payload.context.rights)
        decoded = await _load(request, payload, ref)
        decision = decide("curb_recognition", registry, state.runtimes, kill_switch=settings.automation_kill_switch)
        result = await run_in_threadpool(
            recognize_curb, decoded, payload.context, decision,
            request_id=request_id_of(request), source=payload.source, object_id=payload.object_id,
        )
        request.scope["state"]["log_fields"].update(resultType=result.result_type)
        return result

    @app.post("/v1/roof/detect", response_model=RoofDetectionResult, dependencies=auth)
    async def roof_detect(request: Request) -> RoofDetectionResult:
        payload, ref = await read_image_payload(
            request, context_model=RoofDetectContext, json_model=RoofDetectJsonRequest,
            context_required=True, settings=settings,
        )
        _check_rights(payload.context.rights)
        decoded = await _load(request, payload, ref)
        decision = decide("roof_detection", registry, state.runtimes, kill_switch=settings.automation_kill_switch)
        result = await run_in_threadpool(
            detect_roof, decoded, payload.context, decision,
            request_id=request_id_of(request), source=payload.source, object_id=payload.object_id,
        )
        request.scope["state"]["log_fields"].update(resultType=result.result_type)
        return result

    return app


def __getattr__(name: str) -> Any:
    # `uvicorn app.main:app` builds the app lazily so importing the module (tests) has no side effects.
    if name == "app":
        globals()["app"] = created = create_app()
        return created
    raise AttributeError(name)
