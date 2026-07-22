import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()
conn = psycopg2.connect(host=os.getenv('DB_HOST', 'localhost'), database=os.getenv('DB_NAME', 'ClassMate'), user=os.getenv('DB_USER', 'postgres'), password=os.getenv('DB_PASSWORD', 'Hifza12#'), port=os.getenv('DB_PORT', 5432))
cursor = conn.cursor()
cursor.execute('SELECT column_name FROM information_schema.columns WHERE table_name = %s', ('teacher',))
cols = [row[0] for row in cursor.fetchall()]
print("Teacher columns:", ', '.join(cols))
cursor.close()
conn.close()