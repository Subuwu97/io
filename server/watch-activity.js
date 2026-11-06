const { randomBytes, createHash } = require("node:crypto");
const hash = (v) => createHash("sha256").update(v).digest("hex");
function registerWatchActivity(
  app,
  { db, requireAuth, services, getLibrary, now = Date.now },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS activity_preferences(profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,enabled INTEGER NOT NULL DEFAULT 0,token_hash TEXT);CREATE TABLE IF NOT EXISTS watch_activity(profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,title TEXT NOT NULL,episode TEXT NOT NULL,position REAL NOT NULL,duration REAL NOT NULL,paused INTEGER NOT NULL,updated_at INTEGER NOT NULL);`,
  );
  app.use("/api/watch-activity", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      !new Set([
        `${req.protocol}://${req.get("host")}`,
        services.get().publicUrl,
      ]).has(req.headers.origin)
    )
      return res.status(403).json({ error: "Request origin is not allowed" });
    next();
  });
  function own(req, res) {
    const a = requireAuth(req, res);
    if (!a) return;
    const p = db
      .prepare("SELECT * FROM profiles WHERE id=? AND account_id=?")
      .get(req.params.id, a.id);
    if (!p) res.status(403).json({ error: "Profile not available" });
    return p;
  }
  app.get("/api/watch-activity/:id/settings", (req, res) => {
    const p = own(req, res);
    if (p) {
      const row = db
        .prepare(
          "SELECT enabled,token_hash FROM activity_preferences WHERE profile_id=?",
        )
        .get(p.id);
      res.json({
        enabled: !!row?.enabled,
        companionConfigured: !!row?.token_hash,
        clientId: services.get().discordClientId || "",
      });
    }
  });
  app.put("/api/watch-activity/:id/settings", (req, res) => {
    const p = own(req, res);
    if (!p) return;
    if (
      typeof req.body?.enabled !== "boolean" ||
      (p.is_kids && req.body.enabled)
    )
      return res
        .status(400)
        .json({
          error:
            "Choose an activity preference. Kids profiles cannot share activity.",
        });
    db.prepare(
      "INSERT INTO activity_preferences(profile_id,enabled) VALUES(?,?) ON CONFLICT(profile_id) DO UPDATE SET enabled=excluded.enabled,token_hash=CASE WHEN excluded.enabled=0 THEN NULL ELSE activity_preferences.token_hash END",
    ).run(p.id, req.body.enabled ? 1 : 0);
    if (!req.body.enabled)
      db.prepare("DELETE FROM watch_activity WHERE profile_id=?").run(p.id);
    res.json({ ok: true });
  });
  app.post("/api/watch-activity/:id/companion-key", (req, res) => {
    const p = own(req, res);
    if (!p) return;
    if (
      !db
        .prepare("SELECT enabled FROM activity_preferences WHERE profile_id=?")
        .get(p.id)?.enabled
    )
      return res.status(400).json({ error: "Enable activity sharing first" });
    const token = randomBytes(32).toString("hex");
    db.prepare(
      "UPDATE activity_preferences SET token_hash=? WHERE profile_id=?",
    ).run(hash(token), p.id);
    res.json({ token });
  });
  app.post("/api/watch-activity/:id/heartbeat", (req, res) => {
    const p = own(req, res);
    if (!p) return;
    if (
      !db
        .prepare("SELECT enabled FROM activity_preferences WHERE profile_id=?")
        .get(p.id)?.enabled ||
      p.is_kids
    )
      return res.json({ ok: true });
    const b = req.body || {},
      show = typeof b.itemId === "string" && getLibrary().getShow(b.itemId),
      ep =
        show &&
        (show.groups || [])
          .flatMap((g) => g.episodes)
          .find((e) => e.relPath === b.episode);
    if (!show || !ep || /(rx|hentai|x-rated)/i.test(show.rating || ""))
      return res
        .status(400)
        .json({ error: "This title cannot be shared as activity" });
    if (
      !Number.isFinite(b.position) ||
      b.position < 0 ||
      b.position > 1e8 ||
      !Number.isFinite(b.duration) ||
      b.duration < 0 ||
      b.duration > 1e8 ||
      typeof b.paused !== "boolean"
    )
      return res.status(400).json({ error: "Invalid playback state" });
    db.prepare(
      "INSERT INTO watch_activity VALUES(?,?,?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET title=excluded.title,episode=excluded.episode,position=excluded.position,duration=excluded.duration,paused=excluded.paused,updated_at=excluded.updated_at",
    ).run(
      p.id,
      String(show.title).slice(0, 128),
      String(ep.title || "Watching").slice(0, 128),
      b.position,
      b.duration,
      b.paused ? 1 : 0,
      now(),
    );
    res.json({ ok: true });
  });
  app.get("/api/watch-activity/companion", (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      return res.sendStatus(401);
    const row = db
      .prepare(
        "SELECT p.profile_id FROM activity_preferences p JOIN profiles v ON v.id=p.profile_id JOIN accounts a ON a.id=v.account_id WHERE p.token_hash=? AND p.enabled=1 AND v.is_kids=0 AND a.approved=1",
      )
      .get(hash(token));
    if (!row) return res.sendStatus(401);
    const activity = db
      .prepare(
        "SELECT title,episode,position,duration,paused,updated_at AS updatedAt FROM watch_activity WHERE profile_id=? AND updated_at>? AND paused=0",
      )
      .get(row.profile_id, now() - 20000);
    res.json({
      activity: activity || null,
      clientId: services.get().discordClientId || "",
    });
  });
}
module.exports = { registerWatchActivity };
