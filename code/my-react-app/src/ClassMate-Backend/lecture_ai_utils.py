"""
Pure helpers for transcript assembly, truncation, and OpenAI response parsing.
"""

import json
import re
from datetime import datetime


def _line_sort_key(row):
    idx = row.get("line_index")
    if idx is None:
        idx = 0
    try:
        idx = int(idx)
    except (TypeError, ValueError):
        idx = 0
    created = row.get("created_at")
    if isinstance(created, datetime):
        created = created.isoformat()
    return (idx, str(created or ""))


def assemble_transcript_lines(lines):
    """Sort by line_index then created_at; strip each line; join with newlines."""
    if not lines:
        return ""
    ordered = sorted(lines, key=_line_sort_key)
    return "\n".join(str(row.get("text", "") or "").strip() for row in ordered)


def truncate_for_model(text, max_chars):
    """Head policy: keep the first max_chars characters."""
    if text is None:
        return ""
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    return text[:max_chars]


def parse_quiz_json(raw: str):
    """
    Parse and normalize quiz JSON into list of dicts with:
    question_text, options (len 4), correct_index (0-3).
    Accepts question or question_text; correct_index or correct_answer (A-D).
    """
    if raw is None or not str(raw).strip():
        raise ValueError("Quiz JSON is empty")
    data = json.loads(raw.strip())
    if isinstance(data, dict) and "questions" in data:
        data = data["questions"]
    if not isinstance(data, list):
        raise ValueError("Quiz JSON must be an array or an object with a \"questions\" array")
    out = []
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("Each quiz item must be an object")
        qtext = item.get("question_text") or item.get("question")
        if not qtext or not str(qtext).strip():
            raise ValueError("Each quiz item must have question or question_text")
        opts = item.get("options")
        if not isinstance(opts, list) or len(opts) != 4:
            raise ValueError("Each quiz item must have options array of length 4")
        opts = [str(o) for o in opts]
        cidx = item.get("correct_index")
        if cidx is None and item.get("correct_answer") is not None:
            letter = str(item.get("correct_answer")).strip().upper()
            if len(letter) == 1 and "A" <= letter <= "D":
                cidx = ord(letter) - ord("A")
            else:
                raise ValueError("Invalid correct_answer letter")
        try:
            cidx = int(cidx)
        except (TypeError, ValueError):
            raise ValueError("correct_index must be an integer 0-3")
        if cidx < 0 or cidx > 3:
            raise ValueError("correct_index must be between 0 and 3")
        out.append(
            {
                "question_text": str(qtext).strip(),
                "options": opts,
                "correct_index": cidx,
            }
        )
    return out


def normalize_summary_text(content):
    """Reject None; strip whitespace; remove simple script tags."""
    if content is None:
        raise ValueError("summary content cannot be None")
    text = str(content).strip()
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", "", text)
    return text.strip()
