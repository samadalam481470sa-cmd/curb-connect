#!/usr/bin/env python3
"""Run the swath worker from the repo root of this service.

Adds src/ to the path so `python run.py` works without installing the package:
    cd apps/swath-worker && pip install -r requirements.txt && python run.py --once --dry-run
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from swath_worker.main import main

if __name__ == "__main__":
    raise SystemExit(main())
