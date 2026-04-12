import logging
import os
import tempfile

import requests
import dns.resolver
import urllib3.util.connection
from urllib3.util.connection import create_connection as _original_create_connection

logger = logging.getLogger(__name__)


def custom_create_connection(address, *args, **kwargs):
    """Resolve DNS via Google DNS, then connect to the resolved IP."""
    host, port = address

    resolver = dns.resolver.Resolver()
    resolver.nameservers = ["8.8.8.8"]

    try:
        answers = resolver.resolve(host, "A")
        ip_address = str(answers[0])
        logger.info("Resolving %s -> %s", host, ip_address)
        return _original_create_connection((ip_address, port), *args, **kwargs)
    except Exception as e:
        logger.error("DNS resolution failed for %s: %s", host, e)
        return _original_create_connection(address, *args, **kwargs)


# Apply DNS override for outbound HTTP calls made through urllib3/requests.
urllib3.util.connection.create_connection = custom_create_connection

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
    """Use Hugging Face's free Whisper API with custom DNS resolver."""
    tmp_path = None

    try:
        hf_token = os.environ.get("HF_TOKEN")

        if not hf_token:
            return "[HF_TOKEN not configured]"

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        api_url = "https://router.huggingface.co/models/openai/whisper-base"
        headers = {"Authorization": f"Bearer {hf_token}"}

        with open(tmp_path, "rb") as audio_file:
            response = requests.post(api_url, headers=headers, data=audio_file, timeout=60)

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
        "api": "huggingface-whisper-router",
        "dns_fix": "custom resolver with 8.8.8.8",
        "free": True,
        "token_configured": bool(hf_token),
    }


def clear_model_cache():
    logger.info("No local model cache to clear for API-based transcription")