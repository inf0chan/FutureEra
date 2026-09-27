"""Static cross-reference check: HTML/JS class + id usage vs CSS selectors, and
dead references. Lives in Backend/ and reads the site from ../Frontend.

    Backend\\.venv\\Scripts\\python.exe check_static.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parent / "Frontend"
PAGES = ("index.html", "career.html", "creators.html")

# The career data moved out of Frontend/ and is served by this backend now, so
# the data is read from here - the same file the API loads.
DATA_FILE = HERE / "data" / "career_data.json"

html = (FRONTEND / "career.html").read_text(encoding="utf-8")
js = (FRONTEND / "script.js").read_text(encoding="utf-8")
css = (FRONTEND / "style.css").read_text(encoding="utf-8")
D = json.loads(DATA_FILE.read_text(encoding="utf-8"))

problems: list[str] = []
notes: list[str] = []


def slice_element(source: str, marker: str, tag: str = "div") -> str:
    """Return the whole element containing marker, balancing nested tags.

    A non-greedy regex cannot do this: the group divs hold nested divs, so the
    first </div> found is not the end of the group.
    """
    start = source.find(marker)
    if start == -1:
        return ""
    # the id sits inside the opening tag, so search backwards for that tag
    earlier = list(re.finditer(rf"<{tag}\b", source[:start]))
    if not earlier:
        return ""
    begin = earlier[-1].start()
    depth = 0
    for m in re.finditer(rf"</?{tag}\b", source[begin:]):
        depth += -1 if m.group(0).startswith("</") else 1
        if depth == 0:
            return source[begin : begin + m.end()]
    return source[begin:]


# ---- CSS class selectors defined ----
css_classes = set(re.findall(r"\.([a-zA-Z][\w-]*)", css))

# ---- classes used in static HTML ----
html_classes: set[str] = set()
for m in re.findall(r'class="([^"]+)"', html):
    html_classes.update(c for c in m.split() if c)

# ---- classes created at runtime in script.js ----
js_classes: set[str] = set()
for m in re.findall(r"className\s*=\s*'([^']+)'", js):
    js_classes.update(c for c in m.split() if c)
js_classes.update(re.findall(r"classList\.(?:add|toggle|remove)\('([^']+)'", js))
for m in re.findall(r'class="([^"]+)"', js):
    js_classes.update(c for c in m.split() if c)

used_classes = html_classes | js_classes
for c in sorted(used_classes):
    if c not in css_classes:
        problems.append(f'class "{c}" used but never styled')

# ---- ids referenced by script.js must exist in career.html ----
html_ids = set(re.findall(r'id="([^"]+)"', html))
for m in re.findall(r"getElementById\('([^']+)'\)", js):
    if m not in html_ids:
        problems.append(f"script.js getElementById('{m}') but no such id in career.html")

# ---- ids referenced by CSS must exist ----
for m in re.finditer(r"#([a-zA-Z][\w-]*)", css):
    ident = m.group(1)
    if re.fullmatch(r"[0-9a-fA-F]{3,8}", ident):  # a colour
        continue
    if ident in html_ids:
        continue
    notes.append(f"css references #{ident}, not an id in career.html (may be on another page)")

# ---- anything left over from the old quiz? ----
for needle in (
    "quiz__option", "quiz-index", "quiz-total", "quiz-bar", "quiz-back", "quiz-restart",
    "career-tracks", "data-track", 'class="track"', "quiz__steps", "result-title",
    "result-tag", ".track", "three questions", "3 questions",
):
    for label, source in (("career.html", html), ("script.js", js), ("style.css", css)):
        if needle in source:
            problems.append(f"{label} still contains old quiz markup: \"{needle}\"")

# the old PATHS constant specifically, not CAREER_PATHS
for needle in ("const PATHS", "PATHS[", "PATHS."):
    if needle in js:
        problems.append(f'script.js still references the old quiz data: "{needle}"')

# ---- every link target in career.html exists ----
for href in re.findall(r'href="([^"#][^"]*)"', html):
    if href.startswith(("http:", "https:")):
        continue
    if not (FRONTEND / href.split("#")[0]).exists():
        problems.append(f"career.html links to missing file: {href}")

# ---- script load order ----
# career-data.js is gone: the data is served by the FastAPI backend now, so
# there is no data <script> to order. We check the opposite - that nothing is
# still pointing at the deleted file, and that the fetch actually exists.
order = re.findall(r'<script src="([^"]+)"', html)
if any(re.search(r"career-data\.js$", s) for s in order):
    problems.append("career.html still loads career-data.js, which was moved into the API")
if not re.search(r"fetch\(\s*[\"'`]/api/career-data[\"'`]", js):
    problems.append("script.js no longer fetches /api/career-data")

# script.js must still come after GSAP, or gsap is undefined when init() runs
i_gsap = next((i for i, s in enumerate(order) if re.search(r"gsap\.min\.js$", s)), -1)
try:
    i_main = order.index("script.js")
except ValueError:
    problems.append("career.html does not load script.js")
    i_main = -1
if i_main >= 0 and i_gsap > i_main:
    problems.append("script.js loads BEFORE gsap, animations will not run")
if not any("ScrollTrigger" in s for s in order):
    problems.append("career.html does not load ScrollTrigger")

# ---- every local <script src> actually exists on disk ----
# GSAP is vendored into Frontend/vendor so the animations survive a blocked or
# offline CDN. A wrong path here means every tween on the page silently dies.
for page in PAGES:
    src = (FRONTEND / page).read_text(encoding="utf-8")
    for href in re.findall(r'<script src="([^"]+)"', src):
        if href.startswith(("http:", "https:")):
            problems.append(
                f"{page} loads {href} from a CDN; GSAP must be vendored in Frontend/vendor"
            )
            continue
        if not (FRONTEND / href).exists():
            problems.append(f"{page} loads missing script: {href}")
for vendor in ("vendor/gsap.min.js", "vendor/ScrollTrigger.min.js"):
    if not (FRONTEND / vendor).exists():
        problems.append(f"GSAP is not vendored: Frontend/{vendor} is missing")

# ---- the motion fallback must exist ----
# Several hero elements sit at opacity: 0 in the CSS and are only revealed by
# a GSAP timeline. script.js adds .no-motion when it will not animate, and
# style.css has to define that class or the content stays invisible.
if "no-motion" not in js:
    problems.append("script.js never sets the no-motion fallback class")
for rule in (
    ".no-motion .intro__title",
    ".no-motion .intro__eyebrow",
    ".no-motion .scroll-cue",
    ".no-motion .intro__rule span",
):
    if rule not in css:
        problems.append(f"style.css is missing the motion fallback rule: {rule}")

# ---- every element id the blueprint renderers write into must exist ----
# grad-stream is deliberately absent: the grad path asks for a degree
# directly and has no stream question.
for ident in (
    "bp-head", "bp-cards", "bp-skills", "bp-skills-lede", "bp-timeline", "bp-timeline-lede",
    "generate", "form-missing", "pathform", "blueprint", "group-student", "group-grad",
    "path-opts", "stu-stream", "stu-interest", "stu-hobbies", "grad-skills",
    "stu-degree", "grad-degree", "stu-duration", "stu-interest-other", "stu-hobby-other",
    "grad-role", "grad-skill-quick", "grad-skill-add", "grad-skill-chips",
    "grad-skills-hint", "grad-degree-hint", "bp-restart", "bp-print",
):
    if ident not in html_ids:
        problems.append(f"missing required id: {ident}")

# ---- the grad path must not ask for a stream again ----
if "grad-stream" in html_ids:
    problems.append("career.html still has a grad-stream control")
for needle in ("grad-stream", "'grad-stream'"):
    if needle in js:
        problems.append(f"script.js still references the removed grad stream: {needle}")
grad_group = slice_element(html, 'id="group-grad"')
if not grad_group:
    problems.append("could not find the group-grad element in career.html")
elif re.search(r"Stream", grad_group):
    problems.append("the grad path still shows a Stream label")
else:
    # the degree filter needs somewhere to explain itself
    if "grad-skills-hint" not in grad_group:
        problems.append("the grad skill list has no hint explaining the degree filter")
    if "grad-skill-quick" not in grad_group:
        problems.append("the grad path has no way to type a skill the filter leaves out")

# ---- data file must be loadable and self-consistent ----
for field in ("what", "how"):
    if not D["GENERIC_ITEM"].get(field):
        problems.append(f"GENERIC_ITEM missing {field}")
if len(D["GENERIC_PHASES"]) != len(D["PHASES"]):
    problems.append("GENERIC_PHASES length != PHASES length")
for w in D["GENERIC_ITEM"].get("where") or []:
    if w not in D["RESOURCES"]:
        problems.append(f"GENERIC_ITEM unknown resource {w}")

# ---- every stream reachable, every degree selectable ----
for s in D["STREAMS"]:
    if not any(s["id"] in (d.get("streams") or []) for d in D["DEGREES"]):
        problems.append(f"stream {s['id']} has no degree")
for key in D["ROLES"]:
    if not any(
        i.get("role") == key or key in (i.get("also") or []) for i in D["INTERESTS"]
    ):
        problems.append(f"role {key} unreachable from any interest")

print(f"classes used: {len(used_classes)}   defined in css: {len(css_classes)}   ids in html: {len(html_ids)}")
print(f"resources: {len(D['RESOURCES'])}  skills: {len(D['SKILLS'])}  roles: {len(D['ROLES'])}")
if notes:
    print(f"\nnotes ({len(notes)}):")
    for n in sorted(set(notes)):
        print("  ~ " + n)
if problems:
    print(f"\nPROBLEMS ({len(problems)}):")
    for p in problems:
        print("  - " + p)
    sys.exit(1)
print("\nOK - no static problems")
