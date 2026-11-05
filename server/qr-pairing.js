// In-memory QR/code pairing sessions for logging a new device (e.g. a
// smart TV, where typing a password is painful) in by approving it from
// a device that's already signed in - scan a QR code (or type the short
// code shown next to it), tap Approve on your phone, and the waiting
// device signs in automatically. Nothing here needs to survive a server
// restart, so plain in-memory storage is fine (unlike accounts/profiles).
const crypto = require('crypto');
const accountsStore = require('./accounts');

const PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes to scan + approve
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I - avoids visual ambiguity when typed by hand

const sessions = new Map(); // code -> { status, accountId, sessionToken, createdAt, expiresAt }

function generateCode(length = 8) {
  let code;
  do {
    code = Array.from({ length }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (sessions.has(code));
  return code;
}

function sweepExpired() {
  const now = Date.now();
  for (const [code, s] of sessions) {
    if (s.expiresAt < now) sessions.delete(code);
  }
}

function startPairing() {
  sweepExpired();
  const code = generateCode();
  const now = Date.now();
  sessions.set(code, { status: 'pending', accountId: null, sessionToken: null, createdAt: now, expiresAt: now + PAIRING_TTL_MS });
  return { code, expiresIn: PAIRING_TTL_MS / 1000 };
}

function getStatus(code) {
  sweepExpired();
  const s = sessions.get(code);
  if (!s) return { status: 'expired' };
  return { status: s.status };
}

// Called by the polling (waiting) device once it sees status:'approved'.
// Hands back the session token exactly once, then the code is consumed
// so it can't be replayed even if someone else saw the same QR code.
function consumeApproval(code) {
  sweepExpired();
  const s = sessions.get(code);
  if (!s || s.status !== 'approved') return null;
  sessions.delete(code);
  return { accountId: s.accountId, sessionToken: s.sessionToken };
}

// Called by the already-signed-in device (the one that scanned the code)
// to approve or deny the waiting device's sign-in.
function approve(code, accountId) {
  sweepExpired();
  const s = sessions.get(code);
  if (!s) throw new Error('This code has expired. Generate a new one and try again.');
  if (s.status !== 'pending') throw new Error('This code has already been used.');
  const token = accountsStore.createSession(accountId);
  s.status = 'approved';
  s.accountId = accountId;
  s.sessionToken = token;
  return true;
}

function deny(code) {
  sweepExpired();
  const s = sessions.get(code);
  if (s && s.status === 'pending') s.status = 'denied';
}

module.exports = { startPairing, getStatus, consumeApproval, approve, deny };
