import os
import logging
import tempfile

import psutil
from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)

_model_cache = {}

try:
    import threading

    _model_lock = threading.Lock()
except ImportError:
    _model_lock = None


def _normalize_model_size(model_size: str | None) -> str:
    valid_sizes = {"tiny", "base", "small", "medium", "large-v3"}
    normalized = str(model_size or os.getenv("WHISPER_MODEL_SIZE", "base")).strip().lower()

    if normalized not in valid_sizes:
        logger.warning("Invalid model size %s, falling back to base", normalized)
        normalized = "base"

    if os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_SERVICE_ID"):
        if normalized in {"medium", "large-v3"}:
            logger.warning("Railway detected, reducing model size from %s to small", normalized)
            normalized = "small"

    return normalized


def get_whisper_model(model_size: str = "base"):
    """Load and cache a faster-whisper model."""
    resolved_size = _normalize_model_size(model_size)

    cached_model = _model_cache.get(resolved_size)
    if cached_model is not None:
        return cached_model

    def _create_model():
        device = os.getenv("WHISPER_DEVICE", "cpu").strip().lower()
        if device not in {"cpu", "cuda"}:
            device = "cpu"

        compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8").strip().lower()
        if device == "cuda" and compute_type == "int8":
            compute_type = "float16"

        try:
            memory_info = psutil.virtual_memory()
            available_gb = memory_info.available / (1024 ** 3)
            if available_gb < 2 and resolved_size in {"small", "medium", "large-v3"}:
                logger.warning("Very low memory (%.1fGB available), using base", available_gb)
                return WhisperModel("base", device="cpu", compute_type="int8"), "base"
            if available_gb < 4 and resolved_size in {"medium", "large-v3"}:
                logger.warning("Low memory (%.1fGB available), using small", available_gb)
                return WhisperModel("small", device="cpu", compute_type="int8"), "small"
        except Exception:
            pass

        return WhisperModel(resolved_size, device=device, compute_type=compute_type), resolved_size

    if _model_lock:
        with _model_lock:
            cached_model = _model_cache.get(resolved_size)
            if cached_model is not None:
                return cached_model

            logger.info("Loading faster-whisper model %s", resolved_size)
            model, cache_key = _create_model()
            _model_cache[cache_key] = model
            return model

    logger.info("Loading faster-whisper model %s", resolved_size)
    model, cache_key = _create_model()
    _model_cache[cache_key] = model
    return model


def transcribe_audio(
    audio_bytes: bytes,
    filename: str = None,
    language: str = None,
    model_size: str = None,
    model: str = None,
) -> str:
    """
    Transcribe audio using a local faster-whisper model.
    """
    tmp_path = None
    try:
        whisper_model = get_whisper_model(model_size or model or "base")

        # Save audio to temporary file
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        logger.info("Transcribing %s bytes from %s", len(audio_bytes), filename or "audio")

        transcription_options = {
            "beam_size": 5,
            "best_of": 5,
            "temperature": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
            "vad_filter": True,
        }

        if language and language != "auto":
            transcription_options["language"] = language

        segments, info = whisper_model.transcribe(tmp_path, **transcription_options)
        text = " ".join(segment.text for segment in segments).strip()

        if text:
            logger.info("Transcription successful: %s characters, language=%s", len(text), getattr(info, "language", "unknown"))
            return text

        logger.warning("Transcription returned empty text")
        return "[No speech detected]"

    except Exception as e:
        logger.error("Unexpected transcription error: %s", e, exc_info=True)
        return f"[Transcription unavailable - {str(e)[:100]}]"

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def whisper_healthcheck():
    """Health check for the local transcription service."""
    model_name = _normalize_model_size(os.getenv("WHISPER_MODEL_SIZE", "base"))

    try:
        model = get_whisper_model(model_name)
        vm = psutil.virtual_memory()
        memory_info = {
            "total_mb": round(vm.total / (1024 ** 2), 2),
            "available_mb": round(vm.available / (1024 ** 2), 2),
            "percent_used": vm.percent,
        }

        return {
            "ok": True,
            "status": "healthy",
            "api": "local-faster-whisper",
            "model_loaded": model_name,
            "cached_models": list(_model_cache.keys()),
            "memory": memory_info,
            "message": "Local Whisper model is ready",
            "is_local": True,
            "free": True,
            "no_rate_limits": True,
        }
    except Exception as e:
        vm = None
        try:
            vm = psutil.virtual_memory()
        except Exception:
            pass

        memory_info = None
        if vm is not None:
            memory_info = {
                "total_mb": round(vm.total / (1024 ** 2), 2),
                "available_mb": round(vm.available / (1024 ** 2), 2),
                "percent_used": vm.percent,
            }

        return {
            "ok": False,
            "status": "unhealthy",
            "api": "local-faster-whisper",
            "model_loaded": model_name,
            "cached_models": list(_model_cache.keys()),
            "memory": memory_info,
            "message": f"Failed to load model: {e}",
            "is_local": True,
            "free": True,
            "no_rate_limits": True,
        }


def clear_model_cache():
    """Clear cached models to free memory."""
    _model_cache.clear()
    logger.info("Whisper model cache cleared")