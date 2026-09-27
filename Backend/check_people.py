"""Community member data and match scoring check.

The suggestion slide on the community page is only as good as the member list
behind it, and the list is cross-referenced against career_data.json: every
member's interest and skill ids have to resolve to real ids there. A typo in
people.json would otherwise not throw anywhere. The backend would happily return
the member, the browser would render a chip with no label, and the match score
would quietly count a tag that does not exist - a wrong number rather than a
visible error, which is the worst kind.

The match rule itself is checked here too, because the same is true of it. The
score is plain arithmetic, and a change to the weights or the ratio that made it
run backwards would not fail the server; it would just quietly suggest strangers
to everybody. So this asserts the properties the score has to keep, rather than
pinning the current numbers:

  * a member with none of your picks scores 0
  * a member with all of them scores 100
  * nobody picked means no score at all, not a score of 0
  * the list is ordered best match first

    Backend\\\\.venv\\\\Scripts\\\\python.exe check_people.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import main  # noqa: E402  - needs the path set up first

CAREER_FILE = HERE / "data" / "career_data.json"
PEOPLE_FILE = HERE / "data" / "people.json"

C = json.loads(CAREER_FILE.read_text(encoding="utf-8"))
P = json.loads(PEOPLE_FILE.read_text(encoding="utf-8"))

errs: list[str] = []

interest_ids = {i["id"] for i in C["INTERESTS"]}
skill_ids = {s["id"] for s in C["SKILLS"]}
role_ids = set(C["ROLES"])

if not isinstance(P, dict) or "PEOPLE" not in P:
    print("people.json must be an object with a PEOPLE list")
    sys.exit(1)

people = P["PEOPLE"]
if not isinstance(people, list) or not people:
    errs.append("PEOPLE is empty, the suggestion slide would have nothing to show")
    people = []

TEXT_FIELDS = ("id", "name", "handle", "blurb")

seen_ids: set[str] = set()
seen_names: set[str] = set()
seen_handles: set[str] = set()
used_interests: set[str] = set()
used_skills: set[str] = set()

for p in people:
    pid = p.get("id") or "<no id>"

    for field in TEXT_FIELDS:
        if not str(p.get(field) or "").strip():
            errs.append(f"PEOPLE {pid}: missing {field}")

    # the handle is shown next to the name, so a missing @ is a visible gap
    if p.get("handle") and not str(p["handle"]).startswith("@"):
        errs.append(f'PEOPLE {pid}: handle "{p["handle"]}" should start with @')

    if not str(p.get("blurb") or "").strip():
        errs.append(f"PEOPLE {pid}: missing blurb, the card would be a name and nothing else")

    if pid in seen_ids:
        errs.append(f'PEOPLE: duplicate id "{pid}"')
    seen_ids.add(pid)

    for field, seen in (("name", seen_names), ("handle", seen_handles)):
        key = str(p.get(field) or "").lower()
        if key in seen:
            errs.append(f'PEOPLE {pid}: duplicate {field} "{p.get(field)}"')
        seen.add(key)

    if p.get("role") not in role_ids:
        errs.append(f'PEOPLE {pid}: unknown role "{p.get("role")}"')

    # someone with no tags at all can never match, and would sit in the slide
    # permanently at the bottom looking like a loading failure
    for field, valid, used in (
        ("interests", interest_ids, used_interests),
        ("skills", skill_ids, used_skills),
    ):
        values = p.get(field)
        if not isinstance(values, list) or not values:
            errs.append(f"PEOPLE {pid}: no {field}, this member can never match anyone")
            continue
        for value in values:
            if value not in valid:
                errs.append(f'PEOPLE {pid}: unknown {field[:-1]} "{value}"')
            if value in values[: values.index(value)]:
                errs.append(f'PEOPLE {pid}: duplicate {field[:-1]} "{value}"')
        used.update(values)

    followers = p.get("followers")
    if not isinstance(followers, int) or isinstance(followers, bool) or followers < 0:
        errs.append(f"PEOPLE {pid}: followers must be a non-negative whole number")

# picking an interest that no member shares is a dead end in the picker: the
# visitor selects it, waits for a better match, and nothing changes
for i in sorted(interest_ids - used_interests):
    errs.append(f'INTEREST {i}: no member has it, so selecting it changes nothing')

# ---------- the match rule itself ----------
# Scored through the real function the API calls, not a reimplementation of it,
# so this cannot pass while the route is broken.
ranked = main.match_people({"ai", "data"}, {"python", "sql"})

if any(p["match"]["score"] is None for p in ranked):
    errs.append("a ranked list came back with members that have no score")

scores = [p["match"]["score"] for p in ranked]
if scores != sorted(scores, reverse=True):
    errs.append(f"the list is not ordered best match first: {scores}")

if len(ranked) != len(people):
    errs.append(f"match_people returned {len(ranked)} of {len(people)} members")

# ---------- group suggestions ----------
# Same rule, same weights, applied to a group instead of a person. The property
# that matters most is that it IS the same rule: a 60/40 weighting written out
# twice is a 60/40 weighting that will quietly drift, and the member slide and
# the group list sit on the same page claiming to rank you the same way.
groups_ranked = main.match_groups({"ai", "data"}, {"python", "sql"})

if len(groups_ranked) != len(main.load_groups()):
    errs.append(
        f"match_groups returned {len(groups_ranked)} of {len(main.load_groups())} groups"
    )

# the weights must be the ones the members are scored with
weight_i, weight_s = main.INTEREST_WEIGHT, main.SKILL_WEIGHT
if (weight_i, weight_s) != (60, 40):
    errs.append(f"the documented weighting is {weight_i}/{weight_s}, not 60/40")

# a group whose members hold every tag the visitor picked is a full match, and
# one holding none of them is a real 0 rather than an unranked entry
for g in groups_ranked:
    m = g["match"]
    if m["score"] is not None and not 0 <= m["score"] <= 100:
        errs.append(f"group {g['id']} scored {m['score']}, outside 0-100")
    if m["score"] is not None and m["score"] == 0 and (m["interests"] or m["skills"]):
        errs.append(f"group {g['id']} shared tags but scored 0")
    if m["score"] == 0 and not (m["interests"] or m["skills"]):
        continue
    if m["score"] is None and (m["interests"] or m["skills"]):
        errs.append(f"group {g['id']} shared tags but came back unranked")

gscores = [g["match"]["score"] for g in groups_ranked if g["match"]["score"] is not None]
if gscores != sorted(gscores, reverse=True):
    errs.append(f"the group list is not ordered best fit first: {gscores}")

# a group where someone genuinely shares everything must reach the top of the
# scale, or "ranked for you" is not true
perfect = [g for g in groups_ranked if g["match"]["score"] == 100]
if not perfect:
    errs.append("no group scored 100 for a visitor sharing everything - the scale is not reaching its top")
for g in perfect:
    if g["matches"] < 1:
        errs.append(f"group {g['id']} scored 100 but claims nobody in it matches")

# "4 of 7 people here match you" has to be true, and the names are the evidence
for g in groups_ranked:
    if g["matches"] > g["members"]:
        errs.append(f"group {g['id']} claims {g['matches']} matches out of {g['members']} members")
    if g["matches"] and not g["names"]:
        errs.append(f"group {g['id']} says {g['matches']} match but names nobody")
    if len(g["names"]) > 3:
        errs.append(f"group {g['id']} names {len(g['names'])} people, more than the 3 it should show")

# With nothing picked there is nothing to rank against, so nothing may claim a
# score, and the order has to fall back to something honest - how many members
# the group has. A fabricated 0 here would read as "nothing in common".
unranked = main.match_groups(set(), set())
if any(g["match"]["score"] is not None for g in unranked):
    errs.append("picking nothing still produced group scores - a 0 would read as 'no overlap'")
sizes = [g["members"] for g in unranked]
if sizes != sorted(sizes, reverse=True):
    errs.append(f"unranked groups are not ordered by size: {sizes}")

# one axis only must still reach 100, the same rescaling the members get
for label, interests, skills in (
    ("interests only", {"ai", "data"}, set()),
    ("skills only", set(), {"python", "sql"}),
):
    solo = main.match_groups(interests, skills)
    if not any(g["match"]["score"] == 100 for g in solo):
        errs.append(
            f"picking {label} left no group at 100 - the unpicked axis is costing "
            "group scores the same way it was costing member scores"
        )

# the two ends of the scale, which is what makes the number mean anything
best = max(scores)
worst = min(scores)
if best != 100:
    errs.append(f"the best possible match scores {best}, not 100 - someone who shares everything is being penalised")
if worst != 0:
    errs.append(f"a member sharing nothing scores {worst}, not 0")

# a member carrying every tag the visitor picked must come out at exactly 100
all_of = {"interests": ["ai", "data"], "skills": ["python", "sql"]}
top = ranked[0]
if top["match"]["score"] != 100:
    errs.append(
        f"{top['name']} shares every picked tag but scored {top['match']['score']}, not 100"
    )
if sorted(top["match"]["interests"]) != all_of["interests"]:
    errs.append(f"{top['name']} shares every interest but the response disagrees")
if sorted(top["match"]["skills"]) != all_of["skills"]:
    errs.append(f"{top['name']} shares every skill but the response disagrees")

# Picking one half must not cost the visitor points for the half they did not
# pick. An axis with no picks is an absence of evidence, not a mismatch, so its
# weight is handed to the other axis rather than silently voided - otherwise a
# perfect interest match reads as 60/100 and the number lies about the range.
for label, interests, skills in (
    ("interests only", {"ai", "data"}, set()),
    ("skills only", set(), {"python", "sql"}),
):
    solo = main.match_people(interests, skills)
    if solo[0]["name"] != top["name"] or solo[0]["match"]["score"] != 100:
        errs.append(
            f"picking {label} left {top['name']} on {solo[0]['match']['score']}"
            f" instead of 100 - the unpicked axis is costing points it should not"
        )

# and a single axis that nobody shares is a real 0, not an unranked list: the
# visitor did give us something to judge on, it just did not match anyone
dead = main.match_people(set(), {"photoshop"})
dead_scores = {p["match"]["score"] for p in dead}
if None in dead_scores:
    errs.append("a picked-but-unshared tag produced no score, so the slide looks unranked")
if dead_scores != {0}:
    errs.append(f"picking a skill nobody has should score everyone 0, got {sorted(dead_scores)}")

# the opposite case, and the easy one to get wrong: a picked axis that nobody
# shares is a genuine 0 and must keep costing its share. Only an axis that was
# never picked gets its weight handed over.
partial = main.match_people({"ai"}, {"photoshop"})
if max(p["match"]["score"] for p in partial) != main.INTEREST_WEIGHT:
    errs.append(
        f"a member sharing the one interest but not the unmatched skill should sit at"
        f" {main.INTEREST_WEIGHT}, got {max(p['match']['score'] for p in partial)}"
    )

# nothing picked means nothing to rank against, which has to be distinguishable
# from "these people have nothing in common with you"
unranked = main.match_people(set(), set())
if any(p["match"]["score"] is not None for p in unranked):
    errs.append("members got a match score even though the visitor picked nothing, so an unranked list looks like a bad one")
if any(p["match"]["interests"] or p["match"]["skills"] for p in unranked):
    errs.append("shared tags were reported when the visitor picked nothing")
if [p["followers"] for p in unranked] != sorted((p["followers"] for p in unranked), reverse=True):    errs.append("the unranked list is not ordered by followers")

# the frontend drops tags the backend does not know, so a bad id must not throw
dirty = main.match_people({"not-a-real-interest"}, {"not-a-real-skill"})
if not dirty:
    errs.append("an unknown tag emptied the member list instead of being ignored")

# the picker sends the whole vocabulary, and the route has to survive that
everything = main.match_people(interest_ids, skill_ids)
if len(everything) != len(people):
    errs.append("picking every tag dropped members from the list")

unused_skills = sorted(skill_ids - used_skills)

# ---------- the frontend half ----------
# The member cards are built in script.js, not written into community.html, so
# check_pages cannot see them: a typo in one of those class names would leave an
# unstyled card rather than a failed check. This closes that gap, and does the
# same for the hooks the renderer reads and the custom events the two halves of
# script.js use to talk to each other.
FRONTEND = HERE.parent / "Frontend"
js = (FRONTEND / "script.js").read_text(encoding="utf-8")
css_code = re.sub(r"/\*.*?\*/", "", (FRONTEND / "style.css").read_text(encoding="utf-8"), flags=re.S)
community_html = (FRONTEND / "community.html").read_text(encoding="utf-8")


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


render = slice_function(js, "initCommunityFollow")
if not render:
    errs.append("script.js has no initCommunityFollow() function, so the slide never fills")
else:
    # Every class the renderer puts on a card has to be styled. The markup is
    # assembled by concatenation, so class="..." cannot simply be read out: the
    # captured run continues past the attribute into the expression that follows
    # it. So for each attribute the part before the first quote is taken, plus
    # any string literals quoted inside the remainder - which is where the
    # conditional classes live. This is what catches person__name mistyped as
    # person__nam, which a prefix-based filter would wave through.
    built: set[str] = set()

    def keep(text: str) -> None:
        for word in text.split():
            if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", word):
                built.add(word)

    for chunk in re.findall(r'class="([^"\n]*)', render):
        keep(chunk.split("'")[0])
        for nested in re.findall(r'"([^"\n]*)"', chunk):
            keep(nested)

    # and the ones applied at runtime
    built.update(re.findall(r'classList\.(?:add|remove|toggle)\(\s*"([A-Za-z][\w-]*)"', render))

    css_classes = set(re.findall(r"\.([A-Za-z][\w-]*)", css_code))
    for c in sorted(built - css_classes):
        errs.append(f".{c} is put on a member card by script.js but never defined in style.css")

    # every id the renderer reads has to exist in the markup
    for i in sorted(set(re.findall(r'getElementById\(\s*"([\w-]+)"', render))):
        if f'id="{i}"' not in community_html:
            errs.append(f"script.js reads #{i} but community.html does not declare it")

    # and so does every data hook it queries in the static markup. The rest -
    # data-tag, data-kind, data-follow, data-person - are set by the renderer
    # itself, so they are not expected in the HTML. These are written as bare
    # boolean attributes, so a name match is the test, not "name=".
    rendered_itself = {"data-tag", "data-kind", "data-follow", "data-person"}
    for hook in sorted(set(re.findall(r'\[(data-[\w-]+)[\]=]', render)) - rendered_itself):
        if not re.search(rf"\b{re.escape(hook)}\b", community_html):
            errs.append(f"script.js queries [{hook}] but community.html does not declare it")

    # the two halves of script.js talk over window events; if one side is
    # renamed the other goes quiet and nothing says so
    for event, needed in (
        ("future-era:open-auth", 2),  # dispatched by the slide, listened for by initAuth
        ("future-era:session", 2),    # dispatched by initAuth, listened for by the slide
    ):
        found = len(re.findall(rf"[\"']{re.escape(event)}[\"']", js))
        if found < needed:
            errs.append(
                f'"{event}" appears {found} time(s) in script.js, expected {needed} - '
                "one end of the conversation is missing"
            )

    # the slide has to run before the career fetch, and be registered as its own
    # step so a failure cannot take the other sections down
    if 'step("communityFollow", initCommunityFollow)' not in js:
        errs.append("init() no longer runs initCommunityFollow")

    # esc() is what makes the interpolation safe, so it has to be there
    if not re.search(r"function\s+esc\s*\(", js):
        errs.append("script.js has no esc(), so member text is interpolated unescaped")

    # follows are per account, so the key has to include the account
    if "FOLLOWS_KEY" not in render or "AUTH_SESSION" not in render:
        errs.append("the follow list is not keyed by account, so accounts would share it")

print(
    f"members:{len(people)}  interests used:{len(used_interests)}/{len(interest_ids)}  "
    f"skills used:{len(used_skills)}/{len(skill_ids)}"
)
print(
    f"match rule : 0-100, {main.INTEREST_WEIGHT} interest / {main.SKILL_WEIGHT} skill, "
    f"no picks means no score"
)
print(
    f"sample     : {ranked[0]['name']} {ranked[0]['match']['score']} "
    f"(interests={','.join(ranked[0]['match']['interests']) or 'none'} "
    f"skills={','.join(ranked[0]['match']['skills']) or 'none'})"
)
print(f"skills no member lists: {','.join(unused_skills) if unused_skills else 'none'}")
print(f"rendered cards     : {len(built) if render else 0} classes, all styled in style.css")

if errs:
    print(f"\nERRORS ({len(errs)}):")
    for e in errs:
        print("  - " + e)
    sys.exit(1)

print("\nOK - the community member data and the match rule are sound")
