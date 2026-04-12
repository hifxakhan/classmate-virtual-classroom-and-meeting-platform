import logging
import os
import tempfile
import time

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
    """Use Hugging Face's free Whisper API."""
    tmp_path = None

    try:
        hf_token = os.environ.get("HF_TOKEN")

        if not hf_token:
            logger.error("HF_TOKEN not found in environment")
            return "[HF_TOKEN not configured]"

        logger.info("HF_TOKEN found, length: %s", len(hf_token))

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        models = [
            "openai/whisper-base",
            "openai/whisper-small",
            "facebook/wav2vec2-base-960h",
        ]

        headers = {"Authorization": f"Bearer {hf_token}"}

        for model_name in models:
            try:
                api_url = f"https://api-inference.huggingface.co/models/{model_name}"

                with open(tmp_path, "rb") as audio_file:
                    response = requests.post(api_url, headers=headers, data=audio_file, timeout=30)

                if response.status_code == 200:
                    result = response.json()

                    text = ""
                    if isinstance(result, dict):
                        text = str(result.get("text", "")).strip()

                    if text:
                        logger.info("Success with model %s", model_name)
                        return text

                elif response.status_code == 503:
                    logger.info("Model %s is loading, waiting...", model_name)
                    time.sleep(2)
                    continue

                else:
                    logger.warning("Model %s failed: %s", model_name, response.status_code)

            except Exception as model_error:
                logger.warning("Error with %s: %s", model_name, model_error)
                continue

        return "[No speech detected or all models failed]"

    except Exception as e:
        logger.error("Transcription error: %s", e, exc_info=True)
        return f"[Transcription error: {str(e)[:50]}]"

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
        "api": "huggingface-whisper",
        "free": True,
        "token_configured": bool(hf_token),
        "token_length": len(hf_token) if hf_token else 0,
    }


def clear_model_cache():
    logger.info("No local model cache to clear for API-based transcription")