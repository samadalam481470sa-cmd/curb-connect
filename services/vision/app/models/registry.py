"""Model registry (AIQ-090-API): lifecycle status, enable flag, promotion evidence, rollback pointer.

Serving rule. A recognizer returns a prediction only when ALL of these hold:
  1. the global kill switch (VISION_AUTOMATION_KILL_SWITCH) is off;
  2. the registry file is valid;
  3. the task has an active deployment pointing at a registered model;
  4. that model is `enabled` and its status is `pilot` or `prod`;
  5. a runtime adapter with the model's `runtime` key is installed in this process.
Anything else is an explicit abstention routed to manual review. `dev` and `shadow` models never
return output to callers. No runtime adapter ships with this repository, so today every recognizer
abstains.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, ValidationError, model_validator

from app.schemas.common import CamelModel

Task = Literal["curb_recognition", "roof_detection"]
TASKS: tuple[Task, ...] = ("curb_recognition", "roof_detection")
ModelStatus = Literal["dev", "shadow", "pilot", "prod", "retired"]
SERVING_STATUSES: frozenset[str] = frozenset({"pilot", "prod"})

AbstainReason = Literal[
    "no_validated_model_enabled",
    "model_runtime_unavailable",
    "automation_disabled",
    "model_registry_invalid",
    "model_runtime_error",
    "model_output_rejected",
]


class ModelRef(CamelModel):
    model_id: str = Field(pattern=r"^[a-z][a-z0-9_.\-]{1,63}$")
    version: str = Field(pattern=r"^\d+\.\d+\.\d+([\-+][A-Za-z0-9.\-]+)?$")

    @property
    def key(self) -> str:
        return f"{self.model_id}@{self.version}"


class ModelEntry(ModelRef):
    task: Task
    status: ModelStatus
    enabled: bool = Field(description="Feature flag: false forces abstention even for prod models.")
    runtime: str = Field(pattern=r"^[a-z][a-z0-9_.\-]{1,63}$", description="Runtime adapter key.")
    provider: str | None = Field(default=None, description="Vendor or in-house team that supplies the model.")
    training_dataset_version: str | None = None
    validation_report: str | None = Field(default=None, description="Promotion packet / benchmark report id or path.")
    signed_off_by: str | None = None
    deployment_id: str | None = None
    rollback_to: ModelRef | None = None
    registered_at: datetime
    limitations: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _promotion_evidence(self) -> Self:
        # AIQ-083 / AIQ-090: no pilot/prod model without reproducible evidence and a named approver.
        if self.status in SERVING_STATUSES:
            missing = [
                name
                for name, value in (
                    ("trainingDatasetVersion", self.training_dataset_version),
                    ("validationReport", self.validation_report),
                    ("signedOffBy", self.signed_off_by),
                )
                if not value
            ]
            if missing:
                raise ValueError(f"{self.key} has status {self.status} but is missing {', '.join(missing)}")
        if self.rollback_to is not None and self.rollback_to.key == self.key:
            raise ValueError(f"{self.key} cannot roll back to itself")
        return self


class RegistryFile(CamelModel):
    schema_version: Literal[1]
    revision: int = Field(ge=1)
    updated_at: datetime
    notes: str = ""
    models: list[ModelEntry] = Field(default_factory=list)
    deployments: dict[Task, ModelRef | None] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _consistency(self) -> Self:
        seen: dict[str, ModelEntry] = {}
        for entry in self.models:
            if entry.key in seen:
                raise ValueError(f"duplicate model {entry.key}")
            seen[entry.key] = entry
        for entry in self.models:
            if entry.rollback_to is not None:
                target = seen.get(entry.rollback_to.key)
                if target is None:
                    raise ValueError(f"{entry.key} rolls back to unregistered {entry.rollback_to.key}")
                if target.task != entry.task:
                    raise ValueError(f"{entry.key} rolls back to {target.key}, which serves a different task")
        for task, ref in self.deployments.items():
            if ref is None:
                continue
            target = seen.get(ref.key)
            if target is None:
                raise ValueError(f"deployment {task} points at unregistered {ref.key}")
            if target.task != task:
                raise ValueError(f"deployment {task} points at {ref.key}, which serves {target.task}")
            if target.status == "retired":
                raise ValueError(f"deployment {task} points at retired {ref.key}")
        return self

    def find(self, ref: ModelRef) -> ModelEntry | None:
        return next((m for m in self.models if m.key == ref.key), None)

    def active(self, task: Task) -> ModelEntry | None:
        ref = self.deployments.get(task)
        return None if ref is None else self.find(ref)


class RegistryError(Exception):
    pass


@dataclass(frozen=True)
class RegistryState:
    """Loaded registry, or the reason it could not be loaded (recognizers then abstain)."""

    path: Path
    registry: RegistryFile | None
    error: str | None

    @property
    def valid(self) -> bool:
        return self.registry is not None


def parse_registry(raw: str) -> RegistryFile:
    try:
        return RegistryFile.model_validate_json(raw)
    except ValidationError as exc:
        raise RegistryError(str(exc)) from exc


def load_registry(path: Path) -> RegistryState:
    try:
        return RegistryState(path=path, registry=parse_registry(path.read_text(encoding="utf-8")), error=None)
    except (OSError, RegistryError) as exc:
        return RegistryState(path=path, registry=None, error=f"{type(exc).__name__}: {exc}"[:2000])


def rollback(registry: RegistryFile, task: Task, *, now: datetime | None = None) -> RegistryFile:
    """Point `task` at its active model's rollback target. Other tasks and every registered
    entry are untouched, so estimates that cite the rolled-back version stay traceable."""
    current = registry.active(task)
    if current is None:
        raise RegistryError(f"{task} has no active deployment to roll back")
    if current.rollback_to is None:
        raise RegistryError(f"{current.key} has no rollback pointer")
    target = registry.find(current.rollback_to)
    if target is None or target.status == "retired":
        raise RegistryError(f"rollback target {current.rollback_to.key} is missing or retired")
    deployments = dict(registry.deployments)
    deployments[task] = ModelRef(model_id=target.model_id, version=target.version)
    updated = registry.model_dump(mode="json")
    updated["revision"] = registry.revision + 1
    updated["updatedAt"] = (now or datetime.now(UTC)).isoformat().replace("+00:00", "Z")
    updated["deployments"] = {k: (v.model_dump(mode="json") if v else None) for k, v in deployments.items()}
    return RegistryFile.model_validate(updated)


def dump_registry(registry: RegistryFile) -> str:
    return json.dumps(registry.model_dump(mode="json"), indent=2) + "\n"
