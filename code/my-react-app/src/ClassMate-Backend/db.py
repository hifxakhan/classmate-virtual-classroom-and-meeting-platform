import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

def getDbConnection():
    """
    Get PostgreSQL database connection.
    Supports both Neon (with SSL) and local PostgreSQL.
    
    Configuration via environment variables:
    - DATABASE_URL: Full connection string (takes precedence)
    - Or individual variables: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL
    """
    
    # Try to get DATABASE_URL first (for Railway/Vercel/Heroku style setup)
    database_url = os.environ.get('DATABASE_URL')
    
    if database_url:
        # Clean Neon URLs sometimes have ?sslmode=require, ensure it's there for production
        if 'neon.tech' in database_url and 'sslmode' not in database_url:
            database_url += '?sslmode=require'
        print("🔌 Connecting to database via DATABASE_URL")
    else:
        # Build connection string from individual environment variables
        db_host = os.environ.get('DB_HOST', 'localhost')
        db_port = os.environ.get('DB_PORT', '5432')
        db_name = os.environ.get('DB_NAME', 'classmate_db')
        db_user = os.environ.get('DB_USER', 'postgres')
        db_password = os.environ.get('DB_PASSWORD', '')
        db_ssl = os.environ.get('DB_SSL', 'require')  # 'require' for Neon, 'disable' for local
        
        # Build SSL mode parameter
        if db_host.endswith('.neon.tech'):
            sslmode = 'require'
        else:
            sslmode = 'disable' if db_host == 'localhost' else 'require'
        
        # Construct connection string
        if db_password:
            database_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?sslmode={sslmode}"
        else:
            database_url = f"postgresql://{db_user}@{db_host}:{db_port}/{db_name}?sslmode={sslmode}"
        
        print(f"🔌 Connecting to {db_host}:{db_port}/{db_name} (SSL: {sslmode})")
    
    try:
        connection = psycopg2.connect(database_url)
        print("✅ Database connection established successfully")
        return connection
    except psycopg2.OperationalError as e:
        print(f"❌ Database connection failed: {e}")
        print(f"   Check DATABASE_URL or DB_* environment variables")
        return None
    except Exception as e:
        print(f"❌ Unexpected connection error: {e}")
        return None

def get_db_connection_dict():
    """Get connection with dictionary cursor for easier data handling"""
    try:
        conn = getDbConnection()
        if conn:
            conn.cursor_factory = RealDictCursor
            return conn
        return None
    except Exception as e:
        print(f"❌ Failed to create dict connection: {e}")
        return None