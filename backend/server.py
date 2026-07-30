from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


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