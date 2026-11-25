"""Threshold + polygon building (synthetic grids) and GRIB2 parsing.

No network: grids are built in memory, and the GRIB2 round-trip uses a small
synthetic file written by the eccodes writer (tests/fixture_grib.py). The real
downloaded MRMS file is exercised only when SWATH_TEST_MESH_FILE points at one.
"""
import gzip
import os
from datetime import datetime, timezone

import numpy as np
import pytest

from fixture_grib import VALUES, write_synthetic_grib
from swath_worker.mesh import (
    build_swath,
    cells_to_features,
    gzip_inner_filename,
    MeshGrid,
    parse_mesh,
    threshold_cells,
    THRESHOLD_MM,
    valid_at_from_filename,
)


def make_grid(values, lat_first=33.0, lon_first=-97.0):
    arr = np.asarray(values, dtype=np.float64)
    nj, ni = arr.shape
    return MeshGrid(
        ni=ni,
        nj=nj,
        lat_first=lat_first,
        lon_first=lon_first,
        dlat=0.01,
        dlon=0.01,
        values=arr,
        valid_at=datetime(2026, 11, 24, 13, 30, tzinfo=timezone.utc),
        source_file="test.grib2",
    )


def test_threshold_boundary_and_no_data_flags():
    grid = make_grid([[0.0, 25.3, 25.4, 40.8, -1.0, -3.0, 9999.0]])
    cells = threshold_cells(grid)
    # Exactly at the threshold counts; just below, every negative flag, and the
    # GRIB missing value (9999) do not — 9999 would otherwise read as fake hail.
    assert [(j, i) for j, i, _ in cells] == [(0, 2), (0, 3)]
    assert cells[0][2] == pytest.approx(25.4)
    assert cells[1][2] == pytest.approx(40.8)


def test_threshold_constant_is_one_inch():
    assert THRESHOLD_MM == pytest.approx(25.4)


def test_adjacent_cells_form_one_feature_with_max_hail():
    grid = make_grid(
        [
            [0.0, 0.0, 0.0],
            [0.0, 40.8, 25.4],
            [0.0, 0.0, 0.0],
        ]
    )
    features = cells_to_features(threshold_cells(grid), grid)
    assert len(features) == 1
    feature = features[0]
    assert feature.geometry["type"] == "Polygon"
    assert feature.max_hail_in == pytest.approx(40.8 / 25.4, abs=0.01)
    geojson = feature.to_geojson()
    assert geojson["properties"]["maxHailIn"] == feature.max_hail_in
    # Polygon ring is closed and in (lon, lat) order, around the two cells.
    ring = geojson["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1]
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    assert min(lons) == pytest.approx(-96.995)
    assert max(lons) == pytest.approx(-96.975)
    assert min(lats) == pytest.approx(32.985)
    assert max(lats) == pytest.approx(32.995)


def test_adjacent_cells_at_real_grid_longitudes_merge():
    # Regression: raw float64 grid math leaves ~1e-14 gaps between neighbouring
    # cells at real MRMS longitudes (-129.995 + 6182 * 0.01), so unary_union kept
    # them as separate squares until box edges were snapped to 4 decimals.
    # (The live 2026-11-25 file's 3-cell Maine cluster came back as a MultiPolygon
    # of 3 squares before the fix.)
    values = np.zeros((1, 7000), dtype=np.float64)
    values[0, 6182] = 39.2
    values[0, 6183] = 59.9
    values[0, 6184] = 75.1
    grid = make_grid(values, lat_first=45.55, lon_first=-129.995)
    features = cells_to_features(threshold_cells(grid), grid)
    assert len(features) == 1
    assert features[0].geometry["type"] == "Polygon"
    assert features[0].max_hail_in == pytest.approx(75.1 / 25.4, abs=0.01)


def test_separated_cells_form_separate_features_sorted_by_size():
    grid = make_grid(
        [
            [25.4, 0.0, 0.0, 0.0, 75.1],
            [0.0, 0.0, 0.0, 0.0, 0.0],
        ]
    )
    features = cells_to_features(threshold_cells(grid), grid)
    assert len(features) == 2
    assert [f.max_hail_in for f in features] == pytest.approx(
        [75.1 / 25.4, 25.4 / 25.4], abs=0.01
    )


def test_diagonal_cells_do_not_connect():
    grid = make_grid(
        [
            [40.8, 0.0],
            [0.0, 40.8],
        ]
    )
    assert len(cells_to_features(threshold_cells(grid), grid)) == 2


def test_no_cells_means_no_features():
    grid = make_grid([[0.0, 12.7, -1.0]])
    assert cells_to_features(threshold_cells(grid), grid) == []
    build = build_swath(grid)
    assert build.features == []
    assert build.cell_count == 0
    assert build.swath_date == "2026-11-24"


def test_build_swath_counts_cells_and_dates_by_validity():
    grid = make_grid(VALUES)
    build = build_swath(grid)
    assert build.cell_count == 2
    assert len(build.features) == 1  # the two qualifying cells are adjacent
    assert build.features[0].max_hail_in == pytest.approx(1.61, abs=0.01)
    assert build.source_file == "test.grib2"


def test_valid_at_from_filename():
    assert valid_at_from_filename(
        "MRMS_MESH_Max_1440min_00.50_20261125-013000.grib2.gz"
    ) == datetime(2026, 11, 25, 1, 30, tzinfo=timezone.utc)
    assert valid_at_from_filename("MRMS_MESH_Max_1440min.latest.grib2.gz") is None


def test_gzip_inner_filename(tmp_path):
    gz_path = tmp_path / "member.grib2.gz"
    with gzip.GzipFile(filename="MRMS_MESH_Max_1440min_00.50_20261125-013000.grib2", mode="wb", fileobj=open(gz_path, "wb")) as gz:
        gz.write(b"GRIB")
    assert (
        gzip_inner_filename(gz_path)
        == "MRMS_MESH_Max_1440min_00.50_20261125-013000.grib2"
    )


def test_parse_synthetic_grib_round_trip(tmp_path):
    path = tmp_path / "synthetic.grib2"
    write_synthetic_grib(path)
    grid = parse_mesh(path)
    assert (grid.ni, grid.nj) == (4, 3)
    assert grid.lat_first == pytest.approx(33.0)
    assert grid.lon_first == pytest.approx(-97.0)
    assert grid.dlat == pytest.approx(0.01)
    assert grid.valid_at == datetime(2026, 11, 24, 13, 30, tzinfo=timezone.utc)
    assert grid.values.shape == (3, 4)
    assert grid.values[1, 1] == pytest.approx(40.8)
    assert grid.values[2, 2] == pytest.approx(-1.0)
    assert len(threshold_cells(grid)) == 2


@pytest.mark.skipif(
    not os.environ.get("SWATH_TEST_MESH_FILE"),
    reason="Set SWATH_TEST_MESH_FILE to a downloaded MRMS .grib2 to run the live-file check.",
)
def test_parse_real_mrms_file():
    """Structural check against a real downloaded file (not committed to the repo)."""
    grid = parse_mesh(os.environ["SWATH_TEST_MESH_FILE"])
    assert (grid.ni, grid.nj) == (7000, 3500)
    assert grid.lat_first == pytest.approx(54.995)
    assert grid.lon_first == pytest.approx(-129.995)
    assert grid.dlat == pytest.approx(0.01)
    assert grid.dlon == pytest.approx(0.01)
    cells = threshold_cells(grid)
    assert len(cells) >= 1
    build = build_swath(grid)
    assert build.cell_count == len(cells)
    assert all(f.max_hail_in >= 1.0 for f in build.features)
