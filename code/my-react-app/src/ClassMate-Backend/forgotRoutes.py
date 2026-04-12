# forgotRoutes.py
from flask import Blueprint, jsonify, request
import psycopg2
import bcrypt
import re
import os
import logging
import smtplib
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from dotenv import load_dotenv
import random

load_dotenv()

print("=== EMAIL CONFIGURATION CHECK ===")
print(f"EMAIL_HOST: {os.environ.get('EMAIL_HOST', 'NOT SET')}")
print(f"EMAIL_PORT: {os.environ.get('EMAIL_PORT', 'NOT SET')}")
print(f"EMAIL_USER: {os.environ.get('EMAIL_USER', 'NOT SET')}")
print(f"EMAIL_PASSWORD: {'SET' if os.environ.get('EMAIL_PASSWORD') else 'NOT SET'}")
print(f"EMAIL_USE_TLS: {os.environ.get('EMAIL_USE_TLS', 'NOT SET')}")
print("================================")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

EMAIL_HOST = os.environ.get('EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', 587))
EMAIL_USER = os.environ.get('EMAIL_USER')
EMAIL_PASSWORD = os.environ.get('EMAIL_PASSWORD')
EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'True') == 'True'

def getDbConnection():
    print(f"Attempting database connection...")
    
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

forgot_bp = Blueprint('forgot', __name__)

@forgot_bp.route('/api/forgot-password/request', methods=['POST'])
def forgot_password_request():
    """
    Step 1: Check if email exists in database AND send OTP
    """
    try:
        data = request.json
        print(f"Forgot password request for email: {data.get('email', 'No email')}")
        
        # Check if email is provided
        if not data or 'email' not in data:
            return jsonify({
                "success": False,
                "error": "Email is required"
            }), 400
        
        email = data['email'].lower().strip()
        
        # Validate email format
        if not validateEmail(email):
            return jsonify({
                "success": False,
                "error": "Not a valid email address"
            }), 400
        
        # Check if email exists in database AND get user info
        user_info = getUserInfo(email)
        
        if not user_info:
            return jsonify({
                "success": False,
                "error": "Email does not exist in our system"
            }), 404
        
        print(f"User found: Email={email}, Role={user_info['role']}, Name={user_info['name']}")
        
        # Generate OTP
        otp = generateOTP(email, user_info['role'])
        
        if not otp:
            return jsonify({
                "success": False,
                "error": "Failed to generate OTP. Please try again."
            }), 500
        
        # Send OTP email
        email_sent = send_otp_email(email, otp)

        if not email_sent:
            logger.error("Failed to send password reset OTP email to %s", email)
            return jsonify({
                "success": False,
                "error": "Failed to send OTP email"
            }), 500

        return jsonify({
            "success": True,
            "message": f"OTP sent to {email}",
            "email": email,
            "role": user_info['role']
        }), 200
            
    except Exception as e:
        print(f"Error in forgot_password_request: {e}")
        return jsonify({
            "success": False,
            "error": "Server error"
        }), 500

@forgot_bp.route('/api/forgot-password/verify-otp', methods=['POST'])
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
            AND is_used = FALSE     -- Not already used
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
            "message": "OTP verified successfully!",
            "next_step": "reset_password",
            "email": email
        })
        
    except Exception as e:
        print(f"OTP verification error: {e}")
        conn.close()
        return jsonify({"success": False, "error": "Server error"}), 500

# ADD THIS RESEND OTP ROUTE FOR FORGOT PASSWORD
@forgot_bp.route('/api/forgot-password/resend-otp', methods=['POST'])
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
        
        print(f"Preparing to resend OTP to: {email}")
        
        # Check if email exists and get user info
        user_info = getUserInfo(email)
        
        if not user_info:
            return jsonify({
                "success": False,
                "error": "Email does not exist in our system"
            }), 404
        
        name = user_info['name']
        role = user_info['role']
        
        otp = generateOTP(email, role)
        
        if not otp:
            print(f"Failed to generate OTP for {email}")
            return jsonify({
                "success": False,
                "error": "Failed to generate OTP"
            }), 500
        
        print(f"New OTP generated: {otp} for {email}")
        
        email_sent = send_otp_email(email, otp)

        if not email_sent:
            logger.error("Failed to resend password reset OTP email to %s", email)
            return jsonify({
                "success": False,
                "error": "Failed to send OTP email"
            }), 500

        logger.info("OTP resent successfully to %s", email)
        return jsonify({
            "success": True,
            "message": f"New OTP sent to {email}",
            "email": email
        }), 200
            
    except Exception as e:
        print(f"Error in resendOTP: {e}")
        return jsonify({
            "success": False,
            "error": f"Server error: {str(e)}"
        }), 500

# ADD THIS RESET PASSWORD ROUTE
@forgot_bp.route('/api/forgot-password/reset', methods=['POST'])
def reset_password():
    """
    Step 3: Reset password after OTP verification
    """
    try:
        data = request.json
        print(f"Reset password request: {data}")
        
        # Check required fields
        required = ['email', 'newPassword', 'confirmPassword', 'role']
        missing = [field for field in required if field not in data]
        
        if missing:
            return jsonify({
                "success": False,
                "error": f"Missing fields: {', '.join(missing)}"
            }), 400
        
        email = data['email'].lower().strip()
        new_password = data['newPassword']
        confirm_password = data['confirmPassword']
        role = data['role']
        
        print(f"Processing password reset for {email} as {role}")
        
        # Check if passwords match
        if new_password != confirm_password:
            print("Passwords don't match!")
            return jsonify({
                "success": False,
                "error": "Passwords do not match!"
            }), 400
        
        # Validate password strength
        valid_pass, message = validatePassword(new_password)
        if not valid_pass:
            print(f"Password validation failed: {message}")
            return jsonify({
                "success": False,
                "error": message
            }), 400
        
        print(f"Password validation passed")
        
        # Verify OTP was used first
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database error"}), 500
        
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id FROM email_verification 
            WHERE email = %s 
            AND is_used = TRUE
            AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1
        """, (email,))
        
        verified_otp = cursor.fetchone()
        
        if not verified_otp:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Please verify OTP first before resetting password"
            }), 400
        
        print(f"OTP verified, proceeding with password reset")
        
        # Hash the new password
        try:
            salt = bcrypt.gensalt()
            hashed_password = bcrypt.hashpw(new_password.encode('utf-8'), salt)
            hashed_password_str = hashed_password.decode('utf-8')
            print(f"Password hashed successfully")
        except Exception as e:
            print(f"Password hashing failed: {e}")
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Password processing failed: {e}"
            }), 500
        
        # Update password based on role
        if role == 'student':
            update_query = """
                UPDATE student 
                SET password_hash = %s 
                WHERE email = %s
            """
        elif role == 'teacher':
            update_query = """
                UPDATE teacher 
                SET password_hash = %s 
                WHERE email = %s
            """
        else:  # admin
            update_query = """
                UPDATE admin 
                SET password_hash = %s 
                WHERE email = %s
            """
        
        print(f"Executing update query for {role}")
        cursor.execute(update_query, (hashed_password_str, email))
        
        if cursor.rowcount == 0:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "User not found"
            }), 404
        
        # Clean up OTP records for this email
        cursor.execute("DELETE FROM email_verification WHERE email = %s", (email,))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"Password reset successful for {email}")
        
        return jsonify({
            "success": True,
            "message": "Password reset successful! Please login with your new password.",
            "next_step": "login"
        })
        
    except Exception as e:
        print(f"Error in reset_password: {e}")
        return jsonify({
            "success": False,
            "error": f"Server error: {str(e)}"
        }), 500

def getUserInfo(email):
    """
    Get user info from database including role and name
    Returns: dict with 'role' and 'name' if exists, None if not
    """
    print(f"Getting user info for: {email}")
    conn = getDbConnection()
    if not conn:
        print("Cannot connect to database")
        return None
    
    try:
        cursor = conn.cursor()
        
        # Check student table
        cursor.execute("SELECT email, name FROM student WHERE email = %s", (email,))
        student_result = cursor.fetchone()
        if student_result:
            cursor.close()
            conn.close()
            return {'role': 'student', 'name': student_result[1]}
        
        # Check teacher table  
        cursor.execute("SELECT email, name FROM teacher WHERE email = %s", (email,))
        teacher_result = cursor.fetchone()
        if teacher_result:
            cursor.close()
            conn.close()
            return {'role': 'teacher', 'name': teacher_result[1]}
        
        # Check admin table
        cursor.execute("SELECT email, name FROM admin WHERE email = %s", (email,))
        admin_result = cursor.fetchone()
        if admin_result:
            cursor.close()
            conn.close()
            return {'role': 'admin', 'name': admin_result[1]}
        
        cursor.close()
        conn.close()
        return None
        
    except Exception as e:
        print(f"Database error: {e}")
        conn.close()
        return None

def checkEmailExists(email):
    """
    Check if email exists in database
    Returns: True if exists, False if not
    """
    user_info = getUserInfo(email)
    return user_info is not None
    
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
    
def generateOTP(email, role):
    otp = str(random.randint(100000,999999))
    expiresAt = datetime.now() + timedelta(minutes=10)  # Changed to 10 minutes for forgot password

    conn = getDbConnection()
    if not conn:
        print("Cannot connect to database for OTP")
        return None
    
    try:
        cursor = conn.cursor()
        
        # Delete any old OTPs for this email
        cursor.execute("DELETE FROM email_verification WHERE email = %s", (email,))
        
        # Insert new OTP
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

def send_otp_email(recipient_email, otp_code):
    """Send OTP email using Gmail SMTP"""
    try:
        # Get configuration from environment
        smtp_server = os.environ.get('EMAIL_HOST', 'smtp.gmail.com')
        smtp_port = int(os.environ.get('EMAIL_PORT', 587))
        smtp_username = os.environ.get('EMAIL_USER')
        smtp_password = os.environ.get('EMAIL_PASSWORD')

        # Validate credentials
        if not smtp_username or not smtp_password:
            print("❌ Email credentials missing")
            return False

        subject = "Password Reset OTP - ClassMate"
        body = f"""Your OTP code for password reset is: {otp_code}

This code will expire in 10 minutes.

If you didn't request this, please ignore this email.

Best regards,
ClassMate Team"""

        message = MIMEText(body)
        message['Subject'] = subject
        message['From'] = smtp_username
        message['To'] = recipient_email

        print(f"📧 Sending OTP to {recipient_email} (timeout: 120s)")

        server = smtplib.SMTP(smtp_server, smtp_port, timeout=120)
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(message)
        server.quit()

        print(f"✅ Email sent to {recipient_email}")
        return True

    except Exception as e:
        print(f"❌ Email error: {str(e)}")
        import traceback
        traceback.print_exc()
        return False