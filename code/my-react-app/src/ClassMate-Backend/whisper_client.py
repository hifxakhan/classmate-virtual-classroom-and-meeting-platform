import logging
import os
import tempfile

import requests

logger = logging.getLogger(__name__)

# Hardcoded IP for Hugging Face API host to bypass DNS lookup issues.
HUGGINGFACE_IP = "13.224.154.57"

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
    """Use Hugging Face inference API with direct IP to bypass DNS."""
    tmp_path = None

    try:
        hf_token = os.environ.get("HF_TOKEN")

        if not hf_token:
            return "[HF_TOKEN not configured]"

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        api_url = f"https://{HUGGINGFACE_IP}/models/openai/whisper-base"
        headers = {
            "Authorization": f"Bearer {hf_token}",
            "Host": "api-inference.huggingface.co",
        }

        with open(tmp_path, "rb") as audio_file:
            response = requests.post(api_url, headers=headers, data=audio_file, timeout=30)

        if response.status_code == 200:
            result = response.json()
            text = str(result.get("text", "")).strip()
            return text if text else "[No speech detected]"

        if response.status_code == 503:
            return "[Model loading, please retry]"

        return f"[API error: {response.status_code}]"

    except Exception as e:
        logger.error("Transcription error: %s", e)
        return "[Transcription unavailable]"

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
        "api": "huggingface-whisper-ip",
        "dns_bypass": True,
        "free": True,
        "token_configured": bool(hf_token),
    }


def clear_model_cache():
    logger.info("No local model cache to clear for API-based transcription")