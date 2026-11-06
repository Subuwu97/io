const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express"),
  { DatabaseSync } = require("node:sqlite");
const { registerTrackerJobs } = require("../server/tracker-jobs");
async function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE accounts(id TEXT PRIMARY KEY,approved INTEGER,adult_content_allowed INTEGER);INSERT INTO accounts VALUES('a',1,1),('b',1,1);CREATE TABLE profiles(id TEXT PRIMARY KEY,account_id TEXT,is_kids INTEGER);INSERT INTO profiles VALUES('p','a',0),('q','b',0);CREATE TABLE my_list(profile_id TEXT,item_type TEXT,item_id TEXT,status TEXT);INSERT INTO my_list VALUES('p','anime','s','in_progress');CREATE TABLE tracker_connections(profile_id TEXT,provider TEXT,credentials TEXT);INSERT INTO tracker_connections VALUES('p','mal','sealed');`,
  );
  let clock = 1000000,
    l = { status: "in_progress", count: 1 },
    r = { status: "planned", count: 0 },
    writes = 0;
  const title = {
      id: "s",
      title: "Story",
      rating: "PG",
      malId: 10,
      groups: [{ episodes: [{ relPath: "one" }] }],
    },
    lib = {
      cache: { anime: [title], movies: [], manga: [] },
      getShow: (id) => (id === "s" ? title : null),
      getManga: () => null,
    };
  const app = express();
  app.use(express.json());
  const jobs = registerTrackerJobs(app, {
    db,
    requireAuth: (req) => ({ id: req.headers["x-user"] }),
    getLibrary: () => lib,
    credential: async () => ({ subject: "123", access_token: "test" }),
    local: () => ({ ...l }),
    remote: async () => ({ ...r }),
    json: async (url, options) => {
      if (options.method === "PATCH") {
        writes++;
        const data = new URLSearchParams(options.body);
        r = {
          status:
            data.get("status") === "watching"
              ? "in_progress"
              : data.get("status"),
          count: Number(data.get("num_watched_episodes")),
        };
        return {};
      }
      return {
        data: url.includes("animelist?")
          ? [
              {
                node: { id: 10 },
                list_status: {
                  status: r.status === "in_progress" ? "watching" : r.status,
                  num_episodes_watched: r.count,
                },
              },
            ]
          : [],
      };
    },
    graph: async () => {},
    locks: new Set(),
    now: () => clock,
    startWorker: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    jobs.stop();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  return {
    db,
    jobs,
    title,
    setLocal: (v) => (l = v),
    setRemote: (v) => (r = v),
    advance: () => (clock += 300001),
    writes: () => writes,
    request: async (path, body, user = "a", method = "POST") =>
      fetch(
        "http://127.0.0.1:" +
          server.address().port +
          "/api/trackers/p/mal/" +
          path,
        {
          method,
          headers: { "Content-Type": "application/json", "x-user": user },
          body: JSON.stringify(body),
        },
      ),
  };
}
test("bulk sync requires ownership and a current preview, and detects progress changed after approval", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request("bulk-preview", { direction: "push" }, "b")).status,
    403,
  );
  let plan = await (
    await f.request("bulk-preview", { direction: "push" })
  ).json();
  assert.equal(plan.entries.length, 1);
  assert.equal(
    (await f.request("jobs/" + plan.id + "/apply", {}, "b")).status,
    403,
  );
  await f.request("jobs/" + plan.id + "/apply", {});
  f.setRemote({ status: "completed", count: 9 });
  await f.jobs.work();
  assert.equal(f.writes(), 0);
  assert.equal(
    f.db.prepare("SELECT status FROM tracker_jobs WHERE id=?").get(plan.id)
      .status,
    "needs-review",
  );
  plan = await (await f.request("bulk-preview", { direction: "push" })).json();
  f.advance();
  assert.equal((await f.request("jobs/" + plan.id + "/apply", {})).status, 409);
});
test("automatic sync is opt-in, retains a baseline and leaves conflicting remote edits untouched", async (t) => {
  const f = await fixture(t);
  await f.jobs.work();
  assert.equal(f.writes(), 0);
  await f.request("automation", { enabled: true }, "a", "PUT");
  await f.jobs.work();
  assert.equal(f.writes(), 1);
  f.advance();
  await f.jobs.work();
  assert.equal(f.writes(), 1);
  f.setLocal({ status: "completed", count: 2 });
  f.setRemote({ status: "completed", count: 8 });
  f.advance();
  await f.jobs.work();
  assert.equal(f.writes(), 1);
  assert.match(
    f.db.prepare("SELECT message FROM tracker_automation").get().message,
    /1 conflicts/,
  );
  await f.request("automation", { enabled: false }, "a", "PUT");
  f.advance();
  await f.jobs.work();
  assert.equal(f.writes(), 1);
});
test("a changed catalog mapping prevents a queued batch from writing to the wrong tracker entry", async (t) => {
  const f = await fixture(t),
    plan = await (
      await f.request("bulk-preview", { direction: "push" })
    ).json();
  await f.request("jobs/" + plan.id + "/apply", {});
  f.title.malId = 99;
  await f.jobs.work();
  assert.equal(f.writes(), 0);
  assert.match(
    f.db.prepare("SELECT value FROM tracker_jobs").get().value,
    /mapping or authorization changed/,
  );
});
