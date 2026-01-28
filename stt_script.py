import nemo.collections.asr as nemo_asr
import sounddevice as sd
import numpy as np
import scipy.io.wavfile as wavfile
from scipy.signal import resample_poly
import os
import time
import torch

try:
    import keyboard
    HAS_KEYBOARD = True
except Exception:
    keyboard = None
    HAS_KEYBOARD = False

# Optional: For chaining (pip install ollama)
# import ollama

# Model config
MODEL_NAME = "nvidia/parakeet-tdt-0.6b-v3"
LOCAL_NEMO_PATH = None  # e.g., r"C:\Downloads\parakeet-tdt-0.6b-v3.nemo"

USE_SAMPLE_FILE = False  # Set to True for file test; False for mic
SAMPLE_AUDIO_FILE = "file_example_WAV_1MG.wav"  # Download from https://file-examples.com/storage/fe7b6b0b7a66b2b2f4d6b8d/2017/11/file_example_WAV_1MG.wav
USE_KEYBOARD_HOTKEYS = False  # True to use 's'/'q' hotkeys; requires keyboard module to work

# Load model
try:
    if LOCAL_NEMO_PATH:
        asr_model = nemo_asr.models.ASRModel.restore_from(LOCAL_NEMO_PATH)
    else:
        asr_model = nemo_asr.models.ASRModel.from_pretrained(MODEL_NAME)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    asr_model = asr_model.to(device)
    print(f"Model loaded on {device}.")
except Exception as e:
    print(f"Load error: {e}")
    exit(1)

SAMPLE_RATE = 16000
AUDIO_FILE = 'temp_audio.wav' if not USE_SAMPLE_FILE else SAMPLE_AUDIO_FILE

def _to_mono_float32(samples: np.ndarray) -> np.ndarray:
    if samples.ndim > 1:
        samples = np.mean(samples, axis=1)
    if np.issubdtype(samples.dtype, np.integer):
        info = np.iinfo(samples.dtype)
        samples = samples.astype(np.float32) / float(info.max)
    else:
        samples = samples.astype(np.float32)
    return samples

def _load_and_resample(path: str) -> np.ndarray:
    sr, data = wavfile.read(path)
    data = _to_mono_float32(data)
    if sr != SAMPLE_RATE:
        data = resample_poly(data, SAMPLE_RATE, sr).astype(np.float32)
    return data

def record_audio():
    if USE_SAMPLE_FILE:
        print("Using sample file for testing.")
        if not os.path.exists(AUDIO_FILE):
            print(f"Sample file not found: {AUDIO_FILE}")
            return None
        return _load_and_resample(AUDIO_FILE)
    if USE_KEYBOARD_HOTKEYS and HAS_KEYBOARD:
        print("Press 's' to start, 'q' to stop...")
    else:
        print("Press Enter to start, Enter again to stop...")
    recording = []
    
    def callback(indata, frames, time, status):
        if status:
            print(f"Stream status: {status}")
        recording.append(indata.copy())
    
    if USE_KEYBOARD_HOTKEYS and HAS_KEYBOARD:
        while not keyboard.is_pressed('s'):
            time.sleep(0.01)
    else:
        input()
    print("Recording...")
    
    try:
        stream = sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", callback=callback)
        with stream:
            if USE_KEYBOARD_HOTKEYS and HAS_KEYBOARD:
                while not keyboard.is_pressed('q'):
                    time.sleep(0.01)
            else:
                input()
        print("Stopped.")
    except Exception as e:
        print(f"Record error: {e}")
        return None
    
    if recording:
        recording = np.concatenate(recording, axis=0).squeeze()
        audio = _to_mono_float32(recording)
        audio_int16 = np.int16(np.clip(audio, -1.0, 1.0) * 32767)
        wavfile.write(AUDIO_FILE, SAMPLE_RATE, audio_int16)
        return audio
    return None

audio_np = record_audio()
if audio_np is not None:
    try:
        output = asr_model.transcribe([audio_np])
        first = output[0]
        text = first.text if hasattr(first, "text") else first
        print("Raw Transcription:", text)
        
        # Chain example (uncomment after pip install ollama; run Ollama server)
        # corrected = ollama.generate(model='your-finetuned-german', prompt=f"Correct this: {text}")['response']
        # print("Corrected:", corrected)
    except Exception as e:
        print(f"Transcribe error: {e}")
    finally:
        if not USE_SAMPLE_FILE and os.path.exists(AUDIO_FILE):
            os.remove(AUDIO_FILE)
else:
    print("No audio file found.")
