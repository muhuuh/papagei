# Papagei (local speech-to-text UI)

A small local app that wraps your NeMo/Parakeet transcription workflow with a start/stop UI. The backend stays running and keeps the model warm, so you can record multiple sessions without restarting the script.

- Frontend: Next.js (App Router) + Tailwind
- Backend: FastAPI (records audio, runs NeMo transcription)

## Why this app exists

The original script ended after a single recording. This app keeps the backend process alive and exposes Start/Stop endpoints, so the UI can trigger many recordings in one session. It also offers a practical workaround for Windows by sending NumPy audio arrays directly to NeMo (bypassing the Lhotse file-path dataloader, which can fail on some Windows + PyTorch combinations).

## Setup

### 1) Backend (FastAPI)

Open PowerShell in the project root:

```powershell
# optional but recommended
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# install backend deps
pip install -r papagei_backend\requirements.txt
```

Run the backend:

```powershell
npm run dev:backend
```

Note: the backend intentionally runs **without** `--reload` to avoid model reload loops on Windows. If you really need reload, use `npm run dev:backend:reload` (slower and less stable).

If you see `WinError 10048` (port 8000 already in use), stop the old backend first:

```powershell
Get-NetTCPConnection -LocalPort 8000 | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
```

Health check: http://127.0.0.1:8000/health

### 2) Frontend (Next.js)

In another terminal:

```powershell
npm install
npm run dev
```

Open: http://localhost:3000

### 3) Run both (recommended)

```powershell
npm run dev:all
```

`dev:all` will:
- start both backend + frontend if the backend is not running, or
- start only the frontend if a backend is already running on port 8000.

If the UI shows "Backend: OFFLINE", it means the FastAPI server is not running on `http://127.0.0.1:8000`.

## Usage

- Click Start to begin recording.
- Click Stop to transcribe and see the text in the UI.
- Enable Auto copy to copy to clipboard after Stop.
- Enable Auto insert to inject text into the currently focused input inside the app.

Browser security prevents automatic typing into other desktop apps. The Auto copy toggle is the simplest way to paste into any other window.

## History storage

Transcripts are saved on disk in `history/history.json` by the backend. The UI loads the most recent items first and lets you fetch older entries.

## Model configuration

Defaults to:

- MODEL_NAME = nvidia/parakeet-tdt-0.6b-v3

Optional environment variables:

```powershell
$env:PAPAGEI_MODEL_NAME="nvidia/parakeet-tdt-0.6b-v3"
$env:PAPAGEI_LOCAL_NEMO_PATH="C:\path\to\parakeet-tdt-0.6b-v3.nemo"
$env:PAPAGEI_DEVICE="Microphone (Realtek...)"
```

If PAPAGEI_LOCAL_NEMO_PATH is set, the backend loads from disk.

## Repo contents

- legacy/stt_script.py - original standalone script (kept for reference)
- papagei_backend/server.py - FastAPI backend + recorder + NeMo transcription
- app/page.tsx - Next.js UI (start/stop, transcript, history)
