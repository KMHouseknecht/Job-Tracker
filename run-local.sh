#!/usr/bin/env bash
set -euo pipefail

PYTHON=${PYTHON:-python3}

echo "Starting backend (uvicorn) on http://127.0.0.1:8787"
nohup $PYTHON -m uvicorn backend.main:app --host 127.0.0.1 --port 8787 --reload > backend.log 2>&1 &

echo "Starting static server on http://127.0.0.1:8000"
nohup $PYTHON -m http.server 8000 > frontend.log 2>&1 &

echo "Servers started. Tail logs with: tail -f backend.log frontend.log"
