from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models.registry import RegistryError, parse_registry, rollback
from tests.conftest import RIGHTS, make_settings, post_image, sharp


def _entry(version: str, status: str, rollback_to: str | None = None, **extra) -> dict:
    e = {
        "modelId": "curb-seg", "version": version, "task": "curb_recognition", "status": status,
        "enabled": True, "runtime": "test-adapter", "registeredAt": "2026-10-01T00:00:00Z", **extra,
    }
    if rollback_to:
        e["rollbackTo"] = {"modelId": "curb-seg", "version": rollback_to}
    return e


PACKET = {"trainingDatasetVersion": "ds-1", "validationReport": "val-1", "signedOffBy": "reviewer"}


def _registry(models: list[dict], active: str | None) -> dict:
    return {
        "schemaVersion": 1, "revision": 1, "updatedAt": "2026-10-26T00:00:00Z", "models": models,
        "deployments": {
            "curb_recognition": {"modelId": "curb-seg", "version": active} if active else None,
            "roof_detection": None,
        },
    }


def test_prod_without_promotion_packet_is_rejected():
    with pytest.raises(RegistryError):
        parse_registry(json.dumps(_registry([_entry("1.0.0", "prod")], "1.0.0")))


def test_rollback_moves_pointer_and_keeps_entries():
    reg = parse_registry(json.dumps(_registry(
        [_entry("1.0.0", "prod", **PACKET), _entry("1.1.0", "pilot", rollback_to="1.0.0", **PACKET)], "1.1.0",
    )))
    rolled = rollback(reg, "curb_recognition")
    assert rolled.active("curb_recognition").version == "1.0.0"
    assert rolled.revision == 2 and len(rolled.models) == 2


def test_shadow_model_is_not_served(tmp_path):
    path = tmp_path / "reg.json"
    path.write_text(json.dumps(_registry([_entry("0.1.0", "shadow")], "0.1.0")), encoding="utf-8")
    with TestClient(create_app(make_settings(model_registry_path=path))) as c:
        body = post_image(c, "/v1/curb/recognize", sharp(), RIGHTS).json()
        assert body["resultType"] == "abstain"
        assert body["abstention"]["reasonCode"] == "no_validated_model_enabled"
        assert body["model"]["status"] == "shadow"


def test_prod_model_without_installed_runtime_abstains(tmp_path):
    """A registry entry alone never produces output: no adapter is installed in this repo."""
    path = tmp_path / "reg.json"
    path.write_text(json.dumps(_registry([_entry("1.0.0", "prod", **PACKET)], "1.0.0")), encoding="utf-8")
    with TestClient(create_app(make_settings(model_registry_path=path))) as c:
        body = post_image(c, "/v1/curb/recognize", sharp(), RIGHTS).json()
        assert body["resultType"] == "abstain"
        assert body["abstention"]["reasonCode"] == "model_runtime_unavailable"
        assert body["classScores"] == []
