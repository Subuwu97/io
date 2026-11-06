const { randomUUID } = require("node:crypto");
const reactions = ["❤️", "😂", "😮", "😢", "🔥", "👏"];
function createCommunity(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS discussion_reactions(comment_id TEXT NOT NULL REFERENCES episode_discussions(id) ON DELETE CASCADE,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,emoji TEXT NOT NULL,PRIMARY KEY(comment_id,account_id,emoji));
    CREATE TABLE IF NOT EXISTS community_preferences(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS community_notifications(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,actor_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,comment_id TEXT NOT NULL REFERENCES episode_discussions(id) ON DELETE CASCADE,kind TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT,UNIQUE(account_id,actor_id,comment_id,kind));
    CREATE INDEX IF NOT EXISTS community_inbox ON community_notifications(account_id,created_at,id);`);
  function getReactions(id, viewer) {
    return db
      .prepare(
        "SELECT emoji,COUNT(*) AS count,MAX(account_id=?) AS reacted FROM discussion_reactions WHERE comment_id=? GROUP BY emoji",
      )
      .all(viewer || "", id)
      .map((row) => ({ ...row, reacted: !!row.reacted }));
  }
  function notify({ recipientId, actorId, commentId, kind }) {
    if (
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='account_blocks'")
        .get() &&
      db
        .prepare(
          "SELECT 1 FROM account_blocks WHERE (source=? AND target=?) OR (source=? AND target=?)",
        )
        .get(recipientId, actorId, actorId, recipientId)
    )
      return;
    if (
      recipientId === actorId ||
      db
        .prepare("SELECT enabled FROM community_preferences WHERE account_id=?")
        .get(recipientId)?.enabled === 0
    )
      return;
    db.prepare(
      "INSERT OR IGNORE INTO community_notifications VALUES (?,?,?,?,?,?,NULL)",
    ).run(
      randomUUID(),
      recipientId,
      actorId,
      commentId,
      kind,
      new Date().toISOString(),
    );
  }
  function register(app, { requireAuth }) {
    app.get("/api/community/notifications", (req, res) => {
      const account = requireAuth(req, res);
      if (!account) return;
      let cursor = "",
        params = [account.id];
      if (req.query.before) {
        if (typeof req.query.before !== "string")
          return res.status(400).json({ error: "Invalid notification cursor" });
        const row = db
          .prepare(
            "SELECT * FROM community_notifications WHERE id=? AND account_id=?",
          )
          .get(req.query.before, account.id);
        if (!row)
          return res.status(400).json({ error: "Invalid notification cursor" });
        cursor = " AND (n.created_at<? OR (n.created_at=? AND n.id<?))";
        params.push(row.created_at, row.created_at, row.id);
      }
      const rows = db
        .prepare(
          `SELECT n.id,n.kind,n.created_at AS createdAt,n.read_at AS readAt,a.username AS actor,d.id AS commentId,d.show_id AS showId,d.episode_path AS episode
        FROM community_notifications n JOIN accounts a ON a.id=n.actor_id JOIN episode_discussions d ON d.id=n.comment_id WHERE n.account_id=? AND d.deleted_at IS NULL${cursor} ORDER BY n.created_at DESC,n.id DESC LIMIT 51`,
        )
        .all(...params);
      const items = rows.slice(0, 50);
      res.json({
        items,
        nextCursor: rows.length > 50 ? items.at(-1).id : null,
        enabled:
          db
            .prepare(
              "SELECT enabled FROM community_preferences WHERE account_id=?",
            )
            .get(account.id)?.enabled !== 0,
        unreadCount: db
          .prepare(
            "SELECT COUNT(*) AS n FROM community_notifications n JOIN episode_discussions d ON d.id=n.comment_id WHERE n.account_id=? AND n.read_at IS NULL AND d.deleted_at IS NULL",
          )
          .get(account.id).n,
      });
    });
    app.post("/api/community/notifications/read", (req, res) => {
      const account = requireAuth(req, res);
      if (!account) return;
      if (req.body?.all === true)
        db.prepare(
          "UPDATE community_notifications SET read_at=? WHERE account_id=? AND read_at IS NULL",
        ).run(new Date().toISOString(), account.id);
      else {
        if (typeof req.body?.id !== "string")
          return res.status(400).json({ error: "Choose a notification" });
        if (
          !db
            .prepare(
              "UPDATE community_notifications SET read_at=? WHERE id=? AND account_id=?",
            )
            .run(new Date().toISOString(), req.body.id, account.id).changes
        )
          return res.status(404).json({ error: "Notification not found" });
      }
      res.json({ ok: true });
    });
    app.put("/api/community/preferences", (req, res) => {
      const account = requireAuth(req, res);
      if (!account) return;
      if (typeof req.body?.enabled !== "boolean")
        return res
          .status(400)
          .json({ error: "Choose a notification preference" });
      db.prepare(
        "INSERT INTO community_preferences VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET enabled=excluded.enabled",
      ).run(account.id, req.body.enabled ? 1 : 0);
      res.json({ enabled: req.body.enabled });
    });
  }
  return { reactions, getReactions, notify, register };
}
module.exports = { createCommunity, reactions };
