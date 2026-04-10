import requests
import os
import logging

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
API_URL = "https://api.openai.com/v1/audio/transcriptions"

def transcribe_audio(audio_bytes: bytes, filename: str = None, language: str = None, model: str = None) -> str:
    """Use OpenAI Whisper API for transcription"""
    if not OPENAI_API_KEY:
        logger.error("OPENAI_API_KEY not found in environment variables")
        return ""
    
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    
    try:
        # Prepare the file for upload
        files = {
            "file": (filename or "audio.webm", audio_bytes, "audio/webm"),
            "model": (None, "whisper-1"),
        }
        
        # Add language if specified
        if language and language != "auto":
            files["language"] = (None, language)
        
        response = requests.post(API_URL, headers=headers, files=files, timeout=90)
        
        if response.status_code == 200:
            result = response.json()
            text = result.get("text", "")
            logger.info(f"Transcription successful: {len(text)} chars")
            return text
        else:
            logger.error(f"OpenAI API error: {response.status_code} - {response.text[:200]}")
            return ""
            
    except requests.exceptions.Timeout:
        logger.error("OpenAI API timeout after 90 seconds")
        return ""
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        return ""

def whisper_healthcheck():
    """Health check for OpenAI Whisper service"""
    return {
        "status": "healthy" if OPENAI_API_KEY else "unhealthy",
        "api": "openai-whisper",
        "token_configured": bool(OPENAI_API_KEY)
    }