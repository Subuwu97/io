const QUERY = `query($page:Int!,$from:Int!,$until:Int!){Page(page:$page,perPage:50){pageInfo{hasNextPage} airingSchedules(airingAt_greater:$from,airingAt_lesser:$until,sort:TIME){airingAt episode media{id title{english romaji} format isAdult}}}}`;
function registerUpcomingSync(
  app,
  { db, requireAuth, now = Date.now, fetcher = fetch, startWorker = true },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS upcoming_sync(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,last_at INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '');INSERT OR IGNORE INTO upcoming_sync(id) VALUES(1);CREATE TABLE IF NOT EXISTS upcoming_external(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,kind TEXT NOT NULL,release_at TEXT NOT NULL,rating TEXT NOT NULL);`,
  );
  let busy = false;
  const status = () => ({
    ...db
      .prepare(
        "SELECT enabled,last_at AS lastAt,error FROM upcoming_sync WHERE id=1",
      )
      .get(),
    busy,
  });
  async function refresh() {
    if (busy) throw Error("A release update is already running");
    busy = true;
    try {
      const items = new Map(),
        from = Math.floor(now() / 1000),
        until = from + 14 * 86400;
      for (let page = 1; page <= 4; page++) {
        const response = await fetcher("https://graphql.anilist.co", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query: QUERY,
            variables: { page, from, until },
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok)
          throw Error("Release provider returned " + response.status);
        const body = await response.text();
        if (body.length > 2 * 1024 * 1024)
          throw Error("Release response is too large");
        const data = JSON.parse(body);
        if (data.errors || !data.data?.Page)
          throw Error("Release provider returned an invalid schedule");
        for (const r of data.data.Page.airingSchedules || []) {
          const m = r.media,
            title = m?.title?.english || m?.title?.romaji;
          if (
            !m ||
            m.isAdult !== false ||
            !Number.isSafeInteger(m.id) ||
            typeof title !== "string" ||
            !Number.isFinite(r.airingAt) ||
            r.airingAt < from ||
            r.airingAt > until
          )
            continue;
          const id = "anilist:" + m.id;
          if (!items.has(id))
            items.set(id, {
              id,
              title: title.slice(0, 200),
              description:
                "Episode " +
                r.episode +
                " · Airing schedule from AniList; local availability may differ.",
              kind: m.format === "MOVIE" ? "movie" : "series",
              release_at: new Date(r.airingAt * 1000).toISOString(),
              rating: "Unrated",
            });
        }
        if (!data.data.Page.pageInfo?.hasNextPage) break;
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM upcoming_external").run();
        for (const r of items.values())
          db.prepare("INSERT INTO upcoming_external VALUES(?,?,?,?,?,?)").run(
            r.id,
            r.title,
            r.description,
            r.kind,
            r.release_at,
            r.rating,
          );
        db.prepare(
          "UPDATE upcoming_sync SET last_at=?,error='' WHERE id=1",
        ).run(now());
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return items.size;
    } catch (e) {
      db.prepare("UPDATE upcoming_sync SET last_at=?,error=? WHERE id=1").run(
        now(),
        String(e.message).slice(0, 300),
      );
      throw e;
    } finally {
      busy = false;
    }
  }
  function admin(req, res) {
    const a = requireAuth(req, res);
    if (!a) return false;
    if (a.role !== "admin") {
      res.sendStatus(403);
      return false;
    }
    return true;
  }
  app.get("/api/discovery-plus/upcoming-sync", (req, res) => {
    if (admin(req, res)) res.json(status());
  });
  app.put("/api/discovery-plus/upcoming-sync", (req, res) => {
    if (!admin(req, res)) return;
    if (typeof req.body?.enabled !== "boolean") return res.sendStatus(400);
    db.prepare("UPDATE upcoming_sync SET enabled=? WHERE id=1").run(
      req.body.enabled ? 1 : 0,
    );
    res.json(status());
  });
  app.post("/api/discovery-plus/upcoming-sync/refresh", async (req, res) => {
    if (!admin(req, res)) return;
    if (now() - status().lastAt < 60000)
      return res
        .status(429)
        .json({ error: "Please wait a minute before refreshing again" });
    try {
      res.json({ count: await refresh(), ...status() });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });
  const timer = startWorker
    ? setInterval(() => {
        const s = status();
        if (s.enabled && !busy && now() - s.lastAt > 3600000)
          refresh().catch(() => {});
      }, 60000)
    : null;
  timer?.unref();
  return {
    refresh,
    status,
    stop: () => clearInterval(timer),
    items: () =>
      db
        .prepare(
          "SELECT * FROM upcoming_external WHERE release_at>=? ORDER BY release_at,id",
        )
        .all(new Date(now()).toISOString()),
  };
}
module.exports = { registerUpcomingSync, QUERY };
