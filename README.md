# Job Tracker — Local Website + Extension

Quick start (local): run the backend, serve the frontend, and load the extension.

1) Python deps (one-time):

```powershell
C:/Users/1KMH0/AppData/Local/Python/pythoncore-3.14-64/python.exe -m pip install -r requirements.txt
```

2) Start the backend (dev):

```powershell
C:/Users/1KMH0/AppData/Local/Python/pythoncore-3.14-64/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8787 --reload
```

3) Serve the frontend static files (in a separate terminal):

```powershell
# From repo root
python -m http.server 8000
# then open http://127.0.0.1:8000 in your browser
```

4) Load the browser extension (Dev Mode):
- Open `chrome://extensions` (Chrome/Edge)
- Enable `Developer mode`
- Click `Load unpacked` and choose the `browser-extension` folder.
- In the popup, enter Backend URL `http://127.0.0.1:8787` (it may be prefilled) and click `Send` after capturing a posting.

Run locally (one-command):
- PowerShell: run `.un-local.ps1` (starts backend + static server)
- Linux/macOS: run `./run-local.sh`

Docker + compose (one-command local):

```bash
docker compose up --build
```

CI / Deploy
- A GitHub Actions workflow is included to build the backend image and publish the frontend to GitHub Pages. Configure repository settings and secrets as noted in `.github/workflows/ci-deploy.yml`.

Notes
- The extension popup persists the backend URL in extension storage for convenience.
- The frontend will default the Backend URL to `http://127.0.0.1:8787` for local development.# Job Tracker

Starter implementation for an automated job application tracker.

## What this prototype does

- Stores applications in browser localStorage
- Tracks company, position, location, link, salary, date applied, stage, interview date, recruiter, tags, priority, and notes
- Automatically marks stale applications as Ghosted after 14 days without movement
- Lets you paste email text to classify rejection, interview, offer, and follow-up signals
- Includes a capture plugin bookmarklet that can harvest job posting details from the page you are applying on and paste them into the form
- Includes a browser extension scaffold in `browser-extension/` for one-click capture from a job page
- Includes a bulk import box for pasted applied-job lists, so you can bring in entries from Indeed or similar pages
- Can sync the full application list to a backend API when you configure one in the new backend sync panel
- Provides searchable, filterable application history

## Current constraint

Node.js is not installed in this environment, so this workspace uses a framework-free prototype instead of a React/Vite scaffold for now.

## Local backend

The tracker can sync to a local Python backend at `http://127.0.0.1:8787`.

Run it with:

```bash
python backend/server.py
```

The backend accepts `POST /sync` with the full `{ applications, history, syncedAt }` snapshot and stores it in `backend/job-tracker-store.json`.

## Git repo

This workspace is now set up to be initialized as a git repository locally. I can add a remote and push it once you have a GitHub repository URL or auth available in the environment.

## Next upgrade path

1. Replace localStorage with a database such as Dataverse, Airtable, or Supabase.
2. Wire email automation to Outlook or Gmail once a runtime with package support is available.
3. Add authenticated sync and background jobs.
4. Expand the browser extension into a signed distribution package if you want to install it on multiple devices.
