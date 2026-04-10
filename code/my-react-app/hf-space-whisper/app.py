import os
import tempfile
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Optional

import gradio as gr
import whisper
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

# CPU-only, HF Spaces free tier friendly defaults.
DEFAULT_MODEL = os.getenv("WHISPER_DEFAULT_MODEL", "base")
MAX_TIMEOUT_SECONDS = int(os.getenv("WHISPER_TIMEOUT_SECONDS", "60"))
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "30"))

# Lazy model cache so we do not reload weights per request.
_model_cache = {}

# A single-worker executor avoids CPU thrash on free tier hardware.
_executor = ThreadPoolExecutor(max_workers=1)


SUPPORTED_EXTENSIONS = {
    ".wav",
    ".mp3",
    ".m4a",
    ".flac",
    ".ogg",
    ".aac",
    ".mp4",
    ".webm",
}


def get_model(model_name: str):
    """Load model once and reuse it from cache."""
    model_name = (model_name or DEFAULT_MODEL).strip().lower()
    if model_name not in {"tiny", "base", "small"}:
        model_name = DEFAULT_MODEL

    if model_name not in _model_cache:
        _model_cache[model_name] = whisper.load_model(model_name, device="cpu")
    return _model_cache[model_name]


def normalize_text(text: str) -> str:
    """Small cleanup for display readability."""
    if not text:
        return ""
    cleaned = " ".join(text.split())
    if cleaned and cleaned[0].islower():
        cleaned = cleaned[0].upper() + cleaned[1:]
    return cleaned


def _run_whisper(audio_path: str, model_name: str, language: Optional[str]):
    model = get_model(model_name)

    # language=None lets Whisper auto-detect.
    result = model.transcribe(
        audio=audio_path,
        language=None if language == "auto" else language,
        fp16=False,
        task="transcribe",
        verbose=False,
    )
    return normalize_text(result.get("text", ""))


def transcribe_with_timeout(audio_path: str, model_name: str, language: Optional[str]) -> str:
    """Run transcription with timeout protection for slow CPU."""
    future = _executor.submit(_run_whisper, audio_path, model_name, language)
    try:
        return future.result(timeout=MAX_TIMEOUT_SECONDS)
    except FuturesTimeoutError:
        future.cancel()
        raise TimeoutError(
            f"Transcription exceeded {MAX_TIMEOUT_SECONDS}s timeout. "
            "Try a shorter clip or a smaller model (tiny/base)."
        )


def validate_file(path: str):
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise ValueError("Audio file was not found.")
    if p.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported format '{p.suffix}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )


# Gradio transcription function (used by UI and /api/predict).
def transcribe_audio_gradio(audio_file: str, model_name: str, language: str, progress=gr.Progress()):
    if not audio_file:
        return "Please upload or record audio first."

    progress(0.05, desc="Validating audio")
    try:
        validate_file(audio_file)
    except Exception as e:
        return f"Validation error: {e}"

    progress(0.2, desc=f"Preparing model: {model_name}")
    try:
        # Use source file path directly (fastest for Gradio type='filepath').
        progress(0.5, desc="Transcribing on CPU")
        text = transcribe_with_timeout(audio_file, model_name, language)
        progress(1.0, desc="Done")
        if not text:
            return "No speech detected."
        return text
    except TimeoutError as e:
        return str(e)
    except Exception as e:
        return f"Transcription failed: {e}"


def build_demo():
    with gr.Blocks(theme=gr.themes.Soft(), title="Whisper AI Transcription") as demo:
        gr.Markdown(
            """
            # Whisper AI Transcription
            Upload or record audio and get high-quality text transcription.

            - Optimized for Hugging Face Spaces CPU Basic
            - Supports: WAV, MP3, M4A, FLAC, OGG, AAC, MP4, WEBM
            - API endpoint: `/api/predict`
            """
        )

        with gr.Row():
            with gr.Column(scale=2):
                audio_input = gr.Audio(
                    sources=["upload", "microphone"],
                    type="filepath",
                    label="Audio Input",
                )
                model_choice = gr.Dropdown(
                    choices=["tiny", "base", "small"],
                    value=DEFAULT_MODEL,
                    label="Model",
                    info="tiny=fastest, base=balanced, small=better accuracy but slower",
                )
                language_choice = gr.Dropdown(
                    choices=["auto", "en", "ur", "hi", "ar"],
                    value="auto",
                    label="Language",
                    info="Use auto to detect language automatically",
                )
                submit_btn = gr.Button("Transcribe", variant="primary")

            with gr.Column(scale=3):
                transcript_output = gr.Textbox(
                    label="Transcription",
                    lines=12,
                    max_lines=20,
                    placeholder="Transcribed text will appear here...",
                )

        submit_btn.click(
            fn=transcribe_audio_gradio,
            inputs=[audio_input, model_choice, language_choice],
            outputs=transcript_output,
            api_name="predict",  # Exposes /api/predict
            show_progress="full",
        )

    return demo


def create_fastapi_app():
    demo = build_demo().queue(max_size=16, default_concurrency_limit=1)

    api = FastAPI(title="Whisper HF Space API", version="1.0.0")
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @api.get("/health")
    def health_check():
        return {
            "status": "ok",
            "default_model": DEFAULT_MODEL,
            "timeout_seconds": MAX_TIMEOUT_SECONDS,
            "cached_models": sorted(list(_model_cache.keys())),
        }

    @api.post("/transcribe")
    async def transcribe_endpoint(
        file: UploadFile = File(...),
        model: str = DEFAULT_MODEL,
        language: str = "auto",
    ):
        # Additional direct endpoint for non-Gradio clients.
        # Gradio /api/predict remains available as required.
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided")

        suffix = Path(file.filename).suffix.lower() or ".wav"
        if suffix not in SUPPORTED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {suffix}")

        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty file")
        if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_MB}MB limit")

        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(data)
                temp_path = tmp.name

            text = transcribe_with_timeout(temp_path, model, language)
            return {"success": True, "text": text}
        except TimeoutError as e:
            raise HTTPException(status_code=504, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass

    return gr.mount_gradio_app(api, demo, path="/")


app = create_fastapi_app()


if __name__ == "__main__":
    # Useful for local testing before pushing to HF Spaces.
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=7860, reload=False)
