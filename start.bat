@echo off
rem ---------------------------------------------------------------------------
rem  Starts Habit Maker and opens it in your browser.
rem  Close this window to stop the server.
rem
rem  Never installed anything?  Double-click Install.bat first - it checks that
rem  Python is present and proves the app runs before you rely on it.
rem ---------------------------------------------------------------------------
setlocal EnableExtensions
title Habit Maker
cd /d "%~dp0"

if exist "Start Habit Maker.bat" (
    rem Install.bat wrote a launcher that knows exactly which Python to use.
    call "Start Habit Maker.bat"
    exit /b %ERRORLEVEL%
)

where py >nul 2>&1 && (set "PY=py") || (set "PY=python")

echo.
echo   Habit Maker is starting on http://localhost:3000
echo   Your browser opens by itself in a moment.
echo.
echo   Keep this window open while you use the app. Closing it stops the server.
echo.

start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){ try{ Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000/' -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:3000'; exit 0 } catch { Start-Sleep -Milliseconds 500 } }"

%PY% "server\app.py"
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
    echo.
    echo  [ERROR] The server stopped with code %RC%.
    echo.
    echo   * "Address already in use" means port 3000 is taken. Close the other
    echo     program, or use another port:   set HABIT_PORT=4000 ^&^& start.bat
    echo   * "%PY%' is not recognized" means Python is not installed. Run Install.bat.
    echo   * Anything else: run Install.bat - it self-checks the whole app.
    echo.
    pause
)
exit /b %RC%
