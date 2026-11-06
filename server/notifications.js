// Site-wide notifications an admin can post (e.g. "New season added!" or
// a maintenance heads-up) - visible to every profile on every account,
// with per-profile read tracking so each person's unread bell count is
// their own. Also supports notifications targeted at one specific
// profile (profile_id set) - used for automatic new-episode alerts,
// which only make sense for the person actually following that show,
// not everyone on the server.
const crypto = require('crypto');
const { db } = require('./db');
let deliveryHook=null;

function listForProfile(profileId, limit = 50) {
  const rows = db.prepare(`
    SELECT n.*, r.read_at
    FROM notifications n
    LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.profile_id = ?
    WHERE n.profile_id IS NULL OR n.profile_id = ?
    ORDER BY n.created_at DESC
    LIMIT ?
  `).all(profileId, profileId, limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    message: r.message,
    createdAt: r.created_at,
    read: !!r.read_at,
    targeted: !!r.profile_id, // lets the frontend allow the owning profile to dismiss it, not just an admin
    link: r.link || null,
    category:r.category||'announcements',
  }));
}

function unreadCount(profileId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM notifications n
    LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.profile_id = ?
    WHERE (n.profile_id IS NULL OR n.profile_id = ?) AND r.notification_id IS NULL
  `).get(profileId, profileId);
  return row.n;
}

function create({ title, message, createdBy, profileId = null, link = null, category='announcements' }) {
  const trimmedTitle = (title || '').trim();
  if (!trimmedTitle) throw new Error('Title is required');
  if (trimmedTitle.length > 120) throw new Error('Title is too long (max 120 characters)');
  const trimmedMessage = (message || '').trim().slice(0, 1000);
  const id = 'nt' + crypto.randomBytes(6).toString('hex');
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO notifications (id, title, message, created_by, created_at, profile_id, link) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, trimmedTitle, trimmedMessage, createdBy, createdAt, profileId, link);
  if(!['episodes','seasons','upcoming','announcements'].includes(category))category='announcements';
  db.prepare('UPDATE notifications SET category=? WHERE id=?').run(category,id);
  const notification={ id, title: trimmedTitle, message: trimmedMessage, createdAt, read: false, targeted: !!profileId, profileId, link,category };
  deliveryHook?.(notification);return notification;
}

// A profile can remove its own targeted notification (a personal new-
// episode alert, not a site-wide announcement) - scoped to profile_id
// so this can never be used to delete someone else's, or a site-wide
// one meant for everyone.
function removeOwnTargeted(profileId, id) {
  db.prepare('DELETE FROM notifications WHERE id = ? AND profile_id = ?').run(id, profileId);
}

function remove(id) {
  db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
}

function markRead(profileId, notificationId) {
  db.prepare('INSERT OR IGNORE INTO notification_reads (profile_id, notification_id, read_at) VALUES (?, ?, ?)')
    .run(profileId, notificationId, new Date().toISOString());
}

function markAllRead(profileId) {
  const unread = db.prepare(`
    SELECT n.id FROM notifications n
    LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.profile_id = ?
    WHERE r.notification_id IS NULL
  `).all(profileId);
  const now = new Date().toISOString();
  const stmt = db.prepare('INSERT OR IGNORE INTO notification_reads (profile_id, notification_id, read_at) VALUES (?, ?, ?)');
  for (const row of unread) stmt.run(profileId, row.id, now);
}

module.exports = { listForProfile, unreadCount, create, remove, removeOwnTargeted, markRead, markAllRead,setDeliveryHook:fn=>{deliveryHook=fn;} };
