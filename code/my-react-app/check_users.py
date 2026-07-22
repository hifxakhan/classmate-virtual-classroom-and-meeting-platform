import psycopg2
import os

db_url = "postgresql://postgres:classmate_dev@127.0.0.1:5434/classmate_db?sslmode=disable"
conn = psycopg2.connect(db_url)
cursor = conn.cursor()
cursor.execute("SELECT email FROM student WHERE email='hifxakhn@gmail.com';")
print("Student:", cursor.fetchone())
cursor.execute("SELECT email FROM teacher WHERE email='buttercupbutterc@gmail.com';")
print("Teacher:", cursor.fetchone())
