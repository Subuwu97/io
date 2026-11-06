const { randomUUID, randomBytes, createHash } = require("node:crypto");
const digest = (v) => createHash("sha256").update(v).digest("hex");
function registerTVDevices(
  app,
  { db, requireAuth, publicOrigin = () => "", now = Date.now },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS tv_devices(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,name TEXT NOT NULL,token_hash TEXT NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,state TEXT NOT NULL DEFAULT '{}');CREATE TABLE IF NOT EXISTS tv_commands(id INTEGER PRIMARY KEY AUTOINCREMENT,device_id TEXT NOT NULL REFERENCES tv_devices(id) ON DELETE CASCADE,command TEXT NOT NULL,value REAL,created_at INTEGER NOT NULL);`,
  );
  app.use("/api/tv-devices", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      !new Set([`${req.protocol}://${req.get("host")}`, publicOrigin()]).has(
        req.headers.origin,
      )
    )
      return res.status(403).json({ error: "Request origin is not allowed" });
    next();
  });
  function owned(req, res) {
    const a = requireAuth(req, res);
    if (!a) return;
    const d = db
      .prepare("SELECT * FROM tv_devices WHERE id=? AND account_id=?")
      .get(req.params.id, a.id);
    if (!d) res.status(404).json({ error: "TV device not found" });
    return d;
  }
  app.get("/api/tv-devices", (req, res) => {
    const a = requireAuth(req, res);
    if (a)
      res.json(
        db
          .prepare(
            "SELECT id,name,created_at AS createdAt,last_seen AS lastSeen,state FROM tv_devices WHERE account_id=? ORDER BY last_seen DESC",
          )
          .all(a.id)
          .map((d) => ({
            ...d,
            state: JSON.parse(d.state),
            online: now() - d.lastSeen < 15000,
          })),
      );
  });
  app.post("/api/tv-devices", (req, res) => {
    const a = requireAuth(req, res);
    if (!a) return;
    const name = req.body?.name;
    if (typeof name !== "string" || !name.trim() || name.length > 80)
      return res
        .status(400)
        .json({ error: "Name this TV browser (up to 80 characters)" });
    if (
      db
        .prepare("SELECT COUNT(*) n FROM tv_devices WHERE account_id=?")
        .get(a.id).n >= 20
    )
      return res
        .status(409)
        .json({ error: "Remove an old device before registering another" });
    const id = randomUUID(),
      token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO tv_devices VALUES(?,?,?,?,?,?, '{}')").run(
      id,
      a.id,
      name.trim(),
      digest(token),
      now(),
      now(),
    );
    res.status(201).json({ id, token });
  });
  app.delete("/api/tv-devices/:id", (req, res) => {
    const d = owned(req, res);
    if (d) {
      db.prepare("DELETE FROM tv_devices WHERE id=?").run(d.id);
      res.json({ ok: true });
    }
  });
  app.post("/api/tv-devices/:id/heartbeat", (req, res) => {
    const d = owned(req, res);
    if (!d) return;
    if (
      typeof req.body?.token !== "string" ||
      digest(req.body.token) !== d.token_hash
    )
      return res
        .status(403)
        .json({ error: "This browser is not registered as that device" });
    const b = req.body.state || {};
    if (
      typeof b.title !== "string" ||
      b.title.length > 200 ||
      typeof b.paused !== "boolean" ||
      !Number.isFinite(b.position) ||
      b.position < 0 ||
      b.position > 1e8 ||
      !Number.isFinite(b.duration) ||
      b.duration < 0 ||
      b.duration > 1e8 ||
      !Number.isFinite(b.volume) ||
      b.volume < 0 ||
      b.volume > 1
    )
      return res.status(400).json({ error: "Invalid playback state" });
    db.prepare("UPDATE tv_devices SET last_seen=?,state=? WHERE id=?").run(
      now(),
      JSON.stringify({
        title: b.title,
        paused: b.paused,
        position: b.position,
        duration: b.duration,
        volume: b.volume,
      }),
      d.id,
    );
    db.prepare("DELETE FROM tv_commands WHERE created_at<?").run(now() - 15000);
    const commands = db
      .prepare(
        "DELETE FROM tv_commands WHERE device_id=? RETURNING id,command,value",
      )
      .all(d.id)
      .sort((a, b) => a.id - b.id);
    res.json({ commands });
  });
  app.post("/api/tv-devices/:id/command", (req, res) => {
    const d = owned(req, res);
    if (!d) return;
    if (now() - d.last_seen > 15000)
      return res.status(409).json({ error: "This TV browser is offline" });
    const { command, value } = req.body || {};
    if (
      !["play", "pause", "seek", "volume", "back", "forward"].includes(
        command,
      ) ||
      (command === "seek" &&
        (!Number.isFinite(value) || value < 0 || value > 1e8)) ||
      (command === "volume" &&
        (!Number.isFinite(value) || value < 0 || value > 1))
    )
      return res.status(400).json({ error: "Invalid remote command" });
    db.prepare("DELETE FROM tv_commands WHERE created_at<?").run(now() - 15000);
    if (
      db
        .prepare("SELECT COUNT(*) n FROM tv_commands WHERE device_id=?")
        .get(d.id).n >= 30
    )
      return res
        .status(429)
        .json({ error: "Please wait for the TV to respond" });
    db.prepare(
      "INSERT INTO tv_commands(device_id,command,value,created_at) VALUES(?,?,?,?)",
    ).run(
      d.id,
      command,
      ["seek", "volume"].includes(command) ? value : null,
      now(),
    );
    res.status(202).json({ ok: true });
  });
}
module.exports = { registerTVDevices };
