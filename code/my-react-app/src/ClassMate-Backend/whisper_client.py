import logging

logger = logging.getLogger(__name__)

_model = None


def get_whisper_model(model_size: str = "base"):
    """Compatibility shim so preload/startup hooks do not fail."""
    global _model
    _model = {"placeholder": True, "model": model_size}
    return _model


def transcribe_audio(
    audio_bytes: bytes,
    filename: str = None,
    language: str = None,
    model_size: str = None,
    model: str = None,
) -> str:
    """Placeholder transcription to keep the app operational during deploy recovery."""
    size = len(audio_bytes) if audio_bytes else 0
    logger.info("Placeholder transcription requested bytes=%s filename=%s", size, filename or "audio")
    return "[Transcription will be available soon]"


def whisper_healthcheck():
    return {
        "ok": True,
        "status": "degraded",
        "message": "Transcription service coming soon",
        "placeholder": True,
    }


def clear_model_cache():
    global _model
    _model = None
    logger.info("Model cache cleared")