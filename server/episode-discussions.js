const { randomUUID } = require('crypto');

module.exports = function registerDiscussions(app, { db, requireAuth, getShow }) {
  db.exec(`CREATE TABLE IF NOT EXISTS episode_discussions (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    show_id TEXT NOT NULL, episode_path TEXT NOT NULL, text TEXT NOT NULL,
    created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS episode_discussions_lookup ON episode_discussions(show_id, episode_path, created_at);`);
  function context(req, res) {
    const account = requireAuth(req, res);
    if (!account) return null;
    const show = getShow(req.params.showId);
    const episode = req.method === 'GET' ? req.query.episode : req.body.episode;
    if (!show || typeof episode !== 'string' || !(show.groups || []).some(g => g.episodes.some(e => e.relPath === episode))) {
      res.status(404).json({ error: 'Episode not found' }); return null;
    }
    return { account, episode };
  }
  app.get('/api/discussions/:showId', (req, res) => {
    const ctx = context(req, res); if (!ctx) return;
    res.json(db.prepare(`SELECT d.id, d.account_id AS accountId, a.username, d.text, d.created_at AS createdAt
      FROM episode_discussions d JOIN accounts a ON a.id=d.account_id
      WHERE d.show_id=? AND d.episode_path=? ORDER BY d.created_at DESC LIMIT 100`).all(req.params.showId, ctx.episode));
  });
  app.post('/api/discussions/:showId', (req, res) => {
    const ctx = context(req, res); if (!ctx) return;
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 2000) return res.status(400).json({ error: 'Write between 1 and 2,000 characters' });
    const last = db.prepare('SELECT created_at FROM episode_discussions WHERE account_id=? ORDER BY created_at DESC LIMIT 1').get(ctx.account.id);
    if (last && Date.now() - Date.parse(last.created_at) < 3000) return res.status(429).json({ error: 'Please wait a moment before posting again' });
    const id = randomUUID(), createdAt = new Date().toISOString();
    db.prepare('INSERT INTO episode_discussions VALUES (?,?,?,?,?,?)').run(id, ctx.account.id, req.params.showId, ctx.episode, text, createdAt);
    res.status(201).json({ id, accountId:ctx.account.id, username:ctx.account.username, text, createdAt });
  });
  app.delete('/api/discussions/:showId/:id', (req, res) => {
    const account = requireAuth(req, res); if (!account) return;
    const row = db.prepare('SELECT * FROM episode_discussions WHERE id=? AND show_id=?').get(req.params.id, req.params.showId);
    if (!row) return res.status(404).json({ error: 'Comment not found' });
    if (row.account_id !== account.id && account.role !== 'admin') return res.status(403).json({ error: 'You can only delete your own comments' });
    db.prepare('DELETE FROM episode_discussions WHERE id=?').run(row.id);
    res.json({ ok:true });
  });
};
