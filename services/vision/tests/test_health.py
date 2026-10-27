from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_ok_and_no_enabled_models() -> None:
    """CV-041-QA: with no registered model the worker must advertise none (it will abstain)."""
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "vision"
    assert body["enabled_models"] == []
