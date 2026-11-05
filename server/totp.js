// TOTP (RFC 6238) two-factor authentication - built directly on Node's
// built-in crypto module, no external dependency, same philosophy as
// the rest of this project. Verified against the RFC's own official
// published test vectors before ever being wired into a login route.
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

function base32Decode(str) {
  str = str.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const c of str) {
    const val = BASE32_ALPHABET.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// 160 bits - the size RFC 6238 itself recommends.
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function computeTotp(secretBase32, forTime, step = 30, digits = 6, algo = 'sha1') {
  const counter = Math.floor(forTime / step);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const key = base32Decode(secretBase32);
  const hmac = crypto.createHmac(algo, key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** digits).padStart(digits, '0');
}

// Tolerates the immediately-previous and next 30s windows too - real,
// common clock drift between the server and someone's phone, not just
// a theoretical edge case, and without this a setup that seems to work
// once (because the server and phone briefly happened to agree) can
// start intermittently rejecting valid codes as they drift apart.
function verifyTotp(secretBase32, code, forTime = Date.now() / 1000, step = 30, window = 1) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    if (computeTotp(secretBase32, forTime + errorWindow * step, step) === code) return true;
  }
  return false;
}

// otpauth:// URI - what every authenticator app's QR scanner expects.
// issuer/label shown in the app's own list next to the generated codes,
// so someone with several accounts set up can actually tell them apart.
function otpauthUri(secretBase32, accountLabel, issuer) {
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}?${params.toString()}`;
}

// Backup codes: plain, readable, one-time-use codes generated once at
// setup and shown exactly once - the only way back in if the device
// itself is lost. Stored hashed, never in plain text, the same
// reasoning as an actual password.
function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // XXXX-XXXX - short enough to type by hand, long enough to not be guessable
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

function hashBackupCode(code) {
  return crypto.createHash('sha256').update(code.toUpperCase().trim()).digest('hex');
}

module.exports = { generateSecret, computeTotp, verifyTotp, otpauthUri, generateBackupCodes, hashBackupCode, base32Encode, base32Decode };
