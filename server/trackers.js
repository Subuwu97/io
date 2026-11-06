const { randomBytes, createHash, randomUUID } = require("node:crypto");
const digest = (v) => createHash("sha256").update(v).digest("hex");
const fromRemote = {
  watching: "in_progress",
  reading: "in_progress",
  completed: "completed",
  plan_to_watch: "planned",
  plan_to_read: "planned",
  dropped: "dropped",
  on_hold: "planned",
  CURRENT: "in_progress",
  COMPLETED: "completed",
  PLANNING: "planned",
  DROPPED: "dropped",
  PAUSED: "planned",
  REPEATING: "in_progress",
};
function registerTrackers(
  app,
  {
    db,
    requireAuth,
    accounts,
    services,
    secrets,
    getLibrary,
    fetchImpl = fetch,
    now = Date.now,
    startWorker = true,
  },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS tracker_connections(profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,provider TEXT NOT NULL,credentials TEXT NOT NULL,display_name TEXT NOT NULL,PRIMARY KEY(profile_id,provider));CREATE TABLE IF NOT EXISTS tracker_states(hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,provider TEXT NOT NULL,binding TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS tracker_plans(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,value TEXT NOT NULL,expires_at INTEGER NOT NULL);`,
  );
  const locks = new Set(),
    limits = new Map();
  const safe = (fn) => (req, res) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e) => {
        if (!res.headersSent)
          res
            .status(400)
            .json({ error: e.message || "Tracker request failed" });
      });
  app.use("/api/trackers", (req, res, next) => {
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
    if (!p) {
      res.status(403).json({ error: "Profile not available" });
      return;
    }
    return { a, p };
  }
  function provider(req) {
    if (!["mal", "anilist"].includes(req.params.provider))
      throw Error("Choose MyAnimeList or AniList");
    return req.params.provider;
  }
  function settings() {
    const config = secrets.get();
    return {
      mal: {
        clientId: config.malClientId || "",
        clientSecret: config.malSecret || "",
      },
      anilist: {
        clientId: config.anilistClientId || "",
        clientSecret: config.anilistSecret || "",
      },
    };
  }
  function available(name) {
    const s = settings()[name];
    return !!(
      services.get().publicUrl &&
      s.clientId &&
      (name === "mal" || s.clientSecret)
    );
  }
  function redirect(name) {
    return services.get().publicUrl + "/api/trackers/callback/" + name;
  }
  async function json(url, options = {}) {
    const r = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw Error(
        r.status === 429
          ? "Tracker rate limit reached; try again later"
          : "Tracker rejected the request. Reconnect if authorization has expired.",
      );
    const data = await r.json();
    if (data.errors) throw Error("Tracker could not complete that operation");
    return data;
  }
  const graph = (token, query, variables) =>
    json("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  async function credential(p, name) {
    const row = db
      .prepare(
        "SELECT * FROM tracker_connections WHERE profile_id=? AND provider=?",
      )
      .get(p, name);
    if (!row) throw Error("Connect this tracker first");
    let token = secrets.open(row.credentials);
    if (token.expiresAt && token.expiresAt <= now() + 60000) {
      if (name !== "mal" || !token.refresh_token)
        throw Error("Reconnect AniList to renew authorization");
      const cfg = settings().mal,
        next = await json("https://myanimelist.net/v1/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: cfg.clientId,
            ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
            grant_type: "refresh_token",
            refresh_token: token.refresh_token,
          }).toString(),
        });
      token = {
        ...next,
        subject: token.subject,
        expiresAt: now() + next.expires_in * 1000,
      };
      db.prepare(
        "UPDATE tracker_connections SET credentials=? WHERE profile_id=? AND provider=?",
      ).run(secrets.seal(token), p, name);
    }
    return token;
  }
  function item(id, type) {
    const library = getLibrary();
    return type === "manga"
      ? library.getManga(id)
      : type === "anime"
        ? library.getShow(id)
        : null;
  }
  function local(profile, title, type) {
    const status =
      db
        .prepare(
          "SELECT status FROM my_list WHERE profile_id=? AND item_id=? AND item_type=?",
        )
        .get(profile, title.id, type)?.status || "planned";
    let count;
    if (type === "anime")
      count = db
        .prepare(
          "SELECT COUNT(*) n FROM watched_episodes WHERE profile_id=? AND item_id=?",
        )
        .get(profile, title.id).n;
    else {
      const progress = db
        .prepare(
          "SELECT chapter_name,page,total_pages FROM manga_progress WHERE profile_id=? AND manga_id=?",
        )
        .get(profile, title.id);
      count = progress
        ? Math.max(
            0,
            title.chapters.findIndex((c) => c.name === progress.chapter_name),
          ) + (progress.page >= progress.total_pages ? 1 : 0)
        : 0;
    }
    return { status, count };
  }
  const specialStatus=(status,repeat)=>repeat||status==='REPEATING'?'repeating':status==='on_hold'||status==='PAUSED'?'paused':status&&!Object.hasOwn(fromRemote,status)?'unknown':null;
  async function remote(token, name, title, type) {
    const id = Number(title[name === "mal" ? "malId" : "anilistId"]);
    if (!Number.isSafeInteger(id) || id <= 0)
      throw Error("Add the correct tracker ID to this title’s metadata first");
    if (name === "mal") {
      const data = await json(
          `https://api.myanimelist.net/v2/${type}/${id}?fields=my_list_status`,
          { headers: { Authorization: "Bearer " + token.access_token } },
        ),
        s = data.my_list_status;
      return {
        status: fromRemote[s?.status] || "planned",
        exists:!!s,
        ...(specialStatus(s?.status,s?.is_rewatching||s?.is_rereading)?{specialStatus:specialStatus(s?.status,s?.is_rewatching||s?.is_rereading)}:{}),
        count:
          s?.[
            type === "manga" ? "num_chapters_read" : "num_episodes_watched"
          ] || 0,
      };
    }
    const data = await graph(
        token.access_token,
        "query($id:Int!){Viewer{id} Media(id:$id){mediaListEntry{status progress}}}",
        { id },
      ),
      entry = data.data.Media?.mediaListEntry;
    return {
      status: fromRemote[entry?.status] || "planned",
      exists:!!entry,
      ...(specialStatus(entry?.status,false)?{specialStatus:specialStatus(entry?.status,false)}:{}),
      count: entry?.progress || 0,
    };
  }
  app.get(
    "/api/trackers/setup",
    safe(async (req, res) => {
      const a = requireAuth(req, res);
      if (!a) return;
      const s = settings();
      res.json({
        mal: available("mal"),
        anilist: available("anilist"),
        ...(a.role === "admin"
          ? {
              malClientId: s.mal.clientId,
              anilistClientId: s.anilist.clientId,
              malSecretConfigured: !!s.mal.clientSecret,
              anilistSecretConfigured: !!s.anilist.clientSecret,
              malRedirect: redirect("mal"),
              anilistRedirect: redirect("anilist"),
            }
          : {}),
      });
    }),
  );
  app.put(
    "/api/trackers/setup",
    safe(async (req, res) => {
      const a = requireAuth(req, res);
      if (!a) return;
      if (a.role !== "admin") return res.sendStatus(403);
      const proof = await accounts.verifyPassword({
        username: a.username,
        password: req.body.password,
        totpCode: req.body.totpCode,
      });
      if (proof?.id !== a.id)
        throw Error("Confirm your password and two-factor code");
      const next = secrets.get();
      for (const k of ["malClientId", "anilistClientId"]) {
        if (
          typeof req.body[k] !== "string" ||
          req.body[k].length > 200 ||
          !/^[a-zA-Z0-9_-]*$/.test(req.body[k])
        )
          throw Error("Invalid tracker client ID");
        next[k] = req.body[k];
      }
      for (const k of ["malSecret", "anilistSecret"])
        if (req.body[k]) {
          if (typeof req.body[k] !== "string" || req.body[k].length > 4096)
            throw Error("Invalid tracker secret");
          next[k] = req.body[k];
        }
      secrets.save(next);
      res.json({ ok: true });
    }),
  );
  app.get("/api/trackers/:id/connections", (req, res) => {
    const owner = own(req, res);
    if (owner)
      res.json(
        db
          .prepare(
            "SELECT provider,display_name AS displayName FROM tracker_connections WHERE profile_id=?",
          )
          .all(owner.p.id),
      );
  });
  app.post(
    "/api/trackers/:id/:provider/connect",
    safe(async (req, res) => {
      const owner = own(req, res);
      if (!owner) return;
      const name = provider(req);
      if (!available(name))
        throw Error(
          "The administrator must configure this tracker application first",
        );
      const state = randomBytes(32).toString("hex"),
        binding = randomBytes(32).toString("hex"),
        verifier = randomBytes(48).toString("base64url"),
        cfg = settings()[name];
      db.prepare(
        "DELETE FROM tracker_states WHERE expires_at<? OR (profile_id=? AND provider=?)",
      ).run(now(), owner.p.id, name);
      db.prepare("INSERT INTO tracker_states VALUES(?,?,?,?,?,?,?)").run(
        digest(state),
        owner.a.id,
        owner.p.id,
        name,
        digest(binding),
        verifier,
        now() + 600000,
      );
      res.append(
        "Set-Cookie",
        `io_tracker=${binding}; HttpOnly; SameSite=Lax; Path=/api/trackers; Max-Age=600${services.get().publicUrl.startsWith("https:") ? "; Secure" : ""}`,
      );
      const url = new URL(
        name === "mal"
          ? "https://myanimelist.net/v1/oauth2/authorize"
          : "https://anilist.co/api/v2/oauth/authorize",
      );
      url.search = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirect(name),
        response_type: "code",
        state,
        ...(name === "mal"
          ? { code_challenge: verifier, code_challenge_method: "plain" }
          : {}),
      });
      res.json({ url: url.href });
    }),
  );
  app.get(
    "/api/trackers/callback/:provider",
    safe(async (req, res) => {
      const a = requireAuth(req, res);
      if (!a) return;
      const name = provider(req),
        state = req.query.state,
        code = req.query.code,
        binding = (req.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("io_tracker="))
          ?.slice(11);
      if (
        typeof state !== "string" ||
        state.length !== 64 ||
        typeof code !== "string" ||
        code.length > 4096 ||
        !binding
      )
        throw Error("Tracker authorization expired or was cancelled");
      const row = db
        .prepare("SELECT * FROM tracker_states WHERE hash=? AND expires_at>?")
        .get(digest(state), now());
      if (
        !row ||
        row.account_id !== a.id ||
        row.provider !== name ||
        row.binding !== digest(binding)
      )
        throw Error("Tracker request belongs to another browser or account");
      db.prepare("DELETE FROM tracker_states WHERE hash=?").run(row.hash);
      const cfg = settings()[name],
        body = {
          client_id: cfg.clientId,
          grant_type: "authorization_code",
          redirect_uri: redirect(name),
          code,
          ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
          ...(name === "mal" ? { code_verifier: row.verifier } : {}),
        };
      const token = await json(
        name === "mal"
          ? "https://myanimelist.net/v1/oauth2/token"
          : "https://anilist.co/api/v2/oauth/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams(body).toString(),
        },
      );
      if (typeof token.access_token !== "string")
        throw Error("Tracker did not return authorization");
      const user =
        name === "mal"
          ? await json("https://api.myanimelist.net/v2/users/@me", {
              headers: { Authorization: "Bearer " + token.access_token },
            })
          : (await graph(token.access_token, "query{Viewer{id name}}", {})).data
              .Viewer;
      if (!user?.id) throw Error("Could not identify the tracker account");
      token.subject = String(user.id);
      token.expiresAt = token.expires_in
        ? now() + token.expires_in * 1000
        : null;
      db.prepare(
        "INSERT INTO tracker_connections VALUES(?,?,?,?) ON CONFLICT(profile_id,provider) DO UPDATE SET credentials=excluded.credentials,display_name=excluded.display_name",
      ).run(
        row.profile_id,
        name,
        secrets.seal(token),
        String(user.name || user.id).slice(0, 200),
      );
      res.redirect("/#/trackers");
    }),
  );
  app.delete("/api/trackers/:id/:provider", (req, res) => {
    const owner = own(req, res);
    if (!owner) return;
    const name = req.params.provider;
    if (!["mal", "anilist"].includes(name)) return res.sendStatus(400);
    db.prepare(
      "DELETE FROM tracker_connections WHERE profile_id=? AND provider=?",
    ).run(owner.p.id, name);
    db.prepare("DELETE FROM tracker_plans WHERE account_id=?").run(owner.a.id);
    db.prepare(
      "UPDATE tracker_automation SET enabled=0 WHERE profile_id=? AND provider=?",
    ).run(owner.p.id, name);
    db.prepare(
      "UPDATE tracker_jobs SET status='cancelled' WHERE profile_id=? AND provider=? AND status IN ('preparing','preview','queued','running')",
    ).run(owner.p.id, name);
    db.prepare(
      "DELETE FROM tracker_baselines WHERE profile_id=? AND provider=?",
    ).run(owner.p.id, name);
    db.prepare("DELETE FROM tracker_detail_plans WHERE account_id=?").run(owner.a.id);
    res.json({ ok: true });
  });
  app.post(
    "/api/trackers/:id/:provider/preview",
    safe(async (req, res) => {
      const owner = own(req, res);
      if (!owner) return;
      const name = provider(req),
        b = req.body || {},
        title = item(b.itemId, b.itemType);
      if (!title || !["pull", "push"].includes(b.direction))
        throw Error("Choose a title and sync direction");
      if(db.prepare('SELECT 1 FROM tracker_season_mappings WHERE profile_id=? AND provider=? AND item_id=?').get(owner.p.id,name,title.id))throw Error('This title uses season mappings. Use the season editor to avoid changing other seasons');
      if (
        (owner.p.is_kids || owner.a.adultContentAllowed === false) &&
        /(rx|hentai|x-rated)/i.test(title.rating || "")
      )
        throw Error("Title is not available to this profile");
      const key = owner.a.id,
        previous = limits.get(key);
      if (previous && now() - previous < 1000)
        throw Error("Please wait before previewing again");
      limits.set(key, now());
      if (limits.size > 5000) limits.delete(limits.keys().next().value);
      const token = await credential(owner.p.id, name),
        beforeLocal = local(owner.p.id, title, b.itemType),
        beforeRemote = await remote(token, name, title, b.itemType),
        id = randomUUID(),
        plan = {
          profileId: owner.p.id,
          provider: name,
          itemId: title.id,
          itemType: b.itemType,
          title: title.title,
          direction: b.direction,
          trackerId: Number(title[name === "mal" ? "malId" : "anilistId"]),
          trackerSubject: token.subject,
          beforeLocal,
          beforeRemote,
        };
      db.prepare(
        "DELETE FROM tracker_plans WHERE expires_at<? OR account_id=?",
      ).run(now(), owner.a.id);
      db.prepare("INSERT INTO tracker_plans VALUES(?,?,?,?)").run(
        id,
        owner.a.id,
        JSON.stringify(plan),
        now() + 300000,
      );
      res.json({ id, ...plan });
    }),
  );
  app.post(
    "/api/trackers/:id/:provider/apply",
    safe(async (req, res) => {
      const owner = own(req, res);
      if (!owner) return;
      const name = provider(req),
        row =
          typeof req.body?.planId === "string" &&
          db
            .prepare(
              "SELECT * FROM tracker_plans WHERE id=? AND account_id=? AND expires_at>?",
            )
            .get(req.body.planId, owner.a.id, now());
      if (!row) throw Error("Preview the changes again");
      const plan = JSON.parse(row.value);
      if (plan.profileId !== owner.p.id || plan.provider !== name)
        throw Error("Sync preview belongs to another profile");
      const key = owner.p.id + ":" + name;
      if (locks.has(key)) throw Error("A sync is already in progress");
      locks.add(key);
      try {
        db.prepare("DELETE FROM tracker_plans WHERE id=?").run(row.id);
        const title = item(plan.itemId, plan.itemType);
        if (!title) throw Error("Title is no longer available");
        if(db.prepare('SELECT 1 FROM tracker_season_mappings WHERE profile_id=? AND provider=? AND item_id=?').get(owner.p.id,name,title.id))throw Error('Season mapping changed; use the season editor');
        const token = await credential(owner.p.id, name),
          sealed=db.prepare("SELECT credentials FROM tracker_connections WHERE profile_id=? AND provider=?").get(owner.p.id,name)?.credentials,
          l = local(owner.p.id, title, plan.itemType),
          r = await remote(token, name, title, plan.itemType);
        if (
          Number(title[name === "mal" ? "malId" : "anilistId"]) !==
            plan.trackerId ||
          token.subject !== plan.trackerSubject ||
          JSON.stringify(local(owner.p.id, title, plan.itemType)) !==
            JSON.stringify(plan.beforeLocal) ||
          JSON.stringify(l) !== JSON.stringify(plan.beforeLocal) ||
          JSON.stringify(r) !== JSON.stringify(plan.beforeRemote)
        )
          throw Error("Progress changed since the preview; review it again");
        if(plan.direction==='push'&&r.specialStatus)throw Error('This entry is paused, repeating or uses an unsupported state. Review advanced tracker details before changing its progress.');
        if(db.prepare('SELECT credentials FROM tracker_connections WHERE profile_id=? AND provider=?').get(owner.p.id,name)?.credentials!==sealed)throw Error('Tracker authorization changed');
        const current=own(req,res);if(!current)return;if((current.p.is_kids||current.a.adultContentAllowed===false)&&/(rx|hentai|x-rated)/i.test(title.rating||''))throw Error('Profile restrictions changed');
        await jobs.apply({
          profileId: owner.p.id,
          name,
          title,
          type: plan.itemType,
          desired: plan.direction === "push" ? l : r,
          direction: plan.direction,
          token,
        });
        res.json({ ok: true });
      } finally {
        locks.delete(key);
      }
    }),
  );
  const jobs = require("./tracker-jobs").registerTrackerJobs(app, {
    db,
    requireAuth,
    getLibrary,
    credential,
    local,
    remote,
    json,
    graph,
    locks,
    now,
    startWorker,
  });
  require("./tracker-details").registerTrackerDetails(app,{db,requireAuth,credential,getLibrary,json,graph,locks,now});
  require('./tracker-seasons').registerTrackerSeasons(app,{db,requireAuth,getLibrary,credential,remote,json,graph,locks,now});
  return jobs;
}
module.exports = { registerTrackers };
