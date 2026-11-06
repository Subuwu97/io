const test = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express"),
  { DatabaseSync } = require("node:sqlite");
test("reviewed season sync preserves other seasons and rejects changed mappings, progress and replay", async (t) => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('a'),('b');CREATE TABLE profiles(id TEXT PRIMARY KEY,account_id TEXT,is_kids INTEGER);INSERT INTO profiles VALUES('p','a',0),('q','b',0);CREATE TABLE tracker_connections(profile_id TEXT,provider TEXT,credentials TEXT);INSERT INTO tracker_connections VALUES('p','mal','sealed');CREATE TABLE watched_episodes(profile_id TEXT,item_id TEXT,item_type TEXT,episode_rel_path TEXT,episode_title TEXT,watched_at TEXT);INSERT INTO watched_episodes VALUES('p','show','anime','s2/one','','');",
  );
  const title = {
    id: "show",
    title: "Story",
    groups: [
      {
        name: "Season 1",
        episodes: [{ relPath: "s1/one" }, { relPath: "s1/two" }],
      },
      { name: "Season 2", episodes: [{ relPath: "s2/one" }] },
    ],
  };
  let remote = { exists: true, status: "in_progress", count: 1 },
    writes = [];
  const app = express();
  app.use(express.json());
  require("../server/tracker-seasons").registerTrackerSeasons(app, {
    db,
    requireAuth: () => ({ id: "a" }),
    getLibrary: () => ({ getShow: (id) => (id === "show" ? title : null) }),
    credential: async () => ({ subject: "user", access_token: "test" }),
    remote: async () => ({ ...remote }),
    json: async (u, o) => writes.push([u, o.body]),
    graph: async () => {},
    locks: new Set(),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  const base =
    "http://127.0.0.1:" + server.address().port + "/api/trackers/p/mal/seasons";
  const call = (suffix, body, method = "POST") =>
      fetch(base + suffix, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    mapping = { itemId: "show", group: "Season 1", trackerId: 12 };
  assert.equal((await call("", mapping, "PUT")).status, 200);
  let preview = await (
    await call("/preview", { ...mapping, direction: "pull" })
  ).json();
  assert.ok(preview.id);
  assert.equal((await call("/apply", { planId: preview.id })).status, 200);
  assert.deepEqual(
    db
      .prepare(
        "SELECT episode_rel_path FROM watched_episodes ORDER BY episode_rel_path",
      )
      .all()
      .map((r) => r.episode_rel_path),
    ["s1/one", "s2/one"],
  );
  assert.equal((await call("/apply", { planId: preview.id })).status, 400);
  preview = await (
    await call("/preview", { ...mapping, direction: "push" })
  ).json();
  remote.count = 2;
  assert.equal((await call("/apply", { planId: preview.id })).status, 400);
  assert.equal(writes.length, 0);
  remote.count = 1;
  preview = await (
    await call("/preview", { ...mapping, direction: "push" })
  ).json();
  assert.equal((await call("/apply", { planId: preview.id })).status, 200);
  assert.equal(writes[0][1], "num_watched_episodes=1");
  preview=await(await call('/preview',{...mapping,direction:'push'})).json();
  assert.equal((await call('',{...mapping,trackerId:13},'PUT')).status,200);
  assert.equal((await call('/apply',{planId:preview.id})).status,400);
  assert.equal((await call('',mapping,'DELETE')).status,200);
  assert.equal(db.prepare('SELECT count(*) AS n FROM tracker_season_mappings').get().n,0);
  assert.equal((await call('',mapping,'PUT')).status,200);
  remote.specialStatus = "paused";
  assert.equal(
    (await call("/preview", { ...mapping, direction: "push" })).status,
    400,
  );
});
