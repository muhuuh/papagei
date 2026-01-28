# Papagei STT (Windows-friendly)

This repo contains a minimal Python script that records audio from your laptop microphone and produces a speech-to-text (STT) transcript using NVIDIA NeMo's Parakeet model. The script is intentionally simple and is designed to work on Windows without CUDA or other complex setup.

## What this script does

- Records from the default microphone (press Enter to start and stop).
- Converts audio to 16 kHz mono float32.
- Runs transcription with NeMo's `nvidia/parakeet-tdt-0.6b-v3` model.

## Why this version is Windows-friendly

NeMo's default file-path transcription path uses Lhotse dataloaders. On some Windows + PyTorch combinations this can fail with a `TypeError: object.__init__() takes exactly one argument` when Lhotse builds samplers. The workaround in this script avoids that codepath by passing a NumPy audio array directly to `asr_model.transcribe(...)`.

This keeps the setup lightweight and works on CPU-only machines.

## Setup (Windows)

Create a virtual environment and install dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install "nemo_toolkit[asr]" sounddevice scipy numpy
```

Optional (for hotkeys):

```powershell
python -m pip install keyboard
```

Notes:
- CUDA is optional. The script runs on CPU.
- ffmpeg is only needed if you plan to load non-WAV audio.

## Usage

```powershell
python stt_script.py
```

By default you will press Enter to start recording and Enter again to stop. The transcript is printed to the console.

If you want to test with a WAV file instead of the microphone:

1. Set `USE_SAMPLE_FILE = True` in `stt_script.py`.
2. Set `SAMPLE_AUDIO_FILE` to your WAV path.

## Files created during run

- `temp_audio.wav` is created when recording from mic and is deleted at the end of a run.

## Troubleshooting

- If you see warnings about CUDA, you can ignore them when running on CPU.
- If you need file-path transcription, use a Linux/WSL2 setup or match the NeMo+PyTorch versions recommended in the official docs.
