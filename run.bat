@echo off
echo Starting TWI Subsea Pipeline Digital Twin Application...
"C:\Program Files\Python310\python.exe" -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload
pause
