@echo off
REM IO Control Panel - desktop GUI launcher (Windows)
REM Double-click this file to open the control panel.
REM
REM This is an alternative to start.bat, not a replacement for it - it
REM opens a desktop window with Start/Stop/Restart buttons and a live
REM log view, instead of running the server directly in this window.
REM start.bat continues to work exactly as it always has.
setlocal
cd /d "%~dp0launcher"

echo.
echo ================================================
echo  IO Control Panel
echo ================================================
echo.

REM --- Node.js present? ---
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found on your PATH.
  echo Install it from https://nodejs.org - choose the LTS version -
  echo and try again.
  echo.
  pause
  exit /b 1
)

REM --- First-run dependency install ---
REM Actually validates Electron loads correctly, rather than just
REM checking whether a node_modules folder happens to exist - a
REM folder left behind by a previous broken/incomplete install (for
REM example, npm 12+ silently blocking Electron's own postinstall
REM script unless explicitly approved) would otherwise be mistaken
REM for a working one forever, endlessly retrying the same broken
REM Electron on every run with no way to recover without manual help.
node -e "require('electron')" >nul 2>nul
if errorlevel 1 (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo ERROR: npm was not found - it normally comes with Node.js.
    echo Reinstalling Node.js from https://nodejs.org should fix this.
    echo.
    pause
    exit /b 1
  )
  if exist node_modules (
    echo An existing install looks incomplete or broken - reinstalling from scratch.
    rmdir /s /q node_modules
  ) else (
    echo First run detected - installing the desktop GUI's own dependencies.
  )
  echo This downloads Electron ^(a few hundred MB, since it bundles its own
  echo browser to render the window^).
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: Dependency install failed - see the npm output above.
    echo Usually this means no internet connection right now, or a
    echo proxy in the way. Fix that and run this script again.
    echo.
    pause
    exit /b 1
  )
  node -e "require('electron')" >nul 2>nul
  if errorlevel 1 (
    echo.
    echo ERROR: Electron still isn't working correctly after a fresh install.
    echo Try running these commands manually from the launcher folder to see
    echo the full error: rmdir /s /q node_modules ^&^& npm install
    echo.
    pause
    exit /b 1
  )
  echo.
)

echo Opening the IO Control Panel...
echo.

call npm start
if errorlevel 1 (
  echo.
  echo ERROR: The control panel closed with an error - see the output above.
  echo.
  pause
  exit /b 1
)
