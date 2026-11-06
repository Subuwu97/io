const express = require('express');
const fs = require('fs');
const mediaIO = require('./media-io');
const mediaStream = require('./media-stream');
const { isWithin } = require('./path-safety');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const mime = require('./mime');
const { Library, unslugify } = require('./library');
const profilesStore = require('./profiles');
require('./migrate-json').migrateIfNeeded();
const accountsStore = require('./accounts');
const qrPairing = require('./qr-pairing');
const notifications = require('./notifications');
const episodeTracker = require('./episode-tracker');
const { pickBestMatch } = require('./title-match');
const ffm = require('./ffmpeg');
const hwaccelLib = require('./hwaccel');
const watchParty = require('./watch-party');
const changeDetector = require('./library-change-detector');
const transcodeLimiter = require('./transcode-limiter');
// Serializes only the brief hardware-initialization moment itself, not
// transcoding overall - confirmed directly from a real server log that
// two ffmpeg processes both trying to grab a QSV hardware context at
// the same instant (e.g. "Auto" quality starting more than one variant
// session for the same show in quick succession) can produce genuine
// contention errors ("Error querying IO surface: unsupported"), even
// when both are otherwise well within the overall concurrency ceiling
// transcodeLimiter already enforces above. Holding this open for a
// couple seconds after each hardware spawn is enough to let that
// specific initialization handshake finish before the next one starts
// its own, at the cost of very little real throughput.
let hwStartupLock = Promise.resolve();
function acquireHwStartupSlot() {
  const myTurn = hwStartupLock; // resolves immediately if nothing else is currently in its own startup window
  hwStartupLock = myTurn.then(() => new Promise((resolve) => setTimeout(resolve, 2000))).catch(() => {}); // whoever arrives next waits out the remainder of THIS window, not their own fresh one
  return myTurn;
}
const trickplay = require('./trickplay');
const { db, getOrRecordFirstSeen, firstSeenTableIsEmpty, getOrRecordEpisodeFirstSeen, episodeFirstSeenTableIsEmpty, getRecentEpisodes, pruneEpisodeFirstSeenForShow, getFollowingProfiles, getAllAudioLangCache, setAudioLangCache, getSeriesLogoCache, setSeriesLogoCache, clearSeriesLogoCache } = require('./db'); // db used by the backup system's VACUUM INTO
const episodeThumbs = require('./episode-thumbs');
const systemStats = require('./system-stats');
const gpuHealth = require('./gpu-health');
const playbackMetrics = require('./playback-metrics');
systemStats.start();
const mal = require('./mal');
const anilist = require('./anilist');
const jellyfin = require('./jellyfin');
const curatedRows = require('./curated-rows');
const uploads = require('./uploads');
const archive = require('./archive');
const epub = require('./epub');
const pdfLib = require('./pdf');
const { DATA_DIR } = require('./paths');

const BASE_DIR = path.join(__dirname, '..');
const BUILTIN_AVATARS_DIR = path.join(BASE_DIR, 'public', 'img', 'avatars');
// A single, explicit version marker - bump this string with each
// delivery. Deliberately NOT based on file modification times: zip
// extraction (especially on Windows) commonly preserves each file's
// original mtime from inside the archive rather than setting it to
// the moment of extraction, which meant a genuinely fresh deploy could
// still compute the exact same "version" as a stale one - a real bug
// that was quietly undermining cache-busting. This has no dependency
// on filesystem timestamp behavior at all, so it can't fail the same
// way. Used both for the startup banner and the JS/CSS cache-busting
// query param below, so they can never drift out of sync with each
// other.
const BUILD_VERSION = 'io-0.5.0-community-integrations-2026-11-05';
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SESSION_COOKIE = 'io_session';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

// Site settings (name, theme, MAL Client ID, media folder locations) live
// in the persistent data directory alongside accounts/profiles, so an app
// update doesn't reset them either. On first run this seeds from the
// bundled defaults; if you're upgrading from a version where config.json
// lived in the app folder, that old file is migrated in automatically so
// nothing you'd already configured gets lost.
function ensureConfigSeeded() {
  if (fs.existsSync(CONFIG_PATH)) return;
  const legacyConfigPath = path.join(BASE_DIR, 'config.json');
  const defaultConfigPath = path.join(BASE_DIR, 'config.default.json');
  const seedFrom = fs.existsSync(legacyConfigPath) ? legacyConfigPath : defaultConfigPath;
  fs.copyFileSync(seedFrom, CONFIG_PATH);
  console.log(`[config] created ${CONFIG_PATH} (seeded from ${path.basename(seedFrom)})`);
}
ensureConfigSeeded();

function loadConfig() {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    // A hand-edited config with a typo (the classic on Windows: paths
    // written with single backslashes like "D:\Movies", which is invalid
    // JSON) must fail LOUDLY with the file's location and the fix - not
    // crash cryptically or silently fall back and ignore the edit.
    console.error('');
    console.error('================= CONFIG ERROR =================');
    console.error(`Could not read: ${CONFIG_PATH}`);
    console.error(`Problem: ${e.message}`);
    console.error('Tip: on Windows, write folder paths with forward slashes,');
    console.error('e.g. "D:/Movies" - backslashes are not valid in JSON.');
    console.error('(Media folders can also be changed in Settings inside the app.)');
    console.error('================================================');
    process.exit(1);
  }
  // Backfill keys added in later versions for configs created by an older
  // build, so they show up as real, editable entries in the file (and in
  // Settings) instead of silently relying on an in-memory fallback.
  let changed = false;
  if (!cfg.mediaPaths) { cfg.mediaPaths = {}; changed = true; }
  if (!cfg.mediaPaths.movies) { cfg.mediaPaths.movies = './media/movies'; changed = true; }
  if (cfg.preferEnglishTitles === undefined) { cfg.preferEnglishTitles = true; changed = true; }
  if (cfg.hardwareAcceleration === undefined) { cfg.hardwareAcceleration = true; changed = true; }
  if (cfg.maxStreamCacheGB === undefined) { cfg.maxStreamCacheGB = 15; changed = true; }
  if (cfg.https === undefined) { cfg.https = { certPath: '', keyPath: '' }; changed = true; }
  if (cfg.libraryScanTimeoutSec === undefined) { cfg.libraryScanTimeoutSec = 240; changed = true; }
  if (cfg.autoScanIntervalMinutes === undefined) { cfg.autoScanIntervalMinutes = 15; changed = true; }
  if (cfg.allowSelfRegistration === undefined) { cfg.allowSelfRegistration = true; changed = true; }
  if (cfg.requireApprovalForSelfRegistration === undefined) { cfg.requireApprovalForSelfRegistration = true; changed = true; }
  if (cfg.jellyfinServerUrl === undefined) { cfg.jellyfinServerUrl = ''; changed = true; }
  if (cfg.jellyfinApiKey === undefined) { cfg.jellyfinApiKey = ''; changed = true; }
  // One-time migration: anyone who already had this explicitly saved
  // from before it was increased is stuck at the old default forever,
  // since the check above only ever fills in a value that's genuinely
  // missing - a value of exactly 90 already existing in the file looks
  // identical to someone who deliberately chose 90, even though it's
  // actually just the old default nobody ever touched. Bumping it this
  // one time is safe: anyone who really did choose 90 on purpose can
  // set it right back in Settings. The migration flag means this only
  // ever happens once - it doesn't keep fighting a deliberate later
  // choice of 90 on every subsequent restart.
  if (cfg.libraryScanTimeoutSec === 90 && !cfg._migratedScanTimeout90) {
    cfg.libraryScanTimeoutSec = 240;
    cfg._migratedScanTimeout90 = true;
    changed = true;
  }
  if (cfg.metadataSource === undefined) { cfg.metadataSource = 'mal'; changed = true; }
  if (changed) fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ---------- Process-level safety net ----------
// Without these, ONE stray error anywhere async - a background cache
// build hitting a weird file, a watcher hiccup, an API race - kills the
// entire server for everyone. A home media server should log loudly and
// keep serving instead. (Genuine programming bugs still get surfaced -
// they're printed with full stacks - they just don't take the whole
// service down with them.)
process.on('unhandledRejection', (reason) => {
  console.error('[unhandled-rejection]', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaught-exception]', err && err.stack ? err.stack : err);
});
// Ctrl+C / service stop: exit cleanly (ffmpeg children are killed below
// via the live-process registry so no orphaned encoders linger).
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[shutdown] ${sig} received - stopping`);
    try { ffm.killAllLive(); } catch (e) { /* best effort */ }
    process.exit(0);
  });
}

let config = loadConfig();
transcodeLimiter.configure(config.transcodeLimits || {});

// True when the server was started with a TLS certificate (see startup
// at the bottom). Session cookies gain the Secure flag and responses
// gain HSTS only in that case - sending those over plain HTTP would
// either break login or be meaningless.
const httpsActive = !!(config.https && config.https.certPath && config.https.keyPath
  && fs.existsSync(config.https.certPath) && fs.existsSync(config.https.keyPath));
const librarySnapshotPath = path.join(DATA_DIR, 'library-index.json');
let library = new Library(config, BASE_DIR, { snapshotPath: librarySnapshotPath }); // restore cached titles, then scan after HTTP starts

// Every one of the several things that can trigger a rescan (auto-rescan
// reacting to a file change, a manual Rescan click, a MAL import
// finishing, a settings change, multiple native apps or devices hitting
// the API around the same time) goes through this single gate instead
// of calling Library.create() directly. Without it, two of those
// happening close together would each spawn their own full set of
// scanning worker threads on top of each other - and enough concurrent
// workers competing for the same CPU cores was, in practice, enough to
// make even a fast, healthy local scan occasionally exceed the timeout
// meant for a genuinely unresponsive network drive. A rescan requested
// while one is already running simply waits for and reuses that one's
// result rather than starting a second one - the scan is fast enough
// (well under a second at real library sizes) that this is never
// meaningfully stale.
let scanPromise = null;
let scanningLibrary = null;
let changePoller = null; // created further down once rescan state exists; scanLibrary only needs it by the time a scan actually runs
function scanLibrary(refreshAfterCurrent = false) {
  if (scanPromise && refreshAfterCurrent) return scanPromise.then(() => scanLibrary());
  if (!scanPromise) {
    scanPromise = (async () => {
      try {
        config = loadConfig();
        // Snapshot the media folders' state BEFORE the scan reads
        // anything - see library-change-detector.js. Skipped entirely
        // when the periodic check is switched off, so it costs nothing
        // for anyone who doesn't use it.
        if (changePoller && (config.autoScanIntervalMinutes || 0) > 0) void changePoller.captureBaseline();
        scanningLibrary = new Library(config, BASE_DIR, { previous: library, snapshotPath: librarySnapshotPath });
        await scanningLibrary.scan();
        library = scanningLibrary;
        // Filesystem timestamps are an unreliable proxy for "when did
        // this actually get added to the library" - torrent clients,
        // archive extractors, and backup restores often preserve a
        // file's original timestamp rather than setting it to when it
        // landed on this machine, which makes date-sorted rows like
        // Recently Added (and the hero banner) show stale results for
        // things that are genuinely new to this library. Overriding
        // dateAdded with the database-backed "first time the scanner
        // itself saw this id" value sidesteps that entirely - wrapped
        // in one transaction since this touches every title on every
        // scan and needs to stay fast at real library sizes.
        // Wrapped in one transaction since this touches every title on
        // every scan and needs to stay fast at real library sizes (same
        // reasoning, and the same measured multi-second-vs-under-10ms
        // difference, as episode-tracker.js's bulk upserts).
        const allItems = [...library.cache.anime, ...library.cache.movies, ...library.cache.manga];
        const isInitialMigration = firstSeenTableIsEmpty();
        const isInitialEpisodeMigration = episodeFirstSeenTableIsEmpty();
        db.exec('BEGIN');
        try {
          for (const item of allItems) {
            const fileTimestamp = item.dateAdded; // the original filesystem-derived value, before being overwritten below
            item.dateAdded = getOrRecordFirstSeen(item.id, fileTimestamp, isInitialMigration);
          }
          // Per-episode tracking, anime only - movies are single files
          // already covered by the show-level pass above, and manga
          // chapters have their own separate reading-progress concept
          // rather than a "recently added" one. Uses each show's own
          // dateAdded as the migration-time fallback (no extra
          // filesystem stat call per episode needed) rather than
          // reading every individual episode file's own timestamp -
          // episodes within the same show were realistically added
          // around the same time anyway, and this avoids what could
          // easily be tens of thousands of extra I/O operations on a
          // large library.
          for (const show of library.cache.anime) {
            const episodeKeys = [];
            for (const group of show.groups || []) {
              for (const ep of group.episodes || []) {
                const key = ep.relPath;
                episodeKeys.push(key);
                getOrRecordEpisodeFirstSeen(key, show.id, show.dateAdded, isInitialEpisodeMigration);
              }
            }
            pruneEpisodeFirstSeenForShow(show.id, episodeKeys);
          }
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          console.error('[scanner] first-seen tracking transaction failed and was rolled back:', e.message, e.stack);
          throw e;
        }
        restartLibraryWatcher();
        return library;
      } finally {
        scanningLibrary = null;
        scanPromise = null;
      }
    })();
  }
  return scanPromise;
}

const app = express();
// Express 4 does not forward rejected async route promises automatically.
for (const verb of ['get', 'post', 'put', 'delete', 'patch']) {
  const original = app[verb].bind(app);
  app[verb] = (route, ...handlers) => handlers.length ? original(route, ...handlers.map(handler =>
    typeof handler === 'function' && handler.constructor.name === 'AsyncFunction'
      ? (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next) : handler)) : original(route);
}

app.use(express.json({ limit: '10mb' }));

// Gzip every JSON API response when the client supports it. A library
// with a few hundred titles can easily be several hundred KB of JSON
// (each title carries full episode lists), and JSON compresses very
// well (typically 70-85% smaller) - this meaningfully speeds up loading
// the library, especially over a slower connection. Only wraps
// res.json() specifically, so it can never interfere with video
// streaming (which writes directly via res.writeHead/.pipe(), not
// res.json), keeping this safe to apply globally.
const zlib = require('zlib');
const https = require('https');
app.use((req, res, next) => {
  // Baseline browser protections: stop MIME-sniffing responses into
  // executable types, stop other sites embedding this one in frames
  // (clickjacking), and don't leak full URLs to external sites a user
  // might click out to. HSTS (HTTPS only) tells browsers to never try
  // plain HTTP for this host again.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (httpsActive) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  // Content-Security-Policy: script-src has no exceptions - every script
  // must come from this same server, full stop, which blocks the most
  // dangerous class of injected-content attack outright. style-src needs
  // 'unsafe-inline' because the UI is built with inline style attributes
  // throughout (a real limitation, not an oversight) - CSS injection is a
  // much lower-severity risk than script injection, so this is a
  // deliberate, honest trade-off rather than a gap. img-src allows data:
  // for the avatar upload preview flow.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://www.gstatic.com", // Google Cast remains optional; HLS and ASS assets are served locally.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // Google Fonts stylesheet
    "font-src 'self' https://fonts.gstatic.com", // Google Fonts actual font files (a different host than the stylesheet above)
    "img-src 'self' data:",
    "media-src 'self' blob:", // blob: is required for hls.js, which uses Media Source Extensions internally (a blob: URL as video.src) rather than the playlist URL directly - without this the browser blocks its own video element from loading what hls.js prepared
    "connect-src 'self'", // hls.js's own source map fetch - cosmetic only (doesn't affect actual script execution), but avoids confusing console noise
    "worker-src 'self' blob:", // hls.js creates a Web Worker via a blob: URL for fragment parsing - without this, the browser falls back to script-src (which also lacks blob:), silently blocking the worker and failing every fragment parse
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
  next();
});

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    const body = JSON.stringify(data);
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (acceptEncoding.includes('gzip') && body.length > 1024) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Vary', 'Accept-Encoding');
      return res.end(zlib.gzipSync(body));
    }
    return originalJson(data);
  };
  next();
});

// ---------- Static frontend ----------
// Cache-busting note: JS/CSS get a short cache window (revalidated
// often) so a server update is picked up quickly rather than a browser
// silently running stale code for a long time; images use a longer one
// since they change far less often.
// Gzip for the app's own text assets (JS/CSS/SVG/HTML) - the JSON
// middleware above doesn't cover static files, so the frontend itself
// (a couple hundred KB of JS+CSS by now) was shipping uncompressed on
// every first load and every cache revalidation. Compressed once per
// file version (keyed by mtime) and kept in memory, so repeat requests
// cost nothing - measured ~72% smaller over the wire.
const staticGzipCache = new Map(); // filePath -> { mtimeMs, gz }
app.use((req, res, next) => {
  if (req.method !== 'GET' || !/\.(js|css|svg|html)$/i.test(req.path)) return next();
  if (!(req.headers['accept-encoding'] || '').includes('gzip')) return next();
  const filePath = path.join(BASE_DIR, 'public', path.normalize(req.path).replace(/^([.][.][/\\])+/, ''));
  if (!isWithin(path.join(BASE_DIR, 'public'), filePath)) return next(); // traversal guard
  let stat;
  try { stat = fs.statSync(filePath); } catch (e) { return next(); }
  if (!stat.isFile()) return next();
  let entry = staticGzipCache.get(filePath);
  if (!entry || entry.mtimeMs !== stat.mtimeMs) {
    entry = { mtimeMs: stat.mtimeMs, gz: zlib.gzipSync(fs.readFileSync(filePath)) };
    staticGzipCache.set(filePath, entry);
  }
  const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' };
  res.setHeader('Content-Type', types[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Cache-Control', 'no-cache'); // Revalidate compressed app assets, too.
  res.end(entry.gz);
});

app.use(express.static(path.join(BASE_DIR, 'public'), {
  maxAge: '1h',
  // The custom catch-all route below (not this static middleware) is
  // what serves index.html - it injects a version query param into
  // each local script/stylesheet reference, which needs to run on
  // every request rather than being served as a raw static file.
  // Without this, static's own default index-file behavior would
  // intercept "/" before that route ever got a chance to run.
  index: false,
  setHeaders: (res, filePath) => {
    if (/\.(png|jpg|jpeg|svg|webp|ico)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
    // The app's own JS/CSS change on every update - the blanket 1-hour
    // cache above repeatedly meant a device kept running stale,
    // pre-update code well after a real fix had already been shipped
    // and deployed, which has caused genuine confusion diagnosing
    // several issues. no-cache still lets the browser cache the file,
    // but forces it to check with the server first (a fast 304 if it
    // genuinely hasn't changed) - so an actual update is never missed
    // without giving up the efficiency of caching entirely.
    else if (/\.(js|css|html)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '1d' }));
app.use('/avatar-gallery', express.static(path.join(DATA_DIR, 'avatar-gallery'), { maxAge: '1d' }));

// ================== AUTH HELPERS ==================
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; }
  });
  return out;
}

function getAccountFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return accountsStore.getAccountByToken(token);
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}; SameSite=Lax${(httpsActive || services.get().publicUrl.startsWith('https:')) ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${(httpsActive || services.get().publicUrl.startsWith('https:')) ? '; Secure' : ''}`);
}

// Every account can browse/watch/read; only 'admin' accounts can manage
// the media library and site settings. Call requireAuth first in a
// handler, bail out if it returns null (it already sent the response).
function requireAuth(req, res) {
  const account = getAccountFromRequest(req);
  if (!account) {
    res.status(401).json({ error: 'Not signed in' });
    return null;
  }
  return account;
}
function requireAdmin(req, res) {
  const account = requireAuth(req, res);
  if (!account) return null;
  if (account.role !== 'admin') {
    res.status(403).json({ error: 'This action requires an admin account' });
    return null;
  }
  return account;
}

const services = require('./services').createServices(DATA_DIR);
require('./identity').registerIdentity(app, { db, accounts: accountsStore, services, requireAuth, setSessionCookie, getConfig: () => config });
require('./live-tv').registerLive(app, { db, requireAuth, getLibrary: () => library, getStreamInfo });
require('./library-actions').registerLibraryActions(app, { db, requireAuth, getLibrary: () => library, publicOrigin: () => services.get().publicUrl });
require('./public-profiles').registerPublicProfiles(app, { db, requireAuth, getLibrary: () => library, publicOrigin: () => services.get().publicUrl });
require('./passkeys').registerPasskeys(app, { db, requireAuth, accounts: accountsStore, services, setSessionCookie });
require('./experience').registerExperience(app, { db, requireAuth, publicOrigin: () => services.get().publicUrl });
require('./account-data').registerAccountData(app, { db, requireAuth, accounts: accountsStore, publicOrigin: () => services.get().publicUrl });
require('./tv-devices').registerTVDevices(app, { db, requireAuth, publicOrigin: () => services.get().publicUrl });
require('./discovery-plus').registerDiscoveryPlus(app, { db, requireAuth, getLibrary: () => library, publicOrigin: () => services.get().publicUrl });
const integrationSecrets = require('./private-settings').createPrivateSettings(DATA_DIR);
require('./trackers').registerTrackers(app, { db, requireAuth, accounts: accountsStore, services, secrets: integrationSecrets, getLibrary: () => library });
const notificationDelivery = require('./notification-delivery').registerNotificationDelivery(app, { db, requireAuth, services, secrets: integrationSecrets, notifications, getLibrary: () => library });
require('./watch-activity').registerWatchActivity(app, { db, requireAuth, services, getLibrary: () => library });
require('./episode-discussions')(app, { db, requireAuth, getShow: id => require('./library-actions').discussionContent(library,id) });

// ================== AUTH ROUTES ==================
// Public: tells the login screen how many accounts exist yet (so it can
// show "Create the first (admin) account" vs a normal login form) plus
// branding, without requiring a session.
app.get('/api/auth/status', (req, res) => {
  const account = getAccountFromRequest(req);
  res.json({
    authenticated: !!account,
    account,
    hasAnyAccounts: accountsStore.accountCount() > 0,
    allowSelfRegistration: !!config.allowSelfRegistration,
    siteName: config.siteName,
    theme: config.theme,
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password, wantsAdultContent } = req.body || {};
  const isFirstAccount = accountsStore.accountCount() === 0;
  let selfRegistered = false;
  // Once an admin account exists, further registration must normally be
  // approved by an admin (from the Manage Accounts screen) - unless the
  // admin has explicitly opted into open self-registration, in which
  // case anyone can create their own account directly from the login
  // page, but always as a plain 'user', never as an admin regardless of
  // what they put in the request body - that distinction only applies
  // to an admin creating an account on someone else's behalf below.
  if (!isFirstAccount) {
    const requester = getAccountFromRequest(req);
    const requesterIsAdmin = requester && requester.role === 'admin';
    if (!requesterIsAdmin) {
      if (!config.allowSelfRegistration) {
        return res.status(403).json({ error: 'Only an admin can create additional accounts. Ask them to add you from Settings \u2192 Manage Accounts.' });
      }
      selfRegistered = true;
    }
  }
  try {
    const needsApproval = selfRegistered && !!config.requireApprovalForSelfRegistration;
    const account = await accountsStore.createAccount({
      username, password,
      role: selfRegistered ? 'user' : (req.body || {}).role,
      approved: !needsApproval,
      adultContentAllowed: wantsAdultContent !== false,
      registrationPolicy: { admin: getAccountFromRequest(req)?.role === "admin", allow: !!config.allowSelfRegistration, approval: !!config.requireApprovalForSelfRegistration },
    });
    if (account.approved && (isFirstAccount || selfRegistered)) {
      const token = accountsStore.createSession(account.id, req.headers['user-agent']);
      setSessionCookie(res, token);
    }
    res.status(201).json({ account, pendingApproval: !account.approved });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password, totpCode } = req.body || {};
  try {
    accountsStore.checkLoginAllowed(username);
  } catch (e) {
    return res.status(429).json({ error: e.message });
  }
  let account;
  try {
    account = await accountsStore.verifyPassword({ username, password, totpCode });
  } catch (e) {
    if (e.pendingApproval) return res.status(403).json({ error: e.message });
    if (e.requiresTotp) return res.status(200).json({ requiresTotp: true });
    throw e;
  }
  if (!account) {
    accountsStore.recordLoginFailure(username);
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  accountsStore.recordLoginSuccess(username);
  const token = accountsStore.createSession(account.id, req.headers['user-agent']);
  setSessionCookie(res, token);
  res.json({ account });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) accountsStore.destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- Two-factor authentication (self-service, per account) ----------
app.get('/api/auth/2fa/status', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  res.json(accountsStore.getTotpStatus(account.id));
});

app.post('/api/auth/2fa/setup', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    res.json(accountsStore.beginTotpSetup(account.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/auth/2fa/confirm', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    const backupCodes = accountsStore.confirmTotpSetup(account.id, (req.body || {}).code);
    res.json({ backupCodes });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/auth/2fa/disable', async (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    await accountsStore.disableTotp(account.id, (req.body || {}).password);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/auth/adult-content', async (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const allowed = (req.body || {}).allowed !== false;
  try {
    res.json(await accountsStore.setAdultContentAllowed(account.id, allowed, (req.body || {}).password));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- QR code pairing (sign in a new device without typing) ----------
// Public: any device can request a pairing code to display as a QR.
app.post('/api/auth/qr/start', (req, res) => {
  res.json(qrPairing.startPairing());
});

// Public, polled by the waiting device. Sets the session cookie directly
// on this response once approved, so the polling device is simply signed
// in the moment it sees the status flip - no extra round trip needed.
app.get('/api/auth/qr/:code/status', (req, res) => {
  const status = qrPairing.getStatus(req.params.code);
  if (status.status === 'approved') {
    const result = qrPairing.consumeApproval(req.params.code);
    if (result) {
      accountsStore.setSessionUserAgent(result.sessionToken, req.headers['user-agent']);
      setSessionCookie(res, result.sessionToken);
      const account = accountsStore.getAccount(result.accountId);
      return res.json({ status: 'approved', account });
    }
  }
  res.json(status);
});

// Requires the approving device to already be signed in.
app.post('/api/auth/qr/:code/approve', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    qrPairing.approve(req.params.code, account.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/auth/qr/:code/deny', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  qrPairing.deny(req.params.code);
  res.json({ ok: true });
});

app.put('/api/auth/password', async (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const { oldPassword, newPassword } = req.body || {};
  try {
    const currentToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    await accountsStore.changePassword(account.id, oldPassword, newPassword, currentToken);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Admin-only: reset another account's password without knowing the old
// one - the only recovery path on a self-hosted server with no email
// system, for when someone forgets theirs.
app.post('/api/accounts/:id/reset-password', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    await accountsStore.adminResetPassword(req.params.id, (req.body || {}).newPassword);
    console.log(`[settings] password reset for account ${req.params.id} by admin "${admin.username}"`);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/accounts/:id/restrict-adult-content', (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  console.log(`[settings] mature content restricted for account ${req.params.id} by admin "${admin.username}"`);
  res.json(accountsStore.adminRestrictAdultContent(req.params.id));
});


// ---------- Session management ("what devices am I signed in on") ----------
app.get('/api/auth/sessions', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const currentToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  res.json(accountsStore.listSessions(account.id, currentToken));
});

app.delete('/api/auth/sessions/:id', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  accountsStore.revokeSession(account.id, req.params.id);
  res.json({ ok: true });
});

app.post('/api/auth/sessions/revoke-others', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const currentToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  accountsStore.revokeAllSessions(account.id, currentToken);
  res.json({ ok: true });
});


// ---------- Account management (admin only) ----------
app.get('/api/accounts', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(accountsStore.listAccounts());
});

app.put('/api/accounts/:id/role', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(accountsStore.setRole(req.params.id, (req.body || {}).role));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/accounts/:id/approve', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(accountsStore.approveAccount(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/accounts/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    accountsStore.deleteAccount(req.params.id);
    profilesStore.deleteAllForAccount(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ================== Notifications (admin posts, everyone reads) ==================
app.get('/api/notifications', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const profile = profilesStore.getActiveProfile(account.id);
  if (!profile) return res.json([]);
  res.json(notifications.listForProfile(profile.id));
});

app.post('/api/notifications', (req, res) => {
  const account = requireAdmin(req, res);
  if (!account) return;
  try {
    const n = notifications.create({ title: (req.body || {}).title, message: (req.body || {}).message, createdBy: account.id });
    console.log(`[notification] "${n.title}" posted by admin "${account.username}"`);
    res.status(201).json(n);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/notifications/:id', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  if (account.role === 'admin') {
    notifications.remove(req.params.id);
    return res.json({ ok: true });
  }
  // Not an admin - can only remove their own targeted notification (a
  // personal new-episode alert, not a site-wide announcement).
  // removeOwnTargeted is scoped by profile_id, so this can never touch
  // someone else's notification or a site-wide one.
  const profile = profilesStore.getActiveProfile(account.id);
  if (!profile) return res.status(404).json({ error: 'No active profile' });
  notifications.removeOwnTargeted(profile.id, req.params.id);
  res.json({ ok: true });
});

app.post('/api/notifications/:id/read', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const profile = profilesStore.getActiveProfile(account.id);
  if (profile) notifications.markRead(profile.id, req.params.id);
  res.json({ ok: true });
});

app.post('/api/notifications/read-all', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const profile = profilesStore.getActiveProfile(account.id);
  if (profile) notifications.markAllRead(profile.id);
  res.json({ ok: true });
});

// ================== Config / settings (admin manages, anyone signed-in can read) ==================
app.get('/api/config', (req, res) => {
  if (!requireAuth(req, res)) return;
  const account = getAccountFromRequest(req);
  if (account && account.role === 'admin') return res.json(config);
  // Non-admin accounts get everything except the Jellyfin API key,
  // which is a genuine access credential to the user's Jellyfin
  // server, not a client id or other value that's fine to expose
  // broadly.
  const { jellyfinApiKey, ...redacted } = config;
  res.json(redacted);
});

app.get('/api/hwaccel-status', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(hwaccelLib.detectHwAccel(config.hardwareAcceleration));
});

app.post('/api/watch-party/create', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { showId, relPath } = req.body || {};
  if (!showId || !relPath) return res.status(400).json({ error: 'showId and relPath are required' });
  if (typeof showId !== 'string' || typeof relPath !== 'string' || !library.resolveEpisodeFile(showId, relPath)) return res.status(404).json({ error: 'Episode not found' });
  const roomCode = watchParty.createRoom(showId, relPath, getAccountFromRequest(req).id);
  res.json({ roomCode });
});

app.get('/api/watch-party/:code', (req, res) => {
  if (!requireAuth(req, res)) return;
  const info = watchParty.getRoomInfo(req.params.code.toUpperCase());
  if (!info) return res.status(404).json({ error: 'That watch party code was not found - it may have ended.' });
  res.json(info);
});

// Distinguishes "not configured at all" from the specific, common trap
// of "configured, and the cert files genuinely exist on disk, but this
// server process was already running before that happened, so it's
// still silently serving plain HTTP until restarted" - httpsActive is
// only ever computed once, at startup, from whatever config.https
// pointed at then. Without this, there was no way to tell these two
// very different situations apart from inside the app at all.
app.get('/api/https-status', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const certPath = config.https && config.https.certPath;
  const keyPath = config.https && config.https.keyPath;
  const configured = !!(certPath && keyPath);
  const filesExist = configured && fs.existsSync(certPath) && fs.existsSync(keyPath);
  res.json({
    active: httpsActive,
    configured,
    filesExist,
    // Genuinely means "restart to pick this up" - the files are there
    // and pointed at correctly, this process just hasn't loaded them.
    needsRestart: !httpsActive && configured && filesExist,
    certPath: certPath || null,
  });
});

app.get('/api/admin/cache-status', (req, res) => {
  if (!requireAdmin(req, res)) return;
  let usedBytes = 0;
  try {
    if (fs.existsSync(STREAM_CACHE_DIR)) {
      for (const f of fs.readdirSync(STREAM_CACHE_DIR)) {
        if (f.endsWith('.mp4') && !f.includes('.tmp') && !f.includes('.rawtap')) {
          usedBytes += fs.statSync(path.join(STREAM_CACHE_DIR, f)).size;
        }
      }
    }
  } catch (e) { /* best-effort */ }
  res.json({ usedGB: usedBytes / 1024 ** 3, limitGB: config.maxStreamCacheGB || 15 });
});

// ================== Backups ==================
// The database is the one irreplaceable thing here - media files are
// your own copies and every cache rebuilds itself, but accounts,
// profiles, and watch history exist nowhere else. VACUUM INTO is the
// only safe way to snapshot a live WAL-mode SQLite database (a plain
// file copy can miss recent writes still sitting in the WAL file); it
// also compacts the copy. Keeps the last 7, runs automatically once a
// day, and can be triggered/downloaded from the Admin Dashboard.
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const CAST_CACHE_DIR = path.join(DATA_DIR, 'cast-cache');
const CAST_IMAGES_DIR = path.join(DATA_DIR, 'cast-images');
const SERIES_LOGOS_DIR = path.join(DATA_DIR, 'series-logos');

// Posters and banners are always downloaded locally and served from
// this same server - never linked directly to AniList's own CDN -
// specifically because the CSP's img-src only allows 'self' and
// data:, so a raw external image URL gets silently blocked by the
// browser. Cast/staff photos hadn't been following that same
// established pattern - they were just handed back as-is, a raw
// AniList CDN URL, which is the actual, confirmed cause of no cast
// photos ever appearing at all. This brings them in line: download
// each once (keyed by personId, so the same person appearing across
// multiple shows' cast lists is only ever fetched once, not once per
// show) and rewrite to a local, CSP-compliant path before this data
// is ever cached or handed back to the frontend.
async function localizeCastImages(people) {
  fs.mkdirSync(CAST_IMAGES_DIR, { recursive: true });
  for (const p of people) {
    if (!p.personId || !p.image) continue;
    const localPath = path.join(CAST_IMAGES_DIR, `${p.personId}.jpg`);
    if (!fs.existsSync(localPath)) {
      try { await mal.downloadImage(p.image, localPath); } catch (e) { continue; } // leave p.image as the (CSP-blocked) original URL rather than a broken local link - a real remote image slipping through kids-mode-style isn't a concern here, this is the exact same trusted AniList CDN posters/banners already come from
    }
    p.image = `/api/cast-image/${p.personId}`;
  }
  return people;
}

app.get('/api/cast-image/:personId', (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!/^\d+$/.test(req.params.personId)) return res.status(400).end();
  const imgPath = path.join(CAST_IMAGES_DIR, `${req.params.personId}.jpg`);
  if (!fs.existsSync(imgPath)) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(imgPath).pipe(res);
});

// Cast & Production - only available for titles imported from AniList
// (its public API has this data; MAL's doesn't expose it as readily),
// cached to disk once per title since this rarely changes and there's
// no reason to re-hit AniList's API on every single page visit.
app.get('/api/anime/:id/cast', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const show = library.getShow(req.params.id);
  if (!show) return res.status(404).json({ error: 'Not found' });
  if (!show.anilistId) return res.json({ cast: [], staff: [], available: false });

  const cachePath = path.join(CAST_CACHE_DIR, `${show.anilistId}-v3.json`);
  if (fs.existsSync(cachePath)) {
    try { return res.json({ ...JSON.parse(fs.readFileSync(cachePath, 'utf-8')), available: true }); } catch (e) { /* fall through and refetch */ }
  }
  try {
    const result = await anilist.getCastAndStaff(show.anilistId);
    await localizeCastImages([...result.cast, ...result.staff]);
    fs.mkdirSync(CAST_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(result));
    res.json({ ...result, available: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Reuses series logo artwork from a Jellyfin server already running
// on the same machine/network, rather than needing a whole separate
// metadata source just for this one piece of art - see jellyfin.js.
// Checked once per show (jellyfin_logo_cache) rather than querying
// Jellyfin on every title page load.
app.get('/api/anime/:id/series-logo', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const show = library.getShow(req.params.id);
  if (!show) return res.status(404).json({ error: 'Not found' });
  if (!config.jellyfinServerUrl || !config.jellyfinApiKey) {
    console.log(`[jellyfin-logo] "${show.title}" - request received, but Jellyfin isn't configured (server URL and/or API key missing in Settings) - skipping`);
    return res.status(404).json({ available: false });
  }

  const logoPath = path.join(SERIES_LOGOS_DIR, `${show.id}.png`);
  const forceRefresh = req.query.refresh === '1';
  if (forceRefresh) {
    const account = getAccountFromRequest(req);
    if (!account || account.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    console.log(`[jellyfin-logo] "${show.title}" - forced recheck requested, clearing any cached result`);
    clearSeriesLogoCache(show.id);
  }
  const cached = forceRefresh ? null : getSeriesLogoCache(show.id, show.title);
  if (cached === false) {
    console.log(`[jellyfin-logo] "${show.title}" - already checked before and no logo was found then, using that cached result rather than re-checking`);
    return res.status(404).json({ available: false });
  }
  if (cached === true && fs.existsSync(logoPath)) {
    res.setHeader('Content-Type', 'image/png');
    return fs.createReadStream(logoPath).pipe(res);
  }

  console.log(`[jellyfin-logo] "${show.title}" - checking Jellyfin for the first time...`);
  fs.mkdirSync(SERIES_LOGOS_DIR, { recursive: true });
  const found = await jellyfin.fetchLogoForTitle(config.jellyfinServerUrl, config.jellyfinApiKey, show.title, logoPath);
  setSeriesLogoCache(show.id, found, show.title);
  if (!found) return res.status(404).json({ available: false });
  res.setHeader('Content-Type', 'image/png');
  fs.createReadStream(logoPath).pipe(res);
});

// Real per-episode titles for the episode grid - only available for
// titles imported from AniList (same reasoning as Cast & Production),
// cached the same way so repeat visits don't re-hit AniList's API.
app.get('/api/anime/:id/episode-titles', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const show = library.getShow(req.params.id);
  if (!show) return res.status(404).json({ error: 'Not found' });
  if (!show.anilistId) return res.json({ episodes: [], available: false });

  const cachePath = path.join(CAST_CACHE_DIR, `${show.anilistId}-episodes.json`);
  if (fs.existsSync(cachePath)) {
    try { return res.json({ episodes: JSON.parse(fs.readFileSync(cachePath, 'utf-8')), available: true }); } catch (e) { /* fall through and refetch */ }
  }
  try {
    const episodes = await anilist.getStreamingEpisodeTitles(show.anilistId);
    fs.mkdirSync(CAST_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(episodes));
    res.json({ episodes, available: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Sequels, prequels, side stories, and spin-offs - only available for
// titles imported from AniList (same reasoning as Cast & Production),
// cached the same way. Each related title gets matched against the
// local library by anilistId, so the frontend can link straight to one
// the person already has, or clearly show one they don't.
app.get('/api/anime/:id/related', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const show = library.getShow(req.params.id);
  if (!show) return res.status(404).json({ error: 'Not found' });
  if (!show.anilistId) return res.json({ related: [], available: false });

  const cachePath = path.join(CAST_CACHE_DIR, `${show.anilistId}-related.json`);
  let related;
  if (fs.existsSync(cachePath)) {
    try { related = JSON.parse(fs.readFileSync(cachePath, 'utf-8')); } catch (e) { /* fall through and refetch */ }
  }
  if (!related) {
    try {
      related = await anilist.getRelations(show.anilistId);
      fs.mkdirSync(CAST_CACHE_DIR, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(related));
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }
  const withLocalMatch = related.map((r) => {
    const localShow = library.cache.anime.find((s) => s.anilistId === r.anilistId);
    return { ...r, localShowId: localShow ? localShow.id : null };
  });
  res.json({ related: withLocalMatch, available: true });
});

// A specific person's (voice actor or staff) full body of work, matched
// against the local library the same way related shows are - lets
// tapping a name in Cast & Production show everything else by that
// exact person, not just anyone sharing their name.
app.get('/api/person/:personId/credits', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const cachePath = path.join(CAST_CACHE_DIR, `person-${req.params.personId}.json`);
  let data;
  if (fs.existsSync(cachePath)) {
    try { data = JSON.parse(fs.readFileSync(cachePath, 'utf-8')); } catch (e) { /* fall through and refetch */ }
  }
  if (!data) {
    try {
      data = await anilist.getPersonCredits(req.params.personId);
      fs.mkdirSync(CAST_CACHE_DIR, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(data));
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }
  const withLocalMatch = data.credits.map((c) => {
    const localShow = library.cache.anime.find((s) => s.anilistId === c.anilistId);
    return { ...c, localShowId: localShow ? localShow.id : null };
  }).filter((c) => c.localShowId); // only ever show credits the person actually has in their library - a list mostly full of titles they don't own isn't useful here
  res.json({ name: data.name, credits: withLocalMatch });
});

const BACKUP_KEEP = 7;

function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs.readdirSync(BACKUPS_DIR)
    .filter((f) => /^io-backup-[\d-]+\.db$/.test(f))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, f));
      return { file: f, sizeBytes: stat.size, createdAt: stat.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function createBackup() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  // Millisecond precision plus a uniqueness loop: two backups landing in
  // the same second (e.g. the startup auto-backup and an admin clicking
  // the button right after boot) previously collided on the filename,
  // and VACUUM INTO refuses to overwrite - so the second backup failed
  // entirely. Proven in testing, not hypothetical.
  let target;
  for (let attempt = 0; ; attempt++) {
    const stamp = new Date(Date.now() + attempt).toISOString().replace(/[:T.]/g, '-').replace('Z', '');
    target = path.join(BACKUPS_DIR, `io-backup-${stamp}.db`);
    if (!fs.existsSync(target)) break;
  }
  if (target.includes("'")) throw new Error('invalid backup path'); // SQL string safety - can't happen with our naming, but cheap to guarantee
  db.exec(`VACUUM INTO '${target}'`);
  for (const b of listBackups().slice(BACKUP_KEEP)) {
    fs.unlink(path.join(BACKUPS_DIR, b.file), () => {});
  }
  return target;
}

function autoBackupIfDue() {
  try {
    const newest = listBackups()[0];
    if (newest && Date.now() - newest.createdAt < 24 * 60 * 60 * 1000) return;
    const target = createBackup();
    console.log(`[backup] automatic daily backup written: ${path.basename(target)}`);
  } catch (e) {
    console.error(`[backup] automatic backup failed: ${e.message}`);
  }
}

app.post('/api/admin/backup', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const target = createBackup();
    res.json({ ok: true, file: path.basename(target) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/backups', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(listBackups());
});

app.get('/api/admin/backup-download/:file', (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!/^io-backup-[\d-]+\.db$/.test(req.params.file)) return res.status(400).end();
  const p = path.join(BACKUPS_DIR, req.params.file);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.file}"`);
  fs.createReadStream(p).pipe(res);
});

// ================== Admin dashboard ==================
gpuHealth.start();
app.post('/api/playback/metrics', (req, res) => {
  const account = requireAuth(req, res); if (!account) return;
  try { playbackMetrics.record(account.id, req.body); res.json({ ok: true }); }
  catch (error) { res.status(error.status || 400).json({ error: error.message }); }
});
app.get('/api/admin/health', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const current = scanningLibrary || library;
  res.json({ scanning: scanPromise !== null,
    drives: ['anime', 'movies', 'manga'].map(kind => ({ kind, path: current[kind === 'movies' ? 'movieRoot' : kind + 'Root'], ...current.scanStatus[kind], titles: library.cache[kind].length })),
    gpu: { encoder: hwaccelLib.detectHwAccel(config.hardwareAcceleration), ...gpuHealth.getStatus() },
    transcode: transcodeLimiter.getStatus(), mediaIO: { ...mediaIO.getStatus(), streams: mediaStream.getStatus() }, playback: playbackMetrics.summary() });
});

app.get('/api/admin/system-stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ...systemStats.getStats(), transcode: transcodeLimiter.getStatus() });
});

app.get('/api/admin/sessions', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const currentToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  res.json(accountsStore.listAllSessions(currentToken));
});

app.delete('/api/admin/sessions/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  accountsStore.revokeSessionById(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/needs-attention', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ items: needsAttention, enrichmentRunning });
});

app.post('/api/admin/retry-enrichment', (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (config.metadataSource !== 'anilist' && !config.malClientId) return res.status(400).json({ error: 'No MyAnimeList Client ID configured. Add one in Settings, or switch the metadata source to AniList (needs no key).' });
  if (enrichmentRunning) return res.status(409).json({ error: 'Enrichment is already running.' });
  res.json({ ok: true, started: true });
  autoEnrichLibrary(); // fire-and-forget, response already sent
});

// Manually triggers a pass that fills in specific metadata gaps
// (studio and cast lists) on titles that are already matched to
// MAL/AniList but are missing one or both - separate from the main
// "find a match at all" enrichment above, which only looks at titles
// with no match yet.
app.post('/api/admin/fill-missing-metadata', (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (metadataBackfillRunning || enrichmentRunning) return res.status(409).json({ error: 'Enrichment is already running.' });
  backfillMissingMetadata().then((result) => {
    if (!result.started) console.log(`[metadata-backfill] not started: ${result.reason}`);
  });
  res.json({ ok: true, started: true });
});

// Finds shows that are very likely duplicates of each other - the same
// series scanned into more than one folder, usually from a rename, a
// re-download, or a folder that never got merged with an existing one.
// Groups by the strongest available signal first (matching AniList or
// MAL id is close to certain proof), falling back to a normalized
// title match only for whatever's left over - important since a lot
// of real libraries have plenty of titles that never matched MAL or
// AniList at all (nothing to compare by id for those), and a pair
// already caught by a reliable id match shouldn't also show up again
// under the much weaker title-similarity signal.
app.get('/api/admin/duplicate-series', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const shows = [...library.cache.anime, ...library.cache.movies];

  function normalizeTitle(title) {
    return (title || '').trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  const covered = new Set();
  const groups = [];
  function addGroups(keyFn, matchType) {
    const map = new Map();
    for (const show of shows) {
      if (covered.has(show.id)) continue;
      const key = keyFn(show);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(show);
    }
    for (const group of map.values()) {
      if (group.length < 2) continue;
      groups.push({
        matchType,
        shows: group.map((s) => ({ id: s.id, title: s.title, folderName: unslugify(s.id), anilistId: s.anilistId, malId: s.malId })),
      });
      for (const s of group) covered.add(s.id);
    }
  }
  addGroups((s) => s.anilistId, 'anilistId');
  addGroups((s) => s.malId, 'malId');
  addGroups((s) => normalizeTitle(s.title), 'title');

  res.json({ groups });
});

app.post('/api/admin/bulk-genre', async (req, res) => {
  const account = requireAdmin(req, res);
  if (!account) return;
  const { items, genre, action } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No titles selected' });
  if (!genre || !genre.trim()) return res.status(400).json({ error: 'Genre is required' });
  if (!['add', 'remove'].includes(action)) return res.status(400).json({ error: 'action must be "add" or "remove"' });

  let updated = 0;
  const failed = [];
  for (const item of items) {
    try {
      const dir = item.type === 'manga' ? library.getMangaDir(item.id) : library.getShowDir(item.id);
      if (!dir) { failed.push(item.id); continue; }
      const infoPath = path.join(dir, 'info.json');
      const existing = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf-8')) : {};
      const genres = new Set(existing.genres || []);
      if (action === 'add') genres.add(genre.trim());
      else genres.delete(genre.trim());
      const merged = { ...existing, genres: [...genres] };
      fs.writeFileSync(infoPath, JSON.stringify(merged, null, 2));
      updated++;
    } catch (e) {
      failed.push(item.id);
    }
  }
  await scanLibrary();
  console.log(`[bulk-genre] admin "${account.username}" ${action === 'add' ? 'added' : 'removed'} "${genre}" ${action === 'add' ? 'to' : 'from'} ${updated} title(s)`);
  res.json({ ok: true, updated, failed: failed.length });
});

app.put('/api/config', async (req, res) => {
  const account = requireAdmin(req, res);
  if (!account) return;
  const { siteName, theme, malClientId, jellyfinServerUrl, jellyfinApiKey, preferEnglishTitles, hardwareAcceleration, maxStreamCacheGB, mediaPaths, libraryScanTimeoutSec, autoScanIntervalMinutes, metadataSource, allowSelfRegistration, requireApprovalForSelfRegistration } = req.body || {};
  if (siteName) config.siteName = siteName;
  if (theme) config.theme = { ...config.theme, ...theme };
  if (malClientId !== undefined) config.malClientId = malClientId;
  if (jellyfinServerUrl !== undefined) config.jellyfinServerUrl = jellyfinServerUrl;
  if (jellyfinApiKey !== undefined) config.jellyfinApiKey = jellyfinApiKey;
  if (preferEnglishTitles !== undefined) config.preferEnglishTitles = !!preferEnglishTitles;
  if (hardwareAcceleration !== undefined) {
    config.hardwareAcceleration = !!hardwareAcceleration;
    transcodeLimiter.setHardwareAccelActive(hwaccelLib.detectHwAccel(config.hardwareAcceleration).type !== 'none');
  }
  if (allowSelfRegistration !== undefined) config.allowSelfRegistration = !!allowSelfRegistration;
  if (requireApprovalForSelfRegistration !== undefined) config.requireApprovalForSelfRegistration = !!requireApprovalForSelfRegistration;
  if (maxStreamCacheGB !== undefined && !isNaN(parseFloat(maxStreamCacheGB))) config.maxStreamCacheGB = parseFloat(maxStreamCacheGB);
  if (libraryScanTimeoutSec !== undefined && !isNaN(parseInt(libraryScanTimeoutSec, 10))) config.libraryScanTimeoutSec = Math.max(10, parseInt(libraryScanTimeoutSec, 10));
  if (autoScanIntervalMinutes !== undefined && !isNaN(parseFloat(autoScanIntervalMinutes))) {
    const v = parseFloat(autoScanIntervalMinutes);
    config.autoScanIntervalMinutes = v <= 0 ? 0 : Math.max(0.5, v); // 0 turns the periodic check off; anything else is floored so a typo can't turn it into a constant hammering of the share
  }
  if (metadataSource === 'mal' || metadataSource === 'anilist') config.metadataSource = metadataSource;

  // Media folder changes: applied to the LIVE config file (the one in the
  // data folder - editing config.default.json in the project folder does
  // nothing after first run, a very easy mistake to make), the library is
  // rescanned from the new locations immediately, and the auto-rescan
  // watchers move to the new folders - no restart needed.
  let pathsChanged = false;
  const pathWarnings = [];
  if (mediaPaths && typeof mediaPaths === 'object') {
    for (const kind of ['anime', 'movies', 'manga']) {
      const raw = mediaPaths[kind];
      if (raw === undefined || typeof raw !== 'string') continue;
      const cleaned = raw.trim().replace(/\\/g, '/'); // tolerate pasted Windows paths - forward slashes work everywhere
      if (!cleaned || cleaned === config.mediaPaths[kind]) continue;
      const resolved = path.resolve(BASE_DIR, cleaned);
      pathWarnings.push(`${kind}: scanning ${resolved} in the background; availability and permissions are checked by the scanner.`);
      config.mediaPaths[kind] = cleaned;
      pathsChanged = true;
    }
  }

  if (req.body.transcodeLimits) {
    try { transcodeLimiter.configure(req.body.transcodeLimits); config.transcodeLimits = req.body.transcodeLimits; }
    catch (error) { return res.status(400).json({ error: error.message }); }
  }
  saveConfig(config);
  console.log(`[settings] updated by admin "${account.username}"`);
  if (pathsChanged) {
    scanLibrary(true).catch(error => console.error('[settings] library scan failed:', error));
    console.log('[settings] media folders changed - background scan started');
  }
  res.json({ ...config, pathWarnings, libraryScanInProgress: scanPromise !== null });
});

// Applies a MAL entry's poster/banner/synopsis/genres onto a show's folder
// (writes cover.jpg/banner.jpg/info.json). Shared by the manual "Import from
// MAL" button and the automatic post-rescan enrichment pass below.
// `useEnglishTitle` lets a single call override the site-wide default
// (config.preferEnglishTitles) - used by the manual search modal's toggle.
// Shared by both MAL and AniList imports - writes an already-fetched
// details object onto a show's info.json. Each source's own apply
// function fetches details its own way (different client, different ID
// field name to store) then hands off here for the actual disk write,
// so the two stay in sync without duplicating this logic.
function applyDetailsToShowDir(showDir, details, idField, id, useEnglishTitle) {
  const preferEnglish = useEnglishTitle !== undefined ? useEnglishTitle : config.preferEnglishTitles;
  const chosenTitle = (preferEnglish && details.englishTitle) ? details.englishTitle : details.title;
  const infoPath = path.join(showDir, 'info.json');
  const existing = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf-8')) : {};
  const merged = { ...existing, title: chosenTitle, description: details.description, year: details.year, genres: details.genres, studios: details.studios || [], rating: details.rating || existing.rating, [idField]: id };
  fs.writeFileSync(infoPath, JSON.stringify(merged, null, 2));
}

async function applyMalToShowDir(showDir, malId, useEnglishTitle) {
  const details = await mal.getDetails(malId, config.malClientId);
  if (details.coverUrl) {
    await mal.downloadImage(details.coverUrl, path.join(showDir, 'cover.jpg'));
  }
  // MAL's own "banner" is really just the last image in its promotional
  // picture gallery, which is usually another portrait poster - not a
  // genuine wide banner - so it looks visibly soft/blurry once stretched
  // across a full-width hero. AniList has an actual dedicated banner
  // field that's usually properly high-resolution when it exists - but
  // it's an optional field a lot of entries simply don't have, so
  // falling back to MAL's weak one whenever AniList's was empty still
  // left plenty of titles looking bad. AniList's own COVER art also
  // tends to be meaningfully higher resolution than MAL's, so that's
  // tried too before ever settling for MAL's own assets. None of this
  // touches the rest of MAL's own metadata (title, description, genres
  // all still come from MAL as normal), and a failure anywhere in this
  // lookup never blocks or fails the actual MAL import.
  //
  // This cross-reference (AniList's idMal field - an exact match, not
  // fuzzy title search) also gets stored as this show's anilistId, not
  // just used transiently for the banner - without it, a MAL-matched
  // show would never become eligible for Cast & Production (which
  // strictly requires an AniList id) no matter how many times the
  // studio/cast backfill runs, since MAL and AniList use entirely
  // separate id spaces for the same shows.
  let bannerUrl = null;
  let crossReferencedAnilistId = null;
  try {
    crossReferencedAnilistId = await anilist.lookupAnilistIdByMalId(malId, 'ANIME', 'high');
    if (crossReferencedAnilistId) {
      const anilistDetails = await anilist.getDetails(crossReferencedAnilistId, 'high');
      bannerUrl = anilistDetails.bannerUrl || anilistDetails.coverUrl || null;
    }
  } catch (e) { /* best-effort only - falls through to MAL's own assets below */ }
  if (!bannerUrl) bannerUrl = details.bannerUrl || details.coverUrl || null;
  if (bannerUrl) {
    await mal.downloadImage(bannerUrl, path.join(showDir, 'banner.jpg'));
  }
  applyDetailsToShowDir(showDir, details, 'malId', malId, useEnglishTitle);
  if (crossReferencedAnilistId) {
    const infoPath = path.join(showDir, 'info.json');
    const existing = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
    fs.writeFileSync(infoPath, JSON.stringify({ ...existing, anilistId: crossReferencedAnilistId }, null, 2));
  }
  return details;
}

// AniList needs no API key/Client ID at all for this, unlike MAL - see anilist.js.
async function applyAniListToShowDir(showDir, anilistId, useEnglishTitle) {
  const details = await anilist.getDetails(anilistId);
  if (details.coverUrl) {
    await anilist.downloadImage(details.coverUrl, path.join(showDir, 'cover.jpg'));
  }
  if (details.bannerUrl) {
    await anilist.downloadImage(details.bannerUrl, path.join(showDir, 'banner.jpg'));
  }
  applyDetailsToShowDir(showDir, details, 'anilistId', anilistId, useEnglishTitle);
  return details;
}

// Shared by both MAL and AniList manga imports - same idea as
// applyDetailsToShowDir above. Manga detail pages use a blurred cover as
// their background instead of a separate banner image, so there's no
// banner.jpg to write here.
function applyDetailsToMangaDir(titleDir, details, idField, id, useEnglishTitle) {
  const preferEnglish = useEnglishTitle !== undefined ? useEnglishTitle : config.preferEnglishTitles;
  const chosenTitle = (preferEnglish && details.englishTitle) ? details.englishTitle : details.title;
  const infoPath = path.join(titleDir, 'info.json');
  const existing = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf-8')) : {};
  const merged = { ...existing, title: chosenTitle, description: details.description, year: details.year, genres: details.genres, [idField]: id };
  fs.writeFileSync(infoPath, JSON.stringify(merged, null, 2));
}

async function applyMalToMangaDir(titleDir, malId, useEnglishTitle) {
  const details = await mal.getMangaDetails(malId, config.malClientId);
  if (details.coverUrl) {
    await mal.downloadImage(details.coverUrl, path.join(titleDir, 'cover.jpg'));
  }
  applyDetailsToMangaDir(titleDir, details, 'malId', malId, useEnglishTitle);
  return details;
}

async function applyAniListToMangaDir(titleDir, anilistId, useEnglishTitle) {
  const details = await anilist.getMangaDetails(anilistId);
  if (details.coverUrl) {
    await anilist.downloadImage(details.coverUrl, path.join(titleDir, 'cover.jpg'));
  }
  applyDetailsToMangaDir(titleDir, details, 'anilistId', anilistId, useEnglishTitle);
  return details;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let enrichmentRunning = false;

// Runs after a rescan: for any anime folder that has neither a cover image
// nor a description yet (i.e. nobody has set it up manually), search
// MyAnimeList by folder name and auto-apply the best match. Runs in the
// background so rescan/startup aren't blocked waiting on network calls, and
// is deliberately sequential with a short delay between shows to be a good
// API citizen rather than firing a burst of parallel requests.
// Compares the current scan against what was recorded last time, and
// posts an automatic notification for any title that gained new
// episodes/chapters and that someone is actually tracking (My List, Top
// Picks, or has watch progress on). Silent on the very first scan ever,
// so a fresh library doesn't fire a notification for everything in it.
function checkAndNotifyNewEpisodes() {
  notificationDelivery.checkSeasons();
  const changed = [
    ...episodeTracker.checkForNewEpisodes(
      library.cache.anime.map((s) => ({ id: s.id, title: s.title, episodeCount: s.episodeCount })), 'anime'),
    ...episodeTracker.checkForNewEpisodes(
      library.cache.movies.map((s) => ({ id: s.id, title: s.title, episodeCount: s.episodeCount })), 'movie'),
    ...episodeTracker.checkForNewEpisodes(
      library.cache.manga.map((m) => ({ id: m.id, title: m.title, episodeCount: m.chapterCount })), 'manga'),
  ];
  for (const item of changed) {
    const followers = getFollowingProfiles(item.id, item.itemType || 'anime');
    for (const profileId of followers) {
      try {
        notifications.create({
          title: `New Episode: ${item.title}`,
          message: `${item.addedCount} new ${item.addedCount === 1 ? 'episode/chapter is' : 'episodes/chapters are'} now available.`,
          createdBy: null,
          profileId,
          category:'episodes',
          link: `#/${item.itemType==='manga'?'manga':'title'}/${item.id}`,
        });
      } catch (e) {
        console.log(`[episode-tracker] failed to post notification for "${item.title}": ${e.message}`);
      }
    }
    if (followers.length > 0) console.log(`[episode-tracker] posted new-episode notification for "${item.title}" to ${followers.length} follower(s)`);
  }
}

// Watches the media folders and automatically rescans a little after
// something changes - copying in a new episode, renaming a folder, etc.
// Debounced (waits for changes to settle) since copying in a season's
// worth of files fires many individual filesystem events in a burst,
// and a rescan while a copy is still half-finished would just see a
// partial, temporary state.
let rescanDebounceTimer = null;
let rescanInProgress = false;
// Widened from an original 5s - real-world logs from a large library
// (1600+ titles) showed genuinely spaced-out changes, each rescan
// completing well before the next "change detected" fired, not just
// rapid bursts a short debounce already coalesces fine. Each of those
// separate rescans is a full pass over the whole library, and even
// though scanning itself runs in an isolated worker thread (not the
// main event loop - see the comment on scan() in library.js), it
// still competes for the same underlying disk/network I/O actual
// video playback needs, which that same file has already documented
// as a real, previously-observed source of contention on one real
// machine. Cutting how often a full rescan runs at all is the most
// direct way to reduce how often it's competing with playback for
// that shared I/O in the first place.
const RESCAN_DEBOUNCE_MS = 30000;

function scheduleAutoRescan(reason) {
  clearTimeout(rescanDebounceTimer);
  rescanDebounceTimer = setTimeout(async () => {
    if (rescanInProgress) { scheduleAutoRescan(reason); return; } // try again shortly rather than overlap
    rescanInProgress = true;
    try {
      console.log(`[auto-rescan] change detected (${reason}), rescanning...`);
      config = loadConfig();
      await scanLibrary();
      checkAndNotifyNewEpisodes();
      console.log(`[auto-rescan] done - ${library.cache.anime.length} anime, ${library.cache.movies.length} movies, ${library.cache.manga.length} manga`);
      if (Object.values(library.scanStatus).every(status => status.state === 'ready')) {
        autoEnrichLibrary().then(() => backfillMissingMetadata());
        checkMissingDubStatus();
      }
    } catch (e) {
      console.log(`[auto-rescan] failed: ${e.message}`);
    } finally {
      rescanInProgress = false;
    }
  }, RESCAN_DEBOUNCE_MS);
}

// Fallback for changes a file watcher can't see - notably new media
// copied onto a network share from another machine, which never
// produces an event on this one. Cheap timestamp/entry-count check on a
// timer (see library-change-detector.js); a real rescan only happens
// when something actually differs, through the same debounced path the
// file watcher uses, so new-episode notifications fire from it too.
changePoller = changeDetector.createChangePoller({
  getRoots: () => [
    { label: 'anime', dir: library.animeRoot },
    { label: 'movies', dir: library.movieRoot },
    { label: 'manga', dir: library.mangaRoot },
  ],
  getIntervalMs: () => Math.round((config.autoScanIntervalMinutes || 0) * 60 * 1000),
  isBusy: () => rescanInProgress || enrichmentRunning || scanPromise !== null,
  onChange: (changed, recovered) => {
    console.log(`[auto-rescan] periodic check found changes in: ${changed.join(', ')}${recovered.length ? ` (${recovered.join(', ')} reachable again)` : ''}`);
    // scanLibrary reattaches watchers after a successful recovery scan.
    scheduleAutoRescan(`periodic check: ${changed.join(', ')}`);
  },
  log: (msg) => console.log(`[auto-rescan] ${msg}`),
});

let activeWatchers = [];
function restartLibraryWatcher() {
  for (const w of activeWatchers) { try { w.close(); } catch (e) { /* already dead */ } }
  activeWatchers = [];
  startLibraryWatcher();
}

function startLibraryWatcher() {
  const roots = [
    { dir: library.animeRoot, label: 'anime' },
    { dir: library.movieRoot, label: 'movies' },
    { dir: library.mangaRoot, label: 'manga' },
  ];
  for (const { dir, label } of roots) {
    if (library.scanStatus[label]?.state !== 'ready') continue;
    try {
      const watcher = new (require('worker_threads').Worker)(path.join(__dirname, 'watch-worker.js'), { workerData: { dir } });
      watcher.close = () => { watcher.unref(); watcher.terminate().catch(() => {}); };
      watcher.on('message', ({ filename, error }) => {
        if (error) { console.log(`[auto-rescan] ${dir}: ${error}`); return; }
        // Metadata the app writes ITSELF (covers/banners/info.json from
        // MAL imports and enrichment) must not re-trigger scanning -
        // every flow that writes these already rescans on its own.
        // Without this filter, a full-library MAL sync becomes a
        // feedback loop: each downloaded cover tickles the watcher,
        // which schedules ANOTHER full rescan every few seconds for the
        // entire multi-minute sync - constant heavy disk I/O that makes
        // the whole site crawl (and time out) while it runs.
        if (filename && /(?:^|[\/\\])(info\.json|cover\.(jpg|jpeg|png|webp)|banner\.(jpg|jpeg|png|webp))$/i.test(filename)) return;
        // A tool like Plex scanning this same library folder writes its
        // own chapter-marker and preview-thumbnail artifacts directly
        // alongside the media (a ".chapters" subfolder, ".trickplay"
        // files) - this app's own trickplay cache lives entirely in its
        // separate data directory, never inside the media folders, so
        // these can only be a different tool's output. Confirmed
        // directly from repeated, otherwise-unexplained rescans in real
        // server logs - same reasoning as the exclusion right above.
        if (filename && /(?:^|[\/\\])\.chapters(?:[\/\\]|$)/i.test(filename)) return;
        if (filename && /\.trickplay$/i.test(filename)) return;
        if (enrichmentRunning) return; // enrichment ends with its own single rescan
        scheduleAutoRescan(`${label}${filename ? '/' + filename : ''}`);
      });
      activeWatchers.push(watcher);
      // Without this, a watcher error (folder removed, OS watch limits
      // hit, network drive hiccup) is an unhandled 'error' event - which
      // crashes the entire server process. Verified: it really does.
      // Auto-rescan for that folder just stops; manual rescan still works.
      watcher.on('error', (e) => {
        console.log(`[auto-rescan] watcher for ${dir} failed (${e.message}) - auto-rescan disabled for this folder, manual Rescan still works`);
      });
      console.log(`[auto-rescan] watching ${dir}`);
    } catch (e) {
      // Recursive fs.watch isn't supported on every platform/filesystem
      // (notably some Linux setups) - auto-rescan just won't fire for
      // that folder then, but the manual Rescan button always still works.
      console.log(`[auto-rescan] couldn't watch ${dir}: ${e.message}`);
    }
  }
}

// In-memory "why wasn't this enriched" list, rebuilt on each enrichment
// pass - powers the Needs Attention view so an admin doesn't have to dig
// through server console logs to see what MAL sync couldn't handle on
// its own.
let needsAttention = [];

async function autoEnrichLibrary() {
  const useAniList = config.metadataSource === 'anilist';
  if (enrichmentRunning || (!useAniList && !config.malClientId)) return;
  const animeCandidates = library.cache.anime.filter((s) => !s.cover && !s.description);
  const movieCandidates = library.cache.movies.filter((s) => !s.cover && !s.description);
  const mangaCandidates = library.cache.manga.filter((m) => !m.cover && !m.description);
  if (animeCandidates.length === 0 && movieCandidates.length === 0 && mangaCandidates.length === 0) return;

  enrichmentRunning = true;
  needsAttention = [];
  const total = animeCandidates.length + movieCandidates.length + mangaCandidates.length;
  const sourceLabel = useAniList ? 'AniList' : 'MAL';
  console.log(`[auto-enrich] enriching ${total} title(s) missing poster/info via ${sourceLabel}...`);
  let enriched = 0;
  // Movies are matched the same way as series - MyAnimeList's /anime
  // endpoint (and AniList's Media type) covers both TV series and anime
  // films, so searching them the same way as any other anime works as-is.
  //
  // A small worker pool instead of strictly one-title-at-a-time: each
  // worker still paces itself politely (spacing below), but three of
  // them overlap their network waiting, which measured out to roughly
  // 4-5x faster across a big library while keeping the aggregate
  // request rate modest (~3/sec peak). A 429 ("slow down") from the API
  // pauses that worker for several seconds.
  const ENRICH_CONCURRENCY = 3;
  const ENRICH_SPACING_MS = 350;

  const primarySource = useAniList ? 'anilist' : 'mal';
  const fallbackSource = useAniList ? 'mal' : 'anilist';
  // AniList never needs a key, so it's always available as a fallback;
  // MAL only works as a fallback if a Client ID is actually configured.
  const fallbackAvailable = fallbackSource === 'mal' ? !!config.malClientId : true;

  async function searchVia(source, item, isManga) {
    try {
      const results = source === 'anilist'
        ? await (isManga ? anilist.searchManga(item.title, 10) : anilist.search(item.title, 10))
        : await (isManga ? mal.searchManga(item.title, config.malClientId, 10) : mal.search(item.title, config.malClientId, 10));
      return { source, results, picked: pickBestMatch(item.title, results), error: null };
    } catch (e) {
      if (/429/.test(e.message)) await sleep(5000); // API asked us to slow down - this worker cools off before trying anything else
      return { source, results: [], picked: null, error: e.message };
    }
  }

  async function enrichOne(item, kind) {
    const isManga = kind === 'manga';
    const sourceLabel = (s) => (s === 'anilist' ? 'AniList' : 'MAL');
    try {
      let attempt = await searchVia(primarySource, item, isManga);
      let usedFallback = false;
      // The primary source either found nothing confident, or genuinely
      // failed (network error, rate limit) - either way, that source
      // "didn't pick it correctly", so try the other one automatically
      // before giving up on this title entirely.
      if (!attempt.picked && fallbackAvailable) {
        const fallbackAttempt = await searchVia(fallbackSource, item, isManga);
        if (fallbackAttempt.picked || fallbackAttempt.results.length > attempt.results.length) {
          attempt = fallbackAttempt;
          usedFallback = true;
        }
      }

      const { source, results, picked } = attempt;
      if (picked) {
        const dir = isManga ? library.getMangaDir(item.id) : library.getShowDir(item.id);
        if (dir) {
          if (isManga) await (source === 'anilist' ? applyAniListToMangaDir(dir, picked.match.id) : applyMalToMangaDir(dir, picked.match.id));
          else await (source === 'anilist' ? applyAniListToShowDir(dir, picked.match.id) : applyMalToShowDir(dir, picked.match.id));
          enriched++;
          if (usedFallback) console.log(`[auto-enrich] "${item.title}" matched via ${sourceLabel(source)} after ${sourceLabel(primarySource)} found no confident match`);
        } else if (!isManga) {
          const reason = "It's a loose file with no folder of its own to save a poster/info.json into - move it into its own folder and rescan.";
          console.log(`[auto-enrich] skipped "${item.title}": ${reason}`);
          needsAttention.push({ id: item.id, title: item.title, type: 'anime', reason });
        }
      } else if (results.length > 0) {
        const reason = `Tried ${fallbackAvailable ? `both ${sourceLabel(primarySource)} and ${sourceLabel(fallbackSource)}` : sourceLabel(primarySource)} - found results but nothing matched confidently enough (best guess via ${sourceLabel(source)}: "${results[0].title}").`;
        console.log(`[auto-enrich] skipped ${isManga ? 'manga ' : ''}"${item.title}": ${reason}`);
        needsAttention.push({ id: item.id, title: item.title, type: kind, reason, bestGuess: results[0].title });
      } else {
        const reason = `No results from ${fallbackAvailable ? `${sourceLabel(primarySource)} or ${sourceLabel(fallbackSource)}` : sourceLabel(primarySource)} for this title.`;
        console.log(`[auto-enrich] skipped ${isManga ? 'manga ' : ''}"${item.title}": ${reason}`);
        needsAttention.push({ id: item.id, title: item.title, type: kind, reason });
      }
    } catch (e) {
      console.log(`[auto-enrich] skipped ${isManga ? 'manga ' : ''}"${item.title}": ${e.message}`);
      needsAttention.push({ id: item.id, title: item.title, type: kind, reason: e.message });
    }
  }

  const tasks = [
    ...[...animeCandidates, ...movieCandidates].map((s) => ({ item: s, kind: 'anime' })),
    ...mangaCandidates.map((m) => ({ item: m, kind: 'manga' })),
  ];
  let nextTask = 0;
  async function enrichWorker() {
    while (nextTask < tasks.length) {
      const t = tasks[nextTask++];
      await enrichOne(t.item, t.kind);
      await sleep(ENRICH_SPACING_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(ENRICH_CONCURRENCY, tasks.length) }, enrichWorker));
  if (enriched > 0) {
    await scanLibrary();
    console.log(`[auto-enrich] done - enriched ${enriched}/${total} title(s)`);
  }
  enrichmentRunning = false;
}

// Fills in specific metadata gaps (studios, cast) on titles that were
// already matched to MAL/AniList before those fields existed or were
// tracked, or where the source simply didn't have that data at import
// time - worth trying again later since AniList/MAL data does get
// filled in over time. Deliberately only merges in the specific fields
// that are actually missing, rather than re-running the full import
// (which would overwrite title/description too, clobbering any manual
// edit made since the original import).
let dubCheckRunning = false;
let metadataBackfillRunning = false;

// Whether a show has an English dub, checked once (via ffprobe on its
// first episode's audio tracks) and cached from then on - checking
// this on every scan would mean probing audio tracks on potentially
// thousands of titles every single time. A show having more than one
// audio track with at least one genuinely tagged (or titled) English
// is dual-audio; a single, undefined-language Japanese track (very
// common for sub-only fan releases) is not.
function detectHasDub(audioStreams) {
  if (!audioStreams || audioStreams.length === 0) return false;
  return audioStreams.some((a) => {
    const lang = (a.language || '').toLowerCase();
    const title = (a.title || '').toLowerCase();
    return lang === 'eng' || lang === 'en' || title.includes('english') || title.includes('dub');
  });
}

async function checkMissingDubStatus() {
  if (dubCheckRunning || !ffm.HAS_FFPROBE) return { started: false };
  const cached = getAllAudioLangCache();
  const needsCheck = library.cache.anime.filter((s) => !(s.id in cached) && s.groups && s.groups[0] && s.groups[0].episodes && s.groups[0].episodes[0]);
  if (needsCheck.length === 0) return { started: false };

  dubCheckRunning = true;
  console.log(`[dub-check] checking audio tracks for ${needsCheck.length} show(s) without a cached result...`);
  let checked = 0;

  async function checkOne(show) {
    try {
      const filePath = library.resolveEpisodeFile(show.id, show.groups[0].episodes[0].relPath);
      if (!filePath) return;
      const info = await getStreamInfo(filePath);
      setAudioLangCache(show.id, detectHasDub(info && info.audioStreams));
      checked++;
    } catch (e) { /* leave uncached - will retry on a later scan rather than caching a guess */ }
  }

  const DUB_CHECK_CONCURRENCY = 3;
  let nextTask = 0;
  async function dubCheckWorker() {
    while (nextTask < needsCheck.length) {
      await checkOne(needsCheck[nextTask++]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(DUB_CHECK_CONCURRENCY, needsCheck.length) }, dubCheckWorker));
  if (checked > 0) library.cache.scannedAt = Date.now(); // invalidate the response-level list cache - otherwise this wouldn't show up until the next full rescan
  console.log(`[dub-check] done - checked ${checked}/${needsCheck.length} show(s)`);
  dubCheckRunning = false;
  return { started: true, checked };
}

async function backfillMissingMetadata() {
  if (metadataBackfillRunning || enrichmentRunning) return { started: false, reason: 'Enrichment is already running.' };
  const animeAndMovies = [...library.cache.anime, ...library.cache.movies];

  // Cross-reference MAL-only shows to their AniList id first, and
  // update them in place (not just their info.json on disk) - a show
  // whose id gets found here needs to actually be visible to the
  // missingCast computation just below, in this same run, not only on
  // some future run after a restart re-reads it from disk. Without
  // this ordering, a MAL-matched show could sit there indefinitely
  // "missing cast" but never actually becoming eligible for it.
  const needsCrossRef = animeAndMovies.filter((s) => s.malId && !s.anilistId);
  let crossReferenced = 0;
  if (needsCrossRef.length > 0) {
    metadataBackfillRunning = true;
    console.log(`[metadata-backfill] cross-referencing ${needsCrossRef.length} MAL-matched show(s) for their AniList id...`);
    let nextCrossRefTask = 0;
    async function crossRefWorker() {
      while (nextCrossRefTask < needsCrossRef.length) {
        const show = needsCrossRef[nextCrossRefTask++];
        try {
          const anilistId = await anilist.lookupAnilistIdByMalId(show.malId, show.chapterCount !== undefined ? 'MANGA' : 'ANIME');
          if (anilistId) {
            const dir = library.getShowDir(show.id) || library.getMangaDir(show.id);
            if (dir) {
              const infoPath = path.join(dir, 'info.json');
              const existing = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf-8')) : {};
              fs.writeFileSync(infoPath, JSON.stringify({ ...existing, anilistId }, null, 2));
              show.anilistId = anilistId; // update the in-memory copy too, so it's visible to missingCast below in this same run
              crossReferenced++;
            }
          }
        } catch (e) {
          if (/429/.test(e.message)) await sleep(5000);
        }
        await sleep(350);
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, needsCrossRef.length) }, crossRefWorker));
    console.log(`[metadata-backfill] cross-referenced ${crossReferenced}/${needsCrossRef.length} show(s)`);
    metadataBackfillRunning = false;
  }

  const missingStudios = animeAndMovies.filter((s) => (s.malId || s.anilistId) && (!s.studios || s.studios.length === 0));
  const missingCast = animeAndMovies.filter((s) => {
    if (!s.anilistId) return false;
    return !fs.existsSync(path.join(CAST_CACHE_DIR, `${s.anilistId}-v3.json`));
  });
  const tasks = [
    ...missingStudios.map((s) => ({ show: s, kind: 'studios' })),
    ...missingCast.map((s) => ({ show: s, kind: 'cast' })),
  ];
  if (tasks.length === 0) return { started: false, reason: 'Nothing missing to fill in.' };

  metadataBackfillRunning = true;
  console.log(`[metadata-backfill] filling in ${missingStudios.length} missing studio list(s) and ${missingCast.length} missing cast list(s)...`);
  let filled = 0;

  async function backfillOne({ show, kind }) {
    try {
      if (kind === 'studios') {
        const dir = library.getShowDir(show.id);
        if (!dir) return;
        const details = show.anilistId ? await anilist.getDetails(show.anilistId, 'low') : await mal.getDetails(show.malId, config.malClientId);
        if (!details.studios || details.studios.length === 0) return; // the source itself doesn't have it either - nothing to fill in
        const infoPath = path.join(dir, 'info.json');
        const existing = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf-8')) : {};
        fs.writeFileSync(infoPath, JSON.stringify({ ...existing, studios: details.studios }, null, 2));
        filled++;
      } else {
        const result = await anilist.getCastAndStaff(show.anilistId, 'low');
        await localizeCastImages([...result.cast, ...result.staff]);
        fs.mkdirSync(CAST_CACHE_DIR, { recursive: true });
        fs.writeFileSync(path.join(CAST_CACHE_DIR, `${show.anilistId}-v3.json`), JSON.stringify(result));
        filled++;
      }
    } catch (e) {
      if (/429/.test(e.message)) await sleep(5000);
      console.log(`[metadata-backfill] couldn't fill in ${kind} for "${show.title}": ${e.message}`);
    }
  }

  // Same modest worker-pool pattern as the main enrichment pass above,
  // for the same reason: overlap several requests' network wait time
  // without hammering the API.
  const BACKFILL_CONCURRENCY = 3;
  const BACKFILL_SPACING_MS = 350;
  let nextTask = 0;
  async function backfillWorker() {
    while (nextTask < tasks.length) {
      const t = tasks[nextTask++];
      await backfillOne(t);
      await sleep(BACKFILL_SPACING_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(BACKFILL_CONCURRENCY, tasks.length) }, backfillWorker));
  if (filled > 0) await scanLibrary();
  console.log(`[metadata-backfill] done - filled in ${filled}/${tasks.length} item(s)`);
  metadataBackfillRunning = false;
  return { started: true, total: tasks.length };
}

function libraryScanSummary() {
  return { ok: true, scanning: scanPromise !== null, scannedAt: library.cache.scannedAt,
    animeCount: library.cache.anime.length, movieCount: library.cache.movies.length,
    mangaCount: library.cache.manga.length, roots: (scanningLibrary || library).scanStatus };
}
app.get('/api/admin/library-status', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(libraryScanSummary());
});
app.post('/api/rescan', (req, res) => {
  const account = requireAdmin(req, res);
  if (!account) return;
  scanLibrary().then(() => {
    checkAndNotifyNewEpisodes();
    if (Object.values(library.scanStatus).every(status => status.state === 'ready')) autoEnrichLibrary();
  })
    .catch(error => console.error('[rescan] background scan failed:', error));
  console.log(`[rescan] queued by admin "${account.username}"`);
  res.status(202).json(libraryScanSummary());
});

// ---------- Profiles (scoped to the signed-in account) ----------
app.get('/api/profiles', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  res.json(profilesStore.listProfiles(account.id));
});

app.post('/api/profiles', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    const profile = profilesStore.createProfile(account.id, req.body || {});
    res.status(201).json(profile);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/profiles/active', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  res.json(profilesStore.getActiveProfile(account.id));
});

const CALENDAR_CACHE_DIR = path.join(DATA_DIR, 'calendar-cache');
const CALENDAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // airing schedules genuinely change/need refreshing, unlike the cache-forever pattern used for cast/relations

// Upcoming episodes for shows the active profile is actually following
// (My List, Top Picks, or has watch progress on) - not the whole
// library, both because that's what's actually relevant to a calendar
// view and because querying AniList for potentially thousands of
// titles nobody's even watching would be wasteful and slow.
app.get('/api/calendar', async (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const profile = profilesStore.getActiveProfile(account.id);
  if (!profile) return res.status(404).json({ error: 'No active profile' });

  const followedAnimeIds = new Set();
  for (const entry of profile.myList || []) {
    const [type, id] = entry.split(':');
    if (type === 'anime') followedAnimeIds.add(id);
  }
  for (const entry of profile.topPicks || []) {
    const [type, id] = entry.split(':');
    if (type === 'anime') followedAnimeIds.add(id);
  }
  for (const itemId of Object.keys(profile.progress || {})) {
    followedAnimeIds.add(itemId); // cross-referenced against actual anime shows below, so a movie/manga id here is harmless
  }

  const shows = library.cache.anime.filter((s) => followedAnimeIds.has(s.id) && s.anilistId);
  if (shows.length === 0) return res.json({ upcoming: [] });

  const cacheKey = crypto.createHash('md5').update(profile.id + shows.map((s) => s.anilistId).sort().join(',')).digest('hex');
  const cachePath = path.join(CALENDAR_CACHE_DIR, `${cacheKey}.json`);
  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath);
    if (Date.now() - stat.mtimeMs < CALENDAR_CACHE_TTL_MS) {
      try { return res.json(JSON.parse(fs.readFileSync(cachePath, 'utf-8'))); } catch (e) { /* fall through and refetch */ }
    }
  }

  try {
    const schedules = await anilist.getAiringSchedules(shows.map((s) => s.anilistId));
    const upcoming = shows
      .map((s) => {
        const sched = schedules[s.anilistId];
        if (!sched || !sched.nextAiringEpisode) return null;
        return {
          showId: s.id,
          title: s.title,
          coverUrl: s.cover || s.banner || null,
          episode: sched.nextAiringEpisode.episode,
          airingAt: sched.nextAiringEpisode.airingAt * 1000, // AniList gives seconds, JS wants ms
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.airingAt - b.airingAt);
    const result = { upcoming };
    fs.mkdirSync(CALENDAR_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(result));
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/stats/most-watched', (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(profilesStore.getMostWatched(12));
});

// Admin-curated home page rows ("Staff Picks", or any custom name) -
// server-wide, shown to everyone. See curated-rows.js.
app.get('/api/curated-rows', (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(curatedRows.listRows());
});

app.post('/api/curated-rows', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.status(201).json(curatedRows.createRow((req.body || {}).title));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/curated-rows/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    curatedRows.renameRow(req.params.id, (req.body || {}).title);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/curated-rows/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  curatedRows.deleteRow(req.params.id);
  res.json({ ok: true });
});

app.put('/api/curated-rows-order', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    curatedRows.reorderRows((req.body || {}).orderedIds || []);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/curated-rows/:id/items', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { itemId, itemType } = req.body || {};
  if (!itemId || !['anime', 'manga'].includes(itemType)) return res.status(400).json({ error: 'itemId and a valid itemType (anime or manga) are required' });
  try {
    curatedRows.addItem(req.params.id, itemId, itemType);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/curated-rows/:id/items/:itemType/:itemId', (req, res) => {
  if (!requireAdmin(req, res)) return;
  curatedRows.removeItem(req.params.id, req.params.itemId, req.params.itemType);
  res.json({ ok: true });
});

app.get('/api/stats/library', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const profileId = req.query.profileId;

  const genreCounts = {};
  for (const item of [...library.cache.anime, ...library.cache.movies, ...library.cache.manga]) {
    for (const g of item.genres || []) genreCounts[g] = (genreCounts[g] || 0) + 1;
  }
  const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([genre, count]) => ({ genre, count }));

  const personal = profileId ? profilesStore.getWatchStats(profileId) : null;
  let personalGenres = [];
  if (personal) {
    const personalGenreCounts = {};
    // Map lookup instead of allItems.find() per watched item - the linear
    // version was (titles x watched items) comparisons per page load,
    // which at a ~1,700-title library and a long watch history adds up
    // to real per-request CPU for no reason.
    const itemsById = new Map();
    for (const s of [...library.cache.anime, ...library.cache.movies, ...library.cache.manga]) itemsById.set(s.id, s);
    for (const itemId of personal.itemIds) {
      const item = itemsById.get(itemId);
      for (const g of (item && item.genres) || []) personalGenreCounts[g] = (personalGenreCounts[g] || 0) + 1;
    }
    personalGenres = Object.entries(personalGenreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([genre, count]) => ({ genre, count }));
  }

  res.json({
    library: {
      animeCount: library.cache.anime.length,
      movieCount: library.cache.movies.length,
      mangaCount: library.cache.manga.length,
      topGenres,
    },
    personal: personal ? { ...personal, topGenres: personalGenres } : null,
    serverWide: profilesStore.getServerWideWatchStats(),
  });
});

app.post('/api/profiles/:id/activate', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const profile = profilesStore.getProfile(account.id, req.params.id);
  if (!profile) return res.status(404).json({ error: 'Not found' });
  if (profile.hasPin) {
    try {
      if (!profilesStore.verifyPin(account.id, req.params.id, (req.body || {}).pin)) {
        return res.status(403).json({ error: 'wrong_pin' });
      }
    } catch (e) {
      return res.status(429).json({ error: e.message }); // locked out from too many attempts
    }
  }
  profilesStore.setActiveProfile(account.id, req.params.id);
  res.json(profile);
});

app.put('/api/profiles/:id', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    const profile = profilesStore.updateProfile(account.id, req.params.id, req.body || {});
    res.json(profile);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/profiles/:id', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  profilesStore.deleteProfile(account.id, req.params.id);
  res.json({ ok: true });
});

app.post('/api/profiles/:id/mylist', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const { itemId, itemType } = req.body || {};
  try {
    const list = profilesStore.toggleMyList(account.id, req.params.id, itemId, itemType);
    res.json({ myList: list });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/profiles/:id/search-history', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    profilesStore.addSearchHistoryForProfile(account.id, req.params.id, (req.body || {}).query);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/profiles/:id/search-history', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    res.json({ history: profilesStore.getSearchHistoryForProfile(account.id, req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/profiles/:id/search-history', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    profilesStore.clearSearchHistoryForProfile(account.id, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/profiles/:id/progress', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const { itemId, episodeRelPath, seconds, duration } = req.body || {};
  try {
    const progress = profilesStore.setProgress(account.id, req.params.id, itemId, episodeRelPath, seconds, duration);
    res.json(progress);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/profiles/:id/manga-progress', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const { mangaId, chapterName, page, totalPages } = req.body || {};
  try {
    const progress = profilesStore.setMangaProgress(account.id, req.params.id, mangaId, chapterName, page, totalPages);
    res.json(progress);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/profiles/:id/language-preferences', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    profilesStore.setLanguagePreferences(account.id, req.params.id, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/profiles/:id/watched', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const { itemId, itemType, episodeRelPath, episodeTitle, durationSeconds } = req.body || {};
  try {
    const result = profilesStore.markEpisodeWatched(account.id, req.params.id, itemId, itemType, episodeRelPath, episodeTitle, durationSeconds);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/profiles/:id/watched', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const { itemId, episodeRelPath } = req.body || {};
  try {
    profilesStore.markEpisodeUnwatched(account.id, req.params.id, itemId, episodeRelPath);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/profiles/:id/hide-continue', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    profilesStore.hideFromContinueWatching(account.id, req.params.id, (req.body || {}).itemId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/profiles/:id/history', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    res.json(profilesStore.getWatchHistory(account.id, req.params.id, 200));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/profiles/:id/subtitle-appearance', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    profilesStore.setSubtitleAppearance(account.id, req.params.id, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Upload a custom avatar or banner image (sent as a base64 data URL, e.g.
// from a <canvas>.toDataURL() after client-side resizing). Stored under
// data/uploads/<avatars|banners>/<profileId>.<ext> and served at /uploads/...
function makeImageUploadHandler(field, subdir) {
  return (req, res) => {
    const account = requireAuth(req, res);
    if (!account) return;
    const profile = profilesStore.getProfile(account.id, req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    try {
      const dir = path.join(DATA_DIR, 'uploads', subdir);
      const destPath = uploads.saveDataUrlImage((req.body || {}).imageData, dir, req.params.id);
      const url = `/uploads/${subdir}/${path.basename(destPath)}?v=${Date.now()}`;
      const updated = profilesStore.setImageField(account.id, req.params.id, field, url);
      res.json(updated);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  };
}
app.post('/api/profiles/:id/avatar', makeImageUploadHandler('avatar', 'avatars'));
app.post('/api/profiles/:id/banner', makeImageUploadHandler('banner', 'banners'));

// Combined avatar gallery - the app's own shipped built-in icons
// (scanned live from public/img/avatars, not hardcoded, so anything
// added there in a future update just shows up automatically) plus
// any custom ones an admin has added. The custom ones live entirely
// under DATA_DIR, never inside the app's own code folder, so a future
// update overwriting public/ can never wipe them out - the same
// reasoning as accounts, profiles, and every other piece of this
// app's own persistent state.
const AVATAR_GALLERY_DIR = path.join(DATA_DIR, 'avatar-gallery');
app.get('/api/avatar-gallery', (req, res) => {
  if (!requireAuth(req, res)) return;
  const builtIn = fs.existsSync(BUILTIN_AVATARS_DIR)
    ? fs.readdirSync(BUILTIN_AVATARS_DIR).filter((f) => /\.(svg|png|jpg|jpeg|webp)$/i.test(f)).sort().map((f) => `/img/avatars/${f}`)
    : [];
  const custom = fs.existsSync(AVATAR_GALLERY_DIR)
    ? fs.readdirSync(AVATAR_GALLERY_DIR).filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f)).sort().map((f) => `/avatar-gallery/${f}`)
    : [];
  res.json({ builtIn, custom });
});

app.post('/api/admin/avatar-gallery', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const destPath = uploads.saveDataUrlImage((req.body || {}).imageData, AVATAR_GALLERY_DIR, uniqueId);
    res.json({ url: `/avatar-gallery/${path.basename(destPath)}` });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/admin/avatar-gallery/:filename', (req, res) => {
  if (!requireAdmin(req, res)) return;
  // Resolve-and-check, same reasoning as every other user-supplied
  // filename this app ever touches on disk - a name like "../../x"
  // must never be able to reach outside this one specific folder.
  const target = path.join(AVATAR_GALLERY_DIR, path.basename(req.params.filename));
  if (!isWithin(AVATAR_GALLERY_DIR, target)) return res.status(400).json({ error: 'Invalid filename' });
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(target);
  res.json({ ok: true });
});

app.post('/api/profiles/:id/toppicks', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  const { itemId, itemType } = req.body || {};
  try {
    const list = profilesStore.toggleTopPick(account.id, req.params.id, itemId, itemType);
    res.json({ topPicks: list });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/profiles/:id/reviews', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    const review = profilesStore.addReview(account.id, req.params.id, req.body || {});
    res.status(201).json(review);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/profiles/:id/reviews/:reviewId', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  profilesStore.deleteReview(account.id, req.params.id, req.params.reviewId);
  res.json({ ok: true });
});

app.get('/api/reviews/:itemType/:itemId', (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!['anime', 'manga'].includes(req.params.itemType)) return res.status(400).json({ error: 'invalid itemType' });
  res.json(profilesStore.getReviewsForItem(req.params.itemId, req.params.itemType));
});

app.post('/api/profiles/:id/comments', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  try {
    const comment = profilesStore.addComment(account.id, req.params.id, (req.body || {}).text);
    res.status(201).json(comment);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/profiles/:id/comments/:commentId', (req, res) => {
  const account = requireAuth(req, res);
  if (!account) return;
  profilesStore.deleteComment(account.id, req.params.id, req.params.commentId);
  res.json({ ok: true });
});

// ---------- Anime library (any signed-in account can browse/watch) ----------
// Note: the list endpoint intentionally returns full show objects (including
// `groups`/episodes) rather than a stripped-down summary. The frontend caches
// this list in Store.anime and reuses it on detail/player/hero pages, so it
// needs episode data available without a second round-trip per title.
// Grid/home/search views only ever need episodeCount (already its own
// field) for display, not the full per-episode list (title/file/relPath
// for every single episode) - for a long-running series that's a lot of
// bytes that get sent and parsed on every page load for no benefit. The
// detail/player pages fetch the full version (with groups) via
// /api/anime/:id on demand - the frontend already falls back to that
// automatically whenever `groups` is missing from what it has cached.
function stripEpisodeDetail(show) {
  const { groups, ...rest } = show;
  return rest;
}

// These three list responses are identical for every signed-in user and
// only change when the library itself changes (kids-mode filtering is
// applied client-side per profile). Building them fresh per request -
// map + JSON.stringify + gzip - measured at ~25ms of event-loop-blocking
// CPU per request at ~1,700 titles, and the home page requests all
// three at once, for every user, on every visit. Memoizing the final
// stringified + gzipped bytes (keyed by the scan timestamp) turns each
// of those requests into a near-free buffer send instead; the cost is
// paid once per rescan rather than once per page load.
const listResponseCache = new Map(); // name -> { scannedAt, json, gzip }
function getCachedListResponse(name, buildFn) {
  const cached = listResponseCache.get(name);
  if (cached && cached.scannedAt === library.cache.scannedAt) return cached;
  const json = Buffer.from(JSON.stringify(buildFn()), 'utf-8');
  const entry = { scannedAt: library.cache.scannedAt, json, gzip: zlib.gzipSync(json) };
  listResponseCache.set(name, entry);
  return entry;
}
function sendCachedList(req, res, name, buildFn) {
  const entry = getCachedListResponse(name, buildFn);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');
  if ((req.headers['accept-encoding'] || '').includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
    return res.end(entry.gzip);
  }
  return res.end(entry.json);
}

// Powers the home screen's "Recently Added Episodes" row - distinct
// from "recently added shows": a new episode landing in a series
// that's been in the library for months belongs here even though the
// show itself isn't new. Resolves each database row back to its full
// show/episode data, skipping anything that can't be found anymore
// (the show or that specific episode was deleted/renamed since it was
// recorded) rather than showing a broken entry.
app.get('/api/recent-episodes', (req, res) => {
  if (!requireAuth(req, res)) return;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const rows = getRecentEpisodes(limit * 2); // over-fetch a bit since some rows may not resolve (deleted shows/episodes)
  const results = [];
  for (const row of rows) {
    if (results.length >= limit) break;
    const show = library.getShow(row.show_id);
    if (!show) continue;
    let episode = null;
    for (const group of show.groups || []) {
      episode = group.episodes.find((e) => e.relPath === row.episode_key);
      if (episode) break;
    }
    if (!episode) continue;
    results.push({
      showId: show.id,
      showTitle: show.title,
      cover: show.cover,
      banner: show.banner,
      episodeIndex: episode.index,
      episodeTitle: episode.title,
      relPath: episode.relPath,
      firstSeenAt: row.first_seen_at,
    });
  }
  res.json(results);
});

app.get('/api/anime', (req, res) => {
  if (!requireAuth(req, res)) return;
  // Full data (every episode's title/file/relPath, same shape this API
  // has always returned) is the default - anything that isn't the web
  // app itself (the native Android TV / Windows / iOS clients, or any
  // future integration) has no way to know to ask for anything
  // different, and silently changing what they get back under them
  // breaks them without any error message pointing at why. Only ?light=1
  // gets the trimmed version built for the web app's browse/search
  // pages, which already knows to fetch full details per-title on demand.
  const light = req.query.light === '1';
  sendCachedList(req, res, light ? 'anime:light' : 'anime:full', () => {
    const dubCache = getAllAudioLangCache();
    const withDub = library.cache.anime.map((s) => ({ ...s, hasDub: dubCache[s.id] === true }));
    return light ? withDub.map(stripEpisodeDetail) : withDub;
  });
});

// Movies live in their own media/movies folder (see config.json
// mediaPaths.movies), completely separate from media/anime, so a long
// series and a standalone film never end up mixed in the same directory.
app.get('/api/movies', (req, res) => {
  if (!requireAuth(req, res)) return;
  const light = req.query.light === '1';
  sendCachedList(req, res, light ? 'movies:light' : 'movies:full', () => (light ? library.cache.movies.map(stripEpisodeDetail) : library.cache.movies));
});

app.get('/api/anime/:id', (req, res) => {
  if (!requireAuth(req, res)) return;
  const show = library.getShow(req.params.id);
  if (!show) return res.status(404).json({ error: 'Not found' });
  res.json(show);
});

// ---------- MyAnimeList metadata import (admin only - edits the library) ----------
// The MAL search box accepts three input styles: a name (normal search),
// a bare MAL id like "5114", or a pasted myanimelist.net URL - the id
// forms are unambiguous, which is exactly what's needed when a name
// search keeps surfacing the wrong entry (remakes, sequels, and shows
// sharing a title are the usual culprits).
function parseMalIdInput(q) {
  if (/^\d+$/.test(q)) return parseInt(q, 10);
  const urlMatch = q.match(/myanimelist\.net\/(?:anime|manga)\/(\d+)/i);
  return urlMatch ? parseInt(urlMatch[1], 10) : null;
}

app.get('/api/mal/search', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const q = (req.query.q || '').trim();
  if (!config.malClientId) return res.status(400).json({ error: 'No MyAnimeList Client ID configured. Add one in Settings.' });
  if (!q) return res.json([]);
  try {
    const directId = parseMalIdInput(q);
    const results = directId !== null
      ? await mal.lookupById(directId, config.malClientId)
      : await mal.search(q, config.malClientId);
    res.json(results);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/mal/search-manga', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const q = (req.query.q || '').trim();
  if (!config.malClientId) return res.status(400).json({ error: 'No MyAnimeList Client ID configured. Add one in Settings.' });
  if (!q) return res.json([]);
  try {
    const directId = parseMalIdInput(q);
    const results = directId !== null
      ? await mal.lookupMangaById(directId, config.malClientId)
      : await mal.searchManga(q, config.malClientId);
    res.json(results);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Lets someone mark the exact intro/outro timestamps for a show while
// watching, rather than relying on a generic guess (assume ~90s from
// the very start) that's frequently wrong - actual intro lengths vary
// a lot between shows, and some episodes (cold opens, recaps) don't
// have one at the very start at all. Saved once per show, applying to
// every episode - accurate for the common case of a consistent intro
// across a season, though a specific episode with a different intro
// would need re-marking individually if that ever comes up.
app.post('/api/anime/:id/skip-points', (req, res) => {
  if (!requireAuth(req, res)) return;
  const showDir = library.getShowDir(req.params.id);
  if (!showDir) return res.status(400).json({ error: "This title is a loose file with no folder of its own to save skip points into - move it into its own folder and rescan." });
  const { introStart, introEnd, outroStart, outroEnd } = req.body || {};
  const infoPath = path.join(showDir, 'info.json');
  const existing = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf-8')) : {};
  const merged = { ...existing };
  // null clears a previously-set point (e.g. "remove outro skip") -
  // undefined means "don't touch this field" (the request just didn't
  // include it), which matters since intro and outro are set
  // independently and shouldn't wipe each other out.
  if (introStart !== undefined) merged.introStart = introStart;
  if (introEnd !== undefined) merged.introEnd = introEnd;
  if (outroStart !== undefined) merged.outroStart = outroStart;
  if (outroEnd !== undefined) merged.outroEnd = outroEnd;
  fs.writeFileSync(infoPath, JSON.stringify(merged, null, 2));
  const show = library.getShow(req.params.id);
  if (show) {
    show.skipIntro = (merged.introStart != null && merged.introEnd != null) ? { start: merged.introStart, end: merged.introEnd } : null;
    show.skipOutro = (merged.outroStart != null) ? { start: merged.outroStart, end: merged.outroEnd != null ? merged.outroEnd : null } : null;
  }
  library.cache.scannedAt = Date.now(); // invalidate the response-level list cache, which is keyed to this - otherwise this change wouldn't show up until the next full rescan
  res.json({ ok: true, skipIntro: show ? show.skipIntro : null, skipOutro: show ? show.skipOutro : null });
});

app.post('/api/anime/:id/import-mal', async (req, res) => {
  const account = requireAdmin(req, res);
  if (!account) return;
  if (!config.malClientId) return res.status(400).json({ error: 'No MyAnimeList Client ID configured. Add one in Settings.' });
  const malId = parseInt((req.body || {}).malId, 10);
  if (!malId) return res.status(400).json({ error: 'malId is required' });
  const useEnglishTitle = (req.body || {}).useEnglishTitle;

  const showDir = library.getShowDir(req.params.id);
  if (!showDir) {
    const exists = !!library.getShow(req.params.id);
    return res.status(400).json({
      error: exists
        ? "This movie is a single loose file with no folder of its own, so there's nowhere to save a poster/info.json. Move it into its own folder (e.g. media/movies/Movie Title/Movie Title.mp4) and rescan, then try importing again."
        : 'Show not found',
    });
  }

  try {
    await applyMalToShowDir(showDir, malId, useEnglishTitle);
    await scanLibrary();
    console.log(`[mal-import] "${library.getShow(req.params.id).title}" imported by admin "${account.username}"`);
    res.json(library.getShow(req.params.id));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/manga/:id/import-mal', async (req, res) => {
  const account = requireAdmin(req, res);
  if (!account) return;
  if (!config.malClientId) return res.status(400).json({ error: 'No MyAnimeList Client ID configured. Add one in Settings.' });
  const malId = parseInt((req.body || {}).malId, 10);
  if (!malId) return res.status(400).json({ error: 'malId is required' });
  const useEnglishTitle = (req.body || {}).useEnglishTitle;

  const titleDir = library.getMangaDir(req.params.id);
  if (!titleDir) return res.status(404).json({ error: 'Manga not found' });

  try {
    await applyMalToMangaDir(titleDir, malId, useEnglishTitle);
    await scanLibrary();
    console.log(`[mal-import] "${library.getManga(req.params.id).title}" imported by admin "${account.username}"`);
    res.json(library.getManga(req.params.id));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// AniList needs no API key/Client ID at all - it's a genuinely open,
// unauthenticated API for search and detail lookups - so these routes
// work immediately with zero setup, unlike the MAL ones above.
function parseAniListIdInput(q) {
  if (/^\d+$/.test(q)) return parseInt(q, 10);
  const urlMatch = q.match(/anilist\.co\/(?:anime|manga)\/(\d+)/i);
  return urlMatch ? parseInt(urlMatch[1], 10) : null;
}

app.get('/api/anilist/search', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const directId = parseAniListIdInput(q);
    const results = directId !== null ? await anilist.lookupById(directId) : await anilist.search(q);
    res.json(results);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/anilist/search-manga', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const directId = parseAniListIdInput(q);
    const results = directId !== null ? await anilist.lookupMangaById(directId) : await anilist.searchManga(q);
    res.json(results);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/anime/:id/import-anilist', async (req, res) => {
  const account = requireAdmin(req, res);
  if (!account) return;
  const anilistId = parseInt((req.body || {}).anilistId, 10);
  if (!anilistId) return res.status(400).json({ error: 'anilistId is required' });
  const useEnglishTitle = (req.body || {}).useEnglishTitle;

  const showDir = library.getShowDir(req.params.id);
  if (!showDir) {
    const exists = !!library.getShow(req.params.id);
    return res.status(400).json({
      error: exists
        ? "This movie is a single loose file with no folder of its own, so there's nowhere to save a poster/info.json. Move it into its own folder (e.g. media/movies/Movie Title/Movie Title.mp4) and rescan, then try importing again."
        : 'Show not found',
    });
  }

  try {
    await applyAniListToShowDir(showDir, anilistId, useEnglishTitle);
    await scanLibrary();
    console.log(`[anilist-import] "${library.getShow(req.params.id).title}" imported by admin "${account.username}"`);
    res.json(library.getShow(req.params.id));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/manga/:id/import-anilist', async (req, res) => {
  const account = requireAdmin(req, res);
  if (!account) return;
  const anilistId = parseInt((req.body || {}).anilistId, 10);
  if (!anilistId) return res.status(400).json({ error: 'anilistId is required' });
  const useEnglishTitle = (req.body || {}).useEnglishTitle;

  const titleDir = library.getMangaDir(req.params.id);
  if (!titleDir) return res.status(404).json({ error: 'Manga not found' });

  try {
    await applyAniListToMangaDir(titleDir, anilistId, useEnglishTitle);
    await scanLibrary();
    console.log(`[anilist-import] "${library.getManga(req.params.id).title}" imported by admin "${account.username}"`);
    res.json(library.getManga(req.params.id));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- Stream inspection / track probing ----------
const probeCache = new Map(); // filePath -> { mtimeMs, data }
const PROBE_CACHE_MAX = 500; // oldest entries evicted beyond this - keeps memory flat as the library grows

async function getStreamInfo(filePath) {
  const stat = await mediaIO.stat(filePath);
  const cached = probeCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
  if (!ffm.HAS_FFPROBE) return null;
  const raw = await ffm.probe(filePath);
  const data = ffm.analyzeStreams(raw, filePath);
  probeCache.set(filePath, { mtimeMs: stat.mtimeMs, data });
  if (probeCache.size > PROBE_CACHE_MAX) probeCache.delete(probeCache.keys().next().value); // Maps iterate in insertion order - drops the oldest
  return data;
}

const STREAM_CACHE_DIR = path.join(DATA_DIR, 'stream-cache');
const inFlightRemuxes = new Map(); // cacheKey -> Promise, so concurrent requests share one remux instead of racing

const HLS_CACHE_DIR = path.join(DATA_DIR, 'hls-cache');
// cacheKey -> { proc, outputDir, filePath, startedAt, lastAccessed }
const hlsSessions = new Map();

// Starts (or reuses) an HLS transcode session for a given episode +
// options - the actual fix for "mobile has to wait for the entire
// transcode before playback can start": instead of one monolithic
// file, ffmpeg writes segments progressively, and a player can start
// on the first one as soon as it exists rather than waiting for the
// whole episode to finish encoding.
function getOrStartHlsSession(filePath, transcodeOpts, cacheKey) {
  const existing = hlsSessions.get(cacheKey);
  if (existing) {
    existing.lastAccessed = Date.now();
    return existing;
  }
  const outputDir = path.join(HLS_CACHE_DIR, cacheKey);
  // A session for this exact cache key may have run before (e.g. under
  // an earlier version of this code, or an earlier attempt that used
  // hardware decode and produced corrupted output) - mkdirSync alone
  // never removes pre-existing files, so without this a fresh attempt
  // could start writing alongside stale segments from that prior run
  // rather than into a guaranteed-clean directory.
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const session = { abort: new AbortController(), proc: null, outputDir, filePath, startedAt: Date.now(), lastAccessed: Date.now(), failed: false, stderrTail: '', knownSlow: transcodeOpts.sourceVideoCodec === 'av1' };

  // AV1 decode via QSV is a much newer, less mature feature than
  // HEVC/H.264 decode - confirmed (not just suspected) that it can
  // AV1 previously skipped hardware decode entirely here, based on
  // testing done before the actual root cause of AV1 playback issues
  // was found and fixed (a separate bug where AV1 video was being
  // copied raw into HLS output rather than ever being decoded and
  // re-encoded at all). Since decode was never actually happening
  // either way under that bug, decode method genuinely couldn't have
  // been the cause of anything observed then - so that restriction is
  // removed. AV1 now gets the same hardware-decode-first treatment as
  // every other codec, protected by the watchdog and exit-code-based
  // fallback below if a specific hardware/driver combination genuinely
  // doesn't support it.

  async function spawnAttempt(decodeHwaccel) {
    let release;
    try { release = await transcodeLimiter.acquireSlot({ signal: session.abort.signal }); }
    catch (error) { session.failed = true; session.stderrTail = error.message; return; }

    // Only the hardware-decode path needs to wait its turn here - the
    // contention this prevents is specifically about two ffmpeg
    // processes both initializing a QSV hardware context at once, which
    // a software-decode attempt was never going to hit in the first
    // place.
    if (decodeHwaccel) await acquireHwStartupSlot();
    const proc = ffm.spawnHlsTranscode({ ...transcodeOpts, filePath, outputDir, segmentSeconds: 6, decodeHwaccel });
    proc.once('close', release); proc.once('error', release);
    session.proc = proc;
    session.stderrTail = '';
    let settled = false;

    // The existing exit-code check below only catches a hardware
    // decode attempt that actually errors out and closes - it can't
    // catch one that just hangs and never exits at all, which is a
    // real, known class of issue with QSV in certain driver/
    // configuration combinations. This proactively kills and retries
    // an attempt that hasn't produced even one segment within a
    // reasonable window, rather than waiting indefinitely for an exit
    // that may never come.
    let watchdog = null;
    if (decodeHwaccel) {
      watchdog = setTimeout(() => {
        if (settled) return;
        const producedAnySegments = fs.existsSync(outputDir) && fs.readdirSync(outputDir).some((f) => f.endsWith('.ts'));
        if (producedAnySegments) return; // genuinely just a slow (but working) transcode - let it continue
        settled = true;
        console.log(`[hls] session for "${path.basename(filePath)}" (${cacheKey}) produced no segments within 20s of hardware decode - likely hung rather than slow, killing and retrying with software decode`);
        try { proc.kill('SIGKILL'); } catch (e) { /* noop */ }
        spawnAttempt(false);
      }, 20000);
    }

    // Fast-fail for one specific, unambiguous pattern rather than
    // waiting out the full 20s watchdog above: "Error querying IO
    // surface" / "Error submitting packet to decoder" repeating rapidly
    // is the exact, confirmed signature of two hardware sessions
    // contending for the same QSV context at once (see the startup
    // lock above) - not a single transient blip, a clear, repeating
    // failure loop that's never going to resolve on its own. Detecting
    // it directly here means recovering in a couple seconds instead of
    // hammering a broken decode path for the full 20s window.
    let hwContentionErrorCount = 0;
    proc.stderr.on('data', (d) => {
      if (decodeHwaccel && !settled && /Error querying IO surface|Error submitting packet to decoder/.test(d.toString())) {
        hwContentionErrorCount++;
        if (hwContentionErrorCount >= 5) {
          settled = true;
          clearTimeout(watchdog);
          console.log(`[hls] session for "${path.basename(filePath)}" (${cacheKey}) hit repeated hardware contention errors - fast-failing to software decode instead of waiting out the full watchdog`);
          try { proc.kill('SIGKILL'); } catch (e) { /* noop */ }
          spawnAttempt(false);
          return;
        }
      }
    });
    proc.stderr.on('data', (d) => {
      session.stderrTail = (session.stderrTail + d).slice(-4000);
      // Surfaces actual warnings/errors from ffmpeg's own output live,
      // as they happen - not just if the process eventually exits with
      // a failure code. That on-failure-only visibility was blind to
      // exactly this kind of issue: a process that keeps running
      // successfully overall but quietly starts producing bad segments
      // partway through, which never triggers an exit code at all.
      // Filters out the constant per-frame progress noise (frame=...
      // fps=... time=...) so only lines that look like genuine
      // problems show up.
      const text = d.toString();
      for (const line of text.split('\n')) {
        if (/error|warning|invalid|non.monotonic|discontinu|corrupt/i.test(line) && !/^frame=/.test(line)) {
          console.log(`[hls] ffmpeg (${cacheKey}): ${line.trim()}`);
        }
      }
    });
    proc.on('close', (code) => {
      if (settled) return; // the watchdog above already killed this and started a retry - this close event is just that kill taking effect, not a new outcome
      clearTimeout(watchdog);
      if (code === 0) { settled = true; return; }
      // Hardware-accelerated decode support for a given source codec
      // varies by exact hardware/driver - AV1 decode via QSV, in
      // particular, needs a fairly recent Intel generation. A failure
      // before even one segment was produced is a strong, specific
      // signal of a genuine decode-hwaccel incompatibility (as opposed
      // to some other, unrelated problem) - worth one automatic retry
      // without it rather than a hard failure with no way to recover.
      const producedAnySegments = fs.existsSync(outputDir) && fs.readdirSync(outputDir).some((f) => f.endsWith('.ts'));
      if (decodeHwaccel && !producedAnySegments) {
        settled = true;
        console.log(`[hls] session for "${path.basename(filePath)}" (${cacheKey}) failed with hardware decode before producing any segments - retrying with software decode. Full ffmpeg stderr:\n${session.stderrTail}`);
        spawnAttempt(false);
        return;
      }
      settled = true;
      session.failed = true;
      console.log(`[hls] session for "${path.basename(filePath)}" (${cacheKey}) exited with code ${code}. Full ffmpeg stderr:\n${session.stderrTail}`);
    });
  }
  spawnAttempt(true);

  hlsSessions.set(cacheKey, session);
  console.log(`[hls] started new session for "${path.basename(filePath)}" -> ${cacheKey}`);
  return session;
}

// Kills and forgets any HLS session nobody has requested a
// playlist/segment from recently - otherwise a stream someone
// navigated away from (or closed the tab on) would just keep
// transcoding indefinitely in the background, wasting CPU/GPU and a
// concurrency slot for no one.
const HLS_SESSION_IDLE_TIMEOUT_MS = 60 * 1000;
const HLS_SESSION_IDLE_TIMEOUT_SLOW_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of hlsSessions.entries()) {
    const timeout = session.knownSlow ? HLS_SESSION_IDLE_TIMEOUT_SLOW_MS : HLS_SESSION_IDLE_TIMEOUT_MS;
    if (now - session.lastAccessed > timeout) {
      console.log(`[hls] cleaning up idle session ${key} (${path.basename(session.filePath)})`);
      try { session.proc.kill('SIGKILL'); } catch (e) { /* noop */ }
      session.abort.abort();
      hlsSessions.delete(key);
      // Leaves the segment files on disk - a fresh request for the same
      // episode/options shortly after can still serve whatever was
      // already generated instead of starting from scratch, and the
      // regular disk cache cleanup elsewhere handles old files
      // eventually.
    }
  }
}, 15 * 1000).unref();

// Keeps the cache from growing forever - without this, a heavily-used,
// ever-growing library would eventually fill up the disk entirely with
// transcoded copies, which is a real stability risk over time (a full
// disk can crash all sorts of things, not just this app). Removes the
// least-recently-*served* files first once the total exceeds the
// configured limit, not just the oldest-created ones - see touchCacheFile.
function enforceCacheSizeLimit() {
  try {
    if (!fs.existsSync(STREAM_CACHE_DIR)) return;
    const limitBytes = (config.maxStreamCacheGB || 15) * 1024 ** 3;
    const files = fs.readdirSync(STREAM_CACHE_DIR)
      .filter((f) => f.endsWith('.mp4') && !f.includes('.tmp') && !f.includes('.rawtap'))
      .map((f) => {
        const p = path.join(STREAM_CACHE_DIR, f);
        const stat = fs.statSync(p);
        return { path: p, size: stat.size, mtimeMs: stat.mtimeMs };
      });
    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= limitBytes) return;

    files.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest-accessed first
    let removed = 0;
    for (const f of files) {
      if (total <= limitBytes) break;
      try {
        fs.unlinkSync(f.path);
        total -= f.size;
        removed++;
      } catch (e) { /* another request may have already removed/replaced it */ }
    }
    if (removed > 0) {
      console.log(`[stream-cache] over the ${config.maxStreamCacheGB}GB limit - removed ${removed} least-recently-used cached file(s)`);
    }
  } catch (e) {
    // Best-effort only - never let cache housekeeping affect actual playback.
  }
}

// Marks a cached file as recently used (by bumping its mtime) so the
// eviction above treats it as "hot" - otherwise a popular, frequently
// rewatched episode could get deleted for being old even though it's
// actively being used.
function touchCacheFile(filePath) {
  try { fs.utimesSync(filePath, new Date(), new Date()); } catch (e) { /* noop */ }
}

async function getCachedRemux(filePath, transcodeOptions) {
  const stat = await mediaIO.stat(filePath);
  const key = computeCacheKey(filePath, stat.mtimeMs, transcodeOptions);
  const cachedPath = path.join(STREAM_CACHE_DIR, `${key}.mp4`);

  if (fs.existsSync(cachedPath)) return cachedPath;
  if (inFlightRemuxes.has(key)) return inFlightRemuxes.get(key);

  const promise = (async () => {
    const release = await transcodeLimiter.acquireSlot();
    try {
      return await new Promise((resolve, reject) => {
        fs.mkdirSync(STREAM_CACHE_DIR, { recursive: true });
        const tmpPath = `${cachedPath}.${process.pid}.tmp`;
        const proc = ffm.spawnTranscode({ ...transcodeOptions, filePath, startSeconds: 0, outputPath: tmpPath });
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d; });
        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(tmpPath)) {
            fs.renameSync(tmpPath, cachedPath);
            // A new file was genuinely added - this is the only moment
            // the total can grow, so it's the only moment enforcement
            // is needed (running it on every cache-hit serve was a full
            // sync directory scan per playback request, for nothing).
            enforceCacheSizeLimit();
            resolve(cachedPath);
          } else {
            try { fs.unlinkSync(tmpPath); } catch (e) { /* noop */ }
            reject(new Error(stderr.slice(-300) || `remux exited with code ${code}`));
          }
        });
        proc.on('error', reject);
      });
    } finally {
      release();
      inFlightRemuxes.delete(key);
    }
  })();
  inFlightRemuxes.set(key, promise);
  return promise;
}

// Detects mobile browsers specifically (not just "not desktop") - these
// are the ones that actually need guaranteed Range/Content-Length
// support from the very first request. Desktop browsers (and most smart
// TV apps) are much more tolerant of an indefinite live pipe.
function isMobileUserAgent(userAgent, platformHint) {
  // iPadOS deliberately uses a desktop Mac Safari User-Agent by default
  // (since iPadOS 13) - genuinely indistinguishable from a real Mac by
  // that header alone. platformHint comes from a client-side check
  // (touch support on a "Mac" platform, which a real Mac never has)
  // that can tell the difference the header can't. This matters
  // because iPadOS Safari has the exact same media playback
  // restrictions as iPhone - misclassifying it as desktop means
  // serving it a stream type it can't actually play reliably.
  if (platformHint === 'ipad') return true;
  return /iPhone|iPad|iPod|Android/i.test(userAgent || '');
}

function computeCacheKey(filePath, mtimeMs, opts) {
  const keyParts = [filePath, mtimeMs, opts.audioStreamIndex, opts.targetHeight || 'orig', opts.reencodeVideo ? 1 : 0, opts.startOffsetSeconds || 0];
  return crypto.createHash('md5').update(keyParts.join('|')).digest('hex');
}

// Builds up the cache for a genuine re-encode *after the fact*, without
// making the current request wait on any of it. The live pipe uses a
// fragmented MP4 structure suited to streaming; once it's fully written,
// a quick background stream-copy pass (seconds, not a re-encode) fixes
// that up into a proper faststart file for future Range-based requests -
// the same structure a fresh container-only fix would produce.
function tapStreamIntoCache(proc, filePath, transcodeOpts) {
  try {
    const stat = probeCache.get(filePath);
    if (!stat) return;
    const key = computeCacheKey(filePath, stat.mtimeMs, transcodeOpts);
    const cachedPath = path.join(STREAM_CACHE_DIR, `${key}.mp4`);
    if (fs.existsSync(cachedPath) || inFlightRemuxes.has(key)) return; // already cached or being built

    fs.mkdirSync(STREAM_CACHE_DIR, { recursive: true });
    const rawTapPath = path.join(STREAM_CACHE_DIR, `${key}.${process.pid}.rawtap.tmp`);
    const writeStream = fs.createWriteStream(rawTapPath);

    // Deliberately NOT proc.stdout.pipe(writeStream) here. proc.stdout is
    // also being piped to the live HTTP response elsewhere - piping one
    // readable to two destinations ties their backpressure together, so
    // if the disk write here ever falls behind (I/O contention, a slow
    // or network-attached drive, general system load), Node pauses the
    // *shared* source to match the slower consumer, which stutters the
    // actual video the person is watching right now. Forwarding data
    // manually instead makes the cache write purely best-effort: if it
    // falls behind, Node just buffers the pending writes in memory
    // rather than pausing anything - video bitrates are always far
    // below normal disk throughput, so this is a very safe trade.
    proc.stdout.on('data', (chunk) => { writeStream.write(chunk); });
    proc.stdout.on('end', () => { writeStream.end(); });

    const rawTapDone = new Promise((resolve, reject) => {
      let procClosed = false;
      let writeFinished = false;
      const maybeResolve = () => { if (procClosed && writeFinished) resolve(); };
      proc.on('close', (code) => {
        if (code !== 0) { reject(new Error(`live transcode exited ${code}`)); return; }
        procClosed = true;
        maybeResolve();
      });
      writeStream.on('finish', () => { writeFinished = true; maybeResolve(); });
      proc.on('error', reject);
      writeStream.on('error', reject);
    });

    // The single promise stored in inFlightRemuxes covers the *entire*
    // pipeline (raw tap + faststart fixup) and resolves to the real
    // cache path - the same contract getCachedRemux uses. That matters
    // because a concurrent request (e.g. the same file/settings loaded
    // from a mobile browser moments later) can be waiting on this exact
    // entry, and needs back a real, usable file path, not just a signal
    // that the live pipe itself finished.
    const fullPipeline = rawTapDone.then(() => new Promise((resolve, reject) => {
      const finalTmpPath = `${cachedPath}.${process.pid}.tmp`;
      const fixupProc = spawnFaststartFixup(rawTapPath, finalTmpPath);
      fixupProc.on('close', (code) => {
        fs.unlink(rawTapPath, () => {});
        if (code === 0 && fs.existsSync(finalTmpPath)) {
          fs.rename(finalTmpPath, cachedPath, (err) => {
            if (err) { reject(err); return; }
            enforceCacheSizeLimit();
            resolve(cachedPath);
          });
        } else {
          fs.unlink(finalTmpPath, () => {});
          reject(new Error(`faststart fixup exited ${code}`));
        }
      });
      fixupProc.on('error', (e) => { fs.unlink(rawTapPath, () => {}); reject(e); });
    }));

    inFlightRemuxes.set(key, fullPipeline);
    fullPipeline
      .catch(() => { fs.unlink(rawTapPath, () => {}); }) // playback was likely stopped/closed early - discard the partial tap
      .then(() => inFlightRemuxes.delete(key));
  } catch (e) {
    // Best-effort only - a failure here must never affect the actual
    // live playback the user is watching right now.
  }
}

function spawnFaststartFixup(inputPath, outputPath) {
  return ffm.trackLive(spawn('ffmpeg', ['-y', '-i', inputPath, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', outputPath]));
}

async function sendRawFile(req, res, filePath) {
  try {
    const stat = await mediaIO.stat(filePath); const size = stat.size;
    let start = 0, end = size - 1, code = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) return res.status(416).set('Content-Range', `bytes */${size}`).end();
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return res.status(416).set('Content-Range', `bytes */${size}`).end();
      code = 206; res.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.status(code).set({ 'Content-Type': mime.lookup(filePath), 'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes' });
    if (req.method === 'HEAD' || !size) return res.end();
    mediaStream.pipeFile(filePath, start, end, res);
  } catch (error) { if (!res.headersSent) { res.removeHeader('Content-Length'); res.removeHeader('Content-Range'); res.status(error.status || 503).json({ error: error.message }); } }
}

// Returns available audio/subtitle tracks for an episode, and whether the
// file can be played as-is or needs ffmpeg to fix the audio.
// Real per-episode runtimes for the episode grid - computed via the same
// cached ffprobe path streaminfo already uses (a metadata-only read, not
// a transcode - cheap, and free entirely for any episode someone has
// already watched, since that probe is already cached). Modest
// concurrency keeps a season with a lot of episodes from spawning a
// pile of ffprobe processes all at once.
app.get('/api/episode-durations/:showId/:groupIndex', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const show = library.getShow(req.params.showId);
  const group = show && show.groups && show.groups[parseInt(req.params.groupIndex, 10)];
  if (!group) return res.status(404).json({ error: 'Not found' });
  if (!ffm.HAS_FFPROBE) return res.json({});

  const durations = {};
  const DURATION_CONCURRENCY = 4;
  let next = 0;
  async function worker() {
    while (next < group.episodes.length) {
      const ep = group.episodes[next++];
      try {
        const filePath = library.resolveEpisodeFile(req.params.showId, ep.relPath);
        if (!filePath) continue;
        const info = await getStreamInfo(filePath);
        if (info && info.duration) durations[ep.relPath] = info.duration;
      } catch (e) { /* one bad file shouldn't block the rest */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(DURATION_CONCURRENCY, group.episodes.length) }, worker));
  res.json(durations);
});

app.get('/api/streaminfo/:showId/*', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const filePath = library.resolveEpisodeFile(req.params.showId, req.params[0]);
  if (!filePath) return res.status(404).json({ error: 'Not found' });
  if (!ffm.HAS_FFPROBE) {
    return res.json({ ffmpegAvailable: false, canPassthrough: true, audioTracks: [], subtitleTracks: [], duration: null, videoHeight: null });
  }
  try {
    const info = await getStreamInfo(filePath);
    // Whether a fully-built, Range-seekable cached copy (default audio,
    // original quality - what precache and first-play caching produce)
    // already exists for this file. When it does, the player can treat
    // playback as natively seekable: normal video.currentTime seeks, no
    // stream restarts, and subtitles that never need timestamp shifting.
    let cachedReady = false;
    try {
      const reencodeVideo = !info.videoCodecOk;
      const defAudio = info.defaultAudioIndex;
      const track = info.audioStreams ? info.audioStreams.find((a) => a.index === defAudio) : null;
      const copyAudio = !!(track && ffm.BROWSER_AUDIO_CODECS.has(track.codec));
      const opts = { audioStreamIndex: defAudio, targetHeight: null, reencodeVideo, hwaccel: hwaccelLib.detectHwAccel(config.hardwareAcceleration), copyAudio, audioChannels: track ? track.channels : null };
      const stat = await mediaIO.stat(filePath);
      cachedReady = fs.existsSync(path.join(STREAM_CACHE_DIR, `${computeCacheKey(filePath, stat.mtimeMs, opts)}.mp4`));
    } catch (e) { /* purely an optimization hint - absence is fine */ }
    res.json({
      ffmpegAvailable: true,
      cachedReady,
      canPassthrough: info.canPassthrough,
      videoCodecOk: info.videoCodecOk,
      duration: info.duration,
      defaultAudioIndex: info.defaultAudioIndex,
      chapters: info.chapters,
      audioTracks: info.audioStreams,
      subtitleTracks: info.subtitleStreams,
      videoWidth: info.videoWidth,
      videoHeight: info.videoHeight,
    });
  } catch (e) {
    // If probing fails for any reason, fall back to trying raw playback.
    res.json({ ffmpegAvailable: false, canPassthrough: true, audioTracks: [], subtitleTracks: [], duration: null, videoHeight: null, error: e.message });
  }
});

// Extracts one embedded subtitle track as WebVTT for the <track> element.
// Rewrites every cue timestamp in a WebVTT text by -shiftSeconds,
// dropping cues that end before the new zero and clamping ones that
// straddle it. Needed because seeking during a live transcode restarts
// the <video> element's clock at 0 (the stream literally begins at the
// seek point), while the subtitle file's timestamps are absolute episode
// times - without re-basing them, every cue after a seek is offset by
// exactly the seek amount, which looks like subtitles freezing or
// disappearing the moment you jump around.
// Strips styling junk that some ffmpeg versions leak into converted
// subtitles - ASS override blocks like {\an8} or {\c&H5A54D6&\pos(640,50)}
// (that &H..& is a hex color, which is exactly what shows on screen as
// "hex codes and numbers"), literal \N / \h escapes, and HTML font tags
// from styled SRT files. Cues that are nothing BUT styling (vector sign
// drawings, karaoke scaffolding) are dropped entirely.
// Recognizes ASS vector-drawing coordinate data directly by its shape
// (a single-letter drawing command - m/n/l/b/s/p/c - followed by 2+
// numbers, repeated multiple times in a row) rather than relying on
// the {\p1}...{\p0} marker tags ASS uses to mark drawing mode.
// Confirmed directly (via a real ffmpeg ASS-to-VTT conversion test)
// that ffmpeg always strips those exact marker tags during conversion
// but leaves the raw coordinate data behind as if it were dialogue -
// meaning a detector that depends on finding those tags can never
// actually match anything by the time this code runs. Requiring 2+
// consecutive command groups (not just 1) avoids stripping a genuine,
// if coincidental, short numeric phrase in real subtitle text.
function stripDrawingCommands(line) {
  const words = line.split(/\s+/);
  const isNumber = (w) => /^-?\d+(\.\d+)?$/.test(w);
  const isCmdLetter = (w) => /^[mnlbspc]$/i.test(w);
  const keep = new Array(words.length).fill(true);
  let i = 0;
  while (i < words.length) {
    if (isCmdLetter(words[i])) {
      const groupStart = i;
      let groupCount = 0;
      let j = i;
      while (j < words.length && isCmdLetter(words[j])) {
        let k = j + 1;
        let numCount = 0;
        while (k < words.length && isNumber(words[k])) { numCount++; k++; }
        if (numCount < 2) break; // not a valid drawing command (needs at least one coordinate pair)
        groupCount++;
        j = k;
      }
      if (groupCount >= 2) {
        for (let x = groupStart; x < j; x++) keep[x] = false;
        i = j;
        continue;
      }
    }
    i++;
  }
  return words.filter((w, idx) => keep[idx]).join(' ');
}

function sanitizeVttText(vtt) {
  const blocks = String(vtt).split(/\r?\n\r?\n/);
  const kept = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) { kept.push(block); continue; } // header/notes untouched
    const head = lines.slice(0, timingIdx + 1);
    const payload = lines.slice(timingIdx + 1)
      .map((l) => stripDrawingCommands(require('./subtitle-text').cleanSubtitleLine(l)))
      .filter((l) => l.length > 0);
    if (payload.length === 0) continue; // pure-styling/pure-drawing cue - drop it
    kept.push([...head, ...payload].join('\n'));
  }
  return kept.join('\n\n') + '\n';
}

function shiftVttTimestamps(vttText, shiftSeconds) {
  const parseTs = (ts) => {
    const m = ts.match(/(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})/);
    if (!m) return null;
    return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2], 10) * 60) + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
  };
  const fmtTs = (s) => {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600); const min = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60); const ms = Math.round((s % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };
  // Cue blocks are separated by blank lines; the timing line contains '-->'.
  const blocks = vttText.split(/\r?\n\r?\n/);
  const kept = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) { kept.push(block); continue; } // header/NOTE/STYLE blocks pass through
    const [startRaw, rest] = lines[timingIdx].split('-->');
    const settingsMatch = (rest || '').trim().match(/^(\S+)(.*)$/);
    const start = parseTs(startRaw.trim());
    const end = settingsMatch ? parseTs(settingsMatch[1]) : null;
    if (start === null || end === null) { kept.push(block); continue; }
    const newStart = start - shiftSeconds;
    const newEnd = end - shiftSeconds;
    if (newEnd <= 0) continue; // cue is entirely before the seek point
    lines[timingIdx] = `${fmtTs(newStart)} --> ${fmtTs(newEnd)}${settingsMatch[2] || ''}`;
    kept.push(lines.join('\n'));
  }
  return kept.join('\n\n');
}

// Subtitle extraction reads through the WHOLE media file (subtitle data
// is interleaved throughout the container), which takes seconds on a
// full-size episode. That used to run on EVERY subtitle enable and -
// worse - on every seek (whose re-based variant also buffered the whole
// extraction before sending anything), so subtitles went blank for many
// seconds after every jump, which looks exactly like them getting
// stuck. Extract once per file+track (keyed by mtime), cache the text,
// and every request after that - including every seek's re-based copy -
// is served instantly from the cache.
const SUBS_CACHE_DIR = path.join(DATA_DIR, 'subs-cache');
const inFlightSubs = new Map(); // key -> Promise<string>
async function getCachedSubtitle(filePath, trackIndex) {
  const stat = await mediaIO.stat(filePath);
  const key = crypto.createHash('md5').update(`${filePath}|${stat.mtimeMs}|sub${trackIndex}`).digest('hex');
  const cachedPath = path.join(SUBS_CACHE_DIR, `${key}.vtt`);
  if (fs.existsSync(cachedPath)) return Promise.resolve(fs.readFileSync(cachedPath, 'utf-8'));
  if (inFlightSubs.has(key)) return inFlightSubs.get(key);
  const promise = new Promise((resolve, reject) => {
    const proc = ffm.spawnSubtitleExtract({ filePath, subtitleStreamIndex: trackIndex });
    // Chunks are collected as Buffers and decoded ONCE at the end -
    // appending chunk-by-chunk as strings corrupts any multibyte
    // character (very much including Japanese subtitle text) that
    // happens to be split across a chunk boundary.
    const chunks = [];
    proc.stdout.on('data', (d) => { chunks.push(d); });
    proc.on('close', (code) => {
      const vtt = Buffer.concat(chunks).toString('utf-8');
      if (code !== 0 && !vtt.includes('WEBVTT')) return reject(new Error(`subtitle extraction exited ${code}`));
      try {
        fs.mkdirSync(SUBS_CACHE_DIR, { recursive: true });
        const tmp = `${cachedPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, vtt);
        fs.renameSync(tmp, cachedPath);
      } catch (e) { /* cache write is best-effort - still serve the text */ }
      resolve(vtt);
    });
    proc.on('error', reject);
  }).finally(() => inFlightSubs.delete(key));
  inFlightSubs.set(key, promise);
  return promise;
}

const assService = require('./ass-subtitles').createAssService({ directory: path.join(DATA_DIR, 'ass-cache'), probe: ffm.probe, trackLive: ffm.trackLive });
app.get('/api/ass/:showId/*', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const file = library.resolveEpisodeFile(req.params.showId, req.params[0]); const track = Number(req.query.track);
  if (!file || !Number.isInteger(track) || track < 0) return res.status(404).end();
  const manifest = await assService.manifest(file, track); res.set('Cache-Control', 'private, max-age=3600');
  if (req.query.manifest === '1') return res.json(manifest);
  if (req.query.font !== undefined) {
    const font = Number(req.query.font); if (!manifest.fonts.includes(font)) return res.status(404).end();
    return res.type('application/octet-stream').send(await assService.extract(file, font, true));
  }
  res.type('text/x-ass').send(await assService.extract(file, track));
});

app.get('/api/subtitle/:showId/*', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const filePath = library.resolveEpisodeFile(req.params.showId, req.params[0]);
  const trackIndex = parseInt(req.query.track, 10);
  if (!filePath || Number.isNaN(trackIndex)) return res.status(404).end();
  if (!ffm.HAS_FFMPEG) return res.status(501).json({ error: 'ffmpeg is not installed on this server' });
  const shift = parseFloat(req.query.shift) || 0;
  try {
    // Image-based subtitle formats (PGS from Blu-rays, DVD subs) are
    // literally pictures of text, not text data - ffmpeg's text-based
    // extraction can't convert them at all (that would need OCR, which
    // it doesn't do). It doesn't error out on these, it just silently
    // returns an essentially empty result, which looked exactly like
    // subtitles going fully blank with no indication why. Checking this
    // up front gives a clear, honest reason instead.
    const info = await getStreamInfo(filePath);
    const track = info && info.subtitleTracks && info.subtitleTracks.find((t) => t.index === trackIndex);
    if (track && track.imageBased) {
      return res.status(422).json({ error: `This subtitle track is an image-based format (${track.codec}) rather than text, so it can't be extracted or displayed - that would need OCR, which isn't supported. Try a different subtitle track if one's available.` });
    }
    const vtt = await getCachedSubtitle(filePath, trackIndex);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const cleaned = sanitizeVttText(vtt);
    res.end(shift > 0 ? shiftVttTimestamps(cleaned, shift) : cleaned);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const TRICKPLAY_DIR = path.join(DATA_DIR, 'trickplay');
const EPISODE_THUMBS_DIR = path.join(DATA_DIR, 'episode-thumbs');

// A real frame from ~20% into the episode, for episode lists. Serves the
// image directly (it IS the <img src>); browser caches it hard since the
// content is keyed by file mtime server-side.
app.get('/api/episode-thumb/:showId/*', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const filePath = library.resolveEpisodeFile(req.params.showId, req.params[0]);
  if (!filePath) return res.status(404).end();
  if (!ffm.HAS_FFMPEG) return res.status(501).end();
  try {
    let duration = null;
    if (ffm.HAS_FFPROBE) {
      try { const info = await getStreamInfo(filePath); duration = info && info.duration; } catch (e) { /* fall back to fixed offset */ }
    }
    const thumbPath = await episodeThumbs.getOrExtract(EPISODE_THUMBS_DIR, filePath, duration, transcodeLimiter.acquireSlot, ffm.trackLive);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    fs.createReadStream(thumbPath).pipe(res);
  } catch (e) {
    res.status(500).end();
  }
});


// Seek-bar preview thumbnails. First request for an episode kicks off
// (and waits for) the one-time sprite build; every request after that is
// an instant cache hit. The player calls this in the background after
// playback starts, so nothing about starting the video waits on it -
// the hover preview simply appears once it's ready.
app.get('/api/trickplay/:showId/*', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const filePath = library.resolveEpisodeFile(req.params.showId, req.params[0]);
  if (!filePath) return res.status(404).end();
  if (!ffm.HAS_FFMPEG || !ffm.HAS_FFPROBE) return res.status(501).json({ error: 'ffmpeg/ffprobe required' });
  try {
    const info = await getStreamInfo(filePath);
    if (!info || !info.duration) return res.status(422).json({ error: 'could not determine duration' });
    const { metaPath, key } = await trickplay.getOrBuild(TRICKPLAY_DIR, filePath, info.duration, transcodeLimiter.acquireSlot, ffm.trackLive);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    res.json({ ...meta, sprite: `/api/trickplay-sprite/${key}.jpg` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/trickplay-sprite/:file', (req, res) => {
  if (!requireAuth(req, res)) return;
  // Plain single param + strict whitelist (32 hex chars + .jpg) - both
  // safer against path tricks and portable across routers (patterns
  // like ':key.jpg' parse differently between router implementations).
  if (!/^[a-f0-9]{32}\.jpg$/.test(req.params.file)) return res.status(400).end();
  const spritePath = path.join(TRICKPLAY_DIR, req.params.file);
  if (!fs.existsSync(spritePath)) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400'); // keyed by file mtime, safe to cache hard
  fs.createReadStream(spritePath).pipe(res);
});

// Resolves the exact same transcode options the stream route would use
// for a given file + query params, so a pre-built cache entry's key
// matches the later real playback request byte-for-byte.
async function resolveTranscodeOpts(filePath, requestedAudio, requestedQuality, isMobile = false) {
  let info = null;
  if (ffm.HAS_FFPROBE) {
    try { info = await getStreamInfo(filePath); } catch (e) { info = null; }
  }
  const mobileNeedsVideoFix = !!(isMobile && info && info.videoCodec && info.videoCodec !== 'h264');
  const needsTranscode = !!(ffm.HAS_FFMPEG && (requestedAudio !== null || requestedQuality !== null || mobileNeedsVideoFix || (info && !info.canPassthrough)));
  const audioIndex = requestedAudio !== null ? requestedAudio : (info ? info.defaultAudioIndex : null);
  const reencodeVideo = !!(info && !info.videoCodecOk) || mobileNeedsVideoFix;
  const selectedAudioTrack = info && info.audioStreams ? info.audioStreams.find((a) => a.index === audioIndex) : null;
  const copyAudio = !!(selectedAudioTrack && ffm.BROWSER_AUDIO_CODECS.has(selectedAudioTrack.codec));
  const audioChannels = selectedAudioTrack ? selectedAudioTrack.channels : null;
  const hwaccel = hwaccelLib.detectHwAccel(config.hardwareAcceleration);
  return { needsTranscode, transcodeOpts: { audioStreamIndex: audioIndex, targetHeight: requestedQuality, reencodeVideo, hwaccel, copyAudio, audioChannels } };
}

// Pre-builds the cache for an episode the person is *about* to watch
// (the player calls this for the next episode partway through the
// current one), so "Next Episode" starts instantly - and, on mobile, so
// the guaranteed-compatible cached copy is already sitting there
// instead of needing to be built while they wait. Fire-and-forget:
// responds immediately, the build queues through the same concurrency
// limiter as everything else so it can never crowd out live playback.
app.post('/api/precache/:showId/*', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const filePath = library.resolveEpisodeFile(req.params.showId, req.params[0]);
  if (!filePath) return res.status(404).end();
  if (!ffm.HAS_FFMPEG) return res.json({ ok: true, skipped: 'no ffmpeg' });

  const requestedAudio = req.query.audio !== undefined ? parseInt(req.query.audio, 10) : null;
  const requestedQuality = req.query.quality && req.query.quality !== 'original' ? parseInt(req.query.quality, 10) : null;
  try {
    const { needsTranscode, transcodeOpts } = await resolveTranscodeOpts(filePath, requestedAudio, requestedQuality, isMobileUserAgent(req.headers['user-agent'], req.query.platformHint));
    if (!needsTranscode) return res.json({ ok: true, skipped: 'plays directly, nothing to build' });
    res.json({ ok: true, started: true });
    getCachedRemux(filePath, transcodeOpts).catch(() => {}); // background, best-effort
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// Stream a specific episode. Plays the raw file with HTTP range support
// (fast, native seeking) whenever the codecs are browser-safe; otherwise
// (or when a non-default audio track is requested) transcodes just the
// audio to AAC on the fly via ffmpeg while copying the video untouched.
// Starts (or resumes) an HLS session for an episode and returns where
// to find its playlist. Kept as a separate step from serving the
// playlist itself so the playlist/segment routes can be simple,
// stable URLs keyed only by the cache key - no query string to lose
// track of when a browser resolves the playlist's own relative
// segment references.
// Shared by every route that needs to resolve an episode and get (or
// lazily start) its HLS session for a given audio/quality combination -
// used by both the original single-quality hls-start route and the
// newer adaptive-bitrate routes below, so they can never drift out of
// sync on how a session actually gets resolved and started.
async function resolveAndStartHlsSession(showId, relPath, { audio, quality, startOffsetSeconds } = {}) {
  const filePath = library.resolveEpisodeFile(showId, relPath);
  if (!filePath) return { error: { status: 404, message: 'Episode not found' } };
  if (!ffm.HAS_FFMPEG) return { error: { status: 501, message: 'ffmpeg is not installed on this server' } };

  const requestedAudio = audio !== undefined && audio !== null && audio !== '' ? parseInt(audio, 10) : null;
  const requestedQuality = quality && quality !== 'original' ? parseInt(quality, 10) : null;
  let info = null;
  if (ffm.HAS_FFPROBE) {
    try { info = await getStreamInfo(filePath); } catch (e) { info = null; }
  }
  const audioIndex = requestedAudio !== null ? requestedAudio : (info ? info.defaultAudioIndex : null);
  // HLS/MPEG-TS only supports H.264 for video - unlike general browser
  // playback (where VP8/VP9/AV1 are also fine, just in a different
  // container like MP4/WebM), hls.js's transmuxer can't handle
  // anything else. info.videoCodecOk reflects general browser
  // compatibility, which incorrectly treated an AV1 source as not
  // needing re-encoding - the actual, complete root cause of AV1
  // playback failing throughout this investigation: the video was
  // being copied raw into HLS output, never actually transcoded to
  // H.264 at all, regardless of any decode-hwaccel setting (copy
  // skips decode entirely).
  const reencodeVideo = !!(info && (!info.videoCodecOk || info.videoCodec !== 'h264'));
  const selectedAudioTrack = info && info.audioStreams ? info.audioStreams.find((a) => a.index === audioIndex) : null;
  // HLS/MPEG-TS specifically requires AAC for audio - unlike general
  // browser playback (where Opus is also fine, just in a different
  // container like MP4/WebM), hls.js's transmuxer isn't built to parse
  // Opus inside an MPEG-TS segment. Reusing the general
  // browser-compatible codec set here let Opus source audio get copied
  // straight through into HLS output uncorrected, which is the actual,
  // confirmed cause of segments failing to parse as media - not a
  // decode, timing, or keyframe issue at all. Only AAC is safe to copy
  // here; anything else needs to be re-encoded.
  const copyAudio = !!(selectedAudioTrack && selectedAudioTrack.codec === 'aac');
  const audioChannels = selectedAudioTrack ? selectedAudioTrack.channels : null;
  const hwaccel = hwaccelLib.detectHwAccel(config.hardwareAcceleration);
  const transcodeOpts = { audioStreamIndex: audioIndex, targetHeight: requestedQuality, reencodeVideo, hwaccel, copyAudio, audioChannels, sourceVideoCodec: info ? info.videoCodec : null, startOffsetSeconds: startOffsetSeconds || 0 };

  const stat = await mediaIO.stat(filePath);
  const cacheKey = computeCacheKey(filePath, stat.mtimeMs, transcodeOpts);
  const session = getOrStartHlsSession(filePath, transcodeOpts, cacheKey);
  if (session.failed) return { error: { status: 500, message: 'HLS session failed to start - check the server log' } };
  return { filePath, cacheKey, session, info };
}

app.get('/api/hls-start/:showId/*', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const startOffsetSeconds = req.query.offset !== undefined ? Math.max(0, parseFloat(req.query.offset) || 0) : 0;
  const result = await resolveAndStartHlsSession(req.params.showId, req.params[0], { audio: req.query.audio, quality: req.query.quality, startOffsetSeconds });
  if (result.error) return res.status(result.error.status).json({ error: result.error.message });
  res.json({ playlistUrl: `/api/hls/${result.cacheKey}/playlist.m3u8`, startOffsetSeconds });
});

// Starts (lazily - only when this specific variant is actually
// requested, not upfront alongside the others) a session for one
// specific quality variant, then redirects to its playlist. Reusing
// the existing cacheKey-based playlist/segment routes via redirect
// (rather than serving directly from here) means every relative
// segment reference inside that playlist resolves exactly the way it
// already does for the existing single-quality path - no new
// segment-serving logic needed, and nothing to keep in sync with it.
app.get('/api/hls-variant/:showId/:targetHeight/*', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const quality = req.params.targetHeight === 'original' ? 'original' : req.params.targetHeight;
  const startOffsetSeconds = req.query.offset !== undefined ? Math.max(0, parseFloat(req.query.offset) || 0) : 0;
  const result = await resolveAndStartHlsSession(req.params.showId, req.params[0], { audio: req.query.audio, quality, startOffsetSeconds });
  if (result.error) return res.status(result.error.status).json({ error: result.error.message });
  res.setHeader('Location', `/api/hls/${result.cacheKey}/playlist.m3u8`);
  res.status(302).end();
});

// A handful of practical tiers, not many fine-grained ones - each
// additional tier is a fully separate transcode if a player ever
// switches to it, and this runs on a home server's own hardware, not
// a dedicated encoding farm. Rough, typical bitrate estimates per
// resolution (exact precision doesn't matter much - hls.js also
// adapts based on actually-measured download throughput over time, not
// just this initial declared value).
const ABR_TIERS = [
  { height: 1080, bandwidth: 4000000 },
  { height: 720, bandwidth: 2000000 },
  { height: 480, bandwidth: 1000000 },
];

app.get('/api/hls-master/:showId/*', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const filePath = library.resolveEpisodeFile(req.params.showId, req.params[0]);
  if (!filePath) return res.status(404).json({ error: 'Episode not found' });
  if (!ffm.HAS_FFMPEG) return res.status(501).json({ error: 'ffmpeg is not installed on this server' });
  let info = null;
  if (ffm.HAS_FFPROBE) {
    try { info = await getStreamInfo(filePath); } catch (e) { info = null; }
  }
  const sourceHeight = info ? info.videoHeight : null;
  const sourceWidth = info ? info.videoWidth : null;
  // Only tiers genuinely below the source's own height are useful -
  // upscaling never actually improves anything, just wastes an entire
  // extra transcode nobody benefits from.
  const applicableTiers = ABR_TIERS.filter((t) => sourceHeight && t.height < sourceHeight);
  const audioParam = req.query.audio !== undefined ? `&audio=${encodeURIComponent(req.query.audio)}` : '';
  const offsetParam = req.query.offset !== undefined ? `&offset=${encodeURIComponent(req.query.offset)}` : '';
  const relPathEncoded = req.params[0].split('/').map(encodeURIComponent).join('/');

  const lines = ['#EXTM3U', '#EXT-X-VERSION:6'];
  // Original always comes first - both as a sensible default starting
  // point and because most players initially pick from whichever
  // variant is listed first before they have any real throughput
  // measurement to go on yet.
  const originalBandwidth = sourceHeight >= 1080 ? 4500000 : sourceHeight >= 720 ? 2500000 : 1200000;
  lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${originalBandwidth}${sourceWidth && sourceHeight ? `,RESOLUTION=${sourceWidth}x${sourceHeight}` : ''}`);
  lines.push(`/api/hls-variant/${req.params.showId}/original/${relPathEncoded}?quality=original${audioParam}${offsetParam}`);
  for (const tier of applicableTiers) {
    const tierWidth = sourceWidth && sourceHeight ? Math.round((sourceWidth * tier.height) / sourceHeight / 2) * 2 : null; // even width, preserving aspect ratio
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${tier.bandwidth}${tierWidth ? `,RESOLUTION=${tierWidth}x${tier.height}` : ''}`);
    lines.push(`/api/hls-variant/${req.params.showId}/${tier.height}/${relPathEncoded}?quality=${tier.height}${audioParam}${offsetParam}`);
  }
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-store');
  res.end(lines.join('\n') + '\n');
});

const HLS_CACHE_KEY_RE = /^[a-f0-9]{32}$/; // computeCacheKey always produces an md5 hex digest
const HLS_FILENAME_RE = /^(playlist\.m3u8|seg\d{5}\.ts)$/; // exactly what spawnHlsTranscode ever produces

app.get('/api/hls/:cacheKey/playlist.m3u8', async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!HLS_CACHE_KEY_RE.test(req.params.cacheKey)) return res.status(400).end();
  const session = hlsSessions.get(req.params.cacheKey);
  if (!session) return res.status(404).json({ error: 'No active session for this stream - it may have timed out from inactivity. Reload to start a new one.' });
  session.lastAccessed = Date.now();

  const playlistPath = path.join(session.outputDir, 'playlist.m3u8');
  // A brand-new session needs a few seconds before ffmpeg has produced
  // even the first segment - poll briefly rather than handing back an
  // empty/nonexistent playlist immediately. Once a session is running,
  // subsequent playlist requests (a player re-fetches this
  // periodically to discover new segments) resolve instantly.
  const pollTimeoutMs = session.knownSlow ? 90000 : 30000;
  const pollStart = Date.now();
  let lastProgressLog = 0;
  while (!fs.existsSync(playlistPath) && Date.now() - pollStart < pollTimeoutMs) {
    if (session.failed) return res.status(500).json({ error: 'HLS transcode failed - check the server log' });
    const elapsed = Date.now() - pollStart;
    if (elapsed - lastProgressLog > 10000) {
      lastProgressLog = elapsed;
      const segCount = fs.existsSync(session.outputDir) ? fs.readdirSync(session.outputDir).filter((f) => f.endsWith('.ts')).length : 0;
      console.log(`[hls] still waiting on playlist for ${req.params.cacheKey} after ${(elapsed / 1000).toFixed(0)}s (${segCount} segment(s) written so far, timeout at ${pollTimeoutMs / 1000}s)`);
    }
    await sleep(250);
  }
  if (!fs.existsSync(playlistPath)) {
    console.log(`[hls] playlist request for ${req.params.cacheKey} timed out after ${pollTimeoutMs / 1000}s with no playlist ever produced (session ${session.failed ? 'marked failed' : 'still running'})`);
    return res.status(504).json({ error: 'Timed out waiting for the stream to start' });
  }
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  // no-store for the same reason as segments below - this playlist
  // genuinely changes on every re-fetch as more segments get produced,
  // and gets regenerated fresh with every new session against the same
  // cache key.
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(playlistPath).pipe(res);
});

app.get('/api/hls/:cacheKey/:segmentFile', async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!HLS_CACHE_KEY_RE.test(req.params.cacheKey) || !HLS_FILENAME_RE.test(req.params.segmentFile)) return res.status(400).end();
  const session = hlsSessions.get(req.params.cacheKey);
  if (!session) return res.status(404).end();
  session.lastAccessed = Date.now();

  const segmentPath = path.join(session.outputDir, req.params.segmentFile);
  // Checking only "does the file exist" isn't actually enough proof
  // it's ready to serve - ffmpeg's HLS muxer can add a segment to the
  // playlist very close to when it starts writing that segment's file,
  // not only once writing is fully complete, and a request landing in
  // that narrow window could read a file that exists but isn't
  // finished yet (this was a real, confirmed bug: it showed up as
  // "found no media" partway through an otherwise-working transcode,
  // once enough real playback time had passed for the timing to line
  // up). Since ffmpeg writes segments strictly in sequence, the
  // reliable signal that segment N is genuinely complete is that
  // segment N+1 has started, or the whole transcode has finished (if
  // this is the final segment) - not just that segment N's own file
  // happens to exist yet.
  const segMatch = req.params.segmentFile.match(/^seg(\d{5})\.ts$/);
  const nextSegmentPath = segMatch ? path.join(session.outputDir, `seg${String(parseInt(segMatch[1], 10) + 1).padStart(5, '0')}.ts`) : null;
  const playlistPath = path.join(session.outputDir, 'playlist.m3u8');
  function isSegmentReady() {
    if (!fs.existsSync(segmentPath)) return false;
    if (nextSegmentPath && fs.existsSync(nextSegmentPath)) return true; // the next segment has started, so this one is done
    // Otherwise this might be the last segment so far - only safe to
    // serve if the transcode has actually finished (ENDLIST present),
    // proving nothing more will ever be appended to this file.
    try { return fs.readFileSync(playlistPath, 'utf-8').includes('#EXT-X-ENDLIST'); } catch (e) { return false; }
  }
  const segmentPollTimeoutMs = session.knownSlow ? 120000 : 15000;
  const pollStart = Date.now();
  while (!isSegmentReady() && Date.now() - pollStart < segmentPollTimeoutMs) {
    await sleep(150);
  }
  if (!fs.existsSync(segmentPath)) return res.status(404).end();
  if (!isSegmentReady()) console.log(`[hls] serving ${req.params.segmentFile} for ${req.params.cacheKey} without full confirmation it's complete (timed out waiting) - may still be incomplete`);
  // Direct, server-side validation of the first few segments - runs in
  // the background so it doesn't delay the actual response. This
  // checks what's genuinely IN the segment file (real stream count,
  // codecs, actual frame/packet data) independent of how hls.js
  // interprets it - the only way to know for certain whether a segment
  // file itself is actually broken, versus something else being the
  // real problem.
  if (segMatch) {
    // Even once isSegmentReady() confirms this file is done (via the
    // next segment existing), there can be a brief window where the OS
    // hasn't fully flushed its buffer yet - reading it immediately in
    // that window can cause ffprobe to see a transient, not-yet-settled
    // state and misreport the stream. This delay is purely to make
    // this diagnostic accurate; it doesn't affect what's actually
    // served to the client above, which just streams the file as-is.
    setTimeout(() => {
      ffm.probe(segmentPath).then((info) => {
        // pix_fmt and profile specifically matter here: a 10-bit source
        // producing "High 10 Profile" output (instead of standard 8-bit
        // "High" profile) is a real, previously-confirmed failure mode
        // in this exact codebase where video is fundamentally
        // undecodable on most hardware decoders while audio (a
        // completely separate stream) plays fine - which is exactly
        // "audio and subtitles work, but no video" from the outside.
        const streams = (info.streams || []).map((s) => `${s.codec_type}:${s.codec_name}${s.codec_type === 'video' ? `(pix_fmt=${s.pix_fmt},profile=${s.profile})` : ''}(nb_frames=${s.nb_frames || 'N/A'})`).join(', ');
        console.log(`[hls] ffprobe validation of ${req.params.segmentFile} (${req.params.cacheKey}): streams=[${streams}], format_duration=${info.format && info.format.duration}`);
      }).catch((e) => {
        console.log(`[hls] ffprobe validation of ${req.params.segmentFile} (${req.params.cacheKey}) FAILED: ${e.message}`);
      });
    }, 1000);
  }
  res.setHeader('Content-Type', 'video/mp2t');
  // no-store (not just no-cache) specifically for segments - the same
  // cache key gets reused across separate attempts against the same
  // file, and each new session regenerates fresh segments from
  // scratch. no-cache still permits the browser to keep a copy and
  // just revalidate before use; no-store is the stronger guarantee
  // that actually prevents ever serving a stale, previously-cached
  // segment instead of hitting the server for the current one.
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(segmentPath).pipe(res);
});

app.get('/api/stream/:showId/*', async (req, res) => {
  console.log(`[stream] request received: showId=${req.params.showId} path=${req.params[0]} query=${JSON.stringify(req.query)}`);
  if (!requireAuth(req, res)) {
    console.log(`[stream] rejected - not signed in (cookie header present: ${!!req.headers.cookie})`);
    return;
  }
  const show = library.getShow(req.params.showId);
  if (!show) { console.log(`[stream] 404 - no show found for id "${req.params.showId}"`); return res.status(404).end(); }
  const filePath = library.resolveEpisodeFile(req.params.showId, req.params[0]);
  if (!filePath) { console.log(`[stream] 404 - couldn't resolve episode file for path "${req.params[0]}"`); return res.status(404).end(); }

  const requestedAudio = req.query.audio !== undefined ? parseInt(req.query.audio, 10) : null;
  const startSeconds = req.query.t !== undefined ? parseFloat(req.query.t) : 0;
  // quality=original (or absent) plays the source resolution untouched;
  // quality=1080/720/480/360/240 re-encodes video down to that height.
  const requestedQuality = req.query.quality && req.query.quality !== 'original' ? parseInt(req.query.quality, 10) : null;

  let info = null;
  if (ffm.HAS_FFPROBE) {
    const probeStart = Date.now();
    try { info = await getStreamInfo(filePath); } catch (e) { info = null; console.log(`[stream] ffprobe failed: ${e.message}`); }
    console.log(`[stream] ffprobe took ${Date.now() - probeStart}ms - canPassthrough=${info ? info.canPassthrough : 'n/a (probe failed)'} videoCodec=${info ? info.videoCodec : 'n/a'}`);
  } else {
    console.log('[stream] ffprobe not available (ffm.HAS_FFPROBE is false) - proceeding without stream info');
  }

  // AV1/VP9 play fine in desktop browsers so they pass straight through
  // there, but most iPhones/iPads can't decode AV1 at all - on mobile,
  // anything that isn't H.264 counts as needing the fix (and the
  // check must happen BEFORE the passthrough short-circuit below, or an
  // AV1 file in a clean MP4 would get raw-served to a phone anyway).
  const mobileClient = isMobileUserAgent(req.headers['user-agent'], req.query.platformHint);
  const mobileNeedsVideoFix = !!(mobileClient && info && info.videoCodec && info.videoCodec !== 'h264');
  const needsTranscode = !!(ffm.HAS_FFMPEG && (requestedAudio !== null || requestedQuality !== null || mobileNeedsVideoFix || (info && !info.canPassthrough)));

  if (!needsTranscode) {
    console.log(`[stream] direct passthrough (no transcode needed) - handing off to sendRawFile`);
    return sendRawFile(req, res, filePath);
  }
  console.log(`[stream] transcode needed - mobileClient=${mobileClient} requestedQuality=${requestedQuality} mobileNeedsVideoFix=${mobileNeedsVideoFix}`);

  const audioIndex = requestedAudio !== null ? requestedAudio : (info ? info.defaultAudioIndex : null);
  const reencodeVideo = !!(info && !info.videoCodecOk) || mobileNeedsVideoFix; // e.g. HEVC - copying it wouldn't fix anything
  // If the selected audio track is already a codec the browser can play,
  // copy it untouched rather than needlessly re-encoding it a second time
  // (which would only be a pointless extra lossy pass) - this matters
  // most for "just downscale the resolution" requests, where the audio
  // was very likely already fine to begin with.
  const selectedAudioTrack = info && info.audioStreams ? info.audioStreams.find((a) => a.index === audioIndex) : null;
  const copyAudio = !!(selectedAudioTrack && ffm.BROWSER_AUDIO_CODECS.has(selectedAudioTrack.codec));
  const audioChannels = selectedAudioTrack ? selectedAudioTrack.channels : null;
  const hwaccel = hwaccelLib.detectHwAccel(config.hardwareAcceleration);
  const transcodeOpts = { audioStreamIndex: audioIndex, targetHeight: requestedQuality, reencodeVideo, hwaccel, copyAudio, audioChannels };

  // A pure container fix (video/audio already fine, e.g. MKV with
  // H.264/AAC inside) is a fast stream copy - a couple of seconds even
  // for a full episode - so it's worth fully pre-caching before
  // responding: still-fast start, and it comes out fully Range-seekable
  // (which is what actually fixes mobile playback).
  // IMPORTANT: a request with a time offset (?t=...) comes from a player
  // in restart-the-stream seek mode - its clock (and its re-based
  // subtitles) assume the response BEGINS at that offset. Serving the
  // full cached file instead restarts the video at 0:00 while the player
  // still believes it's at the seek point - position and subtitles both
  // desync (subtitles visibly "stick"/show the wrong lines). So cached
  // copies are only served for offset-free requests; seeks transcode
  // live from the seek point, exactly as the player expects.
  // Mobile exception to the ?t= rule below: a live pipe doesn't play on
  // phones AT ALL, so for mobile clients the full cached file is served
  // even for offset requests - the current player never sends ?t= from
  // a phone (it seeks natively on the Range-capable file), so this only
  // matters for a stale cached copy of the app, where starting at the
  // wrong position still beats a black screen.
  const isFastToCache = !reencodeVideo && !requestedQuality && (!startSeconds || mobileClient);
  if (isFastToCache) {
    try {
      const cachedPath = await getCachedRemux(filePath, transcodeOpts);
      touchCacheFile(cachedPath);
      return sendRawFile(req, res, cachedPath);
    } catch (e) {
      console.log(`[stream] remux cache failed, falling back to live pipe: ${e.message}`);
      // fall through to the live-pipe path below
    }
  } else if (!startSeconds || mobileClient) {
    // A genuine re-encode (bad video codec, or a quality change) - if an
    // earlier playback already finished building this exact cache in
    // the background, use it immediately (fast AND Range-seekable).
    // (Skipped entirely for ?t= seek requests - see the note above.)
    const stat = await mediaIO.stat(filePath);
    const existingKey = computeCacheKey(filePath, stat.mtimeMs, transcodeOpts);
    const existingCachePath = path.join(STREAM_CACHE_DIR, `${existingKey}.mp4`);
    if (fs.existsSync(existingCachePath)) {
      touchCacheFile(existingCachePath);
      return sendRawFile(req, res, existingCachePath);
    }

    // Not cached yet. Mobile browsers (iOS Safari especially) need real
    // Range/Content-Length support to play video at all - an indefinite
    // live pipe just doesn't work reliably there, no matter how fast it
    // starts. Desktop/other browsers are much more tolerant of a live
    // pipe, so they keep the fast, instant-start experience below
    // completely unchanged. Only mobile waits for the (one-time) cache
    // build, in exchange for it actually playing.
    if (isMobileUserAgent(req.headers['user-agent'], req.query.platformHint)) {
      console.log(`[stream] mobile cache-first build starting for "${path.basename(filePath)}" (this waits for the full transcode before responding - if the log goes quiet here for a long time, that's the actual bottleneck)`);
      const buildStart = Date.now();
      try {
        const cachedPath = await getCachedRemux(filePath, transcodeOpts);
        console.log(`[stream] mobile cache-first build finished in ${((Date.now() - buildStart) / 1000).toFixed(1)}s`);
        touchCacheFile(cachedPath);
        return sendRawFile(req, res, cachedPath);
      } catch (e) {
        console.log(`[stream] mobile cache-first build failed after ${((Date.now() - buildStart) / 1000).toFixed(1)}s, falling back to live pipe: ${e.message}`);
        // fall through - a live pipe that might not work is still better than a hard failure
      }
    }
  }

  // Not cached (yet) and either a genuine re-encode, on a non-mobile
  // client, or the fast-cache/mobile-cache attempt above failed - stream
  // it live immediately (same snappy start as always) rather than
  // waiting for the whole thing, while *also* writing that same output
  // to the cache in the background. Nothing about this request waits on
  // the cache - it's purely so a replay of the same file/settings later
  // is instant and fully Range-seekable, without slowing down the
  // current playback at all.
  //
  // A live transcode keeps using CPU for as long as it's playing, so a
  // concurrency slot is held for the whole viewing session (not just a
  // quick burst) - that's what actually reflects real, ongoing resource
  // usage, and is what keeps a burst of simultaneous plays from
  // overloading whatever hardware this is running on.
  const slotAbort = new AbortController();
  const cancelSlot = () => slotAbort.abort();
  res.once('close', cancelSlot);
  let releaseSlot;
  try { releaseSlot = await transcodeLimiter.acquireSlot({ signal: slotAbort.signal }); }
  catch (error) { if (!res.destroyed) res.status(error.status || 503).json({ error: error.message }); return; }
  finally { res.removeListener('close', cancelSlot); }
  if (res.destroyed || res.writableEnded) { releaseSlot(); return; } // client gave up while queued
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');
  const proc = ffm.spawnTranscode({ ...transcodeOpts, filePath, startSeconds });
  proc.stdout.pipe(res);
  proc.stderr.on('data', () => { /* swallow ffmpeg progress logs */ });
  proc.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  proc.on('close', releaseSlot);
  res.on('close', () => { try { proc.kill('SIGKILL'); } catch (e) { /* noop */ } });

  if (!startSeconds) tapStreamIntoCache(proc, filePath, transcodeOpts);
});

// ---------- Manga library ----------
app.get('/api/manga', (req, res) => {
  if (!requireAuth(req, res)) return;
  // Like /api/anime, this intentionally returns full objects (including
  // `chapters`) rather than a stripped summary - the frontend caches this
  // list in Store.manga and reuses it on the detail/reader pages, so it
  // needs chapter data available without a second round-trip per title.
  sendCachedList(req, res, 'manga', () => library.cache.manga);
});

app.get('/api/manga/:id', (req, res) => {
  if (!requireAuth(req, res)) return;
  const m = library.getManga(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

app.get('/api/manga/:id/pages/:chapter', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const m = library.getManga(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const chapterName = req.params.chapter;
  const chapMeta = m.chapters.find((c) => c.name === chapterName);
  const info = library.getChapterInfo(req.params.id, chapterName);
  if (!chapMeta || !info) return res.status(404).json({ error: 'Chapter not found' });

  // Every format normalizes to the same shape: an array of opaque "page
  // tokens" the client passes straight back to the page-serving route
  // below. For images, tokens are real filenames (unchanged from before);
  // for cbz/epub/pdf, tokens are just the 1-based page number as a string,
  // and the route below re-derives the real page from that index.
  if (info.type === 'images') {
    const files = (await mediaIO.readdir(info.fullPath))
      .filter((f) => config.imageExtensions.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return res.json({ chapter: chapterName, format: 'images', pages: files });
  }
  const pages = Array.from({ length: chapMeta.pageCount }, (_, i) => String(i + 1));
  res.json({ chapter: chapterName, format: info.type, pages, pdfSupported: info.type === 'pdf' ? pdfLib.HAS_PDFTOPPM : undefined });
});

const PDF_CACHE_DIR = path.join(DATA_DIR, 'pdf-cache');

// Serve a single manga page image, regardless of source format.
app.get('/api/manga/:id/page/:chapter/:file', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const chapter = req.params.chapter, name = req.params.file;
  const info = library.getChapterInfo(req.params.id, chapter);
  if (!info) return res.status(404).end();
  if (info.type === 'images') {
    const file = library.resolveMangaPage(req.params.id, chapter, name);
    if (!file || !isWithin(info.fullPath, file)) return res.status(400).end();
    const [root, actual] = await Promise.all([mediaIO.realpath(info.fullPath), mediaIO.realpath(file)]);
    if (!isWithin(root, actual)) return res.status(400).end();
    return sendRawFile(req, res, file);
  }
  const number = Number(name);
  if (!Number.isInteger(number) || number < 1 || number > 100000) return res.status(400).end();
  const page = await mediaIO.operation('page', info.fullPath, 20000, { format: info.type, number, extensions: config.imageExtensions, cacheRoot: PDF_CACHE_DIR });
  res.type(page.mime).send(Buffer.from(page.data));
});

app.get('/api/manga/:id/pdf/:chapter', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const info = library.getChapterInfo(req.params.id, req.params.chapter);
  if (!info || info.type !== 'pdf') return res.status(404).end();
  res.set('Content-Disposition', 'inline');
  return sendRawFile(req, res, info.fullPath);
});

// ---------- Media assets (covers / banners) ----------
app.get('/media-asset/anime/:id/:file', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const showDir = library.getShowDir(req.params.id);
  if (!showDir) return res.status(404).end();
  const filePath = path.join(showDir, req.params.file);
  const resolved = path.resolve(filePath);
  if (!isWithin(showDir, resolved)) return res.status(400).end();
  try {
    const [actualRoot, actualFile] = await Promise.all([mediaIO.realpath(typeof showDir === 'undefined' ? dir : showDir), mediaIO.realpath(resolved)]);
    if (!isWithin(actualRoot, actualFile)) return res.status(400).end();
    await mediaIO.stat(resolved);
  } catch (error) { return res.status(error.status || 503).json({ error: error.message }); }
  res.set('Cache-Control', 'private, max-age=3600');
  return sendRawFile(req, res, resolved);
});

app.get('/media-asset/movies/:id/:file', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const showDir = library.getShowDir(req.params.id);
  if (!showDir) return res.status(404).end();
  const filePath = path.join(showDir, req.params.file);
  const resolved = path.resolve(filePath);
  if (!isWithin(showDir, resolved)) return res.status(400).end();
  try {
    const [actualRoot, actualFile] = await Promise.all([mediaIO.realpath(typeof showDir === 'undefined' ? dir : showDir), mediaIO.realpath(resolved)]);
    if (!isWithin(actualRoot, actualFile)) return res.status(400).end();
    await mediaIO.stat(resolved);
  } catch (error) { return res.status(error.status || 503).json({ error: error.message }); }
  res.set('Cache-Control', 'private, max-age=3600');
  return sendRawFile(req, res, resolved);
});

app.get('/media-asset/manga/:id/:file', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const dir = library.getMangaDir(req.params.id);
  if (!dir) return res.status(404).end();
  const filePath = path.join(dir, req.params.file);
  const resolved = path.resolve(filePath);
  if (!isWithin(dir, resolved)) return res.status(400).end();
  try {
    const [actualRoot, actualFile] = await Promise.all([mediaIO.realpath(typeof showDir === 'undefined' ? dir : showDir), mediaIO.realpath(resolved)]);
    if (!isWithin(actualRoot, actualFile)) return res.status(400).end();
    await mediaIO.stat(resolved);
  } catch (error) { return res.status(error.status || 503).json({ error: error.message }); }
  res.set('Cache-Control', 'private, max-age=3600');
  return sendRawFile(req, res, resolved);
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  res.status(error.status || (error.code === 'ENOENT' ? 404 : 500)).json({ error: error.message || 'Request failed' });
});

// Fallback to SPA index for client-side routes
const indexHtmlPath = path.join(BASE_DIR, 'public', 'index.html');
function renderVersionedIndexHtml() {
  let html = fs.readFileSync(indexHtmlPath, 'utf-8');
  // A single, explicit build version (not each file's own mtime, which
  // proved unreliable - see the BUILD_VERSION comment above) applied
  // uniformly to every local script/stylesheet reference. Still a
  // genuinely different URL each time this constant is bumped, so no
  // existing cache entry can serve it stale - just no longer dependent
  // on filesystem timestamp behavior to know when that's needed. Only
  // touches local /js and /css references - external CDN URLs (the
  // Google Cast SDK, hls.js) are left untouched.
  html = html.replace(/(src|href)="(\/(?:js|css)\/[^"]+)"/g, (match, attr, localPath) => `${attr}="${localPath}?v=${BUILD_VERSION}"`);
  return html;
}
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/media-asset/')) return next();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(renderVersionedIndexHtml());
});

const PORT = process.env.PORT || config.port || 4821;
// Starts either a plain HTTP server (default) or, when certificate and
// key paths are configured, an HTTPS server using Node's built-in TLS -
// no extra dependencies, and on any modern CPU the encryption overhead
// is negligible next to video streaming itself. The certificate is
// re-read automatically when the file changes, so Let's Encrypt-style
// renewals (every 60-90 days) apply without restarting the server.
function startServer(app2, port, onReady) {
  if (!httpsActive) return app2.listen(port, onReady);
  const readTls = () => ({
    cert: fs.readFileSync(config.https.certPath),
    key: fs.readFileSync(config.https.keyPath),
  });
  const handler = typeof app2 === 'function' ? app2 : app2.handle && app2.handle.bind(app2);
  const server = https.createServer(readTls(), handler);
  let reloadTimer = null;
  try {
    fs.watch(path.dirname(config.https.certPath), () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        try {
          server.setSecureContext(readTls());
          console.log('[https] certificate reloaded (renewal picked up without restart)');
        } catch (e) {
          console.error(`[https] certificate reload failed, keeping the previous one: ${e.message}`);
        }
      }, 2000);
    }).on('error', () => { /* watch is best-effort - renewals then need a restart */ });
  } catch (e) { /* same */ }
  return server.listen(port, onReady);
}

(async () => {
  const httpServer = startServer(app, PORT, () => {
    console.log('');
    console.log('  ================================================');
    console.log(`   ${config.siteName} is running`);
    // A direct, unmistakable way to confirm exactly which build is
    // actually running - update this string with each meaningful
    // delivery. Given how many times a stale/mismatched server
    // deployment has turned out to be the real explanation for "the
    // fix didn't work" throughout this project's troubleshooting, this
    // is a single, unambiguous fact to check rather than inferring it
    // from behavior.
    console.log(`   Build marker: ${BUILD_VERSION}`);
    console.log(`   ${httpsActive ? 'https' : 'http'}://localhost:${PORT}${httpsActive ? '  (TLS enabled)' : ''}`);
    console.log(`   Settings file (the live one): ${CONFIG_PATH}`);
    console.log(`   Accounts/profiles stored in: ${DATA_DIR}`);
    for (const [kind, root] of [['Anime', library.animeRoot], ['Movies', library.movieRoot], ['Manga', library.mangaRoot]]) {
      console.log(`   ${kind} folder: ${root} (checked by background scanner)`);
    }
    console.log(`   Anime titles found: ${library.cache.anime.length}`);
    console.log(`   Movie titles found: ${library.cache.movies.length}`);
    console.log(`   Manga titles found: ${library.cache.manga.length}`);
    if (ffm.HAS_FFMPEG) {
      const hw = hwaccelLib.detectHwAccel(config.hardwareAcceleration); // also warms the cache
      console.log(`   Video transcoding: ${hw.label}`);
      transcodeLimiter.setHardwareAccelActive(hw.type !== 'none');
    }
    console.log('  ================================================');
    console.log('');
    scanLibrary().then(() => {
      checkAndNotifyNewEpisodes();
      if (Object.values(library.scanStatus).every(status => status.state === 'ready')) {
        autoEnrichLibrary().then(() => backfillMissingMetadata());
        checkMissingDubStatus();
      }
    }).catch(error => console.error('[scanner] startup scan failed:', error));
    changePoller.start();
    const pollMin = config.autoScanIntervalMinutes || 0;
    console.log(pollMin > 0
      ? `[auto-rescan] also checking for new media every ${pollMin} min (catches changes made on a network share from other machines, which a file watcher can't see)`
      : '[auto-rescan] periodic new-media check is off (autoScanIntervalMinutes = 0)');
    accountsStore.pruneExpiredSessions(); // clear session rows from devices that never came back
    autoBackupIfDue(); // daily database backup (accounts/profiles/history)
    setInterval(autoBackupIfDue, 60 * 60 * 1000); // re-check hourly so long-running servers back up daily
  });
  watchParty.attach(httpServer, { authenticate: getAccountFromRequest });
})();
