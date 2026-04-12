import logging
import os

import requests

logger = logging.getLogger(__name__)

HF_MODEL_URL = os.getenv(
    "HF_WHISPER_MODEL_URL",
    "https://api-inference.huggingface.co/models/openai/whisper-base",
)


def get_whisper_model(model_size: str = "base"):
    """Compatibility shim retained for existing startup hooks."""
    return {"provider": "huggingface", "model": model_size or "base"}


def transcribe_audio(
    audio_bytes: bytes,
    filename: str = None,
    language: str = None,
    model_size: str = None,
    model: str = None,
) -> str:
    """Transcribe audio using Hugging Face Inference API."""
    try:
        token = os.getenv("HF_TOKEN", "").strip()
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        response = requests.post(
            HF_MODEL_URL,
            headers=headers,
            data=audio_bytes,
            timeout=120,
        )

        if response.status_code == 503:
            logger.warning("Model loading on provider side, retrying once")
            response = requests.post(
                HF_MODEL_URL,
                headers=headers,
                data=audio_bytes,
                timeout=120,
            )

        if response.status_code != 200:
            logger.warning("Transcription provider error status=%s body=%s", response.status_code, response.text[:400])
            return "[Transcription temporarily unavailable]"

        payload = response.json()

        if isinstance(payload, dict):
            text = str(payload.get("text") or "").strip()
            if text:
                return text
        elif isinstance(payload, list) and payload:
            first = payload[0]
            if isinstance(first, dict):
                text = str(first.get("text") or "").strip()
                if text:
                    return text

        return "[No speech detected]"

    except Exception as e:
        logger.error("Transcription error: %s", e)
        return "[Transcription error]"


def whisper_healthcheck():
    token_present = bool(os.getenv("HF_TOKEN", "").strip())
    return {
        "ok": True,
        "status": "healthy",
        "api": "huggingface-inference",
        "provider_url": HF_MODEL_URL,
        "token_configured": token_present,
        "free": True,
    }


def clear_model_cache():
    """Compatibility shim retained for existing startup hooks."""
    logger.info("No local model cache to clear for API-based transcription")