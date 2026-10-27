"""Recognition service: decide serve-vs-abstain, run an adapter if one may serve, sanitize output.

Abstention is a first-class result (AIQ-087-API), never an error and never a fabricated guess.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app import CURB_RECOGNITION_CONTRACT_VERSION, ROOF_DETECTION_CONTRACT_VERSION, __version__
from app.imaging.decode import DecodedImage
from app.logging_setup import log_event
from app.models.registry import SERVING_STATUSES, AbstainReason, ModelEntry, RegistryState, Task
from app.models.runtime import CurbRuntime, CurbRuntimeOutput, RoofRuntime, RoofRuntimeOutput
from app.schemas.common import InputSummary, UnknownValue
from app.schemas.recognition import (
    ABSTAIN_MESSAGE,
    Abstention,
    CurbConfidence,
    CurbConstructionFields,
    CurbMeasurements,
    CurbRecognitionResult,
    CurbRecognizeContext,
    ModelInfo,
    RoofDetectContext,
    RoofDetectionResult,
    RoofQualityScores,
    ScaleAssessment,
)

log = logging.getLogger("vision.recognition")

_ABSTAIN_DETAIL: dict[AbstainReason, str] = {
    "no_validated_model_enabled": ABSTAIN_MESSAGE,
    "model_runtime_unavailable": "The registered model has no installed runtime adapter; route to manual review.",
    "automation_disabled": "Automation is disabled by the vision kill switch; route to manual review.",
    "model_registry_invalid": "The model registry failed validation; route to manual review.",
    "model_runtime_error": "The model failed on this input; route to manual review.",
    "model_output_rejected": "The model output failed validation and was quarantined; route to manual review.",
}

CURB_LIMITATIONS = [
    "Photographs cannot show reinforcement, buried depth, section thickness, subbase, or concrete strength.",
    "Utility clearance, right-of-way authorization, and municipal approval come from locates and permit records, never photos.",
    "Lengths and heights are only suggested when a trusted, in-plane scale reference validated the photo (CV-045).",
]
ROOF_LIMITATIONS = [
    "Detected geometry is a proposal for reviewer correction, never an invoice quantity (RF-026).",
    "Heavy shade, snow, solar panels, tree cover, or low resolution require manual review.",
    "Pitch needs a calibrated source; image-only pitch is preliminary at best.",
]
NO_MODEL_LIMITATION = "No trained or validated model is enabled in this deployment; nothing was inferred from the image."


@dataclass(frozen=True)
class Decision:
    entry: ModelEntry | None
    runtime: CurbRuntime | RoofRuntime | None
    abstain_reason: AbstainReason | None
    registry_revision: int | None


def decide(
    task: Task,
    registry: RegistryState,
    runtimes: Mapping[str, CurbRuntime | RoofRuntime],
    *,
    kill_switch: bool,
) -> Decision:
    if kill_switch:
        return Decision(None, None, "automation_disabled", registry.registry.revision if registry.registry else None)
    if registry.registry is None:
        return Decision(None, None, "model_registry_invalid", None)
    revision = registry.registry.revision
    entry = registry.registry.active(task)
    if entry is None or not entry.enabled or entry.status not in SERVING_STATUSES:
        return Decision(entry, None, "no_validated_model_enabled", revision)
    runtime = runtimes.get(entry.runtime)
    if runtime is None or getattr(runtime, "task", None) != task:
        return Decision(entry, None, "model_runtime_unavailable", revision)
    return Decision(entry, runtime, None, revision)


def serving_models(registry: RegistryState, runtimes: Mapping[str, CurbRuntime | RoofRuntime], *, kill_switch: bool) -> list[str]:
    served = []
    for task in ("curb_recognition", "roof_detection"):
        decision = decide(task, registry, runtimes, kill_switch=kill_switch)  # type: ignore[arg-type]
        if decision.abstain_reason is None and decision.entry is not None:
            served.append(f"{task}:{decision.entry.key}")
    return served


def _model_info(decision: Decision) -> ModelInfo | None:
    if decision.entry is None or decision.registry_revision is None:
        return None
    e = decision.entry
    return ModelInfo(
        model_id=e.model_id,
        version=e.version,
        status=e.status,
        provider=e.provider,
        deployment_id=e.deployment_id,
        registry_revision=decision.registry_revision,
    )


def _finite_points(points: Sequence[tuple[float, float]], width: int, height: int) -> bool:
    return all(math.isfinite(x) and math.isfinite(y) and 0 <= x <= width and 0 <= y <= height for x, y in points)


def _polygon_area(points: Sequence[tuple[float, float]]) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(points, [*points[1:], points[0]], strict=True):
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def _input_summary(decoded: DecodedImage, source: str, object_id: str | None) -> InputSummary:
    return InputSummary(
        sha256=decoded.sha256,
        format=decoded.format,
        width=decoded.width,
        height=decoded.height,
        byte_size=decoded.byte_size,
        source=source,  # type: ignore[arg-type]
        object_id=object_id,
    )


# ----------------------------------------------------------------------------------- curb


def _curb_abstain(
    reason: AbstainReason, decision: Decision, decoded: DecodedImage, ctx: CurbRecognizeContext,
    request_id: str, source: str, object_id: str | None,
) -> CurbRecognitionResult:
    unknown = UnknownValue(reason="no_validated_model")
    return CurbRecognitionResult(
        result_type="abstain",
        contract_version=CURB_RECOGNITION_CONTRACT_VERSION,
        service_version=__version__,
        request_id=request_id,
        suggested_status="review_required",
        model=_model_info(decision),
        abstention=Abstention(reason_code=reason, message=_ABSTAIN_DETAIL[reason]),
        input=_input_summary(decoded, source, object_id),
        photo_id=ctx.photo_id,
        view_type=ctx.view_type,
        class_scores=[],
        geometry=[],
        scale=ScaleAssessment(validity="not_assessed", reason="no_validated_model", scale_reference_id=ctx.scale_reference_id),
        measurements=CurbMeasurements(visible_length=unknown, exposed_height=unknown),
        confidence=CurbConfidence(),
        construction_fields=CurbConstructionFields(),
        limitations=[NO_MODEL_LIMITATION, *CURB_LIMITATIONS],
    )


def recognize_curb(
    decoded: DecodedImage,
    ctx: CurbRecognizeContext,
    decision: Decision,
    *,
    request_id: str,
    source: str,
    object_id: str | None,
) -> CurbRecognitionResult:
    if decision.abstain_reason is not None or decision.runtime is None or decision.entry is None:
        return _curb_abstain(decision.abstain_reason or "no_validated_model_enabled", decision, decoded, ctx, request_id, source, object_id)

    runtime = decision.runtime
    assert isinstance(runtime, CurbRuntime)
    try:
        output = runtime.predict_curb(decoded.rgb, ctx, decision.entry)
        output = CurbRuntimeOutput.model_validate(output.model_dump())
    except Exception:  # noqa: BLE001 - any adapter failure becomes an abstention, never a 500 or a guess
        log.error("model_runtime_error", exc_info=True, extra={"event": "model_runtime_error", "fields": {"model": decision.entry.key, "requestId": request_id}})
        return _curb_abstain("model_runtime_error", decision, decoded, ctx, request_id, source, object_id)

    labels = [s.label for s in output.class_scores]
    if len(labels) != len(set(labels)) or not all(_finite_points(g.points, decoded.width, decoded.height) for g in output.geometry):
        log_event(log, logging.WARNING, "model_output_rejected", model=decision.entry.key, requestId=request_id)
        return _curb_abstain("model_output_rejected", decision, decoded, ctx, request_id, source, object_id)

    measurements = output.measurements
    if output.scale.validity != "valid":
        # CV-045: never derive a length or height from pixels without a trustworthy scale.
        unknown = UnknownValue(reason="no_trustworthy_scale")
        measurements = CurbMeasurements(visible_length=unknown, exposed_height=unknown)

    return CurbRecognitionResult(
        result_type="prediction",
        contract_version=CURB_RECOGNITION_CONTRACT_VERSION,
        service_version=__version__,
        request_id=request_id,
        suggested_status="draft_ai",
        model=_model_info(decision),
        abstention=None,
        input=_input_summary(decoded, source, object_id),
        photo_id=ctx.photo_id,
        view_type=ctx.view_type,
        class_scores=sorted(output.class_scores, key=lambda s: (-s.score, s.label)),
        geometry=output.geometry,
        scale=output.scale.model_copy(update={"scale_reference_id": ctx.scale_reference_id}),
        measurements=measurements,
        confidence=output.confidence,
        # Set by the service, not the adapter: photographs never establish these.
        construction_fields=CurbConstructionFields(),
        limitations=[*CURB_LIMITATIONS, *decision.entry.limitations, *output.limitations],
    )


# ----------------------------------------------------------------------------------- roof


def _roof_abstain(
    reason: AbstainReason, decision: Decision, decoded: DecodedImage, ctx: RoofDetectContext,
    request_id: str, source: str, object_id: str | None,
) -> RoofDetectionResult:
    return RoofDetectionResult(
        result_type="abstain",
        contract_version=ROOF_DETECTION_CONTRACT_VERSION,
        service_version=__version__,
        request_id=request_id,
        suggested_status="review_required",
        model=_model_info(decision),
        abstention=Abstention(reason_code=reason, message=_ABSTAIN_DETAIL[reason]),
        imagery_id=ctx.imagery_id,
        input=_input_summary(decoded, source, object_id),
        polygons=[],
        edges=[],
        quality_scores=RoofQualityScores(),
        limitations=[NO_MODEL_LIMITATION, *ROOF_LIMITATIONS],
    )


def detect_roof(
    decoded: DecodedImage,
    ctx: RoofDetectContext,
    decision: Decision,
    *,
    request_id: str,
    source: str,
    object_id: str | None,
) -> RoofDetectionResult:
    if decision.abstain_reason is not None or decision.runtime is None or decision.entry is None:
        return _roof_abstain(decision.abstain_reason or "no_validated_model_enabled", decision, decoded, ctx, request_id, source, object_id)

    runtime = decision.runtime
    assert isinstance(runtime, RoofRuntime)
    try:
        output = runtime.predict_roof(decoded.rgb, ctx, decision.entry)
        output = RoofRuntimeOutput.model_validate(output.model_dump())
    except Exception:  # noqa: BLE001 - adapter failure -> abstention
        log.error("model_runtime_error", exc_info=True, extra={"event": "model_runtime_error", "fields": {"model": decision.entry.key, "requestId": request_id}})
        return _roof_abstain("model_runtime_error", decision, decoded, ctx, request_id, source, object_id)

    # RF-026 data rule: quarantine invalid polygons instead of passing them on.
    ids = [p.object_id for p in output.polygons] + [e.object_id for e in output.edges]
    valid = len(ids) == len(set(ids)) and all(
        _finite_points(p.points, decoded.width, decoded.height) and _polygon_area(p.points) > 0 for p in output.polygons
    ) and all(_finite_points(e.points, decoded.width, decoded.height) for e in output.edges)
    if not valid:
        log_event(log, logging.WARNING, "model_output_rejected", model=decision.entry.key, requestId=request_id)
        return _roof_abstain("model_output_rejected", decision, decoded, ctx, request_id, source, object_id)

    return RoofDetectionResult(
        result_type="prediction",
        contract_version=ROOF_DETECTION_CONTRACT_VERSION,
        service_version=__version__,
        request_id=request_id,
        suggested_status="draft_ai",
        model=_model_info(decision),
        abstention=None,
        imagery_id=ctx.imagery_id,
        input=_input_summary(decoded, source, object_id),
        polygons=output.polygons,
        edges=output.edges,
        quality_scores=output.quality_scores,
        limitations=[*ROOF_LIMITATIONS, *decision.entry.limitations, *output.limitations],
    )
