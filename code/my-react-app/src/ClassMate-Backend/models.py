"""
Database Models for ClassMate Platform
Includes models for Messages, Video Calls, and related entities
"""

import psycopg2
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

def getDbConnection():
    """Create and return database connection"""
    try:
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            database=os.getenv('DB_NAME', 'ClassMate'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', 'Hifza12#'),
            port=os.getenv('DB_PORT', 5432)
        )
        return conn
    except Exception as e:
        print(f"Database connection FAILED: {e}")
        return None


def create_tables():
    """Create all necessary tables for core, chat and video call functionality"""
    conn = getDbConnection()
    if not conn:
        print("Failed to create database connection")
        return False
    
    cursor = conn.cursor()
    
    try:
        # ===== CORE USER TABLES =====
        cursor.execute("""
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
        """)
        print("[DONE] Student table created/verified")

        cursor.execute("""
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
        """)
        print("[DONE] Teacher table created/verified")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS admin (
                admin_id VARCHAR(50) PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        print("[DONE] Admin table created/verified")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_verification (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL,
                otp_code TEXT NOT NULL,
                role TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        print("[DONE] Email verification table created/verified")

        # ===== MESSAGES TABLE =====
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                message_id SERIAL PRIMARY KEY,
                sender_id VARCHAR(255) NOT NULL,
                sender_type VARCHAR(50) NOT NULL,
                receiver_id VARCHAR(255) NOT NULL,
                receiver_type VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_read BOOLEAN DEFAULT FALSE,
                read_at TIMESTAMP,
                message_type VARCHAR(50) DEFAULT 'text',
                file_url TEXT,
                file_name VARCHAR(255)
            )
        """)
        print("[DONE] Messages table created/verified")
        
        # ===== VIDEO CALLS TABLE =====
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS video_calls (
                call_id SERIAL PRIMARY KEY,
                initiator_id VARCHAR(255) NOT NULL,
                initiator_type VARCHAR(50) NOT NULL,
                receiver_id VARCHAR(255) NOT NULL,
                receiver_type VARCHAR(50) NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                started_at TIMESTAMP,
                ended_at TIMESTAMP,
                duration_seconds INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                room_id VARCHAR(255) UNIQUE,
                is_group_call BOOLEAN DEFAULT FALSE
            )
        """)
        print("[DONE] Video calls table created/verified")
        
        # ===== CALL PARTICIPANTS TABLE (for group calls) =====
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS call_participants (
                participant_id SERIAL PRIMARY KEY,
                call_id INT NOT NULL REFERENCES video_calls(call_id) ON DELETE CASCADE,
                user_id VARCHAR(255) NOT NULL,
                user_type VARCHAR(50) NOT NULL,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                left_at TIMESTAMP,
                is_audio_enabled BOOLEAN DEFAULT TRUE,
                is_video_enabled BOOLEAN DEFAULT TRUE
            )
        """)
        print("[DONE] Call participants table created/verified")
        
        # ===== MESSAGE THREADS TABLE (for conversation grouping) =====
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS message_threads (
                thread_id SERIAL PRIMARY KEY,
                user1_id VARCHAR(255) NOT NULL,
                user1_type VARCHAR(50) NOT NULL,
                user2_id VARCHAR(255) NOT NULL,
                user2_type VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_message_id INT,
                last_message_at TIMESTAMP,
                UNIQUE(user1_id, user1_type, user2_id, user2_type)
            )
        """)
        print("[DONE] Message threads table created/verified")
        
        # ===== CREATE INDEXES =====
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_sender 
            ON messages(sender_id, sender_type)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_receiver 
            ON messages(receiver_id, receiver_type)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_thread 
            ON messages(sender_id, receiver_id, created_at)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_video_calls_status 
            ON video_calls(status)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_call_participants_user 
            ON call_participants(user_id, user_type)
        """)
        print("[DONE] Indexes created/verified")
        
        conn.commit()
        print("\n[OK] All database tables created successfully!")
        return True
        
    except Exception as e:
        print(f"[ERROR] Error creating tables: {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()


# Message operations
class Message:
    @staticmethod
    def save_message(sender_id, sender_type, receiver_id, receiver_type, content, message_type='text', file_url=None, file_name=None):
        """Save a message to database"""
        conn = getDbConnection()
        if not conn:
            return None
        
        cursor = conn.cursor()
        try:
            cursor.execute("""
                INSERT INTO messages 
                (sender_id, sender_type, receiver_id, receiver_type, content, message_type, file_url, file_name)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING message_id, created_at
            """, (sender_id, sender_type, receiver_id, receiver_type, content, message_type, file_url, file_name))
            
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return {
                    'message_id': result[0],
                    'created_at': result[1]
                }
            return None
        except Exception as e:
            print(f"Error saving message: {e}")
            conn.rollback()
            return None
        finally:
            cursor.close()
            conn.close()
    
    @staticmethod
    def get_conversation(user1_id, user1_type, user2_id, user2_type, limit=50, offset=0):
        """Get conversation between two users"""
        conn = getDbConnection()
        if not conn:
            return []
        
        cursor = conn.cursor()
        try:
            cursor.execute("""
                SELECT message_id, sender_id, sender_type, receiver_id, receiver_type, 
                       content, created_at, is_read, message_type, file_url, file_name
                FROM messages
                WHERE (sender_id = %s AND receiver_id = %s) 
                   OR (sender_id = %s AND receiver_id = %s)
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
            """, (user1_id, user2_id, user2_id, user1_id, limit, offset))
            
            messages = cursor.fetchall()
            result = []
            for msg in messages:
                result.append({
                    'message_id': msg[0],
                    'sender_id': msg[1],
                    'sender_type': msg[2],
                    'receiver_id': msg[3],
                    'receiver_type': msg[4],
                    'content': msg[5],
                    'created_at': msg[6].isoformat() if msg[6] else None,
                    'is_read': msg[7],
                    'message_type': msg[8],
                    'file_url': msg[9],
                    'file_name': msg[10]
                })
            
            return result[::-1]  # Reverse to get oldest first
        except Exception as e:
            print(f"Error getting conversation: {e}")
            return []
        finally:
            cursor.close()
            conn.close()
    
    @staticmethod
    def mark_as_read(message_id):
        """Mark message as read"""
        conn = getDbConnection()
        if not conn:
            return False
        
        cursor = conn.cursor()
        try:
            cursor.execute("""
                UPDATE messages 
                SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
                WHERE message_id = %s
            """, (message_id,))
            conn.commit()
            return True
        except Exception as e:
            print(f"Error marking message as read: {e}")
            return False
        finally:
            cursor.close()
            conn.close()


# Video Call operations
class VideoCall:
    @staticmethod
    def create_call(initiator_id, initiator_type, receiver_id, receiver_type, room_id=None):
        """Create a new video call"""
        conn = getDbConnection()
        if not conn:
            return None
        
        cursor = conn.cursor()
        try:
            cursor.execute("""
                INSERT INTO video_calls 
                (initiator_id, initiator_type, receiver_id, receiver_type, room_id, status)
                VALUES (%s, %s, %s, %s, %s, 'pending')
                RETURNING call_id, room_id
            """, (initiator_id, initiator_type, receiver_id, receiver_type, room_id))
            
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return {
                    'call_id': result[0],
                    'room_id': result[1]
                }
            return None
        except Exception as e:
            print(f"Error creating call: {e}")
            conn.rollback()
            return None
        finally:
            cursor.close()
            conn.close()
    
    @staticmethod
    def update_call_status(call_id, status):
        """Update call status (pending, active, ended, declined)"""
        conn = getDbConnection()
        if not conn:
            return False
        
        cursor = conn.cursor()
        try:
            if status == 'active':
                cursor.execute("""
                    UPDATE video_calls 
                    SET status = %s, started_at = CURRENT_TIMESTAMP
                    WHERE call_id = %s
                """, (status, call_id))
            elif status == 'ended':
                cursor.execute("""
                    UPDATE video_calls 
                    SET status = %s, ended_at = CURRENT_TIMESTAMP,
                        duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))::INT
                    WHERE call_id = %s
                """, (status, call_id))
            else:
                cursor.execute("""
                    UPDATE video_calls 
                    SET status = %s
                    WHERE call_id = %s
                """, (status, call_id))
            
            conn.commit()
            return True
        except Exception as e:
            print(f"Error updating call status: {e}")
            return False
        finally:
            cursor.close()
            conn.close()
    
    @staticmethod
    def get_call(call_id):
        """Get call details"""
        conn = getDbConnection()
        if not conn:
            return None
        
        cursor = conn.cursor()
        try:
            # Ensure muted_all column exists
            try:
                cursor.execute("ALTER TABLE video_calls ADD COLUMN IF NOT EXISTS muted_all BOOLEAN DEFAULT FALSE")
                conn.commit()
            except Exception:
                pass

            cursor.execute("""
                SELECT call_id, initiator_id, initiator_type, receiver_id, receiver_type,
                       status, started_at, ended_at, duration_seconds, created_at, room_id, muted_all
                FROM video_calls
                WHERE call_id = %s
            """, (call_id,))
            
            result = cursor.fetchone()
            if result:
                return {
                    'call_id': result[0],
                    'initiator_id': result[1],
                    'initiator_type': result[2],
                    'receiver_id': result[3],
                    'receiver_type': result[4],
                    'status': result[5],
                    'started_at': result[6].isoformat() if result[6] else None,
                    'ended_at': result[7].isoformat() if result[7] else None,
                    'duration_seconds': result[8],
                    'created_at': result[9].isoformat() if result[9] else None,
                    'room_id': result[10],
                    'muted_all': bool(result[11]) if result[11] is not None else False
                }
            return None
        except Exception as e:
            print(f"Error getting call: {e}")
            return None
        finally:
            cursor.close()
            conn.close()
    
    @staticmethod
    def add_participant(call_id, user_id, user_type):
        """Add participant to call"""
        conn = getDbConnection()
        if not conn:
            return False
        
        cursor = conn.cursor()
        try:
            cursor.execute("""
                INSERT INTO call_participants 
                (call_id, user_id, user_type)
                VALUES (%s, %s, %s)
            """, (call_id, user_id, user_type))
            
            conn.commit()
            return True
        except Exception as e:
            print(f"Error adding participant: {e}")
            return False
        finally:
            cursor.close()
            conn.close()


# Run this to create all tables
if __name__ == "__main__":
    print("Creating database tables for ClassMate...")
    create_tables()