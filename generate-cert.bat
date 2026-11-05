@echo off
REM Generates a self-signed HTTPS certificate for I/O.
REM This delegates to generate-cert.sh via Git Bash, rather than
REM reimplementing certificate generation in batch script, since Git
REM for Windows already bundles both bash and openssl - if you have
REM Git installed, this works with nothing extra to set up.
setlocal
cd /d "%~dp0"

set "BASH_EXE="
where bash >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%p in ('where bash') do (
    if not defined BASH_EXE set "BASH_EXE=%%p"
  )
)
if not defined BASH_EXE if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH_EXE=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH_EXE if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH_EXE=%ProgramFiles(x86)%\Git\bin\bash.exe"

if not defined BASH_EXE (
  echo.
  echo ERROR: This needs Git Bash, which wasn't found on your PATH or in
  echo the usual Git install location.
  echo.
  echo Install Git for Windows from https://git-scm.com/download/win
  echo ^(it bundles both bash and openssl, so nothing else is needed^),
  echo then run this file again.
  echo.
  pause
  exit /b 1
)

"%BASH_EXE%" generate-cert.sh %*
pause
