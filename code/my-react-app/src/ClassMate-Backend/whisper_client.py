import logging
import os
import socket
import tempfile
import time

import dns.resolver
import requests
import urllib3
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from urllib3.util.connection import create_connection

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Custom DNS resolver that queries Google (8.8.8.8) and Cloudflare (1.1.1.1)
# directly, bypassing the host resolver that may be slow or overloaded.
# ---------------------------------------------------------------------------

_PUBLIC_DNS_SERVERS = ["8.8.8.8", "1.1.1.1"]


def _resolve_hostname(hostname: str) -> str:
    """Resolve *hostname* via public DNS servers and return the first address."""
    resolver = dns.resolver.Resolver(configure=False)
    resolver.nameservers = _PUBLIC_DNS_SERVERS
    resolver.lifetime = 5  # seconds per query attempt

    for qtype in ("A", "AAAA"):
        try:
            answers = resolver.resolve(hostname, qtype)
            address = str(answers[0])
            logger.debug("DNS resolved %s (%s) -> %s", hostname, qtype, address)
            return address
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            continue
        except Exception as exc:
            logger.warning("DNS query %s for %s failed: %s", qtype, hostname, exc)

    raise OSError(f"Public DNS resolution failed for '{hostname}'")


class _DNSResolverConnection(urllib3.connection.HTTPSConnection):
    """HTTPSConnection subclass that resolves hostnames via public DNS."""

    def connect(self):
        logger.debug("Resolving %s via public DNS ...", self.host)
        resolved_ip = _resolve_hostname(self.host)
        # Temporarily override the host so urllib3 connects to the IP,
        # but keep self.host intact so TLS SNI and certificate validation
        # still use the original hostname.
        original_host = self.host
        self.host = resolved_ip
        try:
            super().connect()
        finally:
            self.host = original_host


class _DNSResolverConnectionPool(urllib3.HTTPSConnectionPool):
    ConnectionCls = _DNSResolverConnection


class _DNSResolverPoolManager(urllib3.PoolManager):
    """PoolManager that injects the custom connection pool for HTTPS."""

    def connection_from_host(self, host, port=None, scheme="http", pool_kwargs=None):
        if scheme == "https":
            pool_kwargs = pool_kwargs or {}
            pool_kwargs["_proxy"] = None
            pool_kwargs["_proxy_headers"] = None
            return _DNSResolverConnectionPool(host, port or 443, **pool_kwargs)
        return super().connection_from_host(host, port=port, scheme=scheme,
                                            pool_kwargs=pool_kwargs)


class _DNSResolverAdapter(HTTPAdapter):
    """Requests HTTPAdapter backed by the public-DNS pool manager."""

    def init_poolmanager(self, num_pools, maxsize, block=False, **connection_pool_kw):
        retry = Retry(
            total=3,
            backoff_factor=1,          # 1 s, 2 s, 4 s
            status_forcelist=[502, 503, 504],
            allowed_methods=["POST"],
            raise_on_status=False,
        )
        self.poolmanager = _DNSResolverPoolManager(
            num_pools=num_pools,
            maxsize=maxsize,
            block=block,
            retries=retry,
            **connection_pool_kw,
        )


def _build_session() -> requests.Session:
    """Return a Session that uses public DNS and automatic retry logic."""
    session = requests.Session()
    adapter = _DNSResolverAdapter()
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

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
    """Transcribe *audio_bytes* via the Hugging Face Whisper inference API.

    Uses a custom DNS resolver (Google 8.8.8.8 / Cloudflare 1.1.1.1) and
    automatic retry with exponential backoff to survive transient DNS or
    network failures on Railway.
    """
    tmp_path = None

    try:
        hf_token = os.environ.get("HF_TOKEN")
        if not hf_token:
            return "[HF_TOKEN not configured]"

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        api_url = "https://api-inference.huggingface.co/models/openai/whisper-base"
        headers = {"Authorization": f"Bearer {hf_token}"}

        logger.debug("Sending transcription request to %s", api_url)

        session = _build_session()
        with open(tmp_path, "rb") as audio_file:
            # (connect_timeout, read_timeout) — 10 s to establish the TCP
            # connection, 30 s for the model to return a response.
            response = session.post(
                api_url,
                headers=headers,
                data=audio_file,
                timeout=(10, 30),
            )

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
        "api": "huggingface-whisper",
        "free": True,
        "token_configured": bool(hf_token),
    }


def clear_model_cache():
    logger.info("No local model cache to clear for API-based transcription")
