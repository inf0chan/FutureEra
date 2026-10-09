"""Log in / sign up modal check.

The modal is front-end only, so there is no route to test and nothing in
FastAPI that can fail on it. That is exactly why it is worth a check: every
failure mode here is silent. A typo in one data-auth-* hook, a tab that stops
switching, or a field the submit handler cannot find does not throw - the
button just quietly does nothing.

The markup lives in two files and has to agree with itself: the ids and
data-auth-* hooks in the HTML, the selectors in script.js, and the .auth__*
classes in style.css. Renaming one without the others is the easy mistake, and
nothing in the browser points at it.

So this checks the three files agree, statically, in Python:

  * every page with a navbar also carries the dialog and the nav trigger
  * every id script.js reads exists in the markup, and vice versa
  * every data-auth-* hook in the markup is used by script.js
  * every .auth__* class in the markup and script.js is defined in style.css
  * both forms prevent the default submit, validate, and never store the raw
    password
  * a successful sign in lands on the home page, from both forms, every time -
    and nothing turns that into a first-sign-in-only redirect
  * the reduced-motion rule is still there

    Backend\\.venv\\Scripts\\python.exe check_auth.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent / "Frontend"

js = (FRONTEND / "script.js").read_text(encoding="utf-8")
css = (FRONTEND / "style.css").read_text(encoding="utf-8")

# Rule bodies are pulled out with `[^}]*`, which stops at the first closing brace
# - and a comment sitting inside a rule can contain one (this file explains the
# `* { margin: 0 }` clash in exactly such a comment). That silently truncates the
# body and makes the declarations after it look absent. So the comments come out
# before anything is analysed, the same way check_anim.py strips them out of the
# JS.
css_code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)

pages = {
    name: (FRONTEND / name).read_text(encoding="utf-8")
    for name in ("index.html", "career.html", "creators.html", "community.html", "group.html")
}

# career.html has no navbar at all - it uses a backlink instead - so it carries
# no auth trigger and no dialog. The others must, including group.html: it opens
# in its own tab, so a visitor can arrive there with nothing signed in and has to
# be able to sign in from where they are.
with_nav = {n: h for n, h in pages.items() if 'class="nav"' in h}
without_nav = {n: h for n, h in pages.items() if n not in with_nav}

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


auth = slice_function(js, "initAuth")
if not auth:
    print("initAuth() is missing from script.js")
    sys.exit(1)

# comments explain the choices in prose and mention hooks that are not real
auth_code = re.sub(r"/\*.*?\*/", "", auth, flags=re.S)
auth_code = re.sub(r"^\s*//.*$", "", auth_code, flags=re.M)

# ---------- the pages that have a navbar must have the whole thing ----------
REQUIRED_IN_HTML = (
    'id="auth-dialog"',
    'id="auth-title"',
    'id="auth-msg"',
    'id="auth-panel-login"',
    'id="auth-panel-signup"',
    "data-auth-open",
    "data-auth-close",
    "data-auth-signout",
    "data-auth-who",
    "data-auth-initial",
    'data-auth-tab="login"',
    'data-auth-tab="signup"',
)

FIELD_IDS = (
    "auth-login-email",
    "auth-login-pass",
    "auth-signup-name",
    "auth-signup-email",
    "auth-signup-pass",
)

for name, html in with_nav.items():
    missing = [t for t in REQUIRED_IN_HTML + FIELD_IDS if t not in html]
    if missing:
        problems.append(f"{name} has a navbar but is missing: {', '.join(missing)}")

for name in without_nav:
    if "data-auth-open" in pages[name]:
        problems.append(f"{name} has an auth trigger but no navbar to put it in")

# ---------- the ids script.js reads must exist in the markup ----------
read_ids = set(re.findall(r'getElementById\(\s*["\']([\w-]+)["\']\s*\)', auth_code))
read_ids |= {
    m.group(1) for m in re.finditer(r'val\(panels\.\w+,\s*["\']([\w-]+)["\']', auth_code)
}

html_text = "".join(pages.values())
for i in sorted(read_ids):
    if not i.startswith("auth-"):
        continue  # nav-links / nav-toggle belong to the navbar
    if f'id="{i}"' not in html_text:
        problems.append(f"script.js reads #{i} but no page declares it")

# every auth id in the markup should be reachable from the handler, otherwise it
# is markup nobody wired up. The two tab ids are the exception: they exist only
# to be pointed at by aria-controls / aria-labelledby, which needs no JS.
declared = set(re.findall(r'id="(auth-[\w-]+)"', html_text))
aria_only = set()
for attr in ("aria-controls", "aria-labelledby"):
    for value in re.findall(rf'{attr}="([^"]+)"', html_text):
        if value.startswith("auth-"):
            aria_only.add(value)

for i in sorted(declared - read_ids - aria_only - {"auth-title", "auth-dialog", "auth-msg"}):
    if f'id="{i}"' not in auth_code and i not in auth_code:
        problems.append(f'#{i} is in the markup but script.js never touches it')

# ---------- data-auth-* hooks must agree both ways ----------
hooks_html = set(re.findall(r"data-auth-([\w-]+)", html_text))
hooks_js = set(re.findall(r"data-auth-([\w-]+)", auth_code)) | {
    # dataset.authTab is camelCase in the source but data-auth-tab in the markup
    m.group(1).lower() for m in re.finditer(r"dataset\.auth(\w+)", auth_code)
}
hooks_js |= set(re.findall(r"\[data-auth-([\w-]+)\]", auth_code))
for hook in sorted(hooks_html - hooks_js):
    problems.append(f"data-auth-{hook} is in the markup but script.js never reads it")
for hook in sorted(hooks_js - hooks_html):
    problems.append(f"script.js looks for data-auth-{hook} but no page declares it")

# ---------- every trigger on the page must be bound, not just the first ----------
# A page may carry more than one "Log in" affordance: community.html has the
# navbar button and a second one in its closing call to action. querySelector
# only ever reaches the first, so the second is a dead control - no error, no
# warning, the button simply does nothing when clicked. So the lookup has to be a
# querySelectorAll, and the list it returns has to be walked twice: once to bind
# the click, once to hide the trigger when someone signs in.
m = re.search(
    r"(\w+)\s*=\s*Array\.from\(\s*document\.querySelectorAll\(\s*[\"']\[data-auth-open\][\"']\s*\)",
    auth_code,
)
if not m:
    problems.append(
        "initAuth binds only the first [data-auth-open] trigger, so a second one on "
        "the page would be a dead button - it needs querySelectorAll"
    )
else:
    trigger_list = m.group(1)
    if len(re.findall(rf"\b{trigger_list}\.forEach\b", auth_code)) < 2:
        problems.append(
            f"initAuth never walks the {trigger_list} list, so some triggers miss "
            "either the click handler or the signed-in state"
        )
    # a querySelectorAll that is trimmed straight back down to one entry is the
    # same bug wearing a disguise
    if re.search(r"\.\s*slice\s*\(", auth_code[m.end() : m.end() + 40]):
        problems.append(
            f"the {trigger_list} list is trimmed with .slice(), which puts the "
            "dead-button bug back"
        )

# a single-element lookup for the hook anywhere in here can only ever reach the
# first match, however many the page has
if re.search(r"querySelector\(\s*[\"']\[data-auth-open\]", auth_code):
    problems.append(
        "initAuth looks up a single [data-auth-open] with querySelector, which can "
        "only ever reach the first trigger on the page"
    )

# ---------- every auth class must be styled ----------
classes_html = set()
for html in pages.values():
    classes_html |= set(re.findall(r'class="([^"]*)"', html))
auth_classes = {c for group in classes_html for c in group.split() if c.startswith("auth__")}
auth_classes |= set(re.findall(r'"(auth__[\w-]+)"', auth_code))
auth_classes |= set(re.findall(r"\b(auth__[\w-]+)\b", auth_code))

css_classes = set(re.findall(r"\.((?:auth|is-shown|is-hidden)[\w-]*)", css_code))
for c in sorted(auth_classes - css_classes):
    problems.append(f".{c} is used but never defined in style.css")

# ---------- behaviour that must not regress ----------
# both forms stop the page navigating on submit
if auth_code.count("preventDefault") < 2:
    problems.append("a form submit is not calling preventDefault")

for needle, why in (
    ("looksLikeEmail", "the email check is gone"),
    ("showModal", "the dialog is never opened with showModal"),
    ("AUTH_SESSION", "nothing is written to the session key"),
    ("AUTH_USERS", "nothing is read from the users key"),
    ("removeAttribute", "the no-showModal fallback is gone"),
):
    if needle not in auth_code:
        problems.append(f"initAuth: {why}")

# the minimum password length has to be read off the comparison itself, not off
# the error message beside it - renaming the message must not pass this
m = re.search(r"pass\.length\s*<\s*(\d+)", auth_code)
if not m:
    problems.append("initAuth: the password length check is gone")
elif int(m.group(1)) < 6:
    problems.append(
        f"initAuth: the minimum password length dropped to {m.group(1)}"
    )

# the raw password must never reach storage. digest() is the only thing that
# should see it.
if "digest(email" not in auth_code:
    problems.append("the password is not passed through digest() before storage")
if re.search(r'store\.write\(\s*AUTH_USERS[^)]*\bpass\b', auth_code):
    problems.append("the raw password appears to be written to storage")

# signed-in state is rendered from storage on load, not only after a submit
if "renderWho();" not in auth_code:
    problems.append("initAuth never calls renderWho(), so a refresh loses the chip")

# ---------- signing in has to land on the home page, every time ----------
# The requirement is that every successful sign in redirects, not that the first
# one does. That distinction is the whole point, and it is the easiest thing in
# the world to break quietly: wrapping the navigation in a "have they signed in
# before" branch, or behind a module-level flag, still redirects the first time
# and looks perfect in a demo. So the guard rails that would suppress it are
# checked for by name, not just the happy path.
home = re.search(r'const\s+HOME_PAGE\s*=\s*["\']([^"\']+)["\']', js)
if not home:
    problems.append(
        "script.js has no HOME_PAGE constant, so there is nothing to redirect to"
    )
    home_target = "none"
else:
    home_target = home.group(1)
    if not (FRONTEND / home_target).is_file():
        problems.append(
            f"HOME_PAGE points at {home_target}, which is not a file in Frontend/"
        )
    elif not home_target.startswith(("http", "/")):
        # A relative target is the right choice here - an absolute "/index.html"
        # breaks if the site is ever served from a subfolder - but only because
        # every page carrying the dialog happens to be a sibling of the target.
        # A page one level down would need "../index.html" and a relative path
        # would 404 silently on it, landing the visitor on a broken page instead
        # of the home page. So this resolves the path from each page rather than
        # trusting that they are all in the same folder.
        for name, html in with_nav.items():
            target = (FRONTEND / name).parent / home_target
            if not target.resolve().is_file():
                problems.append(
                    f"HOME_PAGE is {home_target!r}, which does not resolve from "
                    f"{name} - a page in a subfolder would need '../{home_target}'"
                )

# the navigation itself
if not re.search(r"location\s*\.\s*assign\s*\(", auth_code):
    problems.append(
        "a successful sign in does not navigate anywhere, so the dialog closes and "
        "the visitor is left where they were"
    )

# both forms must route through it, not just login - a signup ends with an
# account just as much as a login does
for panel in ("login", "signup"):
    handler = re.search(
        rf'panels\.{panel}\.addEventListener\(\s*["\']submit["\']\s*,\s*\((.*?)\n\s*\}}\);',
        auth_code,
        flags=re.S,
    )
    if not handler:
        problems.append(f"the {panel} form's submit handler could not be found")
    elif not re.search(r"\bland\s*\(", handler.group(1)):
        problems.append(
            f"a successful {panel} does not go through land(), so it will not "
            "redirect to the home page"
        )

# and nothing may turn the redirect into a one-time event.
#
# This started as a list of flag names to look for - "once", sessionStorage,
# hasVisited - and it was a bad check: a flag called anything at all slips past
# it, and the first thing anyone does when adding a "only redirect the first
# time" is pick a name nobody guessed. So the two properties that actually
# matter are checked structurally instead.
#
# 1. the navigation happens in exactly one place. A second call site is either a
#    duplicate or one that also runs on load, and with the session in
#    localStorage an on-load navigation bounces the visitor off the home page
#    forever.
navigations = len(re.findall(r"location\s*\.\s*assign\s*\(", auth_code))
if navigations != 1:
    problems.append(
        f"initAuth navigates {navigations} times, expected 1 - a second call site is "
        "either redundant or one that also runs on page load, which would loop"
    )

# 2. the guard in front of it may only ask whether location exists. Anything else
#    is a condition the visitor can satisfy once - a flag, a stored value, a
#    counter - and that is exactly the first-time-only redirect.
for m in re.finditer(r"location\s*\.\s*assign\s*\(", auth_code):
    head = auth_code[: m.start()]
    open_if = head.rfind("if")
    if open_if == -1:
        continue
    # balance the parentheses of that condition
    i = auth_code.find("(", open_if)
    depth = 0
    cond = ""
    for j in range(i, len(auth_code)):
        if auth_code[j] == "(":
            depth += 1
        elif auth_code[j] == ")":
            depth -= 1
            if depth == 0:
                cond = auth_code[i + 1 : j]
                break
    asked = set(re.findall(r"[A-Za-z_$][\w$]*", cond))
    allowed = {"window", "location", "assign", "typeof", "function"}
    extra = sorted(asked - allowed)
    if extra:
        problems.append(
            f"the redirect is guarded by {', '.join(extra)}, which is not about "
            "whether location exists - that is how a sign in stops redirecting "
            "the second time"
        )

# a stored or in-memory marker of any kind is the same smell from further away
if re.search(r"\b(sessionStorage|once|hasVisited|hasSeen|firstVisit|alreadyLanded)\b",
             auth_code, flags=re.I):
    problems.append(
        "initAuth carries a one-shot marker, so only the first sign in would redirect"
    )

# the message has to say the move is coming, or it reads as a dead confirmation
if not re.search(r"Signed in\.[^"'"'"']*home", auth_code, flags=re.I):
    problems.append(
        "the sign-in confirmation does not mention going home, so it reads as a "
        "dead end right before the page changes"
    )

# ---------- the redirect must not become a loop ----------
# The session lives in localStorage, so a redirect that also fires on page load
# would bounce the visitor off the home page forever. Nothing in initAuth may
# navigate outside a submit or a click.
outside = [
    m for m in re.finditer(r"location\s*\.\s*assign\s*\(", auth_code)
    if "setTimeout" not in auth_code[max(0, m.start() - 400) : m.start()]
]
if outside:
    problems.append(
        "something navigates outside the timed sign-in path - if that also runs on "
        "page load it will loop, because the session is still in storage"
    )

# ---------- motion preference is respected ----------
if "@media (prefers-reduced-motion: reduce)" not in css_code:
    problems.append("style.css has no reduced-motion block")
elif not re.search(
    r"@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.auth__trigger", css_code
):
    problems.append("the auth trigger ignores prefers-reduced-motion")

# ---------- the card has to be centred by us, not by the browser ----------
# The browser centres <dialog> with `margin: auto` from its own stylesheet. This
# file starts with a `* { margin: 0 }` reset, and an author rule outranks the UA
# sheet, so the card drops into the top-left corner unless the centring is
# written out here. That failure is silent and deceptive: the text still centres
# inside the card, so it reads as "the card is off to the side" rather than as a
# missing rule.
dialog_rule = re.search(r"\.auth__dialog\s*\{([^}]*)\}", css_code)
if not dialog_rule:
    problems.append("style.css has no .auth__dialog rule")
    centring = "no rule"
else:
    body = dialog_rule.group(1)
    has_fixed = re.search(r"position:\s*fixed", body) is not None
    has_inset = re.search(r"(?m)^\s*inset\s*:", body) is not None
    has_auto = re.search(r"margin\s*:[^;]*auto", body) is not None
    has_height = re.search(r"height\s*:\s*max-content", body) is not None

    if not has_fixed:
        problems.append(".auth__dialog is not position: fixed, so inset: 0 cannot centre it")
    if not has_inset:
        problems.append(".auth__dialog has no inset: 0, so margin: auto has nothing to centre between")
    if not has_auto:
        problems.append(".auth__dialog does not use margin: auto, so it is not centred")
    if not has_height:
        problems.append(
            ".auth__dialog needs height: max-content for margin: auto to centre it vertically"
        )

    centring = ", ".join(
        name
        for name, ok in (
            ("fixed", has_fixed),
            ("inset:0", has_inset),
            ("margin:auto", has_auto),
            ("height:max-content", has_height),
        )
        if ok
    )
    if has_fixed and has_inset and has_auto and has_height:
        centring += "  (needed: the * { margin: 0 } reset outranks the browser's)"

if not re.search(r"(?m)^\s*\*\s*\{[^}]*margin:\s*0", css_code):
    centring += "  |  no * { margin: 0 } reset found, so the browser default would apply"

# ---------- report ----------
triggers = sum(1 for h in with_nav.values() if "data-auth-open" in h)
trigger_buttons = sum(len(re.findall(r"data-auth-open", h)) for h in with_nav.values())
print(f"pages with a navbar : {len(with_nav)}   carrying the modal: {triggers}")
print(f"auth triggers       : {trigger_buttons} buttons, all bound (not just the first)")
print(f"pages without one   : {', '.join(sorted(without_nav)) or 'none'}")
print(f"auth ids            : {len(declared)} declared, {len(read_ids & declared)} read by script.js")
print(f"auth hooks          : {', '.join(sorted(hooks_html))}")
print(f"auth classes        : {len(auth_classes)} used, all defined in style.css")
print(f"password handling   : sha256 via digest(), raw password never stored")
print(f"sign in lands on    : {home_target} (both forms, every time, no once-only flag)")
print(f"card centring       : {centring}")

if problems:
    print(f"\nPROBLEMS ({len(problems)}):")
    for p in problems:
        print("  - " + p)
    sys.exit(1)
print("\nOK - the log in / sign up modal is wired up correctly")
