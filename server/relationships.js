function createRelationships(db, now = Date.now) {
  const blockRef = (source, target) =>
    require("node:crypto")
      .createHash("sha256")
      .update(source + "\0" + target)
      .digest("hex");
  db.exec(`CREATE TABLE IF NOT EXISTS profile_follows(source TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,target TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,PRIMARY KEY(source,target));
    CREATE TABLE IF NOT EXISTS profile_friendships(source TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,target TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,status TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(source,target));
    CREATE TABLE IF NOT EXISTS account_blocks(source TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,target TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,created_at INTEGER NOT NULL,PRIMARY KEY(source,target));`);
  const blocked = (a, b) =>
    !!db
      .prepare(
        "SELECT 1 FROM account_blocks WHERE (source=? AND target=?) OR (source=? AND target=?)",
      )
      .get(a, b, b, a);
  const friend = (a, b) =>
    !!(
      a &&
      b &&
      db
        .prepare(
          "SELECT 1 FROM profile_friendships WHERE status='accepted' AND ((source=? AND target=?) OR (source=? AND target=?))",
        )
        .get(a, b, b, a)
    );
  const follows = (a, b) =>
    !!(
      a &&
      b &&
      db
        .prepare("SELECT 1 FROM profile_follows WHERE source=? AND target=?")
        .get(a, b)
    );
  function viewer(req, a) {
    return typeof req.query.viewer === "string"
      ? db
          .prepare("SELECT id FROM profiles WHERE id=? AND account_id=?")
          .get(req.query.viewer, a.id)?.id
      : null;
  }
  function state(source, target) {
    const row =
      source &&
      db
        .prepare(
          "SELECT * FROM profile_friendships WHERE (source=? AND target=?) OR (source=? AND target=?)",
        )
        .get(source, target, target, source);
    return {
      following: follows(source, target),
      friendship: row
        ? row.status === "accepted"
          ? "friends"
          : row.source === source
            ? "outgoing"
            : "incoming"
        : "none",
    };
  }
  function audience(value, owner, viewerId, target) {
    if (owner) return true;
    const group =
      value === true ? "members" : value === false ? "private" : value;
    return (
      group === "members" ||
      (group === "followers" && follows(viewerId, target)) ||
      (group === "friends" && friend(viewerId, target))
    );
  }
  function register(app, { requireAuth }) {
    const rates = new Map();
    app.get("/api/people/connections/:id", (req, res) => {
      const a = requireAuth(req, res);
      if (!a) return;
      const p = db
        .prepare("SELECT id FROM profiles WHERE id=? AND account_id=?")
        .get(req.params.id, a.id);
      if (!p) return res.sendStatus(403);
      const rows = db
        .prepare(
          `SELECT u.slug,p.name,p.avatar,p.id,p.account_id FROM public_profiles u JOIN profiles p ON p.id=u.profile_id JOIN accounts a ON a.id=p.account_id WHERE p.is_kids=0 AND a.approved=1`,
        )
        .all();
      const items = rows
        .filter((r) => r.account_id !== a.id && !blocked(a.id, r.account_id))
        .map((r) => ({ slug: r.slug, name: r.name, ...state(p.id, r.id) }))
        .filter((r) => r.following || r.friendship !== "none");
      const blocks = db
        .prepare(
          "SELECT b.target,u.slug,p.name FROM account_blocks b LEFT JOIN public_profiles u ON u.profile_id=b.profile_id LEFT JOIN profiles p ON p.id=b.profile_id WHERE b.source=? ORDER BY b.created_at DESC",
        )
        .all(a.id)
        .map((b) => ({
          ref: blockRef(a.id, b.target),
          slug: b.slug || null,
          name: b.name || "Deleted profile",
        }));
      res.json({ items, blocks });
    });
    app.delete("/api/people/blocks/:ref", (req, res) => {
      const a = requireAuth(req, res);
      if (!a) return;
      const row = db
        .prepare("SELECT target FROM account_blocks WHERE source=?")
        .all(a.id)
        .find((r) => blockRef(a.id, r.target) === req.params.ref);
      if (!row) return res.sendStatus(404);
      db.prepare("DELETE FROM account_blocks WHERE source=? AND target=?").run(
        a.id,
        row.target,
      );
      res.json({ ok: true });
    });
    app.post("/api/people/u/:slug/relationship", (req, res) => {
      const a = requireAuth(req, res);
      if (!a) return;
      const b = req.body || {},
        p =
          typeof b.profileId === "string" &&
          db
            .prepare("SELECT * FROM profiles WHERE id=? AND account_id=?")
            .get(b.profileId, a.id),
        target = db
          .prepare(
            "SELECT p.*,u.visibility FROM profiles p JOIN public_profiles u ON u.profile_id=p.id JOIN accounts a ON a.id=p.account_id WHERE u.slug=? COLLATE NOCASE AND a.approved=1",
          )
          .get(req.params.slug);
      if (!p)
        return res.status(403).json({ error: "Choose your viewing profile" });
      if (!target || target.account_id === a.id || p.is_kids || target.is_kids)
        return res
          .status(404)
          .json({ error: "Community profile not available" });
      const action = b.action;
      if (
        ![
          "follow",
          "unfollow",
          "request",
          "accept",
          "decline",
          "cancel",
          "unfriend",
          "block",
          "unblock",
        ].includes(action)
      )
        return res.status(400).json({ error: "Unknown community action" });
      if (
        ["request", "follow"].includes(action) &&
        !db
          .prepare(
            "SELECT 1 FROM public_profiles WHERE profile_id=? AND visibility!='private'",
          )
          .get(p.id)
      )
        return res
          .status(400)
          .json({
            error: "Set up a shared profile before connecting with people",
          });
      if (action === "unblock") {
        db.prepare(
          "DELETE FROM account_blocks WHERE source=? AND target=?",
        ).run(a.id, target.account_id);
        return res.json({ ok: true });
      }
      if (
        action !== "block" &&
        (target.visibility === "private" || blocked(a.id, target.account_id))
      )
        return res
          .status(404)
          .json({ error: "Community profile not available" });
      if (action === "request") {
        const rate = rates.get(a.id);
        if (rate && now() - rate.at < 3600000) {
          if (++rate.n > 20)
            return res
              .status(429)
              .json({
                error: "Please wait before sending more friend requests",
              });
        } else rates.set(a.id, { at: now(), n: 1 });
        if (rates.size > 5000) rates.delete(rates.keys().next().value);
        if (state(p.id, target.id).friendship !== "none")
          return res
            .status(409)
            .json({ error: "A friendship or request already exists" });
        db.prepare(
          "INSERT INTO profile_friendships VALUES(?,?,'pending',?)",
        ).run(p.id, target.id, now());
      }
      if (action === "follow")
        db.prepare("INSERT OR IGNORE INTO profile_follows VALUES(?,?,?)").run(
          p.id,
          target.id,
          now(),
        );
      if (action === "unfollow")
        db.prepare(
          "DELETE FROM profile_follows WHERE source=? AND target=?",
        ).run(p.id, target.id);
      if (
        action === "accept" &&
        !db
          .prepare(
            "UPDATE profile_friendships SET status='accepted' WHERE source=? AND target=? AND status='pending'",
          )
          .run(target.id, p.id).changes
      )
        return res.status(409).json({ error: "No incoming friend request" });
      if (action === "decline")
        db.prepare(
          "DELETE FROM profile_friendships WHERE source=? AND target=? AND status='pending'",
        ).run(target.id, p.id);
      if (action === "cancel")
        db.prepare(
          "DELETE FROM profile_friendships WHERE source=? AND target=? AND status='pending'",
        ).run(p.id, target.id);
      if (action === "unfriend")
        db.prepare(
          "DELETE FROM profile_friendships WHERE status='accepted' AND ((source=? AND target=?) OR (source=? AND target=?))",
        ).run(p.id, target.id, target.id, p.id);
      if (action === "block") {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare(
            "INSERT INTO account_blocks VALUES(?,?,?,?) ON CONFLICT(source,target) DO UPDATE SET profile_id=excluded.profile_id",
          ).run(a.id, target.account_id, target.id, now());
          for (const table of ["profile_follows", "profile_friendships"])
            db.prepare(
              `DELETE FROM ${table} WHERE (source IN(SELECT id FROM profiles WHERE account_id=?) AND target IN(SELECT id FROM profiles WHERE account_id=?)) OR (source IN(SELECT id FROM profiles WHERE account_id=?) AND target IN(SELECT id FROM profiles WHERE account_id=?))`,
            ).run(a.id, target.account_id, target.account_id, a.id);
          if (
            db
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE name='community_notifications'",
              )
              .get()
          )
            db.prepare(
              "DELETE FROM community_notifications WHERE (account_id=? AND actor_id=?) OR (account_id=? AND actor_id=?)",
            ).run(a.id, target.account_id, target.account_id, a.id);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      }
      res.json({ ok: true, ...state(p.id, target.id) });
    });
  }
  return { blocked, friend, follows, viewer, state, audience, register };
}
module.exports = { createRelationships };
