import os
import tempfile
from pathlib import Path

# Settings are read at import time, so point them at a throwaway location first.
_TMP = Path(tempfile.mkdtemp(prefix="curbconnect-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP / 'test.db'}"
os.environ["UPLOAD_DIR"] = str(_TMP / "uploads")
os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-characters"
os.environ["MAX_UPLOAD_MB"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as test_client:
        yield test_client


def register(client: TestClient, email: str, company: str = "Acme") -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"companyName": company, "name": "Pat", "email": email, "password": "correct-horse-battery"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


@pytest.fixture()
def contractor(client: TestClient) -> dict[str, str]:
    return register(client, "gc@example.com", "Northline GC")


@pytest.fixture()
def sub(client: TestClient) -> dict[str, str]:
    return register(client, "crew@example.com", "Precision Curb")


def create_project(client: TestClient, headers: dict[str, str], **overrides) -> dict:
    body = {
        "name": "Elmwood curbs",
        "contractor": "Northline GC",
        "subcontractor": "Precision Curb",
        "contractCents": 1_850_000,
        "dueDate": "2030-06-11",
        **overrides,
    }
    response = client.post("/api/projects", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()
