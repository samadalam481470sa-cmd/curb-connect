"""Runtime adapter interface for licensed or in-house models (AIQ-081: provider-independent).

An adapter wraps one inference backend (a vendor API, an ONNX file, ...). It returns only what a
model may suggest; the service layer owns everything else (construction fields stay unknown,
lengths are dropped without a valid scale, every result needs human review).

No adapter is registered in this repository. Installing one is a deliberate code change plus a
registry entry with its promotion packet; see README "Adding a model".
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from PIL import Image

from app.models.registry import ModelEntry, Task
from app.schemas.common import CamelModel
from app.schemas.recognition import (
    CurbClassScore,
    CurbConfidence,
    CurbGeometry,
    CurbMeasurements,
    CurbRecognizeContext,
    RoofDetectContext,
    RoofEdge,
    RoofPolygon,
    RoofQualityScores,
    ScaleAssessment,
)


class CurbRuntimeOutput(CamelModel):
    class_scores: list[CurbClassScore]
    geometry: list[CurbGeometry]
    scale: ScaleAssessment
    measurements: CurbMeasurements
    confidence: CurbConfidence
    limitations: list[str] = []


class RoofRuntimeOutput(CamelModel):
    polygons: list[RoofPolygon]
    edges: list[RoofEdge]
    quality_scores: RoofQualityScores
    limitations: list[str] = []


@runtime_checkable
class CurbRuntime(Protocol):
    task: Task

    def predict_curb(self, image: Image.Image, context: CurbRecognizeContext, entry: ModelEntry) -> CurbRuntimeOutput: ...


@runtime_checkable
class RoofRuntime(Protocol):
    task: Task

    def predict_roof(self, image: Image.Image, context: RoofDetectContext, entry: ModelEntry) -> RoofRuntimeOutput: ...


# Adapter key (ModelEntry.runtime) -> adapter instance. Intentionally empty.
INSTALLED_RUNTIMES: dict[str, CurbRuntime | RoofRuntime] = {}
