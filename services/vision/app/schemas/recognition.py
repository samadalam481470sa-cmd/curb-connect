"""Model-agnostic recognition contracts (CV-046-API, CV-050-API, RF-026-API, AIQ-087-API).

The same envelope is used whether a model answered or the worker abstained, so callers handle
one shape. Fields a photograph can never establish (reinforcement, buried depth, utility
clearance, right-of-way authorization, municipal approval...) are typed as `UnknownValue` only:
no model output can fill them.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from app.models.registry import AbstainReason, ModelStatus
from app.schemas.common import (
    UNAVAILABLE,
    AnalysisRights,
    CamelModel,
    ConfidenceValue,
    InputSummary,
    MeasurementValue,
    ObjectRef,
    OpaqueId,
    Slug,
    UnknownValue,
)

Point = Annotated[tuple[float, float], Field(description="[x, y] in image pixels, origin top-left, after EXIF orientation.")]
Score = Annotated[float, Field(ge=0, le=1)]

ABSTAIN_MESSAGE = "No validated model enabled; route to manual review."


class ModelInfo(CamelModel):
    model_id: str
    version: str
    status: ModelStatus
    provider: str | None = None
    deployment_id: str | None = None
    registry_revision: int


class Abstention(CamelModel):
    reason_code: AbstainReason
    message: str
    route: Literal["manual_review"] = "manual_review"


class ScaleAssessment(CamelModel):
    validity: Literal["valid", "invalid", "insufficient", "not_assessed"]
    reason: str
    scale_reference_id: OpaqueId | None = None


# ----------------------------------------------------------------------------------- curb

CurbProfile = Literal[
    "curb_and_gutter",
    "barrier_curb",
    "mountable_curb",
    "integral_concrete_curb",
    "standalone_landscape_curb",
    "unknown",
]
CurbGeometryKind = Literal["curb_top_edge", "curb_face_edge", "gutter_line", "visible_cut_path", "obstruction"]


class CurbRecognizeContext(CamelModel):
    rights: AnalysisRights
    photo_id: OpaqueId | None = None
    view_type: Slug | None = None
    scale_reference_id: OpaqueId | None = Field(
        default=None, description="Calibration the API already holds for this photo, if any (CV-045)."
    )


class CurbRecognizeJsonRequest(CamelModel):
    object_ref: ObjectRef
    context: CurbRecognizeContext


class CurbClassScore(CamelModel):
    label: CurbProfile
    score: Score


class CurbGeometry(CamelModel):
    kind: CurbGeometryKind
    space: Literal["image_px"] = "image_px"
    points: list[Point] = Field(min_length=2, max_length=10_000)
    confidence: Score


class CurbMeasurements(CamelModel):
    """Projected 2D suggestions only; populated solely when scale validity is `valid`."""

    visible_length: MeasurementValue
    exposed_height: MeasurementValue


class CurbConfidence(CamelModel):
    """Separate confidence per aspect (CV-050); one high score never lifts another."""

    curb_presence: ConfidenceValue = UNAVAILABLE
    service_type: ConfidenceValue = UNAVAILABLE
    length: ConfidenceValue = UNAVAILABLE
    height: ConfidenceValue = UNAVAILABLE
    depth: ConfidenceValue = UNAVAILABLE
    profile: ConfidenceValue = UNAVAILABLE
    obstruction: ConfidenceValue = UNAVAILABLE


def _never(reason: str) -> UnknownValue:
    return UnknownValue(reason=reason)


class CurbConstructionFields(CamelModel):
    """Never inferred from photographs (brief non-negotiable; CV-046, CV-049, CV-056)."""

    reinforcement: UnknownValue = _never("not_observable_in_photographs")
    buried_depth: UnknownValue = _never("not_observable_in_photographs")
    section_thickness: UnknownValue = _never("not_observable_in_photographs")
    subbase: UnknownValue = _never("not_observable_in_photographs")
    concrete_strength: UnknownValue = _never("requires_testing_or_records")
    utility_clearance: UnknownValue = _never("requires_utility_locate")
    right_of_way_authorization: UnknownValue = _never("requires_permit_record")
    municipal_approval: UnknownValue = _never("requires_permit_record")


class CurbRecognitionResult(CamelModel):
    result_type: Literal["abstain", "prediction"]
    task: Literal["curb_recognition"] = "curb_recognition"
    contract_version: str
    service_version: str
    request_id: str
    suggested_status: Literal["review_required", "draft_ai"] = Field(
        description="CV-050 status the API should record: abstentions need manual review; "
        "predictions are draft_ai suggestions that still need a human."
    )
    review_required: Literal[True] = True
    model: ModelInfo | None
    abstention: Abstention | None
    input: InputSummary
    photo_id: OpaqueId | None
    view_type: Slug | None
    class_scores: list[CurbClassScore]
    geometry: list[CurbGeometry]
    scale: ScaleAssessment
    measurements: CurbMeasurements
    confidence: CurbConfidence
    construction_fields: CurbConstructionFields
    limitations: list[str]


# ----------------------------------------------------------------------------------- roof

RoofPolygonKind = Literal["building_outline", "facet", "obstruction", "uncertain_region"]
RoofEdgeKind = Literal["ridge", "hip", "valley", "eave", "rake", "step_flashing", "wall_flashing", "transition", "unknown"]


class RoofDetectContext(CamelModel):
    rights: AnalysisRights
    imagery_id: OpaqueId = Field(description="Imagery asset id from the ImageryProvider adapter (RF-022).")
    ground_sample_distance_m: float | None = Field(default=None, gt=0, le=10)


class RoofDetectJsonRequest(CamelModel):
    object_ref: ObjectRef
    context: RoofDetectContext


class RoofPolygon(CamelModel):
    object_id: OpaqueId
    kind: RoofPolygonKind
    space: Literal["image_px"] = "image_px"
    points: list[Point] = Field(min_length=3, max_length=10_000)
    confidence: Score
    pitch: MeasurementValue


class RoofEdge(CamelModel):
    object_id: OpaqueId
    kind: RoofEdgeKind
    space: Literal["image_px"] = "image_px"
    points: list[Point] = Field(min_length=2, max_length=10_000)
    confidence: Score


class RoofQualityScores(CamelModel):
    """Separate quality scores (RF-026 UX-B)."""

    imagery_coverage: ConfidenceValue = UNAVAILABLE
    building_segmentation: ConfidenceValue = UNAVAILABLE
    facet_boundary: ConfidenceValue = UNAVAILABLE
    edge_classification: ConfidenceValue = UNAVAILABLE


class RoofDetectionResult(CamelModel):
    result_type: Literal["abstain", "prediction"]
    task: Literal["roof_detection"] = "roof_detection"
    contract_version: str
    service_version: str
    request_id: str
    suggested_status: Literal["review_required", "draft_ai"]
    review_required: Literal[True] = True
    model: ModelInfo | None
    abstention: Abstention | None
    imagery_id: OpaqueId
    input: InputSummary
    polygons: list[RoofPolygon]
    edges: list[RoofEdge]
    quality_scores: RoofQualityScores
    limitations: list[str]
