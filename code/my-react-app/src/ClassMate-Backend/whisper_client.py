import logging
import os
import ssl
import tempfile

import requests
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPSConnection
from urllib3.connectionpool import HTTPSConnectionPool
from urllib3.util.url import parse_url

import dns.resolver

logger = logging.getLogger(__name__)


class _DNSResolverConnection(HTTPSConnection):
    """HTTPSConnection subclass that connects to a pre-resolved IP while
    using the original hostname for SNI and certificate validation."""

    def __init__(self, host, resolved_ip, original_host, **kwargs):
        # Pass the resolved IP as the host so the TCP connection goes to the
        # right address, but keep the original hostname for SNI/cert checks.
        super().__init__(resolved_ip, **kwargs)
        self._original_host = original_host
        # urllib3 uses server_hostname for SNI when it is set explicitly.
        self.server_hostname = original_host

    def connect(self):
        # Build an SSL context that validates against the real hostname so
        # that both SNI and certificate verification use the correct name,
        # not the raw IP address we are actually connecting to.
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = True
        ssl_context.verify_mode = ssl.CERT_REQUIRED
        self.ssl_context = ssl_context
        # server_hostname must be set before super().connect() is called so
        # that urllib3 passes it as the SNI name during the TLS handshake.
        self.server_hostname = self._original_host
        super().connect()


class _DNSResolverConnectionPool(HTTPSConnectionPool):
    """Connection pool that creates _DNSResolverConnection instances."""

    def __init__(self, host, resolved_ip, original_host, **kwargs):
        super().__init__(host, **kwargs)
        self._resolved_ip = resolved_ip
        self._original_host = original_host

    def _new_conn(self):
        conn = _DNSResolverConnection(
            host=self._original_host,
            resolved_ip=self._resolved_ip,
            original_host=self._original_host,
            port=self.port,
        )
        return conn


class CustomDNSAdapter(HTTPAdapter):
    """HTTP adapter that resolves DNS via Google's 8.8.8.8 and then opens
    TLS connections with proper SNI for the original hostname."""

    def __init__(self, dns_server="8.8.8.8", **kwargs):
        self.dns_server = dns_server
        super().__init__(**kwargs)

    def get_connection(self, url, proxies=None):
        parsed = parse_url(url)
        hostname = parsed.host
        port = parsed.port or 443

        resolver = dns.resolver.Resolver()
        resolver.nameservers = [self.dns_server]

        try:
            answers = resolver.resolve(hostname, "A")
            ip_address = str(answers[0])
            logger.info("Manually resolved %s -> %s", hostname, ip_address)
        except Exception as exc:
            logger.error("DNS resolution failed for %s: %s", hostname, exc)
            # Fall back to normal connection (urllib3 will do its own DNS).
            return super().get_connection(url, proxies)

        # Return a pool that connects to the IP but uses the hostname for SNI.
        return _DNSResolverConnectionPool(
            host=hostname,
            resolved_ip=ip_address,
            original_host=hostname,
            port=port,
        )

    def add_headers(self, request, **kwargs):
        # Ensure the Host header always carries the real hostname, not an IP.
        parsed = parse_url(request.url)
        if parsed.host:
            request.headers["Host"] = parsed.host
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