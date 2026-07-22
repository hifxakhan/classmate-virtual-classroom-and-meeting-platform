import requests
API='http://localhost:5000'
call_id=129
print('Accepting call',call_id)
r=requests.put(f'{API}/api/video-call/{call_id}/accept')
print('accept status', r.status_code, r.text)
print('Fetch call details')
r2=requests.get(f'{API}/api/video-call/{call_id}')
print('details', r2.status_code, r2.text)