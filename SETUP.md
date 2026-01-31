# Papagei setup checklist (Windows)

1) Create and activate Python venv (or reuse your working NeMo env)
2) Install backend deps: `pip install -r papagei_backend/requirements.txt`
3) Start backend: `npm run dev:backend`
4) Install Node deps: `npm install`
5) Start UI: `npm run dev`
6) Use the UI: Start -> speak -> Stop -> copy transcript

If you get CORS errors, ensure:
- Frontend: http://localhost:3000
- Backend:  http://127.0.0.1:8000

If the UI says "Backend: OFFLINE", run `npm run dev:backend` in a separate terminal (or `npm run dev:all`).

Note: the backend runs without reload to avoid model reload loops on Windows. Use `npm run dev:backend:reload` only if needed.
