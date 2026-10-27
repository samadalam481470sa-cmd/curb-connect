"""Photo-quality assessment: metrics -> per-check status -> explainable reasons -> verdict.

Values are rounded *before* they are compared, so the number shown in a reason is exactly the
number that decided it. A quality verdict says nothing about content: it never confirms that a
curb, roof, or scale reference is visible (that is the capture-completeness check, CV-043).
"""

from __future__ import annotations

from app import DHASH_ALGORITHM, PHOTO_QUALITY_METRIC_VERSION, __version__
from app.imaging.decode import DecodedImage
from app.imaging.metrics import (
    analysis_image,
    border_bands,
    dhash,
    hamming_distance,
    highlight_clipped_ratio,
    laplacian_variance,
    luma_stats,
)
from app.quality.config import QualityConfig
from app.schemas.common import InputSummary
from app.schemas.quality import (
    AnalysisInfo,
    AspectCheck,
    BlurCheck,
    BorderBandsOut,
    CheckStatus,
    Checks,
    DuplicateCheck,
    DuplicateMatch,
    ExifOut,
    ExposureCheck,
    GlareCheck,
    Hashes,
    MetadataCheck,
    NotAssessed,
    Orientation,
    PhotoQualityResponse,
    QualityContext,
    Reason,
    ResolutionCheck,
    Verdict,
)

NOT_ASSESSED = [
    NotAssessed(aspect="occlusion", reason="Requires content understanding; no validated model is enabled."),
    NotAssessed(aspect="distance", reason="Subject distance cannot be measured from pixels without a trusted scale (CV-045)."),
    NotAssessed(aspect="perspective", reason="Perspective is assessed during calibration, not by photo quality."),
    NotAssessed(aspect="subject_cropping", reason="Whether the curb or roof is fully in frame needs content recognition."),
    NotAssessed(aspect="scale_reference", reason="Presence of a ruler or known-length reference is confirmed by the user and calibration."),
    NotAssessed(aspect="requested_view", reason="Whether the photo shows the requested view is a capture-protocol check (CV-043)."),
]

LIMITATIONS = [
    "Scores describe image quality only; they do not confirm what the photo shows.",
    "Thresholds are heuristic defaults pending recalibration on licensed field data; treat warnings as advisory.",
    "A passing photo is not a measurement: dimensions still require a trusted scale reference or field values.",
]


def _r(value: float, digits: int) -> float:
    return round(float(value), digits)


class _Reasons:
    def __init__(self) -> None:
        self.items: list[Reason] = []

    def add(self, **kwargs: object) -> None:
        self.items.append(Reason.model_validate(kwargs))

    def status_for(self, check: str) -> CheckStatus:
        severities = {r.severity for r in self.items if r.check == check}
        if "fail" in severities:
            return "fail"
        if "warn" in severities:
            return "warn"
        return "pass"


def assess_photo_quality(
    decoded: DecodedImage,
    context: QualityContext,
    config: QualityConfig,
    *,
    request_id: str,
    source: str,
    object_id: str | None,
) -> PhotoQualityResponse:
    analysis = analysis_image(decoded.rgb, config.analysis.max_long_side_px)
    reasons = _Reasons()

    # Blur (variance of Laplacian).
    blur_cfg = config.blur
    lap_raw = laplacian_variance(analysis.luma)
    lap = None if lap_raw is None else _r(lap_raw, 2)
    if lap is None:
        blur_status: CheckStatus = "not_assessed"
    else:
        if lap < blur_cfg.fail_below:
            reasons.add(
                code="blur_too_high", check="blur", severity="fail", metric="laplacianVariance",
                observed=lap, comparator="<", threshold=blur_cfg.fail_below,
                message="The photo is too blurry to read edges or ruler markings.",
                action="Hold the phone steady (brace your arms), tap the screen to focus on the curb edge or roof line, and retake.",
            )
        elif lap < blur_cfg.warn_below:
            reasons.add(
                code="blur_detected", check="blur", severity="warn", metric="laplacianVariance",
                observed=lap, comparator="<", threshold=blur_cfg.warn_below,
                message="The photo is slightly soft; fine details may be hard to read.",
                action="If the ruler markings or edges look fuzzy, retake with the phone held still and focus locked.",
            )
        blur_status = reasons.status_for("blur")

    # Exposure (mean and percentile luma).
    exp_cfg = config.exposure
    stats = luma_stats(analysis.luma, exp_cfg.shadow_clip_level)
    mean = _r(stats.mean, 2)
    dynamic_range = stats.p95 - stats.p5
    if mean < exp_cfg.fail_mean_below:
        reasons.add(
            code="exposure_too_dark", check="exposure", severity="fail", metric="meanLuma",
            observed=mean, comparator="<", threshold=exp_cfg.fail_mean_below,
            message="The photo is too dark to see the surface and edges.",
            action="Retake in daylight or with even lighting; avoid shooting into deep shade at dusk.",
        )
    elif mean < exp_cfg.warn_mean_below:
        reasons.add(
            code="exposure_dark", check="exposure", severity="warn", metric="meanLuma",
            observed=mean, comparator="<", threshold=exp_cfg.warn_mean_below,
            message="The photo is darker than recommended.",
            action="If details are hard to see, retake with more light.",
        )
    elif mean > exp_cfg.fail_mean_above:
        reasons.add(
            code="exposure_too_bright", check="exposure", severity="fail", metric="meanLuma",
            observed=mean, comparator=">", threshold=exp_cfg.fail_mean_above,
            message="The photo is overexposed; the surface is washed out.",
            action="Retake without pointing toward the sun; tap a mid-tone area to set exposure.",
        )
    elif mean > exp_cfg.warn_mean_above:
        reasons.add(
            code="exposure_bright", check="exposure", severity="warn", metric="meanLuma",
            observed=mean, comparator=">", threshold=exp_cfg.warn_mean_above,
            message="The photo is brighter than recommended.",
            action="If edges look washed out, retake with lower exposure.",
        )
    if dynamic_range < exp_cfg.warn_dynamic_range_below:
        reasons.add(
            code="exposure_low_contrast", check="exposure", severity="warn", metric="dynamicRange",
            observed=float(dynamic_range), comparator="<", threshold=float(exp_cfg.warn_dynamic_range_below),
            message="The photo has very low contrast (fog, haze, a dirty lens, or a flat surface fills the frame).",
            action="Wipe the lens and retake so edges stand out from the background.",
        )

    # Glare (clipped highlights).
    glare_cfg = config.glare
    clipped = _r(highlight_clipped_ratio(analysis.rgb, glare_cfg.clip_level), 5)
    if clipped > glare_cfg.fail_ratio_above:
        reasons.add(
            code="glare_excessive", check="glare", severity="fail", metric="highlightClippedRatio",
            observed=clipped, comparator=">", threshold=glare_cfg.fail_ratio_above,
            message="Large blown-out highlights hide part of the scene.",
            action="Change your angle to avoid reflections from the sun, wet surfaces, or the flash, then retake.",
        )
    elif clipped > glare_cfg.warn_ratio_above:
        reasons.add(
            code="glare_detected", check="glare", severity="warn", metric="highlightClippedRatio",
            observed=clipped, comparator=">", threshold=glare_cfg.warn_ratio_above,
            message="Some areas are blown out by glare.",
            action="Make sure glare does not cover the ruler or the edges you need; otherwise retake from another angle.",
        )

    # Resolution (short side after orientation).
    res_cfg = config.resolution
    short_side = min(decoded.width, decoded.height)
    megapixels = _r(decoded.width * decoded.height / 1_000_000, 2)
    if short_side < res_cfg.fail_short_side_below:
        reasons.add(
            code="resolution_too_low", check="resolution", severity="fail", metric="shortSidePx",
            observed=float(short_side), comparator="<", threshold=float(res_cfg.fail_short_side_below),
            message="The image resolution is too low for measurement review.",
            action="Upload the original camera photo, not a thumbnail, screenshot, or messaging-app copy.",
        )
    elif short_side < res_cfg.warn_short_side_below:
        reasons.add(
            code="resolution_low", check="resolution", severity="warn", metric="shortSidePx",
            observed=float(short_side), comparator="<", threshold=float(res_cfg.warn_short_side_below),
            message="The image resolution is lower than recommended.",
            action="If possible, upload the original full-resolution photo.",
        )

    # Aspect ratio and border padding (cropping).
    asp_cfg = config.aspect
    aspect_ratio = _r(max(decoded.width, decoded.height) / short_side, 3)
    if aspect_ratio > asp_cfg.fail_ratio_above:
        reasons.add(
            code="aspect_ratio_extreme", check="aspect", severity="fail", metric="aspectRatio",
            observed=aspect_ratio, comparator=">", threshold=asp_cfg.fail_ratio_above,
            message="The image is an extreme strip or panorama, which distorts geometry.",
            action="Take a normal photo (not panorama mode) and upload it uncropped.",
        )
    elif aspect_ratio > asp_cfg.warn_ratio_above:
        reasons.add(
            code="aspect_ratio_unusual", check="aspect", severity="warn", metric="aspectRatio",
            observed=aspect_ratio, comparator=">", threshold=asp_cfg.warn_ratio_above,
            message="The image has an unusual shape; it may be cropped or a screenshot.",
            action="Upload the original, uncropped camera photo if you have it.",
        )
    bands = border_bands(
        analysis.luma, asp_cfg.border_uniform_std_max, asp_cfg.border_dark_mean_max, asp_cfg.border_bright_mean_min
    )
    band_out = BorderBandsOut(
        top=_r(bands.top, 4), bottom=_r(bands.bottom, 4), left=_r(bands.left, 4), right=_r(bands.right, 4)
    )
    largest_band = max(band_out.top, band_out.bottom, band_out.left, band_out.right)
    if largest_band > asp_cfg.warn_border_fraction_above:
        reasons.add(
            code="border_padding_detected", check="aspect", severity="warn", metric="borderBandFraction",
            observed=largest_band, comparator=">", threshold=asp_cfg.warn_border_fraction_above,
            message="The image has flat black or white borders, as in a screenshot or an edited copy.",
            action="Upload the original camera photo instead of a screenshot or edited copy.",
        )

    # Duplicates (caller-supplied hashes of the same project's photos).
    dup_cfg = config.duplicate
    photo_hash = dhash(analysis.luma_image)
    matches: list[DuplicateMatch] = []
    for ref in context.compare_hashes:
        distance = hamming_distance(photo_hash, ref.dhash)
        if ref.sha256 is not None and ref.sha256 == decoded.sha256:
            matches.append(DuplicateMatch(id=ref.id, match="exact_bytes", hamming_distance=distance))
        elif distance <= dup_cfg.near_identical_max_distance:
            matches.append(DuplicateMatch(id=ref.id, match="near_identical", hamming_distance=distance))
        elif distance <= dup_cfg.similar_max_distance:
            matches.append(DuplicateMatch(id=ref.id, match="similar", hamming_distance=distance))
    matches.sort(key=lambda m: (m.hamming_distance, m.id))
    strong = [m for m in matches if m.match in ("exact_bytes", "near_identical")]
    if strong:
        reasons.add(
            code="duplicate_photo", check="duplicate", severity="fail", metric="dhashHammingDistance",
            observed=float(strong[0].hamming_distance), comparator="<=",
            threshold=float(dup_cfg.near_identical_max_distance),
            message=f"This photo duplicates an existing photo ({strong[0].id}).",
            action="Replace it with the view that was requested, or remove the duplicate.",
        )
    elif matches:
        reasons.add(
            code="duplicate_similar_photo", check="duplicate", severity="warn", metric="dhashHammingDistance",
            observed=float(matches[0].hamming_distance), comparator="<=", threshold=float(dup_cfg.similar_max_distance),
            message=f"This photo looks very similar to an existing photo ({matches[0].id}).",
            action="Check that it shows a different view or adds new detail; otherwise remove it.",
        )
    duplicate_status: CheckStatus = reasons.status_for("duplicate") if context.compare_hashes else "not_assessed"

    # Metadata hygiene (never fatal).
    if decoded.exif.present and not decoded.exif.readable:
        reasons.add(
            code="exif_unreadable", check="metadata", severity="warn",
            message="The photo's metadata is damaged, so its orientation could not be confirmed.",
            action="Check the preview is upright; re-export or retake the photo if it is rotated.",
        )
    elif decoded.exif.orientation is not None and not decoded.exif.orientation_valid:
        reasons.add(
            code="exif_orientation_invalid", check="metadata", severity="warn",
            message="The photo declares an invalid orientation; it was scored as stored.",
            action="Check the preview is upright; retake if it is rotated or mirrored.",
        )
    if decoded.has_alpha:
        reasons.add(
            code="image_has_transparency", check="metadata", severity="warn",
            message="The image has transparent areas, so it is probably edited rather than straight from a camera.",
            action="Upload the original camera photo.",
        )

    severities = {r.severity for r in reasons.items}
    verdict: Verdict = "retake_required" if "fail" in severities else "usable_with_warnings" if severities else "usable"
    # Stable order: failures first, then by check, then code.
    check_order = ["blur", "exposure", "glare", "resolution", "aspect", "duplicate", "metadata"]
    ordered = sorted(reasons.items, key=lambda r: (r.severity != "fail", check_order.index(r.check), r.code))

    return PhotoQualityResponse(
        metric_version=PHOTO_QUALITY_METRIC_VERSION,
        thresholds_version=config.qualified_version,
        thresholds_calibration=config.calibration_status,
        service_version=__version__,
        request_id=request_id,
        photo_id=context.photo_id,
        view_type=context.view_type,
        verdict=verdict,
        reasons=ordered,
        checks=Checks(
            blur=BlurCheck(
                status=blur_status, laplacian_variance=lap,
                fail_below=blur_cfg.fail_below, warn_below=blur_cfg.warn_below,
            ),
            exposure=ExposureCheck(
                status=reasons.status_for("exposure"), mean_luma=mean, p5_luma=stats.p5, p50_luma=stats.p50,
                p95_luma=stats.p95, dynamic_range=dynamic_range,
                shadow_clipped_ratio=_r(stats.shadow_clipped_ratio, 5),
                fail_mean_below=exp_cfg.fail_mean_below, warn_mean_below=exp_cfg.warn_mean_below,
                warn_mean_above=exp_cfg.warn_mean_above, fail_mean_above=exp_cfg.fail_mean_above,
                warn_dynamic_range_below=exp_cfg.warn_dynamic_range_below,
            ),
            glare=GlareCheck(
                status=reasons.status_for("glare"), highlight_clipped_ratio=clipped, clip_level=glare_cfg.clip_level,
                warn_ratio_above=glare_cfg.warn_ratio_above, fail_ratio_above=glare_cfg.fail_ratio_above,
            ),
            resolution=ResolutionCheck(
                status=reasons.status_for("resolution"), width=decoded.width, height=decoded.height,
                short_side=short_side, megapixels=megapixels,
                fail_short_side_below=res_cfg.fail_short_side_below, warn_short_side_below=res_cfg.warn_short_side_below,
            ),
            aspect=AspectCheck(
                status=reasons.status_for("aspect"), aspect_ratio=aspect_ratio, border_bands=band_out,
                warn_ratio_above=asp_cfg.warn_ratio_above, fail_ratio_above=asp_cfg.fail_ratio_above,
                warn_border_fraction_above=asp_cfg.warn_border_fraction_above,
            ),
            duplicate=DuplicateCheck(
                status=duplicate_status, compared=len(context.compare_hashes), matches=matches,
                near_identical_max_distance=dup_cfg.near_identical_max_distance,
                similar_max_distance=dup_cfg.similar_max_distance,
            ),
            metadata=MetadataCheck(
                status=reasons.status_for("metadata"), exif_present=decoded.exif.present,
                exif_readable=decoded.exif.readable, has_alpha=decoded.has_alpha,
            ),
        ),
        input=InputSummary(
            sha256=decoded.sha256, format=decoded.format, width=decoded.width, height=decoded.height,
            byte_size=decoded.byte_size, source=source, object_id=object_id,  # type: ignore[arg-type]
        ),
        orientation=Orientation(
            exif_orientation=decoded.exif.orientation, applied=decoded.orientation_applied,
            stored_width=decoded.stored_width, stored_height=decoded.stored_height,
        ),
        exif=ExifOut(
            present=decoded.exif.present, readable=decoded.exif.readable, gps_present=decoded.exif.gps_present,
            captured_at=decoded.exif.captured_at, focal_length_mm=decoded.exif.focal_length_mm,
            focal_length_35mm=decoded.exif.focal_length_35mm,
        ),
        hashes=Hashes(sha256=decoded.sha256, dhash=photo_hash, dhash_algorithm=DHASH_ALGORITHM),
        analysis=AnalysisInfo(width=analysis.width, height=analysis.height),
        not_assessed=NOT_ASSESSED,
        limitations=LIMITATIONS,
    )
