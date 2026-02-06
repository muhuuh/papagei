# Papagei (local speech-to-text UI)

A small local app that wraps your NeMo/Parakeet transcription workflow with a start/stop UI. The backend stays running and keeps the model warm, so you can record multiple sessions without restarting the script.

- Frontend: Next.js (App Router) + Tailwind
- Backend: FastAPI (records audio, runs NeMo transcription)

## Why this app exists

The original script ended after a single recording. This app keeps the backend process alive and exposes Start/Stop endpoints, so the UI can trigger many recordings in one session. It also offers a practical workaround for Windows by sending NumPy audio arrays directly to NeMo (bypassing the Lhotse file-path dataloader, which can fail on some Windows + PyTorch combinations).

## Setup (Windows)

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

Health check (optional): `http://127.0.0.1:8000/health`

### 2) Frontend (Next.js)

In another terminal:

```powershell
npm install
npm run dev
```

Open: `http://localhost:4310`

Note: the frontend runs on port 4310 by default. If you change the port in `package.json`, set
`PAPAGEI_FRONTEND_PORT` for the backend CORS allowlist (or update `PAPAGEI_FRONTEND_ORIGINS`).

### 3) Run both (recommended)

```powershell
npm run dev:all
```

`dev:all` will:
- start both backend + frontend if the backend is not running, or
- start only the frontend if a backend is already running on port 8000.

If the UI shows "Backend: OFFLINE", it means the FastAPI server is not running on `http://127.0.0.1:8000`.

### 4) Run everything + hotkeys in one command (optional)

```powershell
npm run dev:all:hotkeys
```

This starts:
- Backend (if not already running)
- Frontend
- AutoHotkey helper (for global hotkeys)

## Usage

- Click Start to begin recording.
- Click Stop to transcribe and see the text in the UI.
- Enable Auto copy to copy to clipboard after Stop.
- Enable Auto insert to inject text into the currently focused input inside the app.

Browser security prevents automatic typing into other desktop apps. The Auto copy toggle is the simplest way to paste into any other window.

## Global hotkeys (Windows)

If you want to start/stop recording without focusing the web UI, use the AutoHotkey helper.

### Install AutoHotkey v2

1) Download AutoHotkey v2 from the official site:

```text
autohotkey.com
```

2) Run the installer and choose the **v2** installation (default options are fine).

### Run the hotkey helper

1) Ensure the backend is running (`npm run dev:backend`, `npm run dev:all`, or `npm run dev:all:hotkeys`).
2) Run the helper script (either):

```powershell
.\scripts\papagei-hotkeys.ahk
```

Or double-click `scripts\papagei-hotkeys.ahk` in File Explorer.

You should see a small tooltip saying "Papagei hotkeys active".

### Default hotkeys

- Start recording: Ctrl + Win + Space
- Stop recording:  Ctrl + Win + S

Important: Windows/AutoHotkey cannot register a hotkey made of only modifiers (e.g. Ctrl+Win by itself). You must include a non-modifier key like Space or S.

### Customize hotkeys

Edit the top of `scripts\papagei-hotkeys.ahk`:

```ahk
BACKEND_URL := "http://127.0.0.1:8000"
HOTKEY_START := "^#Space"
HOTKEY_STOP := "^#S"
```

### Troubleshooting

- If hotkeys do nothing, confirm the backend is running on `http://127.0.0.1:8000`.
- If hotkeys work sometimes, run the helper as Administrator (only needed when targeting apps running as admin).
- Close any other app that already uses the same hotkeys.

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
