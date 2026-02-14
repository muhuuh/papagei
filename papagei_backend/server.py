import json
import os
import queue
import threading
import time
import uuid
from pathlib import Path
from typing import Optional, Dict, Any, List

import numpy as np
import sounddevice as sd
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

import torch
import nemo.collections.asr as nemo_asr


SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = "float32"

MODEL_NAME = os.getenv("PAPAGEI_MODEL_NAME", "nvidia/parakeet-tdt-0.6b-v3")
LOCAL_NEMO_PATH = os.getenv("PAPAGEI_LOCAL_NEMO_PATH")  # e.g. C:\Downloads\parakeet-tdt-0.6b-v3.nemo
DEVICE_NAME = os.getenv("PAPAGEI_DEVICE")  # optional, e.g. "Microphone (Realtek...)" or an integer device id

BASE_DIR = Path(__file__).resolve().parent.parent
HISTORY_DIR = BASE_DIR / "history"
HISTORY_FILE = HISTORY_DIR / "history.json"
_history_lock = threading.Lock()
_event_subscribers_lock = threading.Lock()
_event_subscribers: List[queue.Queue] = []

_model_lock = threading.Lock()
_PHASES = [
    "starting",
    "restoring_model",
    "preparing_device",
    "ready",
]

_model_state: Dict[str, Any] = {
    "state": "starting",
    "phase": "starting",
    "phase_index": 0,
    "message": "Starting backend...",
    "started_at": time.time(),
    "events": [],
    "ready_at": None,
    "error": None,
    "device": None,
}
asr_model = None


def _set_model_state(
    state: str,
    message: Optional[str] = None,
    error: Optional[str] = None,
    device: Optional[str] = None,
    phase: Optional[str] = None,
):
    with _model_lock:
        _model_state["state"] = state
        if message is not None:
            _model_state["message"] = message
        if error is not None:
            _model_state["error"] = error
        if device is not None:
            _model_state["device"] = device
        if phase is not None:
            _model_state["phase"] = phase
            try:
                _model_state["phase_index"] = _PHASES.index(phase)
            except ValueError:
                _model_state["phase_index"] = 0
            _append_event(phase, message)
        if state == "ready":
            _model_state["ready_at"] = time.time()

def _append_event(phase: str, message: Optional[str]) -> None:
    events = _model_state["events"]
    now = time.time()
    if events and events[-1].get("phase") == phase:
        return
    events.append(
        {
            "phase": phase,
            "message": message or "",
            "at": now,
        }
    )

# ---- Model loading (background) ----
def _restore_model():
    if LOCAL_NEMO_PATH:
        return nemo_asr.models.ASRModel.restore_from(LOCAL_NEMO_PATH)
    return nemo_asr.models.ASRModel.from_pretrained(MODEL_NAME)


def _move_model_to_device(model):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = model.to(device)
    return model, device


def _load_model_worker():
    global asr_model
    _set_model_state(
        "loading",
        "Starting model load...",
        phase="starting",
    )
    try:
        _set_model_state(
            "loading",
            "Restoring model weights (download if needed)...",
            phase="restoring_model",
        )
        model = _restore_model()

        _set_model_state(
            "loading",
            "Preparing model on device...",
            phase="preparing_device",
        )
        model, device = _move_model_to_device(model)
        asr_model = model
        print(f"[papagei] Loaded model on {device}: {LOCAL_NEMO_PATH or MODEL_NAME}")
        _set_model_state("ready", f"Model loaded on {device}", device=device, phase="ready")
    except Exception as e:
        _set_model_state("error", "Model load failed", error=str(e))


def _load_history() -> List[Dict[str, Any]]:
    if not HISTORY_FILE.exists():
        return []
    try:
        with HISTORY_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            return []
    except (json.JSONDecodeError, OSError):
        return []


def _write_history(items: List[Dict[str, Any]]) -> None:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    temp_path = HISTORY_FILE.with_suffix(".json.tmp")
    with temp_path.open("w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    temp_path.replace(HISTORY_FILE)


def _format_sse(event_name: str, payload: Dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _publish_event(event_name: str, payload: Dict[str, Any]) -> None:
    message = _format_sse(event_name, payload)
    with _event_subscribers_lock:
        subscribers = list(_event_subscribers)
    for subscriber in subscribers:
        try:
            subscriber.put_nowait(message)
        except queue.Full:
            # Keep the latest event for slow consumers.
            try:
                subscriber.get_nowait()
                subscriber.put_nowait(message)
            except queue.Empty:
                pass


def _append_history(item: Dict[str, Any]) -> None:
    with _history_lock:
        items = _load_history()
        items.append(item)
        _write_history(items)
    _publish_event("history_added", {"item": item})


def _delete_history(item_id: str) -> bool:
    with _history_lock:
        items = _load_history()
        next_items = [item for item in items if item.get("id") != item_id]
        if len(next_items) == len(items):
            return False
        _write_history(next_items)
    _publish_event("history_deleted", {"itemId": item_id})
    return True


# ---- Recorder that can start/stop repeatedly without quitting the process ----
class Recorder:
    def __init__(self):
        self._lock = threading.Lock()
        self._recording: bool = False
        self._stream: Optional[sd.InputStream] = None
        self._chunks: list[np.ndarray] = []
        self._t0: float = 0.0

    @property
    def recording(self) -> bool:
        return self._recording

    def _callback(self, indata, frames, time_info, status):
        if status:
            # don't crash; just log
            print(f"[papagei] Stream status: {status}")
        # indata is float32 with shape (frames, channels)
        self._chunks.append(indata.copy())

    def start(self) -> Dict[str, Any]:
        with self._lock:
            if self._recording:
                raise RuntimeError("Already recording.")
            self._chunks = []
            self._t0 = time.time()

            # Create a new stream each time (simple + reliable)
            self._stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                dtype=DTYPE,
                callback=self._callback,
                device=DEVICE_NAME if DEVICE_NAME else None,
            )
            self._stream.start()
            self._recording = True

            return {"ok": True, "sample_rate": SAMPLE_RATE, "device": DEVICE_NAME or "default"}

    def stop(self) -> np.ndarray:
        with self._lock:
            if not self._recording or self._stream is None:
                raise RuntimeError("Not recording.")

            try:
                self._stream.stop()
                self._stream.close()
            finally:
                self._stream = None
                self._recording = False

            if not self._chunks:
                return np.zeros((0,), dtype=np.float32)

            audio = np.concatenate(self._chunks, axis=0).squeeze()
            # ensure float32 mono
            if audio.ndim > 1:
                audio = np.mean(audio, axis=1)
            return audio.astype(np.float32)

    def seconds(self) -> float:
        if self._t0 <= 0:
            return 0.0
        return max(0.0, time.time() - self._t0)


recorder = Recorder()


# ---- FastAPI app ----
app = FastAPI(title="papagei-backend", version="0.1.0")

FRONTEND_PORT = os.getenv("PAPAGEI_FRONTEND_PORT", "4310")
EXTRA_ORIGINS = os.getenv("PAPAGEI_FRONTEND_ORIGINS", "")

origins = [
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
]
if EXTRA_ORIGINS:
    origins.extend([o.strip() for o in EXTRA_ORIGINS.split(",") if o.strip()])

# Local dev: allow Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    with _model_lock:
        _model_state["events"] = []
        _append_event("starting", "Starting backend...")
    thread = threading.Thread(target=_load_model_worker, daemon=True)
    thread.start()


@app.get("/health")
def health():
    with _model_lock:
        state = _model_state["state"]
        phase = _model_state["phase"]
        phase_index = _model_state["phase_index"]
        message = _model_state["message"]
        error = _model_state["error"]
        device = _model_state["device"]
        started_at = _model_state["started_at"]
        ready_at = _model_state["ready_at"]
        events = list(_model_state.get("events", []))

    is_ready = asr_model is not None and state == "ready"
    if not is_ready and state != "error":
        # Be conservative: if the model isn't set, report loading
        state = "loading"
        phase = "restoring_model" if phase in _PHASES else "starting"
        try:
            phase_index = _PHASES.index(phase)
        except ValueError:
            phase_index = 0
        message = message or "Model is still loading..."

    now = time.time()
    return {
        "ok": True,
        "ready": is_ready,
        "status": state,
        "phase": phase,
        "phase_index": phase_index,
        "phases": _PHASES,
        "progress": phase_index / max(len(_PHASES) - 1, 1),
        "message": message,
        "error": error,
        "events": events,
        "recording": recorder.recording,
        "model": LOCAL_NEMO_PATH or MODEL_NAME,
        "device": device,
        "sample_rate": SAMPLE_RATE,
        "started_at": started_at,
        "ready_at": ready_at,
        "uptime_seconds": max(0.0, now - started_at) if started_at else None,
        "pid": os.getpid(),
    }


@app.post("/start")
def start():
    try:
        if asr_model is None:
            raise HTTPException(status_code=503, detail="Model is still loading. Please wait.")
        return recorder.start()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Start failed: {e}")


@app.post("/stop")
def stop(plain: bool = False):
    try:
        audio = recorder.stop()
        secs = recorder.seconds()

        if audio.size == 0:
            if plain:
                return PlainTextResponse("")
            return {"text": "", "seconds": secs}

        if asr_model is None:
            raise HTTPException(status_code=503, detail="Model is still loading. Please wait.")

        # NeMo can transcribe from a numpy array
        out = asr_model.transcribe([audio])
        first = out[0]
        text = first.text if hasattr(first, "text") else str(first)

        item = {
            "id": uuid.uuid4().hex,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "seconds": secs,
            "text": text,
        }
        _append_history(item)

        if plain:
            return PlainTextResponse(text)
        return {"text": text, "seconds": secs, "item": item}
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stop/transcribe failed: {e}")


@app.get("/history")
def history(limit: int = 10, offset: int = 0):
    limit = max(1, min(int(limit), 50))
    offset = max(0, int(offset))

    with _history_lock:
        items = _load_history()

    total = len(items)
    end = max(total - offset, 0)
    start = max(end - limit, 0)
    slice_items = items[start:end]
    slice_items.reverse()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": slice_items,
    }


@app.get("/events")
def events():
    def event_stream():
        subscriber: queue.Queue = queue.Queue(maxsize=32)
        with _event_subscribers_lock:
            _event_subscribers.append(subscriber)
        yield _format_sse("connected", {"ok": True, "at": time.time()})
        try:
            while True:
                try:
                    message = subscriber.get(timeout=25)
                    yield message
                except queue.Empty:
                    yield _format_sse("ping", {"at": time.time()})
        finally:
            with _event_subscribers_lock:
                try:
                    _event_subscribers.remove(subscriber)
                except ValueError:
                    pass

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)


@app.get("/history/all")
def history_all():
    with _history_lock:
        items = _load_history()
    items.reverse()
    return {
        "total": len(items),
        "items": items,
    }


@app.delete("/history/{item_id}")
def history_delete(item_id: str):
    deleted = _delete_history(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="History item not found.")
    return {"ok": True}
