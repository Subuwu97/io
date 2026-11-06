const { randomUUID } = require("crypto");

module.exports = function registerDiscussions(
  app,
  { db, requireAuth, getShow },
) {
  db.exec(`CREATE TABLE IF NOT EXISTS episode_discussions (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    show_id TEXT NOT NULL, episode_path TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS episode_discussions_lookup ON episode_discussions(show_id, episode_path, created_at);`);
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(episode_discussions)")
      .all()
      .map((c) => c.name),
  );
  for (const [name, definition] of [
    ["parent_id", "TEXT REFERENCES episode_discussions(id) ON DELETE SET NULL"],
    ["spoiler", "INTEGER NOT NULL DEFAULT 0"],
    ["deleted_at", "TEXT"],
    ["rich_html", "TEXT"],
  ]) {
    if (!columns.has(name))
      db.exec(
        `ALTER TABLE episode_discussions ADD COLUMN ${name} ${definition}`,
      );
  }
  db.exec(`CREATE INDEX IF NOT EXISTS discussion_parent ON episode_discussions(parent_id, created_at, id);
    CREATE TABLE IF NOT EXISTS discussion_likes (
      comment_id TEXT NOT NULL REFERENCES episode_discussions(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      PRIMARY KEY(comment_id, account_id)
    );
    CREATE TABLE IF NOT EXISTS discussion_reports (
      id TEXT PRIMARY KEY, comment_id TEXT NOT NULL REFERENCES episode_discussions(id) ON DELETE CASCADE,
      reporter_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      reason TEXT NOT NULL, comment_body TEXT NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', reviewed_by TEXT REFERENCES accounts(id) ON DELETE SET NULL, reviewed_at TEXT,
      UNIQUE(comment_id, reporter_id)
    ); CREATE INDEX IF NOT EXISTS discussion_report_queue ON discussion_reports(status, created_at, id);`);

  db.exec(
    "CREATE TABLE IF NOT EXISTS discussion_gifs(comment_id TEXT PRIMARY KEY REFERENCES episode_discussions(id) ON DELETE CASCADE,bytes BLOB NOT NULL)",
  );
  const { richComment, gifAttachment } = require("./rich-comments");
  const community = require("./community").createCommunity(db);
  community.register(app, { requireAuth });
  const select = `SELECT d.id, d.account_id AS accountId, a.username, d.text, d.rich_html AS richHtml, EXISTS(SELECT 1 FROM discussion_gifs g WHERE g.comment_id=d.id) AS hasGif, d.show_id AS showId, d.created_at AS createdAt,
    d.parent_id AS parentId, d.spoiler, d.deleted_at AS deletedAt,
    (SELECT COUNT(*) FROM discussion_likes l WHERE l.comment_id=d.id) AS likes,
    EXISTS(SELECT 1 FROM discussion_likes l WHERE l.comment_id=d.id AND l.account_id=?) AS liked,
    (SELECT COUNT(*) FROM episode_discussions r WHERE r.parent_id=d.id) AS replyCount
    FROM episode_discussions d JOIN accounts a ON a.id=d.account_id`;
  const serialize = (row, viewer) => ({
    ...row,
    richHtml:
      row.richHtml && !row.deletedAt ? richComment(row.richHtml).html : null,
    hasGif: !row.deletedAt && !!row.hasGif,
    reactions: row.deletedAt ? [] : community.getReactions(row.id, viewer),
    spoiler: !!row.spoiler,
    liked: !!row.liked,
    ...(row.deletedAt
      ? {
          text: "",
          username: "Deleted comment",
          accountId: null,
          likes: 0,
          liked: false,
        }
      : {}),
  });
  const hasBlocks = !!db
    .prepare("SELECT name FROM sqlite_master WHERE name='account_blocks'")
    .get();
  const blocked = (a, b) =>
    hasBlocks &&
    !!db
      .prepare(
        "SELECT 1 FROM account_blocks WHERE (source=? AND target=?) OR (source=? AND target=?)",
      )
      .get(a, b, b, a);
  function visible(id) {
    if (!hasBlocks) return "";
    const q = db.prepare("SELECT quote(?) value").get(id).value;
    return (
      " AND NOT EXISTS(SELECT 1 FROM account_blocks b WHERE (b.source=" +
      q +
      " AND b.target=d.account_id) OR (b.target=" +
      q +
      " AND b.source=d.account_id))"
    );
  }
  function context(req, res) {
    const account = requireAuth(req, res);
    if (!account) return null;
    const show = getShow(req.params.showId);
    const episode =
      req.method === "GET" ? req.query.episode : req.body?.episode;
    if (
      !show ||
      typeof episode !== "string" ||
      !(show.groups || []).some((g) =>
        g.episodes.some((e) => e.relPath === episode),
      )
    ) {
      res.status(404).json({ error: "Episode not found" });
      return null;
    }
    return { account, episode };
  }
  function comment(req, res, account, allowDeleted = false) {
    if (!account) return null;
    const row = db
      .prepare("SELECT * FROM episode_discussions WHERE id=? AND show_id=?")
      .get(req.params.id, req.params.showId);
    if (
      !row ||
      blocked(account.id, row.account_id) ||
      (!allowDeleted && row.deleted_at)
    ) {
      res.status(404).json({ error: "Comment not found" });
      return null;
    }
    return row;
  }
  function remove(id) {
    db.prepare("DELETE FROM discussion_gifs WHERE comment_id=?").run(id);
    db.prepare(
      "UPDATE episode_discussions SET text='', rich_html=NULL, deleted_at=COALESCE(deleted_at,?) WHERE id=?",
    ).run(new Date().toISOString(), id);
    db.prepare("DELETE FROM discussion_likes WHERE comment_id=?").run(id);
    db.prepare("DELETE FROM discussion_reactions WHERE comment_id=?").run(id);
  }
  function admin(req, res) {
    const account = requireAuth(req, res);
    if (!account) return null;
    if (account.role !== "admin") {
      res.status(403).json({ error: "This action requires an admin account" });
      return null;
    }
    return account;
  }

  app.get("/api/discussions/:showId", (req, res) => {
    const ctx = context(req, res);
    if (!ctx) return;
    if (req.query.threads !== "1")
      return res.json(
        db
          .prepare(
            `${select} WHERE d.show_id=? AND d.episode_path=?${visible(ctx.account.id)} ORDER BY d.created_at DESC,d.id DESC LIMIT 100`,
          )
          .all(ctx.account.id, req.params.showId, ctx.episode)
          .map((row) => serialize(row, ctx.account.id)),
      );
    const params = [ctx.account.id, req.params.showId, ctx.episode];
    let cursor = "";
    if (req.query.before) {
      if (typeof req.query.before !== "string")
        return res.status(400).json({ error: "Invalid discussion cursor" });
      const before = db
        .prepare(
          "SELECT * FROM episode_discussions WHERE id=? AND show_id=? AND episode_path=? AND parent_id IS NULL",
        )
        .get(req.query.before, req.params.showId, ctx.episode);
      if (!before)
        return res.status(400).json({ error: "Invalid discussion cursor" });
      cursor = " AND (d.created_at < ? OR (d.created_at=? AND d.id < ?))";
      params.push(before.created_at, before.created_at, before.id);
    }
    const rows = db
      .prepare(
        `${select} WHERE d.show_id=? AND d.episode_path=? AND d.parent_id IS NULL${visible(ctx.account.id)}${cursor} ORDER BY d.created_at DESC,d.id DESC LIMIT 26`,
      )
      .all(...params);
    const roots = rows
      .slice(0, 25)
      .map((row) => serialize(row, ctx.account.id));
    for (const root of roots)
      root.replies = db
        .prepare(
          `${select} WHERE d.parent_id=?${visible(ctx.account.id)} ORDER BY d.created_at,d.id LIMIT 5`,
        )
        .all(ctx.account.id, root.id)
        .map((row) => serialize(row, ctx.account.id));
    res.json({
      threads: roots,
      nextCursor: rows.length > 25 ? rows[24].id : null,
    });
  });
  app.get("/api/discussions/:showId/:id/replies", (req, res) => {
    const account = requireAuth(req, res);
    const parent = comment(req, res, account, true);
    if (!parent) return;
    const params = [account.id, parent.id];
    let cursor = "";
    if (req.query.after) {
      if (typeof req.query.after !== "string")
        return res.status(400).json({ error: "Invalid reply cursor" });
      const after = db
        .prepare("SELECT * FROM episode_discussions WHERE id=? AND parent_id=?")
        .get(req.query.after, parent.id);
      if (!after)
        return res.status(400).json({ error: "Invalid reply cursor" });
      cursor = " AND (d.created_at > ? OR (d.created_at=? AND d.id > ?))";
      params.push(after.created_at, after.created_at, after.id);
    }
    const rows = db
      .prepare(
        `${select} WHERE d.parent_id=?${visible(account.id)}${cursor} ORDER BY d.created_at,d.id LIMIT 51`,
      )
      .all(...params);
    const replies = rows.slice(0, 50).map((row) => serialize(row, account.id));
    res.json({
      replies,
      nextCursor: rows.length > 50 ? replies.at(-1).id : null,
    });
  });
  app.get("/api/discussions/:showId/:id/gif", (req, res) => {
    const a = requireAuth(req, res);
    if (!a) return;
    const row = comment(req, res, a);
    if (!row) return;
    const attachment = db
      .prepare("SELECT bytes FROM discussion_gifs WHERE comment_id=?")
      .get(row.id);
    if (!attachment) return res.sendStatus(404);
    res
      .set({
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      })
      .type("image/gif")
      .send(Buffer.from(attachment.bytes));
  });
  app.post("/api/discussions/:showId", (req, res) => {
    const ctx = context(req, res);
    if (!ctx) return;
    let formatted = null,
      gif = null;
    try {
      if (req.body.richHtml !== undefined)
        formatted = richComment(req.body.richHtml);
      gif = gifAttachment(req.body.gif);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const text = formatted
      ? formatted.text
      : typeof req.body.text === "string"
        ? req.body.text.trim()
        : "";
    if (
      gif &&
      db
        .prepare(
          "SELECT COUNT(*) n FROM discussion_gifs g JOIN episode_discussions d ON d.id=g.comment_id WHERE d.account_id=? AND d.created_at>?",
        )
        .get(ctx.account.id, new Date(Date.now() - 86400000).toISOString()).n >=
        20
    )
      return res
        .status(429)
        .json({ error: "You can attach up to 20 GIFs per day" });
    if (!text || text.length > 2000)
      return res
        .status(400)
        .json({ error: "Write between 1 and 2,000 characters" });
    if (req.body.spoiler !== undefined && typeof req.body.spoiler !== "boolean")
      return res.status(400).json({ error: "Spoiler must be true or false" });
    const parentId = req.body.parentId ?? null;
    if (parentId !== null) {
      if (typeof parentId !== "string")
        return res.status(400).json({ error: "Invalid reply target" });
      const parent = db
        .prepare(
          "SELECT * FROM episode_discussions WHERE id=? AND show_id=? AND episode_path=?",
        )
        .get(parentId, req.params.showId, ctx.episode);
      if (
        !parent ||
        blocked(ctx.account.id, parent.account_id) ||
        parent.deleted_at ||
        parent.parent_id
      )
        return res.status(400).json({
          error: "Reply to an existing top-level comment in this episode",
        });
    }
    const last = db
      .prepare(
        "SELECT created_at FROM episode_discussions WHERE account_id=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(ctx.account.id);
    if (last && Date.now() - Date.parse(last.created_at) < 3000)
      return res
        .status(429)
        .json({ error: "Please wait a moment before posting again" });
    const id = randomUUID(),
      createdAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO episode_discussions(id,account_id,show_id,episode_path,text,created_at,parent_id,spoiler,rich_html) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      ctx.account.id,
      req.params.showId,
      ctx.episode,
      text,
      createdAt,
      parentId,
      req.body.spoiler ? 1 : 0,
      formatted?.html || null,
    );
    if (gif) db.prepare("INSERT INTO discussion_gifs VALUES(?,?)").run(id, gif);
    if (parentId)
      community.notify({
        recipientId: db
          .prepare("SELECT account_id FROM episode_discussions WHERE id=?")
          .get(parentId).account_id,
        actorId: ctx.account.id,
        commentId: id,
        kind: "reply",
      });
    res
      .status(201)
      .json(
        serialize(
          db.prepare(`${select} WHERE d.id=?`).get(ctx.account.id, id),
          ctx.account.id,
        ),
      );
  });
  app.delete("/api/discussions/:showId/:id", (req, res) => {
    const account = requireAuth(req, res),
      row = comment(req, res, account);
    if (!row) return;
    if (row.account_id !== account.id && account.role !== "admin")
      return res
        .status(403)
        .json({ error: "You can only delete your own comments" });
    remove(row.id);
    res.json({ ok: true });
  });
  app.put("/api/discussions/:showId/:id/like", (req, res) => {
    const account = requireAuth(req, res),
      row = comment(req, res, account);
    if (!row) return;
    if (typeof req.body?.liked !== "boolean")
      return res.status(400).json({ error: "Liked must be true or false" });
    if (req.body.liked)
      db.prepare("INSERT OR IGNORE INTO discussion_likes VALUES (?,?)").run(
        row.id,
        account.id,
      );
    else
      db.prepare(
        "DELETE FROM discussion_likes WHERE comment_id=? AND account_id=?",
      ).run(row.id, account.id);
    if (req.body.liked)
      community.notify({
        recipientId: row.account_id,
        actorId: account.id,
        commentId: row.id,
        kind: "reaction",
      });
    res.json({
      liked: req.body.liked,
      likes: db
        .prepare(
          "SELECT COUNT(*) AS n FROM discussion_likes WHERE comment_id=?",
        )
        .get(row.id).n,
    });
  });

  app.put("/api/discussions/:showId/:id/reaction", (req, res) => {
    const account = requireAuth(req, res),
      row = comment(req, res, account);
    if (!row) return;
    const { emoji, active } = req.body || {};
    if (!community.reactions.includes(emoji) || typeof active !== "boolean")
      return res.status(400).json({ error: "Choose a supported reaction" });
    if (active) {
      db.prepare(
        "INSERT OR IGNORE INTO discussion_reactions VALUES (?,?,?)",
      ).run(row.id, account.id, emoji);
      community.notify({
        recipientId: row.account_id,
        actorId: account.id,
        commentId: row.id,
        kind: "reaction",
      });
    } else
      db.prepare(
        "DELETE FROM discussion_reactions WHERE comment_id=? AND account_id=? AND emoji=?",
      ).run(row.id, account.id, emoji);
    res.json({ reactions: community.getReactions(row.id, account.id) });
  });
  app.get("/api/discussions/:showId/:id/thread", (req, res) => {
    const account = requireAuth(req, res),
      row = comment(req, res, account, true);
    if (!row) return;
    const parentId = row.parent_id || row.id;
    const parent = db
      .prepare("SELECT account_id FROM episode_discussions WHERE id=?")
      .get(parentId);
    if (!parent || blocked(account.id, parent.account_id))
      return res.status(404).json({ error: "Comment not found" });
    const root = serialize(
      db.prepare(`${select} WHERE d.id=?`).get(account.id, parentId),
      account.id,
    );
    root.replies = db
      .prepare(
        `${select} WHERE d.parent_id=?${visible(account.id)} ORDER BY d.created_at,d.id LIMIT 50`,
      )
      .all(account.id, parentId)
      .map((r) => serialize(r, account.id));
    res.json(root);
  });
  app.post("/api/discussions/:showId/:id/report", (req, res) => {
    const account = requireAuth(req, res),
      row = comment(req, res, account);
    if (!row) return;
    const reason =
      typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 500)
      return res
        .status(400)
        .json({ error: "Describe the issue in 3–500 characters" });
    if (
      db
        .prepare(
          "SELECT 1 FROM discussion_reports WHERE comment_id=? AND reporter_id=?",
        )
        .get(row.id, account.id)
    )
      return res
        .status(409)
        .json({ error: "You have already reported this comment" });
    db.prepare(
      "INSERT INTO discussion_reports(id,comment_id,reporter_id,reason,comment_body,created_at) VALUES (?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      row.id,
      account.id,
      reason,
      row.text,
      new Date().toISOString(),
    );
    res.status(201).json({ ok: true });
  });
  app.get("/api/admin/discussion-reports", (req, res) => {
    if (!admin(req, res)) return;
    const status = req.query.status || "open";
    if (!["open", "dismissed", "removed"].includes(status))
      return res.status(400).json({ error: "Invalid report status" });
    const reports = db
      .prepare(
        `SELECT r.id,r.comment_id AS commentId,r.reason,r.comment_body AS commentBody,r.status,r.created_at AS createdAt,
      a.username AS reporter,b.username AS author,d.show_id AS showId,d.episode_path AS episode,d.spoiler
      FROM discussion_reports r JOIN episode_discussions d ON d.id=r.comment_id
      JOIN accounts a ON a.id=r.reporter_id JOIN accounts b ON b.id=d.account_id WHERE r.status=?
      ORDER BY r.created_at,r.id LIMIT 100`,
      )
      .all(status);
    res.json({
      reports: reports.map((r) => ({
        ...r,
        showTitle: getShow(r.showId)?.title || "Unavailable title",
      })),
      total: db
        .prepare("SELECT COUNT(*) AS n FROM discussion_reports WHERE status=?")
        .get(status).n,
    });
  });
  app.post("/api/admin/discussion-reports/:id/resolve", (req, res) => {
    const account = admin(req, res);
    if (!account) return;
    const action = req.body?.action;
    if (!["dismiss", "remove"].includes(action))
      return res.status(400).json({ error: "Choose dismiss or remove" });
    const report = db
      .prepare("SELECT * FROM discussion_reports WHERE id=?")
      .get(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.status !== "open")
      return res
        .status(409)
        .json({ error: "This report has already been reviewed" });
    db.exec("BEGIN IMMEDIATE");
    try {
      if (action === "remove") {
        remove(report.comment_id);
        db.prepare(
          "UPDATE discussion_reports SET status='removed',reviewed_by=?,reviewed_at=? WHERE comment_id=? AND status='open'",
        ).run(account.id, new Date().toISOString(), report.comment_id);
      } else
        db.prepare(
          "UPDATE discussion_reports SET status='dismissed',reviewed_by=?,reviewed_at=? WHERE id=?",
        ).run(account.id, new Date().toISOString(), report.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json({ ok: true });
  });
};
