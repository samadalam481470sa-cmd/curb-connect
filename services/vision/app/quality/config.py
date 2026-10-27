"""Loader and validator for the versioned photo-quality threshold file.

The file is validated at startup; an inconsistent file (e.g. a warn level stricter than its fail
level) stops the worker instead of silently mis-scoring photos.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, model_validator

from app.schemas.common import CamelModel


class _Section(CamelModel):
    note: str = ""


class Provenance(CamelModel):
    summary: str
    calibrated_on: str | None = None
    approved_by: str | None = None
    recalibration: str


class AnalysisSection(_Section):
    max_long_side_px: int = Field(ge=64, le=8192)


class BlurSection(_Section):
    fail_below: float = Field(ge=0)
    warn_below: float = Field(ge=0)

    @model_validator(mode="after")
    def _order(self) -> Self:
        if self.warn_below < self.fail_below:
            raise ValueError("blur.warnBelow must be >= blur.failBelow")
        return self


class ExposureSection(_Section):
    fail_mean_below: float = Field(ge=0, le=255)
    warn_mean_below: float = Field(ge=0, le=255)
    warn_mean_above: float = Field(ge=0, le=255)
    fail_mean_above: float = Field(ge=0, le=255)
    warn_dynamic_range_below: int = Field(ge=0, le=255)
    shadow_clip_level: int = Field(ge=0, le=254)

    @model_validator(mode="after")
    def _order(self) -> Self:
        if not (self.fail_mean_below <= self.warn_mean_below < self.warn_mean_above <= self.fail_mean_above):
            raise ValueError("exposure thresholds must satisfy failMeanBelow <= warnMeanBelow < warnMeanAbove <= failMeanAbove")
        return self


class GlareSection(_Section):
    clip_level: int = Field(ge=128, le=255)
    warn_ratio_above: float = Field(ge=0, le=1)
    fail_ratio_above: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def _order(self) -> Self:
        if self.fail_ratio_above < self.warn_ratio_above:
            raise ValueError("glare.failRatioAbove must be >= glare.warnRatioAbove")
        return self


class ResolutionSection(_Section):
    fail_short_side_below: int = Field(ge=1)
    warn_short_side_below: int = Field(ge=1)

    @model_validator(mode="after")
    def _order(self) -> Self:
        if self.warn_short_side_below < self.fail_short_side_below:
            raise ValueError("resolution.warnShortSideBelow must be >= resolution.failShortSideBelow")
        return self


class AspectSection(_Section):
    warn_ratio_above: float = Field(ge=1)
    fail_ratio_above: float = Field(ge=1)
    border_uniform_std_max: float = Field(ge=0)
    border_dark_mean_max: float = Field(ge=0, le=255)
    border_bright_mean_min: float = Field(ge=0, le=255)
    warn_border_fraction_above: float = Field(gt=0, lt=1)

    @model_validator(mode="after")
    def _order(self) -> Self:
        if self.fail_ratio_above < self.warn_ratio_above:
            raise ValueError("aspect.failRatioAbove must be >= aspect.warnRatioAbove")
        return self


class DuplicateSection(_Section):
    near_identical_max_distance: int = Field(ge=0, le=64)
    similar_max_distance: int = Field(ge=0, le=64)

    @model_validator(mode="after")
    def _order(self) -> Self:
        if self.similar_max_distance < self.near_identical_max_distance:
            raise ValueError("duplicate.similarMaxDistance must be >= duplicate.nearIdenticalMaxDistance")
        return self


class QualityConfig(CamelModel):
    schema_version: Literal[1]
    config_id: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    effective_from: date
    calibration_status: Literal["heuristic_default", "calibrated"]
    provenance: Provenance
    analysis: AnalysisSection
    blur: BlurSection
    exposure: ExposureSection
    glare: GlareSection
    resolution: ResolutionSection
    aspect: AspectSection
    duplicate: DuplicateSection

    @property
    def qualified_version(self) -> str:
        return f"{self.config_id}/{self.version}"


def load_quality_config(path: Path) -> QualityConfig:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot read photo-quality thresholds at {path}: {exc}") from exc
    return QualityConfig.model_validate(raw)
