from db import getDbConnection
conn = getDbConnection()
cur = conn.cursor()
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='quiz_attempt'")
print([r[0] for r in cur.fetchall()])
conn.close()
