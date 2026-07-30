from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
import re
import urllib.request
from html import unescape


ROOT = Path(__file__).resolve().parent
STORE_PATH = ROOT / "job-tracker-store.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_store() -> dict[str, Any]:
    if not STORE_PATH.exists():
        return {
            "version": 1,
            "syncedAt": None,
            "receivedAt": None,
            "applicationCount": 0,
            "historyCount": 0,
            "applications": [],
            "history": [],
            "syncLog": [],
        }

    try:
        return json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {
            "version": 1,
            "syncedAt": None,
            "receivedAt": None,
            "applicationCount": 0,
            "historyCount": 0,
            "applications": [],
            "history": [],
            "syncLog": [],
        }


def write_store(store: dict[str, Any]) -> None:
    temp_path = STORE_PATH.with_suffix(".json.tmp")
    temp_path.write_text(json.dumps(store, indent=2, ensure_ascii=True), encoding="utf-8")
    temp_path.replace(STORE_PATH)


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, indent=2, ensure_ascii=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


class JobTrackerHandler(BaseHTTPRequestHandler):
    server_version = "JobTrackerSync/1.0"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/", "/health"}:
            store = load_store()
            json_response(
                self,
                HTTPStatus.OK,
                {
                    "ok": True,
                    "message": "Job Tracker sync backend is running.",
                    "syncedAt": store.get("syncedAt"),
                    "applicationCount": len(store.get("applications", [])),
                    "historyCount": len(store.get("history", [])),
                },
            )
            return

        if self.path == "/sync":
            store = load_store()
            json_response(self, HTTPStatus.OK, store)
            return

        json_response(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/fetch-jobs":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                content_length = 0

            raw_body = self.rfile.read(content_length).decode("utf-8") if content_length else ""
            try:
                payload = json.loads(raw_body) if raw_body else {}
            except json.JSONDecodeError:
                json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Request body must be valid JSON."})
                return

            urls = payload.get("urls") if isinstance(payload, dict) else None
            if not isinstance(urls, list):
                json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Payload must include urls[] list."})
                return

            jobs = []
            for url in urls:
                try:
                    job = fetch_and_parse_job(url)
                    jobs.append({"ok": True, "url": url, "job": job})
                except Exception as exc:  # pragma: no cover - best-effort parsing
                    jobs.append({"ok": False, "url": url, "error": str(exc)})

            json_response(self, HTTPStatus.OK, {"ok": True, "jobs": jobs})
            return

        if self.path != "/sync":
            json_response(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0

        raw_body = self.rfile.read(content_length).decode("utf-8") if content_length else ""

        try:
            payload = json.loads(raw_body) if raw_body else {}
        except json.JSONDecodeError:
            json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Request body must be valid JSON."})
            return

        applications = payload.get("applications") if isinstance(payload, dict) else None
        history = payload.get("history") if isinstance(payload, dict) else None
        synced_at = payload.get("syncedAt") if isinstance(payload, dict) else None

        if not isinstance(applications, list) or not isinstance(history, list):
            json_response(
                self,
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "Payload must include applications[] and history[]."},
            )
            return

        store = {
            "version": 1,
            "syncedAt": synced_at or utc_now(),
            "receivedAt": utc_now(),
            "applicationCount": len(applications),
            "historyCount": len(history),
            "applications": applications,
            "history": history,
            "syncLog": load_store().get("syncLog", []),
        }

        store["syncLog"].insert(
            0,
            {
                "receivedAt": store["receivedAt"],
                "syncedAt": store["syncedAt"],
                "applicationCount": len(applications),
                "historyCount": len(history),
            },
        )
        store["syncLog"] = store["syncLog"][:25]

        write_store(store)

        json_response(
            self,
            HTTPStatus.OK,
            {
                "ok": True,
                "message": "Snapshot stored successfully.",
                "storedAt": store["receivedAt"],
                "applicationCount": len(applications),
                "historyCount": len(history),
            },
        )


def fetch_url_text(url: str, timeout: int = 10) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "JobTrackerBot/1.0 (+https://example.com)"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        content_type = resp.headers.get("Content-Type", "")
        raw = resp.read()
        # Attempt to decode using charset if provided
        m = re.search(r"charset=([^;]+)", content_type, re.I)
        if m:
            try:
                return raw.decode(m.group(1).strip(), errors="replace")
            except Exception:
                pass
        for enc in ("utf-8", "windows-1252", "iso-8859-1"):
            try:
                return raw.decode(enc, errors="replace")
            except Exception:
                continue
        return raw.decode("utf-8", errors="replace")


def first_meta(html: str, names: list[str]) -> str | None:
    for name in names:
        # property or name
        m = re.search(rf'<meta[^>]+(?:property|name)=["\']{re.escape(name)}["\'][^>]*content=["\']([^"\']+)["\']', html, re.I)
        if m:
            return unescape(m.group(1).strip())
    return None


def extract_json_ld(html: str) -> list[dict]:
    items: list[dict] = []
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>', html, re.I):
        try:
            data = json.loads(m.group(1))
            if isinstance(data, list):
                items.extend(data)
            else:
                items.append(data)
        except Exception:
            continue
    return items


def strip_tags(text: str, limit: int = 1400) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", "", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return unescape(text)[:limit]


def fetch_and_parse_job(url: str) -> dict[str, str]:
    html = fetch_url_text(url)

    # title
    title = first_meta(html, ["og:title", "twitter:title", "title"]) or ""
    if not title:
        m = re.search(r"<title>([\s\S]*?)</title>", html, re.I)
        if m:
            title = unescape(m.group(1).strip())

    # description
    description = first_meta(html, ["og:description", "twitter:description", "description"]) or ""
    if not description:
        # fallback to first meaningful paragraph
        m = re.search(r"<p[^>]*>([\s\S]*?)</p>", html, re.I)
        if m:
            description = strip_tags(m.group(1), 800)

    # JSON-LD hints
    jsonlds = extract_json_ld(html)
    company = ""
    location = ""
    salary = ""
    for item in jsonlds:
        if isinstance(item, dict):
            if not company:
                org = item.get("hiringOrganization") or item.get("employer")
                if isinstance(org, dict):
                    company = org.get("name") or company
                elif isinstance(org, str):
                    company = org or company

            if not location:
                jl = item.get("jobLocation") or item.get("jobLocationType")
                if isinstance(jl, dict):
                    addr = jl.get("address") or {}
                    if isinstance(addr, dict):
                        location = addr.get("addressLocality") or addr.get("addressRegion") or location

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

    # fallback company from site
    if not company:
        company = first_meta(html, ["og:site_name", "application-name"]) or re.sub(r"https?://(www\.)?", "", url).split("/")[0]

    position = title or ""

    return {
        "company": (company or "").strip(),
        "position": (position or "").strip(),
        "location": (location or "").strip(),
        "salary": (salary or "").strip(),
        "link": url,
        "sourceSite": re.sub(r"https?://(www\.)?", "", url).split("/")[0],
        "dateApplied": datetime.now(timezone.utc).date().isoformat(),
        "stage": "Applied",
        "notes": (description or "").strip(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Job Tracker sync backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), JobTrackerHandler)
    print(f"Job Tracker sync backend listening on http://{args.host}:{args.port}")
    print(f"Snapshot store: {STORE_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()