import requests
import os
import logging

logger = logging.getLogger(__name__)

HF_SPACE_URL = "https://hifxakhan-whisper-ai.hf.space"


def transcribe_audio(audio_bytes: bytes, filename: str = None, language: str = None, model: str = None) -> str:
    """Use HF Space for transcription (no external DNS issues)"""
    try:
        response = requests.post(
            f"{HF_SPACE_URL}/transcribe",
            files={"audio": ("audio.webm", audio_bytes, "audio/webm")},
            timeout=90
        )

        if response.status_code == 200:
            result = response.json()
            return result.get("text", "")
        else:
            logger.error(f"HF Space error: {response.status_code}")
            return ""

    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        return ""


def whisper_healthcheck():
    return {"status": "healthy", "api": "hf-space", "url": HF_SPACE_URL}
