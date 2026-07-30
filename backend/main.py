from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from sqlmodel import Session, select
from .db import get_engine, create_db_and_tables
from .models import Application, History
import httpx
import re
from html import unescape
from pathlib import Path


app = FastAPI(title="Job Tracker API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
engine = get_engine()
create_db_and_tables(engine)


class SyncPayload(BaseModel):
    applications: List[dict]
    history: List[dict]


@app.get("/health")
def health():
    return {"ok": True, "message": "Job Tracker API running."}


@app.post("/sync")
def sync(payload: SyncPayload):
    # naive snapshot replace for now - user_id not implemented yet
    with Session(engine) as session:
        # clear previous rows for this user (single-user behavior)
        session.exec(select(History)).all()  # no-op to satisfy static analyzers
        # simple replace-all behavior: delete existing apps and history
        session.exec("DELETE FROM history")
        session.exec("DELETE FROM application")
        session.commit()

        for app_obj in payload.applications:
            a = Application(
                company=app_obj.get("company", ""),
                position=app_obj.get("position", ""),
                location=app_obj.get("location"),
                link=app_obj.get("link"),
                salary=app_obj.get("salary"),
                source_site=app_obj.get("sourceSite"),
                date_applied=app_obj.get("dateApplied"),
                stage=app_obj.get("stage", "Applied"),
                notes=app_obj.get("notes"),
            )
            session.add(a)

        for h in payload.history:
            history = History(
                application_id=h.get("applicationId"),
                event=h.get("reason") or h.get("event") or str(h),
            )
            session.add(history)

        session.commit()

    return {"ok": True, "message": "Snapshot stored.", "applicationCount": len(payload.applications)}


def strip_tags(text: str, limit: int = 1400) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", "", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return unescape(text)[:limit]


def first_meta(html: str, names: list[str]) -> str | None:
    for name in names:
        m = re.search(rf'<meta[^>]+(?:property|name)=["\']{re.escape(name)}["\'][^>]*content=["\']([^"\']+)["\']', html, re.I)
        if m:
            return unescape(m.group(1).strip())
    return None


def extract_json_ld(html: str) -> list[dict]:
    items: list[dict] = []
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>', html, re.I):
        try:
            import json

            data = json.loads(m.group(1))
            if isinstance(data, list):
                items.extend(data)
            else:
                items.append(data)
        except Exception:
            continue
    return items


async def fetch_text(url: str) -> str:
    async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": "JobTrackerBot/1.0"}) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.text


@app.post("/fetch-jobs")
async def fetch_jobs(payload: dict):
    urls = payload.get("urls")
    if not isinstance(urls, list):
        raise HTTPException(status_code=400, detail="urls must be a list")

    results = []
    for url in urls:
        try:
            html = await fetch_text(url)
            title = first_meta(html, ["og:title", "twitter:title", "title"]) or ""
            if not title:
                m = re.search(r"<title>([\s\S]*?)</title>", html, re.I)
                if m:
                    title = unescape(m.group(1).strip())

            description = first_meta(html, ["og:description", "twitter:description", "description"]) or ""
            if not description:
                m = re.search(r"<p[^>]*>([\s\S]*?)</p>", html, re.I)
                if m:
                    description = strip_tags(m.group(1), 800)

            jsonlds = extract_json_ld(html)
            company = ""
            location = ""
            salary = ""
            for item in jsonlds:
                if isinstance(item, dict):
                    org = item.get("hiringOrganization") or item.get("employer")
                    if isinstance(org, dict):
                        company = company or org.get("name")
                    elif isinstance(org, str):
                        company = company or org
                    if not location:
                        jl = item.get("jobLocation")
                        if isinstance(jl, dict):
                            addr = jl.get("address") or {}
                            if isinstance(addr, dict):
                                location = location or addr.get("addressLocality") or addr.get("addressRegion")
                    if not salary:
                        base = item.get("baseSalary")
                        if isinstance(base, dict):
                            try:
                                if isinstance(base.get("value"), dict):
                                    minv = base["value"].get("minValue")
                                    maxv = base["value"].get("maxValue")
                                    if minv and maxv:
                                        salary = f"${minv}-{maxv}"
                            except Exception:
                                pass

            if not company:
                company = first_meta(html, ["og:site_name", "application-name"]) or re.sub(r"https?://(www\.)?", "", url).split("/")[0]

            job = {
                "company": (company or "").strip(),
                "position": (title or "").strip(),
                "location": (location or "").strip(),
                "salary": (salary or "").strip(),
                "link": url,
                "sourceSite": re.sub(r"https?://(www\.)?", "", url).split("/")[0],
                "dateApplied": __import__("datetime").datetime.utcnow().date().isoformat(),
                "stage": "Applied",
                "notes": (description or "").strip(),
            }
            results.append({"ok": True, "url": url, "job": job})
        except Exception as exc:
            results.append({"ok": False, "url": url, "error": str(exc)})

    return JSONResponse({"ok": True, "jobs": results})


@app.get("/apps")
def list_apps():
    with Session(engine) as session:
        apps = session.exec(select(Application)).all()
        return {"ok": True, "applications": [a.dict() for a in apps]}


@app.post("/apps")
def create_app(item: dict):
    # accept a single application payload and persist it
    try:
        normalized = {
            "company": item.get("company", "").strip(),
            "position": item.get("position", "").strip(),
            "location": item.get("location", "").strip(),
            "link": item.get("link", "").strip(),
            "salary": item.get("salary", "").strip(),
            "source_site": item.get("sourceSite", item.get("source_site", "")).strip(),
            "date_applied": item.get("dateApplied", item.get("date_applied")),
            "stage": item.get("stage", "Applied"),
            "notes": item.get("notes", ""),
        }
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payload")

    with Session(engine) as session:
        app_obj = Application(
            company=normalized["company"],
            position=normalized["position"],
            location=normalized["location"],
            link=normalized["link"],
            salary=normalized["salary"],
            source_site=normalized["source_site"],
            date_applied=normalized["date_applied"],
            stage=normalized["stage"],
            notes=normalized["notes"],
        )
        session.add(app_obj)
        session.commit()
        session.refresh(app_obj)

    return JSONResponse({"ok": True, "application": app_obj.dict()})
