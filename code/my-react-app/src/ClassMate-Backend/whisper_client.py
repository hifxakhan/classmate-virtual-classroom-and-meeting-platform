import requests
import os
import logging

logger = logging.getLogger(__name__)

HF_TOKEN = os.environ.get("HF_TOKEN")
API_URL = "https://api-inference.huggingface.co/models/openai/whisper-base"

def transcribe_audio(audio_bytes: bytes) -> str:
    """Use Hugging Face Inference API for Whisper transcription"""
    if not HF_TOKEN:
        logger.error("HF_TOKEN not found in environment variables")
        return ""
    
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}
    
    try:
        response = requests.post(API_URL, headers=headers, data=audio_bytes, timeout=90)
        
        if response.status_code == 200:
            result = response.json()
            return result.get("text", "")
        else:
            logger.error(f"HF API error: {response.status_code}")
            return ""
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        return ""