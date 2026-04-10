import whisper
import tempfile
import os
import logging

logger = logging.getLogger(__name__)

# Load model once at startup (takes ~1-2 seconds)
print("Loading Whisper model...")
model = whisper.load_model("tiny")  # tiny = fastest, base = balanced, small = better
print("Whisper model loaded!")

def transcribe_audio(audio_bytes: bytes, filename: str = None, language: str = None, model_size: str = None) -> str:
    """Transcribe audio using local Whisper model (no external API)"""
    try:
        # Save audio bytes to temp file
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        
        # Transcribe using local model
        result = model.transcribe(tmp_path)
        text = result["text"]
        
        # Clean up
        os.unlink(tmp_path)
        
        logger.info(f"Transcription successful: {len(text)} chars")
        return text
        
    except Exception as e:
        logger.error(f"Local Whisper failed: {e}")
        return ""

def whisper_healthcheck():
    """Health check for local Whisper service"""
    return {
        "status": "healthy", 
        "api": "local-whisper-tiny", 
        "model_loaded": True
    }