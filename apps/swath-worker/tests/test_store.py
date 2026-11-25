"""Storage upsert (fake connection — no database) and config validation."""
import json

import pytest

from swath_worker.config import load_config
from swath_worker.mesh import SwathBuild, SwathFeature
from swath_worker.store import UPSERT_SWATH_SQL, upsert_swath
from datetime import datetime, timezone


class FakeCursor:
    def __init__(self):
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params):
        self.executed.append((sql, params))


class FakeConnection:
    def __init__(self):
        self.cursor_obj = FakeCursor()
        self.committed = False
        self.closed = False

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.committed = True

    def close(self):
        self.closed = True


def make_build():
    return SwathBuild(
        swath_date="2026-11-25",
        source_file="MRMS_MESH_Max_1440min_00.50_20261125-013000.grib2",
        source_valid_at=datetime(2026, 11, 25, 1, 30, tzinfo=timezone.utc),
        checked_at=datetime(2026, 11, 25, 2, 0, tzinfo=timezone.utc),
        features=[
            SwathFeature(
                geometry={"type": "Polygon", "coordinates": [[[-92.64, 34.32], [-92.6, 34.32], [-92.6, 34.36], [-92.64, 34.36], [-92.64, 34.32]]]},
                max_hail_in=1.61,
            )
        ],
        cell_count=8,
    )


def test_upsert_writes_one_row_per_day_with_on_conflict():
    conn = FakeConnection()
    upsert_swath(conn, make_build())
    assert len(conn.cursor_obj.executed) == 1
    sql, params = conn.cursor_obj.executed[0]
    assert "ON CONFLICT (swath_date) DO UPDATE" in sql
    assert "public.roof_swaths" in sql
    assert params[0] == "2026-11-25"  # swath_date
    assert params[1].endswith("20261125-013000.grib2")  # source_file
    features = json.loads(params[3])
    assert features[0]["properties"]["maxHailIn"] == 1.61
    assert features[0]["geometry"]["type"] == "Polygon"
    assert params[4] == 1  # feature_count
    assert params[5] == 8  # cell_count
    # The upsert never commits itself: the caller owns the transaction.
    assert conn.committed is False


def test_upsert_sql_text_is_stable():
    assert "threshold_in" in UPSERT_SWATH_SQL
    assert "revision = public.roof_swaths.revision + 1" in UPSERT_SWATH_SQL


def test_config_defaults():
    config = load_config({})
    assert config.mesh_base_url.startswith("https://mrms.ncep.noaa.gov/")
    assert config.interval_minutes == 30
    assert config.port == 4310
    assert config.database_url is None


def test_config_rejects_bad_interval():
    with pytest.raises(ValueError, match="SWATH_INTERVAL_MINUTES"):
        load_config({"SWATH_INTERVAL_MINUTES": "1"})
    with pytest.raises(ValueError, match="SWATH_INTERVAL_MINUTES"):
        load_config({"SWATH_INTERVAL_MINUTES": "soon"})


def test_config_prefers_swath_port_over_port():
    config = load_config({"PORT": "10000", "SWATH_PORT": "4310"})
    assert config.port == 4310
    assert load_config({"PORT": "10000"}).port == 10000
