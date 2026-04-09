from flask import Blueprint, jsonify, request
from db import getDbConnection
import os
import time
import base64
import requests

transcription_bp = Blueprint('transcription', __name__)

WHISPER_URL = 'https://api-inference.huggingface.co/models/openai/whisper-base'


def _parse_positive_int(value, default_value):
    try:
        parsed = int(value)
        if parsed < 0:
            return default_value
        return parsed
    except (TypeError, ValueError):
        return default_value


def _ensure_session_exists(cursor, session_id):
    cursor.execute("SELECT id FROM class_session WHERE id = %s", (session_id,))
    if cursor.fetchone():
        return

    # Best-effort placeholder session creation when transcript arrives before session row.
    try:
        cursor.execute(
            """
            INSERT INTO class_session (id, room_name, status, start_time)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (id) DO NOTHING
            """,
            (session_id, f'session_{session_id}', 'ongoing')
        )
    except Exception:
        # Some schemas may enforce additional columns. We keep this non-fatal.
        pass


def _ensure_participant_exists(cursor, session_id, speaker_id, participant_name=None):
    cursor.execute(
        """
        INSERT INTO call_participants (session_id, participant_identity, participant_name)
        SELECT %s, %s, %s
        WHERE NOT EXISTS (
            SELECT 1
            FROM call_participants
            WHERE session_id = %s AND participant_identity = %s
        )
        """,
        (session_id, speaker_id, participant_name, session_id, speaker_id)
    )


def _call_whisper_with_retry(base64_audio, language='en', max_retries=3):
    api_key = os.environ.get('HUGGINGFACE_API_KEY')
    if not api_key:
        raise RuntimeError('HUGGINGFACE_API_KEY is not configured')

    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }

    payload = {
        'inputs': base64_audio,
        'parameters': {
            'language': language,
        },
    }

    last_error = None
    for attempt in range(1, max_retries + 1):
        response = requests.post(WHISPER_URL, headers=headers, json=payload, timeout=120)

        if response.status_code == 429:
            retry_after = int(response.headers.get('Retry-After', '2'))
            if attempt == max_retries:
                return {
                    'ok': False,
                    'status': 429,
                    'retry_after': retry_after,
                    'error': 'Hugging Face rate limit reached',
                }
            time.sleep(retry_after * attempt)
            continue

        if response.status_code >= 500:
            last_error = f'Whisper server error: {response.status_code}'
            if attempt == max_retries:
                break
            time.sleep(0.5 * (2 ** attempt))
            continue

        if response.status_code != 200:
            try:
                body = response.json()
            except Exception:
                body = {'error': response.text}
            return {
                'ok': False,
                'status': response.status_code,
                'error': body.get('error') or 'Whisper API call failed',
            }

        data = response.json()

        # HF can return temporary loading state with estimated_time.
        if isinstance(data, dict) and data.get('error') and 'loading' in str(data.get('error')).lower():
            estimated = int(data.get('estimated_time', 2))
            if attempt == max_retries:
                return {
                    'ok': False,
                    'status': 503,
                    'error': data.get('error'),
                }
            time.sleep(max(1, estimated))
            continue

        text = ''
        if isinstance(data, dict):
            text = (data.get('text') or '').strip()

        return {
            'ok': True,
            'status': 200,
            'text': text,
            'raw': data,
        }

    return {
        'ok': False,
        'status': 500,
        'error': last_error or 'Whisper transcription failed after retries',
    }


@transcription_bp.route('/api/transcribe', methods=['POST'])
def transcribe_audio():
    conn = None
    cursor = None
    try:
        audio_file = request.files.get('audio')
        session_id_raw = request.form.get('session_id')
        speaker_id = str(request.form.get('speaker_id') or '').strip()
        language = str(request.form.get('language') or 'en').strip()

        if not audio_file:
            return jsonify({'success': False, 'error': 'audio file is required'}), 400

        if not session_id_raw or not speaker_id:
            return jsonify({'success': False, 'error': 'session_id and speaker_id are required'}), 400

        try:
            session_id = int(session_id_raw)
        except ValueError:
            return jsonify({'success': False, 'error': 'Invalid session_id'}), 400

        audio_bytes = audio_file.read()
        if not audio_bytes:
            return jsonify({'success': False, 'error': 'Empty audio chunk'}), 400

        if len(audio_bytes) > 10 * 1024 * 1024:
            return jsonify({'success': False, 'error': 'Audio file exceeds 10MB limit'}), 413

        base64_audio = base64.b64encode(audio_bytes).decode('utf-8')

        whisper_result = _call_whisper_with_retry(base64_audio, language=language, max_retries=3)
        if not whisper_result.get('ok'):
            status = whisper_result.get('status', 500)
            if status == 429:
                return jsonify({
                    'success': False,
                    'error': 'Transcription queue full, waiting...',
                    'retry_after': whisper_result.get('retry_after', 2)
                }), 429
            return jsonify({
                'success': False,
                'error': whisper_result.get('error', 'Whisper transcription failed')
            }), status

        transcript_text = whisper_result.get('text', '')
        if not transcript_text:
            return jsonify({
                'success': True,
                'transcript': '',
                'id': None,
                'message': 'No speech detected'
            }), 200

        conn = getDbConnection()
        if not conn:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500

        cursor = conn.cursor()

        _ensure_session_exists(cursor, session_id)
        _ensure_participant_exists(cursor, session_id, speaker_id)

        cursor.execute(
            """
            INSERT INTO transcripts (session_id, speaker_id, text, language)
            VALUES (%s, %s, %s, %s)
            RETURNING id, session_id, speaker_id, text, language, timestamp
            """,
            (session_id, speaker_id, transcript_text, language)
        )

        row = cursor.fetchone()
        conn.commit()

        return jsonify({
            'success': True,
            'id': row[0],
            'transcript': row[3],
            'transcript_row': {
                'id': row[0],
                'session_id': row[1],
                'speaker_id': row[2],
                'text': row[3],
                'language': row[4],
                'timestamp': row[5].isoformat() if row[5] else None,
            }
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@transcription_bp.route('/api/transcripts/<int:session_id>', methods=['GET'])
def get_transcripts(session_id):
    conn = None
    cursor = None
    try:
        limit = _parse_positive_int(request.args.get('limit', 100), 100)
        offset = _parse_positive_int(request.args.get('offset', 0), 0)
        speaker_filter = request.args.get('speaker')

        conn = getDbConnection()
        if not conn:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500

        cursor = conn.cursor()

        query = """
            SELECT
                t.id,
                t.session_id,
                t.speaker_id,
                t.text,
                t.timestamp,
                t.language,
                t.is_translated,
                t.original_text,
                cp.participant_name
            FROM transcripts t
            LEFT JOIN call_participants cp
              ON cp.session_id = t.session_id
             AND cp.participant_identity = t.speaker_id
            WHERE t.session_id = %s
        """

        params = [session_id]
        if speaker_filter:
            query += " AND t.speaker_id = %s"
            params.append(str(speaker_filter))

        query += " ORDER BY t.timestamp ASC, t.id ASC LIMIT %s OFFSET %s"
        params.extend([limit, offset])

        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()

        cursor.execute("SELECT COUNT(*) FROM transcripts WHERE session_id = %s", (session_id,))
        total = cursor.fetchone()[0]

        transcripts = []
        for row in rows:
            transcripts.append({
                'id': row[0],
                'session_id': row[1],
                'speaker_id': row[2],
                'text': row[3],
                'timestamp': row[4].isoformat() if row[4] else None,
                'language': row[5],
                'is_translated': row[6],
                'original_text': row[7],
                'participant_name': row[8],
            })

        return jsonify({
            'success': True,
            'transcripts': transcripts,
            'pagination': {
                'total': total,
                'limit': limit,
                'offset': offset,
            }
        }), 200

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@transcription_bp.route('/api/transcripts/<int:transcript_id>', methods=['DELETE'])
def remove_transcript(transcript_id):
    conn = None
    cursor = None
    try:
        user_role = str(request.headers.get('x-user-role') or '').lower()
        if not user_role and request.is_json:
            body = request.get_json(silent=True) or {}
            user_role = str(body.get('role') or '').lower()

        if user_role not in ('teacher', 'admin'):
            return jsonify({'success': False, 'error': 'Only teacher can delete transcripts'}), 403

        conn = getDbConnection()
        if not conn:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500

        cursor = conn.cursor()
        cursor.execute("DELETE FROM transcripts WHERE id = %s RETURNING id", (transcript_id,))
        row = cursor.fetchone()

        if not row:
            conn.rollback()
            return jsonify({'success': False, 'error': 'Transcript not found'}), 404

        conn.commit()
        return jsonify({'success': True, 'id': row[0]}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
