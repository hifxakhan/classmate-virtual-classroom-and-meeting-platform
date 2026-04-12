import logging
import os
import tempfile

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.url import parse_url

import dns.resolver

logger = logging.getLogger(__name__)


class CustomDNSAdapter(HTTPAdapter):
    """Custom adapter that resolves DNS manually using Google's DNS."""

    def __init__(self, dns_server="8.8.8.8", **kwargs):
        self.dns_server = dns_server
        self.original_host = None
        super().__init__(**kwargs)

    def get_connection(self, url, proxies=None):
        parsed = parse_url(url)
        hostname = parsed.host

        resolver = dns.resolver.Resolver()
        resolver.nameservers = [self.dns_server]

        try:
            answers = resolver.resolve(hostname, "A")
            ip_address = str(answers[0])
            logger.info("Manually resolved %s -> %s", hostname, ip_address)

            new_url = url.replace(hostname, ip_address)
            self.original_host = hostname
            return super().get_connection(new_url, proxies)
        except Exception as e:
            logger.error("DNS resolution failed: %s", e)
            return super().get_connection(url, proxies)

    def add_headers(self, request, **kwargs):
        if self.original_host:
            request.headers["Host"] = self.original_host
        return super().add_headers(request, **kwargs)

def get_whisper_model(model_size: str = "base"):
    """Compatibility shim for existing preload hooks."""
    return {"provider": "huggingface", "model": model_size or "base"}


def transcribe_audio(
    audio_bytes: bytes,
    filename: str = None,
    language: str = None,
    model_size: str = None,
    model: str = None,
) -> str:
    """Use Hugging Face's free Whisper API with custom DNS resolver."""
    tmp_path = None

    try:
        hf_token = os.environ.get("HF_TOKEN")

        if not hf_token:
            return "[HF_TOKEN not configured]"

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        session = requests.Session()
        session.mount("https://", CustomDNSAdapter())
        session.mount("http://", CustomDNSAdapter())

        api_url = "https://api-inference.huggingface.co/models/openai/whisper-base"
        headers = {"Authorization": f"Bearer {hf_token}"}

        with open(tmp_path, "rb") as audio_file:
            response = session.post(api_url, headers=headers, data=audio_file, timeout=30)

        if response.status_code == 200:
            result = response.json()
            text = str(result.get("text", "")).strip()
            return text if text else "[No speech detected]"

        if response.status_code == 503:
            return "[Model loading, please retry]"

        return f"[API error: {response.status_code}]"

    except Exception as e:
        logger.error("Transcription error: %s", e)
        return "[Transcription unavailable]"

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def whisper_healthcheck():
    hf_token = os.environ.get("HF_TOKEN")
    return {
        "ok": bool(hf_token),
        "status": "healthy" if hf_token else "needs_token",
        "api": "huggingface-whisper-custom-dns",
        "dns_fix": "custom resolver with 8.8.8.8",
        "free": True,
        "token_configured": bool(hf_token),
    }


def clear_model_cache():
    logger.info("No local model cache to clear for API-based transcription")