"""Worker entry point: dry-run end to end against a synthetic GRIB2 file.

No network, no database: --mesh-file parses the synthetic file and --dry-run
skips storing. A second test proves a missing database URL fails loudly in
store mode instead of silently doing nothing.
"""
from swath_worker.main import main, run_once
from fixture_grib import write_synthetic_grib


def test_dry_run_once_with_local_mesh_file(tmp_path):
    mesh_path = tmp_path / "synthetic.grib2"
    write_synthetic_grib(mesh_path)
    result = run_once(None, mesh_path=str(mesh_path), dry_run=True)
    assert result.stored is False
    assert result.build.swath_date == "2026-11-24"
    assert result.build.cell_count == 2
    assert len(result.build.features) == 1
    assert result.build.features[0].max_hail_in == 1.61
    # The CLI path exits 0 for the same run.
    assert main(["--once", "--dry-run", "--mesh-file", str(mesh_path)]) == 0


def test_once_without_database_url_fails_loudly(tmp_path):
    mesh_path = tmp_path / "synthetic.grib2"
    write_synthetic_grib(mesh_path)
    rc = main(["--once", "--mesh-file", str(mesh_path)])
    assert rc == 1
