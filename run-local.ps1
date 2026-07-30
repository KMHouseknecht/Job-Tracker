# Start backend (uvicorn) and a simple static server for frontend in new PowerShell windows
param()

$python = "C:/Users/1KMH0/AppData/Local/Python/pythoncore-3.14-64/python.exe"

Write-Host "Starting backend (uvicorn) on http://127.0.0.1:8787..."
Start-Process powershell -ArgumentList "-NoExit","-Command","& '$python' -m uvicorn backend.main:app --host 127.0.0.1 --port 8787 --reload"

Start-Sleep -Seconds 1

Write-Host "Starting static file server on http://127.0.0.1:8000..."
Start-Process powershell -ArgumentList "-NoExit","-Command","& '$python' -m http.server 8000"

Write-Host "Done. Two new windows started: backend and static server. Open http://127.0.0.1:8000"
