from __future__ import annotations

import json
import logging

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import RIGHTS, TOKEN, make_settings, post_image, sharp

ROOF_CTX = {**RIGHTS, "imageryId": "img_1"}


def test_health_and_version_unauthenticated(client):
    h = client.get("/health").json()
    assert h["status"] == "ok"
    assert h["enabled_models"] == []
    v = client.get("/v1/version").json()
    assert v["photoQualityMetricVersion"]
    assert v["modelRegistryValid"] is True


def test_auth_required(client):
    assert post_image(client, "/v1/photo-quality", sharp(), headers={}).status_code == 401
    bad = {"Authorization": "Bearer " + "x" * 40}
    assert post_image(client, "/v1/photo-quality", sharp(), headers=bad).status_code == 401


def test_auth_fails_closed_without_token():
    with TestClient(create_app(make_settings(service_token=None))) as c:
        assert c.get("/health").status_code == 200
        assert post_image(c, "/v1/photo-quality", sharp()).status_code == 503


def test_curb_abstains_without_model(client):
    r = post_image(client, "/v1/curb/recognize", sharp(), RIGHTS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultType"] == "abstain"
    assert body["abstention"]["reasonCode"] == "no_validated_model_enabled"
    assert "manual review" in body["abstention"]["message"].lower()
    assert body["classScores"] == [] and body["geometry"] == []
    assert body["suggestedStatus"] == "review_required"
    assert body.get("model") is None


def test_roof_abstains_without_model(client):
    r = post_image(client, "/v1/roof/detect", sharp(), ROOF_CTX)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultType"] == "abstain"
    assert body["abstention"]["reasonCode"] == "no_validated_model_enabled"


def test_kill_switch_abstains():
    with TestClient(create_app(make_settings(automation_kill_switch=True))) as c:
        body = post_image(c, "/v1/curb/recognize", sharp(), RIGHTS).json()
        assert body["abstention"]["reasonCode"] == "automation_disabled"


def test_invalid_registry_abstains(tmp_path):
    bad = tmp_path / "reg.json"
    bad.write_text("{not json", encoding="utf-8")
    with TestClient(create_app(make_settings(model_registry_path=bad))) as c:
        assert c.get("/v1/version").json()["modelRegistryValid"] is False
        body = post_image(c, "/v1/curb/recognize", sharp(), RIGHTS).json()
        assert body["abstention"]["reasonCode"] == "model_registry_invalid"


def test_curb_requires_context(client):
    assert post_image(client, "/v1/curb/recognize", sharp()).status_code == 400


def test_logs_contain_no_token_or_filename(client, caplog):
    caplog.set_level(logging.INFO)
    post_image(client, "/v1/photo-quality", sharp(), name="secret-filename.jpg")
    text = "\n".join(json.dumps(getattr(r, "fields", {}), default=str) + r.getMessage() for r in caplog.records)
    assert TOKEN not in text and "secret-filename" not in text
    assert any(getattr(r, "event", None) == "http_request" for r in caplog.records)
