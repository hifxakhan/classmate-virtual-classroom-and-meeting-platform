from flask import Blueprint, jsonify, request
import psycopg2
import bcrypt
import re
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
import random
from datetime import datetime, timedelta

load_dotenv()

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

    otp = generateOTP(data['email'], data['role'])

    if otp:
        if sendOtpEmail(data['email'], otp, data['fullName']):
            return jsonify({
            "success": True,
            "message": f"OTP sent to {data['email']}",
            "next_step": "otp_verification",
            "email": data['email']
        })
        else:
            return jsonify({
            "success": False,
            "error": "Failed to send OTP"
            }), 500
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
        
        email = data['email']
        name = data.get('name', 'User')
        role = data.get('role', 'student')
        
        print(f"Preparing to resend OTP to: {email}")
        
        otp = generateOTP(email, role)
        
        if not otp:
            print(f"Failed to generate OTP for {email}")
            return jsonify({
                "success": False,
                "error": "Failed to generate OTP"
            }), 500
        
        print(f"New OTP generated: {otp} for {email}")
        
        # Use the same function you already have!
        email_sent = sendOtpEmail(email, otp, name)
        
        if email_sent:
            print(f"OTP resent successfully to {email}")
            return jsonify({
                "success": True,
                "message": f"New OTP sent to {email}",
                "otp": otp
            })
        else:
            print(f"Failed to send OTP email to {email}")
            return jsonify({
                "success": False,
                "error": "Failed to send OTP email"
            }), 500
            
    except Exception as e:
        print(f"Error in resendOTP: {e}")
        return jsonify({
            "success": False,
            "error": f"Server error: {str(e)}"
        }), 500

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

def sendOtpEmail(to_email, otp, name=""):
    try:
        import smtplib
        from email.mime.text import MIMEText
        
        subject = f"ClassMate OTP: {otp}"
        body = f"""
        ClassMate Email Verification
        
        Hello {name},
        
        Your OTP is: {otp}
        
        Enter this code in the verification page.
        
        Code expires in 5 minutes.
        """
        
        print(f"SENDING EMAIL: To={to_email}, OTP={otp}")
        
        msg = MIMEText(body)
        msg['Subject'] = subject
        msg['From'] = os.getenv('EMAIL_SENDER')
        msg['To'] = to_email
        
        server = smtplib.SMTP(os.getenv('EMAIL_HOST'), int(os.getenv('EMAIL_PORT')))
        server.starttls()
        server.login(os.getenv('EMAIL_USER'), os.getenv('EMAIL_PASSWORD'))
        server.send_message(msg)
        server.quit()
        
        print(f"Email sent with OTP: {otp}")
        return True
        
    except Exception as e:
        print(f"Email error: {e}")
        # At least print OTP to console
        print(f"OTP for {to_email}: {otp}")
        return False  # <-- CHANGE THIS FROM True TO False