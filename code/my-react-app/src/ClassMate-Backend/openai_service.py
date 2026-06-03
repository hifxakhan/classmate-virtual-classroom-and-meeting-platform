"""
OpenAI calls for dual-audience summaries, quiz JSON generation, and transcript translation.

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


def generate_exam_questions(transcript: str) -> List[Dict[str, Any]]:
    """Generate a comprehensive, multi-type exam from an English-translated transcript.

    Asks OpenAI to produce as many questions as the content supports across:
      - multiple_choice  (4 options, correct_index 0-3)
      - true_false       (options: ["True","False"], correct_index 0 or 1)
      - fill_in_the_blank (correct_text is the expected word/phrase)
      - short_answer     (correct_text is a model answer paragraph)

    Returns a list of dicts, each with:
        type, question_text,
        options (list[str] | None),
        correct_index (int | None),
        correct_text (str | None)
    """
    truncated = truncate_for_model(transcript, MAX_TRANSCRIPT_CHARS)
    client = _client()

    system = (
        "You are an expert university lecturer creating a comprehensive exam from a class transcript.\n"
        "Rules:\n"
        "  1. Only use facts and concepts explicitly present in the transcript.\n"
        "  2. Generate AS MANY questions as the content reasonably supports — aim for variety.\n"
        "  3. Include ALL four types: multiple_choice, true_false, fill_in_the_blank, short_answer.\n"
        "  4. Questions must be meaningful and test actual understanding, not trivial details.\n"
        "  5. Distribute types roughly: 35% MCQ, 20% True/False, 25% Fill-in-the-Blank, 20% Short Answer.\n\n"
        "Return a JSON object with a single key \"questions\" containing an array.\n"
        "Each element must have EXACTLY these fields:\n"
        "  {\n"
        "    \"type\": \"multiple_choice\" | \"true_false\" | \"fill_in_the_blank\" | \"short_answer\",\n"
        "    \"question_text\": \"<the question>\",\n"
        "    \"options\": [\"A\",\"B\",\"C\",\"D\"] for multiple_choice, [\"True\",\"False\"] for true_false, null for others,\n"
        "    \"correct_index\": 0-3 for multiple_choice, 0 or 1 for true_false, null for others,\n"
        "    \"correct_text\": null for multiple_choice/true_false, \"<expected answer>\" for fill_in_the_blank and short_answer\n"
        "  }\n"
        "For fill_in_the_blank: write the question with '______' where the blank should be.\n"
        "For short_answer: write a clear model answer of 2-4 sentences.\n"
        "Do NOT include any explanation outside the JSON object."
    )

    user = "Transcript follows. Generate the exam questions.\n\n" + truncated

    try:
        resp = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
    except (APIError, APIConnectionError, RateLimitError) as e:
        _raise_openai_failure(e)

    raw = (resp.choices[0].message.content or "").strip()
    data = _parse_json_object(raw)
    raw_questions = _coerce_quiz_list(data)

    VALID_TYPES = {"multiple_choice", "true_false", "fill_in_the_blank", "short_answer"}
    parsed: List[Dict[str, Any]] = []

    for i, item in enumerate(raw_questions):
        if not isinstance(item, dict):
            continue
        qtype = str(item.get("type") or "multiple_choice").strip().lower()
        if qtype not in VALID_TYPES:
            qtype = "multiple_choice"
        qtext = str(item.get("question_text") or "").strip()
        if not qtext:
            continue

        options = item.get("options")
        correct_index = item.get("correct_index")
        correct_text = item.get("correct_text")

        if qtype in ("multiple_choice", "true_false"):
            # Validate options list
            if not isinstance(options, list) or len(options) < 2:
                continue
            if qtype == "multiple_choice" and len(options) != 4:
                # Pad or trim to exactly 4
                options = (options + ["(none)"] * 4)[:4]
            if qtype == "true_false":
                options = ["True", "False"]
            options = [str(o) for o in options]

            # Validate correct_index
            if correct_index is None:
                continue
            try:
                correct_index = int(correct_index)
            except (TypeError, ValueError):
                continue
            if correct_index < 0 or correct_index >= len(options):
                correct_index = 0
            correct_text = None

        elif qtype in ("fill_in_the_blank", "short_answer"):
            options = None
            correct_index = None
            correct_text = str(correct_text or "").strip() or None
            if not correct_text:
                continue

        parsed.append({
            "type": qtype,
            "question_text": qtext,
            "options": options,
            "correct_index": correct_index,
            "correct_text": correct_text,
        })

    if not parsed:
        raise ValueError("OpenAI returned no valid exam questions from the transcript")

    return parsed



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


def translate_transcript(transcript: str) -> str:
    """Translate a Hinglish (Hindi/Urdu in English script) transcript to clean English.

    Preserves educational meaning, terminology, and context rather than doing a
    word-for-word transliteration. Returns the translated plain-text string.
    """
    if not transcript or not str(transcript).strip():
        raise ValueError("transcript is empty; nothing to translate")

    truncated = truncate_for_model(transcript, MAX_TRANSCRIPT_CHARS)
    client = _client()

    system = (
        "You are an expert academic translator specialising in South Asian classroom speech. "
        "The transcript below is in Hinglish — a mixture of Hindi and Urdu words written in "
        "English script (Roman Urdu / Roman Hindi), often interleaved with technical English terms. "
        "Your job is to produce a clean, fluent, professional English translation of the lecture. "
        "Rules:\n"
        "  1. Preserve the meaning and educational content exactly — do NOT omit concepts.\n"
        "  2. Translate conversational filler naturally (e.g. 'acha' → 'okay', 'matlab' → 'meaning').\n"
        "  3. Keep technical terms (data structures, algorithms, subject vocabulary) in English as-is.\n"
        "  4. Output ONLY the translated text — no headings, no explanations, no metadata.\n"
        "  5. Maintain paragraph / line structure where it aids readability."
    )

    try:
        resp = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": truncated},
            ],
            temperature=0.2,
        )
    except (APIError, APIConnectionError, RateLimitError) as e:
        _raise_openai_failure(e)

    translated = str(resp.choices[0].message.content or "").strip()
    if not translated:
        raise ValueError("OpenAI returned an empty translation")
    return translated


def evaluate_short_answers(qa_pairs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """AI-grade a batch of short-answer responses.

    Args:
        qa_pairs: list of dicts, each with:
            question_order (int)
            question_text  (str)
            model_answer   (str)   – the stored correct_text
            student_answer (str)   – what the student wrote

    Returns:
        list of dicts, each with:
            question_order (int)
            marks          (int, 0 | 1 | 2)
            feedback       (str)   – concise 1-sentence rationale
    """
    if not qa_pairs:
        return []

    client = _client()

    # Build a numbered list of cases for the prompt
    cases_text = ""
    for i, qa in enumerate(qa_pairs, 1):
        cases_text += (
            f"\n--- Question {qa['question_order']} ---\n"
            f"Question: {qa['question_text']}\n"
            f"Model Answer: {qa['model_answer']}\n"
            f"Student Answer: {qa['student_answer'] or '(no answer given)'}\n"
        )

    system = (
        "You are a strict but fair university exam grader for short-answer questions.\n"
        "Marking scheme (out of 2 marks each):\n"
        "  2 marks – Correct and complete: core concept is present, accurate, in own words is fine.\n"
        "  1 mark  – Partially correct: key idea is present but vague, incomplete, or has minor errors.\n"
        "  0 marks – Incorrect or blank: wrong concept, completely off-topic, or no answer.\n\n"
        "Return a JSON object with a single key \"results\" whose value is an array.\n"
        "Each element must have exactly:\n"
        "  { \"question_order\": <int>, \"marks\": <0|1|2>, \"feedback\": \"<one concise sentence>\" }\n"
        "Do NOT include any explanation outside the JSON."
    )

    user = (
        f"Grade the following {len(qa_pairs)} short-answer response(s):\n"
        + cases_text
    )

    try:
        resp = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
    except (APIError, APIConnectionError, RateLimitError) as e:
        _raise_openai_failure(e)

    raw = (resp.choices[0].message.content or "").strip()
    data = _parse_json_object(raw)
    raw_results = data.get("results", [])
    if not isinstance(raw_results, list):
        raise ValueError("AI grading response missing 'results' array")

    validated: List[Dict[str, Any]] = []
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        try:
            qorder = int(item["question_order"])
            marks = int(item.get("marks", 0))
            if marks not in (0, 1, 2):
                marks = max(0, min(2, marks))
            feedback = str(item.get("feedback") or "").strip()
        except (KeyError, TypeError, ValueError):
            continue
        validated.append({
            "question_order": qorder,
            "marks": marks,
            "feedback": feedback,
        })

    return validated

