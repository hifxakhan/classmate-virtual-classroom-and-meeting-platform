"""
migrate_recap.py
================
Safe, idempotent migration for all lecture-recap tables and indexes.

Rules:
  - Every DDL uses IF NOT EXISTS / IF NOT EXISTS ON COLUMN  → no data loss ever.
  - Run any number of times; result is always the same.
  - Reads the same DATABASE_URL (or DB_*) env vars as the app.

Usage:
    cd classmate-virtual-classroom-and-meeting-platform/code/my-react-app/src/ClassMate-Backend
    python migrate_recap.py
"""

import sys
import os
from pathlib import Path
from dotenv import load_dotenv

# ── load env the same way app.py does ──────────────────────────────────────
_react_app_root = Path(__file__).resolve().parent.parent.parent
load_dotenv(_react_app_root / '.env')   # my-react-app/.env  (has OPENAI_API_KEY etc.)
load_dotenv()                           # optional local .env in CWD

# ── import the shared db helper ─────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))
from db import getDbConnection

# ── migration steps ──────────────────────────────────────────────────────────
STEPS = [

    # ── 1. session_transcript_line ──────────────────────────────────────────
    (
        "Create session_transcript_line",
        """
        CREATE TABLE IF NOT EXISTS session_transcript_line (
            id           SERIAL      PRIMARY KEY,
            session_id   TEXT        NOT NULL,
            line_index   INT         NOT NULL,
            speaker_id   VARCHAR(64) NOT NULL,
            speaker_type VARCHAR(32) NOT NULL,
            text         TEXT        NOT NULL,
            created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (session_id, line_index)
        )
        """,
    ),

    # ── 2. session_summary ──────────────────────────────────────────────────
    (
        "Create session_summary",
        """
        CREATE TABLE IF NOT EXISTS session_summary (
            session_id      TEXT        PRIMARY KEY,
            student_summary TEXT,
            teacher_summary TEXT,
            model           TEXT,
            status          VARCHAR(32) DEFAULT 'ok',
            error_message   TEXT,
            updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
        """,
    ),

    # ── 3. quiz ─────────────────────────────────────────────────────────────
    (
        "Create quiz",
        """
        CREATE TABLE IF NOT EXISTS quiz (
            quiz_id               SERIAL      PRIMARY KEY,
            course_id             VARCHAR(64) NOT NULL,
            session_id            TEXT,
            title                 TEXT        NOT NULL,
            created_by_teacher_id VARCHAR(64),
            created_at            TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
        """,
    ),
    (
        "Add missing quiz.created_by_teacher_id",
        """
        ALTER TABLE quiz
        ADD COLUMN IF NOT EXISTS created_by_teacher_id VARCHAR(64)
        """,
    ),

    # ── 4. quiz_question ────────────────────────────────────────────────────
    (
        "Create quiz_question",
        """
        CREATE TABLE IF NOT EXISTS quiz_question (
            id             SERIAL  PRIMARY KEY,
            quiz_id        INT     NOT NULL REFERENCES quiz(quiz_id) ON DELETE CASCADE,
            question_order INT     NOT NULL,
            question_text  TEXT    NOT NULL,
            option_a       TEXT    NOT NULL,
            option_b       TEXT    NOT NULL,
            option_c       TEXT    NOT NULL,
            option_d       TEXT    NOT NULL,
            correct_index  INT     NOT NULL
        )
        """,
    ),

    # ── 5. Indexes (all use IF NOT EXISTS so safe to re-run) ────────────────
    (
        "Index: session_transcript_line(session_id)",
        """
        CREATE INDEX IF NOT EXISTS idx_stl_session_id
        ON session_transcript_line (session_id)
        """,
    ),
    (
        "Index: quiz(course_id)",
        """
        CREATE INDEX IF NOT EXISTS idx_quiz_course_id
        ON quiz (course_id)
        """,
    ),
    (
        "Index: quiz(session_id)",
        """
        CREATE INDEX IF NOT EXISTS idx_quiz_session_id
        ON quiz (session_id)
        """,
    ),
    (
        "Index: quiz_question(quiz_id)",
        """
        CREATE INDEX IF NOT EXISTS idx_qq_quiz_id
        ON quiz_question (quiz_id)
        """,
    ),
]


def run():
    print("=" * 60)
    print("ClassMate — lecture recap migration")
    print("=" * 60)

    conn = getDbConnection()
    if not conn:
        print("\n❌  Could not connect to the database.")
        print("    Check DATABASE_URL (or DB_*) in your .env file.")
        sys.exit(1)

    cur = conn.cursor()
    ok = 0
    errors = []

    for label, sql in STEPS:
        try:
            cur.execute(sql)
            conn.commit()
            print(f"  ✔  {label}")
            ok += 1
        except Exception as exc:
            conn.rollback()
            msg = str(exc).strip().splitlines()[0]
            print(f"  ✘  {label}")
            print(f"       {msg}")
            errors.append((label, msg))

    cur.close()
    conn.close()

    print("-" * 60)
    print(f"Done: {ok}/{len(STEPS)} steps succeeded.")

    if errors:
        print(f"\n⚠️  {len(errors)} step(s) failed:")
        for lbl, err in errors:
            print(f"    • {lbl}: {err}")
        sys.exit(1)
    else:
        print("\n✅  All recap tables and indexes are up to date. No data was changed.")


if __name__ == "__main__":
    run()
