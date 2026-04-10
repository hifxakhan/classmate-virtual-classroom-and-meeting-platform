import logging
from typing import Optional

from flask import Blueprint, jsonify, request

from db import getDbConnection
from whisper_client import transcribe_audio, whisper_healthcheck

transcription_bp = Blueprint("transcription", __name__)
logger = logging.getLogger(__name__)

_MAX_AUDIO_BYTES = 25 * 1024 * 1024
_transcript_schema_initialized = False


def _parse_positive_int(value, default_value):
    try:
        parsed = int(value)
        if parsed < 0:
            return default_value
        return parsed
    except (TypeError, ValueError):
        return default_value


def _ensure_transcripts_schema(cursor):
    """Ensure transcripts table and expected columns exist to prevent 500s."""
    global _transcript_schema_initialized
    if _transcript_schema_initialized:
        return

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS transcripts (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL,
            speaker_id VARCHAR(255) NOT NULL,
            text TEXT NOT NULL,
            language VARCHAR(16) DEFAULT 'en',
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute("ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS is_translated BOOLEAN DEFAULT FALSE")
    cursor.execute("ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS original_text TEXT")

    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_transcripts_session_time
        ON transcripts (session_id, timestamp, id)
        """
    )

    _transcript_schema_initialized = True


def _safe_participant_name(cursor, session_id, speaker_id) -> Optional[str]:
    try:
        cursor.execute(
            """
            SELECT participant_name
            FROM call_participants
            WHERE session_id = %s AND participant_identity = %s
            LIMIT 1
            """,
            (session_id, speaker_id),
        )
        row = cursor.fetchone()
        return row[0] if row else None
    except Exception:
        # Some deployments may not have call_participants table.
        return None


def _read_audio_bytes(file_storage) -> bytes:
    """Read multipart upload in chunks for memory safety."""
    total = 0
    chunks = []

    while True:
        chunk = file_storage.stream.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > _MAX_AUDIO_BYTES:
            raise ValueError(f"Audio exceeds {_MAX_AUDIO_BYTES // (1024 * 1024)}MB limit")
        chunks.append(chunk)

    return b"".join(chunks)


@transcription_bp.route("/whisper-health", methods=["GET"])
def whisper_health():
    result = whisper_healthcheck()
    status = 200 if result.get("ok") else 503
    return jsonify({"success": result.get("ok", False), **result}), status


@transcription_bp.route("/transcribe", methods=["POST"])
def transcribe_audio_route():
    conn = None
    cursor = None

    try:
        audio_file = request.files.get("audio")
        if not audio_file:
            return jsonify({"success": False, "error": "audio file is required"}), 400

        filename = audio_file.filename or "audio.webm"
        language = str(request.form.get("language") or "auto").strip()
        model = str(request.form.get("model") or "base").strip()
        session_id_raw = request.form.get("session_id")
        speaker_id = str(request.form.get("speaker_id") or "unknown").strip()

        try:
            audio_bytes = _read_audio_bytes(audio_file)
        except ValueError as ve:
            return jsonify({"success": False, "error": str(ve)}), 413

        if not audio_bytes:
            return jsonify({"success": False, "error": "Empty audio payload"}), 400

        logger.info(
            "Transcribe request bytes=%s filename=%s session_id=%s speaker_id=%s",
            len(audio_bytes),
            filename,
            session_id_raw,
            speaker_id,
        )

        text = transcribe_audio(audio_bytes=audio_bytes, filename=filename, language=language, model=model)

        transcript_id = None
        transcript_row = None

        if session_id_raw:
            try:
                session_id = int(session_id_raw)
            except ValueError:
                return jsonify({"success": False, "error": "Invalid session_id"}), 400

            conn = getDbConnection()
            if not conn:
                return jsonify({"success": False, "error": "Database connection failed"}), 500

            cursor = conn.cursor()
            _ensure_transcripts_schema(cursor)

            cursor.execute(
                """
                INSERT INTO transcripts (session_id, speaker_id, text, language)
                VALUES (%s, %s, %s, %s)
                RETURNING id, session_id, speaker_id, text, language, timestamp
                """,
                (session_id, speaker_id, text, language),
            )
            row = cursor.fetchone()
            conn.commit()

            transcript_id = row[0]
            transcript_row = {
                "id": row[0],
                "session_id": row[1],
                "speaker_id": row[2],
                "text": row[3],
                "language": row[4],
                "timestamp": row[5].isoformat() if row[5] else None,
            }

        return jsonify(
            {
                "success": True,
                "text": text,
                "transcript": text,
                "id": transcript_id,
                "transcript_row": transcript_row,
            }
        ), 200

    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("/transcribe failed")
        return jsonify({"success": False, "error": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@transcription_bp.route("/transcripts/<int:session_id>", methods=["GET"])
def get_transcripts(session_id):
    conn = None
    cursor = None

    try:
        limit = _parse_positive_int(request.args.get("limit", 1000), 1000)
        offset = _parse_positive_int(request.args.get("offset", 0), 0)
        speaker_filter = request.args.get("speaker")

        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed", "transcripts": [], "total": 0}), 500

        cursor = conn.cursor()
        _ensure_transcripts_schema(cursor)

        # Verify session exists in transcripts set; if not, return empty result (not 500).
        cursor.execute("SELECT COUNT(*) FROM transcripts WHERE session_id = %s", (session_id,))
        total_for_session = cursor.fetchone()[0]

        if total_for_session == 0:
            return jsonify(
                {
                    "success": True,
                    "transcripts": [],
                    "pagination": {"total": 0, "limit": limit, "offset": offset},
                    "total": 0,
                }
            ), 200

        query = """
            SELECT id, session_id, speaker_id, text, timestamp, language, is_translated, original_text
            FROM transcripts
            WHERE session_id = %s
        """
        params = [session_id]

        if speaker_filter:
            query += " AND speaker_id = %s"
            params.append(str(speaker_filter))

        query += " ORDER BY timestamp ASC, id ASC LIMIT %s OFFSET %s"
        params.extend([limit, offset])

        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()

        transcripts = []
        for row in rows:
            participant_name = _safe_participant_name(cursor, row[1], row[2])
            transcripts.append(
                {
                    "id": row[0],
                    "session_id": row[1],
                    "speaker_id": row[2],
                    "text": row[3],
                    "timestamp": row[4].isoformat() if row[4] else None,
                    "language": row[5],
                    "is_translated": row[6],
                    "original_text": row[7],
                    "participant_name": participant_name,
                }
            )

        return jsonify(
            {
                "success": True,
                "transcripts": transcripts,
                "pagination": {
                    "total": total_for_session,
                    "limit": limit,
                    "offset": offset,
                },
                "total": total_for_session,
            }
        ), 200

    except Exception as exc:
        logger.exception("/transcripts/%s failed", session_id)
        return jsonify({"success": False, "error": str(exc), "transcripts": [], "total": 0}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@transcription_bp.route("/transcripts/<int:transcript_id>", methods=["DELETE"])
def remove_transcript(transcript_id):
    conn = None
    cursor = None

    try:
        user_role = str(request.headers.get("x-user-role") or "").lower()
        if not user_role and request.is_json:
            body = request.get_json(silent=True) or {}
            user_role = str(body.get("role") or "").lower()

        if user_role not in ("teacher", "admin"):
            return jsonify({"success": False, "error": "Only teacher can delete transcripts"}), 403

        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500

        cursor = conn.cursor()
        _ensure_transcripts_schema(cursor)

        cursor.execute("DELETE FROM transcripts WHERE id = %s RETURNING id", (transcript_id,))
        row = cursor.fetchone()

        if not row:
            conn.rollback()
            return jsonify({"success": False, "error": "Transcript not found"}), 404

        conn.commit()
        return jsonify({"success": True, "id": row[0]}), 200

    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Delete transcript failed")
        return jsonify({"success": False, "error": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
