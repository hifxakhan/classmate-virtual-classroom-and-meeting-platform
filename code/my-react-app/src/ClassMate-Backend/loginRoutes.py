from flask import Blueprint, jsonify, request
import json
import psycopg2
import bcrypt
import os
import re
from dotenv import load_dotenv

load_dotenv()

def getDbConnection():
    print(f"Attempting database connection for login...")
    try:
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            database=os.getenv('DB_NAME', 'ClassMate'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', 'Hifza12#'),
            port=os.getenv('DB_PORT', 5432)
        )
        print(f"Database connection SUCCESS")
        return conn
    except Exception as e:
        print(f"Database connection FAILED: {e}")
        return None

# Create a blueprint for login routes
login_bp = Blueprint('login', __name__)


def ensure_security_table(conn):
    try:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS security_logs (
                id SERIAL PRIMARY KEY,
                event_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                username TEXT,
                action TEXT,
                ip TEXT,
                severity TEXT,
                details JSONB
            )
        """)
        conn.commit()
        cursor.close()
    except Exception as e:
        print(f"[ERROR] ensure_security_table error: {e}")


def log_security_event(username, action, ip, severity='info', details=None):
    conn = getDbConnection()
    if not conn:
        return

    try:
        ensure_security_table(conn)
        cursor = conn.cursor()
        try:
            from psycopg2.extras import Json
            payload = Json(details or {})
        except Exception:
            payload = json.dumps(details or {})

        cursor.execute(
            "INSERT INTO security_logs (username, action, ip, severity, details) VALUES (%s, %s, %s, %s, %s)",
            (username, action, ip, severity, payload)
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"[ERROR] log_security_event error: {e}")
        try:
            conn.close()
        except Exception:
            pass

def validateEmail(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))

def validatePassword(password):
    if len(password) < 8:
        return False, "Password must be at least 8 characters"
    
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"
    
    if not re.search(r'[a-z]', password):
        return False, "Password must contain at least one lowercase letter"
    
    if not re.search(r'\d', password):
        return False, "Password must contain at least one number"
    
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, "Password must contain at least one special character (!@#$%^&* etc.)"
    
    return True, "Password is strong"


@login_bp.route('/api/login', methods=['POST'])
def login():
    data = request.json
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    print(f"LOGIN ATTEMPT")
    print(f"   Email: {data.get('email', 'NO EMAIL')}")
    print(f"   Role: {data.get('role', 'NO ROLE')}")
    print(f"   Password: {'[HIDDEN]' if data.get('password') else 'NO PASSWORD'}")
    
    print("📋 Step 1: Collecting data...")
    
    if not data:
        print("ERROR: No data received")
        log_security_event('unknown', 'login_failed', client_ip, 'warning', {'reason': 'no_data'})
        return jsonify({
            "success": False,
            "error": "No data received"
        }), 400
    
    required = ['email', 'password', 'role']
    missing = [field for field in required if field not in data]
    
    if missing:
        print(f"ERROR: Missing fields: {missing}")
        log_security_event('unknown', 'login_failed', client_ip, 'warning', {'reason': 'missing_fields', 'fields': missing})
        return jsonify({
            "success": False,
            "error": f"Missing fields: {', '.join(missing)}"
        }), 400
    
    print(f"Step 1 COMPLETE: All data collected!")
    
    print("🔍 Step 2: Verifying data...")
    
    email = data['email'].lower().strip()
    password = data['password']
    role = data['role'].lower()
    
    valid_roles = ['admin', 'teacher', 'student']
    if role not in valid_roles:
        print(f"[ERROR] ERROR: Invalid role: {role}")
        log_security_event(email if 'email' in data else 'unknown', 'login_failed', client_ip, 'warning', {'reason': 'invalid_role', 'role': role})
        return jsonify({
            "success": False,
            "error": f"Invalid role. Must be one of: {', '.join(valid_roles)}"
        }), 400
    
    if not validateEmail(email):
        print(f"ERROR: Invalid email format: {email}")
        log_security_event(email, 'login_failed', client_ip, 'warning', {'reason': 'invalid_email'})
        return jsonify({
            "success": False,
            "error": "Please enter a valid email address"
        }), 400
    
    valid_pass, pass_message = validatePassword(password)
    if not valid_pass:
        print(f"ERROR: Invalid password: {pass_message}")
        log_security_event(email, 'login_failed', client_ip, 'warning', {'reason': 'weak_password', 'message': pass_message})
        return jsonify({
            "success": False,
            "error": pass_message
        }), 400
    
    print(f"Step 2 COMPLETE: Data verified!")
    print(f"   Clean email: {email}")
    print(f"   Clean role: {role}")
    print(f"   Password: Valid [DONE]")
    
    print("Step 3: Checking email in database and getting password hash...")
    
    conn = getDbConnection()
    if not conn:
        print("ERROR: Cannot connect to database")
        return jsonify({
            "success": False,
            "error": "Database connection failed"
        }), 500
    
    try:
        cursor = conn.cursor()
        
        # Check which table to query based on role AND get password hash
        if role == 'student':
            cursor.execute("SELECT email, password_hash FROM student WHERE email = %s", (email,))
            table_name = 'student'
        elif role == 'teacher':
            cursor.execute("SELECT email, password_hash FROM teacher WHERE email = %s", (email,))
            table_name = 'teacher'
        else:  # admin
            cursor.execute("SELECT email, password_hash FROM admin WHERE email = %s", (email,))
            table_name = 'admin'
        
        result = cursor.fetchone()
        
        if not result:
            print(f"ERROR: Email {email} not found in {table_name} table")
            cursor.close()
            conn.close()
            log_security_event(email, 'login_failed', client_ip, 'warning', {'reason': 'email_not_found', 'role': role})
            return jsonify({
                "success": False,
                "error": "Email not registered"
            }), 404
        
        db_email, db_password_hash = result
        print(f"Step 3 COMPLETE: Email found in {table_name} table!")
        print(f"   Database email: {db_email}")
        print(f"   Password hash: [HASHED]")
        
        # Step 4: Verify password hash
        print("Step 4: Verifying password hash...")
        
        try:
            # Convert the password hash from string to bytes if needed
            if isinstance(db_password_hash, str):
                db_password_hash = db_password_hash.encode('utf-8')
            
            # Check if the provided password matches the hash
            password_bytes = password.encode('utf-8')
            
            if bcrypt.checkpw(password_bytes, db_password_hash):
                print("Step 4 COMPLETE: Password verified successfully!")
                
                # Get user details
                cursor.execute(f"SELECT name FROM {table_name} WHERE email = %s", (email,))
                user_details = cursor.fetchone()
                user_name = user_details[0] if user_details else "User"

                cursor.execute(f"SELECT {role}_id FROM {table_name} WHERE email = %s", (email,))
                id_result = cursor.fetchone()
                user_id = id_result[0] if id_result else None
                
                cursor.close()
                conn.close()
                log_security_event(email, 'login_success', client_ip, 'info', {'role': role, 'user_id': user_id})
                
                return jsonify({
                    "success": True,
                    "message": "Login successful!",
                    "user": {
                        "id": user_id,
                        "email": email,
                        "name": user_name,
                        "role": role,
                        "table": table_name
                    },
                    "token": "sample_jwt_token_here"  # You'll add JWT later
                })
            else:
                print("ERROR: Password does not match")
                cursor.close()
                conn.close()
                log_security_event(email, 'login_failed', client_ip, 'warning', {'reason': 'incorrect_password', 'role': role})
                return jsonify({
                    "success": False,
                    "error": "Incorrect password"
                }), 401
                
        except Exception as hash_error:
            print(f"PASSWORD HASH ERROR: {hash_error}")
            cursor.close()
            conn.close()
            log_security_event(email, 'login_failed', client_ip, 'error', {'reason': 'hash_error'})
            return jsonify({
                "success": False,
                "error": "Password verification failed"
            }), 500
        
    except Exception as e:
        print(f"DATABASE ERROR: {e}")
        conn.close()
        log_security_event(email if 'email' in data else 'unknown', 'login_failed', client_ip, 'error', {'reason': 'db_error'})
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500