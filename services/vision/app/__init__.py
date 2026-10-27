"""Vision worker: deterministic photo-quality scoring and abstaining recognizers.

Every response carries the versions below so a stored result can be traced to the exact code and
thresholds that produced it (AIQ-083-API, AIQ-090-API).
"""

# Service build version. Bump on any behaviour change.
__version__ = "0.2.0"

SERVICE_NAME = "vision"

# Version of the photo-quality metric algorithms (grayscale conversion, analysis downscale,
# Laplacian kernel, percentile method, dHash layout). Bump whenever a metric can produce a
# different number for the same bytes. Threshold values are versioned separately in
# app/data/photo_quality_thresholds.*.json.
PHOTO_QUALITY_METRIC_VERSION = "photo-quality-metrics/1.0.0"

# Perceptual hash layout: 9x8 BOX-downsampled luma, 64 horizontal-gradient bits, row-major,
# bit set when the right pixel is brighter than the left one, rendered as 16 lowercase hex chars.
DHASH_ALGORITHM = "dhash-64/1"

# Model-agnostic recognition contracts (CV-046-API, RF-026-API). Bump on any schema change.
CURB_RECOGNITION_CONTRACT_VERSION = "curb-recognition/1.0.0"
ROOF_DETECTION_CONTRACT_VERSION = "roof-detection/1.0.0"
