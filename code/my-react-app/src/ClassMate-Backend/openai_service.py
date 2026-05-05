"""
OpenAI calls for dual-audience summaries and quiz JSON generation.

Environment:
  OPENAI_API_KEY — required for live calls (routes return 503 if unset).
  OPENAI_MODEL — chat completions model (default: gpt-4o-mini; must support JSON mode).
  OPENAI_TIMEOUT_SEC — HTTP timeout for OpenAI requests in seconds (default: 120).
  LECTURE_RECAP_MAX_CHARS — max transcript characters sent to the model (default: 12000).
"""

import json
import os
from typing import Any, Dict, List, Tuple

from openai import APIConnectionError, APIError, OpenAI, RateLimitError

from lecture_ai_utils import truncate_for_model

DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
MAX_TRANSCRIPT_CHARS = int(os.environ.get("LECTURE_RECAP_MAX_CHARS", "12000"))
# Long classroom transcripts; quiz+summary can be slow
CLIENT_TIMEOUT_SEC = float(os.environ.get("OPENAI_TIMEOUT_SEC", "120"))
_OPENAI_CLIENT = None


def _client() -> OpenAI:
    global _OPENAI_CLIENT
    if _OPENAI_CLIENT is not None:
        return _OPENAI_CLIENT

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    _OPENAI_CLIENT = OpenAI(api_key=api_key, timeout=CLIENT_TIMEOUT_SEC)

    return _OPENAI_CLIENT


def _raise_openai_failure(exc: Exception) -> None:
    raise RuntimeError(f"OpenAI request failed: {exc}") from exc


def _strip_code_fence(text: str) -> str:
    lines = text.split("\n")
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _parse_json_object(content: str) -> Dict[str, Any]:
    raw = (content or "").strip()
    if raw.startswith("```"):
        raw = _strip_code_fence(raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            data = json.loads(raw[start : end + 1])
        else:
            raise
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object from the model")
    return data


def summarize_dual_audience(transcript: str) -> Tuple[str, str]:
    """Return (student_summary, teacher_summary) from class transcript text."""
    truncated = truncate_for_model(transcript, MAX_TRANSCRIPT_CHARS)
    client = _client()
    system = (
        "You write two concise markdown summaries of the same class session transcript. "
        "The student_summary is for students: key concepts, definitions, and what to study. "
        "The teacher_summary is for the instructor: coverage vs plan, pacing, and follow-up ideas. "
        'Respond with a JSON object containing exactly the keys "student_summary" and '
        '"teacher_summary", each a non-empty string.'
    )
    try:
        resp = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": truncated},
            ],
            temperature=0.3,
            response_format={"type": "json_object"},
        )
    except (APIError, APIConnectionError, RateLimitError) as e:
        _raise_openai_failure(e)

    raw = (resp.choices[0].message.content or "").strip()
    data = _parse_json_object(raw)
    student = str(data.get("student_summary") or "").strip()
    teacher = str(data.get("teacher_summary") or "").strip()
    if not student or not teacher:
        raise ValueError("OpenAI response missing student_summary or teacher_summary")
    return student, teacher


def _coerce_quiz_list(parsed: Any) -> List[Any]:
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        if isinstance(parsed.get("questions"), list):
            return parsed["questions"]
    raise ValueError("Quiz JSON must be an array or an object with a \"questions\" array")


def generate_quiz_mcqs(transcript: str, num_questions: int) -> str:
    """
    Ask OpenAI for MCQs from the transcript.

    Returns a JSON **array** string so lecture_ai_utils.parse_quiz_json can consume it.
    Uses json_object mode with a top-level \"questions\" array for reliable structure.
    """
    if num_questions < 1 or num_questions > 20:
        raise ValueError("num_questions must be between 1 and 20")

    truncated = truncate_for_model(transcript, MAX_TRANSCRIPT_CHARS)
    client = _client()
    system = (
        "You create multiple-choice quiz questions strictly from the class transcript. "
        "Do not invent facts that are not supported by the transcript. "
        'Return a JSON object with a single key \"questions\" whose value is an array. '
        f"The array must contain exactly {num_questions} objects. Each object has: "
        '"question_text" (string), "options" (array of exactly 4 distinct strings), '
        '"correct_index" (integer 0–3 indicating which option is correct).'
    )
    user = (
        f"Transcript follows. Build exactly {num_questions} questions.\n\n" + truncated
    )
    try:
        resp = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.35,
            response_format={"type": "json_object"},
        )
    except (APIError, APIConnectionError, RateLimitError) as e:
        _raise_openai_failure(e)

    raw = (resp.choices[0].message.content or "").strip()
    data = _parse_json_object(raw)
    questions = _coerce_quiz_list(data)
    if len(questions) != num_questions:
        raise ValueError(
            f"Model returned {len(questions)} questions; expected {num_questions}"
        )
    return json.dumps(questions)


def transcribe_audio_file(uploaded_file) -> str:
    """
    Transcribe an uploaded audio file using OpenAI Whisper.

    `uploaded_file` is expected to be a Flask FileStorage object.
    """
    if uploaded_file is None:
        raise ValueError("audio file is required")
    if not getattr(uploaded_file, "filename", ""):
        raise ValueError("audio filename is required")

    client = _client()
    try:
        uploaded_file.stream.seek(0)
    except Exception:
        pass

    try:
        resp = client.audio.transcriptions.create(
            model="whisper-1",
            file=(uploaded_file.filename, uploaded_file.stream, uploaded_file.mimetype or "application/octet-stream"),
        )
    except (APIError, APIConnectionError, RateLimitError) as e:
        _raise_openai_failure(e)

    text = str(getattr(resp, "text", "") or "").strip()
    if not text:
        raise ValueError("No speech detected in the audio")
    return text
