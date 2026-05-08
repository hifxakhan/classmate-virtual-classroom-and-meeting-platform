import requests, time
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
print('Initiate status', resp.status_code)
print(resp.json())
call_id = resp.json().get('call_id')
if not call_id:
    print('No call_id returned')
    exit(1)
# Give backend a moment
time.sleep(1)
# Check pending for students
print('\nChecking pending for students:')
resp2=requests.get(f'{API}/api/video-call/pending/{courseCode}/student')
print('Pending status', resp2.status_code)
print(resp2.json().get('calls')[:3])
# Simulate student accept
print('\nSimulating student accept for call',call_id)
resp3=requests.put(f'{API}/api/video-call/{call_id}/accept')
print('Accept status', resp3.status_code)
print(resp3.json())
# Fetch call details
resp4=requests.get(f'{API}/api/video-call/{call_id}')
print('\nCall details after accept:')
print(resp4.status_code, resp4.json())