import requests
import os
import logging

logger = logging.getLogger(__name__)

HF_TOKEN = os.environ.get("HF_TOKEN")
# Try the router endpoint instead
API_URL = "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3"

def transcribe_audio(audio_bytes: bytes, filename: str = None, language: str = None, model: str = None) -> str:
    if not HF_TOKEN:
        logger.error("HF_TOKEN not found")
        return ""
    
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}
    
    try:
        logger.info(f"Sending request, size: {len(audio_bytes)} bytes")
        response = requests.post(API_URL, headers=headers, data=audio_bytes, timeout=90)
        
        if response.status_code == 200:
            result = response.json()
            return result.get("text", "")
        else:
            logger.error(f"API error: {response.status_code}")
            return ""
            
    except Exception as e:
        logger.error(f"Failed: {e}")
        return ""

def whisper_healthcheck():
    return {"status": "healthy", "api": "whisper-large-v3 (router)", "token_configured": bool(HF_TOKEN)}