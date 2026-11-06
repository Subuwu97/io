@echo off
REM I/O startup script (Windows)
REM Double-click this file to launch the server.
setlocal
cd /d "%~dp0"

echo.
echo ================================================
echo  I/O
echo ================================================
echo.

REM --- Node.js present? ---
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found on your PATH.
  echo Install it from https://nodejs.org - choose the LTS version,
  echo which is new enough - and try again.
  echo.
  pause
  exit /b 1
)

REM --- Node.js new enough? node:sqlite needs 22.5 or newer ---
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 (
  echo ERROR: I/O needs Node.js 22.5 or newer - its built-in
  echo database arrived in Node 22.5. Your installed version is:
  node --version
  echo Update Node.js from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)

REM --- Some Node 22.x versions ship SQLite behind an experimental flag ---
node -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 (
  node --experimental-sqlite -e "require('node:sqlite')" >nul 2>nul
  if errorlevel 1 (
    echo ERROR: This Node.js version can't load its built-in SQLite module.
    echo Updating Node.js to the current LTS from https://nodejs.org
    echo should fix this.
    echo.
    pause
    exit /b 1
  )
  set "NODE_OPTIONS=--experimental-sqlite %NODE_OPTIONS%"
  echo Enabling Node's SQLite module for this Node version.
  echo.
)

REM --- ffmpeg is optional but worth flagging ---
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo NOTE: ffmpeg was not found. I/O will still run, but
  echo audio-track fixing, subtitle selection, quality switching, and
  echo reliable mobile playback won't be available until it's installed
  echo ^(see README.md^).
  echo.
)

REM --- First-run dependency install ---
if not exist node_modules (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo ERROR: npm was not found - it normally comes with Node.js.
    echo Reinstalling Node.js from https://nodejs.org should fix this.
    echo.
    pause
    exit /b 1
  )
  echo First run detected - installing dependencies...
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
  echo.
)

echo Starting server...
echo Once it's running, open http://localhost:5921 in your browser.
echo Close this window to stop the server.
echo Everything printed here is also being saved to server-log.txt in
echo this folder - open that file any time for the complete log,
echo rather than copying from this scrolling window.
echo.

powershell -NoProfile -Command "& { node server\index.js 2>&1 | Tee-Object -FilePath server-log.txt }"
echo.
echo The server has stopped. If that wasn't intentional, the error is above.
echo (The full log is also saved in server-log.txt in this folder.)
pause
