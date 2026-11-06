const { randomUUID } = require("node:crypto");
function registerTrackerSeasons(
  app,
  {
    db,
    requireAuth,
    getLibrary,
    credential,
    remote,
    json,
    graph,
    locks,
    now = Date.now,
  },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS tracker_season_mappings(profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,provider TEXT NOT NULL,item_id TEXT NOT NULL,group_name TEXT NOT NULL,tracker_id INTEGER NOT NULL,PRIMARY KEY(profile_id,provider,item_id,group_name),UNIQUE(profile_id,provider,tracker_id));CREATE TABLE IF NOT EXISTS tracker_season_plans(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,value TEXT NOT NULL,expires_at INTEGER NOT NULL)`,
  );
  const safe = (fn) => (req, res) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e) => {
        if (!res.headersSent) res.status(400).json({ error: e.message });
      });
  function owner(req, res) {
    const a = requireAuth(req, res);
    if (!a) return;
    const p = db
      .prepare("SELECT * FROM profiles WHERE id=? AND account_id=?")
      .get(req.params.id, a.id);
    if (!p) {
      res.sendStatus(403);
      return;
    }
    if (!["mal", "anilist"].includes(req.params.provider))
      throw Error("Choose a tracker");
    return { a, p, name: req.params.provider };
  }
  function context(o, b) {
    const title = getLibrary().getShow(b.itemId),
      group = title?.groups?.find((g) => g.name === b.group);
    if (!group?.episodes?.length)
      throw Error("Choose a season with local episodes");
    if (
      (o.p.is_kids || o.a.adultContentAllowed === false) &&
      /(rx|hentai|x-rated)/i.test(title.rating || "")
    )
      throw Error("Title is not available to this profile");
    return { title, group };
  }
  const mapping = (o, b) =>
    db
      .prepare(
        "SELECT tracker_id FROM tracker_season_mappings WHERE profile_id=? AND provider=? AND item_id=? AND group_name=?",
      )
      .get(o.p.id, o.name, b.itemId, b.group)?.tracker_id;
  const snapshot = (o, c) => {
    const watched = new Set(
      db
        .prepare(
          "SELECT episode_rel_path FROM watched_episodes WHERE profile_id=? AND item_id=?",
        )
        .all(o.p.id, c.title.id)
        .map((r) => r.episode_rel_path),
    );
    return c.group.episodes.map((e) => ({
      path: e.relPath,
      watched: watched.has(e.relPath),
    }));
  };
  const mapped = (title, name, id) => ({
    ...title,
    [name === "mal" ? "malId" : "anilistId"]: id,
  });
  const sealed = (o) =>
    db
      .prepare(
        "SELECT credentials FROM tracker_connections WHERE profile_id=? AND provider=?",
      )
      .get(o.p.id, o.name)?.credentials;
  app.get("/api/trackers/:id/:provider/seasons", (req, res) => {
    const o = owner(req, res);
    if (!o) return;
    res.json(
      db
        .prepare(
          "SELECT item_id,group_name,tracker_id FROM tracker_season_mappings WHERE profile_id=? AND provider=?",
        )
        .all(o.p.id, o.name),
    );
  });
  app.put(
    "/api/trackers/:id/:provider/seasons",
    safe(async (req, res) => {
      const o = owner(req, res);
      if (!o) return;
      context(o, req.body);
      const id = req.body.trackerId;
      if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647)
        throw Error("Enter the numeric tracker ID for this season");
      if (locks.has(o.p.id + ":" + o.name))
        throw Error("Wait for the current tracker operation");
      db.prepare(
        "INSERT INTO tracker_season_mappings VALUES(?,?,?,?,?) ON CONFLICT(profile_id,provider,item_id,group_name) DO UPDATE SET tracker_id=excluded.tracker_id",
      ).run(o.p.id, o.name, req.body.itemId, req.body.group, id);
      db.prepare("DELETE FROM tracker_season_plans WHERE account_id=?").run(
        o.a.id,
      );
      res.json({ ok: true });
    }),
  );
  app.delete('/api/trackers/:id/:provider/seasons',safe(async(req,res)=>{
    const o=owner(req,res);if(!o)return;context(o,req.body);
    if(locks.has(o.p.id+':'+o.name))throw Error('Wait for the current tracker operation');
    db.prepare('DELETE FROM tracker_season_mappings WHERE profile_id=? AND provider=? AND item_id=? AND group_name=?').run(o.p.id,o.name,req.body.itemId,req.body.group);
    db.prepare('DELETE FROM tracker_season_plans WHERE account_id=?').run(o.a.id);res.json({ok:true});
  }));
  app.post(
    "/api/trackers/:id/:provider/seasons/preview",
    safe(async (req, res) => {
      const o = owner(req, res);
      if (!o) return;
      const b = req.body,
        c = context(o, b),
        id = mapping(o, b);
      if (!id) throw Error("Save a season mapping first");
      if (!["push", "pull"].includes(b.direction))
        throw Error("Choose a sync direction");
      const token = await credential(o.p.id, o.name),
        connection = sealed(o),
        before = snapshot(o, c),
        r = await remote(token, o.name, mapped(c.title, o.name, id), "anime");
      if (!r.exists) throw Error("Add this season to your tracker list first");
      if (
        !Number.isInteger(r.count) ||
        r.count < 0 ||
        r.count > c.group.episodes.length
      )
        throw Error(
          "Tracker progress exceeds this local season. Verify the mapping and add missing episodes before syncing",
        );
      if (b.direction === "push" && r.specialStatus)
        throw Error(
          "Paused/repeating entries require advanced review before publishing progress",
        );
      const count = before.filter((e) => e.watched).length;
      if (
        b.direction === "push" &&
        before.some(
          (e, i) => e.watched && before.slice(0, i).some((x) => !x.watched),
        )
      )
        throw Error(
          "Watched episodes have gaps. Mark a consecutive run before publishing a tracker count",
        );
      const plan = {
        profileId: o.p.id,
        provider: o.name,
        itemId: c.title.id,
        group: b.group,
        trackerId: id,
        direction: b.direction,
        before,
        remote: r,
        connection,
        subject: token.subject,
      };
      db.prepare(
        "DELETE FROM tracker_season_plans WHERE account_id=? OR expires_at<?",
      ).run(o.a.id, now());
      const planId = randomUUID();
      db.prepare("INSERT INTO tracker_season_plans VALUES(?,?,?,?)").run(
        planId,
        o.a.id,
        JSON.stringify(plan),
        now() + 300000,
      );
      res.json({
        id: planId,
        title: c.title.title,
        group: b.group,
        trackerId: id,
        direction: b.direction,
        localCount: count,
        remoteCount: r.count,
      });
    }),
  );
  app.post(
    "/api/trackers/:id/:provider/seasons/apply",
    safe(async (req, res) => {
      const o = owner(req, res);
      if (!o) return;
      const row = db
        .prepare(
          "SELECT * FROM tracker_season_plans WHERE id=? AND account_id=? AND expires_at>?",
        )
        .get(req.body.planId, o.a.id, now());
      if (!row) throw Error("Preview expired; review again");
      const p = JSON.parse(row.value);
      if (p.profileId !== o.p.id || p.provider !== o.name)
        throw Error("Preview belongs to another profile or tracker");
      const key = o.p.id + ":" + o.name;
      if (locks.has(key)) throw Error("Another tracker operation is running");
      locks.add(key);
      try {
        db.prepare("DELETE FROM tracker_season_plans WHERE id=?").run(row.id);
        const c = context(o, p),
          token = await credential(o.p.id, o.name),
          r = await remote(
            token,
            o.name,
            mapped(c.title, o.name, p.trackerId),
            "anime",
          );
        const current = owner(req, res);
        if (!current) return;
        const fresh = context(current, p);
        if (
          mapping(o, p) !== p.trackerId ||
          sealed(o) !== p.connection ||
          token.subject !== p.subject ||
          JSON.stringify(snapshot(current, fresh)) !==
            JSON.stringify(p.before) ||
          JSON.stringify(r) !== JSON.stringify(p.remote)
        )
          throw Error(
            "Season, progress or tracker connection changed; preview again",
          );
        if (p.direction === "push") {
          const count = p.before.filter((e) => e.watched).length;
          if (o.name === "mal")
            await json(
              "https://api.myanimelist.net/v2/anime/" +
                p.trackerId +
                "/my_list_status",
              {
                method: "PATCH",
                headers: {
                  Authorization: "Bearer " + token.access_token,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  num_watched_episodes: String(count),
                }).toString(),
              },
            );
          else
            await graph(
              token.access_token,
              "mutation($id:Int!,$progress:Int!){SaveMediaListEntry(mediaId:$id,progress:$progress){id}}",
              { id: p.trackerId, progress: count },
            );
        } else {
          db.exec("BEGIN IMMEDIATE");
          try {
            const remove = db.prepare(
              "DELETE FROM watched_episodes WHERE profile_id=? AND item_id=? AND episode_rel_path=?",
            );
            for (const ep of fresh.group.episodes)
              remove.run(o.p.id, c.title.id, ep.relPath);
            const insert = db.prepare(
              "INSERT INTO watched_episodes(profile_id,item_id,item_type,episode_rel_path,episode_title,watched_at) VALUES(?,?,?,?,?,?)",
            );
            for (const ep of fresh.group.episodes.slice(0, r.count))
              insert.run(
                o.p.id,
                c.title.id,
                "anime",
                ep.relPath,
                ep.title || "",
                new Date(now()).toISOString(),
              );
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
        }
        res.json({ ok: true });
      } finally {
        locks.delete(key);
      }
    }),
  );
}
module.exports = { registerTrackerSeasons };
