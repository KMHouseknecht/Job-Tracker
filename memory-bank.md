# Memory Bank

- Project: Job Tracker
- Workspace path: c:\Users\1KMH0\OneDrive\Documents\Github\Job Tracker
- Current implementation: framework-free browser prototype with localStorage persistence
- Core features implemented: application CRUD, stage filtering, search, ghosting automation, email-text classification, capture bookmarklet, browser extension scaffold, backend sync panel, seed data
- Core features implemented: application CRUD, stage filtering, search, ghosting automation, email-text classification, capture bookmarklet, browser extension scaffold, backend sync panel, bulk applied-jobs import, seed data
- Validation: page renders successfully in browser and the seeded counters match the loaded sample data
- Environment constraint: Node.js is not installed in this environment, so React/Vite scaffolding is deferred
- Next upgrade path: wire a database, add real Outlook/Gmail integration, and migrate to a full app framework when Node is available
- Capture path: bookmarklet runs on the job page, copies a structured payload, and the tracker imports that payload into the form
- Extension path: a Manifest V3 scaffold lives in browser-extension/ and can capture from any active tab
- Backend path: a Python stdlib server lives in backend/server.py, listens on 127.0.0.1:8787, and persists snapshots to backend/job-tracker-store.json
- Repo path: add .gitignore before initializing git so the generated backend snapshot and Python cache stay out of source control
