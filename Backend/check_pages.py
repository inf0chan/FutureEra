"""Checks every page's class usage against style.css, to catch styling
regressions after the career CSS block was replaced.

    Backend\\.venv\\Scripts\\python.exe check_pages.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent / "Frontend"
PAGES = ("index.html", "career.html", "creators.html")

css = (FRONTEND / "style.css").read_text(encoding="utf-8")

# every class selector defined anywhere in the stylesheet
defined = set(re.findall(r"\.([a-zA-Z][\w-]*)", css))

problems: list[str] = []

for name in PAGES:
    html = (FRONTEND / name).read_text(encoding="utf-8")

    # classes present in markup, plus any that appear inside a template literal
    used: set[str] = set()
    for m in re.findall(r'class="([^"]+)"', html):
        used.update(c for c in m.split() if c)
    for m in re.findall(r'class="[^"]*\$\{\s*([^}]+)\s*\}', html):
        used.add(m.strip())

    missing = sorted(c for c in used if c not in defined)
    if missing:
        problems.append(f"{name}: unstyled classes -> {', '.join(missing)}")
    print(f"{name:<14} {len(used):3d} classes used, {len(missing)} unstyled")

# GSAP / animation surface that must survive
js = (FRONTEND / "script.js").read_text(encoding="utf-8")
anim_classes = re.findall(r'toArray\("\.([\w-]+)"\)', js)
for c in dict.fromkeys(anim_classes):
    if c not in defined:
        problems.append(f'script.js animates ".{c}" but no CSS rule defines it')
print(
    "\nanimated selectors referenced in script.js: "
    + (", ".join(dict.fromkeys(anim_classes)) or "none")
)

if problems:
    print(f"\nPROBLEMS ({len(problems)}):")
    for p in problems:
        print("  - " + p)
    sys.exit(1)

print("\nOK - every page is fully styled")
