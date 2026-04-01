@echo off
cd /d "%~dp0"
echo Starting Habit Maker...
echo.
start "" /b py -m http.server 3000
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
echo Server is running at http://localhost:3000
echo Press any key to stop the server and close.
pause >nul
taskkill /f /im python.exe >nul 2>&1
