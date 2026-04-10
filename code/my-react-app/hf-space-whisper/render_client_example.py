import io
import logging
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)


def transcribe_audio(
    audio_bytes: bytes,
    base_url: str = "https://hifxakhan-whisper-ai.hf.space",
    model: str = "base",
    language: str = "auto",
    timeout_seconds: int = 90,
    max_retries: int = 3,
    filename: str = "audio.wav",
) -> str:
    """Send audio bytes to HF Space and return transcription text.

    Uses /transcribe endpoint (multipart file upload), which is easier for server-to-server calls
    than raw Gradio /api/predict payloads.
    """
    if not audio_bytes:
        raise ValueError("audio_bytes cannot be empty")

    url = f"{base_url.rstrip('/')}/transcribe"
    params = {"model": model, "language": language}

    last_error: Optional[Exception] = None
    for attempt in range(1, max_retries + 1):
        try:
            files = {
                "file": (filename, io.BytesIO(audio_bytes), "application/octet-stream")
            }
            logger.info("Transcription attempt %s/%s", attempt, max_retries)
            response = requests.post(url, params=params, files=files, timeout=timeout_seconds)

            if response.status_code >= 500:
                raise RuntimeError(f"Server error {response.status_code}: {response.text[:300]}")

            response.raise_for_status()
            data = response.json()

            if not data.get("success"):
                raise RuntimeError(f"Transcription failed: {data}")

            text = (data.get("text") or "").strip()
            return text

        except Exception as e:
            last_error = e
            logger.warning("Attempt %s failed: %s", attempt, e)
            if attempt < max_retries:
                time.sleep(min(2 ** attempt, 8))

    raise RuntimeError(f"All retries failed. Last error: {last_error}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    # Example local test
    with open("sample.wav", "rb") as f:
        audio = f.read()

    text = transcribe_audio(audio)
    print("Transcription:", text)
