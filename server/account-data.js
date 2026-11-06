const { zipSync, strToU8 } = require("fflate");
const profileTables = [
  "my_list",
  "top_picks",
  "progress",
  "manga_progress",
  "novel_progress",
  "novel_preferences",
  "reviews",
  "comments",
  "watched_episodes",
  "search_history",
  "reader_preferences",
  "experience_preferences",
  "public_profiles",
  "watch_activity",
];
const accountTables = [
  "title_requests",
  "media_reports",
  "episode_discussions",
  "discussion_likes",
  "discussion_reactions",
  "community_preferences",
  "community_notifications",
  "account_external",
];
function exportAccount(db, a) {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name),
  );
  const profiles = db
      .prepare(
        "SELECT id,name,handle,avatar,banner,status,is_kids,created_at,watched_seconds FROM profiles WHERE account_id=?",
      )
      .all(a.id),
    data = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      account: { username: a.username, createdAt: a.createdAt },
      profiles,
    };
  if (tables.has("account_email"))
    data.email =
      db
        .prepare(
          "SELECT email,verified_at FROM account_email WHERE account_id=?",
        )
        .get(a.id) || null;
  for (const name of profileTables)
    if (tables.has(name))
      data[name] = db
        .prepare(
          `SELECT t.* FROM ${name} t JOIN profiles p ON p.id=t.profile_id WHERE p.account_id=?`,
        )
        .all(a.id);
  for (const name of accountTables)
    if (tables.has(name))
      data[name] = db
        .prepare(`SELECT * FROM ${name} WHERE account_id=?`)
        .all(a.id);
  if (tables.has("activity_preferences"))
    data.activityPreferences = db
      .prepare(
        "SELECT t.profile_id,t.enabled FROM activity_preferences t JOIN profiles p ON p.id=t.profile_id WHERE p.account_id=?",
      )
      .all(a.id);
  if (tables.has("tracker_connections"))
    data.trackerConnections = db
      .prepare(
        "SELECT t.profile_id,t.provider,t.display_name FROM tracker_connections t JOIN profiles p ON p.id=t.profile_id WHERE p.account_id=?",
      )
      .all(a.id);
  if (tables.has("notification_delivery_preferences"))
    data.notificationPreferences =
      db
        .prepare(
          "SELECT value FROM notification_delivery_preferences WHERE account_id=?",
        )
        .get(a.id) || null;
  if (tables.has("tv_devices"))
    data.tvDevices = db
      .prepare(
        "SELECT id,name,created_at,last_seen,state FROM tv_devices WHERE account_id=?",
      )
      .all(a.id);
  // Credentials, sessions, OAuth tokens, PINs, password hashes and moderation evidence about other users are deliberately excluded.
  return data;
}
function registerAccountData(
  app,
  { db, requireAuth, accounts, services, getLibrary, publicOrigin = () => "" },
) {
  app.use("/api/account-data", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      req.headers.origin &&
      !new Set([`${req.protocol}://${req.get("host")}`, publicOrigin()]).has(
        req.headers.origin,
      )
    )
      return res.status(403).json({ error: "Request origin is not allowed" });
    next();
  });
  const safe = (fn) => (req, res) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e) => {
        if (!res.headersSent)
          res.status(400).json({ error: e.message || "Request failed" });
      });
  async function proof(req, res) {
    const a = requireAuth(req, res);
    if (!a) return null;
    const p = await accounts.verifyPassword({
      username: a.username,
      password: req.body?.password,
      totpCode: req.body?.totpCode,
    });
    if (p?.id !== a.id)
      throw Error("Confirm your password and two-factor code, if enabled");
    return a;
  }
  const exports = new Map();
  require("./account-restore").registerAccountRestore(app, {
    db,
    requireAuth,
    accounts,
    getLibrary,
  });
  app.post(
    "/api/account-data/email",
    safe(async (req, res) => {
      const a = await proof(req, res);
      if (!a) return;
      const address = db
        .prepare("SELECT email FROM account_email WHERE account_id=?")
        .get(a.id)?.email;
      if (!address || !services?.status().email)
        return res
          .status(503)
          .json({
            error: "Verify your email and configure email delivery first",
          });
      if (Date.now() - (exports.get(a.id) || 0) < 60000)
        return res
          .status(429)
          .json({ error: "Please wait a minute before exporting again" });
      exports.set(a.id, Date.now());
      const archive = Buffer.from(
        zipSync(
          {
            "I-O-account.json": strToU8(
              JSON.stringify(exportAccount(db, a), null, 2),
            ),
          },
          { level: 6 },
        ),
      );
      if (archive.length > 8 * 1024 * 1024)
        throw Error("This export is too large for email; download it instead");
      await services.send(
        address,
        "Your I/O account export",
        "Your requested account export is attached. Keep this archive private. It excludes credentials and sessions.",
        [
          {
            filename: "I-O-account.zip",
            content: archive,
            contentType: "application/zip",
          },
        ],
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/account-data/export",
    safe(async (req, res) => {
      const a = await proof(req, res);
      if (!a) return;
      const last = exports.get(a.id);
      if (last && Date.now() - last < 60000)
        return res
          .status(429)
          .json({ error: "Please wait a minute before exporting again" });
      exports.set(a.id, Date.now());
      if (exports.size > 5000) exports.delete(exports.keys().next().value);
      const data = exportAccount(db, a),
        archive = zipSync(
          {
            "I-O-account.json": strToU8(JSON.stringify(data, null, 2)),
            "README.txt": strToU8(
              "Your I/O account data. Keep this archive private. Credentials and sessions are excluded. This is a personal export, not a server restore backup.",
            ),
          },
          { level: 6 },
        );
      res
        .set("Content-Type", "application/zip")
        .set("Content-Disposition", 'attachment; filename="I-O-account.zip"')
        .send(Buffer.from(archive));
    }),
  );
  app.post(
    "/api/account-data/delete",
    safe(async (req, res) => {
      const a = await proof(req, res);
      if (!a) return;
      if (req.body.confirmation !== a.username)
        return res
          .status(400)
          .json({ error: "Type your exact username to confirm deletion" });
      db.exec("BEGIN IMMEDIATE");
      try {
        accounts.deleteAccount(a.id);
        if (
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE name='totp_backup_codes'",
            )
            .get()
        )
          db.prepare("DELETE FROM totp_backup_codes WHERE account_id=?").run(
            a.id,
          );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      res.json({ ok: true });
    }),
  );
}
module.exports = { registerAccountData, exportAccount };
