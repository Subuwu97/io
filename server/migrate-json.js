// One-time migration: if this install still has the old JSON-file storage
// (accounts.json/profiles.json from before the SQLite switch) and hasn't
// been migrated yet, import everything into the new database so nobody
// loses their accounts, profiles, watch history, reviews, or comments
// when updating. The original JSON files are renamed to .migrated rather
// than deleted, just in case.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { db } = require('./db');

function migrateIfNeeded() {
  const accountsJsonPath = path.join(DATA_DIR, 'accounts.json');
  const profilesJsonPath = path.join(DATA_DIR, 'profiles.json');
  if (!fs.existsSync(accountsJsonPath) && !fs.existsSync(profilesJsonPath)) return;

  const alreadyHasData = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n > 0;
  if (alreadyHasData) return; // don't double-import if the DB already has accounts

  console.log('[migrate] found old JSON data files - importing into SQLite...');
  let importedAccounts = 0;
  let importedProfiles = 0;

  const accountsData = fs.existsSync(accountsJsonPath)
    ? JSON.parse(fs.readFileSync(accountsJsonPath, 'utf-8'))
    : { accounts: [], sessions: {} };
  const profilesData = fs.existsSync(profilesJsonPath)
    ? JSON.parse(fs.readFileSync(profilesJsonPath, 'utf-8'))
    : { profiles: [], activeProfileIdByAccount: {} };

  const insertAccount = db.prepare(`
    INSERT INTO accounts (id, username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const a of accountsData.accounts || []) {
    try {
      insertAccount.run(a.id, a.username, a.passwordHash, a.salt, a.role, a.createdAt);
      importedAccounts++;
    } catch (e) {
      console.log(`[migrate] skipped account "${a.username}": ${e.message}`);
    }
  }

  const insertProfile = db.prepare(`
    INSERT INTO profiles (id, account_id, name, handle, avatar, banner, status, pin, is_kids, created_at, watched_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMyList = db.prepare('INSERT OR IGNORE INTO my_list (profile_id, item_type, item_id) VALUES (?, ?, ?)');
  const insertTopPick = db.prepare('INSERT OR IGNORE INTO top_picks (profile_id, item_type, item_id) VALUES (?, ?, ?)');
  const insertProgress = db.prepare(`
    INSERT OR IGNORE INTO progress (profile_id, item_id, episode_rel_path, seconds, duration, updated_at) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertReview = db.prepare(`
    INSERT OR IGNORE INTO reviews (id, profile_id, item_id, item_type, rating, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertComment = db.prepare('INSERT OR IGNORE INTO comments (id, profile_id, text, created_at) VALUES (?, ?, ?, ?)');

  for (const p of profilesData.profiles || []) {
    try {
      insertProfile.run(
        p.id, p.accountId, p.name, p.handle || '', p.avatar || '', p.banner || '',
        p.status || '', p.pin || null, p.isKids ? 1 : 0, p.createdAt, p.watchedSeconds || 0
      );
      importedProfiles++;
      for (const key of p.myList || []) {
        const [itemType, itemId] = key.split(':');
        if (itemType && itemId) insertMyList.run(p.id, itemType, itemId);
      }
      for (const key of p.topPicks || []) {
        const [itemType, itemId] = key.split(':');
        if (itemType && itemId) insertTopPick.run(p.id, itemType, itemId);
      }
      for (const [itemId, prog] of Object.entries(p.progress || {})) {
        insertProgress.run(p.id, itemId, prog.episodeRelPath, prog.seconds, prog.duration, prog.updatedAt);
      }
      for (const r of p.reviews || []) {
        insertReview.run(r.id, p.id, r.itemId, r.itemType, r.rating, r.text || '', r.createdAt);
      }
      for (const c of p.comments || []) {
        insertComment.run(c.id, p.id, c.text, c.createdAt);
      }
    } catch (e) {
      console.log(`[migrate] skipped profile "${p.name}": ${e.message}`);
    }
  }

  const activeStmt = db.prepare('INSERT OR REPLACE INTO active_profile (account_id, profile_id) VALUES (?, ?)');
  for (const [accountId, profileId] of Object.entries(profilesData.activeProfileIdByAccount || {})) {
    try { activeStmt.run(accountId, profileId); } catch (e) { /* ignore */ }
  }

  console.log(`[migrate] imported ${importedAccounts} account(s) and ${importedProfiles} profile(s)`);

  // Keep the old files as a backup rather than deleting them outright.
  for (const p of [accountsJsonPath, profilesJsonPath]) {
    if (fs.existsSync(p)) fs.renameSync(p, p + '.migrated');
  }
  console.log('[migrate] old JSON files renamed to *.migrated (kept as backup)');
}

module.exports = { migrateIfNeeded };
