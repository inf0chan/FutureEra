"""
Future Era - FastAPI backend.

Serves two things from one process on one port:

  1. The career data as JSON at /api/career-data
  2. The static site itself (Frontend/) at /

The data used to live in Frontend/career-data.js as a JS file the browser
executed directly. It now lives in Backend/data/career_data.json and reaches
the browser over HTTP, so the backend genuinely owns it.

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

# every collection the frontend expects. Missing any of these means the JSON and
# script.js have drifted apart, so we fail loudly at startup instead of letting
# the page fail with an undefined error in the console.
REQUIRED = (
    "RESOURCES", "STREAMS", "DURATIONS", "DEGREES", "INTERESTS",
    "HOBBIES", "SKILLS", "ROLES", "PHASES", "GENERIC_ITEM", "GENERIC_PHASES",
)


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


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Fail fast at startup if the data file is missing or malformed."""
    data = load_data()
    counts = ", ".join(
        f"{k}={len(v)}" for k, v in data.items() if isinstance(v, (list, dict))
    )
    print(f"[career data ok] {counts}")
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


# Mounted last so /api/* routes win over the static catch-all.
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
else:
    @app.get("/")
    def missing_frontend() -> JSONResponse:
        return JSONResponse(
            {"error": f"Frontend folder not found at {FRONTEND}"}, status_code=500
        )
