const crypto = require('crypto');
const { db, addSearchHistory, getSearchHistory, clearSearchHistory } = require('./db');

// All reads/writes below are scoped to a single accountId so one
// household member never sees or edits another's profiles, watch
// history, or My List - each account has its own independent set,
// exactly like separate accounts on a shared streaming service.

// Assembles the full profile object (in the same shape the frontend has
// always expected) by combining the profiles row with everything that
// lives in its related tables.
function hydrateProfile(row) {
  if (!row) return null;
  const myList = db.prepare('SELECT item_type, item_id FROM my_list WHERE profile_id = ?').all(row.id)
    .map((r) => `${r.item_type}:${r.item_id}`);
  const topPicks = db.prepare('SELECT item_type, item_id FROM top_picks WHERE profile_id = ?').all(row.id)
    .map((r) => `${r.item_type}:${r.item_id}`);
  const progress = {};
  for (const p of db.prepare('SELECT * FROM progress WHERE profile_id = ?').all(row.id)) {
    progress[p.item_id] = { episodeRelPath: p.episode_rel_path, seconds: p.seconds, duration: p.duration, updatedAt: p.updated_at, hidden: !!p.hidden };
  }
  const mangaProgress = {};
  for (const p of db.prepare('SELECT * FROM manga_progress WHERE profile_id = ?').all(row.id)) {
    mangaProgress[p.manga_id] = { chapterName: p.chapter_name, page: p.page, totalPages: p.total_pages, updatedAt: p.updated_at };
  }
  const reviews = db.prepare('SELECT * FROM reviews WHERE profile_id = ? ORDER BY created_at DESC').all(row.id)
    .map((r) => ({ id: r.id, itemId: r.item_id, itemType: r.item_type, rating: r.rating, text: r.text, createdAt: r.created_at }));
  const comments = db.prepare('SELECT * FROM comments WHERE profile_id = ? ORDER BY created_at DESC').all(row.id)
    .map((c) => ({ id: c.id, text: c.text, createdAt: c.created_at }));
  const watchedEpisodes = db.prepare('SELECT item_id, episode_rel_path FROM watched_episodes WHERE profile_id = ?').all(row.id)
    .map((r) => `${r.item_id}:${r.episode_rel_path}`);

  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    handle: row.handle,
    avatar: row.avatar,
    banner: row.banner,
    status: row.status,
    hasPin: !!row.pin,
    isKids: !!row.is_kids,
    createdAt: row.created_at,
    watchedSeconds: row.watched_seconds,
    preferredAudioLang: row.preferred_audio_lang || null,
    preferredSubtitleLang: row.preferred_subtitle_lang || null,
    autoplayNext: row.autoplay_next === null || row.autoplay_next === undefined ? true : !!row.autoplay_next,
    subtitleSize: row.subtitle_size || 'medium',
    subtitleColor: row.subtitle_color || '#ffffff',
    subtitleBg: row.subtitle_bg || 'box',
    topPicks,
    myList,
    progress,
    mangaProgress,
    watchedEpisodes,
    reviews,
    comments,
  };
}

function getRow(accountId, id) {
  return db.prepare('SELECT * FROM profiles WHERE account_id = ? AND id = ?').get(accountId, id);
}

// A 4-digit PIN only has 10,000 possible values - without a limiter here,
// an automated script could brute-force any profile's PIN in well under a
// minute, silently defeating whatever it's meant to restrict (kids-mode
// content, in practice). Deliberately tighter than the login limiter:
// legitimate users essentially never mistype a 4-digit PIN more than
// once or twice, so 5 attempts is generous for them while making a brute
// force attempt impractically slow (10,000 possibilities at 5 guesses
// per 5-minute lockout is many hours minimum, and that's before an
// attacker would give up).
const failedPinAttempts = new Map(); // "accountId:profileId" -> { count, lockedUntil }
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 5 * 60 * 1000;

function checkPinAllowed(accountId, id) {
  const entry = failedPinAttempts.get(`${accountId}:${id}`);
  if (entry && entry.lockedUntil && entry.lockedUntil > Date.now()) {
    const waitMin = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    throw new Error(`Too many incorrect PIN attempts. Try again in ${waitMin} minute${waitMin === 1 ? '' : 's'}.`);
  }
}

// Checks a PIN against the raw stored value (never exposed to the
// client via hydrateProfile). Profiles without a PIN set always pass.
function verifyPin(accountId, id, pin) {
  checkPinAllowed(accountId, id);
  const row = getRow(accountId, id);
  if (!row) return false;
  if (!row.pin) return true;
  const key = `${accountId}:${id}`;
  const correct = String(pin || '') === String(row.pin);
  if (correct) {
    failedPinAttempts.delete(key);
  } else {
    const entry = failedPinAttempts.get(key) || { count: 0, lockedUntil: 0 };
    entry.count++;
    if (entry.count >= PIN_MAX_ATTEMPTS) {
      entry.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
      entry.count = 0;
    }
    failedPinAttempts.set(key, entry);
  }
  return correct;
}

function listProfiles(accountId) {
  return db.prepare('SELECT * FROM profiles WHERE account_id = ? ORDER BY created_at ASC').all(accountId).map(hydrateProfile);
}

function getProfile(accountId, id) {
  return hydrateProfile(getRow(accountId, id));
}

function createProfile(accountId, { name, avatar, banner, isKids, autoplayNext }) {
  const existingCount = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE account_id = ?').get(accountId).n;
  if (existingCount >= 5) throw new Error('Maximum of 5 profiles reached');

  const id = 'p' + crypto.randomBytes(4).toString('hex');
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO profiles (id, account_id, name, handle, avatar, banner, status, pin, is_kids, created_at, watched_seconds, autoplay_next)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?)
  `).run(
    id, accountId,
    name || 'New Profile',
    (name || 'user').replace(/\s+/g, ''),
    avatar || '/img/avatars/avatar1.svg',
    banner || '/img/banners/banner1.svg',
    "Set a custom status (double-click to edit)...",
    isKids ? 1 : 0,
    createdAt,
    autoplayNext === false ? 0 : 1
  );
  return hydrateProfile(getRow(accountId, id));
}

function updateProfile(accountId, id, patch) {
  const row = getRow(accountId, id);
  if (!row) throw new Error('Profile not found');
  const columnMap = { name: 'name', handle: 'handle', avatar: 'avatar', banner: 'banner', status: 'status', pin: 'pin', isKids: 'is_kids', autoplayNext: 'autoplay_next' };
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(columnMap)) {
    if (key in patch) {
      sets.push(`${column} = ?`);
      values.push((key === 'isKids' || key === 'autoplayNext') ? (patch[key] ? 1 : 0) : patch[key]);
    }
  }
  if (sets.length > 0) {
    values.push(accountId, id);
    db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE account_id = ? AND id = ?`).run(...values);
  }
  return hydrateProfile(getRow(accountId, id));
}

function deleteProfile(accountId, id) {
  db.prepare('DELETE FROM profiles WHERE account_id = ? AND id = ?').run(accountId, id);
  db.prepare('DELETE FROM active_profile WHERE account_id = ? AND profile_id = ?').run(accountId, id);
}

function deleteAllForAccount(accountId) {
  // profiles rows cascade-delete their my_list/top_picks/progress/reviews/comments
  db.prepare('DELETE FROM profiles WHERE account_id = ?').run(accountId);
  db.prepare('DELETE FROM active_profile WHERE account_id = ?').run(accountId);
}

function setActiveProfile(accountId, id) {
  db.prepare('INSERT INTO active_profile (account_id, profile_id) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET profile_id = excluded.profile_id')
    .run(accountId, id);
}

function getActiveProfile(accountId) {
  const active = db.prepare('SELECT profile_id FROM active_profile WHERE account_id = ?').get(accountId);
  if (!active) return null;
  return hydrateProfile(getRow(accountId, active.profile_id));
}

function requireProfile(accountId, profileId) {
  const row = getRow(accountId, profileId);
  if (!row) throw new Error('Profile not found');
  return row;
}

function addSearchHistoryForProfile(accountId, profileId, query) {
  requireProfile(accountId, profileId);
  addSearchHistory(profileId, query);
}
function getSearchHistoryForProfile(accountId, profileId) {
  requireProfile(accountId, profileId);
  return getSearchHistory(profileId);
}
function clearSearchHistoryForProfile(accountId, profileId) {
  requireProfile(accountId, profileId);
  clearSearchHistory(profileId);
}

function toggleMyList(accountId, profileId, itemId, itemType) {
  requireProfile(accountId, profileId);
  const existing = db.prepare('SELECT 1 FROM my_list WHERE profile_id = ? AND item_type = ? AND item_id = ?').get(profileId, itemType, itemId);
  if (existing) {
    db.prepare('DELETE FROM my_list WHERE profile_id = ? AND item_type = ? AND item_id = ?').run(profileId, itemType, itemId);
  } else {
    db.prepare('INSERT INTO my_list (profile_id, item_type, item_id) VALUES (?, ?, ?)').run(profileId, itemType, itemId);
  }
  return db.prepare('SELECT item_type, item_id FROM my_list WHERE profile_id = ?').all(profileId).map((r) => `${r.item_type}:${r.item_id}`);
}

function setProgress(accountId, profileId, itemId, episodeRelPath, seconds, duration) {
  requireProfile(accountId, profileId);
  const updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO progress (profile_id, item_id, episode_rel_path, seconds, duration, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, item_id) DO UPDATE SET
      episode_rel_path = excluded.episode_rel_path,
      seconds = excluded.seconds,
      duration = excluded.duration,
      updated_at = excluded.updated_at,
      hidden = 0
  `).run(profileId, itemId, episodeRelPath, seconds, duration, updatedAt);
  return { episodeRelPath, seconds, duration, updatedAt };
}

// Manga equivalent of setProgress - "Continue Reading" needs to know
// which chapter and page you were last on for a given title.
function setMangaProgress(accountId, profileId, mangaId, chapterName, page, totalPages) {
  requireProfile(accountId, profileId);
  const updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO manga_progress (profile_id, manga_id, chapter_name, page, total_pages, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, manga_id) DO UPDATE SET
      chapter_name = excluded.chapter_name,
      page = excluded.page,
      total_pages = excluded.total_pages,
      updated_at = excluded.updated_at
  `).run(profileId, mangaId, chapterName, page, totalPages, updatedAt);
  return { chapterName, page, totalPages, updatedAt };
}

// Remembers which audio/subtitle language this profile picked last, so
// the next episode (of any show) defaults to it automatically instead
// of always falling back to the file's own default track - the same
// "remember my language" behavior Crunchyroll/Netflix have.
function setLanguagePreferences(accountId, profileId, { audioLang, subtitleLang }) {
  requireProfile(accountId, profileId);
  const sets = [];
  const values = [];
  if (audioLang !== undefined) { sets.push('preferred_audio_lang = ?'); values.push(audioLang); }
  if (subtitleLang !== undefined) { sets.push('preferred_subtitle_lang = ?'); values.push(subtitleLang); }
  if (sets.length === 0) return;
  values.push(accountId, profileId);
  db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE account_id = ? AND id = ?`).run(...values);
}

// Persist a freshly-uploaded avatar/banner image URL onto a profile.
function setImageField(accountId, profileId, field, url) {
  requireProfile(accountId, profileId);
  const column = field === 'avatar' ? 'avatar' : 'banner';
  db.prepare(`UPDATE profiles SET ${column} = ? WHERE account_id = ? AND id = ?`).run(url, accountId, profileId);
  return hydrateProfile(getRow(accountId, profileId));
}

function toggleTopPick(accountId, profileId, itemId, itemType) {
  requireProfile(accountId, profileId);
  const existing = db.prepare('SELECT 1 FROM top_picks WHERE profile_id = ? AND item_type = ? AND item_id = ?').get(profileId, itemType, itemId);
  if (existing) {
    db.prepare('DELETE FROM top_picks WHERE profile_id = ? AND item_type = ? AND item_id = ?').run(profileId, itemType, itemId);
  } else {
    const count = db.prepare('SELECT COUNT(*) AS n FROM top_picks WHERE profile_id = ?').get(profileId).n;
    if (count >= 5) throw new Error('You can only pin up to 5 top picks - remove one first');
    db.prepare('INSERT INTO top_picks (profile_id, item_type, item_id) VALUES (?, ?, ?)').run(profileId, itemType, itemId);
  }
  return db.prepare('SELECT item_type, item_id FROM top_picks WHERE profile_id = ?').all(profileId).map((r) => `${r.item_type}:${r.item_id}`);
}

function addReview(accountId, profileId, { itemId, itemType, rating, text }) {
  requireProfile(accountId, profileId);
  const stars = Math.max(1, Math.min(5, parseInt(rating, 10) || 5));
  const id = 'rv' + crypto.randomBytes(4).toString('hex');
  const createdAt = new Date().toISOString();
  // Replace any existing review for the same title rather than stacking dupes.
  db.prepare('DELETE FROM reviews WHERE profile_id = ? AND item_id = ? AND item_type = ?').run(profileId, itemId, itemType);
  db.prepare(`
    INSERT INTO reviews (id, profile_id, item_id, item_type, rating, text, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, profileId, itemId, itemType, stars, (text || '').slice(0, 2000), createdAt);
  return { id, itemId, itemType, rating: stars, text: (text || '').slice(0, 2000), createdAt };
}

// All reviews left on one specific title, across every profile on the
// server - joined with the reviewer's name/avatar so the title's own
// page can show who said what, not just "someone rated this 4 stars".
function getReviewsForItem(itemId, itemType) {
  const rows = db.prepare(`
    SELECT reviews.id, reviews.rating, reviews.text, reviews.created_at, profiles.name AS reviewer_name, profiles.avatar AS reviewer_avatar
    FROM reviews JOIN profiles ON profiles.id = reviews.profile_id
    WHERE reviews.item_id = ? AND reviews.item_type = ?
    ORDER BY reviews.created_at DESC
  `).all(itemId, itemType);
  return rows.map((r) => ({ id: r.id, rating: r.rating, text: r.text, createdAt: r.created_at, reviewerName: r.reviewer_name, reviewerAvatar: r.reviewer_avatar }));
}

function deleteReview(accountId, profileId, reviewId) {
  requireProfile(accountId, profileId);
  db.prepare('DELETE FROM reviews WHERE profile_id = ? AND id = ?').run(profileId, reviewId);
}

function addComment(accountId, profileId, text) {
  requireProfile(accountId, profileId);
  const trimmed = (text || '').trim().slice(0, 500);
  if (!trimmed) throw new Error('Comment cannot be empty');
  const id = 'cm' + crypto.randomBytes(4).toString('hex');
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO comments (id, profile_id, text, created_at) VALUES (?, ?, ?, ?)').run(id, profileId, trimmed, createdAt);
  return { id, text: trimmed, createdAt };
}

function deleteComment(accountId, profileId, commentId) {
  requireProfile(accountId, profileId);
  db.prepare('DELETE FROM comments WHERE profile_id = ? AND id = ?').run(profileId, commentId);
}

// Aggregates real watch time across every profile on the server (not
// just one account) for a "Most Watched" row - genuine usage from this
// household, not a fake global trending list. Only returns item ids and
// totals, never which profile watched what.
function getMostWatched(limit = 12) {
  const rows = db.prepare(`
    SELECT item_id, COUNT(DISTINCT profile_id) AS viewers, SUM(seconds) AS total_seconds
    FROM progress
    WHERE seconds > 30
    GROUP BY item_id
    ORDER BY total_seconds DESC
    LIMIT ?
  `).all(limit);
  return rows.map((r) => ({ itemId: r.item_id, viewers: r.viewers, totalSeconds: r.total_seconds }));
}

// Marks a specific episode as watched (idempotent - rewatching just
// bumps the timestamp). Used both by the automatic "reached ~90%"
// tracking during normal viewing and the manual "Mark as Watched" button.
function markEpisodeWatched(accountId, profileId, itemId, itemType, episodeRelPath, episodeTitle, durationSeconds) {
  requireProfile(accountId, profileId);
  const watchedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO watched_episodes (profile_id, item_id, item_type, episode_rel_path, episode_title, watched_at, duration_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, item_id, episode_rel_path) DO UPDATE SET watched_at = excluded.watched_at, episode_title = excluded.episode_title,
      duration_seconds = COALESCE(excluded.duration_seconds, watched_episodes.duration_seconds)
  `).run(profileId, itemId, itemType, episodeRelPath, episodeTitle || null, watchedAt, durationSeconds || null);
  return { itemId, episodeRelPath, watchedAt };
}

function markEpisodeUnwatched(accountId, profileId, itemId, episodeRelPath) {
  requireProfile(accountId, profileId);
  db.prepare('DELETE FROM watched_episodes WHERE profile_id = ? AND item_id = ? AND episode_rel_path = ?').run(profileId, itemId, episodeRelPath);
}

function getWatchHistory(accountId, profileId, limit = 100) {
  requireProfile(accountId, profileId);
  const rows = db.prepare(`
    SELECT * FROM watched_episodes WHERE profile_id = ? ORDER BY watched_at DESC LIMIT ?
  `).all(profileId, limit);
  return rows.map((r) => ({
    itemId: r.item_id,
    itemType: r.item_type,
    episodeRelPath: r.episode_rel_path,
    episodeTitle: r.episode_title,
    watchedAt: r.watched_at,
  }));
}

// Persists the profile's chosen subtitle appearance (font size / color),
// applied via a <style> block with the ::cue pseudo-element in the player.
function setSubtitleAppearance(accountId, profileId, { size, color, bg }) {
  requireProfile(accountId, profileId);
  const sets = [];
  const values = [];
  if (size !== undefined) { sets.push('subtitle_size = ?'); values.push(size); }
  if (color !== undefined) { sets.push('subtitle_color = ?'); values.push(color); }
  if (bg !== undefined) { sets.push('subtitle_bg = ?'); values.push(bg); }
  if (sets.length === 0) return;
  values.push(accountId, profileId);
  db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE account_id = ? AND id = ?`).run(...values);
}

// Personal watch stats for one profile - total time (only counting
// episodes where we actually know the duration), episode count, and the
// list of watched item ids so the caller can cross-reference genres
// against the library (which lives in memory, not the database).
function getWatchStats(profileId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS episode_count, COALESCE(SUM(duration_seconds), 0) AS total_seconds
    FROM watched_episodes WHERE profile_id = ?
  `).get(profileId);
  const itemIds = db.prepare('SELECT DISTINCT item_id FROM watched_episodes WHERE profile_id = ?').all(profileId).map((r) => r.item_id);
  return { episodeCount: row.episode_count, totalSeconds: row.total_seconds, itemIds };
}

// Same, but across every profile on the server - for the "your whole
// household" half of the stats page.
function getServerWideWatchStats() {
  const row = db.prepare(`
    SELECT COUNT(*) AS episode_count, COALESCE(SUM(duration_seconds), 0) AS total_seconds
    FROM watched_episodes
  `).get();
  return { episodeCount: row.episode_count, totalSeconds: row.total_seconds };
}

// "Remove from Continue Watching" - hides the row entry without deleting
// the actual resume position, so if they start watching the show again
// later it reappears (setProgress clears the flag) and still resumes
// exactly where they left off, matching what people expect from the
// same button on the big streaming services.
function hideFromContinueWatching(accountId, profileId, itemId) {
  requireProfile(accountId, profileId);
  db.prepare('UPDATE progress SET hidden = 1 WHERE profile_id = ? AND item_id = ?').run(profileId, itemId);
}

module.exports = {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  deleteAllForAccount,
  setActiveProfile,
  getActiveProfile,
  toggleMyList,
  setProgress,
  addSearchHistoryForProfile,
  getSearchHistoryForProfile,
  clearSearchHistoryForProfile,
  setMangaProgress,
  setLanguagePreferences,
  setImageField,
  toggleTopPick,
  addReview,
  getReviewsForItem,
  deleteReview,
  addComment,
  deleteComment,
  verifyPin,
  getMostWatched,
  markEpisodeWatched,
  markEpisodeUnwatched,
  getWatchHistory,
  setSubtitleAppearance,
  hideFromContinueWatching,
  getWatchStats,
  getServerWideWatchStats,
};
