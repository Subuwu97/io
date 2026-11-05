#!/usr/bin/env bash
# IO Control Panel - desktop GUI launcher (Linux / macOS)
# Run from a terminal with: ./start-gui.sh
# (Or make it double-clickable: right-click -> Properties -> Permissions
#  -> "Allow executing as program" on most desktop Linux file managers.)
#
# This is an alternative to start.sh, not a replacement for it - it
# opens a desktop window with Start/Stop/Restart buttons and a live
# log view, instead of running the server directly in this terminal.
# start.sh continues to work exactly as it always has.
cd "$(dirname "${BASH_SOURCE[0]}")/launcher"

fail() {
  echo ""
  echo "ERROR: $1"
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
}

echo ""
echo "================================================"
echo " IO Control Panel"
echo "================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js was not found on your PATH.
Install it from https://nodejs.org (choose the LTS version) and try again."
fi

# --- First-run dependency install ---
# Actually validates Electron loads correctly, rather than just
# checking whether a node_modules folder happens to exist - a folder
# left behind by a previous broken/incomplete install (for example,
# npm 12+ silently blocking Electron's own postinstall script unless
# explicitly approved) would otherwise be mistaken for a working one
# forever, endlessly retrying the same broken Electron on every run
# with no way to recover without manual intervention.
if ! node -e "require('electron')" >/dev/null 2>&1; then
  if ! command -v npm >/dev/null 2>&1; then
    fail "npm was not found (it normally comes with Node.js).
Reinstalling Node.js from https://nodejs.org should fix this."
  fi
  if [ -d node_modules ]; then
    echo "An existing install looks incomplete or broken - reinstalling from scratch."
    rm -rf node_modules
  else
    echo "First run detected - installing the desktop GUI's own dependencies."
  fi
  echo "This downloads Electron (a few hundred MB, since it bundles its own"
  echo "browser to render the window)."
  echo ""
  if ! npm install; then
    fail "Dependency install failed (see the npm output above -
usually this means no internet connection right now, or a proxy in the way).
Fix that and run this script again."
  fi
  if ! node -e "require('electron')" >/dev/null 2>&1; then
    fail "Electron still isn't working correctly after a fresh install.
Try running these commands manually from the launcher folder to see the full error:
  rm -rf node_modules && npm install"
  fi
  echo ""
fi

echo "Opening the IO Control Panel..."
echo ""

# Chromium's own sandbox refuses to start at all when already running as
# root (a real, deliberate security check, not a bug) - only relevant if
# you're actually running this as root, which most desktop users aren't.
if [ "$(id -u)" = "0" ]; then
  npm start -- --no-sandbox
else
  npm start
fi
STATUS=$?
if [ $STATUS -ne 0 ]; then
  fail "The control panel closed with an error (exit code $STATUS) - see the output above."
fi
