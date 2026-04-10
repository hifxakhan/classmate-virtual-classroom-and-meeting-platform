---
title: Whisper AI
emoji: 🎙️
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: 4.44.1
app_file: app.py
pinned: false
license: mit
tags:
  - whisper
  - speech-to-text
  - audio
  - gradio
---

# Whisper AI Transcription Space

This Space runs OpenAI Whisper on CPU Basic hardware and provides:

- Gradio UI for upload + microphone input
- Automatic Gradio API at `/api/predict`
- Additional REST endpoints:
  - `GET /health`
  - `POST /transcribe`

## Local Run

```bash
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Open: `http://localhost:7860`

## API Tests

### Health

```bash
curl http://localhost:7860/health
```

### Gradio Predict API

Gradio `api_name="predict"` exposes `/api/predict`.
For robust file uploads from external backends, prefer `/transcribe`.

### Direct Transcribe API

```bash
curl -X POST "http://localhost:7860/transcribe?model=base&language=auto" \
  -F "file=@sample.wav"
```

Response:

```json
{
  "success": true,
  "text": "Your transcribed text here."
}
```
