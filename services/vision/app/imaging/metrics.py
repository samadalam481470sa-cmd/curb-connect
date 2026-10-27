"""Explainable, deterministic image metrics (CV-044-API).

All metrics run on one analysis image: the upright RGB photo BOX-downsampled (area average, no
ringing) so its long side is at most `max_long_side` pixels; smaller images are never upscaled.
Luma is Pillow's integer ITU-R BT.601 conversion ("L"). Same bytes + same library versions give
the same numbers; anything that could change a number bumps PHOTO_QUALITY_METRIC_VERSION.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class AnalysisImage:
    rgb: np.ndarray  # H x W x 3, uint8
    luma: np.ndarray  # H x W, uint8
    luma_image: Image.Image
    width: int
    height: int


def analysis_image(rgb: Image.Image, max_long_side: int) -> AnalysisImage:
    width, height = rgb.size
    scale = min(1.0, max_long_side / max(width, height))
    if scale < 1.0:
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        rgb = rgb.resize(size, Image.Resampling.BOX)
    luma_image = rgb.convert("L")
    return AnalysisImage(
        rgb=np.asarray(rgb, dtype=np.uint8),
        luma=np.asarray(luma_image, dtype=np.uint8),
        luma_image=luma_image,
        width=rgb.width,
        height=rgb.height,
    )


def laplacian_variance(luma: np.ndarray) -> float | None:
    """Variance of the 4-neighbour Laplacian [[0,1,0],[1,-4,1],[0,1,0]] over interior pixels.

    Low values mean little high-frequency detail: motion blur, missed focus, or a featureless
    frame. None when the image is too small (< 3x3) to have an interior.
    """
    if luma.shape[0] < 3 or luma.shape[1] < 3:
        return None
    g = luma.astype(np.float64)
    lap = g[1:-1, :-2] + g[1:-1, 2:] + g[:-2, 1:-1] + g[2:, 1:-1] - 4.0 * g[1:-1, 1:-1]
    return float(lap.var())


@dataclass(frozen=True)
class LumaStats:
    mean: float
    p5: int
    p50: int
    p95: int
    shadow_clipped_ratio: float


def _percentile(cumulative: np.ndarray, total: int, q: float) -> int:
    """Nearest-rank percentile on an integer histogram (exact, no interpolation)."""
    target = max(1, math.ceil(q * total))
    return int(np.searchsorted(cumulative, target, side="left"))


def luma_stats(luma: np.ndarray, shadow_clip_level: int) -> LumaStats:
    hist = np.bincount(luma.ravel(), minlength=256).astype(np.int64)
    total = int(hist.sum())
    cumulative = np.cumsum(hist)
    mean = float((hist * np.arange(256, dtype=np.int64)).sum()) / total
    return LumaStats(
        mean=mean,
        p5=_percentile(cumulative, total, 0.05),
        p50=_percentile(cumulative, total, 0.50),
        p95=_percentile(cumulative, total, 0.95),
        shadow_clipped_ratio=float(hist[: shadow_clip_level + 1].sum()) / total,
    )


def highlight_clipped_ratio(rgb: np.ndarray, clip_level: int) -> float:
    """Share of pixels whose darkest channel is still >= clip_level (blown-out, colourless)."""
    clipped = np.count_nonzero(rgb.min(axis=2) >= clip_level)
    return clipped / float(rgb.shape[0] * rgb.shape[1])


@dataclass(frozen=True)
class BorderBands:
    top: float
    bottom: float
    left: float
    right: float
    uniform_frame: bool

    @property
    def largest(self) -> float:
        return max(self.top, self.bottom, self.left, self.right)


def _edge_run(lines_std: np.ndarray, lines_mean: np.ndarray, std_max: float, dark_max: float, bright_min: float) -> int:
    """Count consecutive flat, near-black or near-white lines from the start of the arrays."""
    flat = (lines_std <= std_max) & ((lines_mean <= dark_max) | (lines_mean >= bright_min))
    if flat.all():
        return len(flat)
    return int(np.argmin(flat))


def border_bands(luma: np.ndarray, std_max: float, dark_max: float, bright_min: float) -> BorderBands:
    """Flat black/white bands along the edges: letterboxing, screenshot padding, edited crops."""
    g = luma.astype(np.float64)
    row_std, row_mean = g.std(axis=1), g.mean(axis=1)
    col_std, col_mean = g.std(axis=0), g.mean(axis=0)
    h, w = g.shape
    top = _edge_run(row_std, row_mean, std_max, dark_max, bright_min)
    if top == h:  # the whole frame is flat: blur/exposure checks explain it, bands do not apply
        return BorderBands(0.0, 0.0, 0.0, 0.0, uniform_frame=True)
    bottom = _edge_run(row_std[::-1], row_mean[::-1], std_max, dark_max, bright_min)
    left = _edge_run(col_std, col_mean, std_max, dark_max, bright_min)
    right = _edge_run(col_std[::-1], col_mean[::-1], std_max, dark_max, bright_min)
    return BorderBands(top / h, bottom / h, left / w, right / w, uniform_frame=False)


def dhash(luma_image: Image.Image) -> str:
    """64-bit difference hash (DHASH_ALGORITHM): robust to re-encoding and resizing, sensitive to
    content and orientation changes. Used for duplicate/burst detection, never for identity."""
    small = np.asarray(luma_image.resize((9, 8), Image.Resampling.BOX), dtype=np.int16)
    bits = (small[:, 1:] > small[:, :-1]).ravel()
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return f"{value:016x}"


def hamming_distance(a: str, b: str) -> int:
    return (int(a, 16) ^ int(b, 16)).bit_count()
