const { randomUUID } = require("node:crypto");
const categories = ["episodes", "seasons", "upcoming", "announcements"];
const defaults = () =>
  Object.fromEntries(
    categories.map((k) => [k, { inapp: true, email: false, discord: false }]),
  );
function validWebhook(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      u.hostname === "discord.com" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      /^\/api\/webhooks\/\d{5,30}\/[A-Za-z0-9_-]{30,200}$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
function registerNotificationDelivery(
  app,
  {
    db,
    requireAuth,
    services,
    secrets,
    notifications,
    getLibrary,
    fetchImpl = fetch,
    now = Date.now,
    startWorker = true,
  },
) {
  const cols = new Set(
    db
      .prepare("PRAGMA table_info(notifications)")
      .all()
      .map((c) => c.name),
  );
  if (!cols.has("category"))
    db.exec(
      "ALTER TABLE notifications ADD COLUMN category TEXT NOT NULL DEFAULT 'announcements'",
    );
  db.exec(
    `CREATE TABLE IF NOT EXISTS notification_delivery_preferences(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,value TEXT NOT NULL,webhook TEXT NOT NULL DEFAULT '');CREATE TABLE IF NOT EXISTS delivery_queue(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,channel TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,error TEXT NOT NULL DEFAULT '',UNIQUE(account_id,notification_id,channel));CREATE TABLE IF NOT EXISTS season_tracker(item_id TEXT PRIMARY KEY,groups_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS upcoming_notified(id TEXT PRIMARY KEY);`,
  );
  function preferences(id) {
    const row = db
      .prepare(
        "SELECT * FROM notification_delivery_preferences WHERE account_id=?",
      )
      .get(id);
    return {
      value: { ...defaults(), ...(row ? JSON.parse(row.value) : {}) },
      webhook: row?.webhook || "",
    };
  }
  function eligible(a, n) {
    if (!a.approved) return false;
    const match = n.link?.match(/^#\/(title|manga)\/([^/]+)/);
    if (!match) return true;
    const item =
      match[1] === "manga"
        ? getLibrary().getManga(match[2])
        : getLibrary().getShow(match[2]);
    if (!item) return false;
    if (!/(rx|hentai|x-rated)/i.test(item.rating || "")) return true;
    return !!a.adult_content_allowed && !a.is_kids;
  }
  const originalList = notifications.listForProfile;
  notifications.listForProfile = function (profile, ...rest) {
    const p = db.prepare("SELECT * FROM profiles WHERE id=?").get(profile);
    if (!p) return [];
    const a = db.prepare("SELECT * FROM accounts WHERE id=?").get(p.account_id),
      prefs = preferences(p.account_id).value,
      limit = rest[0] || 50;
    return originalList(profile, Math.min(500, limit * 10))
      .filter(
        (n) =>
          prefs[n.category || "announcements"]?.inapp !== false &&
          eligible({ ...a, is_kids: p.is_kids }, n),
      )
      .slice(0, limit);
  };
  function enqueue(n) {
    const targets = n.profileId
      ? db
          .prepare(
            "SELECT a.*,p.is_kids FROM accounts a JOIN profiles p ON p.account_id=a.id WHERE p.id=?",
          )
          .all(n.profileId)
      : db.prepare("SELECT * FROM accounts").all();
    for (const a of targets) {
      if (!eligible(a, n)) continue;
      const prefs =
        preferences(a.id).value[n.category] || defaults().announcements;
      for (const channel of ["email", "discord"])
        if (prefs[channel])
          db.prepare(
            "INSERT OR IGNORE INTO delivery_queue(id,account_id,notification_id,channel,next_at) VALUES(?,?,?,?,?)",
          ).run(randomUUID(), a.id, n.id, channel, now());
    }
  }
  notifications.setDeliveryHook(enqueue);
  app.use("/api/notification-delivery", (req, res, next) => {
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
  app.get("/api/notification-delivery", (req, res) => {
    const a = requireAuth(req, res);
    if (!a) return;
    const p = preferences(a.id);
    res.json({
      preferences: p.value,
      webhookConfigured: !!p.webhook,
      emailReady:
        services.status().email &&
        !!db
          .prepare("SELECT email FROM account_email WHERE account_id=?")
          .get(a.id),
      recent: db
        .prepare(
          "SELECT channel,status,attempts,error FROM delivery_queue WHERE account_id=? ORDER BY next_at DESC LIMIT 20",
        )
        .all(a.id),
    });
  });
  app.put("/api/notification-delivery", (req, res) => {
    const a = requireAuth(req, res);
    if (!a) return;
    const b = req.body || {};
    if (
      !b.preferences ||
      categories.some(
        (k) =>
          !b.preferences[k] ||
          ["inapp", "email", "discord"].some(
            (c) => typeof b.preferences[k][c] !== "boolean",
          ),
      )
    )
      return res
        .status(400)
        .json({ error: "Choose notification categories and channels" });
    const current = preferences(a.id),
      value = Object.fromEntries(
        categories.map((k) => [
          k,
          Object.fromEntries(
            ["inapp", "email", "discord"].map((c) => [c, b.preferences[k][c]]),
          ),
        ]),
      );
    let webhook = current.webhook;
    if (b.removeWebhook === true) webhook = "";
    else if (b.webhook) {
      if (typeof b.webhook !== "string" || !validWebhook(b.webhook))
        return res
          .status(400)
          .json({ error: "Use a Discord webhook address from discord.com" });
      webhook = secrets.seal(b.webhook);
    }
    if (categories.some((k) => value[k].discord) && !webhook)
      return res
        .status(400)
        .json({
          error: "Set a Discord webhook before enabling Discord delivery",
        });
    if (
      categories.some((k) => value[k].email) &&
      (!services.status().email ||
        !db
          .prepare("SELECT email FROM account_email WHERE account_id=?")
          .get(a.id))
    )
      return res
        .status(400)
        .json({
          error:
            "Configure email and verify your address before enabling email delivery",
        });
    db.prepare(
      "INSERT INTO notification_delivery_preferences VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET value=excluded.value,webhook=excluded.webhook",
    ).run(a.id, JSON.stringify(value), webhook);
    res.json({ ok: true });
  });
  let busy = false;
  async function work() {
    if (busy) return;
    busy = true;
    try {
      db.prepare(
        "UPDATE delivery_queue SET status='pending' WHERE status='sending' AND next_at<?",
      ).run(now() - 60000);
      const jobs = db
        .prepare(
          "SELECT q.*,n.title,n.message,n.link,n.category,n.profile_id FROM delivery_queue q JOIN notifications n ON n.id=q.notification_id WHERE q.status='pending' AND q.next_at<=? ORDER BY q.next_at LIMIT 10",
        )
        .all(now());
      for (const job of jobs) {
        const p = preferences(job.account_id),
          a = db
            .prepare("SELECT * FROM accounts WHERE id=?")
            .get(job.account_id),
          channel = p.value[job.category]?.[job.channel];
        const profile =
          job.profile_id &&
          db
            .prepare("SELECT is_kids FROM profiles WHERE id=?")
            .get(job.profile_id);
        if (
          !a ||
          !a.approved ||
          !channel ||
          !eligible({ ...a, is_kids: profile?.is_kids }, job)
        ) {
          db.prepare(
            "UPDATE delivery_queue SET status='cancelled' WHERE id=?",
          ).run(job.id);
          continue;
        }
        db.prepare(
          "UPDATE delivery_queue SET status='sending',next_at=? WHERE id=?",
        ).run(now(), job.id);
        try {
          const text = `${job.title}\n\n${job.message}${job.link && services.get().publicUrl ? "\n\n" + services.get().publicUrl + "/" + job.link : ""}`;
          if (job.channel === "email") {
            const address = db
              .prepare("SELECT email FROM account_email WHERE account_id=?")
              .get(a.id)?.email;
            if (!address) throw Error();
            await services.send(address, job.title, text);
          } else {
            if (!p.webhook) throw Error();
            const url = secrets.open(p.webhook);
            if (!validWebhook(url)) throw Error();
            const response = await fetchImpl(url, {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(10000),
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: text.slice(0, 1900),
                allowed_mentions: { parse: [] },
              }),
            });
            if (!response.ok) throw Error();
          }
          db.prepare(
            "UPDATE delivery_queue SET status='sent',attempts=attempts+1,error='' WHERE id=?",
          ).run(job.id);
        } catch {
          db.prepare(
            "UPDATE delivery_queue SET status=?,attempts=attempts+1,next_at=?,error=? WHERE id=?",
          ).run(
            job.attempts >= 2 ? "failed" : "pending",
            now() + 60000 * (job.attempts + 1),
            "Delivery failed; check destination and service settings",
            job.id,
          );
        }
      }
      db.prepare(
        "DELETE FROM delivery_queue WHERE status IN ('sent','cancelled','failed') AND next_at<?",
      ).run(now() - 30 * 86400000);
    } finally {
      busy = false;
    }
  }
  function checkSeasons() {
    for (const show of [
      ...getLibrary().cache.anime,
      ...getLibrary().cache.movies,
    ]) {
      const names = (show.groups || [])
          .map((g) => g.name || g.title || "")
          .filter(Boolean),
        row = db
          .prepare("SELECT groups_json FROM season_tracker WHERE item_id=?")
          .get(show.id);
      if (row) {
        const added = names.filter(
          (n) => !JSON.parse(row.groups_json).includes(n),
        );
        if (added.length) {
          const profiles = db
            .prepare(
              "SELECT DISTINCT profile_id FROM my_list WHERE item_id=? UNION SELECT profile_id FROM top_picks WHERE item_id=? UNION SELECT profile_id FROM progress WHERE item_id=?",
            )
            .all(show.id, show.id, show.id);
          for (const p of profiles)
            notifications.create({
              title: "New season: " + show.title.slice(0, 100),
              message: added.join(", "),
              category: "seasons",
              profileId: p.profile_id,
              createdBy: null,
              link: "#/title/" + show.id,
            });
        }
      }
      db.prepare(
        "INSERT INTO season_tracker VALUES(?,?) ON CONFLICT(item_id) DO UPDATE SET groups_json=excluded.groups_json",
      ).run(show.id, JSON.stringify(names));
    }
  }
  function checkUpcoming() {
    const entries = db
      .prepare(
        "SELECT * FROM upcoming_titles WHERE release_at>=? AND release_at<=?",
      )
      .all(
        new Date(now()).toISOString(),
        new Date(now() + 86400000).toISOString(),
      );
    for (const item of entries) {
      if (/rx|hentai|x-rated/i.test(item.rating)) continue;
      if (
        !db
          .prepare("INSERT OR IGNORE INTO upcoming_notified VALUES(?)")
          .run(item.id).changes
      )
        continue;
      notifications.create({
        title: "Coming soon: " + item.title.slice(0, 100),
        message:
          "Expected " +
          new Date(item.release_at).toLocaleString() +
          ". " +
          item.description,
        category: "upcoming",
        createdBy: null,
        link: "#/new",
      });
    }
  }
  const timer = startWorker
    ? setInterval(() => {
        try {
          checkUpcoming();
        } catch {}
        work().catch(() => {});
      }, 10000)
    : null;
  timer?.unref();
  return {
    work,
    checkSeasons,
    checkUpcoming,
    stop: () => clearInterval(timer),
  };
}
module.exports = { registerNotificationDelivery, categories, validWebhook };
