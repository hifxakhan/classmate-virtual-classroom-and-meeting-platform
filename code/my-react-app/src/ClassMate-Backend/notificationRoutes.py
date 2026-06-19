"""Notification system for ClassMate — bell alerts for students and teachers."""

from flask import Blueprint, jsonify, request
from db import getDbConnection

notification_bp = Blueprint('notification', __name__)


def _ensure_table(cursor):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notification (
            notification_id SERIAL PRIMARY KEY,
            recipient_id    VARCHAR(64)  NOT NULL,
            recipient_type  VARCHAR(16)  NOT NULL,
            title           TEXT         NOT NULL,
            message         TEXT         DEFAULT '',
            notif_type      VARCHAR(32),
            ref_id          INT,
            ref_type        VARCHAR(32),
            is_read         BOOLEAN      DEFAULT FALSE,
            created_at      TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_notif_recipient "
        "ON notification(recipient_id, recipient_type, is_read, created_at DESC)"
    )


# ── cursor-based helpers (call BEFORE conn.commit() in existing routes) ────────

def notify_one(cursor, recipient_id, recipient_type, title,
               message='', notif_type=None, ref_id=None, ref_type=None):
    """Insert one notification using an existing cursor."""
    try:
        _ensure_table(cursor)
        cursor.execute("""
            INSERT INTO notification
                (recipient_id, recipient_type, title, message, notif_type, ref_id, ref_type)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (recipient_id, recipient_type, title, message or '', notif_type, ref_id, ref_type))
    except Exception:
        pass  # notifications are best-effort; never break the main operation


def notify_course_students(cursor, course_id, title,
                           message='', notif_type=None, ref_id=None, ref_type=None):
    """Notify every enrolled student of a course using an existing cursor."""
    try:
        _ensure_table(cursor)
        cursor.execute("""
            SELECT e.student_id FROM enrollment e
            WHERE e.course_id::text = %s AND COALESCE(e.is_active, true)
        """, (str(course_id),))
        for (sid,) in cursor.fetchall():
            cursor.execute("""
                INSERT INTO notification
                    (recipient_id, recipient_type, title, message, notif_type, ref_id, ref_type)
                VALUES (%s, 'student', %s, %s, %s, %s, %s)
            """, (sid, title, message or '', notif_type, ref_id, ref_type))
    except Exception:
        pass


# ── REST endpoints ─────────────────────────────────────────────────────────────

@notification_bp.route('/api/notifications', methods=['GET'])
def get_notifications():
    user_id   = request.args.get('user_id')
    user_type = request.args.get('user_type', 'student')
    limit     = min(int(request.args.get('limit', 30)), 100)
    offset    = int(request.args.get('offset', 0))
    if not user_id:
        return jsonify({'success': False, 'error': 'user_id required'}), 400
    conn = getDbConnection()
    if not conn:
        return jsonify({'success': False, 'error': 'DB connection failed'}), 500
    try:
        cursor = conn.cursor()
        _ensure_table(cursor)
        conn.commit()
        cursor.execute("""
            SELECT notification_id, title, message, notif_type,
                   ref_id, ref_type, is_read, created_at
            FROM notification
            WHERE recipient_id = %s AND recipient_type = %s
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
        """, (user_id, user_type, limit, offset))
        rows = cursor.fetchall()
        notifs = [{
            'notification_id': r[0],
            'title':      r[1],
            'message':    r[2] or '',
            'notif_type': r[3] or '',
            'ref_id':     r[4],
            'ref_type':   r[5] or '',
            'is_read':    r[6],
            'created_at': r[7].isoformat() if r[7] else None,
        } for r in rows]
        cursor.close(); conn.close()
        return jsonify({'success': True, 'notifications': notifs}), 200
    except Exception as e:
        try: conn.close()
        except Exception: pass
        return jsonify({'success': False, 'error': str(e)}), 500


@notification_bp.route('/api/notifications/unread-count', methods=['GET'])
def get_unread_count():
    user_id   = request.args.get('user_id')
    user_type = request.args.get('user_type', 'student')
    if not user_id:
        return jsonify({'success': False, 'error': 'user_id required'}), 400
    conn = getDbConnection()
    if not conn:
        return jsonify({'success': False, 'error': 'DB connection failed'}), 500
    try:
        cursor = conn.cursor()
        _ensure_table(cursor)
        conn.commit()
        cursor.execute("""
            SELECT COUNT(*) FROM notification
            WHERE recipient_id = %s AND recipient_type = %s AND is_read = FALSE
        """, (user_id, user_type))
        count = cursor.fetchone()[0]
        cursor.close(); conn.close()
        return jsonify({'success': True, 'count': int(count)}), 200
    except Exception as e:
        try: conn.close()
        except Exception: pass
        return jsonify({'success': False, 'error': str(e)}), 500


@notification_bp.route('/api/notifications/<int:notification_id>/read', methods=['PATCH'])
def mark_read(notification_id):
    conn = getDbConnection()
    if not conn:
        return jsonify({'success': False, 'error': 'DB connection failed'}), 500
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE notification SET is_read = TRUE WHERE notification_id = %s",
            (notification_id,)
        )
        conn.commit(); cursor.close(); conn.close()
        return jsonify({'success': True}), 200
    except Exception as e:
        try: conn.close()
        except Exception: pass
        return jsonify({'success': False, 'error': str(e)}), 500


@notification_bp.route('/api/notifications/mark-all-read', methods=['PATCH'])
def mark_all_read():
    user_id   = request.args.get('user_id')
    user_type = request.args.get('user_type', 'student')
    if not user_id:
        return jsonify({'success': False, 'error': 'user_id required'}), 400
    conn = getDbConnection()
    if not conn:
        return jsonify({'success': False, 'error': 'DB connection failed'}), 500
    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE notification SET is_read = TRUE
            WHERE recipient_id = %s AND recipient_type = %s AND is_read = FALSE
        """, (user_id, user_type))
        conn.commit(); cursor.close(); conn.close()
        return jsonify({'success': True}), 200
    except Exception as e:
        try: conn.close()
        except Exception: pass
        return jsonify({'success': False, 'error': str(e)}), 500
