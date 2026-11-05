#!/usr/bin/env bash
# Generates a self-signed TLS certificate for I/O's built-in
# HTTPS support, and points the server's config.json at it automatically.
#
# Usage: ./generate-cert.sh [address 1] [address 2] [...]
#   e.g. ./generate-cert.sh 192.168.1.50 75.179.134.253
#   or:  ./generate-cert.sh io.local
# Pass as many addresses as you need this certificate to work for - a
# local LAN IP and a public/global IP both, for example, so apps
# connecting either way both see a certificate that actually covers
# the address they used. If you don't pass any, you'll be prompted.
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

echo ""
echo "================================================"
echo " I/O - Generate a self-signed HTTPS certificate"
echo "================================================"
echo ""

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl was not found on your PATH."
  echo "  - Linux: usually pre-installed, or 'sudo apt install openssl' (Debian/Ubuntu)"
  echo "  - macOS: pre-installed"
  echo "  - Windows: install Git for Windows (https://git-scm.com/download/win) and"
  echo "    run this script from Git Bash - it bundles openssl automatically"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js was not found on your PATH - needed to update config.json."
  exit 1
fi

# Same resolution order as server/paths.js, so this writes to (and
# updates the config for) the exact same location the server itself
# actually uses - never guessed or hardcoded separately.
DATA_DIR=$(node -e "console.log(require('./server/paths.js').DATA_DIR)")
CERT_DIR="$DATA_DIR/certs"
mkdir -p "$CERT_DIR"

ADDRESSES=("$@")
if [ ${#ADDRESSES[@]} -eq 0 ]; then
  echo "What address(es) do you actually type into a browser or connect an app to,"
  echo "to reach this server? A certificate only covers what's actually listed on"
  echo "it - if you connect through more than one address (a local LAN IP and a"
  echo "public/global IP both, for instance), list all of them so apps connecting"
  echo "either way both see a certificate that actually covers what they used."
  echo ""
  read -r -p "Local address (e.g. 192.168.1.50, or io.local): " LOCAL_ADDR
  if [ -n "$LOCAL_ADDR" ]; then ADDRESSES+=("$LOCAL_ADDR"); fi
  read -r -p "Global/public address, if any (leave blank to skip): " GLOBAL_ADDR
  if [ -n "$GLOBAL_ADDR" ]; then ADDRESSES+=("$GLOBAL_ADDR"); fi
fi
if [ ${#ADDRESSES[@]} -eq 0 ]; then
  echo "ERROR: at least one address is required - the certificate needs to know"
  echo "what hostname/IP it's actually being used for, or browsers and apps will"
  echo "reject it even though it loaded, exactly the same way a mismatched-domain"
  echo "certificate would be rejected on any site."
  exit 1
fi

# Builds the SAN list for however many addresses were actually given,
# not just one - each type (IP vs hostname) needs its own separate,
# sequential numbering within the openssl config, continuing on from
# the fixed entries below (IP.1/IP.2/DNS.1) rather than restarting
# from 1, and skipping anything already added so entering the same
# address twice by mistake doesn't produce a duplicate, confusing entry.
IP_INDEX=2
DNS_INDEX=1
SAN_LINES=""
SEEN=""
for ADDR in "${ADDRESSES[@]}"; do
  if [[ " $SEEN " == *" $ADDR "* ]]; then continue; fi
  SEEN="$SEEN $ADDR"
  if [[ "$ADDR" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    IP_INDEX=$((IP_INDEX + 1))
    SAN_LINES="$SAN_LINES
IP.$IP_INDEX = $ADDR"
  else
    DNS_INDEX=$((DNS_INDEX + 1))
    SAN_LINES="$SAN_LINES
DNS.$DNS_INDEX = $ADDR"
  fi
done

OPENSSL_CONF=$(mktemp)
cat > "$OPENSSL_CONF" << EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = ${ADDRESSES[0]}

[v3_req]
keyUsage = keyEncipherment, dataEncipherment, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1$SAN_LINES
EOF

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 3650 \
  -config "$OPENSSL_CONF"

rm -f "$OPENSSL_CONF"
chmod 600 "$CERT_DIR/key.pem" 2>/dev/null || true

CONFIG_PATH="$DATA_DIR/config.json"
IO_CONFIG_PATH="$CONFIG_PATH" IO_CERT_DIR="$CERT_DIR" node -e "
const fs = require('fs');
const configPath = process.env.IO_CONFIG_PATH;
const certDir = process.env.IO_CERT_DIR;
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
cfg.https = { certPath: certDir + '/cert.pem', keyPath: certDir + '/key.pem' };
fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
console.log('Updated ' + configPath + ' to use the new certificate.');
"

# Re-reads what was actually written and confirms both paths genuinely
# resolve to real files on disk - catches this exact class of silent
# corruption immediately with a clear, loud error, rather than
# appearing to finish successfully while quietly leaving the server
# unable to ever find its own certificate no matter how many times
# it's restarted afterward.
IO_CONFIG_PATH="$CONFIG_PATH" node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.IO_CONFIG_PATH, 'utf-8'));
const certOk = fs.existsSync(cfg.https.certPath);
const keyOk = fs.existsSync(cfg.https.keyPath);
if (!certOk || !keyOk) {
  console.error('');
  console.error('ERROR: the certificate was generated, but the paths just written to');
  console.error('config.json do not actually point to real files:');
  console.error('  certPath: ' + cfg.https.certPath + ' - ' + (certOk ? 'found' : 'MISSING'));
  console.error('  keyPath:  ' + cfg.https.keyPath + ' - ' + (keyOk ? 'found' : 'MISSING'));
  console.error('This means HTTPS will not actually turn on even after a restart.');
  process.exit(1);
}
console.log('Verified: both certificate files are genuinely reachable at the paths just written.');
" || exit 1

echo ""
echo "================================================"
echo " Done."
echo "================================================"
echo ""
echo "Restart the server (if it's running) to pick this up."
echo "It'll then be reachable at, for each address this certificate covers:"
for ADDR in "${ADDRESSES[@]}"; do
  echo "  https://$ADDR:<your port>"
done
echo ""
echo "Your browser WILL still show a warning the first time you visit -"
echo "that's expected and normal for a self-signed certificate (nothing"
echo "vouches for it the way a public certificate authority does for a"
echo "real domain). Click through it once (\"Advanced\" -> \"Proceed\") and"
echo "your connection is still genuinely encrypted from that point on."
