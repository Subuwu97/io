// Detects when a show/manga gains new episodes/chapters between scans, so
// an automatic notification can go out to let people know - but only for
// titles someone is actually tracking (in their My List, Top Picks, or
// has watch progress on), and never on the very first scan of a fresh
// library (which would otherwise fire a notification for every single
// title you already own).
const { db } = require('./db');

function isFirstRun() {
  return db.prepare('SELECT COUNT(*) AS n FROM episode_count_tracker').get().n === 0;
}

function isAnyoneTracking(itemId) {
  return !!(
    db.prepare('SELECT 1 FROM my_list WHERE item_id = ? LIMIT 1').get(itemId) ||
    db.prepare('SELECT 1 FROM top_picks WHERE item_id = ? LIMIT 1').get(itemId) ||
    db.prepare('SELECT 1 FROM progress WHERE item_id = ? LIMIT 1').get(itemId)
  );
}

// items: [{ id, title, episodeCount }] - episodeCount for anime/movies,
// chapterCount for manga (caller passes whichever applies as episodeCount).
function checkForNewEpisodes(items, itemType) {
  const firstRun = isFirstRun();
  const getStmt = db.prepare('SELECT episode_count FROM episode_count_tracker WHERE item_id = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO episode_count_tracker (item_id, item_type, episode_count, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET episode_count = excluded.episode_count, updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  const newlyAdded = [];

  // A large library (thousands of titles) means thousands of individual
  // upserts here - each one auto-committed on its own triggers a disk
  // fsync, which measured out to multiple *seconds* of pure blocking
  // time at ~1,700 titles (vs under 10ms wrapped in one transaction).
  // That blocking time was very likely the exact "hiccup" felt on every
  // rescan, since this runs on every single one.
  db.exec('BEGIN');
  try {
    for (const item of items) {
      const prev = getStmt.get(item.id);
      if (!firstRun && prev && item.episodeCount > prev.episode_count && isAnyoneTracking(item.id)) {
        newlyAdded.push({ id: item.id, title: item.title, addedCount: item.episodeCount - prev.episode_count, itemType });
      }
      upsertStmt.run(item.id, itemType, item.episodeCount, now);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return newlyAdded;
}

module.exports = { checkForNewEpisodes };
