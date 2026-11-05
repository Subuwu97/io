// Admin-curated home page rows - any custom name ("Staff Picks", "Truck
// Kun's Top Picks", whatever), server-wide (shown to every profile),
// distinct from the existing per-profile "Top Pick" feature which is
// personal to each viewer. Deliberately simple data model: rows have a
// position, items within a row have a position, both just plain
// integers reassigned on any reorder rather than anything fancier.
const { db } = require('./db');
const crypto = require('crypto');

function listRows() {
  const rows = db.prepare('SELECT * FROM curated_rows ORDER BY position ASC').all();
  const items = db.prepare('SELECT * FROM curated_row_items ORDER BY row_id, position ASC').all();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    items: items.filter((i) => i.row_id === r.id).map((i) => ({ itemId: i.item_id, itemType: i.item_type })),
  }));
}

function createRow(title) {
  const clean = (title || '').trim().slice(0, 100);
  if (!clean) throw new Error('Row title is required');
  const maxPos = db.prepare('SELECT MAX(position) AS m FROM curated_rows').get().m;
  const id = 'row' + crypto.randomBytes(6).toString('hex');
  db.prepare('INSERT INTO curated_rows (id, title, position, created_at) VALUES (?, ?, ?, ?)')
    .run(id, clean, (maxPos == null ? 0 : maxPos + 1), new Date().toISOString());
  return { id, title: clean, items: [] };
}

function renameRow(id, title) {
  const clean = (title || '').trim().slice(0, 100);
  if (!clean) throw new Error('Row title is required');
  const result = db.prepare('UPDATE curated_rows SET title = ? WHERE id = ?').run(clean, id);
  if (result.changes === 0) throw new Error('Row not found');
}

function deleteRow(id) {
  db.prepare('DELETE FROM curated_rows WHERE id = ?').run(id); // curated_row_items cascades
}

// Bulk-reassigns row order from a full list of row ids in the desired order.
function reorderRows(orderedIds) {
  const existing = new Set(db.prepare('SELECT id FROM curated_rows').all().map((r) => r.id));
  db.exec('BEGIN');
  try {
    let pos = 0;
    for (const id of orderedIds) {
      if (existing.has(id)) db.prepare('UPDATE curated_rows SET position = ? WHERE id = ?').run(pos++, id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function addItem(rowId, itemId, itemType) {
  const row = db.prepare('SELECT id FROM curated_rows WHERE id = ?').get(rowId);
  if (!row) throw new Error('Row not found');
  const maxPos = db.prepare('SELECT MAX(position) AS m FROM curated_row_items WHERE row_id = ?').get(rowId).m;
  db.prepare('INSERT OR IGNORE INTO curated_row_items (row_id, item_id, item_type, position) VALUES (?, ?, ?, ?)')
    .run(rowId, itemId, itemType, (maxPos == null ? 0 : maxPos + 1));
}

function removeItem(rowId, itemId, itemType) {
  db.prepare('DELETE FROM curated_row_items WHERE row_id = ? AND item_id = ? AND item_type = ?').run(rowId, itemId, itemType);
}

module.exports = { listRows, createRow, renameRow, deleteRow, reorderRows, addItem, removeItem };
