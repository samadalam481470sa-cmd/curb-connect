"""POST /v1/photo-quality contract (CV-044-API)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.common import (
    AnalysisRights,
    CamelModel,
    DHashHex,
    InputSummary,
    ObjectRef,
    OpaqueId,
    Sha256Hex,
    Slug,
)

CheckStatus = Literal["pass", "warn", "fail", "not_assessed"]
Verdict = Literal["usable", "usable_with_warnings", "retake_required"]
CheckName = Literal["blur", "exposure", "glare", "resolution", "aspect", "duplicate", "metadata"]


class HashRef(CamelModel):
    """A previously scored photo of the same project, supplied by the caller for duplicate checks.

    The worker is stateless: it never stores hashes, so it cannot compare across tenants.
    """

    id: OpaqueId
    dhash: DHashHex
    sha256: Sha256Hex | None = None


class QualityContext(CamelModel):
    photo_id: OpaqueId | None = None
    view_type: Slug | None = Field(default=None, description="Requested shot from the capture protocol (CV-043), echoed only.")
    compare_hashes: list[HashRef] = Field(default_factory=list, max_length=1000)
    rights: AnalysisRights | None = Field(default=None, description="When present, analyze must be true.")


class PhotoQualityJsonRequest(CamelModel):
    object_ref: ObjectRef
    context: QualityContext = Field(default_factory=QualityContext)


class Reason(CamelModel):
    code: str
    check: CheckName
    severity: Literal["warn", "fail"]
    message: str = Field(description="What is wrong, in plain language.")
    action: str = Field(description="Next best step for the person capturing the photo.")
    metric: str | None = None
    observed: float | None = None
    comparator: Literal["<", ">", "<=", ">="] | None = None
    threshold: float | None = None


class BlurCheck(CamelModel):
    status: CheckStatus
    laplacian_variance: float | None
    fail_below: float
    warn_below: float


class ExposureCheck(CamelModel):
    status: CheckStatus
    mean_luma: float
    p5_luma: int
    p50_luma: int
    p95_luma: int
    dynamic_range: int
    shadow_clipped_ratio: float
    fail_mean_below: float
    warn_mean_below: float
    warn_mean_above: float
    fail_mean_above: float
    warn_dynamic_range_below: int


class GlareCheck(CamelModel):
    status: CheckStatus
    highlight_clipped_ratio: float
    clip_level: int
    warn_ratio_above: float
    fail_ratio_above: float


class ResolutionCheck(CamelModel):
    status: CheckStatus
    width: int
    height: int
    short_side: int
    megapixels: float
    fail_short_side_below: int
    warn_short_side_below: int


class BorderBandsOut(CamelModel):
    top: float
    bottom: float
    left: float
    right: float


class AspectCheck(CamelModel):
    status: CheckStatus
    aspect_ratio: float
    border_bands: BorderBandsOut
    warn_ratio_above: float
    fail_ratio_above: float
    warn_border_fraction_above: float


class DuplicateMatch(CamelModel):
    id: OpaqueId
    match: Literal["exact_bytes", "near_identical", "similar"]
    hamming_distance: int


class DuplicateCheck(CamelModel):
    status: CheckStatus
    compared: int
    matches: list[DuplicateMatch]
    near_identical_max_distance: int
    similar_max_distance: int


class MetadataCheck(CamelModel):
    status: CheckStatus
    exif_present: bool
    exif_readable: bool
    has_alpha: bool


class Checks(CamelModel):
    blur: BlurCheck
    exposure: ExposureCheck
    glare: GlareCheck
    resolution: ResolutionCheck
    aspect: AspectCheck
    duplicate: DuplicateCheck
    metadata: MetadataCheck


class Orientation(CamelModel):
    exif_orientation: int | None = Field(description="Raw EXIF Orientation tag (1-8), null when absent.")
    applied: bool = Field(description="True when pixels were rotated/flipped upright before scoring.")
    stored_width: int
    stored_height: int


class ExifOut(CamelModel):
    """Only what downstream steps need. GPS coordinates are never read or returned: `gpsPresent`
    tells the API to keep the original in the restricted field and strip shared copies (CV-044)."""

    present: bool
    readable: bool
    gps_present: bool
    captured_at: str | None = Field(description="EXIF DateTimeOriginal as recorded by the device clock (unverified, no zone).")
    focal_length_mm: float | None
    focal_length_35mm: int | None


class Hashes(CamelModel):
    sha256: Sha256Hex
    dhash: DHashHex
    dhash_algorithm: str


class AnalysisInfo(CamelModel):
    width: int
    height: int
    luma: Literal["ITU-R BT.601 (Pillow L)"] = "ITU-R BT.601 (Pillow L)"
    downsample: Literal["BOX"] = "BOX"


class NotAssessed(CamelModel):
    aspect: str
    reason: str


class PhotoQualityResponse(CamelModel):
    result_type: Literal["photo_quality"] = "photo_quality"
    metric_version: str
    thresholds_version: str
    thresholds_calibration: Literal["heuristic_default", "calibrated"]
    service_version: str
    request_id: str
    photo_id: OpaqueId | None
    view_type: Slug | None
    verdict: Verdict
    reasons: list[Reason]
    checks: Checks
    input: InputSummary
    orientation: Orientation
    exif: ExifOut
    hashes: Hashes
    analysis: AnalysisInfo
    not_assessed: list[NotAssessed]
    limitations: list[str]
