@echo off
REM Installs I/O as a Windows Scheduled Task that starts
REM automatically at system boot (even before anyone logs in) and runs
REM completely hidden in the background - no console window.
REM Must be run as Administrator: right-click this file and choose
REM "Run as administrator".
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "PROJECT_DIR=%cd%"
set "TASK_NAME=IOProject"

echo.
echo ================================================
echo  I/O - Install Auto-Start
echo ================================================
echo.

REM --- Admin check ---
net session >nul 2>&1
if errorlevel 1 (
  echo ERROR: This needs to be run as Administrator to create a
  echo startup task. Right-click this file and choose
  echo "Run as administrator", then try again.
  echo.
  pause
  exit /b 1
)

REM --- Node.js present and new enough? ---
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found on your PATH.
  echo Install it from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%p in ('where node') do set "NODE_PATH=%%p"

node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 (
  echo ERROR: I/O needs Node.js 22.5 or newer. Installed:
  node --version
  echo Update Node.js from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)

REM --- Some Node 22.x versions need this flag for built-in SQLite ---
set "EXTRA_ENV="
node -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 (
  node --experimental-sqlite -e "require('node:sqlite')" >nul 2>nul
  if errorlevel 1 (
    echo ERROR: This Node.js version can't load its built-in SQLite module.
    echo Update Node.js from https://nodejs.org and try again.
    echo.
    pause
    exit /b 1
  )
  set "EXTRA_ENV=set NODE_OPTIONS=--experimental-sqlite&&"
  echo (This Node version needs --experimental-sqlite - the startup task will set that automatically.)
)

REM --- First-run dependency install ---
if not exist "node_modules" (
  echo First run detected - installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: Dependency install failed - see the npm output above.
    echo.
    pause
    exit /b 1
  )
)

REM --- Generate a VBScript wrapper so the server launches with zero
REM visible console window (Task Scheduler alone would still flash one
REM briefly for a plain node.exe command - this is the standard,
REM reliable way around that on Windows). Output is logged to
REM autostart.log since there's no console to see errors in otherwise. ---
set "VBS_PATH=%PROJECT_DIR%\autostart-launcher.vbs"
> "%VBS_PATH%" (
  echo Set WshShell = CreateObject^("WScript.Shell"^)
  echo WshShell.CurrentDirectory = "%PROJECT_DIR%"
  echo WshShell.Run "cmd /c !EXTRA_ENV! ""!NODE_PATH!"" server\index.js >> ""%PROJECT_DIR%\autostart.log"" 2>&1", 0, False
)

REM --- Create the scheduled task: runs at system startup, as SYSTEM
REM (so it needs no password and runs whether or not anyone logs in),
REM with highest available privileges. /f overwrites a previous
REM install so re-running this script safely updates it. ---
schtasks /create /tn "%TASK_NAME%" /tr "wscript.exe \"%VBS_PATH%\"" /sc onstart /ru SYSTEM /rl highest /f
if errorlevel 1 (
  echo.
  echo ERROR: Failed to create the scheduled task - see the message above.
  echo.
  pause
  exit /b 1
)

REM --- Start it right now too, so it's running immediately instead of
REM only after the next reboot. ---
schtasks /run /tn "%TASK_NAME%" >nul 2>&1
timeout /t 2 /nobreak >nul

echo.
echo ================================================
echo  I/O will now start automatically on boot.
echo ================================================
echo.
echo It should already be running - check http://localhost:4821
echo (the autostart.log file in this folder shows its output if not).
echo.
echo Useful commands (from an Administrator prompt):
echo   schtasks /query /tn "%TASK_NAME%"       - check its status
echo   schtasks /end /tn "%TASK_NAME%"          - stop it right now
echo   schtasks /run /tn "%TASK_NAME%"          - start it right now
echo   uninstall-autostart.bat                  - remove auto-start
echo.
pause
