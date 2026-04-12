import logging
import os
import tempfile
import threading
import time

logger = logging.getLogger(__name__)

_model = None
_model_backend = None
_model_name = None
_last_error = None
_last_used_ts = 0.0
_model_lock = threading.Lock()

_MODEL_IDLE_SECONDS = 30 * 60
_FALLBACK_TEXT = "[Transcription unavailable - processing...]"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def _normalize_model_name(model_size: str = None, model: str = None) -> str:
    selected = (model or model_size or os.environ.get("WHISPER_MODEL_SIZE") or "tiny").strip().lower()
    allowed = {"tiny", "base", "small", "medium", "large"}
    return selected if selected in allowed else "tiny"


def _maybe_unload_model_unlocked():
    global _model, _model_backend, _model_name
    if _model is None:
        return

    now = time.time()
    if _last_used_ts and (now - _last_used_ts) > _MODEL_IDLE_SECONDS:
        logger.info("Unloading Whisper model after inactivity")
        _model = None
        _model_backend = None
        _model_name = None


def get_model(model_name: str = None):
    """Lazy-load and cache transcription model with backend fallback."""
    global _model, _model_backend, _model_name, _last_error, _last_used_ts

    desired_model = _normalize_model_name(model_size=model_name)
    use_faster = _env_bool("USE_FASTER_WHISPER", True)
    device = os.environ.get("WHISPER_DEVICE", "cpu")

    with _model_lock:
        _maybe_unload_model_unlocked()

        if _model is not None and _model_name == desired_model:
            _last_used_ts = time.time()
            return _model, _model_backend

        # Reset before loading a different model/backend.
        _model = None
        _model_backend = None
        _model_name = None

        if use_faster:
            try:
                from faster_whisper import WhisperModel

                logger.info("Loading Faster Whisper model=%s device=%s", desired_model, device)
                _model = WhisperModel(desired_model, device=device, compute_type="int8")
                _model_backend = "faster-whisper"
                _model_name = desired_model
                _last_used_ts = time.time()
                _last_error = None
                return _model, _model_backend
            except Exception as exc:
                _last_error = f"faster-whisper load failed: {exc}"
                logger.warning(_last_error)

        try:
            import whisper

            logger.info("Loading OpenAI Whisper model=%s device=%s", desired_model, device)
            _model = whisper.load_model(desired_model, device=device)
            _model_backend = "openai-whisper"
            _model_name = desired_model
            _last_used_ts = time.time()
            _last_error = None
            return _model, _model_backend
        except Exception as exc:
            _last_error = f"openai-whisper load failed: {exc}"
            logger.error(_last_error)
            raise


def transcribe_audio(
    audio_bytes: bytes,
    filename: str = None,
    language: str = None,
    model_size: str = None,
    model: str = None,
) -> str:
    """Transcribe audio and return text, or fallback text on failures."""
    global _last_error, _last_used_ts

    tmp_path = None
    requested_model = _normalize_model_name(model_size=model_size, model=model)

    try:
        if not audio_bytes:
            _last_error = "empty_audio"
            return _FALLBACK_TEXT

        loaded_model, backend = get_model(requested_model)

        suffix = os.path.splitext(filename or "audio.webm")[1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        opts = {}
        if language and language != "auto":
            opts["language"] = language

        if backend == "faster-whisper":
            segments, _info = loaded_model.transcribe(tmp_path, **opts)
            text = " ".join([(seg.text or "").strip() for seg in segments]).strip()
        else:
            result = loaded_model.transcribe(tmp_path, **opts)
            text = (result or {}).get("text", "").strip()

        _last_used_ts = time.time()

        if not text:
            _last_error = "empty_transcription"
            logger.warning("Whisper returned empty transcription")
            return _FALLBACK_TEXT

        logger.info("Transcription successful backend=%s chars=%s", backend, len(text))
        _last_error = None
        return text

    except Exception as exc:
        _last_error = str(exc)
        logger.error("Transcription failed: %s", exc)
        return _FALLBACK_TEXT
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def whisper_healthcheck():
    """Return backend/model/health diagnostics for runtime checks."""
    global _last_error
    try:
        import shutil

        ffmpeg_path = shutil.which("ffmpeg")
        has_ffmpeg = ffmpeg_path is not None
    except Exception:
        has_ffmpeg = False
        ffmpeg_path = None

    try:
        import whisper  # noqa: F401
        whisper_installed = True
    except Exception:
        whisper_installed = False

    try:
        import faster_whisper  # noqa: F401
        faster_whisper_installed = True
    except Exception:
        faster_whisper_installed = False

    return {
        "ok": whisper_installed or faster_whisper_installed,
        "status": "healthy" if (whisper_installed or faster_whisper_installed) else "degraded",
        "backend": _model_backend,
        "model_name": _model_name,
        "model_loaded": _model is not None,
        "whisper_installed": whisper_installed,
        "faster_whisper_installed": faster_whisper_installed,
        "ffmpeg_available": has_ffmpeg,
        "ffmpeg_path": ffmpeg_path,
        "whisper_device": os.environ.get("WHISPER_DEVICE", "cpu"),
        "last_error": _last_error,
        "fallback_text": _FALLBACK_TEXT,
    }