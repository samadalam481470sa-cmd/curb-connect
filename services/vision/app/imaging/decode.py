"""Safe image decoding (CV-044-API, RR-031-API).

Defences, in order:
1. Magic-byte sniffing against an allowlist (JPEG, PNG, WebP). The client's content type and
   file name are never trusted.
2. Pillow is opened with `formats=[sniffed]`, so no other decoder plugin is ever reached.
3. Dimensions are read from the header and checked against the pixel limit before any pixel is
   decoded (decompression bombs); Pillow's own bomb warning is promoted to an error as a backstop.
4. `verify()` then a full `load()` on a fresh handle; truncated files are an error
   (LOAD_TRUNCATED_IMAGES stays False).
5. EXIF is parsed defensively: unreadable EXIF is reported, never fatal. Only orientation, the
   *presence* of GPS, capture time, and focal length are surfaced; GPS coordinates are never read.
"""

from __future__ import annotations

import hashlib
import io
import re
import warnings
from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image, ImageFile, ImageOps

from app.problems import VisionProblem

ImageFile.LOAD_TRUNCATED_IMAGES = False

ImageFormat = Literal["JPEG", "PNG", "WEBP"]

_EXIF_ORIENTATION = 0x0112
_EXIF_GPS_IFD = 0x8825
_EXIF_SUB_IFD = 0x8769
_EXIF_DATETIME_ORIGINAL = 0x9003
_EXIF_FOCAL_LENGTH = 0x920A
_EXIF_FOCAL_LENGTH_35MM = 0xA405
_EXIF_DATETIME_PATTERN = re.compile(r"^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$")

# Neutral gray used when flattening transparency, so it neither darkens nor brightens metrics.
_FLATTEN_BACKGROUND = (128, 128, 128)


@dataclass(frozen=True)
class ExifSummary:
    present: bool
    readable: bool
    orientation: int | None
    orientation_valid: bool
    gps_present: bool
    captured_at: str | None
    focal_length_mm: float | None
    focal_length_35mm: int | None


@dataclass(frozen=True)
class DecodedImage:
    rgb: Image.Image  # upright (EXIF orientation applied), mode RGB
    format: ImageFormat
    stored_width: int
    stored_height: int
    original_mode: str
    has_alpha: bool
    byte_size: int
    sha256: str
    exif: ExifSummary
    orientation_applied: bool

    @property
    def width(self) -> int:
        return self.rgb.width

    @property
    def height(self) -> int:
        return self.rgb.height


def sniff_format(data: bytes) -> ImageFormat | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def describe_unsupported(data: bytes) -> str:
    head = data[:32]
    if len(head) >= 12 and head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1", b"heim", b"heis"):
            return "HEIC/HEIF photos are not supported. Capture as JPEG (most compatible) or convert before upload."
        if brand in (b"avif", b"avis"):
            return "AVIF images are not supported. Upload a JPEG, PNG, or WebP image."
        return "Video and ISO media files are not accepted. Upload a still JPEG, PNG, or WebP image."
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "GIF images are not accepted. Upload a JPEG, PNG, or WebP photo."
    if head.startswith((b"II*\x00", b"MM\x00*")):
        return "TIFF images are not accepted by the photo worker. Upload a JPEG, PNG, or WebP image."
    if head.startswith(b"BM"):
        return "BMP images are not accepted. Upload a JPEG, PNG, or WebP image."
    if head.startswith(b"%PDF"):
        return "PDF documents are not images. Upload a JPEG, PNG, or WebP photo."
    return "The file is not a recognised image. Upload a JPEG, PNG, or WebP photo."


def _rational_to_float(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return number if np.isfinite(number) and number > 0 else None


def read_exif(image: Image.Image) -> ExifSummary:
    try:
        exif = image.getexif()
        present = len(exif) > 0
        orientation_raw = exif.get(_EXIF_ORIENTATION)
        gps_present = _EXIF_GPS_IFD in exif
        sub = exif.get_ifd(_EXIF_SUB_IFD) if _EXIF_SUB_IFD in exif else {}
    except Exception:  # noqa: BLE001 - malformed EXIF must never fail the upload
        return ExifSummary(True, False, None, False, False, None, None, None)

    orientation = orientation_raw if isinstance(orientation_raw, int) else None
    captured = sub.get(_EXIF_DATETIME_ORIGINAL)
    captured_at = None
    if isinstance(captured, str):
        captured = captured.strip("\x00 ").strip()
        captured_at = captured if _EXIF_DATETIME_PATTERN.match(captured) else None
    focal35 = sub.get(_EXIF_FOCAL_LENGTH_35MM)
    return ExifSummary(
        present=present,
        readable=True,
        orientation=orientation,
        orientation_valid=orientation is not None and 1 <= orientation <= 8,
        gps_present=gps_present,
        captured_at=captured_at,
        focal_length_mm=_rational_to_float(sub.get(_EXIF_FOCAL_LENGTH)),
        focal_length_35mm=focal35 if isinstance(focal35, int) and 0 < focal35 < 10000 else None,
    )


def _to_rgb(image: Image.Image) -> tuple[Image.Image, bool]:
    """Convert any decoded mode to 8-bit RGB. Returns (rgb, had_alpha)."""
    mode = image.mode
    if mode == "RGB":
        return image, False
    if mode.startswith("I;16") or mode in ("I", "F"):
        # High bit-depth grayscale: scale to 8 bits instead of letting conversion clip to white.
        arr = np.asarray(image, dtype=np.float64)
        top = 65535.0 if mode != "F" else max(float(arr.max()), 1.0)
        arr8 = np.clip(np.floor(arr * 255.0 / top + 0.5), 0, 255).astype(np.uint8)
        return Image.fromarray(arr8).convert("RGB"), False
    has_alpha = mode in ("RGBA", "LA", "PA", "RGBa", "La") or (mode == "P" and "transparency" in image.info)
    if has_alpha:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (*_FLATTEN_BACKGROUND, 255))
        return Image.alpha_composite(background, rgba).convert("RGB"), True
    return image.convert("RGB"), False


def decode_image(data: bytes, *, max_pixels: int) -> DecodedImage:
    if not data:
        raise VisionProblem(422, "image_empty", "The uploaded file is empty.")
    fmt = sniff_format(data)
    if fmt is None:
        raise VisionProblem(415, "unsupported_image_format", describe_unsupported(data))

    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(data), formats=[fmt]) as probe:
                stored_width, stored_height = probe.size
                if stored_width <= 0 or stored_height <= 0:
                    raise VisionProblem(422, "image_corrupt", "The image header declares zero width or height.")
                if stored_width * stored_height > max_pixels:
                    raise VisionProblem(
                        422,
                        "image_dimensions_exceed_limit",
                        f"The image is {stored_width}x{stored_height} pixels; the limit is {max_pixels} pixels in total.",
                    )
                # Phone JPEGs are often MPO (primary image + depth/gain map): analyse frame 0.
                # Animated PNG/WebP are not still photos and are refused.
                if fmt != "JPEG" and getattr(probe, "is_animated", False):
                    raise VisionProblem(422, "image_animated_unsupported", "Animated images are not accepted as photos.")
                probe.verify()

            image = Image.open(io.BytesIO(data), formats=[fmt])
            image.load()
            original_mode = image.mode
            exif = read_exif(image)
            orientation_applied = False
            upright: Image.Image = image
            if exif.orientation_valid and exif.orientation not in (None, 1):
                transposed = ImageOps.exif_transpose(image)
                if transposed is not None:
                    upright = transposed
                    orientation_applied = True
            rgb, has_alpha = _to_rgb(upright)
        except VisionProblem:
            raise
        except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise VisionProblem(
                422, "image_dimensions_exceed_limit", "The image exceeds the decoder's pixel safety limit."
            ) from exc
        except Exception as exc:  # noqa: BLE001 - Pillow raises OSError, SyntaxError, ValueError,
            # struct.error, EOFError... for malformed input; all of them mean "not a valid image".
            raise VisionProblem(
                422,
                "image_corrupt",
                f"The file looks like {fmt} but could not be decoded: it is truncated or malformed.",
            ) from exc

    return DecodedImage(
        rgb=rgb,
        format=fmt,
        stored_width=stored_width,
        stored_height=stored_height,
        original_mode=original_mode,
        has_alpha=has_alpha,
        byte_size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        exif=exif,
        orientation_applied=orientation_applied,
    )
