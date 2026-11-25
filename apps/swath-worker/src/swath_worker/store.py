"""Store one day's built swath in ``public.roof_swaths`` (migration 0038).

One row per UTC day (``swath_date`` is the primary key); a re-run upserts the same
row, so the 30-minute cadence never duplicates days. A quiet day still stores a
row with an empty features list so the API can tell "checked, no hail" apart
from "never run".
"""
from __future__ import annotations

import json
from typing import Any, Protocol

from .mesh import SwathBuild

UPSERT_SWATH_SQL = """
INSERT INTO public.roof_swaths
  (swath_date, source, source_file, source_valid_at, threshold_in,
   features, feature_count, cell_count, checked_at)
VALUES
  (%s, 'NOAA MRMS MESH Max 1440min', %s, %s, 1.00, %s::jsonb, %s, %s, %s)
ON CONFLICT (swath_date) DO UPDATE SET
  source_file = EXCLUDED.source_file,
  source_valid_at = EXCLUDED.source_valid_at,
  threshold_in = EXCLUDED.threshold_in,
  features = EXCLUDED.features,
  feature_count = EXCLUDED.feature_count,
  cell_count = EXCLUDED.cell_count,
  checked_at = EXCLUDED.checked_at,
  revision = public.roof_swaths.revision + 1,
  updated_at = now()
"""


class Connection(Protocol):
    """Minimal psycopg connection surface the worker needs (lets tests fake it)."""

    def cursor(self) -> Any: ...

    def commit(self) -> None: ...

    def close(self) -> None: ...


def connect(database_url: str) -> Connection:
    """Open the owner database connection (psycopg, same URL the API uses)."""
    import psycopg

    return psycopg.connect(database_url, connect_timeout=15)


def upsert_swath(conn: Connection, build: SwathBuild) -> None:
    """Write one built swath. The caller commits (and closes) the connection."""
    features_json = json.dumps([f.to_geojson() for f in build.features])
    params = (
        build.swath_date,
        build.source_file,
        build.source_valid_at,
        features_json,
        len(build.features),
        build.cell_count,
        build.checked_at,
    )
    with conn.cursor() as cur:
        cur.execute(UPSERT_SWATH_SQL, params)
