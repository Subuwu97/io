#!/usr/bin/env bash
# Removes the auto-start service installed by install-autostart.sh.
# Run with: sudo ./uninstall-autostart.sh
set -e
SERVICE_NAME="io-stream"

if [ "$EUID" -ne 0 ]; then
  echo "Run this as: sudo ./uninstall-autostart.sh"
  exit 1
fi

if ! systemctl cat "${SERVICE_NAME}.service" >/dev/null 2>&1; then
  echo "No auto-start service is currently installed - nothing to do."
  exit 0
fi

systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload

echo "Auto-start removed. I/O will no longer launch automatically on boot."
echo "You can still run it manually any time with ./start.sh"
