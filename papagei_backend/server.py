import os
import threading
import time
from typing import Optional, Dict, Any

import numpy as np
import sounddevice as sd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import torch
import nemo.collections.asr as nemo_asr


SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = "float32"

MODEL_NAME = os.getenv("PAPAGEI_MODEL_NAME", "nvidia/parakeet-tdt-0.6b-v3")
LOCAL_NEMO_PATH = os.getenv("PAPAGEI_LOCAL_NEMO_PATH")  # e.g. C:\Downloads\parakeet-tdt-0.6b-v3.nemo
DEVICE_NAME = os.getenv("PAPAGEI_DEVICE")  # optional, e.g. "Microphone (Realtek...)" or an integer device id

# ---- Model loading (once, at startup) ----
def load_model():
    if LOCAL_NEMO_PATH:
        model = nemo_asr.models.ASRModel.restore_from(LOCAL_NEMO_PATH)
    else:
        model = nemo_asr.models.ASRModel.from_pretrained(MODEL_NAME)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = model.to(device)
    print(f"[papagei] Loaded model on {device}: {LOCAL_NEMO_PATH or MODEL_NAME}")
    return model


asr_model = load_model()


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

# Local dev: allow Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "recording": recorder.recording,
        "model": LOCAL_NEMO_PATH or MODEL_NAME,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "sample_rate": SAMPLE_RATE,
    }


@app.post("/start")
def start():
    try:
        return recorder.start()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Start failed: {e}")


@app.post("/stop")
def stop():
    try:
        audio = recorder.stop()
        secs = recorder.seconds()

        if audio.size == 0:
            return {"text": "", "seconds": secs}

        # NeMo can transcribe from a numpy array
        out = asr_model.transcribe([audio])
        first = out[0]
        text = first.text if hasattr(first, "text") else str(first)

        return {"text": text, "seconds": secs}
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stop/transcribe failed: {e}")
