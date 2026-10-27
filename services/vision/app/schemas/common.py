"""Shared contract building blocks: camelCase base model, unknown/known values, rights, inputs."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Sha256Hex = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$", description="Lowercase hex SHA-256.")]
DHashHex = Annotated[str, Field(pattern=r"^[0-9a-f]{16}$", description="64-bit dHash, 16 lowercase hex chars.")]
OpaqueId = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:\-]+$")]
Slug = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")]


class CamelModel(BaseModel):
    """Base for every contract model: camelCase on the wire, snake_case in Python, strict input."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        extra="forbid",
        frozen=True,
    )


class UnknownValue(CamelModel):
    """An explicit unknown, never a zero (brief: missing values are `unknown`, never 0)."""

    state: Literal["unknown"] = "unknown"
    reason: str = Field(description="Stable machine-readable reason code.")


class KnownValue(CamelModel):
    """A machine-estimated value. Only a human can upgrade the provenance (field_verified etc.)."""

    state: Literal["known"] = "known"
    value: float
    unit: Literal["m", "m2", "ratio"]
    source: Literal["machine_estimated"] = "machine_estimated"
    measured_at: datetime | None = None
    precision: float | None = Field(default=None, ge=0, description="± tolerance in `unit`.")


MeasurementValue = Annotated[UnknownValue | KnownValue, Field(discriminator="state")]


class ConfidenceValue(CamelModel):
    """User-facing confidence label (AIQ-087). The worker can never claim `field_verified`."""

    label: Literal["preliminary_visual_inference", "unavailable"]
    score: float | None = Field(default=None, ge=0, le=1)
    calibration_id: str | None = Field(
        default=None,
        description="Identifier of the held-out calibration that makes `score` meaningful. "
        "Null means the score is uncalibrated and must not be shown as a probability.",
    )


UNAVAILABLE = ConfidenceValue(label="unavailable")


class AnalysisRights(CamelModel):
    """Caller-asserted usage rights for the submitted image (rights engine decision, STR-009)."""

    analyze: bool = Field(description="True only when the rights engine allows machine analysis.")
    rights_record_id: OpaqueId | None = None
    source: Slug | None = Field(default=None, description="Imagery/photo source, e.g. contractor_upload.")


class ObjectRef(CamelModel):
    """Short-lived signed download URL issued by the Fieldline API storage adapter.

    The URL is never logged or echoed. The checksum is mandatory so the worker proves it
    analysed exactly the stored object.
    """

    url: str = Field(min_length=8, max_length=4096)
    sha256: Sha256Hex
    object_id: OpaqueId | None = None


class InputSummary(CamelModel):
    sha256: Sha256Hex
    format: Literal["JPEG", "PNG", "WEBP"]
    width: int = Field(description="Width after EXIF orientation.")
    height: int = Field(description="Height after EXIF orientation.")
    byte_size: int
    source: Literal["multipart", "object_ref"]
    object_id: OpaqueId | None = None


class ProblemFieldError(CamelModel):
    path: str
    message: str
    code: str | None = None


class Problem(CamelModel):
    """RFC 9457 problem+json body, same shape as packages/contracts ProblemSchema."""

    type: str = "about:blank"
    title: str
    status: int
    detail: str | None = None
    code: str
    correlation_id: str
    retryable: bool = False
    retry_after_seconds: int | None = None
    errors: list[ProblemFieldError] | None = None
