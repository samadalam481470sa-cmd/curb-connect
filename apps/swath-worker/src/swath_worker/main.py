"""Swath worker entry point.

One pass (``--once``): fetch the latest NOAA MRMS MESH Max 1440min file, parse the
GRIB2 grid, threshold cells at/above 1.00 inch, build the day's hail-path polygons,
and upsert them into ``public.roof_swaths``. Default mode loops that pass every
``SWATH_INTERVAL_MINUTES`` (30) and serves ``GET /health`` — the Render service
runs it exactly like the mailer service (own web service, own health check).

``--dry-run`` fetches, parses, and builds but never touches the database.
``--mesh-file`` parses a local ``.grib2`` instead of downloading (parser testing).
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .config import load_config, require_database_url
from .mesh import SwathBuild, fetch_and_build
from .store import connect, upsert_swath

log = logging.getLogger("swath-worker")


@dataclass
class WorkerState:
    last_run_at: str | None = None
    last_ok: bool | None = None
    last_error: str | None = None
    last_swath_date: str | None = None
    last_features: int | None = None
    last_cells: int | None = None


@dataclass
class RunResult:
    build: SwathBuild
    stored: bool


def run_once(
    database_url: str | None,
    *,
    mesh_path: str | None = None,
    mesh_base_url: str | None = None,
    work_dir: str | None = None,
    dry_run: bool = False,
) -> RunResult:
    """Fetch, parse, build, and (unless dry-run) store one swath."""
    from .mesh import MRMS_BASE_URL

    build = fetch_and_build(
        work_dir=work_dir,
        base_url=mesh_base_url or MRMS_BASE_URL,
        mesh_path=Path(mesh_path) if mesh_path else None,
    )
    log.info(
        "swath %s: %d feature(s) from %d cell(s) >= 1.00 in (source %s)",
        build.swath_date,
        len(build.features),
        build.cell_count,
        build.source_file,
    )
    for feature in build.features:
        log.info("  segment maxHailIn=%.2f in", feature.max_hail_in)
    if dry_run:
        return RunResult(build=build, stored=False)
    if database_url is None:
        raise ValueError(
            "SWATH_DATABASE_URL is not set. Set it or run with --dry-run to skip storing."
        )
    conn = connect(database_url)
    try:
        upsert_swath(conn, build)
        conn.commit()
    finally:
        conn.close()
    return RunResult(build=build, stored=True)


def make_health_handler(state: WorkerState):
    """GET /health: liveness plus the last run's outcome (never any secrets)."""

    class HealthHandler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - stdlib handler name
            if self.path != "/health":
                self.send_response(404)
                self.end_headers()
                return
            payload = {
                "status": "ok" if state.last_ok is not False else "error",
                "lastRunAt": state.last_run_at,
                "lastOk": state.last_ok,
                "lastError": state.last_error,
                "lastSwathDate": state.last_swath_date,
                "lastFeatures": state.last_features,
                "lastCells": state.last_cells,
            }
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):  # noqa: D102 - silence stdlib access logs
            return

    return HealthHandler


def serve_forever(config, state: WorkerState) -> threading.Thread:
    """Health endpoint in a daemon thread; the main thread runs the fetch loop."""
    server = ThreadingHTTPServer((config.host, config.port), make_health_handler(state))
    thread = threading.Thread(target=server.serve_forever, name="swath-health", daemon=True)
    thread.start()
    log.info("health endpoint listening on %s:%d", config.host, config.port)
    return thread


def loop(config, *, dry_run: bool = False) -> None:
    """Fetch-store loop: run now, then every SWATH_INTERVAL_MINUTES."""
    state = WorkerState()
    serve_forever(config, state)
    database_url = None if dry_run else require_database_url(config)
    while True:
        try:
            result = run_once(
                database_url,
                mesh_base_url=config.mesh_base_url,
                work_dir=config.work_dir,
                dry_run=dry_run,
            )
            state.last_run_at = datetime.now(timezone.utc).isoformat()
            state.last_ok = True
            state.last_error = None
            state.last_swath_date = result.build.swath_date
            state.last_features = len(result.build.features)
            state.last_cells = result.build.cell_count
        except Exception as error:  # one bad run must not kill the loop
            state.last_run_at = datetime.now(timezone.utc).isoformat()
            state.last_ok = False
            state.last_error = str(error)[:300]
            log.exception("swath run failed: %s", error)
        time.sleep(config.interval_minutes * 60)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Run one pass, then exit.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and build, do not store.")
    parser.add_argument("--mesh-file", help="Parse a local .grib2 file instead of downloading.")
    args = parser.parse_args(argv)
    try:
        config = load_config()
    except ValueError as error:
        print(f"Invalid swath worker configuration: {error}", file=sys.stderr)
        return 2
    if args.once:
        try:
            database_url = None if args.dry_run else require_database_url(config)
            run_once(
                database_url,
                mesh_path=args.mesh_file,
                mesh_base_url=config.mesh_base_url,
                work_dir=config.work_dir,
                dry_run=args.dry_run,
            )
        except Exception as error:
            log.exception("swath run failed: %s", error)
            return 1
        return 0
    loop(config, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
