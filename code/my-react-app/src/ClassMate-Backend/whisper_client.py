import tempfile
import os
import logging

import psutil

logger = logging.getLogger(__name__)

_model = None


def get_whisper_model(model_size: str = "base"):
    global _model

    if _model is not None:
        return _model

    import whisper

    selected_model_size = model_size
    if os.environ.get("RAILWAY_ENVIRONMENT"):
        if selected_model_size in ["medium", "large"]:
            selected_model_size = "small"

    try:
        mem = psutil.virtual_memory()
        available_gb = mem.available / (1024 ** 3)
        if available_gb < 1.5 and selected_model_size == "small":
            selected_model_size = "base"
        elif available_gb < 1.0:
            selected_model_size = "tiny"
    except Exception:
        pass

    logger.info("Loading Whisper model '%s'...", selected_model_size)
    _model = whisper.load_model(selected_model_size)
    logger.info("Model loaded")
    return _model


def transcribe_audio(
    audio_bytes: bytes,
    filename: str = None,
    language: str = None,
    model_size: str = None,
    model: str = None,
) -> str:
    tmp_path = None

    try:
        selected_model_size = model_size or os.environ.get("WHISPER_MODEL_SIZE", "base")
        whisper_model = get_whisper_model(selected_model_size)

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        options = {}
        if language and language != "auto":
            options["language"] = language

        result = whisper_model.transcribe(tmp_path, **options)
        text = result["text"].strip()

        return text if text else "[No speech detected]"

    except Exception as e:
        logger.error("Transcription error: %s", e)
        return "[Transcription error]"

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def whisper_healthcheck():
    try:
        import whisper

        return {
            "ok": True,
            "status": "healthy",
            "free": True,
            "no_rate_limits": True,
            "no_api_key_needed": True,
            "api": "local-whisper",
        }
    except Exception as e:
        return {
            "ok": False,
            "status": "unhealthy",
            "error": str(e),
            "api": "local-whisper",
        }


def clear_model_cache():
    global _model
    _model = None
    logger.info("Model cache cleared")