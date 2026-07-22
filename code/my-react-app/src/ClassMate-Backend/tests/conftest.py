import os

import pytest


@pytest.fixture(scope="session")
def flask_app():
    """Full Flask app (imports app.py side effects: blueprints, table ensure)."""
    import app as app_module

    app_module.app.config["TESTING"] = True
    return app_module.app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


def _ensure_minimal_core_tables(cur):
    """Create core tables on empty dev DBs (models.create_tables uses DB_* not DATABASE_URL)."""
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS teacher (
            teacher_id VARCHAR(50) PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            department TEXT,
            phone TEXT,
            profile_image_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS student (
            student_id VARCHAR(50) PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            semester INTEGER,
            phone TEXT,
            profile_image_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            email_verified BOOLEAN DEFAULT FALSE
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS course (
            course_id VARCHAR(64) PRIMARY KEY,
            course_code VARCHAR(64) NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            credit_hours INTEGER,
            teacher_id VARCHAR(50) REFERENCES teacher(teacher_id),
            department TEXT,
            semester TEXT,
            status VARCHAR(32) DEFAULT 'active',
            max_students INTEGER DEFAULT 50,
            syllabus_url TEXT,
            schedule TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS enrollment (
            enrollment_id SERIAL PRIMARY KEY,
            student_id VARCHAR(50) NOT NULL REFERENCES student(student_id),
            course_id VARCHAR(64) NOT NULL REFERENCES course(course_id),
            enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE,
            UNIQUE(student_id, course_id)
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS class_session (
            session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            course_id VARCHAR(64) NOT NULL REFERENCES course(course_id),
            title TEXT NOT NULL,
            description TEXT,
            start_time TIMESTAMP,
            end_time TIMESTAMP,
            meeting_room_id TEXT,
            meeting_token TEXT,
            is_private BOOLEAN DEFAULT FALSE,
            recording_path TEXT,
            recording_available BOOLEAN DEFAULT FALSE,
            status VARCHAR(32) DEFAULT 'scheduled',
            participants_count INTEGER DEFAULT 0,
            materials TEXT,
            notes TEXT
        )
        """
    )


def pytest_sessionstart(session):
    """Seed DB rows for lecture recap HTTP tests (requires working DATABASE_URL)."""
    if os.environ.get("CLASSMATE_SKIP_RECAP_SEED"):
        return
    try:
        from pathlib import Path

        from dotenv import load_dotenv

        backend_dir = Path(__file__).resolve().parent.parent
        app_root = backend_dir.parent
        load_dotenv(app_root / ".env")
        load_dotenv(backend_dir / ".env")

        from datetime import datetime, timedelta, timezone

        from db import getDbConnection
        from lecture_recap_routes import ensure_lecture_recap_tables

        conn = getDbConnection()
        if not conn:
            print("[pytest] lecture recap seed: skipped (no DB)")
            return

        cur = conn.cursor()
        _ensure_minimal_core_tables(cur)
        conn.commit()
        cur.close()
        cur = conn.cursor()
        ensure_lecture_recap_tables(cur)
        conn.commit()

        cur.execute(
            """
            INSERT INTO teacher (teacher_id, name, email, password_hash)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (teacher_id) DO UPDATE SET name = EXCLUDED.name
            """,
            ("T1", "Recap T1", "recap_t1_rectest@example.com", "x"),
        )
        cur.execute(
            """
            INSERT INTO teacher (teacher_id, name, email, password_hash)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (teacher_id) DO UPDATE SET name = EXCLUDED.name
            """,
            ("OTHER_T", "Other T", "recap_othert_rectest@example.com", "x"),
        )
        for sid, name, em in [
            ("S1", "Recap S1", "recap_s1_rectest@example.com"),
            ("ENROLLED_S", "Recap ES", "recap_es_rectest@example.com"),
            ("OUTSIDER", "Out", "recap_out_rectest@example.com"),
        ]:
            cur.execute(
                """
                INSERT INTO student (student_id, name, email, password_hash)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (student_id) DO UPDATE SET name = EXCLUDED.name
                """,
                (sid, name, em, "x"),
            )

        cur.execute(
            """
            INSERT INTO course (
                course_id, course_code, title, description, credit_hours,
                teacher_id, department, semester, status, max_students,
                syllabus_url, schedule
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (course_id) DO NOTHING
            """,
            (
                "course-test-1",
                "RC101",
                "Recap test course",
                "",
                3,
                "T1",
                None,
                None,
                "active",
                50,
                None,
                None,
            ),
        )

        for st in ("S1", "ENROLLED_S"):
            cur.execute(
                """
                INSERT INTO enrollment (student_id, course_id, enrolled_at, is_active)
                VALUES (%s, %s, NOW(), true)
                ON CONFLICT (student_id, course_id) DO NOTHING
                """,
                (st, "course-test-1"),
            )

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        end = now + timedelta(hours=1)
        materials = "{}"

        cur.execute(
            """
            INSERT INTO class_session (
                course_id, title, description, start_time, end_time,
                meeting_room_id, meeting_token, is_private, recording_path,
                recording_available, status, participants_count, materials, notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING session_id::text
            """,
            (
                "course-test-1",
                "Recap main",
                "",
                now,
                end,
                "mr-recap-main",
                "tok1",
                False,
                None,
                False,
                "completed",
                0,
                materials,
                "",
            ),
        )
        main_sid = cur.fetchone()[0]

        cur.execute(
            """
            INSERT INTO class_session (
                course_id, title, description, start_time, end_time,
                meeting_room_id, meeting_token, is_private, recording_path,
                recording_available, status, participants_count, materials, notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING session_id::text
            """,
            (
                "course-test-1",
                "Recap empty transcript",
                "",
                now,
                end,
                "mr-recap-empty",
                "tok2",
                False,
                None,
                False,
                "completed",
                0,
                materials,
                "",
            ),
        )
        empty_sid = cur.fetchone()[0]

        cur.execute(
            """
            INSERT INTO class_session (
                course_id, title, description, start_time, end_time,
                meeting_room_id, meeting_token, is_private, recording_path,
                recording_available, status, participants_count, materials, notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING session_id::text
            """,
            (
                "course-test-1",
                "Recap idempotent summarize",
                "",
                now,
                end,
                "mr-recap-idem",
                "tok3",
                False,
                None,
                False,
                "completed",
                0,
                materials,
                "",
            ),
        )
        idem_sid = cur.fetchone()[0]

        cur.execute(
            """
            INSERT INTO session_transcript_line (session_id, line_index, speaker_id, speaker_type, text)
            VALUES (%s, 1, 'T1', 'teacher', 'Seed transcript line for recap tests.')
            ON CONFLICT (session_id, line_index) DO NOTHING
            """,
            (main_sid,),
        )
        cur.execute(
            """
            INSERT INTO session_transcript_line (session_id, line_index, speaker_id, speaker_type, text)
            VALUES (%s, 1, 'T1', 'teacher', 'Idempotent test transcript line.')
            ON CONFLICT (session_id, line_index) DO NOTHING
            """,
            (idem_sid,),
        )

        conn.commit()
        cur.close()
        conn.close()

        os.environ["CLASSMATE_RECAP_TEST_SESSION_ID"] = str(main_sid)
        os.environ["CLASSMATE_RECAP_EMPTY_SESSION_ID"] = str(empty_sid)
        os.environ["CLASSMATE_RECAP_IDEMPOTENT_SESSION_ID"] = str(idem_sid)
        print(
            "[pytest] lecture recap seed OK:",
            main_sid,
            "empty=",
            empty_sid,
            "idem=",
            idem_sid,
        )
    except Exception as e:
        print("[pytest] lecture recap seed failed:", e)
