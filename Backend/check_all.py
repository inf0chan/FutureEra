"""Runs every check in this folder, in order, and stops at the first failure.

    Backend\\.venv\\Scripts\\python.exe check_all.py

Stdlib only, so it needs nothing installed beyond Python itself.
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

CHECKS = (
    ("career data", "check_data.py"),
    ("page styling", "check_pages.py"),
    ("static references", "check_static.py"),
    ("animations", "check_anim.py"),
)

failed: list[str] = []
started = time.perf_counter()

for title, script in CHECKS:
    # flush, or these headers land after the child's output once the pipe buffers
    print(f"\n{'=' * 68}\n  {title}  ({script})\n{'=' * 68}", flush=True)
    result = subprocess.run([sys.executable, str(HERE / script)], cwd=HERE)
    if result.returncode != 0:
        failed.append(script)

elapsed = time.perf_counter() - started

print(f"\n{'=' * 68}", flush=True)
if failed:
    print(f"  FAILED: {', '.join(failed)}   ({elapsed:.1f}s)")
    sys.exit(1)
print(f"  All {len(CHECKS)} checks passed   ({elapsed:.1f}s)")
print("=" * 68)
