import io
import logging
import os
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

WHISPER_SPACE_URL = os.getenv("WHISPER_SPACE_URL", "https://hifxakhan-whisper-ai.hf.space")
WHISPER_ENDPOINT = f"{WHISPER_SPACE_URL.rstrip('/')}/transcribe"
HF_TOKEN = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_API_KEY")
DEFAULT_TIMEOUT_SECONDS = int(os.getenv("WHISPER_TIMEOUT_SECONDS", "90"))
MAX_RETRIES = int(os.getenv("WHISPER_MAX_RETRIES", "3"))


def _build_headers() -> dict:
    headers = {
        "User-Agent": "ClassMate-Backend/1.0",
        "Accept": "application/json",
    }
    if HF_TOKEN:
        headers["Authorization"] = f"Bearer {HF_TOKEN}"
    return headers


def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm", language: str = "auto", model: str = "base") -> str:
    """Call HF Space /transcribe endpoint and return text.

    - Uses Bearer token from HF_TOKEN when available.
    - Retries transient failures with exponential backoff.
    - Timeout defaults to 90s for CPU inference.
    """
    if not audio_bytes:
        raise ValueError("audio_bytes cannot be empty")

    headers = _build_headers()
    params = {"language": language, "model": model}

    last_error: Optional[Exception] = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            files = {
                "file": (
                    filename,
                    io.BytesIO(audio_bytes),
                    "application/octet-stream",
                )
            }

            logger.info(
                "Whisper request attempt=%s url=%s bytes=%s token_present=%s",
                attempt,
                WHISPER_ENDPOINT,
                len(audio_bytes),
                bool(HF_TOKEN),
            )

            response = requests.post(
                WHISPER_ENDPOINT,
                params=params,
                headers=headers,
                files=files,
                timeout=DEFAULT_TIMEOUT_SECONDS,
            )

            if response.status_code in (429, 500, 502, 503, 504):
                raise RuntimeError(f"Transient Whisper error: {response.status_code} {response.text[:300]}")

            response.raise_for_status()
            payload = response.json()

            text = (payload.get("text") or "").strip()
            if not text and payload.get("success") is False:
                raise RuntimeError(f"Whisper returned unsuccessful payload: {payload}")

            return text

        except Exception as exc:
            last_error = exc
            logger.warning("Whisper attempt %s failed: %s", attempt, exc)
            if attempt < MAX_RETRIES:
                time.sleep(min(2 ** attempt, 8))

    logger.error("Whisper failed after %s attempts", MAX_RETRIES)
    raise RuntimeError(f"Whisper transcription failed after retries: {last_error}")


def whisper_healthcheck() -> dict:
    """Basic healthcheck for the remote Whisper Space."""
    headers = _build_headers()
    health_url = f"{WHISPER_SPACE_URL.rstrip('/')}/health"
    try:
        response = requests.get(health_url, headers=headers, timeout=15)
        ok = response.status_code == 200
        body = None
        try:
            body = response.json()
        except Exception:
            body = {"raw": response.text[:200]}

        return {
            "ok": ok,
            "status_code": response.status_code,
            "endpoint": health_url,
            "token_present": bool(HF_TOKEN),
            "response": body,
        }
    except Exception as exc:
        logger.exception("Whisper healthcheck failed")
        return {
            "ok": False,
            "status_code": None,
            "endpoint": health_url,
            "token_present": bool(HF_TOKEN),
            "error": str(exc),
        }
