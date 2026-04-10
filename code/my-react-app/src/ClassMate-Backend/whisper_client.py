import requests
import os
import logging
import time
import base64

logger = logging.getLogger(__name__)

REPLICATE_API_TOKEN = os.environ.get("REPLICATE_API_TOKEN")
API_URL = "https://api.replicate.com/v1/models/openai/whisper/replicate/predictions"

def transcribe_audio(audio_bytes: bytes, filename: str = None, language: str = None, model: str = None) -> str:
    """Use Replicate's hosted Whisper for transcription"""
    if not REPLICATE_API_TOKEN:
        logger.error("REPLICATE_API_TOKEN not found")
        return ""
    
    headers = {"Authorization": f"Token {REPLICATE_API_TOKEN}", "Content-Type": "application/json"}
    
    try:
        audio_b64 = base64.b64encode(audio_bytes).decode()
        
        payload = {
            "version": "cdd9b5e4e0fcfc5d7edc9c4c4f3c4e4e0fcfc5d7e",
            "input": {"audio": f"data:audio/webm;base64,{audio_b64}"}
        }
        
        response = requests.post(API_URL, headers=headers, json=payload, timeout=30)
        
        if response.status_code == 201:
            prediction_url = response.json()["urls"]["get"]
            for _ in range(60):
                time.sleep(1)
                result = requests.get(prediction_url, headers=headers)
                if result.json()["status"] == "succeeded":
                    return result.json()["output"]["text"]
                elif result.json()["status"] == "failed":
                    return ""
            return ""
        return ""
    except Exception as e:
        logger.error(f"Failed: {e}")
        return ""

def whisper_healthcheck():
    """Health check - just returns status"""
    return {"status": "healthy", "api": "replicate", "token_configured": bool(REPLICATE_API_TOKEN)}