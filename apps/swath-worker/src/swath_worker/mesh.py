"""NOAA MRMS MESH Max 1440min: fetch, parse, threshold, and polygonize.

Source: https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/ — trailing-24h maximum
estimated hail size (MESH, in millimetres) on a ~1 km (0.01 degree) regular
lat/lon grid over CONUS, one ``.grib2.gz`` file every 30 minutes plus a
``MRMS_MESH_Max_1440min.latest.grib2.gz`` symlink to the newest file. Free, no key.

The directory only keeps about the last 24 hours of files, so the worker keeps the
app's own copy: each run stores one row per UTC day in ``public.roof_swaths``.

GRIB2 parsing needs the ``eccodes`` package (``pip install eccodes`` — it ships
bundled binary wheels, no system ecCodes install needed). Values below zero are
MRMS no-data flags (observed -1 and -3 in the live file) and are never hail.
"""
from __future__ import annotations

import gzip
import re
import shutil
import tempfile
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

try:
    from eccodes import codes_get, codes_get_values, codes_grib_new_from_file, codes_release
except ImportError as _eccodes_error:  # pragma: no cover - exercised by the import guard test
    codes_get = None  # type: ignore[assignment]
    _ECCODES_IMPORT_ERROR = _eccodes_error
else:
    _ECCODES_IMPORT_ERROR = None

from shapely.geometry import box
from shapely.ops import unary_union

MRMS_BASE_URL = "https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/"
LATEST_FILENAME = "MRMS_MESH_Max_1440min.latest.grib2.gz"
# MRMS_MESH_Max_1440min_00.50_20261125-013000.grib2.gz — the timestamp is the file's validity time.
TIMESTAMPED_FILENAME_RE = re.compile(
    r"MRMS_MESH_Max_1440min_00\.50_(\d{8})-(\d{6})\.grib2(\.gz)?$"
)

#: Severe-hail threshold in millimetres (1.00 inch = 25.4 mm). Must match
#: SWATH_THRESHOLD_IN in apps/api/src/modules/roofStorms/swath.ts.
THRESHOLD_MM = 25.4
MM_PER_INCH = 25.4


def require_eccodes() -> None:
    """Fail fast with an actionable message when the GRIB2 reader is missing."""
    if _ECCODES_IMPORT_ERROR is not None:
        raise RuntimeError(
            "The 'eccodes' Python package is required to read MRMS GRIB2 files: "
            "pip install -r requirements.txt (it ships bundled binary wheels)."
        ) from _ECCODES_IMPORT_ERROR


@dataclass
class MeshGrid:
    """One decoded MESH grid: values in mm, rows run north to south."""

    ni: int
    nj: int
    lat_first: float  # latitude of row 0 (northern edge)
    lon_first: float  # longitude of column 0, normalized to -180..180
    dlat: float  # positive degree step between rows
    dlon: float  # positive degree step between columns
    values: np.ndarray  # shape (nj, ni), mm; negative = MRMS no-data flag
    valid_at: datetime  # validity time of the file (UTC)
    source_file: str = ""
    missing_value: float = 9999.0  # GRIB missing value: never hail, never stored

    def lat_of_row(self, j: int) -> float:
        return self.lat_first - j * self.dlat

    def lon_of_col(self, i: int) -> float:
        return self.lon_first + i * self.dlon


@dataclass
class SwathFeature:
    """One GeoJSON hail-path feature (matches the API's RoofSwathFeature shape)."""

    geometry: dict
    max_hail_in: float

    def to_geojson(self) -> dict:
        return {
            "type": "Feature",
            "geometry": self.geometry,
            "properties": {"maxHailIn": self.max_hail_in},
        }


@dataclass
class SwathBuild:
    """Everything one worker run stores for one UTC day."""

    swath_date: str  # UTC date of the file's validity time
    source_file: str
    source_valid_at: datetime
    checked_at: datetime
    features: list[SwathFeature] = field(default_factory=list)
    cell_count: int = 0


def valid_at_from_filename(filename: str) -> datetime | None:
    """Validity time from a timestamped MRMS filename, or None for `latest`."""
    match = TIMESTAMPED_FILENAME_RE.search(filename)
    if not match:
        return None
    return datetime.strptime(match.group(1) + match.group(2), "%Y%m%d%H%M%S").replace(
        tzinfo=timezone.utc
    )


def gzip_inner_filename(gz_path: str | Path) -> str:
    """Original filename stored in a gzip member's FNAME header field ('' if none).

    The MRMS `latest` symlink downloads as a gzip whose member name is the
    timestamped file — that name is what validity dating uses.
    """
    with open(gz_path, "rb") as f:
        header = f.read(10)
    if len(header) < 10 or header[0:2] != b"\x1f\x8b":
        return ""
    flags = header[3]
    if not flags & 0x08:  # FNAME not present
        return ""
    with open(gz_path, "rb") as f:
        f.seek(10)
        if flags & 0x04:  # FEXTRA: skip it (2-byte length + payload)
            extra_len = int.from_bytes(f.read(2), "little")
            f.seek(extra_len, 1)
        name = bytearray()
        while True:
            byte = f.read(1)
            if not byte or byte == b"\x00":
                break
            name += byte
    return name.decode("utf-8", "replace")


def fetch_latest_mesh(dest_dir: str | Path, base_url: str = MRMS_BASE_URL) -> Path:
    """Download the latest MESH file and gunzip it. Returns the ``.grib2`` path.

    The gzip member's original filename is the timestamped name (the `latest`
    symlink's target), which is what validity dating and the stored
    ``source_file`` come from.
    """
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    gz_path = dest / LATEST_FILENAME
    request = urllib.request.Request(
        base_url.rstrip("/") + "/" + LATEST_FILENAME,
        headers={"User-Agent": "FieldPro-swath-worker/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response, open(gz_path, "wb") as out:
        shutil.copyfileobj(response, out)
    inner_name = gzip_inner_filename(gz_path)
    grib_path = dest / (inner_name or "MRMS_MESH_Max_1440min.grib2")
    with gzip.open(gz_path, "rb") as gz, open(grib_path, "wb") as out:
        shutil.copyfileobj(gz, out)
    return grib_path


def parse_mesh(path: str | Path, source_file: str = "") -> MeshGrid:
    """Decode one MESH GRIB2 file into a lat/lon grid of millimetres."""
    require_eccodes()
    path = Path(path)
    with open(path, "rb") as f:
        gid = codes_grib_new_from_file(f)
        if gid is None:
            raise ValueError(f"No GRIB message found in {path}")
        try:
            ni = int(codes_get(gid, "Ni"))
            nj = int(codes_get(gid, "Nj"))
            lat_first = float(codes_get(gid, "latitudeOfFirstGridPointInDegrees"))
            lon_first = float(codes_get(gid, "longitudeOfFirstGridPointInDegrees"))
            dlat = abs(float(codes_get(gid, "jDirectionIncrementInDegrees")))
            dlon = abs(float(codes_get(gid, "iDirectionIncrementInDegrees")))
            j_scans_positive = bool(codes_get(gid, "jScansPositively"))
            data_date = int(codes_get(gid, "dataDate"))
            data_time = int(codes_get(gid, "dataTime"))
            try:
                missing_value = float(codes_get(gid, "missingValue"))
            except Exception:
                missing_value = 9999.0
            raw = np.asarray(codes_get_values(gid), dtype=np.float64)
        finally:
            codes_release(gid)
    if lon_first > 180:
        lon_first -= 360
    # Rows run south when the grid does not scan positively (the live MRMS file);
    # flip so row 0 is always the northern edge.
    values = raw.reshape((nj, ni))
    if j_scans_positive:
        values = np.flipud(values)
    valid_at = datetime.strptime(f"{data_date:08d}{data_time:04d}", "%Y%m%d%H%M").replace(
        tzinfo=timezone.utc
    )
    return MeshGrid(
        ni=ni,
        nj=nj,
        lat_first=lat_first,
        lon_first=lon_first,
        dlat=dlat,
        dlon=dlon,
        values=values,
        valid_at=valid_at,
        source_file=source_file or path.name,
        missing_value=missing_value,
    )


def threshold_cells(grid: MeshGrid, threshold_mm: float = THRESHOLD_MM) -> list[tuple[int, int, float]]:
    """Grid cells at/above the hail threshold: (row, col, MESH mm), north to south.

    Negative values are MRMS no-data flags, not hail, and are excluded; so is the
    GRIB missing value (9999 in the live file), which would otherwise read as
    enormous fake hail.
    """
    valid = (
        (grid.values >= 0)
        & (grid.values >= threshold_mm)
        & (grid.values != grid.missing_value)
    )
    rows, cols = np.where(valid)
    return [
        (int(j), int(i), float(grid.values[j, i])) for j, i in zip(rows.tolist(), cols.tolist())
    ]


def _round_coord(value: float) -> float:
    # The grid is 0.01 deg; cell edges sit at x.xxx5, so 4 decimals keeps them exact
    # while keeping the stored GeoJSON small.
    return round(float(value), 4)


def _geometry_to_geojson(geometry) -> dict:
    """Shapely Polygon/MultiPolygon -> GeoJSON geometry dict (lon, lat order)."""
    kind = geometry.geom_type
    if kind == "Polygon":
        rings = [
            [[_round_coord(x), _round_coord(y)] for x, y in ring.coords]
            for ring in [geometry.exterior, *geometry.interiors]
        ]
        return {"type": "Polygon", "coordinates": rings}
    if kind == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [
                [
                    [[_round_coord(x), _round_coord(y)] for x, y in ring.coords]
                    for ring in [part.exterior, *part.interiors]
                ]
                for part in geometry.geoms
            ],
        }
    raise ValueError(f"Unexpected swath geometry type: {kind}")


def cells_to_features(
    cells: list[tuple[int, int, float]],
    grid: MeshGrid,
    threshold_mm: float = THRESHOLD_MM,
) -> list[SwathFeature]:
    """Threshold cells -> one GeoJSON feature per connected hail area.

    Cells are 4-connected (sharing an edge) into components; each component's
    cell squares are unioned into a single Polygon/MultiPolygon whose
    ``maxHailIn`` is the largest MESH value in that component, in inches.
    """
    if not cells:
        return []
    half_lat = grid.dlat / 2
    half_lon = grid.dlon / 2
    cell_set = {(j, i) for j, i, _ in cells}
    values = {(j, i): v for j, i, v in cells}
    seen: set[tuple[int, int]] = set()
    features: list[SwathFeature] = []
    for start in sorted(cell_set):
        if start in seen:
            continue
        # Flood-fill one 4-connected component.
        component: list[tuple[int, int]] = []
        stack = [start]
        seen.add(start)
        while stack:
            cell = stack.pop()
            component.append(cell)
            j, i = cell
            for neighbour in ((j - 1, i), (j + 1, i), (j, i - 1), (j, i + 1)):
                if neighbour in cell_set and neighbour not in seen:
                    seen.add(neighbour)
                    stack.append(neighbour)
        # Snap every box edge to 4 decimals: raw float64 grid math leaves ~1e-14
        # gaps between neighbouring cells, and unary_union only merges boxes whose
        # shared edge is exactly equal. Without this, adjacent cells stay separate.
        boxes = [
            box(
                _round_coord(grid.lon_of_col(i) - half_lon),
                _round_coord(grid.lat_of_row(j) - half_lat),
                _round_coord(grid.lon_of_col(i) + half_lon),
                _round_coord(grid.lat_of_row(j) + half_lat),
            )
            for j, i in component
        ]
        merged = unary_union(boxes)
        max_mm = max(values[cell] for cell in component)
        features.append(
            SwathFeature(
                geometry=_geometry_to_geojson(merged),
                max_hail_in=round(max_mm / MM_PER_INCH, 2),
            )
        )
    features.sort(key=lambda f: f.max_hail_in, reverse=True)
    return features


def build_swath(grid: MeshGrid, checked_at: datetime | None = None) -> SwathBuild:
    """Threshold one decoded grid and build the day's stored swath."""
    cells = threshold_cells(grid)
    features = cells_to_features(cells, grid)
    now = checked_at or datetime.now(timezone.utc)
    return SwathBuild(
        swath_date=grid.valid_at.date().isoformat(),
        source_file=grid.source_file,
        source_valid_at=grid.valid_at,
        checked_at=now,
        features=features,
        cell_count=len(cells),
    )


def fetch_and_build(
    work_dir: str | Path | None = None,
    base_url: str = MRMS_BASE_URL,
    mesh_path: str | Path | None = None,
) -> SwathBuild:
    """One worker pass: fetch the latest file (or parse a local one) and build the swath."""
    if mesh_path is not None:
        grid = parse_mesh(mesh_path)
    else:
        tmp = Path(work_dir) if work_dir else Path(tempfile.mkdtemp(prefix="swath-worker-"))
        grib_path = fetch_latest_mesh(tmp, base_url)
        # The timestamped name lives in the gzip header; prefer it for dating.
        grid = parse_mesh(grib_path, source_file=grib_path.name)
        valid_from_name = valid_at_from_filename(grib_path.name)
        if valid_from_name is not None:
            grid.valid_at = valid_from_name
    return build_swath(grid)
