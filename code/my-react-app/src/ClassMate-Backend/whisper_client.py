import logging
import os
import tempfile

import requests

logger = logging.getLogger(__name__)

def get_whisper_model(model_size: str = "base"):
    """Compatibility shim for existing preload hooks."""
    return {"provider": "huggingface", "model": model_size or "base"}


def transcribe_audio(
    audio_bytes: bytes,
    filename: str = None,
    language: str = None,
    model_size: str = None,
    model: str = None,
) -> str:
    """Debug version - shows exactly what Hugging Face returns."""
    tmp_path = None

    try:
        hf_token = os.environ.get("HF_TOKEN")

        if not hf_token:
            return "[HF_TOKEN not configured]"

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        api_url = "https://api-inference.huggingface.co/models/openai/whisper-base"
        headers = {"Authorization": f"Bearer {hf_token}"}

        with open(tmp_path, "rb") as audio_file:
            response = requests.post(api_url, headers=headers, data=audio_file, timeout=30)

        logger.info("Status: %s", response.status_code)
        logger.info("Response headers: %s", dict(response.headers))
        logger.info("Response body: %s", response.text[:500])

        if response.status_code == 200:
            result = response.json()
            text = str(result.get("text", "")).strip()
            return text if text else "[No speech detected]"

        return f"[API {response.status_code}: {response.text[:100]}]"

    except Exception as e:
        logger.error("Error: %s", e, exc_info=True)
        return f"[Error: {str(e)[:100]}]"

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def whisper_healthcheck():
    hf_token = os.environ.get("HF_TOKEN")
    return {
        "ok": bool(hf_token),
        "status": "healthy" if hf_token else "needs_token",
        "api": "huggingface-whisper-debug",
        "token_configured": bool(hf_token),
    }


def clear_model_cache():
    logger.info("No local model cache to clear for API-based transcription")