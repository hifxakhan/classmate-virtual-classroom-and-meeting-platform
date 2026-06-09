import os
import glob

directory = './src'
target = 'https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app'
replacement = '${API_BASE}'

for filepath in glob.glob(directory + '/**/*.jsx', recursive=True):
    with open(filepath, 'r') as file:
        content = file.read()
    
    if target in content:
        print(f"Fixing {filepath}")
        # Need to ensure API_BASE is imported and defined if it's not already
        if 'import { getApiBase }' not in content:
            # We'll just replace with 'http://localhost:5000' if it's too hard,
            # wait, many files use it inside string templates `...` or string literals '...'.
            pass
