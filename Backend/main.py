"""
Future Era - FastAPI backend.

Serves two things from one process on one port:

  1. The career data as JSON at /api/career-data
  2. The static site itself (Frontend/) at /

The data used to live in Frontend/career-data.js as a JS file the browser
executed directly. It now lives in Backend/data/career_data.json and reaches
the browser over HTTP, so the backend genuinely owns it.

It also owns the community member list at /api/people, including the interest
and skill match that decides who gets suggested to whom. The scoring is here
rather than in the browser for the same reason the career data moved: the rule
belongs in the backend where it can be tested, not scattered through script.js.

Run:
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import hashlib
import json
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

BACKEND = Path(__file__).resolve().parent
FRONTEND = BACKEND.parent / "Frontend"
DATA_FILE = BACKEND / "data" / "career_data.json"
PEOPLE_FILE = BACKEND / "data" / "people.json"

# every collection the frontend expects. Missing any of these means the JSON and
# script.js have drifted apart, so we fail loudly at startup instead of letting
# the page fail with an undefined error in the console.
REQUIRED = (
    "RESOURCES", "STREAMS", "DURATIONS", "DEGREES", "INTERESTS",
    "HOBBIES", "SKILLS", "ROLES", "PHASES", "GENERIC_ITEM", "GENERIC_PHASES",
)

# How much of a match score comes from interests versus skills. Interests are
# weighted higher because they are the coarser signal: two people who both want
# to get into AI are worth introducing even when their actual toolkits differ,
# whereas overlapping skills without overlapping direction is just two people who
# happen to know the same thing.
INTEREST_WEIGHT = 60
SKILL_WEIGHT = 40


@lru_cache(maxsize=1)
def load_data() -> dict:
    """Read career_data.json once and keep it in memory."""
    if not DATA_FILE.exists():
        raise FileNotFoundError(f"career data not found at {DATA_FILE}")

    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    missing = [key for key in REQUIRED if key not in data]
    if missing:
        raise ValueError(f"career_data.json is missing: {', '.join(missing)}")

    return data


@lru_cache(maxsize=1)
def payload() -> tuple[str, str]:
    """The serialised dataset and its ETag, built once.

    The ETag uses sha256 rather than the builtin hash() on purpose: hash() of a
    str is salted per process, so a restart would hand every browser a new ETag
    and throw away the copy it had cached.
    """
    body = json.dumps(load_data(), separators=(",", ":"))
    etag = '"' + hashlib.sha256(body.encode("utf-8")).hexdigest()[:32] + '"'
    return body, etag


@lru_cache(maxsize=1)
def load_groups() -> dict[str, dict]:
    """The group registry from people.json, id -> {label, blurb}.

    Groups are the only part of the community model that lives only here: they
    are not careers, so they are not in career_data.json, and they are not a
    scoring input either. Kept next to the members because a group is only
    meaningful relative to who is in it.
    """
    if not PEOPLE_FILE.exists():
        raise FileNotFoundError(f"community member data not found at {PEOPLE_FILE}")

    people = json.loads(PEOPLE_FILE.read_text(encoding="utf-8"))
    if not isinstance(people, dict) or not isinstance(people.get("GROUPS"), dict):
        raise ValueError("people.json must be an object with a GROUPS object")

    groups = people["GROUPS"]
    for gid, group in groups.items():
        if not isinstance(group, dict) or not group.get("label"):
            raise ValueError(f"GROUP {gid}: needs a label")
        if not group.get("blurb"):
            raise ValueError(f"GROUP {gid}: needs a blurb")
    return groups


@lru_cache(maxsize=1)
def load_people() -> list[dict]:
    """Read people.json once and keep it in memory.

    The member list is cross-referenced against career_data.json: every interest
    and skill id has to resolve, otherwise the frontend would render a chip with
    no label and a match score counting a tag that does not exist. Group ids are
    checked the same way against this file's own GROUPS registry.
    """
    if not PEOPLE_FILE.exists():
        raise FileNotFoundError(f"community member data not found at {PEOPLE_FILE}")

    people = json.loads(PEOPLE_FILE.read_text(encoding="utf-8"))
    if not isinstance(people, dict) or "PEOPLE" not in people:
        raise ValueError("people.json must be an object with a PEOPLE list")

    group_ids = set(load_groups())

    career = load_data()
    interest_ids = {i["id"] for i in career["INTERESTS"]}
    skill_ids = {s["id"] for s in career["SKILLS"]}
    role_ids = set(career["ROLES"])

    for person in people["PEOPLE"]:
        for i in person.get("interests") or []:
            if i not in interest_ids:
                raise ValueError(f"PEOPLE {person['id']}: unknown interest \"{i}\"")
        for s in person.get("skills") or []:
            if s not in skill_ids:
                raise ValueError(f"PEOPLE {person['id']}: unknown skill \"{s}\"")
        if person.get("role") not in role_ids:
            raise ValueError(f"PEOPLE {person['id']}: unknown role \"{person.get('role')}\"")
        for g in person.get("groups") or []:
            if g not in group_ids:
                raise ValueError(f"PEOPLE {person['id']}: unknown group \"{g}\"")

    return people["PEOPLE"]


def score_tags(
    my_interests: set[str],
    my_skills: set[str],
    have_interests: set[str],
    have_skills: set[str],
) -> tuple[int | None, list[str], list[str]]:
    """The one scoring rule in this project, used for both members and groups.

    How much of what you picked does the other side also have, with the 60/40
    weighting towards interests applied only to the halves you actually filled
    in. Pick both and it is the documented 60 interest / 40 skill; pick one and
    that one is scored out of 100 on its own. The actual shared tags come back
    as well as the number, so the page can show why something was suggested
    rather than asking you to trust a figure.

    Picking nothing returns None rather than 0. A made-up zero would read as
    "no overlap" when it really means "we do not know yet", and it would push
    everything to the bottom as if it were a bad match.

    `have_*` is a set of tags rather than a person, so the same arithmetic
    scores a single member (their own tags) and a whole group (the tags
    everyone in it has between them). That is the point of keeping it in one
    place: a 60/40 rule implemented twice is a 60/40 rule that will drift.
    """
    shared_i = sorted(my_interests & have_interests)
    shared_s = sorted(my_skills & have_skills)

    if not my_interests and not my_skills:
        return None, shared_i, shared_s

    # An axis you picked nothing on is not a mismatch, it is an absence of
    # evidence - so it is left out of the sum and its weight handed to the axis
    # that is. Picking only interests therefore scores out of 100 on interests,
    # instead of topping out at 60 and reading as "never a full match" no matter
    # who is shown.
    parts = 0.0
    score = 0.0
    if my_interests:
        parts += INTEREST_WEIGHT
        score += INTEREST_WEIGHT * (len(shared_i) / len(my_interests))
    if my_skills:
        parts += SKILL_WEIGHT
        score += SKILL_WEIGHT * (len(shared_s) / len(my_skills))

    return round(score * 100 / parts), shared_i, shared_s


def match_people(my_interests: set[str], my_skills: set[str]) -> list[dict]:
    """Score every member against the visitor's picks and sort best first."""
    scored: list[dict] = []

    for person in load_people():
        score, shared_i, shared_s = score_tags(
            my_interests,
            my_skills,
            set(person.get("interests") or []),
            set(person.get("skills") or []),
        )

        role = person.get("role")
        scored.append({
            "id": person["id"],
            "name": person["name"],
            "handle": person.get("handle", ""),
            "role": role,
            "roleLabel": load_data()["ROLES"].get(role, {}).get("label", ""),
            "blurb": person.get("blurb", ""),
            "interests": person.get("interests") or [],
            "skills": person.get("skills") or [],
            "groups": person.get("groups") or [],
            "followers": person.get("followers", 0),
            "match": {"score": score, "interests": shared_i, "skills": shared_s},
        })

    # best match first; unranked people sit at the end ordered by how many
    # people already follow them, and ties break on name so the order is stable
    # between reloads rather than shuffling on every request.
    scored.sort(key=lambda p: (p["match"]["score"] is None, -(p["match"]["score"] or 0), -p["followers"], p["name"]))
    return scored


def match_groups(my_interests: set[str], my_skills: set[str]) -> list[dict]:
    """Rank the groups by how much of what the visitor picked their members have.

    A group is scored on the tags of everyone in it taken together, using the
    same rule as a member, because "people like you are in here" is the claim the
    page is making. Scoring on the group as a whole rather than averaging its
    members is deliberate: a group of twelve where three of them share your
    interest is a better suggestion for you than one where a single person is a
    perfect match and the other eleven are strangers, and averaging would rank
    those two the same way.

    The count of members who individually share something with you comes back
    too, so the page can say "4 of 7 people here match you" rather than only
    showing a score. With nothing picked every group is unranked and the order
    falls back to how many members each one has, which is the only honest signal
    left.
    """
    people = load_people()
    rows: list[dict] = []

    for gid, group in load_groups().items():
        members = [p for p in people if gid in (p.get("groups") or [])]

        group_interests: set[str] = set()
        group_skills: set[str] = set()
        for person in members:
            group_interests |= set(person.get("interests") or [])
            group_skills |= set(person.get("skills") or [])

        score, shared_i, shared_s = score_tags(
            my_interests, my_skills, group_interests, group_skills
        )

        # who individually shares something, which is the part a visitor can
        # recognise; a group of many with one match should not claim "all of them"
        sharing = [
            p for p in members
            if (my_interests & set(p.get("interests") or []))
            or (my_skills & set(p.get("skills") or []))
        ]

        rows.append({
            "id": gid,
            "label": group["label"],
            "blurb": group.get("blurb", ""),
            "members": len(members),
            "matches": len(sharing),
            "names": [p["name"] for p in sharing[:3]],
            "match": {"score": score, "interests": shared_i, "skills": shared_s},
        })

    # best fit first. Unranked groups sit at the end ordered by how many members
    # they have, and ties break on the label so the order is stable between
    # reloads rather than shuffling on every request.
    rows.sort(key=lambda g: (
        g["match"]["score"] is None,
        -(g["match"]["score"] or 0),
        -g["matches"],
        -g["members"],
        g["label"],
    ))
    return rows


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Fail fast at startup if either data file is missing or malformed."""
    data = load_data()
    counts = ", ".join(
        f"{k}={len(v)}" for k, v in data.items() if isinstance(v, (list, dict))
    )
    print(f"[career data ok] {counts}")

    people = load_people()
    print(f"[community ok] members={len(people)} groups={len(load_groups())} interests+skills+groups all resolve")

    yield


app = FastAPI(
    title="Future Era API",
    description="Career blueprint data for the Future Era site.",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/api/health")
def health() -> dict:
    """Liveness probe."""
    return {"status": "ok"}


@app.get("/api/career-data")
def career_data(request: Request) -> Response:
    """
    The full career dataset.

    Returned with a strong ETag so the browser reuses its cache between page
    loads, and answers If-None-Match with a cheap 304 instead of resending the
    body.
    """
    body, etag = payload()

    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=300"})

    return Response(
        content=body,
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=300", "ETag": etag},
    )


def split_tags(raw: str | None) -> set[str]:
    """Read a comma separated tag list off the query string."""
    if not raw:
        return set()
    return {t.strip() for t in raw.split(",") if t.strip()}


@app.get("/api/people")
def people(request: Request) -> JSONResponse:
    """
    The community member list, ranked against the visitor's own tags.

    Query:
        interests  comma separated interest ids the visitor picked
        skills     comma separated skill ids the visitor picked

    Returns the ranked members, plus the two vocabularies the picker needs, so
    the page makes one request rather than three.

    Unknown ids are dropped rather than rejected. The picker is the only thing
    that builds this query string, so a stale bookmark or a typo should widen the
    result, not turn into an error page.
    """
    career = load_data()

    valid_interests = {i["id"] for i in career["INTERESTS"]}
    valid_skills = {s["id"] for s in career["SKILLS"]}
    my_interests = split_tags(request.query_params.get("interests")) & valid_interests
    my_skills = split_tags(request.query_params.get("skills")) & valid_skills

    return JSONResponse(
        {
            "interests": [{"id": i["id"], "label": i["label"]} for i in career["INTERESTS"]],
            "skills": [{"id": s["id"], "label": s["label"]} for s in career["SKILLS"]],
            "people": match_people(my_interests, my_skills),
            # ranked for this same visitor, from the same picks, so the member
            # slide and the group suggestions can never disagree about who you are
            "groups": match_groups(my_interests, my_skills),
            "mine": {
                "interests": sorted(my_interests),
                "skills": sorted(my_skills),
                "ranked": bool(my_interests or my_skills),
            },
            "weights": {"interest": INTEREST_WEIGHT, "skill": SKILL_WEIGHT},
        },
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/groups")
def groups() -> JSONResponse:
    """The group registry on its own, for the profile popup.

    Separate from /api/people on purpose. The suggestion slide is the only thing
    that needs the members, and it is only ever on community.html - the profile
    popup sits in the navbar and is on every page, and it needs the group names
    and blurbs rather than twelve ranked cards. Serving the whole member list to
    render a profile would be the wrong trade.
    """
    registry = load_groups()
    sizes = {
        gid: sum(1 for p in load_people() if gid in (p.get("groups") or []))
        for gid in registry
    }
    return JSONResponse(
        {
            "groups": [
                {
                    "id": gid,
                    "label": g["label"],
                    "blurb": g.get("blurb", ""),
                    "members": sizes[gid],
                }
                for gid, g in registry.items()
            ],
        },
        headers={"Cache-Control": "no-store"},
    )


# Mounted last so /api/* routes win over the static catch-all.
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
else:
    @app.get("/")
    def missing_frontend() -> JSONResponse:
        return JSONResponse(
            {"error": f"Frontend folder not found at {FRONTEND}"}, status_code=500
        )
