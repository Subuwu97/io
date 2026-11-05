#!/usr/bin/env bash
# Installs I/O as a systemd service that starts automatically
# on boot (even before anyone logs in) and restarts itself if it ever
# crashes. Run with: sudo ./install-autostart.sh
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"
PROJECT_DIR="$(pwd)"
SERVICE_NAME="io-stream"
RUN_AS_USER="${SUDO_USER:-$(whoami)}"

if [ "$EUID" -ne 0 ]; then
  echo "This needs to create a system service, which requires root."
  echo "Run it again as: sudo ./install-autostart.sh"
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "ERROR: systemd (systemctl) was not found. This installer is for"
  echo "Linux distributions that use systemd (most modern ones - Ubuntu,"
  echo "Debian, Fedora, Arch, etc.). If you're on something else, you'll"
  echo "need your distro's own equivalent (e.g. an init.d script, or an"
  echo "OpenRC service) - I/O itself still runs fine, this"
  echo "script just can't set up auto-start for you automatically."
  exit 1
fi

NODE_PATH="$(command -v node || true)"
if [ -z "$NODE_PATH" ]; then
  echo "ERROR: Node.js was not found on PATH. Install it first (see README.md), then run this again."
  exit 1
fi

if ! "$NODE_PATH" -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)"; then
  echo "ERROR: I/O needs Node.js 22.5 or newer."
  echo "Installed version: $("$NODE_PATH" --version)"
  exit 1
fi

# Some Node 22.x versions need this flag for the built-in SQLite module -
# detect it once here so the service starts correctly without needing a
# person present to see (or fix) a startup error.
EXTRA_ENV=""
if ! "$NODE_PATH" -e "require('node:sqlite')" >/dev/null 2>&1; then
  if "$NODE_PATH" --experimental-sqlite -e "require('node:sqlite')" >/dev/null 2>&1; then
    EXTRA_ENV="Environment=NODE_OPTIONS=--experimental-sqlite"
    echo "(This Node version needs --experimental-sqlite - baking that into the service.)"
  else
    echo "ERROR: This Node.js version can't load its built-in SQLite module."
    echo "Update Node.js (see README.md) and run this again."
    exit 1
  fi
fi

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "First run detected - installing dependencies..."
  sudo -u "$RUN_AS_USER" npm install --prefix "$PROJECT_DIR"
fi

cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=I/O (anime/manga/movie streaming server)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_AS_USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=${NODE_PATH} server/index.js
Restart=on-failure
RestartSec=5
${EXTRA_ENV}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo ""
echo "================================================"
echo " I/O is now set to start automatically on boot."
echo "================================================"
echo ""
sleep 1
systemctl --no-pager status "$SERVICE_NAME" || true
echo ""
echo "Useful commands:"
echo "  sudo systemctl status $SERVICE_NAME    - check if it's running"
echo "  sudo journalctl -u $SERVICE_NAME -f    - watch its live log"
echo "  sudo systemctl restart $SERVICE_NAME   - restart it"
echo "  sudo ./uninstall-autostart.sh          - remove auto-start"
