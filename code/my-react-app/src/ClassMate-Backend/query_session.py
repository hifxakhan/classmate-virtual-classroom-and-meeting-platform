import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()
conn = psycopg2.connect(
    host=os.getenv('DB_HOST'),
    database=os.getenv('DB_NAME'),
    user=os.getenv('DB_USER'),
    password=os.getenv('DB_PASSWORD'),
    port=os.getenv('DB_PORT')
)
cursor = conn.cursor()
cursor.execute("SELECT session_id, course_id, meeting_room_id, status FROM class_session WHERE meeting_room_id LIKE %s LIMIT 1", ('CS101%',))
result = cursor.fetchone()
if result:
    print("CS101 session found:")
    print(f"  session_id: {result[0]}")
    print(f"  course_id: {result[1]}")
    print(f"  meeting_room_id: {result[2]}")
    print(f"  status: {result[3]}")
else:
    print("No CS101 session found, checking any session...")
    cursor.execute('SELECT session_id, course_id, meeting_room_id, status FROM class_session LIMIT 1')
    result = cursor.fetchone()
    if result:
        print(f"  session_id: {result[0]}")
        print(f"  course_id: {result[1]}")
        print(f"  meeting_room_id: {result[2]}")
        print(f"  status: {result[3]}")
cursor.close()
conn.close()