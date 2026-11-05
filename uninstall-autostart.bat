@echo off
REM Removes the auto-start task installed by install-autostart.bat.
REM Must be run as Administrator.
setlocal
cd /d "%~dp0"
set "TASK_NAME=IOProject"

echo.
net session >nul 2>&1
if errorlevel 1 (
  echo ERROR: Run this as Administrator - right-click it and choose
  echo "Run as administrator" - then try again.
  echo.
  pause
  exit /b 1
)

schtasks /query /tn "%TASK_NAME%" >nul 2>&1
if errorlevel 1 (
  echo No auto-start task is currently installed - nothing to do.
  echo.
  pause
  exit /b 0
)

schtasks /end /tn "%TASK_NAME%" >nul 2>&1
schtasks /delete /tn "%TASK_NAME%" /f
if exist "autostart-launcher.vbs" del "autostart-launcher.vbs"

echo.
echo Auto-start removed. I/O will no longer launch
echo automatically at startup. You can still run it manually any
echo time with start.bat.
echo.
pause
