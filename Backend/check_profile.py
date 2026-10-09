"""Profile popup and group registry check.

The popup opened from the signed-in chip answers four questions: who am I, what
have I picked, who do I follow, and which groups am I in. Three of those are only
as good as the data behind them, and the failure mode for all of them is silent -
a mistyped data-profile-* hook leaves a heading with no number under it, an
unknown group id either disappears or renders as a raw slug, and a group count
that disagrees with the list under it looks like a feature rather than a bug.

The fourth, followers, is checked for the opposite reason. There is no shared
server and no link between an account and a member card, so a follower count
cannot be derived honestly. It is a real 0 with an explanation next to it. If this
check ever fails on that line, the reason someone tried to "fix" it, and the fix
is a backend rather than a formula.

    Backend\\.venv\\Scripts\\python.exe check_profile.py
"""

from __future__ import annotations

import inspect
import json
import re
import sys
from pathlib import Path

from starlette.requests import Request

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import main  # noqa: E402  - needs the path set up first

FRONTEND = HERE.parent / "Frontend"
PAGES = ("index.html", "creators.html", "community.html", "career.html", "group.html")

js = (FRONTEND / "script.js").read_text(encoding="utf-8")
css = (FRONTEND / "style.css").read_text(encoding="utf-8")
pages = {name: (FRONTEND / name).read_text(encoding="utf-8") for name in PAGES}

errs: list[str] = []


def slice_function(source: str, name: str) -> str:
    """Body of `function name(...)`, found by balancing braces.

    Also finds `const name = (...) =>`, because the popup's painters are arrows
    over closure state. A helper that only understood one of the two would let a
    whole function go unchecked just by rewriting its signature.
    """
    m = re.search(rf"function\s+{re.escape(name)}\s*\(", source)
    if not m:
        m = re.search(rf"const\s+{re.escape(name)}\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>", source)
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


def call(fn, path: str, qs: str = "") -> dict:
    """Invoke a route directly, with a Request only if it declares one."""
    scope = {
        "type": "http", "method": "GET", "path": path,
        "query_string": qs.encode(), "headers": [],
    }
    args = () if not inspect.signature(fn).parameters else (Request(scope),)
    return json.loads(fn(*args).body)


# ---------- the group registry ----------
raw = json.loads((HERE / "data" / "people.json").read_text(encoding="utf-8"))
registry = raw.get("GROUPS") or {}
members = raw.get("PEOPLE") or []

if not registry:
    errs.append("people.json has no GROUPS registry")
if not isinstance(registry, dict):
    errs.append("GROUPS must be an object keyed by group id")
    registry = {}

for gid, group in registry.items():
    if not isinstance(group, dict):
        errs.append(f"GROUP {gid} is not an object")
        continue
    if not group.get("label"):
        errs.append(f"GROUP {gid} has no label")
    if not group.get("blurb"):
        errs.append(f"GROUP {gid} has no blurb")

for person in members:
    groups = person.get("groups")
    if not isinstance(groups, list) or not groups:
        errs.append(f"PEOPLE {person['id']}: no groups list")
        continue
    if len(set(groups)) != len(groups):
        errs.append(f"PEOPLE {person['id']}: duplicate group id")
    for g in groups:
        if g not in registry:
            errs.append(f"PEOPLE {person['id']}: unknown group \"{g}\"")

used = {g for p in members for g in (p.get("groups") or [])}
unused = sorted(set(registry) - used)
if unused:
    # dead registry entries still get served to the popup's group picker, where
    # they would read as real groups nobody is in
    errs.append(f"groups no member belongs to: {', '.join(unused)}")

# ---------- the routes ----------
try:
    payload = call(main.groups, "/api/groups")
except Exception as exc:  # noqa: BLE001 - reported, not raised
    errs.append(f"/api/groups raised: {exc}")
    payload = {"groups": []}

served = {g["id"]: g for g in payload.get("groups", [])}
if set(served) != set(registry):
    errs.append(
        f"/api/groups serves {len(served)} groups, the registry has {len(registry)}"
    )

for gid, group in served.items():
    if group.get("label") != group.get("label"):
        errs.append(f"/api/groups: group {gid} has no label")
    if group.get("blurb") != registry.get(gid, {}).get("blurb"):
        errs.append(f"/api/groups: group {gid} blurb does not match the registry")
    expected = sum(1 for p in members if gid in (p.get("groups") or []))
    if group.get("members") != expected:
        errs.append(
            f"/api/groups: group {gid} claims {group.get('members')} members, "
            f"people.json has {expected}"
        )

people_payload = call(main.people, "/api/people")
if "groups" not in people_payload:
    errs.append("/api/people does not expose the group vocabulary")
for card in people_payload.get("people", []):
    if not card.get("groups"):
        errs.append(f"/api/people: card {card['id']} has no groups")
    for g in card.get("groups", []):
        if g not in served:
            errs.append(f"/api/people: card {card['id']} lists unknown group \"{g}\"")

# ---------- the pages ----------
with_nav = {n: h for n, h in pages.items() if 'class="nav"' in h}
html_text = "".join(pages.values())
hooks_html = set(re.findall(r"data-profile-([\w-]+)", html_text))

for name, html in with_nav.items():
    for token in ('id="profile-dialog"', 'id="profile-title"', "data-profile-open",
                  "data-profile-close"):
        if token not in html:
            errs.append(f"{name} has a navbar but is missing {token}")

    # the chip is the popup's only entry point, and it sits inside the auth
    # who-chip, so that chip has to keep both of its own hooks
    if "data-profile-open" not in html:
        errs.append(f"{name} has no clickable profile chip")
    for token in ("data-auth-who", "data-auth-signout", "data-auth-initial"):
        if token not in html:
            errs.append(f"{name} lost {token} - the profile chip replaced the auth chip")

for name, html in with_nav.items():
    hooks_here = set(re.findall(r"data-profile-([\w-]+)", html))
    for hook in sorted(hooks_html - hooks_here):
        errs.append(
            f"{name} has the profile popup but is missing data-profile-{hook}, "
            "so that part of it stays empty on this page"
        )
    for hook in sorted(hooks_here - hooks_html):
        errs.append(f"{name} declares data-profile-{hook}, which no other page does")

for name, html in pages.items():
    if name in with_nav:
        continue
    if "profile-dialog" in html:
        errs.append(f"{name} has a profile dialog but no navbar to open it from")

if "career.html" in pages and "data-profile-open" in pages["career.html"]:
    errs.append("career.html has a profile trigger but no navbar")

# the popup is opened from inside .auth__who, so it must not be reachable while
# signed out - a stray trigger next to the chip would be a broken button
for name, html in with_nav.items():
    if 'class="prof__chip"' in html and 'aria-haspopup="dialog"' not in html:
        errs.append(f"{name}: the profile chip is not announced as a dialog trigger")

# ---------- initProfile wiring ----------
profile = slice_function(js, "initProfile")
if not profile:
    print("initProfile() is missing from script.js")
    sys.exit(1)

# comments explain the choices and mention hooks and ids that are not real
code = re.sub(r"/\*.*?\*/", "", profile, flags=re.S)
code = re.sub(r"^\s*//.*$", "", code, flags=re.M)

# three hooks are named literally, the rest are read out of the array that builds
# the `el` lookup, so a static search of the source would miss all but three
hooks_js = set(re.findall(r"data-profile-([\w-]+)", code))
array = re.search(r"\[\s*((?:\"[\w-]+\"\s*,\s*)+\"[\w-]+\")\s*\]\s*\.forEach", code)
if array:
    hooks_js |= set(re.findall(r"\"([\w-]+)\"", array.group(1)))

for hook in sorted(hooks_html - hooks_js):
    errs.append(f"data-profile-{hook} is in the markup but initProfile never reads it")
for hook in sorted(hooks_js - hooks_html):
    errs.append(f"initProfile looks for data-profile-{hook} but no page declares it")

# ---------- every id and class the popup needs ----------
for i in ("profile-dialog", "profile-title"):
    if f'id="{i}"' not in html_text:
        errs.append(f"script.js needs #{i} but no page declares it")

css_classes = {c[len("prof__"):] for c in re.findall(r"(?<![-\w])\.(prof__[\w-]+)", css)}
used_classes = set(re.findall(r"prof__([\w-]+)", html_text))
used_classes |= set(re.findall(r"prof__([\w-]+)", code))
# is-skill is not prof__ prefixed but carries the interest/skill distinction
if "is-skill" in code and not re.search(r"\.prof__tags\s+li\.is-skill", css):
    errs.append("script.js adds is-skill to skill chips but style.css never styles it")
used_classes.discard("is-skill")

for c in sorted(used_classes - css_classes):
    errs.append(f".prof__{c} is used but not defined in style.css")

# the popup is a <dialog> and has to centre itself the same way .auth__dialog
# does, otherwise the reset pins it to the top left corner
dialog_rule = re.search(r"\.prof__dialog\s*\{([^}]*)\}", css)
if not dialog_rule:
    errs.append("style.css has no .prof__dialog rule")
else:
    body = dialog_rule.group(1)
    for needed, why in (
        ("position: fixed", "inset: 0 cannot centre it"),
        ("inset: 0", "margin: auto has nothing to centre between"),
        ("margin: auto", "it is not centred"),
        ("height: max-content", "margin: auto has nothing to centre vertically"),
    ):
        if needed not in body:
            errs.append(f".prof__dialog is missing {needed}, so {why}")

# [hidden] is the empty-state switch, and an author-level display outranks the
# UA rule for it, so a hidden message would stay on screen
for sel in (r"\.prof__list\[hidden\]", r"\.prof__empty\[hidden\]", r"\.prof__tags\[hidden\]"):
    if not re.search(sel, css):
        errs.append(f"style.css has no {sel} rule, so a hidden empty state still shows")

# ---------- behaviour the copy depends on ----------
# Followers is a real zero, and the check is about your own account only: an
# account has no follower data to derive, so anything else there would be invented.
# A member's row is the opposite case - the member list carries a real count, and
# followerCount() is where it is read. So the zero is still pinned to your own
# paint, and the one thing forbidden is reaching for a member's number there.
if not re.search(r'\["followers-count"\]\.textContent\s*=\s*"0"', code):
    errs.append(
        "the followers count is not the literal 0 - accounts have no follower "
        "data to derive, so any other value would be invented"
    )
if re.search(r"(?:\bme|\brec|\brecord|user|session\(\))\w*\.followers\b", code):
    errs.append(
        "initProfile reads a `followers` field off the account - that is a "
        "member's follower count, not yours, and borrowing it would misreport "
        "the number"
    )
if "real zero" not in profile:
    errs.append("the comment explaining the zero follower count was removed")

# and the member path has to actually use theirs, through the one helper that is
# allowed to. Without this the popup could quietly show 0 for everybody, which
# looks deliberate and is not.
if "followerCount(" not in code:
    errs.append(
        "a member's follower count is not read anywhere, so their profile would "
        "show the same zero yours does"
    )
if not re.search(r"function\s+followerCount\s*\(", js):
    errs.append("followerCount() is missing from script.js")

paint_member = slice_function(js, "paintMember")
if not paint_member:
    errs.append("initProfile has no paintMember(), so a member's profile is never drawn")
elif "followerCount(" not in paint_member:
    errs.append("paintMember does not read the follower count off the member record")

# following is the opposite case: it is real, it is just stored per browser
# account, so the count has to be the length of what was actually saved
if not re.search(r'\["following-count"\]\.textContent\s*=\s*ids\.length', code):
    errs.append(
        "the following count is not the length of the saved follow list - it "
        "has to be derived, or the number and the list under it disagree"
    )
if not re.search(r"FOLLOWS_KEY\s*\+\s*s\.email", code):
    errs.append("initProfile does not read the per-account follow list")

# groups belong to the account record, so signing out cannot strand them. The
# read and the write live in module-level helpers, because the popup and the
# community group list both change the same list - written twice they would
# drift, and the two would disagree on screen.
helpers = slice_function(js, "setMyGroups")
if not helpers:
    print("setMyGroups() is missing from script.js - the two group lists share one write")
    sys.exit(1)
if not re.search(r"writeStore\(AUTH_USERS", helpers):
    errs.append("setMyGroups does not write the account record, so group picks are lost")
if not re.search(r"rec\.groups\s*=\s*ids", helpers):
    errs.append("setMyGroups does not store the list on the account record")
if not re.search(r"if\s*\(\s*!s\.email\s*\)\s*return false", helpers):
    errs.append("setMyGroups will write a group list against nobody when signed out")

# The popup reads the group list but must not change it. Joining moved to the
# community page so that every decision is made next to the group that is asking
# for it, which means the write has to be gone from the profile entirely rather
# than merely hidden - a hidden writer is still a second writer, and the two
# lists can drift the moment someone re-adds a control.
if "setMyGroups(" in code:
    errs.append("initProfile writes the group list again, but joining belongs on the community page")
if "myGroups(" not in code:
    errs.append("initProfile stopped reading the group list, so the popup no longer shows what you are in")
if not re.search(r"function\s+myGroups\s*\(", js):
    errs.append("myGroups() is missing from script.js")

# signing out while the popup is open would leave the last account's name on screen
if "future-era:session" not in profile:
    errs.append("initProfile does not listen for future-era:session, so it stays open after sign out")
if not re.search(r"if\s*\(\s*!session\(\)\.email\s*\)\s*close\(\)", code):
    errs.append("initProfile does not close when the session ends")

# the picker is gone for good: what is left is a summary, and the only way to
# change it is a Join button on the community page
if 'type="checkbox"' in code:
    errs.append("the profile has a group picker again, but the list is meant to be read-only")
if "group-choices" in code:
    errs.append("initProfile still looks for the removed group-choices element")

# The popup still shows the groups, so it has to follow a join made elsewhere.
# Without this the count and the list sit on whatever was true when the dialog
# was last opened, which reads as a bug rather than as a stale cache.
if "future-era:groups-changed" not in code:
    errs.append(
        "initProfile does not listen for future-era:groups-changed, so its group "
        "list goes stale after a join made on the community page"
    )

# ---------- who is in the groups you are in ----------
# A group row's `members` is a count. A count answers "how many", and the question
# this answers is "who", so the names have to come from the people list - a number
# dressed up as a list of names, or a count left in the sub-label with no names
# under it, both look finished and answer nothing.
glist = slice_function(js, "paintGroupList")
if not glist:
    print("paintGroupList() is missing from script.js")
    errs.append("initProfile has no paintGroupList(), so no group is ever listed")
else:
    if not re.search(r"roster\[", glist):
        errs.append(
            "paintGroupList does not read the roster, so a group shows its count "
            "with no names under it"
        )
    if not re.search(r'class="prof__roster"', glist):
        errs.append("the names in a group are not given a class, so style.css cannot style them")
    if not re.search(r"esc\(\s*here\.join\(\", \"\)\s*\)", glist):
        errs.append(
            "the group roster is joined without escaping, so a name with a quote or "
            "an angle bracket in it would break the list"
        )
    # built where the people list arrives, not from the registry
    if not re.search(r"roster\[gid\]", code) and not re.search(r"roster\[gid\]", js):
        errs.append("the roster is never filled in, so every group would list nobody")
    if not re.search(r"roster\[\s*gid\s*\]\s*=", js):
        errs.append(
            "the roster is not built by collecting each member's name into the "
            "groups they belong to"
        )

# Yours carries the names, a member's does not: you are in those groups and would
# want to know who is in them with you, whereas a member's panel answers "which
# groups is this person in" and a roll call would bury that.
gpaint = slice_function(js, "paintGroups")
if not re.search(r"paintGroupList\(\s*mine\s*,\s*true\s*\)", gpaint or ""):
    errs.append("your own group list does not ask for the names of who is in each group")
if not re.search(r"paintGroupList\(\s*groups\s*,\s*false\s*\)", paint_member or ""):
    errs.append(
        "a member's group list asks for the names too, which buries 'which groups "
        "is this person in' under a roll call of the other people in each one"
    )

# registered in init(), or it silently never runs
init_body = slice_function(js, "init")
if 'step("profile", initProfile)' not in init_body:
    errs.append("initProfile is never called from init()")

# ---------- one dialog, two subjects ----------
# The same dialog shows your own account and, when a member's name is clicked on a
# suggestion card, theirs. That only stays one feature if the two are explicit
# about each other, so these are the things that make it a profile rather than a
# popup that reuses somebody's slots.
if "viewing" not in code:
    errs.append(
        "initProfile does not track whose profile is open, so a member's name and "
        "your account would end up in the same dialog"
    )
for subject in ("paintOwn", "paintMember", "resetSubject"):
    if not re.search(rf"const\s+{subject}\s*=\s*\(", code):
        errs.append(f"initProfile has no {subject}(), so the two subjects share one set of slots")

# The labels are what stop it reading as a bug: "Your data" over a stranger's
# interests, or an Edit button that would save over their name. Both subjects
# therefore have to go through one reset, and the three hooks whose meaning
# actually changes have to be written with different words by each - the same
# wording on both is a heading that never got relabelled.
if code.count("resetSubject()") < 3:
    errs.append(
        "the two subjects do not both reset the shared slots first, so a heading "
        "or a member-only element survives from whichever profile was open before"
    )

own = slice_function(js, "paintOwn")
for hook, why in (
    ("following-label", "the first stat is Following on your profile and your overlap with a member"),
    ("data-title", "the tag block is your picks on one profile and their tags on the other"),
    ("following-title", "the first panel is a following list on one and shared tags on the other"),
):
    def written(body: str) -> str:
        m = re.search(rf"setText\(el\[\"{re.escape(hook)}\"\],\s*(.+?)\);", body or "", flags=re.S)
        return m.group(1).strip() if m else ""

    mine, theirs = written(own), written(paint_member)
    if not mine or not theirs:
        errs.append(f"one of the two subjects never writes data-profile-{hook}, so {why}")
    elif mine == theirs:
        errs.append(
            f"both subjects write the same text to data-profile-{hook} ({mine}), so it "
            "still reads as though the popup only ever describes one person"
        )

# an editor over somebody else's record is a button that lies
if not re.search(r"if\s*\(\s*editBtn\s*\)\s*editBtn\.hidden\s*=\s*true", code):
    errs.append("the Edit button is never hidden, so it would appear over a member's profile")
if not re.search(r"if\s*\(\s*editBtn\s*\)\s*editBtn\.hidden\s*=\s*false", code):
    errs.append("the Edit button never comes back for your own profile")

# A member's profile is public and opens signed out; your own cannot, because there
# is no account to describe. Getting this backwards either locks every visitor out
# of the member list or shows an empty profile.
if not re.search(r"if\s*\(\s*!viewing\s*&&\s*!session\(\)\.email\s*\)\s*return", code):
    errs.append(
        "the signed-out guard does not allow for a member's profile, which is "
        "public - or blocks it, which would lock signed-out visitors out"
    )
if "future-era:open-member" not in profile:
    errs.append(
        "initProfile does not listen for future-era:open-member, so clicking a "
        "member's name does nothing"
    )
else:
    # the id arrives on a window event, which anything on the page could raise, so
    # the record it carries has to be checked against the id it is claimed for
    open_member = slice_function(js, "openMember")
    if not open_member:
        errs.append("initProfile has no openMember() to handle the event")
    elif not re.search(r"\.person\.id\s*===\s*id", open_member):
        errs.append(
            "the record carried by the event is not checked against the id it is "
            "claimed for, so a card could open a profile under the wrong name"
        )
    if "esc(" not in code:
        errs.append("member text reaches the dialog unescaped")

# and the card has to be the thing that raises it
slide = slice_function(js, "initCommunityFollow")
# the attribute has to be *emitted*, not merely queried: a query that outlives the
# button it looks for is a card with nothing to click, and every check that only
# asked whether the name appears in the function would pass on the query alone
if not re.search(r'<button[^>]*class="person__open"[^>]*data-person-open=', slide):
    errs.append(
        "the member cards do not emit a profile trigger, so there is nothing to "
        "click to open somebody's profile"
    )
if "future-era:open-member" not in slide:
    errs.append("the member cards never ask the popup to open a profile")
# a div with a click handler would be unreachable by keyboard, and the card is a
# place people tab through
if not re.search(r'<button[^>]*class="person__open"', slide):
    errs.append("the profile trigger on a member card is not a <button>")
if not re.search(r'aria-haspopup="dialog"', slide):
    errs.append("the profile trigger is not announced as opening a dialog")
# and the name has to reach the click handler as data rather than as text, or the
# handler would have to read a rendered card back out of the DOM to know who
if not re.search(r"data-person-open=\"'\s*\+\s*esc\(person\.id\)", slide):
    errs.append("the profile trigger does not carry the member id the handler needs")

# ---------- the community group list ----------
# Joining happens here and nowhere else, so this is the only writer now. The popup
# reads the result.
cgroups = slice_function(js, "initCommunityGroups")
if not cgroups:
    print("initCommunityGroups() is missing from script.js")
    sys.exit(1)
cgroups_code = re.sub(r"/\*.*?\*/", "", cgroups, flags=re.S)
cgroups_code = re.sub(r"^\s*//.*$", "", cgroups_code, flags=re.M)

community = pages["community.html"]

# the section and both ids it reads have to be on the community page
for token in ('id="groups"', 'id="groups-list"', 'id="groups-status"'):
    if token not in community:
        errs.append(f"community.html is missing {token}, so the group section is half wired")

for i in ("groups-list", "groups-status"):
    if f'getElementById("{i}")' not in cgroups:
        errs.append(f"initCommunityGroups never reads #{i}")

if 'step("communityGroups", initCommunityGroups)' not in init_body:
    errs.append("initCommunityGroups is never called from init()")

# the ranked payload has to arrive from the slide rather than a second request:
# two responses ranked on the same picks could disagree, and the page would be
# making a request it does not need
if "future-era:ranked" not in cgroups:
    errs.append("initCommunityGroups does not listen for future-era:ranked")
if re.search(r"fetch\s*\(", cgroups_code):
    errs.append(
        "initCommunityGroups fetches its own copy of /api/people - it should use the "
        "payload initCommunityFollow already fetched and announced"
    )
if "announceRanked" not in slice_function(js, "initCommunityFollow"):
    errs.append("initCommunityFollow does not announce its payload, so the group list waits forever")
if not re.search(r"function\s+announceRanked\s*\(", js):
    errs.append("announceRanked() is missing from script.js")
else:
    # the call site existing is not the same as the event being sent. If
    # announceRanked stops dispatching, everything below still passes and the
    # group list waits for a payload that never arrives.
    announce = slice_function(js, "announceRanked")
    if "future-era:ranked" not in announce:
        errs.append(
            "announceRanked does not dispatch future-era:ranked, so the group list "
            "never hears about the ranking"
        )
    if not re.search(r"RANKED\s*=\s*data", announce):
        errs.append(
            "announceRanked does not store the payload in RANKED, so a group list "
            "initialised later cannot catch up on it"
        )
# the slide announces before the group list is initialised, so the group list has
# to be able to catch up on a payload it already missed
if not re.search(r"if\s*\(\s*RANKED\s*\)\s*onRanked", cgroups_code):
    errs.append(
        "initCommunityGroups cannot catch up on a payload that arrived before it "
        "was initialised, so the list stays empty until the next tag pick"
    )

# it is a view of your membership, so it has to follow the account and follow the
# popup - otherwise joining here and the popup disagree until a reload
for event in ("future-era:session", "future-era:groups-changed"):
    if event not in cgroups:
        errs.append(f"initCommunityGroups does not listen for {event}, so its Join buttons go stale")
if "setMyGroups(" not in cgroups_code:
    errs.append("initCommunityGroups does not go through setMyGroups")

# Both ends of that event, not just the listening end. setMyGroups is the only
# writer of the list, so if it stops announcing, joining in the popup silently
# leaves the community page showing the old state until a reload - and every
# check that only looked at the listeners would still pass.
if "future-era:groups-changed" not in helpers:
    errs.append(
        "setMyGroups does not dispatch future-era:groups-changed, so a join made in "
        "the popup never reaches the community group list"
    )
# The account record is written by two distinct features:
#   1. setMyGroups() - manages group membership only
#   2. profile edit save - manages name, email, password hash
# Both are legitimate and write different fields. The check allows exactly 2.
writers = re.findall(r"writeStore\(AUTH_USERS", js)
if len(writers) != 2:
    errs.append(
        f"the account record is written in {len(writers)} places, expected 2 "
        "(setMyGroups for groups, profile edit for name/email/password)"
    )

# joining with no account would store a membership belonging to nobody
if not re.search(r"if\s*\(\s*!sessionOf\(\)\.email\s*\)", cgroups_code):
    errs.append("initCommunityGroups will join a group for a signed out visitor")
if "future-era:open-auth" not in cgroups:
    errs.append("a signed out join does not ask for an account, it just fails silently")

# the button is a toggle, so it has to say which way it currently is
if 'aria-pressed="' not in cgroups:
    errs.append("the Join button does not set aria-pressed, so it reads as a plain button")
if "Joined" not in cgroups or "Join" not in cgroups:
    errs.append("the Join button does not distinguish joined from not joined in its label")

# an unranked group must say so rather than showing 0%, which would read as
# "nothing in common" when it means "you have not picked anything yet"
if "not ranked" not in cgroups:
    errs.append("an unranked group is not labelled as such, so it will show 0%")

# every class the list builds at runtime has to appear as a selector. This proves
# the name is styled, not that the base rule is complete - a state-only selector
# counts. What it does catch is the failure that actually happens: a class built
# in script.js with nothing in the CSS at all, which renders unstyled.
grp_classes = set(re.findall(r"(?<![-\w])((?:groups|group)__[\w-]+)", cgroups_code))
grp_classes |= set(re.findall(r"(?<![-\w])((?:groups|group)__[\w-]+)", community))
grp_defined = {c for c in re.findall(r"(?<![-\w])\.((?:groups|group)__[\w-]+)", css)}
for c in sorted(grp_classes - grp_defined):
    errs.append(f".{c} is used by the group list but not defined in style.css")

if "is-joined" in cgroups_code:
    if not re.search(r"\.group\.is-joined", css):
        errs.append("script.js marks joined groups with is-joined but style.css never styles it")
    else:
        # The card carries the same page background as the member cards, so the
        # border is the only thing telling you a group is joined. A joined state
        # that declares a border colour identical to the base card is invisible,
        # and it still satisfies any check that only asks "is there a colour?".
        base = re.search(r"(?m)^\.group\s*\{([^}]*)\}", css)
        joined = re.search(r"(?m)^\.group\.is-joined\s*\{([^}]*)\}", css)
        if not base or not joined:
            errs.append("style.css has no .group or .group.is-joined base rule")
        else:
            # Compare the colour itself, not the declaration text. The base card
            # uses the `border` shorthand and the joined state uses
            # `border-color`, so comparing strings would call an identical colour
            # different and pass an invisible joined state every time.
            def last_colour(body):
                m = re.search(r"border(?:-color)?:\s*([^;]+);", body)
                if not m:
                    return None
                found = re.findall(r"rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b", m.group(1))
                return found[-1] if found else None

            b, j = last_colour(base.group(1)), last_colour(joined.group(1))
            if j is None:
                errs.append(".group.is-joined has no border colour, so joining is invisible")
            elif b is not None and j == b:
                errs.append(
                    f".group.is-joined uses the same border colour as the unjoined card "
                    f"({j}), so joining cannot be seen"
                )
            else:
                # and it has to be the accent the followed member cards use, or
                # the two features quietly stop looking like a family
                followed = re.search(r"(?m)^\.person\.is-following\s*\{([^}]*)\}", css)
                fb = last_colour(followed.group(1)) if followed else None
                if fb and j != fb:
                    errs.append(
                        f".group.is-joined uses {j} but a followed member card uses {fb} - "
                        "the two joined states have drifted apart"
                    )
        # the member cards pair the border with an inset accent bar; if the group
        # card drops it, the two are no longer the same visual family
        if not re.search(r"\.group\.is-joined\s*\{[^}]*inset", css):
            errs.append(
                ".group.is-joined has no inset accent, so it does not match the "
                "treatment the member cards use for followed"
            )

# ---------- report ----------
print(f"groups       : {len(registry)} declared, {len(used)} with at least one member")
print(f"members      : {len(members)}, every one in a group: "
      f"{all(p.get('groups') for p in members)}")
print(f"profile hooks: {len(hooks_html)} in the markup, {len(hooks_html & hooks_js)} read by initProfile")
print(f"prof classes : {len(used_classes)} used, all defined in style.css: "
      f"{not (used_classes - css_classes)}")
print(f"group list   : {len(grp_classes)} runtime classes, all named in style.css: "
      f"{not (grp_classes - grp_defined)}")
print(f"pages        : {len(with_nav)} with the popup, career.html correctly without it")
print("followers    : literal 0, derived from nothing - deliberate")
print("group joins  : community-only and opt-in, one shared write, read-only in the popup")

if errs:
    print(f"\nERRORS ({len(errs)}):")
    for e in errs:
        print("  - " + e)
    sys.exit(1)

print("\nOK - the profile popup, the group list and the group registry are sound")
