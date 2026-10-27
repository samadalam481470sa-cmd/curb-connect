"""Shared fixtures: synthetic images generated in memory (no binary fixtures committed)."""

from __future__ import annotations

import io
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageFilter

from app.main import create_app
from app.settings import DEFAULT_MODEL_REGISTRY, Settings

TOKEN = "t" * 40
AUTH = {"Authorization": f"Bearer {TOKEN}"}
RIGHTS = {"rights": {"analyze": True, "source": "contractor_upload"}}


def make_settings(**overrides) -> Settings:
    base = dict(env="test", service_token=TOKEN, model_registry_path=DEFAULT_MODEL_REGISTRY)
    base.update(overrides)
    return Settings(**base)


@pytest.fixture
def client():
    with TestClient(create_app(make_settings())) as c:
        yield c


def scene(width: int = 1600, height: int = 1200, seed: int = 7) -> Image.Image:
    """Mid-tone, high-detail 'concrete' texture with hard edges (curb line, joint)."""
    rng = np.random.default_rng(seed)
    base = rng.integers(70, 180, size=(height, width)).astype(np.float32)
    base[: height // 3, :] -= 30
    base[:, width // 2 : width // 2 + 20] += 40
    arr = np.clip(base, 0, 255).astype(np.uint8)
    return Image.fromarray(np.stack([arr, arr, arr], axis=-1), "RGB")


def to_bytes(img: Image.Image, fmt: str = "JPEG", **kw) -> bytes:
    buf = io.BytesIO()
    if fmt == "JPEG":
        kw.setdefault("quality", 92)
    img.save(buf, format=fmt, **kw)
    return buf.getvalue()


def sharp() -> bytes:
    return to_bytes(scene())


def blurred() -> bytes:
    return to_bytes(scene().filter(ImageFilter.GaussianBlur(8)))


def dark() -> bytes:
    return to_bytes(Image.eval(scene(), lambda v: v // 8))


def overexposed() -> bytes:
    return to_bytes(Image.eval(scene(), lambda v: min(255, v + 160)))


def tiny() -> bytes:
    return to_bytes(scene(200, 150))


def rotated_exif() -> bytes:
    """Stored 1600x1200 with EXIF Orientation=6 (rotate 90 CW): upright is 1200x1600."""
    exif = Image.Exif()
    exif[0x0112] = 6
    return to_bytes(scene(), exif=exif.tobytes())


def post_image(client, path, data, context=None, headers=AUTH, name="p.jpg"):
    files = {"file": (name, data, "image/jpeg")}
    form = {"context": json.dumps(context)} if context is not None else None
    return client.post(path, files=files, data=form, headers=headers)
