import tempfile
import os
import logging

logger = logging.getLogger(__name__)

_model = None

def get_model():
    global _model
    if _model is None:
        import whisper
        logger.info("Loading OpenAI Whisper model locally...")
        # Load tiny model (fast, low memory)
        _model = whisper.load_model("tiny")
        logger.info("Whisper model loaded locally!")
    return _model

def transcribe_audio(audio_bytes: bytes, filename: str = None, language: str = None, model_size: str = None) -> str:
    """
    Transcribe using LOCAL OpenAI Whisper.
    NO external API calls - runs entirely on Render.
    """
    try:
        model = get_model()
        
        # Save audio to temp file
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        
        # Transcribe locally
        result = model.transcribe(tmp_path)
        text = result["text"]
        
        # Cleanup
        os.unlink(tmp_path)
        
        logger.info(f"Local transcription successful: {len(text)} chars")
        return text
        
    except Exception as e:
        logger.error(f"Local Whisper failed: {e}")
        return ""

def whisper_healthcheck():
    return {
        "status": "healthy",
        "api": "local-openai-whisper-tiny",
        "model_loaded": _model is not None,
        "no_external_calls": True
    }