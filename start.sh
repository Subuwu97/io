#!/usr/bin/env bash
# I/O startup script (Linux / macOS)
# Run from a terminal with: ./start.sh
# (Or make it double-clickable: right-click -> Properties -> Permissions
#  -> "Allow executing as program" on most desktop Linux file managers.)
cd "$(dirname "${BASH_SOURCE[0]}")"

# Pauses before closing so the window never just flashes and disappears
# when something goes wrong - you always get to read the actual error.
fail() {
  echo ""
  echo "ERROR: $1"
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
}

echo ""
echo "================================================"
echo " I/O"
echo "================================================"
echo ""

# --- Node.js present? ---
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js was not found on your PATH.
Install it from https://nodejs.org (choose the LTS version, which is new enough) and try again."
fi

# --- Node.js new enough? (node:sqlite needs 22.5+) ---
NODE_VERSION="$(node --version)"
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)"; then
  fail "Your Node.js version is $NODE_VERSION, but I/O needs 22.5 or newer
(its built-in database arrived in Node 22.5).
Update Node.js from https://nodejs.org and try again."
fi

# --- Does this Node version need the experimental flag for node:sqlite?
# (22.5 through 22.12 shipped it behind --experimental-sqlite; newer
#  versions have it enabled by default.) ---
if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
  if node --experimental-sqlite -e "require('node:sqlite')" >/dev/null 2>&1; then
    export NODE_OPTIONS="--experimental-sqlite ${NODE_OPTIONS:-}"
    echo "(Enabling Node's SQLite module for this Node version: $NODE_VERSION)"
  else
    fail "This Node.js version ($NODE_VERSION) can't load its built-in SQLite module.
Updating Node.js to the current LTS from https://nodejs.org should fix this."
  fi
fi

# --- ffmpeg is optional but worth flagging ---
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "NOTE: ffmpeg was not found. I/O will still run, but"
  echo "audio-track fixing, subtitle selection, quality switching, and"
  echo "reliable mobile playback won't be available until it's installed"
  echo "(see README.md)."
  echo ""
fi

# --- First-run dependency install ---
if [ ! -d node_modules ]; then
  if ! command -v npm >/dev/null 2>&1; then
    fail "npm was not found (it normally comes with Node.js).
Reinstalling Node.js from https://nodejs.org should fix this."
  fi
  echo "First run detected - installing dependencies..."
  if ! npm install; then
    fail "Dependency install failed (see the npm output above -
usually this means no internet connection right now, or a proxy in the way).
Fix that and run this script again."
  fi
  echo ""
fi

echo "Starting server..."
echo "Once it's running, open http://localhost:4821 in your browser."
echo "Press Ctrl+C in this window to stop the server."
echo ""

node server/index.js
STATUS=$?
if [ $STATUS -ne 0 ]; then
  fail "The server stopped with an error (exit code $STATUS) - see the output above."
fi
