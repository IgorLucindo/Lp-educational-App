@echo off
echo ====================================================
echo   LAUNCHING SECURE OFFLINE MEDICAL AI INTERFACE     
echo ====================================================

:: Check if Ollama is running and start it in the background
echo [1/3] Checking Ollama engine...
tasklist /fi "imagename eq ollama.exe" | find /i "ollama.exe" > nul
if errorlevel 1 (
    start /B ollama serve > nul 2>&1
    timeout /t 3 > nul
)

:: Automatically open your browser to the local port
echo [2/3] Opening your application interface...
start http://localhost:3000

:: Start the instant offline server
echo [3/3] Securing local environment...
python -m http.server 3000