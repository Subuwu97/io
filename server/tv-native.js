const { randomBytes, randomUUID, createHash } = require("node:crypto");
const hash = (v) => createHash("sha256").update(String(v)).digest("hex");
function registerNativeTV(
  app,
  {
    db,
    requireAuth,
    profiles,
    getLibrary,
    startHls,
    publicOrigin = () => "",
    now = Date.now,
  },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS native_tv_devices(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS native_tv_streams(device_id TEXT NOT NULL REFERENCES native_tv_devices(id) ON DELETE CASCADE,cache_key TEXT NOT NULL,item_id TEXT NOT NULL,ticket_hash TEXT,expires_at INTEGER NOT NULL,PRIMARY KEY(device_id,cache_key));`,
  );
  if (
    !db
      .prepare("PRAGMA table_info(native_tv_streams)")
      .all()
      .some((c) => c.name === "ticket_hash")
  )
    db.exec("ALTER TABLE native_tv_streams ADD COLUMN ticket_hash TEXT");
  const pending = new Map(),
    rates = new Map();
  const safe = (fn) => (req, res) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e) => {
        if (!res.headersSent) res.status(400).json({ error: e.message });
      });
  function clean() {
    for (const [k, v] of pending)
      if (v.expires <= now()) {
        if (v.deviceId)
          db.prepare("DELETE FROM native_tv_devices WHERE id=?").run(
            v.deviceId,
          );
        pending.delete(k);
      }
  }
  function device(req) {
    const token = String(req.headers.authorization || "").match(
      /^Bearer (io_tv_[a-f0-9]{64})$/,
    )?.[1];
    if (!token) return null;
    return (
      db
        .prepare(
          "SELECT d.*,p.is_kids,p.name AS profile_name,a.approved,a.adult_content_allowed FROM native_tv_devices d JOIN profiles p ON p.id=d.profile_id AND p.account_id=d.account_id JOIN accounts a ON a.id=d.account_id WHERE token_hash=? AND expires_at>? AND a.approved=1",
        )
        .get(hash(token), now()) || null
    );
  }
  const allowed = (d, title) =>
    title &&
    (!(d.is_kids || d.adult_content_allowed === 0) ||
      !/(rx|hentai|x-rated)/i.test(title.rating || ""));
  function auth(req, res) {
    const d = device(req);
    if (!d) {
      res.status(401).json({ error: "Pair this TV again" });
      return null;
    }
    db.prepare(
      "UPDATE native_tv_devices SET last_seen=?,expires_at=? WHERE id=?",
    ).run(now(), now() + 90 * 86400000, d.id);
    return d;
  }
  app.use("/api/tv-native", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      !new Set([`${req.protocol}://${req.get("host")}`, publicOrigin()]).has(
        req.headers.origin,
      )
    )
      return res.sendStatus(403);
    next();
  });
  app.post("/api/tv-native/pair/start", (req, res) => {
    clean();
    const key = req.ip,
      rate = rates.get(key);
    if (rate && now() - rate.at < 60000 && rate.n++ >= 5)
      return res
        .status(429)
        .json({ error: "Wait a minute before requesting another code" });
    if (!rate || now() - rate.at >= 60000) rates.set(key, { at: now(), n: 1 });
    if (rates.size > 5000) rates.delete(rates.keys().next().value);
    if (pending.size >= 1000) return res.sendStatus(503);
    const name = String(req.body?.name || "I/O TV")
        .trim()
        .slice(0, 80),
      code = randomBytes(5).toString("hex").toUpperCase(),
      pollSecret = randomBytes(32).toString("hex");
    pending.set(code, {
      name,
      pollHash: hash(pollSecret),
      expires: now() + 300000,
    });
    res
      .status(201)
      .json({
        code,
        pollSecret,
        expiresIn: 300,
        approvalPath: "#/tv-pair/" + code,
      });
  });
  app.get("/api/tv-native/pair/:code", (req, res) => {
    if (!requireAuth(req, res)) return;
    clean();
    const p = pending.get(req.params.code);
    if (!p) return res.sendStatus(404);
    res.json({ name: p.name, expiresAt: p.expires, approved: !!p.deviceId });
  });
  app.post(
    "/api/tv-native/pair/:code/approve",
    safe(async (req, res) => {
      const a = requireAuth(req, res);
      if (!a) return;
      clean();
      const p = pending.get(req.params.code);
      if (!p || p.deviceId)
        throw Error("Pairing code expired or already approved");
      const profile =
        typeof req.body?.profileId === "string" &&
        db
          .prepare("SELECT * FROM profiles WHERE id=? AND account_id=?")
          .get(req.body.profileId, a.id);
      if (!profile) throw Error("Choose your own profile");
      if (!profiles.verifyPin(a.id, profile.id, req.body.pin))
        throw Error("Profile PIN is incorrect");
      if (
        db
          .prepare(
            "SELECT COUNT(*) n FROM native_tv_devices WHERE account_id=?",
          )
          .get(a.id).n >= 20
      )
        throw Error("Remove an old TV before adding another");
      const id = randomUUID(),
        token = "io_tv_" + randomBytes(32).toString("hex");
      db.prepare("INSERT INTO native_tv_devices VALUES(?,?,?,?,?,?,?,?)").run(
        id,
        a.id,
        profile.id,
        p.name,
        hash(token),
        now(),
        now(),
        now() + 90 * 86400000,
      );
      p.deviceId = id;
      p.token = token;
      p.profileName = profile.name;
      res.json({ ok: true });
    }),
  );
  app.post("/api/tv-native/pair/poll", (req, res) => {
    clean();
    const p = pending.get(req.body?.code);
    if (
      !p ||
      typeof req.body?.pollSecret !== "string" ||
      hash(req.body.pollSecret) !== p.pollHash
    )
      return res.status(404).json({ status: "expired" });
    if (!p.deviceId) return res.json({ status: "pending" });
    const live = db
      .prepare("SELECT id FROM native_tv_devices WHERE id=?")
      .get(p.deviceId);
    pending.delete(req.body.code);
    if (!live) return res.status(404).json({ status: "expired" });
    res.json({
      status: "approved",
      deviceId: p.deviceId,
      token: p.token,
      profileName: p.profileName,
    });
  });
  app.get("/api/tv-native/devices", (req, res) => {
    const a = requireAuth(req, res);
    if (!a) return;
    res.json(
      db
        .prepare(
          "SELECT d.id,d.name,p.name AS profileName,d.last_seen AS lastSeen,d.expires_at AS expiresAt FROM native_tv_devices d JOIN profiles p ON p.id=d.profile_id WHERE d.account_id=? ORDER BY d.last_seen DESC",
        )
        .all(a.id),
    );
  });
  app.delete("/api/tv-native/devices/:id", (req, res) => {
    const a = requireAuth(req, res);
    if (!a) return;
    db.prepare("DELETE FROM native_tv_devices WHERE id=? AND account_id=?").run(
      req.params.id,
      a.id,
    );
    res.json({ ok: true });
  });
  app.get("/api/tv-native/catalog", (req, res) => {
    const d = auth(req, res);
    if (!d) return;
    const q = String(req.query.q || "")
        .slice(0, 100)
        .toLowerCase(),
      lib = getLibrary(),
      items = [
        ...lib.cache.anime.map((t) => ({ ...t, kind: "series" })),
        ...lib.cache.movies.map((t) => ({ ...t, kind: "movie" })),
      ]
        .filter(
          (t) =>
            allowed(d, t) &&
            (!req.query.kind || t.kind === req.query.kind) &&
            (!q || t.title.toLowerCase().includes(q)),
        )
        .sort((a, b) => a.title.localeCompare(b.title)),
      offset = Math.max(0, Math.min(100000, Number(req.query.offset) || 0));
    res.json({
      profileName: d.profile_name,
      items: items
        .slice(offset, offset + 50)
        .map((t) => ({
          id: t.id,
          title: t.title,
          year: t.year,
          kind: t.kind,
          rating: t.rating,
        })),
      nextOffset: offset + 50 < items.length ? offset + 50 : null,
    });
  });
  app.get("/api/tv-native/title/:id", (req, res) => {
    const d = auth(req, res);
    if (!d) return;
    const title = getLibrary().getShow(req.params.id);
    if (!allowed(d, title)) return res.sendStatus(404);
    res.json({
      id: title.id,
      title: title.title,
      description: title.description,
      episodes: (title.groups || []).flatMap((g) =>
        g.episodes.map((e) => ({
          path: e.relPath,
          title: e.title || e.file,
          group: g.name,
        })),
      ),
      progress:
        db
          .prepare(
            "SELECT episode_rel_path AS episode,seconds,duration FROM progress WHERE profile_id=? AND item_id=?",
          )
          .get(d.profile_id, title.id) || null,
    });
  });
  app.post(
    "/api/tv-native/play",
    safe(async (req, res) => {
      const d = auth(req, res);
      if (!d) return;
      const b = req.body || {},
        title = getLibrary().getShow(b.id);
      if (
        !allowed(d, title) ||
        typeof b.episode !== "string" ||
        !(title.groups || []).some((g) =>
          g.episodes.some((e) => e.relPath === b.episode),
        )
      )
        return res.sendStatus(404);
      if (
        b.quality &&
        !["original", "360", "480", "720", "1080"].includes(String(b.quality))
      )
        throw Error("Unsupported quality");
      const offset = Number(b.offset || 0);
      if (!Number.isFinite(offset) || offset < 0 || offset > 1e7)
        throw Error("Invalid playback position");
      const result = await startHls(title.id, b.episode, {
        quality: b.quality || "720",
        startOffsetSeconds: offset,
      });
      if (result.error)
        return res
          .status(result.error.status)
          .json({ error: result.error.message });
      if (!device(req)) return res.sendStatus(401);
      db.prepare("DELETE FROM native_tv_streams WHERE expires_at<?").run(now());
      const ticket = "io_hls_" + randomBytes(24).toString("hex");
      db.prepare(
        "INSERT INTO native_tv_streams(device_id,cache_key,item_id,ticket_hash,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(device_id,cache_key) DO UPDATE SET expires_at=excluded.expires_at,item_id=excluded.item_id,ticket_hash=excluded.ticket_hash",
      ).run(d.id, result.cacheKey, title.id, hash(ticket), now() + 6 * 3600000);
      res.json({
        playlistUrl: "/api/hls/" + result.cacheKey + "/playlist.m3u8",
        startOffsetSeconds: offset,
        streamCookie: ticket,
      });
    }),
  );
  app.put("/api/tv-native/progress", (req, res) => {
    const d = auth(req, res);
    if (!d) return;
    const b = req.body || {},
      title = getLibrary().getShow(b.id);
    if (
      !allowed(d, title) ||
      !(title.groups || []).some((g) =>
        g.episodes.some((e) => e.relPath === b.episode),
      )
    )
      return res.sendStatus(404);
    if (
      !Number.isFinite(b.seconds) ||
      !Number.isFinite(b.duration) ||
      b.seconds < 0 ||
      b.duration < b.seconds ||
      b.duration > 1e7
    )
      return res.sendStatus(400);
    db.prepare(
      "INSERT INTO progress(profile_id,item_id,episode_rel_path,seconds,duration,updated_at,hidden) VALUES(?,?,?,?,?,?,0) ON CONFLICT(profile_id,item_id) DO UPDATE SET episode_rel_path=excluded.episode_rel_path,seconds=excluded.seconds,duration=excluded.duration,updated_at=excluded.updated_at,hidden=0",
    ).run(
      d.profile_id,
      title.id,
      b.episode,
      b.seconds,
      b.duration,
      new Date(now()).toISOString(),
    );
    res.json({ ok: true });
  });
  return {
    mediaAccount(req) {
      if (!/^\/api\/hls\/[a-zA-Z0-9_-]+\//.test(req.path)) return null;
      const key = req.path.split("/")[3];
      let d = device(req),
        stream;
      if (d)
        stream = db
          .prepare(
            "SELECT item_id FROM native_tv_streams WHERE device_id=? AND cache_key=? AND expires_at>?",
          )
          .get(d.id, key, now());
      else {
        const ticket = String(req.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("io_tv_stream="))
          ?.slice(13);
        if (!ticket || !/^io_hls_[a-f0-9]{48}$/.test(ticket)) return null;
        stream = db
          .prepare(
            "SELECT item_id,device_id FROM native_tv_streams WHERE ticket_hash=? AND cache_key=? AND expires_at>?",
          )
          .get(hash(ticket), key, now());
        if (stream)
          d = db
            .prepare(
              "SELECT d.*,p.is_kids,a.adult_content_allowed FROM native_tv_devices d JOIN profiles p ON p.id=d.profile_id AND p.account_id=d.account_id JOIN accounts a ON a.id=d.account_id WHERE d.id=? AND d.expires_at>? AND a.approved=1",
            )
            .get(stream.device_id, now());
      }
      if (!d || !stream || !allowed(d, getLibrary().getShow(stream.item_id)))
        return null;
      return {
        id: d.account_id,
        approved: true,
        adultContentAllowed: d.adult_content_allowed !== 0,
        role: "user",
      };
    },
  };
}
module.exports = { registerNativeTV };
