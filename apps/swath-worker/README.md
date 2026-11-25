# Hail-swath worker

Fetches NOAA MRMS **MESH Max 1440min** (trailing-24h maximum estimated hail size),
thresholds the grid at/above **1.00 inch**, builds hail-path polygons, and stores
one row per UTC day in `public.roof_swaths` (migration `0038`) for
`GET /v1/roof-storms/swath`. The map draws the stored swath — the exact hail path
over houses — instead of dots or a list of reports.

## Source (verified live 2026-11-25)

- Directory: https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/ — free, no key.
- Files: `MRMS_MESH_Max_1440min_00.50_YYYYMMDD-HHMMSS.grib2.gz`, one every
  30 minutes, plus `MRMS_MESH_Max_1440min.latest.grib2.gz` pointing at the newest.
  The directory only keeps about the last 24 hours, which is why the app keeps
  its own copy in the database.
- Grid (decoded from the live file): 7000×3500 regular lat/lon, 0.01° (~1 km),
  lat 54.995 → 20.005, lon −129.995 → −60.005. Values are MESH in millimetres;
  −1/−3 are no-data flags and the GRIB missing value (9999) is excluded — none of
  them is hail.
- Live check 2026-11-25 02:12 UTC: the latest file
  (`..._20261125-020000.grib2`) held 8 cells ≥ 25.4 mm, forming 6 swath segments
  with max hail 1.00–2.96 in.

## Why Python, not the TypeScript API core

MRMS is GRIB2. Decoding it needs ecCodes, which has no reliable Node binding —
so, like the mailer, the parser is a **separate worker**, not a change to the
TypeScript API core. This worker is pure Python: `eccodes` (pip wheel, bundled
binaries — no system install), `shapely` (cell union), `psycopg` (storage).

## Run it

```sh
cd apps/swath-worker
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# One pass, no database writes (verifies fetch + parse + polygons):
.venv/bin/python run.py --once --dry-run
# One pass against a local .grib2 (parser testing):
.venv/bin/python run.py --once --dry-run --mesh-file /path/to/file.grib2
# Store one pass (needs the database):
SWATH_DATABASE_URL=postgres://... .venv/bin/python run.py --once
# Loop mode (default): every SWATH_INTERVAL_MINUTES (30), plus GET /health:
SWATH_DATABASE_URL=postgres://... .venv/bin/python run.py
```

Environment (see `.env.example`; never commit secrets):

| Variable                    | Meaning                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `SWATH_DATABASE_URL`        | Same database the API uses (on Render: `fromDatabase curb-connect-db`). Required unless `--dry-run`. |
| `SWATH_INTERVAL_MINUTES`    | Loop cadence, 5–240 (default 30, matching MRMS).                                                     |
| `SWATH_HOST` / `SWATH_PORT` | Health endpoint bind (default `127.0.0.1:4310`; Render sets `PORT`).                                 |
| `SWATH_MESH_BASE_URL`       | MRMS directory override (tests).                                                                     |
| `SWATH_WORK_DIR`            | Scratch dir for downloads (default: a fresh temp dir per run).                                       |

## What one run does

1. Downloads `MRMS_MESH_Max_1440min.latest.grib2.gz` and gunzips it. The gzip
   member name is the timestamped filename — that is the validity time and the
   stored `source_file`.
2. Decodes the GRIB2 grid with ecCodes and thresholds cells at/above 25.4 mm.
3. Groups 4-connected cells into components; each component's cell squares are
   unioned (edges snapped to 4 decimals so neighbours merge exactly) into one
   GeoJSON Polygon/MultiPolygon with `properties.maxHailIn` (inches, 2dp).
4. Upserts one `roof_swaths` row for the file's UTC validity date
   (`ON CONFLICT (swath_date) DO UPDATE`), even on quiet days — an empty
   `features` list means "checked, no hail", distinct from "never run".

## Tests

```sh
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests/ -q
# Include the live-file structural check against a downloaded .grib2:
SWATH_TEST_MESH_FILE=/path/to/MRMS_MESH_Max_1440min_00.50_....grib2 .venv/bin/python -m pytest tests/ -q
```

## Honesty labels

MRMS MESH is a **modeled radar estimate, not measured stones and not confirmed
damage**. Every API response carries `note: "Estimated hail size, not confirmed
damage"` for stored swaths. When no swath is stored, the API falls back to an
approximate path from clustered SPC reports, labelled
`"Approximate path from NOAA storm reports — not a measured swath"`. See
`docs/hail-swath.md`.
