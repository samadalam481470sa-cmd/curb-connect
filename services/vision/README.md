# services/vision

Isolated, versioned Python 3.13 FastAPI worker. The Field Pro API calls it at `VISION_URL`
(default `http://localhost:4200`); browsers never do. It does two things:

1. **Deterministic photo-quality scoring** (Pillow + numpy). Every number is explainable and
   reproducible for the same bytes, metric version and threshold version.
2. **Model-agnostic recognition contracts** for curbs and roofs. **No trained model exists in this
   repository**, so both endpoints return an explicit `abstain` result ("No validated model
   enabled; route to manual review."). Nothing is ever fabricated.

Blueprint pages: 026 (roof detection), 031, 043-046 (capture protocol, photo quality, scale,
curb recognition), 050, 081-090 (model registry, promotion evidence, abstention, monitoring).

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health`, `/v1/health` | none | liveness, auth state (`configured`/`not_configured`/`too_short`), registry validity, serving models |
| GET | `/v1/version` | none | service, metric, threshold, dHash, contract and registry versions |
| POST | `/v1/photo-quality` | bearer | quality scores, verdict, reasons |
| POST | `/v1/curb/recognize` | bearer | curb contract (abstains) |
| POST | `/v1/roof/detect` | bearer | roof contract (abstains) |

`/docs` and `/openapi.json` are served only when `VISION_ENV` is `development` or `test`.

### Input (all POST endpoints)

- `multipart/form-data`: part `file` (JPEG, PNG or WebP) and optional JSON text part `context`.
  No other parts are accepted.
- `application/json`: `{"objectRef": {"url", "sha256", "objectId"?}, "context": {...}}`. The URL is
  fetched only from `VISION_OBJECT_FETCH_ALLOWED_ORIGINS` (disabled when empty), without
  redirects or proxies, under the size limit and a timeout, and must match `sha256`. It is
  never logged or echoed.

Context: photo-quality takes optional `photoId`, `viewType`, `compareHashes` (`[{id, dhash,
sha256?}]`, previously scored photos of the same project; the worker is stateless) and `rights`.
Curb requires `rights` (plus optional `photoId`, `viewType`, `scaleReferenceId`); roof requires
`rights` and `imageryId` (optional `groundSampleDistanceM`). `rights.analyze: false` returns 403
`analysis_not_permitted`.

### Photo-quality response (abridged)

`metricVersion`, `thresholdsVersion`, `thresholdsCalibration`, `serviceVersion`, `requestId`,
`verdict` (`usable` | `usable_with_warnings` | `retake_required`), `reasons[]` (`code`, `check`,
`severity`, `message`, `action`, `metric`, `observed`, `comparator`, `threshold`), `checks`
(blur, exposure, glare, resolution, aspect, duplicate, metadata, each with status, raw metric and
the thresholds applied), `input`, `orientation`, `exif` (presence flags, capture time, focal
length; never GPS coordinates), `hashes` (`sha256`, `dhash`), `notAssessed[]`, `limitations[]`.

Observed values are rounded before comparison, so the number in a reason is the number that
decided it. A quality verdict says nothing about content (whether the curb, roof or ruler is in
frame); those are listed under `notAssessed`.

### Recognition response

`resultType` (`abstain` today), `contractVersion`, `model` (id, version, status, registry
revision, or null), `abstention` (`reasonCode`, `message`), `suggestedStatus: review_required`,
`classScores`, `geometry`/`polygons`/`edges`, `scale` validity, measurements as explicit
unknowns, `constructionFields` (reinforcement, depth, thickness, ... always unknown: photos cannot
show them), `limitations`. Abstain reason codes: `no_validated_model_enabled`,
`model_runtime_unavailable`, `automation_disabled`, `model_registry_invalid`,
`model_runtime_error`, `model_output_rejected`.

### Errors

`application/problem+json` with a stable `code`, `correlationId` and `retryable`. Examples:
`unauthorized` 401, `service_auth_not_configured` 503, `payload_too_large` 413,
`unsupported_media_type` / `unsupported_image_format` 415, `image_empty` / `image_corrupt` /
`image_dimensions_exceed_limit` / `image_animated_unsupported` 422, `validation_failed` 400,
`worker_busy` 503, `object_ref_*` 4xx/5xx.

## Metrics and thresholds

Metric algorithms are versioned by `PHOTO_QUALITY_METRIC_VERSION` in `app/__init__.py`; threshold
values live in `app/data/photo_quality_thresholds.v1.json` (`photo-quality-thresholds/1.0.0`).
Metrics run on a BOX-downsampled copy (long side at most 1024 px) after EXIF orientation.

| Check | Metric | Warn | Fail |
| --- | --- | --- | --- |
| Blur | variance of 4-neighbour Laplacian on luma | < 100 | < 40 |
| Exposure | mean luma (0-255); p95-p5 spread | < 60 or > 200; spread < 40 | < 35 or > 225 |
| Glare | share of pixels whose darkest channel >= 250 | > 2% | > 10% |
| Resolution | short side after orientation | < 1080 px | < 480 px |
| Aspect | long/short ratio; flat black/white border bands | > 2.1; band > 5% | > 3.0 |
| Duplicate | dHash (64-bit) Hamming distance; SHA-256 | <= 10 (similar) | <= 4 or same bytes |
| Metadata | unreadable EXIF, invalid orientation, alpha channel | warn only | never |

**Provenance: these are heuristic engineering defaults** (`calibrationStatus:
heuristic_default`), checked only against the synthetic fixtures in `tests/`. They have not been
calibrated on real field photos. Recalibrate on licensed, consented field photos with reviewer
accept/retake outcomes before relying on them for automation (blueprint page 087, also 050 and
083), and publish the result as a new versioned file; never edit a released version in place.
Point `VISION_QUALITY_CONFIG` at the new file.

## Model registry

`app/data/model_registry.json` (override with `VISION_MODEL_REGISTRY`) lists model entries with
`status` (`dev` | `shadow` | `pilot` | `prod` | `retired`), an `enabled` feature flag, a `runtime`
adapter key, the promotion packet (`trainingDatasetVersion`, `validationReport`, `signedOffBy`,
required for pilot/prod) and a `rollbackTo` pointer; `deployments` maps each task to the active
entry. `app.models.registry.rollback()` repoints a task at its rollback target and bumps the
revision without deleting entries. A recognizer serves only when the kill switch is off, the
registry is valid, the active entry is enabled and pilot/prod, **and** a runtime adapter for it is
installed in `app/models/runtime.py` (`INSTALLED_RUNTIMES`, intentionally empty). Otherwise it
abstains.

Adding a model is a deliberate code change: implement the `CurbRuntime`/`RoofRuntime` protocol,
register it in `INSTALLED_RUNTIMES`, and add the registry entry with its promotion packet.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `VISION_SERVICE_TOKEN` | none | shared bearer secret, at least 32 chars; missing/short fails closed (503) |
| `VISION_SERVICE_TOKEN_PREVIOUS` | none | accepted during rotation |
| `VISION_ENV` | development | development, test, staging, production |
| `VISION_MAX_UPLOAD_BYTES` | 26214400 | body limit (plus 64 KiB multipart overhead) and object-ref download limit |
| `VISION_MAX_IMAGE_PIXELS` | 50000000 | checked from the header before decoding |
| `VISION_MAX_CONCURRENCY` / `VISION_QUEUE_TIMEOUT_SECONDS` | 2 / 10 | bounded decoding; `worker_busy` when exceeded |
| `VISION_OBJECT_FETCH_ALLOWED_ORIGINS` | empty | comma-separated origins; empty disables object refs |
| `VISION_AUTOMATION_KILL_SWITCH` | false | all recognizers abstain |
| `VISION_QUALITY_CONFIG`, `VISION_MODEL_REGISTRY`, `VISION_LOG_LEVEL` | bundled files, INFO | |

A git-ignored `services/vision/.env` is also read.

Logs are one JSON object per line on stdout. They never contain image bytes, file names, signed
URLs, tokens, EXIF values or query strings; uvicorn's access log is replaced by a redacted
`http_request` event.

## Setup, run, test

```sh
# Windows
"%LOCALAPPDATA%\Programs\Python\Python313\python.exe" -m venv services/vision/.venv
services\vision\.venv\Scripts\python -m pip install -r services/vision/requirements-dev.txt
# macOS/Linux
python3.13 -m venv services/vision/.venv
services/vision/.venv/bin/python -m pip install -r services/vision/requirements-dev.txt

npm run dev:vision    # uvicorn on port 4200 (via infra/scripts/run-vision.mjs)
npm run test:vision   # pytest

# directly, from services/vision
.venv/Scripts/python -m uvicorn app.main:app --port 4200
.venv/Scripts/python -m pytest -q
```

Tests generate synthetic images in memory (sharp, blurred, dark, overexposed, tiny, rotated EXIF,
corrupt and non-image bytes, duplicates) and cover verdicts, limits, auth, abstention, the kill
switch, an invalid registry, registry validation and rollback, and log hygiene.

## Intentionally not implemented

- No trained, licensed or validated model and no runtime adapter: recognition always abstains.
- No occlusion, subject-cropping, distance, perspective, scale-reference or requested-view checks
  (they need content understanding or calibration; reported in `notAssessed`).
- No persistence: the worker stores no images or hashes; duplicate comparison uses hashes the API
  sends for the same project.
- Thresholds are uncalibrated heuristics (see above). No drift monitoring or shadow-mode
  comparison pipeline yet (pages 088-089); results carry the versions needed to build them.
