import tempfile
import os
import logging

import psutil

logger = logging.getLogger(__name__)

_model = None


def get_whisper_model(model_size: str = "base"):
    """Load or return cached Whisper model - runs 100% locally."""
    global _model

    if _model is not None:
        return _model

    import whisper

    requested_size = str(model_size or "base").strip().lower()
    if os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RAILWAY_SERVICE_ID"):
        if requested_size in {"medium", "large"}:
            logger.warning("Railway detected: using 'small' instead of '%s'", requested_size)
            requested_size = "small"

    try:
        mem = psutil.virtual_memory()
        available_gb = mem.available / (1024 ** 3)

        if available_gb < 1.5 and requested_size == "small":
            logger.warning("Low RAM (%.1fGB), using 'base'", available_gb)
            requested_size = "base"
        elif available_gb < 1.0:
            logger.warning("Very low RAM (%.1fGB), using 'tiny'", available_gb)
            requested_size = "tiny"
    except Exception:
        pass

    logger.info("Loading Whisper model '%s'...", requested_size)
    _model = whisper.load_model(requested_size)
    logger.info("Whisper model loaded successfully")

    return _model


def transcribe_audio(
    audio_bytes: bytes,
    filename: str = None,
    language: str = None,
    model_size: str = None,
    model: str = None,
) -> str:
    """Transcribe audio using local Whisper (no API keys, no rate limits)."""
    tmp_path = None
    try:
        selected_model_size = model_size or model or os.environ.get("WHISPER_MODEL_SIZE", "base")
        whisper_model = get_whisper_model(selected_model_size)

        # Save audio to temporary file
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        logger.info("Transcribing %s bytes with model=%s", len(audio_bytes), selected_model_size)

        options = {}
        if language and language != "auto":
            options["language"] = language

        result = whisper_model.transcribe(tmp_path, **options)
        text = result.get("text", "").strip()

        if text:
            logger.info("Transcription successful: %s characters", len(text))
            return text

        return "[No speech detected]"

    except Exception as e:
        logger.error("Transcription error: %s", e)
        return f"[Transcription error: {str(e)[:100]}]"

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def whisper_healthcheck():
    """Health check for local transcription service."""
    try:
        get_whisper_model("tiny")
        return {
            "ok": True,
            "status": "healthy",
            "api": "local-whisper",
            "free": True,
            "no_rate_limits": True,
            "no_api_key_needed": True,
            "model_loaded": "tiny",
        }
    except Exception as e:
        return {
            "ok": False,
            "status": "unhealthy",
            "error": str(e),
            "api": "local-whisper",
            "free": True,
        }


def clear_model_cache():
    """Clear cached model to free memory."""
    global _model
    _model = None
    logger.info("Whisper model cache cleared")