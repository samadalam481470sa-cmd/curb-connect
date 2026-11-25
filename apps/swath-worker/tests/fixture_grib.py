"""Build a tiny synthetic MESH-like GRIB2 file with the eccodes writer.

Used by test_mesh.py (parse round-trip) and test_main.py (dry-run end to end).
No network, no fixture files: the grid is 4x3 over a small patch of Texas.
"""
from __future__ import annotations

import numpy as np
from eccodes import (
    codes_clone,
    codes_grib_new_from_samples,
    codes_release,
    codes_set,
    codes_set_values,
    codes_write,
)

# Values in mm: one 1.61" cell (40.8), one 1.00" cell (25.4), one just-below (25.3),
# one no-data flag (-1), the rest 0.
VALUES = np.array(
    [
        [0.0, 0.0, 0.0, 0.0],
        [0.0, 40.8, 25.4, 0.0],
        [0.0, 25.3, -1.0, 0.0],
    ],
    dtype=np.float64,
)


def write_synthetic_grib(path) -> None:
    gid = codes_grib_new_from_samples("regular_ll_sfc_grib2")
    try:
        codes_set(gid, "Ni", 4)
        codes_set(gid, "Nj", 3)
        codes_set(gid, "latitudeOfFirstGridPointInDegrees", 33.0)
        codes_set(gid, "longitudeOfFirstGridPointInDegrees", -97.0)
        codes_set(gid, "latitudeOfLastGridPointInDegrees", 32.98)
        codes_set(gid, "longitudeOfLastGridPointInDegrees", -96.97)
        codes_set(gid, "iDirectionIncrementInDegrees", 0.01)
        codes_set(gid, "jDirectionIncrementInDegrees", 0.01)
        codes_set(gid, "jScansPositively", 0)
        codes_set(gid, "dataDate", 20261124)
        codes_set(gid, "dataTime", 1330)
        codes_set_values(gid, VALUES.flatten())
        with open(path, "wb") as f:
            codes_write(gid, f)
    finally:
        codes_release(gid)
