const { randomUUID } = require("node:crypto");
const remoteStatuses = {
  watching: "in_progress",
  reading: "in_progress",
  completed: "completed",
  dropped: "dropped",
  CURRENT: "in_progress",
  COMPLETED: "completed",
  DROPPED: "dropped",
  REPEATING: "in_progress",
};
const equal = (a, b) => a?.status === b?.status && a?.count === b?.count && a?.specialStatus === b?.specialStatus;
function registerTrackerJobs(
  app,
  {
    db,
    requireAuth,
    getLibrary,
    credential,
    local,
    remote,
    json,
    graph,
    locks,
    now = Date.now,
    startWorker = true,
  },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS tracker_jobs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,provider TEXT NOT NULL,direction TEXT NOT NULL,status TEXT NOT NULL,value TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,error TEXT NOT NULL DEFAULT '');CREATE TABLE IF NOT EXISTS tracker_automation(profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,provider TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,last_at INTEGER NOT NULL DEFAULT 0,cursor INTEGER NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '',PRIMARY KEY(profile_id,provider));CREATE TABLE IF NOT EXISTS tracker_baselines(profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,provider TEXT NOT NULL,item_type TEXT NOT NULL,item_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(profile_id,provider,item_type,item_id));`,
  );
  db.exec('CREATE TABLE IF NOT EXISTS tracker_title_details(profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,provider TEXT NOT NULL,item_type TEXT NOT NULL,item_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(profile_id,provider,item_type,item_id))');
  if(!db.prepare('PRAGMA table_info(tracker_automation)').all().some(c=>c.name==='direction'))db.exec("ALTER TABLE tracker_automation ADD COLUMN direction TEXT NOT NULL DEFAULT 'push'");
  db.prepare(
    "UPDATE tracker_jobs SET status='failed',error='Preview preparation was interrupted; create a new preview' WHERE status='preparing'",
  ).run();
  function own(req, res) {
    const a = requireAuth(req, res);
    if (!a) return;
    const p = db
      .prepare("SELECT * FROM profiles WHERE id=? AND account_id=?")
      .get(req.params.id, a.id);
    if (!p) {
      res.sendStatus(403);
      return;
    }
    if (!["mal", "anilist"].includes(req.params.provider)) {
      res.sendStatus(400);
      return;
    }
    return { a, p };
  }
  const safe = (fn) => (req, res) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e) => {
        if (!res.headersSent) res.status(400).json({ error: e.message });
      });
  function eligible(p, a, item) {
    return (
      item &&
      (!(
        p.is_kids ||
        a.adultContentAllowed === false ||
        a.adult_content_allowed === 0
      ) ||
        !/(rx|hentai|x-rated)/i.test(item.rating || ""))
    );
  }
  function titles(profile, name, all = false) {
    const lib = getLibrary(),
      catalog = [...lib.cache.anime, ...lib.cache.movies]
        .map((t) => ({ title: t, type: "anime" }))
        .concat(
          (lib.cache.manga || []).map((t) => ({ title: t, type: "manga" })),
        ),
      saved = new Set(
        db
          .prepare("SELECT item_type,item_id FROM my_list WHERE profile_id=?")
          .all(profile)
          .map((r) => r.item_type + ":" + r.item_id),
      ),
      counts = new Map();
    for (const r of catalog) {
      r.trackerId = Number(r.title[name === "mal" ? "malId" : "anilistId"]);
      const key = r.type + ":" + r.trackerId;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return catalog.filter(
      (r) =>
        !(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tracker_season_mappings'").get() && db.prepare('SELECT 1 FROM tracker_season_mappings WHERE profile_id=? AND provider=? AND item_id=?').get(profile,name,r.title.id)) &&
        !r.title.chapters?.some(c=>c.format==='novel') &&
        Number.isSafeInteger(r.trackerId) &&
        r.trackerId > 0 &&
        counts.get(r.type + ":" + r.trackerId) === 1 &&
        (all || saved.has(r.type + ":" + r.title.id)),
    );
  }
  function record(profile, name, title, type, l, r, subject) {
    db.prepare(
      "INSERT INTO tracker_baselines VALUES(?,?,?,?,?) ON CONFLICT(profile_id,provider,item_type,item_id) DO UPDATE SET value=excluded.value",
    ).run(
      profile,
      name,
      type,
      title.id,
      JSON.stringify({
        local: l,
        remote: r,
        subject,
        trackerId: Number(title[name === "mal" ? "malId" : "anilistId"]),
      }),
    );
  }
  async function apply({
    profileId,
    name,
    title,
    type,
    desired,
    direction,
    token,
  }) {
    if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tracker_season_mappings'").get()&&db.prepare('SELECT 1 FROM tracker_season_mappings WHERE profile_id=? AND provider=? AND item_id=?').get(profileId,name,title.id))throw Error('This title now uses season mappings; review it in the season editor');
    if (
      !Number.isInteger(desired.count) ||
      desired.count < 0 ||
      desired.count > 1e6 ||
      !["planned", "in_progress", "completed", "dropped"].includes(
        desired.status,
      )
    )
      throw Error("Invalid tracker progress");

    if (direction === "push") {
      const id = Number(title[name === "mal" ? "malId" : "anilistId"]);
      if (name === "mal") {
        const status =
          desired.status === "planned"
            ? type === "manga"
              ? "plan_to_read"
              : "plan_to_watch"
            : desired.status === "in_progress"
              ? type === "manga"
                ? "reading"
                : "watching"
              : desired.status;
        await json(
          `https://api.myanimelist.net/v2/${type}/${id}/my_list_status`,
          {
            method: "PATCH",
            headers: {
              Authorization: "Bearer " + token.access_token,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              status,
              [type === "manga" ? "num_chapters_read" : "num_watched_episodes"]:
                String(desired.count),
            }).toString(),
          },
        );
      } else
        await graph(
          token.access_token,
          "mutation($id:Int!,$status:MediaListStatus,$progress:Int){SaveMediaListEntry(mediaId:$id,status:$status,progress:$progress){id}}",
          {
            id,
            status: {
              planned: "PLANNING",
              in_progress: "CURRENT",
              completed: "COMPLETED",
              dropped: "DROPPED",
            }[desired.status],
            progress: desired.count,
          },
        );
    } else {
      db.exec("BEGIN IMMEDIATE");
      try {
    if(direction==='pull'&&desired.specialStatus){const old=db.prepare('SELECT value FROM tracker_title_details WHERE profile_id=? AND provider=? AND item_type=? AND item_id=?').get(profileId,name,type,title.id);db.prepare('INSERT INTO tracker_title_details VALUES(?,?,?,?,?) ON CONFLICT(profile_id,provider,item_type,item_id) DO UPDATE SET value=excluded.value').run(profileId,name,type,title.id,JSON.stringify({...JSON.parse(old?.value||'{}'),state:desired.specialStatus}));}
        db.prepare(
          "INSERT INTO my_list(profile_id,item_type,item_id,status) VALUES(?,?,?,?) ON CONFLICT(profile_id,item_type,item_id) DO UPDATE SET status=excluded.status",
        ).run(profileId, type, title.id, desired.status);
        if (type === "anime") {
          db.prepare(
            "DELETE FROM watched_episodes WHERE profile_id=? AND item_id=?",
          ).run(profileId, title.id);
          for (const ep of (title.groups || [])
            .flatMap((g) => g.episodes)
            .slice(0, desired.count))
            db.prepare(
              "INSERT INTO watched_episodes(profile_id,item_id,item_type,episode_rel_path,episode_title,watched_at) VALUES(?,?,?,?,?,?)",
            ).run(
              profileId,
              title.id,
              "anime",
              ep.relPath,
              ep.title || "",
              new Date(now()).toISOString(),
            );
        } else if (desired.count && title.chapters.length) {
          const chapter =
              title.chapters[
                Math.min(desired.count, title.chapters.length) - 1
              ],
            pages = chapter.pageCount || 1;
          db.prepare(
            "INSERT INTO manga_progress VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,manga_id) DO UPDATE SET chapter_name=excluded.chapter_name,page=excluded.page,total_pages=excluded.total_pages,updated_at=excluded.updated_at",
          ).run(
            profileId,
            title.id,
            chapter.name,
            pages,
            pages,
            new Date(now()).toISOString(),
          );
        } else
          db.prepare(
            "DELETE FROM manga_progress WHERE profile_id=? AND manga_id=?",
          ).run(profileId, title.id);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    record(
      profileId,
      name,
      title,
      type,
      local(profileId, title, type),
      desired,
      token.subject,
    );
  }
  async function remoteList(token, name) {
    const results = new Map();
    for (const type of ["anime", "manga"]) {
      if (name === "mal") {
        for (let page = 0; page < 20; page++) {
          const data = await json(
            `https://api.myanimelist.net/v2/users/@me/${type}list?fields=list_status&limit=1000&offset=${page * 1000}`,
            { headers: { Authorization: "Bearer " + token.access_token } },
          );
          for (const r of data.data || []) {
            const s = r.list_status || {};
            results.set(type + ":" + r.node.id, {
              status: remoteStatuses[s.status] || "planned",
              ...((s.is_rewatching||s.is_rereading)?{specialStatus:"repeating"}:s.status==='on_hold'?{specialStatus:"paused"}:{}),
              count:
                s[
                  type === "anime"
                    ? "num_episodes_watched"
                    : "num_chapters_read"
                ] || 0,
            });
          }
          if (!data.paging?.next) break;
          if (page === 19)
            throw Error(
              "Tracker list exceeds the supported 20,000-entry limit",
            );
        }
      } else {
        const data = await graph(
          token.access_token,
          "query($id:Int!,$type:MediaType!){MediaListCollection(userId:$id,type:$type){lists{entries{mediaId status progress}}}}",
          { id: Number(token.subject), type: type.toUpperCase() },
        );
        for (const list of data.data.MediaListCollection?.lists || [])
          for (const r of list.entries || [])
            results.set(type + ":" + r.mediaId, {
              status: remoteStatuses[r.status] || "planned",
              ...(r.status==='REPEATING'?{specialStatus:"repeating"}:r.status==='PAUSED'?{specialStatus:"paused"}:{}),
              count: r.progress || 0,
            });
      }
    }
    return results;
  }
  function output(row) {
    const entries = JSON.parse(row.value);
    return {
      id: row.id,
      direction: row.direction,
      status: row.status,
      createdAt: row.created_at,
      error: row.error,
      entries: entries.map((e) => ({
        title: e.title,
        itemType: e.type,
        beforeLocal: e.beforeLocal,
        beforeRemote: e.beforeRemote,
        status: e.status,
        error: e.error || "",
      })),
    };
  }
  app.get("/api/trackers/:id/:provider/jobs", (req, res) => {
    const owner = own(req, res);
    if (!owner) return;
    res.json({
      automation: db
        .prepare(
          "SELECT enabled,direction,last_at AS lastAt,message FROM tracker_automation WHERE profile_id=? AND provider=?",
        )
        .get(owner.p.id, req.params.provider) || {
        enabled: 0,
        direction: "push",
        lastAt: 0,
        message: "",
      },
      jobs: db
        .prepare(
          "SELECT * FROM tracker_jobs WHERE profile_id=? AND provider=? ORDER BY created_at DESC LIMIT 5",
        )
        .all(owner.p.id, req.params.provider)
        .map(output),
    });
  });
  app.post(
    "/api/trackers/:id/:provider/bulk-preview",
    safe(async (req, res) => {
      const owner = own(req, res);
      if (!owner) return;
      const direction = req.body?.direction;
      if (!["push", "pull"].includes(direction))
        throw Error("Choose a sync direction");
      if (
        db
          .prepare(
            "SELECT 1 FROM tracker_jobs WHERE profile_id=? AND provider=? AND status IN ('preparing','queued','running')",
          )
          .get(owner.p.id, req.params.provider)
      )
        throw Error("A tracker job is already active");
      const id = randomUUID();
      db.prepare(
        "INSERT INTO tracker_jobs VALUES(?,?,?,?,?,'preparing','[]',?,?,'')",
      ).run(
        id,
        owner.a.id,
        owner.p.id,
        req.params.provider,
        direction,
        now(),
        now(),
      );
      try {
        const token = await credential(owner.p.id, req.params.provider),
          list = await remoteList(token, req.params.provider),
          entries = titles(
            owner.p.id,
            req.params.provider,
            direction === "pull",
          )
            .filter(
              (r) =>
                eligible(owner.p, owner.a, r.title) &&
                (direction === "push" || list.has(r.type + ":" + r.trackerId)),
            )
            .map((r) => ({
              id: r.title.id,
              title: r.title.title,
              type: r.type,
              trackerId: r.trackerId,
              subject: token.subject,
              beforeLocal: local(owner.p.id, r.title, r.type),
              beforeRemote: list.get(r.type + ":" + r.trackerId) || {
                status: "planned",
                count: 0,
              },
              status: "pending",
            }));
        if (entries.length > 500)
          throw Error(
            "This batch exceeds 500 matched local titles; use individual sync for additional titles",
          );
        db.prepare(
          "UPDATE tracker_jobs SET status='preview',value=?,updated_at=? WHERE id=?",
        ).run(JSON.stringify(entries), now(), id);
        res.json(
          output(db.prepare("SELECT * FROM tracker_jobs WHERE id=?").get(id)),
        );
      } catch (e) {
        db.prepare(
          "UPDATE tracker_jobs SET status='failed',error=? WHERE id=?",
        ).run(e.message, id);
        throw e;
      }
    }),
  );
  app.post("/api/trackers/:id/:provider/jobs/:job/apply", (req, res) => {
    const owner = own(req, res);
    if (!owner) return;
    const row = db
      .prepare(
        "SELECT * FROM tracker_jobs WHERE id=? AND account_id=? AND profile_id=? AND provider=? AND status='preview'",
      )
      .get(req.params.job, owner.a.id, owner.p.id, req.params.provider);
    if (!row || now() - row.created_at > 300000)
      return res.status(409).json({ error: "Create a fresh bulk preview" });
    db.prepare(
      "UPDATE tracker_jobs SET status='queued',updated_at=? WHERE id=?",
    ).run(now(), row.id);
    res.status(202).json({ ok: true });
  });
  app.post("/api/trackers/:id/:provider/jobs/:job/cancel", (req, res) => {
    const owner = own(req, res);
    if (!owner) return;
    db.prepare(
      "UPDATE tracker_jobs SET status='cancelled' WHERE id=? AND account_id=? AND profile_id=? AND provider=? AND status IN ('preview','queued','running')",
    ).run(req.params.job, owner.a.id, owner.p.id, req.params.provider);
    res.json({ ok: true });
  });
  app.put("/api/trackers/:id/:provider/automation", (req, res) => {
    const owner = own(req, res);
    if (!owner) return;
    if (typeof req.body?.enabled !== "boolean" || !["push","pull"].includes(req.body.direction||"push")) return res.sendStatus(400);
    if (
      req.body.enabled &&
      !db
        .prepare(
          "SELECT 1 FROM tracker_connections WHERE profile_id=? AND provider=?",
        )
        .get(owner.p.id, req.params.provider)
    )
      return res.status(409).json({ error: "Connect this tracker first" });
    db.prepare(
      "INSERT INTO tracker_automation(profile_id,provider,enabled,direction) VALUES(?,?,?,?) ON CONFLICT(profile_id,provider) DO UPDATE SET enabled=excluded.enabled,direction=excluded.direction,last_at=0,cursor=0,message=''",
    ).run(owner.p.id, req.params.provider, req.body.enabled ? 1 : 0,req.body.direction||"push");
    res.json({ ok: true });
  });
  let busy = false;
  async function work() {
    if (busy) return;
    busy = true;
    try {
      const job = db
        .prepare(
          "SELECT * FROM tracker_jobs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1",
        )
        .get();
      if (job) {
        const key = job.profile_id + ":" + job.provider;
        if (locks.has(key)) return;
        locks.add(key);
        try {
          const p = db
              .prepare("SELECT * FROM profiles WHERE id=? AND account_id=?")
              .get(job.profile_id, job.account_id),
            a = db
              .prepare("SELECT * FROM accounts WHERE id=? AND approved=1")
              .get(job.account_id);
          if (!p || !a) throw Error("Account or profile no longer available");
          const token = await credential(p.id, job.provider),
            connection = db
              .prepare(
                "SELECT credentials FROM tracker_connections WHERE profile_id=? AND provider=?",
              )
              .get(p.id, job.provider)?.credentials,
            entries = JSON.parse(job.value);
          db.prepare("UPDATE tracker_jobs SET status='running' WHERE id=?").run(
            job.id,
          );
          for (const entry of entries
            .filter((e) => e.status === "pending")
            .slice(0, 5)) {
            if (
              db
                .prepare("SELECT status FROM tracker_jobs WHERE id=?")
                .get(job.id)?.status === "cancelled"
            )
              break;
            const title =
              entry.type === "manga"
                ? getLibrary().getManga(entry.id)
                : getLibrary().getShow(entry.id);
            try {
              if (
                !eligible(p, a, title) ||
                Number(
                  title[job.provider === "mal" ? "malId" : "anilistId"],
                ) !== entry.trackerId ||
                token.subject !== entry.subject
              )
                throw Error("Title mapping or authorization changed");
              const r = await remote(token, job.provider, title, entry.type);
              if(job.direction==='push'&&r.specialStatus){entry.status='conflict';entry.error='Paused or repeat entries require advanced review';db.prepare('UPDATE tracker_jobs SET value=? WHERE id=?').run(JSON.stringify(entries),job.id);continue;}
              if (
                !equal(local(p.id, title, entry.type), entry.beforeLocal) ||
                !equal(r, entry.beforeRemote)
              ) {
                entry.status = "conflict";
                entry.error = "Progress changed since preview";
              } else {
                const current = db
                  .prepare(
                    "SELECT p.*,a.approved,a.adult_content_allowed FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE p.id=? AND p.account_id=?",
                  )
                  .get(p.id, a.id);
                if (
                  db
                    .prepare("SELECT status FROM tracker_jobs WHERE id=?")
                    .get(job.id)?.status === "cancelled"
                )
                  break;
                if (!equal(local(p.id, title, entry.type), entry.beforeLocal))
                  throw Error("Local progress changed during sync");
                if (
                  !current?.approved ||
                  !eligible(current, current, title) ||
                  db
                    .prepare(
                      "SELECT credentials FROM tracker_connections WHERE profile_id=? AND provider=?",
                    )
                    .get(p.id, job.provider)?.credentials !== connection
                )
                  throw Error("Authorization or restrictions changed");
                await apply({
                  profileId: p.id,
                  name: job.provider,
                  title,
                  type: entry.type,
                  desired: job.direction === "push" ? entry.beforeLocal : r,
                  direction: job.direction,
                  token,
                });
                entry.status = "done";
              }
            } catch (e) {
              entry.status = "failed";
              entry.error = e.message;
            }
            db.prepare(
              "UPDATE tracker_jobs SET value=?,updated_at=? WHERE id=?",
            ).run(JSON.stringify(entries), now(), job.id);
          }
          if (!entries.some((e) => e.status === "pending"))
            db.prepare(
              "UPDATE tracker_jobs SET status=? WHERE id=? AND status!='cancelled'",
            ).run(
              entries.some((e) => e.status !== "done")
                ? "needs-review"
                : "complete",
              job.id,
            );
        } catch (e) {
          db.prepare(
            "UPDATE tracker_jobs SET status='failed',error=? WHERE id=?",
          ).run(e.message, job.id);
        } finally {
          locks.delete(key);
        }
        return;
      }
      const config = db
        .prepare(
          "SELECT t.*,p.account_id FROM tracker_automation t JOIN profiles p ON p.id=t.profile_id JOIN accounts a ON a.id=p.account_id WHERE t.enabled=1 AND a.approved=1 AND t.last_at<? ORDER BY t.last_at LIMIT 1",
        )
        .get(now() - 300000);
      if (!config) return;
      const direction=config.direction||"push";
      const key = config.profile_id + ":" + config.provider;
      if (locks.has(key)) return;
      locks.add(key);
      try {
        const token = await credential(config.profile_id, config.provider),
          connection = db
            .prepare(
              "SELECT credentials FROM tracker_connections WHERE profile_id=? AND provider=?",
            )
            .get(config.profile_id, config.provider)?.credentials,
          p = db
            .prepare("SELECT * FROM profiles WHERE id=?")
            .get(config.profile_id),
          a = db
            .prepare("SELECT * FROM accounts WHERE id=?")
            .get(config.account_id),
          all = titles(p.id, config.provider,direction==='pull').filter((r) =>
            eligible(p, a, r.title),
          ),
          entries = all.slice(config.cursor, config.cursor + 5);
        let sent = 0,
          conflicts = 0;
        for (const entry of entries) {
          if (
            !db
              .prepare(
                "SELECT enabled FROM tracker_automation WHERE profile_id=? AND provider=?",
              )
              .get(p.id, config.provider)?.enabled
          )
            break;
          const l = local(p.id, entry.title, entry.type),
            row = db
              .prepare(
                "SELECT value FROM tracker_baselines WHERE profile_id=? AND provider=? AND item_type=? AND item_id=?",
              )
              .get(p.id, config.provider, entry.type, entry.title.id),
            baseline = row && JSON.parse(row.value);
          if (
            direction==='push' && baseline &&
            baseline.subject === token.subject &&
            baseline.trackerId === entry.trackerId &&
            equal(l, baseline.local)
          )
            continue;
          const r = await remote(
            token,
            config.provider,
            entry.title,
            entry.type,
          );
          if(direction==='pull'&&r.exists===false)continue;
          if(direction==='push'&&r.specialStatus){conflicts++;continue;}
          const known=baseline&&baseline.subject===token.subject&&baseline.trackerId===entry.trackerId;
          if(direction==='pull'&&known&&equal(r,baseline.remote)&&equal(l,baseline.local))continue;
          const canSync=direction==='push'?(known?equal(r,baseline.remote):equal(r,{status:'planned',count:0})||equal(l,r)):(known?equal(l,baseline.local):equal(l,{status:'planned',count:0})||equal(l,r));
          if(canSync){
            if (
              !db
                .prepare(
                  "SELECT enabled FROM tracker_automation WHERE profile_id=? AND provider=?",
                )
                .get(p.id, config.provider)?.enabled ||
              db.prepare("SELECT direction FROM tracker_automation WHERE profile_id=? AND provider=?").get(p.id,config.provider)?.direction!==direction ||
              db
                .prepare(
                  "SELECT credentials FROM tracker_connections WHERE profile_id=? AND provider=?",
                )
                .get(p.id, config.provider)?.credentials !== connection
            )
              break;
            const current = db
              .prepare(
                "SELECT p.*,a.approved,a.adult_content_allowed FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE p.id=?",
              )
              .get(p.id);
            if (
              !current?.approved ||
              !eligible(current, current, entry.title) ||
              !equal(local(p.id, entry.title, entry.type), l)
            )
              break;
            await apply({
              profileId: p.id,
              name: config.provider,
              title: entry.title,
              type: entry.type,
              desired: direction==='push'?l:r,
              direction,
              token,
            });
            sent++;
          } else conflicts++;
        }
        db.prepare(
          "UPDATE tracker_automation SET last_at=?,cursor=?,message=? WHERE profile_id=? AND provider=? AND direction=? AND enabled=1",
        ).run(
          config.cursor + 5 >= all.length ? now() : now() - 300001,
          config.cursor + 5 >= all.length ? 0 : config.cursor + 5,
          `${sent} updated; ${conflicts} conflicts require manual review`,
          p.id,
          config.provider,
          direction,
        );
      } catch (e) {
        db.prepare(
          "UPDATE tracker_automation SET last_at=?,message=? WHERE profile_id=? AND provider=?",
        ).run(now(), e.message, config.profile_id, config.provider);
      } finally {
        locks.delete(key);
      }
    } finally {
      busy = false;
    }
  }
  const timer = startWorker
    ? setInterval(() => work().catch(() => {}), 30000)
    : null;
  timer?.unref();
  return { apply, record, work, stop: () => clearInterval(timer) };
}
module.exports = { registerTrackerJobs };
