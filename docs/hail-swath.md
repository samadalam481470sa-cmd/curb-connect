# Hail swath (storm pattern on the map)

When it hails, the storm pattern pops up on the map showing the **exact hail
path over the houses** — a swath/path polygon, not dots and not a list of
reports. This doc covers the ingestion + API half. The web map renders the
`swath` FeatureCollection from `GET /v1/roof-storms/swath` (see
`apps/web/src/features/roof/storms/swath.ts`).

## Source: NOAA MRMS MESH Max 1440min

- Directory: https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/ — free, no key.
- Content: trailing-24h maximum **estimated** hail size (MESH, millimetres) on a
  ~1 km grid (7000×3500, 0.01°, lat 54.995 → 20.005, lon −129.995 → −60.005).
- Cadence: one `.grib2.gz` file every 30 minutes
  (`MRMS_MESH_Max_1440min_00.50_YYYYMMDD-HHMMSS.grib2.gz`), plus a
  `MRMS_MESH_Max_1440min.latest.grib2.gz` pointer at the newest file.
- Retention: the directory only keeps about the last 24 hours of files — that is
  why the app stores each day's swath in its own table instead of re-reading MRMS.

### Live verification (2026-11-25 ~02:00 UTC)

- Directory listing fetched: files every 30 minutes, newest
  `MRMS_MESH_Max_1440min_00.50_20261125-013000.grib2.gz` (125K), `latest`
  modified 01:38 UTC.
- Latest file downloaded with curl (162,116 bytes gunzipped) and decoded with
  `eccodes`: grid 7000×3500 as above; values −3…75.1 mm; −1/−3 are no-data flags;
  no 9999 values present in that file.
- Worker dry-run against a fresh download (`..._20261125-020000.grib2`):
  **8 cells ≥ 25.4 mm → 6 swath segments, max hail 1.00–2.96 in**
  (Maine 2.96", Ontario shore 1.61", Pennsylvania 1.24", Washington coast 1.17",
  Washington inland 1.00"). The API fallback was not needed for that file — the
  real swath is the deliverable.

## Threshold

**1.00 inch (25.4 mm)** — the severe-hail threshold. It is a constant in both
halves and they must stay in sync:

- Worker: `THRESHOLD_MM = 25.4` in `apps/swath-worker/src/swath_worker/mesh.py`.
- API: `SWATH_THRESHOLD_IN = 1` in `apps/api/src/modules/roofStorms/swath.ts`
  (returned as `thresholdIn` on every response).

Cells at/above the threshold form the path; everything below is ignored. Negative
values and the GRIB missing value (9999) are no-data flags, never hail.

## Worker: apps/swath-worker

Pure Python (GRIB2 needs ecCodes, which has no reliable Node binding — so the
parser is a separate worker, mirroring the mailer, not a change to the TypeScript
API core). Dependencies: `eccodes`, `shapely`, `psycopg[binary]`.

```sh
cd apps/swath-worker
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python run.py --once --dry-run        # fetch + parse + build, no writes
.venv/bin/python run.py --once                   # one pass, store (needs SWATH_DATABASE_URL)
.venv/bin/python run.py                          # loop every 30 min + GET /health
```

One pass: downloads `latest`, gunzips (the gzip member name is the timestamped
filename — that is the validity time and stored `source_file`), decodes the grid,
thresholds, groups 4-connected cells, unions each component's cell squares into
one GeoJSON Polygon/MultiPolygon with `properties.maxHailIn` (inches, 2dp), and
upserts the day's row. A quiet day still stores a row with empty `features`, so
"checked, no hail" is distinct from "never run".

Worker tests (`pytest`, 18 tests): threshold boundary (25.4 in / 25.3 out,
no-data flags and missing value excluded), component grouping (adjacent merges,
diagonal does not, real-longitude float-gap regression), synthetic GRIB2
round-trip, upsert SQL against a fake connection, CLI dry-run end to end, plus a
live-file structural check when `SWATH_TEST_MESH_FILE` points at a download.

## Storage: public.roof_swaths (migration 0038)

One row per UTC day (`swath_date` is the primary key — the UTC date of the
file's validity time), `source_file`, `source_valid_at`, `threshold_in`,
`features` (jsonb array of GeoJSON features), `feature_count`, `cell_count`,
`checked_at`. Platform-owned, not tenant data: no RLS; the API reads it through
the named platform operation `roof.swath` (`GET /v1/roof-storms/swath`), the
worker writes it with the owner database URL (`SWATH_DATABASE_URL`, on Render
`fromDatabase: curb-connect-db`). Journal entry idx 38, tag
`0038_roof_swaths`. The Render deploy that carries migration 0038 must run
before the worker's first store (the API deploy runs migrations).

## API: GET /v1/roof-storms/swath?days=1

- Query: `days` 1–7, default 1. Permission `roof_order:read`, rate limit 60/min.
- Stored swath wins: serves the stored rows' features for the requested days.
  `date` is the latest stored swath date; `eventCount` is the number of swath
  segments served.
- Fallback (no swath stored, or storage down): clusters that day's SPC hail
  reports (same-day reports within 25 miles chain into one cluster) and buffers
  each cluster by **5 miles** into a path polygon (convex hull of 16-vertex
  buffer circles). `eventCount` is the number of SPC reports used.
- Quiet days: `status: 'ok'`, empty features,
  `message: 'No hail swath in the selected period.'`
- Feed down too: `status: 'unavailable'`, empty features, honest message —
  never invented rows.

### Exact response shape

```json
{
  "status": "ok | unavailable",
  "kind": "mrms_swath | approximate_path",
  "source": "NOAA MRMS MESH Max 1440min | NOAA Storm Prediction Center",
  "checkedAt": "2026-11-25T02:00:00.000Z",
  "date": "2026-11-25",
  "thresholdIn": 1,
  "swath": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": { "type": "Polygon | MultiPolygon", "coordinates": [] },
        "properties": { "maxHailIn": 2.96 }
      }
    ]
  },
  "eventCount": 6,
  "message": "6 hail swath segment(s) from NOAA MRMS MESH in the last 1 day(s).",
  "note": "Estimated hail size, not confirmed damage"
}
```

Field names are verbatim — the web builder codes against them (see
`apps/web/src/features/roof/storms/api.ts` `SwathSchema`).

## Honesty labels

- MRMS is a **modeled radar estimate, not measured stones and not confirmed
  damage**: every `mrms_swath` response carries
  `note: 'Estimated hail size, not confirmed damage'`.
- The fallback is an **approximate path from reports, not a measured swath**:
  `note: 'Approximate path from NOAA storm reports — not a measured swath'`,
  and its message states the 5-mile buffer. Points are never presented as a path.
- No CAD parcel work is part of this feature: no county parcel fetching, no
  parcel matching.

## Deploy

`render.yaml` has a `curb-connect-swath-worker` service (runtime `python`,
mirroring the mailer entry): `pip install -r apps/swath-worker/requirements.txt`,
`python3 run.py`, health check `/health`, `SWATH_DATABASE_URL` from
`curb-connect-db`. Deploy order: API first (runs migration 0038), then the
worker. Free-plan services sleep after inactivity, so a strict 30-minute cadence
needs a paid instance (or an external pinger) to hold; until the worker's first
run, the endpoint serves the SPC fallback, and a down feed is `unavailable`.
