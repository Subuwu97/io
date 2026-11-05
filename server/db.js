// Real SQL storage for accounts, profiles, sessions, watch history,
// reviews, comments, and lists - using Node's built-in `node:sqlite`
// module, so this needs zero extra npm dependencies (same philosophy as
// the rest of this project). The database file lives in the same
// persistent data directory as everything else (see paths.js), so it
// survives app updates exactly like accounts.json used to.
const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('./paths');

// node:sqlite is stable enough for our needs but still flagged
// "experimental" by Node itself; that one specific warning is expected
// and not worth alarming users with on every startup, so it's filtered
// out here while everything else still surfaces normally. Node installs
// its own default listener that prints warnings straight to stderr, so
// that has to be removed before a filtering listener can actually hide
// anything (just adding another listener wouldn't stop the default one).
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
  console.warn(warning);
});
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(DATA_DIR, 'io.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');
// Without a busy timeout, a write that lands while another connection
// holds the lock fails *immediately* with SQLITE_BUSY instead of just
// waiting a few milliseconds - with several people using the server at
// once (progress saves fire constantly during playback) that turns rare
// timing collisions into user-visible errors for no reason.
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    adult_content_allowed INTEGER NOT NULL DEFAULT 1
  );

  -- One-time-use recovery codes for when the authenticator device
  -- itself is lost - stored hashed, the same reasoning as a password,
  -- never in plain text.
  CREATE TABLE IF NOT EXISTS totp_backup_codes (
    account_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, code_hash)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);

  CREATE TABLE IF NOT EXISTS active_profile (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    profile_id TEXT
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    handle TEXT,
    avatar TEXT,
    banner TEXT,
    status TEXT,
    pin TEXT,
    is_kids INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    watched_seconds REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_profiles_account ON profiles(account_id);

  CREATE TABLE IF NOT EXISTS my_list (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    PRIMARY KEY (profile_id, item_type, item_id)
  );

  CREATE TABLE IF NOT EXISTS top_picks (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    PRIMARY KEY (profile_id, item_type, item_id)
  );

  -- When the scanner actually first noticed each item, independent of
  -- the file/folder's own filesystem timestamp - download tools,
  -- torrent clients, and archive extractors often preserve the
  -- ORIGINAL release date rather than setting it to when the file
  -- landed on this machine, which makes filesystem-timestamp-based
  -- "recently added" sorting show stale results for genuinely new
  -- additions. This is set once, the first time an item's id is seen,
  -- and never changes after that, regardless of any later rescans.
  CREATE TABLE IF NOT EXISTS first_seen (
    item_id TEXT PRIMARY KEY,
    first_seen_at TEXT NOT NULL
  );

  -- Same reasoning as first_seen above, but per-episode rather than
  -- per-show: a new episode 15 landing in a show that's been in the
  -- library for months is genuinely different from a newly-added show,
  -- and needs its own "when did this specific episode actually show
  -- up" tracking to support a real "recently added episodes" feature.
  CREATE TABLE IF NOT EXISTS episode_first_seen (
    episode_key TEXT PRIMARY KEY,
    show_id TEXT NOT NULL,
    first_seen_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_episode_first_seen_at ON episode_first_seen (first_seen_at DESC);

  CREATE TABLE IF NOT EXISTS progress (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    episode_rel_path TEXT,
    seconds REAL,
    duration REAL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, item_id)
  );

  -- Manga reading progress, mirroring the video progress table above, so
  -- manga gets the same "Continue Reading" experience anime gets as
  -- "Continue Watching".
  CREATE TABLE IF NOT EXISTS manga_progress (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    manga_id TEXT NOT NULL,
    chapter_name TEXT NOT NULL,
    page INTEGER NOT NULL,
    total_pages INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, manga_id)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    rating INTEGER NOT NULL,
    text TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_profile ON reviews(profile_id);

  -- Admin-curated home page rows with any custom name ("Staff Picks",
  -- "Truck Kun's Top Picks", etc.) - server-wide, shown to everyone,
  -- distinct from the existing per-profile "Top Pick" feature.
  CREATE TABLE IF NOT EXISTS curated_rows (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS curated_row_items (
    row_id TEXT NOT NULL REFERENCES curated_rows(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (row_id, item_id, item_type)
  );
  CREATE INDEX IF NOT EXISTS idx_curated_row_items_row ON curated_row_items(row_id);

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_comments_profile ON comments(profile_id);

  -- Site-wide announcements an admin posts (e.g. "New season added!"),
  -- visible to every profile on every account. Read state is tracked per
  -- profile so each person's unread bell count is their own.
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT,
    created_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notification_reads (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, notification_id)
  );

  -- Remembers each show's episode count from the last scan, purely so a
  -- rescan can tell "this show just gained episodes" and post an
  -- automatic notification to anyone actually watching it.
  CREATE TABLE IF NOT EXISTS episode_count_tracker (
    item_id TEXT PRIMARY KEY,
    item_type TEXT NOT NULL,
    episode_count INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Whether a show has an English dub, detected once per show (not
  -- re-probed on every scan, which would mean checking audio tracks on
  -- potentially thousands of titles every single time) via ffprobe on
  -- its first episode, then reused from then on.
  CREATE TABLE IF NOT EXISTS audio_lang_cache (
    item_id TEXT PRIMARY KEY,
    has_dub INTEGER NOT NULL,
    checked_at TEXT NOT NULL
  );

  -- Whether a show has a Jellyfin series logo available, and whether
  -- it's already been downloaded locally - checked once per show
  -- rather than querying the Jellyfin server on every single title
  -- page load.
  CREATE TABLE IF NOT EXISTS series_logo_cache (
    item_id TEXT PRIMARY KEY,
    has_logo INTEGER NOT NULL,
    checked_at TEXT NOT NULL,
    title TEXT
  );

  -- Recent search queries per profile, for quick-access suggestions on
  -- the search page. Capped and deduplicated at write time (see
  -- addSearchHistory below) rather than needing cleanup elsewhere.
  CREATE TABLE IF NOT EXISTS search_history (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    searched_at TEXT NOT NULL
  );

  -- Per-episode watched state - separate from the "progress" table above,
  -- which only ever remembers a single current position per show.  This
  -- is a real set of "this specific episode is done" flags, which is
  -- what both "Mark as Watched" (any episode, not just the current one)
  -- and a genuine Watch History log need. Filled in both automatically
  -- (reaching ~90% of an episode during normal viewing) and manually.
  CREATE TABLE IF NOT EXISTS watched_episodes (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    episode_rel_path TEXT NOT NULL,
    episode_title TEXT,
    watched_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, item_id, episode_rel_path)
  );
  CREATE INDEX IF NOT EXISTS idx_watched_episodes_profile ON watched_episodes(profile_id, watched_at DESC);
`);

// Columns added after the table already existed in older installs need a
// separate ALTER TABLE - CREATE TABLE IF NOT EXISTS only helps for a
// brand new database. Each is wrapped individually so one already
// existing doesn't stop the others from being added.
function addColumnIfMissing(table, column, definition) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
}
addColumnIfMissing('sessions', 'user_agent', 'TEXT');
addColumnIfMissing('accounts', 'totp_secret', 'TEXT');
addColumnIfMissing('accounts', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('accounts', 'adult_content_allowed', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('series_logo_cache', 'title', 'TEXT');
addColumnIfMissing('accounts', 'approved', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('sessions', 'last_seen', 'INTEGER');
addColumnIfMissing('profiles', 'autoplay_next', 'INTEGER');
addColumnIfMissing('profiles', 'subtitle_size', 'TEXT');
addColumnIfMissing('profiles', 'subtitle_color', 'TEXT');
addColumnIfMissing('watched_episodes', 'duration_seconds', 'REAL');
addColumnIfMissing('progress', 'hidden', 'INTEGER');
addColumnIfMissing('profiles', 'subtitle_bg', 'TEXT');
addColumnIfMissing('profiles', 'preferred_audio_lang', 'TEXT');
addColumnIfMissing('profiles', 'preferred_subtitle_lang', 'TEXT');
// NULL = site-wide (the existing admin-broadcast behavior, unchanged) -
// non-NULL targets a single profile, needed for per-profile new-episode
// alerts without introducing a second, separate notification system.
addColumnIfMissing('notifications', 'profile_id', 'TEXT');
addColumnIfMissing('notifications', 'link', 'TEXT');

// Returns the recorded first-seen timestamp for an item, or - the
// Returns the recorded first-seen timestamp for an item, or - the
// first time this id is ever passed in - records a timestamp for it
// (see getOrRecordFirstSeen below for exactly which one and why).
const getFirstSeenStmt = db.prepare('SELECT first_seen_at FROM first_seen WHERE item_id = ?');
const insertFirstSeenStmt = db.prepare('INSERT INTO first_seen (item_id, first_seen_at) VALUES (?, ?)');
const countFirstSeenStmt = db.prepare('SELECT COUNT(*) AS n FROM first_seen');

// True only for the very first scan this feature has ever run against
// (an empty table) - not recomputed per item, since inserting the
// first item would otherwise make the table non-empty for every
// subsequent one in the same scan.
function firstSeenTableIsEmpty() {
  return countFirstSeenStmt.get().n === 0;
}

function getOrRecordFirstSeen(itemId, fileTimestampIso, isInitialMigration) {
  const row = getFirstSeenStmt.get(itemId);
  if (row) return row.first_seen_at;
  // An existing library upgrading to this feature has every title
  // "new" to this table on that one scan - seeding all of them with
  // "now" would stamp everything with the same moment, collapsing
  // whatever real relative order they already had into effectively
  // random. Falling back to each file's own timestamp for that one-time
  // migration preserves their existing relative order instead. Once
  // that migration is done, any genuinely new item uses "now" - which
  // is what actually protects it from a misleadingly old preserved
  // file timestamp (a downloaded/torrented file's timestamp is often
  // the original release date, not when it landed on this machine).
  const value = (isInitialMigration && fileTimestampIso) ? fileTimestampIso : new Date().toISOString();
  try {
    insertFirstSeenStmt.run(itemId, value);
  } catch (e) {
    // Two concurrent scan workers raced to insert the same id - the one
    // that lost just reads back whatever the winner actually recorded.
    const existing = getFirstSeenStmt.get(itemId);
    if (existing) return existing.first_seen_at;
  }
  return value;
}

const getEpisodeFirstSeenStmt = db.prepare('SELECT first_seen_at FROM episode_first_seen WHERE episode_key = ?');
const insertEpisodeFirstSeenStmt = db.prepare('INSERT INTO episode_first_seen (episode_key, show_id, first_seen_at) VALUES (?, ?, ?)');
const countEpisodeFirstSeenStmt = db.prepare('SELECT COUNT(*) AS n FROM episode_first_seen');
const recentEpisodesStmt = db.prepare('SELECT episode_key, show_id, first_seen_at FROM episode_first_seen ORDER BY first_seen_at DESC LIMIT ?');
const deleteEpisodeFirstSeenForShowStmt = db.prepare('DELETE FROM episode_first_seen WHERE show_id = ? AND episode_key NOT IN (SELECT value FROM json_each(?))');

function episodeFirstSeenTableIsEmpty() {
  return countEpisodeFirstSeenStmt.get().n === 0;
}

// Same reasoning as getOrRecordFirstSeen above, applied per-episode -
// see that function's comments for the full explanation of why the
// one-time migration seeds from the file's own timestamp while
// anything genuinely new afterward uses "now" instead.
function getOrRecordEpisodeFirstSeen(episodeKey, showId, fileTimestampIso, isInitialMigration) {
  const row = getEpisodeFirstSeenStmt.get(episodeKey);
  if (row) return row.first_seen_at;
  const value = (isInitialMigration && fileTimestampIso) ? fileTimestampIso : new Date().toISOString();
  try {
    insertEpisodeFirstSeenStmt.run(episodeKey, showId, value);
  } catch (e) {
    const existing = getEpisodeFirstSeenStmt.get(episodeKey);
    if (existing) return existing.first_seen_at;
  }
  return value;
}

// The most recently-seen episodes across the whole library, most
// recent first - this is what actually powers "recently added
// episodes", as distinct from "recently added shows": a new episode of
// a series that's been in the library for months belongs here even
// though the show itself isn't new.
function getRecentEpisodes(limit) {
  return recentEpisodesStmt.all(limit);
}

// Removes tracking for episodes that no longer exist for a show (a
// deleted/renamed file) - keeps this table from growing forever with
// entries for files that aren't there anymore, and stops a stale entry
// from ever resurfacing in "recently added" if a same-named file were
// ever re-added later expecting fresh "first seen" treatment.
function pruneEpisodeFirstSeenForShow(showId, currentEpisodeKeys) {
  deleteEpisodeFirstSeenForShowStmt.run(showId, JSON.stringify(currentEpisodeKeys));
}

// Profiles "following" a show for the purposes of a new-episode alert -
// on their list, in Top Picks, or with any watch progress on it at
// all. Any of these signals means genuine interest; someone who's
// never touched a show at all shouldn't get pinged just because it
// exists in the library.
const getFollowingProfilesStmt = db.prepare(`
  SELECT profile_id FROM my_list WHERE item_type = ? AND item_id = ?
  UNION
  SELECT profile_id FROM progress WHERE item_id = ?
  UNION
  SELECT profile_id FROM top_picks WHERE item_id = ?
`);
function getFollowingProfiles(itemId, itemType) {
  return getFollowingProfilesStmt.all(itemType, itemId, itemId, itemId).map((r) => r.profile_id);
}

// Dub-availability cache - read all cached results at once (for the
// browse list to annotate every card in one query, not one query per
// card), and find which shows haven't been checked yet so the
// background checker only ever probes what it genuinely doesn't know.
const getAllAudioLangCacheStmt = db.prepare('SELECT item_id, has_dub FROM audio_lang_cache');
const setAudioLangCacheStmt = db.prepare(`
  INSERT INTO audio_lang_cache (item_id, has_dub, checked_at) VALUES (?, ?, ?)
  ON CONFLICT(item_id) DO UPDATE SET has_dub = excluded.has_dub, checked_at = excluded.checked_at
`);
function getAllAudioLangCache() {
  const map = {};
  for (const row of getAllAudioLangCacheStmt.all()) map[row.item_id] = !!row.has_dub;
  return map;
}

const getSeriesLogoCacheStmt = db.prepare('SELECT has_logo, checked_at, title FROM series_logo_cache WHERE item_id = ?');
const setSeriesLogoCacheStmt = db.prepare(`
  INSERT INTO series_logo_cache (item_id, has_logo, checked_at, title) VALUES (?, ?, ?, ?)
  ON CONFLICT(item_id) DO UPDATE SET has_logo = excluded.has_logo, checked_at = excluded.checked_at, title = excluded.title
`);
const clearSeriesLogoCacheStmt = db.prepare('DELETE FROM series_logo_cache WHERE item_id = ?');
const SERIES_LOGO_RECHECK_MS = 7 * 24 * 60 * 60 * 1000; // a negative result naturally expires and gets re-checked after a week, rather than being permanent forever - someone adding a logo in Jellyfin after an earlier "no logo" check would otherwise never see that reflected
// currentTitle is required - a mismatch against whatever title the
// cached result was actually checked under means a title change
// happened since (a re-match to a different AniList/MAL entry, a
// manual correction, a duplicate getting resolved) - the cached
// result, whether it was a hit or a miss, no longer corresponds to
// what should actually be searched for in Jellyfin, so it's treated
// as never checked rather than trusted.
function getSeriesLogoCache(itemId, currentTitle) {
  const row = getSeriesLogoCacheStmt.get(itemId);
  if (!row) return null; // never checked
  if (row.title !== currentTitle) return null; // checked under a different title since - stale regardless of what it found
  if (!row.has_logo && Date.now() - new Date(row.checked_at).getTime() > SERIES_LOGO_RECHECK_MS) return null; // stale negative result - treat as never checked, worth trying again
  return !!row.has_logo;
}
function clearSeriesLogoCache(itemId) {
  clearSeriesLogoCacheStmt.run(itemId);
}
function setSeriesLogoCache(itemId, hasLogo, title) {
  setSeriesLogoCacheStmt.run(itemId, hasLogo ? 1 : 0, new Date().toISOString(), title || null);
}
function setAudioLangCache(itemId, hasDub) {
  setAudioLangCacheStmt.run(itemId, hasDub ? 1 : 0, new Date().toISOString());
}

const SEARCH_HISTORY_LIMIT = 15;
const deleteSearchHistoryQueryStmt = db.prepare('DELETE FROM search_history WHERE profile_id = ? AND query = ?');
const insertSearchHistoryStmt = db.prepare('INSERT INTO search_history (profile_id, query, searched_at) VALUES (?, ?, ?)');
const getSearchHistoryStmt = db.prepare('SELECT query FROM search_history WHERE profile_id = ? ORDER BY searched_at DESC LIMIT ?');
const trimSearchHistoryStmt = db.prepare(`
  DELETE FROM search_history WHERE profile_id = ? AND searched_at NOT IN (
    SELECT searched_at FROM search_history WHERE profile_id = ? ORDER BY searched_at DESC LIMIT ?
  )
`);
function addSearchHistory(profileId, query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return;
  deleteSearchHistoryQueryStmt.run(profileId, trimmed); // re-searching something bumps it to the top rather than duplicating
  insertSearchHistoryStmt.run(profileId, trimmed, new Date().toISOString());
  trimSearchHistoryStmt.run(profileId, profileId, SEARCH_HISTORY_LIMIT); // trimmed at write time, not left to grow unbounded
}
function getSearchHistory(profileId) {
  return getSearchHistoryStmt.all(profileId, SEARCH_HISTORY_LIMIT).map((r) => r.query);
}
function clearSearchHistory(profileId) {
  db.prepare('DELETE FROM search_history WHERE profile_id = ?').run(profileId);
}

module.exports = {
  db, DB_PATH, getOrRecordFirstSeen, firstSeenTableIsEmpty,
  getOrRecordEpisodeFirstSeen, episodeFirstSeenTableIsEmpty, getRecentEpisodes, pruneEpisodeFirstSeenForShow,
  getFollowingProfiles, getAllAudioLangCache, setAudioLangCache, getSeriesLogoCache, setSeriesLogoCache, clearSeriesLogoCache,
  addSearchHistory, getSearchHistory, clearSearchHistory,
};
