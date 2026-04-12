import tempfile
import os
import logging
import openai

logger = logging.getLogger(__name__)


def transcribe_audio(
    audio_bytes: bytes,
    filename: str = None,
    language: str = None,
    model_size: str = None,
    model: str = None,
) -> str:
    """
    Transcribe audio using OpenAI's Whisper API
    This is the reliable, production-ready approach
    """
    tmp_path = None
    try:
        # Get API key from environment
        openai.api_key = os.getenv('OPENAI_API_KEY')

        if not openai.api_key:
            logger.error("OPENAI_API_KEY not set in environment variables")
            return "[Transcription unavailable: API key not configured]"

        # Save audio to temporary file
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        logger.info("Transcribing %s bytes from %s", len(audio_bytes), filename or 'audio')

        # Call OpenAI API
        with open(tmp_path, "rb") as audio_file:
            response = openai.Audio.transcribe(
                model="whisper-1",
                file=audio_file,
                language=language if language and language != "auto" else None,
            )

        # Extract text from response
        text = response.get("text", "").strip()

        if text:
            logger.info("Transcription successful: %s characters", len(text))
            return text

        logger.warning("Transcription returned empty text")
        return "[No speech detected]"

    except openai.error.RateLimitError as e:
        logger.error("OpenAI rate limit exceeded: %s", e)
        return "[Transcription temporarily unavailable - rate limit]"

    except openai.error.AuthenticationError as e:
        logger.error("OpenAI authentication failed: %s", e)
        return "[Transcription unavailable - invalid API key]"

    except openai.error.APIConnectionError as e:
        logger.error("OpenAI API connection error: %s", e)
        return "[Transcription unavailable - network error]"

    except Exception as e:
        logger.error("Unexpected transcription error: %s", e)
        return f"[Transcription error: {str(e)[:50]}]"

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def whisper_healthcheck():
    """Health check for transcription service"""
    api_key = os.getenv('OPENAI_API_KEY')

    return {
        "ok": bool(api_key),
        "status": "healthy" if api_key else "unhealthy",
        "api": "openai-whisper-api",
        "api_key_configured": bool(api_key),
        "message": "Using OpenAI API for transcription" if api_key else "OPENAI_API_KEY not set. Add it to Railway environment variables.",
        "endpoint": "https://api.openai.com/v1/audio/transcriptions",
    }