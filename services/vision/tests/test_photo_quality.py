from __future__ import annotations

from fastapi.testclient import TestClient
from PIL import Image

from app import PHOTO_QUALITY_METRIC_VERSION
from app.main import create_app
from tests.conftest import (
    AUTH,
    blurred,
    dark,
    make_settings,
    overexposed,
    post_image,
    rotated_exif,
    scene,
    sharp,
    tiny,
    to_bytes,
)

PQ = "/v1/photo-quality"


def codes(body: dict) -> set[str]:
    return {r["code"] for r in body["reasons"]}


def test_sharp_photo_is_usable_and_versioned(client):
    r = post_image(client, PQ, sharp())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] == "usable", body["reasons"]
    assert body["metricVersion"] == PHOTO_QUALITY_METRIC_VERSION
    assert body["thresholdsVersion"] == "photo-quality-thresholds/1.0.0"
    assert body["thresholdsCalibration"] == "heuristic_default"
    assert len(body["hashes"]["dhash"]) == 16
    assert r.headers["x-request-id"]


def test_blurred_photo_requires_retake(client):
    body = post_image(client, PQ, blurred()).json()
    assert body["verdict"] == "retake_required"
    assert "blur_too_high" in codes(body)
    reason = next(x for x in body["reasons"] if x["code"] == "blur_too_high")
    assert reason["observed"] < reason["threshold"] and reason["action"]


def test_dark_photo_requires_retake(client):
    body = post_image(client, PQ, dark()).json()
    assert body["verdict"] == "retake_required"
    assert "exposure_too_dark" in codes(body)


def test_overexposed_photo_flags_exposure_and_glare(client):
    body = post_image(client, PQ, overexposed()).json()
    assert body["verdict"] == "retake_required"
    assert {"exposure_too_bright", "glare_excessive"} & codes(body)


def test_tiny_photo_fails_resolution(client):
    body = post_image(client, PQ, tiny()).json()
    assert "resolution_too_low" in codes(body)
    assert body["verdict"] == "retake_required"


def test_exif_orientation_is_applied(client):
    body = post_image(client, PQ, rotated_exif()).json()
    assert body["orientation"]["exifOrientation"] == 6
    assert body["orientation"]["applied"] is True
    assert (body["input"]["width"], body["input"]["height"]) == (1200, 1600)


def test_scores_are_deterministic(client):
    data = sharp()
    a = post_image(client, PQ, data).json()
    b = post_image(client, PQ, data).json()
    assert a["checks"] == b["checks"] and a["hashes"] == b["hashes"]


def test_duplicate_detection(client):
    # A low-frequency layout (dHash compares coarse brightness gradients, not fine texture).
    from PIL import ImageFilter

    import numpy as np

    yy, xx = np.mgrid[0:1200, 0:1600]
    luma = 60 + 120 * np.sin(xx / 170.0) ** 2 + 50 * np.cos(yy / 130.0)
    arr = np.clip(luma, 0, 255).astype(np.uint8)
    layout = Image.fromarray(np.stack([arr] * 3, axis=-1), "RGB").filter(ImageFilter.GaussianBlur(2))
    original = to_bytes(layout)
    first = post_image(client, PQ, original).json()
    ctx = {"compareHashes": [{"id": "photo_1", "dhash": first["hashes"]["dhash"], "sha256": first["hashes"]["sha256"]}]}
    exact = post_image(client, PQ, original, ctx).json()
    assert exact["checks"]["duplicate"]["matches"][0]["match"] == "exact_bytes"
    assert "duplicate_photo" in codes(exact)
    near = post_image(client, PQ, to_bytes(layout.resize((1400, 1050)), quality=70), ctx).json()
    assert near["checks"]["duplicate"]["matches"][0]["match"] == "near_identical"
    other = post_image(client, PQ, to_bytes(layout.transpose(Image.Transpose.FLIP_LEFT_RIGHT)), ctx).json()
    assert "duplicate_photo" not in codes(other)


def test_corrupt_bytes_rejected(client):
    r = post_image(client, PQ, sharp()[:2000])
    assert r.status_code == 422
    assert r.json()["code"] == "image_corrupt"
    assert r.headers["content-type"].startswith("application/problem+json")


def test_non_image_rejected(client):
    r = post_image(client, PQ, b"%PDF-1.7 not a photo" * 10, name="x.pdf")
    assert r.status_code == 415
    assert r.json()["code"] == "unsupported_image_format"


def test_empty_file_rejected(client):
    assert post_image(client, PQ, b"").status_code == 422


def test_oversized_body_rejected():
    with TestClient(create_app(make_settings(max_upload_bytes=10_000))) as c:
        r = post_image(c, PQ, b"\xff\xd8" + b"0" * 200_000)
        assert r.status_code == 413
        assert r.json()["code"] == "payload_too_large"


def test_pixel_limit_rejected():
    with TestClient(create_app(make_settings(max_image_pixels=100_000))) as c:
        r = post_image(c, PQ, sharp())
        assert r.status_code == 422
        assert r.json()["code"] == "image_dimensions_exceed_limit"


def test_rights_denied(client):
    r = post_image(client, PQ, sharp(), {"rights": {"analyze": False}})
    assert r.status_code == 403
    assert r.json()["code"] == "analysis_not_permitted"


def test_object_ref_disabled_by_default(client):
    r = client.post(PQ, json={"objectRef": {"url": "https://store.example/x", "sha256": "a" * 64}}, headers=AUTH)
    assert r.status_code == 422
    assert r.json()["code"] == "object_ref_disabled"
