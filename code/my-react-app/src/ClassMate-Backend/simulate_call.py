import requests, json
API='http://localhost:5000'
courseCode='CS101'
teacher_id='TCH20260126155703319'
# Initiate call
print('Initiating call as teacher -> course')
resp=requests.post(f'{API}/api/video-call/initiate', json={
    'initiator_id': teacher_id,
    'initiator_type': 'teacher',
    'receiver_id': courseCode,
    'receiver_type': 'student',
    'target_uid': None
})
print('Initiate status', resp.status_code, resp.text)
# Check pending for students
print('\nChecking pending for students:')
resp2=requests.get(f'{API}/api/video-call/pending/{courseCode}/student')
print('Pending status', resp2.status_code, resp2.text)