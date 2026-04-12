from flask import Blueprint, jsonify, request
import psycopg2
import bcrypt
import re
import os
import time
import logging
from typing import Optional, Tuple
from datetime import datetime, timedelta
from dotenv import load_dotenv
import random
import requests
import smtplib
from email.mime.text import MIMEText

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

IS_PRODUCTION = os.getenv('ENVIRONMENT', os.getenv('FLASK_ENV', 'development')).lower() == 'production'

def getDbConnection():
    print(f"Attempting database connection...")
    print(f"   Host: {os.getenv('DB_HOST', 'localhost')}")
    print(f"   Database: {os.getenv('DB_NAME', 'ClassMate')}")
    print(f"   User: {os.getenv('DB_USER', 'postgres')}")
    
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
    

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/api/signup/student/request', methods=['POST'])

def Sign():
    data = request.json
    print(f"DEBUG 1: Received data: {data}")

    required = ['fullName', 'email', 'role', 'password', 'confirmPassword']
    missing = [field for field in required if field not in data]
    print(f"DEBUG 2: Missing fields: {missing}")

    if missing:
        return jsonify({
            "success": False,
            "error": f"Missing fields: {', '.join(missing)}"
        }), 400

    if data['password'] != data['confirmPassword']:
        print("DEBUG 3: Passwords don't match!")
        return jsonify({
            "success": False,
            "error": "password do not Match!"
        }), 400
    
    if data['role'] not in ['admin', 'teacher', 'student']:
        print(f"DEBUG 4: Invalid role: {data['role']}")
        return jsonify({
            "success": False,
            "error": "Invalid role. Must be admin, teacher, or student"
        }), 400
    
    print(f"DEBUG 5: Basic checks passed")
    print(f"Signup: {data['fullName']} ({data['email']}) - Role: {data['role']}")

    if not validateEmail(data['email']):
        print(f"DEBUG 6: Email validation result: {data['email']}")
        return jsonify({
        "success": False,
        "error": 'Not a Valid Email'
    }), 400

    validPass, message = validatePassword(data['password'])
    print(f"DEBUG 7: Password validation: {validPass}, {message}")
    if not validPass:
        return jsonify({
        "success": False,
        "error": message
    }), 400

    if checkEmailExists(data['email']):
        return jsonify({
            "success": False,
            "error": "Email already registered"
        }), 400
    
    print(f"Email {data['email']} is available")

    print("DEBUG 8: All validations passed!")

    email = data['email'].lower().strip()
    role = data['role']
    full_name = data['fullName']

    # Rate limit OTP requests: max 3 per email per hour
    if is_otp_rate_limited(email):
        return jsonify({
            "success": False,
            "error": "Too many OTP requests. Please try again in an hour."
        }), 429

    otp = generateOTP(email, role)

    if otp:
        email_sent = sendOtpEmail(email, otp, full_name)
        if email_sent:
            return jsonify({
            "success": True,
            "message": f"OTP sent to {email}",
            "next_step": "otp_verification",
            "email": email
        })

        # Don't block signup if email is delayed; OTP already saved for retry flow
        response_payload = {
            "success": True,
            "message": "OTP generated. Email delivery is delayed, please retry in a few moments.",
            "next_step": "otp_verification",
            "email": email,
            "email_status": "queued"
        }

        if not IS_PRODUCTION:
            logger.info("[DEV OTP] email=%s otp=%s", email, otp)
            response_payload["dev_otp"] = otp

        return jsonify(response_payload), 200
    else:
        return jsonify({
        "success": False,
        "error": "Failed to generate OTP"
        }), 500


@auth_bp.route('/api/signup/verify-otp', methods=['POST'])
def verifyOTP():
    data = request.json
    
    print(f"OTP verification request: {data}")
    
    if 'email' not in data or 'otp' not in data:
        return jsonify({
            "success": False,
            "error": "Email and OTP are required"
        }), 400
    
    email = data['email']
    user_otp = data['otp']
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database error"}), 500
    
    try:
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, otp_code, expires_at 
            FROM email_verification 
            WHERE email = %s 
            AND expires_at > NOW()  -- Not expired
            ORDER BY created_at DESC  -- Get most recent
            LIMIT 1
        """, (email,))
        
        result = cursor.fetchone()
        
        if not result:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "OTP expired or not found. Please request a new one."
            }), 400
        
        otp_id, saved_otp, expiresAt = result
        
        if user_otp != saved_otp:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Invalid OTP. Please check and try again."
            }), 400
        
        cursor.execute("""
            UPDATE email_verification 
            SET is_used = TRUE 
            WHERE id = %s
        """, (otp_id,))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"OTP verified for {email}")
        
        return jsonify({
            "success": True,
            "message": "Email verified successfully!",
            "next_step": "complete_registration"
        })
        
    except Exception as e:
        print(f"OTP verification error: {e}")
        conn.close()
        return jsonify({"success": False, "error": "Server error"}), 500
    
@auth_bp.route('/api/signup/resend-otp', methods=['POST'])
def resendOTP():
    try:
        data = request.json
        print(f"Resend OTP request received: {data}")
        
        # Check required data
        if not data or 'email' not in data:
            return jsonify({
                "success": False,
                "error": "Email is required"
            }), 400
        
        email = data['email'].lower().strip()
        name = data.get('name', 'User')
        role = data.get('role', 'student')

        if is_otp_rate_limited(email):
            return jsonify({
                "success": False,
                "error": "Too many OTP requests. Please try again in an hour."
            }), 429
        
        print(f"Preparing to resend OTP to: {email}")
        
        otp = generateOTP(email, role)
        
        if not otp:
            print(f"Failed to generate OTP for {email}")
            return jsonify({
                "success": False,
                "error": "Failed to generate OTP"
            }), 500
        
        print(f"New OTP generated: {otp} for {email}")
        
        email_sent = sendOtpEmail(email, otp, name)
        
        if email_sent:
            print(f"OTP resent successfully to {email}")
            return jsonify({
                "success": True,
                "message": f"New OTP sent to {email}",
                "email": email
            })

        response_payload = {
            "success": True,
            "message": "OTP regenerated. Email delivery is delayed, please retry in a few moments.",
            "email": email,
            "email_status": "queued"
        }
        if not IS_PRODUCTION:
            logger.info("[DEV OTP RESEND] email=%s otp=%s", email, otp)
            response_payload["dev_otp"] = otp
        return jsonify(response_payload), 200
            
    except Exception as e:
        print(f"Error in resendOTP: {e}")
        return jsonify({
            "success": False,
            "error": f"Server error: {str(e)}"
        }), 500

@auth_bp.route('/api/debug/get-otp/<path:email>', methods=['GET'])
def debug_get_otp(email):
    """Get current valid OTP for an email (DEBUG ONLY)."""
    debug_enabled = os.getenv('ENABLE_DEBUG_OTP_ENDPOINT', 'false').lower() == 'true'
    if IS_PRODUCTION and not debug_enabled:
        return jsonify({"success": False, "error": "Debug endpoint disabled"}), 403

    normalized_email = email.lower().strip()
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database error"}), 500

    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT otp_code, expires_at
            FROM email_verification
            WHERE email = %s
              AND expires_at > NOW()
              AND is_used = FALSE
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (normalized_email,),
        )

        result = cursor.fetchone()
        cursor.close()
        conn.close()

        if not result:
            return jsonify({"success": False, "error": "No valid OTP found"}), 404

        otp, expires_at = result
        return jsonify({
            "success": True,
            "otp": otp,
            "expires_at": str(expires_at),
            "email": normalized_email
        }), 200
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500

@auth_bp.route('/api/signup/complete', methods=['POST'])
def completeRegistration():

    data = request.json
    print(f"completeRegistration called for email: {data.get('email', 'NO EMAIL')}")
    
    # Check required fields
    if not data:
        return jsonify({"success": False, "error": "No data received"}), 400
    
    required = ['email', 'role', 'fullName', 'password']
    missing = [field for field in required if field not in data]
    
    if missing:
        return jsonify({
            "success": False,
            "error": f"Missing fields: {', '.join(missing)}"
        }), 400
    
    email = data['email']
    role = data['role']
    full_name = data['fullName']
    password = data['password']
    
    print(f"Processing: {email} as {role}")
    
    # 2. Hash password
    try:
        print(f"Hashing password...")
        salt = bcrypt.gensalt()
        hashed_password = bcrypt.hashpw(password.encode('utf-8'), salt)
        hashed_password_str = hashed_password.decode('utf-8')
        print(f"Password hashed")
    except Exception as e:
        print(f"Password hashing failed: {e}")
        return jsonify({
            "success": False,
            "error": f"Password processing failed: {e}"
        }), 500
    
    # 3. Generate user ID
    import random
    from datetime import datetime
    
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    random_num = random.randint(100, 999)
    
    if role == 'student':
        user_id = f"STU{timestamp}{random_num}"
        table_name = 'student'
        insert_query = """
            INSERT INTO student 
            (student_id, name, email, password_hash, created_at)
            VALUES (%s, %s, %s, %s, NOW())
        """
    elif role == 'teacher':
        user_id = f"TCH{timestamp}{random_num}"
        table_name = 'teacher'
        insert_query = """
            INSERT INTO teacher 
            (teacher_id, name, email, password_hash, created_at)
            VALUES (%s, %s, %s, %s, NOW())
        """
    else:  # admin
        user_id = f"ADM{timestamp}{random_num}"
        table_name = 'admin'
        insert_query = """
            INSERT INTO admin 
            (admin_id, name, email, password_hash, created_at)
            VALUES (%s, %s, %s, %s, NOW())
        """
    
    print(f"Generated user ID: {user_id} for table: {table_name}")
    
    # 4. Connect to database
    print(f"Connecting to database...")
    conn = getDbConnection()
    if not conn:
        print(f"Database connection failed")
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    print(f"Database connected")
    
    try:
        cursor = conn.cursor()
        print(f"Got database cursor")
        
        # 5. Check if user already exists (final check)
        print(f"Checking if {email} already exists in {table_name}...")
        
        if role == 'student':
            cursor.execute("SELECT email FROM student WHERE email = %s", (email,))
        elif role == 'teacher':
            cursor.execute("SELECT email FROM teacher WHERE email = %s", (email,))
        else:
            cursor.execute("SELECT email FROM admin WHERE email = %s", (email,))
        
        existing_user = cursor.fetchone()
        
        if existing_user:
            print(f"User {email} already exists in {table_name}!")
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "User already registered"
            }), 400
        
        print(f"Email {email} is available")
        
        # 6. Insert user into database
        print(f"Inserting into {table_name}...")
        print(f"   Query: {insert_query}")
        print(f"   Values: ({user_id}, {full_name}, {email}, [hashed_password])")
        
        cursor.execute(insert_query, (user_id, full_name, email, hashed_password_str))
        
        # 7. Clean up OTP records (optional but good)
        print(f"Cleaning up OTP records for {email}...")
        cursor.execute("DELETE FROM email_verification WHERE email = %s", (email,))
        
        # 8. Commit transaction
        conn.commit()
        print(f"Transaction committed successfully")
        
        cursor.close()
        conn.close()
        print(f"Database connections closed")
        
        print(f"USER SAVED SUCCESSFULLY!")
        print(f"   Email: {email}")
        print(f"   Role: {role}")
        print(f"   User ID: {user_id}")
        print(f"   Table: {table_name}")
        
        # 9. Return success
        return jsonify({
            "success": True,
            "message": "Registration completed successfully! Please login.",
            "next_step": "login",
            "user_id": user_id,
            "name": full_name,
            "email": email,
            "role": role
        })
        
    except Exception as e:
        print(f"DATABASE ERROR!")
        print(f"   Error type: {type(e).__name__}")
        print(f"   Error message: {e}")
        
        # Rollback in case of error
        try:
            conn.rollback()
            print(f"Transaction rolled back")
        except:
            pass
        
        conn.close()
        
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500
    
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

def checkEmailExists(email):
    print(f"🔍 Checking if email exists: {email}")
    conn = getDbConnection()
    if not conn:
        print("Cannot connect to database")
        return True 
    
    try:
        cursor = conn.cursor()
        
        # Check student table
        cursor.execute("SELECT email FROM student WHERE email = %s", (email,))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return True
        
        # Check teacher table  
        cursor.execute("SELECT email FROM teacher WHERE email = %s", (email,))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return True
        
        # Check admin table
        cursor.execute("SELECT email FROM admin WHERE email = %s", (email,))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return True
        
        cursor.close()
        conn.close()
        return False
        
    except Exception as e:
        print(f"Database error: {e}")
        conn.close()
        return True

def generateOTP(email, role):
    otp = str(random.randint(100000,999999))
    expiresAt = datetime.now() + timedelta(minutes=2)

    conn = getDbConnection()
    if not conn:
        print("Cannot connect to database for OTP")
        return None
    
    try:
        cursor = conn.cursor()
        
        # 4. Delete any old OTPs for this email
        cursor.execute("DELETE FROM email_verification WHERE email = %s", (email,))
        
        # 5. Insert new OTP
        cursor.execute("""
            INSERT INTO email_verification (email, otp_code, role, expires_at)
            VALUES (%s, %s, %s, %s)
        """, (email, otp, role, expiresAt))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"OTP saved for {email}: {otp} (expires: {expiresAt})")
        return otp
        
    except Exception as e:
        print(f"Error saving OTP: {e}")
        conn.close()
        return None

def is_otp_rate_limited(email: str, limit: int = 3) -> bool:
    """Allow at most `limit` OTP generations per email in the past hour."""
    conn = getDbConnection()
    if not conn:
        # Fail-open to avoid blocking signup during transient DB connectivity issues.
        return False

    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM email_verification
            WHERE email = %s
              AND created_at >= NOW() - INTERVAL '1 hour'
            """,
            (email,),
        )
        count = cursor.fetchone()[0]
        cursor.close()
        conn.close()
        return count >= limit
    except Exception as e:
        logger.warning("Rate limit check failed for %s: %s", email, e)
        try:
            conn.close()
        except Exception:
            pass
        return False

def queue_failed_email(email: str, otp: str, name: str, provider: str, error_message: str) -> None:
    """Persist failed email attempts for background retries."""
    conn = getDbConnection()
    if not conn:
        logger.warning("Could not queue failed email for %s because DB is unavailable", email)
        return

    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS email_retry_queue (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                otp_code VARCHAR(20) NOT NULL,
                name VARCHAR(255),
                provider VARCHAR(50) NOT NULL,
                error_message TEXT,
                attempt_count INT DEFAULT 0,
                status VARCHAR(20) DEFAULT 'pending',
                next_retry_at TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
        cursor.execute(
            """
            INSERT INTO email_retry_queue (email, otp_code, name, provider, error_message, attempt_count, status, next_retry_at)
            VALUES (%s, %s, %s, %s, %s, %s, 'pending', NOW() + INTERVAL '1 minute')
            """,
            (email, otp, name, provider, error_message[:1000], 0),
        )
        conn.commit()
        cursor.close()
        conn.close()
        logger.info("Queued failed email for retry: email=%s provider=%s", email, provider)
    except Exception as e:
        logger.warning("Failed to queue email retry for %s: %s", email, e)
        try:
            conn.close()
        except Exception:
            pass

def check_sendgrid_health(api_key: str) -> Tuple[bool, Optional[str]]:
    """Basic SendGrid key/rate-limit check before sending."""
    if not api_key:
        return False, "missing_api_key"

    try:
        headers = {"Authorization": f"Bearer {api_key}"}
        response = requests.get("https://api.sendgrid.com/v3/user/account", headers=headers, timeout=10)
        if response.status_code == 200:
            return True, None
        if response.status_code == 429:
            return False, "rate_limited"
        if response.status_code in (401, 403):
            return False, "invalid_api_key"
        return False, f"status_{response.status_code}"
    except Exception as e:
        return False, f"health_check_error:{e}"

def send_via_sendgrid(to_email: str, otp: str, name: str = "") -> Tuple[bool, str]:
    api_key = os.getenv('SENDGRID_API_KEY')
    healthy, reason = check_sendgrid_health(api_key)
    if not healthy:
        return False, f"sendgrid_unhealthy:{reason}"

    from_email = os.getenv('EMAIL_SENDER', 'classmate.meeting.platform@gmail.com')
    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": from_email},
        "subject": f"ClassMate OTP: {otp}",
        "content": [{
            "type": "text/plain",
            "value": (
                f"ClassMate Email Verification\n\n"
                f"Hello {name if name else 'User'},\n\n"
                f"Your OTP is: {otp}\n\n"
                "Enter this code in the verification page.\n\n"
                "Code expires in 2 minutes.\n"
            )
        }]
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    response = requests.post("https://api.sendgrid.com/v3/mail/send", json=payload, headers=headers, timeout=10)
    if response.status_code == 202:
        return True, "accepted"
    return False, f"status_{response.status_code}:{response.text[:200]}"

def send_via_smtp(to_email: str, otp: str, name: str = "") -> Tuple[bool, str]:
    smtp_host = os.getenv('EMAIL_HOST', 'smtp.gmail.com')
    smtp_port = int(os.getenv('EMAIL_PORT', 587))
    smtp_user = os.getenv('EMAIL_USER')
    smtp_password = os.getenv('EMAIL_PASSWORD')
    from_email = os.getenv('EMAIL_SENDER', smtp_user or 'noreply@classmate.com')

    if not smtp_user or not smtp_password:
        return False, "smtp_credentials_missing"

    subject = f"ClassMate OTP: {otp}"
    body = f"""
ClassMate Email Verification

Hello {name if name else 'User'},

Your OTP is: {otp}

Enter this code in the verification page.

Code expires in 2 minutes.
"""

    msg = MIMEText(body)
    msg['Subject'] = subject
    msg['From'] = from_email
    msg['To'] = to_email

    try:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.send_message(msg)
        server.quit()
        return True, "smtp_sent"
    except Exception as e:
        return False, str(e)

def sendOtpEmail(to_email, otp, name=""):
    """Send OTP with retries and fallback providers.

    Retry strategy:
    - Attempt up to 3 times
    - Backoff: 1s, 2s, 4s
    - On each attempt try SendGrid first, then SMTP fallback
    """
    if not IS_PRODUCTION:
        logger.info("[DEV OTP] email=%s otp=%s", to_email, otp)

    backoffs = [1, 2, 4]
    last_error = "unknown"

    for attempt, delay in enumerate(backoffs, start=1):
        ts = datetime.utcnow().isoformat()

        sg_ok, sg_info = send_via_sendgrid(to_email, otp, name)
        logger.info("%s OTP attempt=%s provider=sendgrid email=%s result=%s detail=%s",
                    ts, attempt, to_email, sg_ok, sg_info)
        if sg_ok:
            return True
        last_error = f"sendgrid:{sg_info}"

        smtp_ok, smtp_info = send_via_smtp(to_email, otp, name)
        logger.info("%s OTP attempt=%s provider=smtp email=%s result=%s detail=%s",
                    ts, attempt, to_email, smtp_ok, smtp_info)
        if smtp_ok:
            return True
        last_error = f"smtp:{smtp_info}"

        if attempt < len(backoffs):
            time.sleep(delay)

    queue_failed_email(to_email, otp, name, "sendgrid+smtp", last_error)
    logger.error("OTP delivery failed after retries for %s; queued for retry. last_error=%s", to_email, last_error)
    return False