"""Data integrity check for the API's career data.

The data moved from Frontend/career-data.js to data/career_data.json when the
FastAPI backend took ownership of it, so this parses the JSON the same way the
API serves it.

    Backend\\.venv\\Scripts\\python.exe check_data.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_FILE = HERE / "data" / "career_data.json"

D = json.loads(DATA_FILE.read_text(encoding="utf-8"))

errs: list[str] = []

res_ids = set(D["RESOURCES"])
skill_ids = {s["id"] for s in D["SKILLS"]}
role_ids = list(D["ROLES"])
stream_ids = {s["id"] for s in D["STREAMS"]}
dur_ids = {d["id"] for d in D["DURATIONS"]}
degree_ids = {d["id"] for d in D["DEGREES"]}


def norm(text: object) -> str:
    """same normalisation the frontend uses to resolve free-typed text"""
    return re.sub(r"[^a-z0-9+#]", "", str(text).lower())


# every alias resolves to exactly one skill
alias_map: dict[str, str] = {}
for s in D["SKILLS"]:
    alias_map[norm(s["id"])] = s["id"]
    for alias in s.get("aliases") or []:
        key = norm(alias)
        if key == norm(s["id"]):
            continue
        if key in alias_map:
            if alias_map[key] != s["id"]:
                errs.append(f'alias "{alias}" in {s["id"]} collides with {alias_map[key]}')
        else:
            alias_map[key] = s["id"]


def resolve_skill(text: object) -> str | None:
    return alias_map.get(norm(text))


def check_body(o: dict, label: str) -> None:
    for field in ("what", "how"):
        if not o.get(field) or not str(o[field]).strip():
            errs.append(f"{label}: missing {field}")
    where = o.get("where")
    if not isinstance(where, list) or not where:
        errs.append(f"{label}: missing where")
        return
    seen: set[str] = set()
    for w in where:
        if w not in res_ids:
            errs.append(f'{label}: unknown resource "{w}"')
        if w in seen:
            errs.append(f'{label}: duplicate resource "{w}"')
        seen.add(w)


for o in D["STREAMS"]:
    check_body(o, f"STREAM {o['id']}")
for o in D["DURATIONS"]:
    check_body(o, f"DURATION {o['id']}")

for o in D["DEGREES"]:
    check_body(o, f"DEGREE {o['id']}")
    for s in o.get("streams") or []:
        if s not in stream_ids:
            errs.append(f"DEGREE {o['id']}: unknown stream \"{s}\"")
    for d in o.get("durations") or []:
        if d not in dur_ids:
            errs.append(f"DEGREE {o['id']}: unknown duration \"{d}\"")
    if not o.get("streams"):
        errs.append(f"DEGREE {o['id']}: no streams, never selectable")
    if not o.get("durations"):
        errs.append(f"DEGREE {o['id']}: no durations, duration field would be empty")

for o in D["INTERESTS"]:
    check_body(o, f"INTEREST {o['id']}")
    if o.get("role") not in role_ids:
        errs.append(f"INTEREST {o['id']}: unknown role \"{o.get('role')}\"")
    also = o.get("also") or []
    if o.get("role") in also:
        errs.append(f"INTEREST {o['id']}: also repeats its own role")
    for r in also:
        if r not in role_ids:
            errs.append(f"INTEREST {o['id']}: unknown also-role \"{r}\"")

for o in D["HOBBIES"]:
    check_body(o, f"HOBBY {o['id']}")

for o in D["SKILLS"]:
    check_body(o, f"SKILL {o['id']}")

    # the grad path filters the skill list by degree, so this list is load-bearing
    degrees = o.get("degrees")
    if not isinstance(degrees, list) or not degrees:
        errs.append(f"SKILL {o['id']}: no degrees, the grad skill filter would hide it everywhere")
        continue
    for d in degrees:
        if d not in degree_ids:
            errs.append(f"SKILL {o['id']}: unknown degree \"{d}\"")
    # "unsure" is the catch-all degree, so it has to offer every skill
    if "unsure" not in degrees:
        errs.append(f"SKILL {o['id']}: not offered for the \"unsure\" degree")

# a degree with no skills at all would show an empty, unusable filter
for o in D["DEGREES"]:
    if not any(o["id"] in (s.get("degrees") or []) for s in D["SKILLS"]):
        errs.append(f"DEGREE {o['id']}: no skill offers it, the grad filter would be empty")

for key, r in D["ROLES"].items():
    check_body(r, f"ROLE {key}")
    if not r.get("label"):
        errs.append(f"ROLE {key}: missing label")
    if not r.get("blurb"):
        errs.append(f"ROLE {key}: missing blurb")
    requires = r.get("requires")
    if not isinstance(requires, list) or not requires:
        errs.append(f"ROLE {key}: empty requires")
        requires = requires or []
    seen: set[str] = set()
    for s in requires:
        if s not in skill_ids:
            errs.append(f"ROLE {key}: requires unknown skill id \"{s}\"")
        if s in seen:
            errs.append(f"ROLE {key}: duplicate require \"{s}\"")
        seen.add(s)
    phases = r.get("phases")
    if not isinstance(phases, list) or len(phases) != len(D["PHASES"]):
        errs.append(f"ROLE {key}: needs {len(D['PHASES'])} phases")
        phases = phases or []
    for i, p in enumerate(phases):
        if not p or not str(p).strip():
            errs.append(f"ROLE {key}: phase {i} empty")


def dupe_ids(values: list, label: str) -> None:
    seen: set = set()
    for x in values:
        if x in seen:
            errs.append(f'{label}: duplicate id "{x}"')
        seen.add(x)


dupe_ids([x["id"] for x in D["STREAMS"]], "STREAMS")
dupe_ids([x["id"] for x in D["DURATIONS"]], "DURATIONS")
dupe_ids([x["id"] for x in D["DEGREES"]], "DEGREES")
dupe_ids([x["id"] for x in D["INTERESTS"]], "INTERESTS")
dupe_ids([x["id"] for x in D["HOBBIES"]], "HOBBIES")
dupe_ids([x["id"] for x in D["SKILLS"]], "SKILLS")
dupe_ids(role_ids, "ROLES")
dupe_ids([x["id"] for x in D["PHASES"]], "PHASES")

# every interest must be able to reach a real role with a non-empty blueprint
for o in D["INTERESTS"]:
    r = D["ROLES"].get(o.get("role"))
    if r and len(r.get("phases") or []) != len(D["PHASES"]):
        errs.append(f"INTEREST {o['id']}: role {o['role']} has bad phases")

# sanity: every stream must be selectable by at least one degree
for s in stream_ids:
    if not any(s in (d.get("streams") or []) for d in D["DEGREES"]):
        errs.append(f"STREAM {s}: no degree offers it")
# sanity: every duration must be reachable
for d in dur_ids:
    if not any(d in (x.get("durations") or []) for x in D["DEGREES"]):
        errs.append(f"DURATION {d}: no degree offers it")

# every skill must be wanted by at least one role, or be a listed option only
wanted: set[str] = set()
for r in D["ROLES"].values():
    wanted.update(r.get("requires") or [])
orphan_skills = [s["id"] for s in D["SKILLS"] if s["id"] not in wanted]
orphan_roles = [
    k
    for k in role_ids
    if not any(i.get("role") == k or k in (i.get("also") or []) for i in D["INTERESTS"])
]

# the frontend resolves free-typed extra skills through this same table
for skill in D["SKILLS"]:
    for alias in [skill["id"], *(skill.get("aliases") or [])]:
        if resolve_skill(alias) != skill["id"]:
            errs.append(f"SKILL {skill['id']}: alias \"{alias}\" does not resolve back to itself")

print(
    f"resources:{len(D['RESOURCES'])} streams:{len(D['STREAMS'])} degrees:{len(D['DEGREES'])} "
    f"interests:{len(D['INTERESTS'])} hobbies:{len(D['HOBBIES'])} "
    f"skills:{len(D['SKILLS'])} roles:{len(role_ids)}"
)
print(
    f"aliases:{len(alias_map)}  skills not required by any role:"
    f"{','.join(orphan_skills) if orphan_skills else 'none'}"
)
print(
    "roles not reachable from any interest:"
    f"{','.join(orphan_roles) if orphan_roles else 'none'}"
)

if errs:
    print(f"\nERRORS ({len(errs)}):")
    for e in errs:
        print("  - " + e)
    sys.exit(1)

print("\nOK - no structural errors")
