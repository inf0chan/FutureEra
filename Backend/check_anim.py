"""Animation wiring check.

The browser-level boot test used to be a jsdom script, which needed Node and
jsdom just to read the same file. The animation code is still worth guarding,
because the failure mode is silent: a tween that is never wired up, or an
element hidden at opacity 0 that nothing ever brings back, does not throw - the
page just quietly stops moving and the text stays invisible.

So this checks the animation source statically, in Python:

  * every page loads the vendored GSAP and ScrollTrigger, in the right order
  * init() still calls all of its steps, so a rename that drops one from init()
    is still noticed. Nine of them animate; initCommunityFollow, which builds the
    suggestion slide, initProfile, which builds the profile popup, and
    initCommunityGroups, which builds the group suggestion list, are listed here
    only for that same reason - none of the three is an animation section, and
    none is allowed to be hidden at opacity 0 while claiming to be one
  * each of them is gated on MOTION.ok, and .no-motion is set when it is not
  * the scroll-cue loop is a fromTo and not a repeating .to()
  * nothing is set to opacity 0 in a section without being returned to 1

    Backend\\.venv\\Scripts\\python.exe check_anim.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent / "Frontend"
PAGES = ("index.html", "career.html", "creators.html", "community.html")

js = (FRONTEND / "script.js").read_text(encoding="utf-8")

# Comments in this file explain the animation tricks, and they talk about
# ".to()" and "gsap" in prose. Analysing the comments produces phantom tweens and
# phantom gsap use, so every check below runs against the code only.
code = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
code = re.sub(r"^\s*//.*$", "", code, flags=re.M)

problems: list[str] = []


def slice_function(source: str, name: str) -> str:
    """Body of `function name(...)`, found by balancing braces."""
    m = re.search(rf"function\s+{re.escape(name)}\s*\(", source)
    if not m:
        return ""
    open_brace = source.find("{", m.end() - 1)
    depth = 0
    for i in range(open_brace, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[open_brace : i + 1]
    return ""
    return ""


def split_call_args(text: str, start: int) -> list[str]:
    """Top-level comma separated arguments of the call whose '(' is at `start`."""
    args: list[str] = []
    current: list[str] = []
    depth = 0
    i = start + 1
    while i < len(text):
        c = text[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif c == "," and depth == 0:
            args.append("".join(current))
            current = []
            i += 1
            continue
        current.append(c)
        i += 1
    args.append("".join(current))
    return args


# ---------- 1. script load order on every page ----------
for page in PAGES:
    src = (FRONTEND / page).read_text(encoding="utf-8")
    order = re.findall(r'<script src="([^"]+)"', src)

    # matched on the path with any ?v= cache buster removed, not on the raw
    # attribute - an exact match reads "script.js?v=6" as a page that no longer
    # loads the script, which is how this check got a false alarm the moment the
    # cache buster was added
    paths = [s.split("?", 1)[0].split("#", 1)[0] for s in order]
    if "script.js" not in paths:
        problems.append(f"{page} does not load script.js")
        continue
    i_main = paths.index("script.js")

    for needed, pattern in (
        ("gsap", r"vendor/gsap\.min\.js$"),
        ("ScrollTrigger", r"vendor/ScrollTrigger\.min\.js$"),
    ):
        hit = [i for i, s in enumerate(order) if re.search(pattern, s)]
        if not hit:
            problems.append(f"{page} does not load the vendored {needed}")
        elif hit[0] > i_main:
            problems.append(f"{page} loads {needed} AFTER script.js, so it is undefined at init()")

# ---------- 2. init() still calls every section ----------
init_body = slice_function(code, "init")
if not init_body:
    problems.append("script.js has no init() function")
else:
    for section in ("nav", "auth", "intro", "about", "creators", "community", "careerHero", "footer"):
        if f'step("{section}"' not in init_body:
            problems.append(f"init() no longer runs the {section} animation section")

    # the career hero must animate even when the API is down
    hero = init_body.find('step("careerHero", initCareerHero)')
    fetch = init_body.find("loadCareerData()")
    if hero < 0:
        problems.append("init() does not run the career hero animation")
    elif 0 <= fetch < hero:
        problems.append("the career hero animation is wired behind the API fetch; it must run on its own")

# ---------- 3. every animation section is gated on MOTION.ok ----------
for name in ("initIntro", "initAbout", "initCreators", "initCommunity", "initCareerHero"):
    body = slice_function(code, name)
    if not body:
        problems.append(f"script.js has no {name}() function")
        continue
    if "MOTION.ok" not in body:
        problems.append(f"{name} animates without checking MOTION.ok; content would stay invisible")

if "no-motion" not in init_body:
    problems.append("init() never sets the no-motion fallback class")
if not re.search(
    r"if\s*\(\s*!\s*MOTION\.ok\s*\)\s*document\.documentElement\.classList\.add\(", init_body
):
    problems.append("init() does not add no-motion when MOTION.ok is false")
if "gsap" in slice_function(code, "initNav"):
    problems.append("initNav() touches gsap; the navbar must work with no GSAP present")

# ---------- 4. the infinitely repeating tween must be a fromTo ----------
# A repeating .to() animates once: the first iteration ends on the final value,
# so every iteration after it starts and ends on the same value and nothing
# moves. Only fromTo restates its from-values on each repeat.
# One regex covers gsap.set(), tl.set() and the chained .to() calls that follow,
# by matching any ".method(" whose receiver ends in an identifier or ")".
TWEEN = re.compile(r"(?<=[A-Za-z0-9_)\]])\s*\.\s*(set|to|from|fromTo)\s*\(")

loops = [m.start() for m in re.finditer(r"repeat\s*:\s*-1", code)]
if not loops:
    problems.append("script.js has no repeating tween; the scroll-cue loop is gone")
for pos in loops:
    starts = [(m.start(), m.group(1)) for m in TWEEN.finditer(code[:pos])]
    if not starts:
        problems.append("a repeating tween is not attached to any gsap call")
        continue
    if starts[-1][1] != "fromTo":
        problems.append(
            f"a repeating tween uses .{starts[-1][1]}() - it would only animate once, use .fromTo()"
        )

# ---------- 5. nothing is parked at opacity 0 and left there ----------
# The eyebrow was set to opacity 0 alongside the scroll cue and then never
# restored, so it sat invisible. This is the general form of that bug.
#
# Only .set() counts as parking something: a .to() fading out is deliberate, and
# an opacity: 0 inside .from() is just where the tween starts before it animates
# the element back to whatever the CSS says it should be.
GROUPS = dict(re.findall(r"const\s+(\w+)\s*=\s*pick\(\[([^\]]*)\]\)", code))
PICK = re.compile(r"pick\(\s*\[([^\]]*)\]\s*\)")


def expand(target: str) -> set[str]:
    target = target.strip()
    if target in GROUPS:
        target = GROUPS[target]
    picked = PICK.fullmatch(target.strip())
    if picked:
        target = picked.group(1)
    return {t.strip() for t in target.split(",") if t.strip()}


parked: set[str] = set()
restored: set[str] = set()
faded_in: set[str] = set()

for m in TWEEN.finditer(code):
    kind = m.group(1)
    args = split_call_args(code, m.end() - 1)
    tail = " ".join(args[1:])
    idents = expand(args[0])
    if kind == "set" and re.search(r"opacity\s*:\s*0\b", tail):
        parked.update(idents)
    elif kind in ("to", "fromTo", "set") and re.search(r"opacity\s*:\s*1\b", tail):
        restored.update(idents)
    elif kind == "from":
        # a from() always lands on the element's own value, so it reveals too
        faded_in.update(idents)

for ident in sorted(parked - restored):
    problems.append(f'script.js parks "{ident}" at opacity 0 and never brings it back to 1')

# ---------- 6. every hidden starting state in the stylesheet is recoverable ----------
# The CSS hides things at opacity 0 so GSAP can draw them in. That is only safe
# while there are two escape hatches: .no-motion puts the content back when GSAP
# never runs, and a tween brings it back when it does. A selector that has
# neither is invisible forever, and nothing throws to warn you.
css = (FRONTEND / "style.css").read_text(encoding="utf-8")

# opacity 0 that a :hover / :focus rule already undoes is a deliberate reveal
on_interaction: set[str] = set()
for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
    if re.search(r"opacity\s*:\s*1\b", m.group(2)) and re.search(r":hover|:focus", m.group(1)):
        on_interaction.update(re.findall(r"\.([a-zA-Z][\w-]*)", m.group(1)))

parked_css: set[str] = set()
for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
    sel, body = m.group(1), m.group(2)
    if not re.search(r"opacity\s*:\s*0\s*[;\s}]", body):
        continue
    if re.search(r"[\[\]:>+~&]", sel):
        continue  # attribute, pseudo, combinator or nesting: not a plain class
    parked_css.update(re.findall(r"\.([a-zA-Z][\w-]*)", sel))

for cls in sorted(parked_css):
    if cls in on_interaction:
        continue
    if not re.search(rf"\.no-motion[^{{]*\.{re.escape(cls)}\b", css):
        problems.append(
            f"style.css hides .{cls} at opacity 0 and no .no-motion rule brings it back"
        )

    # if a tween parks this one individually, something has to un-park it
    ident = None
    m = re.search(rf"(\w+)\s*:\s*document\.querySelector\(\s*[\"']\.{re.escape(cls)}[\"']", code)
    if m:
        ident = f"els.{m.group(1)}"
    else:
        m = re.search(
            rf"(?:const|let|var)\s+(\w+)\s*=\s*document\.querySelector\(\s*[\"']\.{re.escape(cls)}[\"']",
            code,
        )
        if m:
            ident = m.group(1)
    if ident and ident not in restored and ident not in faded_in:
        problems.append(
            f'style.css hides .{cls} at opacity 0 and no tween reveals {ident}'
        )

# ---------- report ----------
tween_kinds: dict[str, int] = {}
for m in TWEEN.finditer(code):
    tween_kinds[m.group(1)] = tween_kinds.get(m.group(1), 0) + 1
sections = re.findall(r"function\s+(init\w+)\s*\(", code)

print(f"script.js sections : {', '.join(sections)}")
print(
    "tween calls        : "
    + ", ".join(f".{k} {v}" for k, v in sorted(tween_kinds.items()))
    + f"  (total {sum(tween_kinds.values())})"
)
print(f"repeating tweens   : {len(loops)} (all verified to be fromTo)")
print(f"parked at opacity 0: {len(parked)}   brought back: {len(restored)}")
print(f"css-hidden elements: {len(parked_css)}   all have a way back")

if problems:
    print(f"\nPROBLEMS ({len(problems)}):")
    for p in problems:
        print("  - " + p)
    sys.exit(1)
print("\nOK - the animations are still wired up correctly")
