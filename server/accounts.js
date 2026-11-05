const crypto = require('crypto');
const { db } = require('./db');
const totp = require('./totp');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const passwordQueue = require('./resource-queue').createQueue({ software: 2, maxQueue: 16, timeoutMs: 15000 });

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function hashPassword(password, salt) {
  if (typeof password !== 'string' || password.length > 1024) throw new Error('Password is too long');
  const release = await passwordQueue.acquireSlot();
  try { return (await scrypt(password, salt, 64)).toString('hex'); } finally { release(); }
}

async function passwordMatches(candidate, salt, storedHash) {
  const candidateHash = await hashPassword(candidate || '', salt);
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b) &&
    !!db.prepare('SELECT id FROM accounts WHERE salt = ? AND password_hash = ?').get(salt, storedHash);
}

function publicAccount(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at, approved: !!row.approved, adultContentAllowed: row.adult_content_allowed === undefined ? true : !!row.adult_content_allowed };
}

function listAccounts() {
  return db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all().map(publicAccount);
}

function accountCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
}

function findByUsername(username) {
  return db.prepare('SELECT * FROM accounts WHERE lower(username) = lower(?)').get(username || '') || null;
}

function getAccount(id) {
  return publicAccount(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
}

async function createAccount({ username, password, role, approved = true, adultContentAllowed = true, registrationPolicy = null }) {
  username = (username || '').trim();
  if (username.length < 3) throw new Error('Username must be at least 3 characters');
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new Error('Username can only contain letters, numbers, and _ . -');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');

  if (findByUsername(username)) throw new Error('That username is already taken');

  const salt = crypto.randomBytes(16).toString('hex');
  const account = {
    id: 'acc_' + crypto.randomBytes(8).toString('hex'),
    username,
    salt,
    passwordHash: await hashPassword(password, salt),
    role: 'user',
    // The first account ever always gets in immediately regardless of
    // the approved flag passed in - there'd be no admin around yet to
    // ever approve it otherwise, which would permanently lock the
    // server before it even starts.
    approved,
    adultContentAllowed: adultContentAllowed !== false,
    createdAt: new Date().toISOString(),
  };
  const isFirstAccount = accountCount() === 0;
  if (registrationPolicy && !isFirstAccount && !registrationPolicy.admin) {
    if (!registrationPolicy.allow) throw new Error('Only an admin can create additional accounts');
    role = 'user'; approved = !registrationPolicy.approval;
  }
  account.role = isFirstAccount ? 'admin' : (role === 'admin' ? 'admin' : 'user');
  account.approved = isFirstAccount ? true : approved;
  if (findByUsername(username)) throw new Error('That username is already taken');
  db.prepare(`
    INSERT INTO accounts (id, username, password_hash, salt, role, created_at, approved, adult_content_allowed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(account.id, account.username, account.passwordHash, account.salt, account.role, account.createdAt, account.approved ? 1 : 0, account.adultContentAllowed ? 1 : 0);

  return publicAccount({ id: account.id, username: account.username, role: account.role, created_at: account.createdAt, approved: account.approved, adult_content_allowed: account.adultContentAllowed ? 1 : 0 });
}

// Deliberately one-directional - an admin can restrict another
// account's mature content, but can never unlock it through this
// path, only the account itself can, via its own password-gated
// Settings toggle. Not just enforced at the route level - this
// function itself is incapable of setting the flag to true, so
// there's no way to wire this up wrong later and accidentally let an
// admin bypass the password gate.
function adminRestrictAdultContent(accountId) {
  db.prepare('UPDATE accounts SET adult_content_allowed = 0 WHERE id = ?').run(accountId);
  return getAccount(accountId);
}

async function setAdultContentAllowed(accountId, allowed, password) {
  if (allowed) {
    // Only unlocking needs the real password - turning it off is a
    // more-restrictive action anyone using the account should be able
    // to do freely, but loosening it should require proving you're the
    // one who actually knows the account password, not just whichever
    // profile happens to be active at the time.
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!account) throw new Error('Account not found');
    if (!await passwordMatches(password, account.salt, account.password_hash)) throw new Error('Incorrect password');
  }
  db.prepare('UPDATE accounts SET adult_content_allowed = ? WHERE id = ?').run(allowed ? 1 : 0, accountId);
  return getAccount(accountId);
}

async function verifyPassword({ username, password, totpCode }) {
  const account = findByUsername(username);
  if (!account) return null;
  if (!await passwordMatches(password, account.salt, account.password_hash)) return null;
  const latest = findByUsername(username);
  if (!latest || latest.password_hash !== account.password_hash || latest.salt !== account.salt) return null;
  Object.assign(account, latest);
  if (!account.approved) {
    const err = new Error('Your account is pending admin approval.');
    err.pendingApproval = true;
    throw err;
  }
  if (account.totp_enabled) {
    if (!totpCode) {
      const err = new Error('Two-factor code required.');
      err.requiresTotp = true;
      throw err;
    }
    if (!verifyTotpOrBackupCode(account.id, totpCode)) return null; // wrong code - treated as a real login failure, same as a wrong password, for rate-limiting
  }
  return publicAccount(account);
}

function verifyTotpOrBackupCode(accountId, code) {
  const account = db.prepare('SELECT totp_secret FROM accounts WHERE id = ?').get(accountId);
  if (!account || !account.totp_secret) return false;
  if (totp.verifyTotp(account.totp_secret, String(code).trim())) return true;
  // Not a valid TOTP code - try it as a one-time backup code instead.
  const hash = totp.hashBackupCode(code);
  const row = db.prepare('SELECT used FROM totp_backup_codes WHERE account_id = ? AND code_hash = ?').get(accountId, hash);
  if (!row || row.used) return false;
  db.prepare('UPDATE totp_backup_codes SET used = 1 WHERE account_id = ? AND code_hash = ?').run(accountId, hash);
  return true;
}

// Generates a fresh secret, stored but NOT yet marked enabled - two-
// factor only actually turns on once confirmSetupTotp verifies the
// person can produce a real code from it, so a setup abandoned
// halfway through can never leave an account in a broken state where
// it thinks 2FA is on but no device was ever actually confirmed.
function beginTotpSetup(accountId) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('Account not found');
  const secret = totp.generateSecret();
  db.prepare('UPDATE accounts SET totp_secret = ? WHERE id = ?').run(secret, accountId);
  return { secret, otpauthUri: totp.otpauthUri(secret, account.username, 'I/O') };
}

function confirmTotpSetup(accountId, code) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account || !account.totp_secret) throw new Error('No two-factor setup in progress for this account');
  if (!totp.verifyTotp(account.totp_secret, String(code).trim())) throw new Error('Incorrect code - check the time on your device and try again');
  db.prepare('UPDATE accounts SET totp_enabled = 1 WHERE id = ?').run(accountId);
  const codes = totp.generateBackupCodes();
  db.prepare('DELETE FROM totp_backup_codes WHERE account_id = ?').run(accountId);
  const insert = db.prepare('INSERT INTO totp_backup_codes (account_id, code_hash, used) VALUES (?, ?, 0)');
  for (const code of codes) insert.run(accountId, totp.hashBackupCode(code));
  return codes; // the only time these are ever available in plain text - stored hashed from here on
}

// Requires the actual current password, not just an existing session -
// someone briefly at an already-logged-in device shouldn't be able to
// casually strip 2FA off an account without knowing its password.
async function disableTotp(accountId, password) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('Account not found');
  if (!await passwordMatches(password, account.salt, account.password_hash)) throw new Error('Incorrect password');
  db.prepare('UPDATE accounts SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(accountId);
  db.prepare('DELETE FROM totp_backup_codes WHERE account_id = ?').run(accountId);
}

function getTotpStatus(accountId) {
  const account = db.prepare('SELECT totp_enabled FROM accounts WHERE id = ?').get(accountId);
  if (!account) return { enabled: false };
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM totp_backup_codes WHERE account_id = ? AND used = 0').get(accountId).n;
  return { enabled: !!account.totp_enabled, remainingBackupCodes: remaining };
}

async function changePassword(accountId, oldPassword, newPassword, exceptToken) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('Account not found');
  if (!await passwordMatches(oldPassword, account.salt, account.password_hash)) {
    throw new Error('Current password is incorrect');
  }
  if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters');
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = await hashPassword(newPassword, salt);
  const current = db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(accountId);
  if (!current || current.password_hash !== account.password_hash) throw new Error('Account changed while verifying the password; please retry');
  db.prepare('UPDATE accounts SET salt = ?, password_hash = ? WHERE id = ?').run(salt, passwordHash, accountId);
  // Changing a password invalidates every OTHER existing session for this
  // account - if someone else had access to it, this locks them out too -
  // but keeps the session making this very request alive, so you aren't
  // immediately signed out of the device you just used to change it.
  if (exceptToken) {
    db.prepare('DELETE FROM sessions WHERE account_id = ? AND token != ?').run(accountId, exceptToken);
  } else {
    db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
  }
}

// Admin-initiated reset: doesn't require knowing the old password, for
// when someone forgets theirs and there's no self-serve email flow on a
// self-hosted server. Also invalidates existing sessions for safety.
async function adminResetPassword(accountId, newPassword) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('Account not found');
  if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters');
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = await hashPassword(newPassword, salt);
  db.prepare('UPDATE accounts SET salt = ?, password_hash = ? WHERE id = ?').run(salt, passwordHash, accountId);
  db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
}

function setRole(accountId, role) {
  if (!['admin', 'user'].includes(role)) throw new Error('Invalid role');
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('Account not found');
  if (account.role === 'admin' && role !== 'admin') {
    const otherAdmins = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE id != ? AND role = 'admin'").get(accountId).n;
    if (otherAdmins === 0) throw new Error('Cannot remove the last admin account');
  }
  db.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(role, accountId);
  return getAccount(accountId);
}

function approveAccount(accountId) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('Account not found');
  db.prepare('UPDATE accounts SET approved = 1 WHERE id = ?').run(accountId);
  return getAccount(accountId);
}

function deleteAccount(accountId) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) return;
  if (account.role === 'admin') {
    const otherAdmins = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE id != ? AND role = 'admin'").get(accountId).n;
    if (otherAdmins === 0) throw new Error('Cannot delete the last admin account');
  }
  // Sessions, profiles, and every profile-owned row (my_list, top_picks,
  // progress, reviews, comments) cascade-delete automatically via the
  // foreign key ON DELETE CASCADE constraints defined in db.js.
  db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
}

// ---------------- Sessions ----------------
function createSession(accountId, userAgent) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, account_id, created_at, expires_at, user_agent, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
    .run(token, accountId, now, now + SESSION_TTL_MS, (userAgent || '').slice(0, 300), now);
  return token;
}

function setSessionUserAgent(token, userAgent) {
  db.prepare('UPDATE sessions SET user_agent = ? WHERE token = ?').run((userAgent || '').slice(0, 300), token);
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Called on every authenticated request so the admin dashboard can show
// genuinely "active recently" sessions rather than just "not yet
// expired" ones. Throttled to once a minute per session so it isn't a
// database write on literally every request.
const LAST_SEEN_THROTTLE_MS = 60 * 1000;
function touchLastSeen(token, lastSeen) {
  if (Date.now() - (lastSeen || 0) < LAST_SEEN_THROTTLE_MS) return;
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(Date.now(), token);
}

function getAccountByToken(token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  touchLastSeen(token, session.last_seen);
  const account = getAccount(session.account_id);
  // Defense in depth: a pending account should never reach this point
  // at all, given registration/login already refuse it a session - but
  // if an admin later revokes an already-approved account, this cuts
  // off access immediately for any of its still-active sessions too,
  // not just future login attempts.
  if (account && !account.approved) return null;
  return account;
}

// Lets a signed-in account see (and revoke) its own active sessions -
// useful now that QR pairing makes it easy to sign in on lots of
// devices, so there should be an easy way to see what's logged in and
// kick out anything you don't recognize or don't use anymore.
// Turns a raw User-Agent string into a short human-friendly label like
// "Chrome on Windows" - just enough to tell sessions apart at a glance,
// not a full parse of every browser/OS combination in existence.
function friendlyDeviceLabel(userAgent) {
  const ua = userAgent || '';
  if (!ua) return 'Unknown device';
  let os = 'Unknown OS';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone/i.test(ua)) os = 'iPhone';
  else if (/ipad/i.test(ua)) os = 'iPad';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/mac os x/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  let browser = 'Unknown browser';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) browser = 'Chrome';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  return `${browser} on ${os}`;
}

function listSessions(accountId, currentToken) {
  const rows = db.prepare('SELECT * FROM sessions WHERE account_id = ? ORDER BY created_at DESC').all(accountId);
  return rows.map((s) => ({
    id: s.token.slice(0, 12), // short opaque id for the UI - never expose the real token
    device: friendlyDeviceLabel(s.user_agent),
    createdAt: new Date(s.created_at).toISOString(),
    expiresAt: new Date(s.expires_at).toISOString(),
    lastSeen: s.last_seen ? new Date(s.last_seen).toISOString() : null,
    isCurrent: s.token === currentToken,
  }));
}

// Admin-only: every session across every account, for the admin
// dashboard - lets an admin see who's actually signed in right now
// server-wide, and revoke anything that looks wrong.

function revokeSession(accountId, shortId) {
  const rows = db.prepare('SELECT token FROM sessions WHERE account_id = ?').all(accountId);
  const match = rows.find((r) => r.token.startsWith(shortId));
  if (match) db.prepare('DELETE FROM sessions WHERE token = ?').run(match.token);
}

function revokeAllSessions(accountId, exceptToken) {
  if (exceptToken) {
    db.prepare('DELETE FROM sessions WHERE account_id = ? AND token != ?').run(accountId, exceptToken);
  } else {
    db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
  }
}

// Admin-wide view across every account's sessions, for the admin
// dashboard - same shape as listSessions but joined with the owning
// account's username so an admin can tell whose session is whose.
function listAllSessions(currentToken) {
  const rows = db.prepare(`
    SELECT sessions.*, accounts.username, accounts.role
    FROM sessions JOIN accounts ON accounts.id = sessions.account_id
    ORDER BY sessions.created_at DESC
  `).all();
  return rows.map((s) => ({
    id: s.token.slice(0, 12),
    username: s.username,
    role: s.role,
    device: friendlyDeviceLabel(s.user_agent),
    createdAt: new Date(s.created_at).toISOString(),
    expiresAt: new Date(s.expires_at).toISOString(),
    lastSeen: s.last_seen ? new Date(s.last_seen).toISOString() : null,
    isCurrent: s.token === currentToken,
  }));
}

function revokeSessionById(shortId) {
  const rows = db.prepare('SELECT token FROM sessions').all();
  const match = rows.find((r) => r.token.startsWith(shortId));
  if (match) db.prepare('DELETE FROM sessions WHERE token = ?').run(match.token);
}

// ---------------- Basic login throttling ----------------
// A small in-memory guard against repeated failed logins for the same
// username - not meant to replace real infrastructure-level protection,
// just a sane default so a self-hosted server isn't wide open to
// unlimited password guessing on the local network.
const failedAttempts = new Map(); // username (lowercase) -> { count, lockedUntil }
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 5 * 60 * 1000;

function checkLoginAllowed(username) {
  const entry = failedAttempts.get((username || '').toLowerCase());
  if (entry && entry.lockedUntil && entry.lockedUntil > Date.now()) {
    const waitMin = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    throw new Error(`Too many failed attempts. Try again in ${waitMin} minute${waitMin === 1 ? '' : 's'}.`);
  }
}
function recordLoginFailure(username) {
  const key = (username || '').toLowerCase();
  const entry = failedAttempts.get(key) || { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  failedAttempts.set(key, entry);
}
function recordLoginSuccess(username) {
  failedAttempts.delete((username || '').toLowerCase());
}

// Expired sessions were only ever deleted when that exact device tried
// to use its old token again - devices that simply never come back left
// their rows behind forever. Swept once at startup.
function pruneExpiredSessions() {
  const r = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  if (r.changes > 0) console.log(`[sessions] pruned ${r.changes} expired session(s)`);
}

module.exports = {
  listAccounts,
  accountCount,
  findByUsername,
  getAccount,
  createAccount,
  verifyPassword,
  verifyTotpOrBackupCode,
  beginTotpSetup,
  confirmTotpSetup,
  disableTotp,
  getTotpStatus,
  setAdultContentAllowed,
  adminRestrictAdultContent,
  changePassword,
  adminResetPassword,
  setRole,
  approveAccount,
  deleteAccount,
  createSession,
  setSessionUserAgent,
  destroySession,
  getAccountByToken,
  listSessions,
  revokeSession,
  revokeAllSessions,
  listAllSessions,
  revokeSessionById,
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  pruneExpiredSessions,
};
