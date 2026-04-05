import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

def getDbConnection():
    """Hardcoded database connection for production"""
    
    # Use this hardcoded URL for now
    database_url = "postgresql://neondb_owner:npg_RLay62zUNBjP@ep-broad-violet-a1k9oq11-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
    
    print("🔌 Connecting to Neon database via HARDCODED URL")
    try:
        return psycopg2.connect(database_url)
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return None

def get_db_connection_dict():
    """Connection with dictionary cursor"""
    conn = getDbConnection()
    if conn:
        conn.cursor_factory = RealDictCursor
    return conn