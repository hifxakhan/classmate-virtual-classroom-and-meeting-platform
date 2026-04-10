import tempfile
import os
import logging

logger = logging.getLogger(__name__)

# Lazy load the model (load only when first needed)
_model = None


def get_model():
    """Load Whisper model on first use"""
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        logger.info("Loading Whisper model (tiny)...")
        # Use tiny model for speed, int8 for memory efficiency
        _model = WhisperModel("tiny", device="cpu", compute_type="int8")
        logger.info("Whisper model loaded successfully!")
    return _model


def transcribe_audio(audio_bytes: bytes, filename: str = None, language: str = None, model_size: str = None) -> str:
    """
    Transcribe audio using local faster-whisper model.
    NO external API calls - runs entirely on Render.

    Args:
        audio_bytes: Raw audio bytes from uploaded file
        filename: Original filename (unused, kept for compatibility)
        language: Language code (unused, auto-detected)
        model_size: Model size (unused, using fixed "tiny")

    Returns:
        Transcribed text as string, empty string on failure
    """
    tmp_path = None
    try:
        model = get_model()

        # Save audio bytes to temporary file
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        # Transcribe using local model
        segments, _ = model.transcribe(tmp_path)
        text = " ".join([seg.text for seg in segments])

        logger.info(f"Transcription successful: {len(text)} characters")
        return text

    except Exception as e:
        logger.error(f"Local Whisper transcription failed: {e}")
        return ""
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def whisper_healthcheck():
    """Health check for local Whisper service"""
    return {
        "status": "healthy",
        "api": "local-faster-whisper-tiny",
        "model_loaded": _model is not None,
        "no_external_dependencies": True,
    }