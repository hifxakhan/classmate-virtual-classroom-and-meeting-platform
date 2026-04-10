import requests
import os
import logging

logger = logging.getLogger(__name__)

HF_TOKEN = os.environ.get("HF_TOKEN")
# Using the actively maintained large-v3 model (not deprecated)
API_URL = "https://api-inference.huggingface.co/models/openai/whisper-large-v3"

def transcribe_audio(audio_bytes: bytes, filename: str = None, language: str = None, model: str = None) -> str:
    """
    Transcribe audio using Hugging Face Inference API.
    
    Args:
        audio_bytes: Raw audio bytes from the uploaded file
        filename: Original filename (unused, kept for compatibility)
        language: Language code (unused, API auto-detects)
        model: Model size (unused, using fixed large-v3 model)
    
    Returns:
        Transcribed text as string, empty string on failure
    """
    if not HF_TOKEN:
        logger.error("HF_TOKEN not found in environment variables")
        return ""
    
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}
    
    try:
        logger.info(f"Sending transcription request, audio size: {len(audio_bytes)} bytes")
        response = requests.post(API_URL, headers=headers, data=audio_bytes, timeout=90)
        
        if response.status_code == 200:
            result = response.json()
            text = result.get("text", "")
            logger.info(f"Transcription successful, length: {len(text)} chars")
            return text
        else:
            logger.error(f"HF API error: {response.status_code} - {response.text[:200]}")
            return ""
            
    except requests.exceptions.Timeout:
        logger.error("Transcription timeout after 90 seconds")
        return ""
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        return ""