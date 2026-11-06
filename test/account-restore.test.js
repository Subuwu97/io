const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express"),
  { DatabaseSync } = require("node:sqlite");
const { registerAccountData } = require("../server/account-data");
const {
  buildRestorePlan,
  applyRestorePlan,
} = require("../server/account-restore");
test("novel restore preserves section progress and appearance while rejecting stale sections", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE novel_progress(profile_id TEXT,item_id TEXT,chapter TEXT,section INTEGER,fraction REAL,updated_at TEXT,PRIMARY KEY(profile_id,item_id,chapter));CREATE TABLE novel_preferences(profile_id TEXT PRIMARY KEY,size INTEGER,spacing REAL,width INTEGER,theme TEXT);`,
  );
  const data = {
    formatVersion: 1,
    profiles: [{ id: "old", name: "Reader" }],
    novel_progress: [
      {
        profile_id: "old",
        item_id: "n",
        chapter: "Book",
        section: 1,
        fraction: 0.4,
      },
      {
        profile_id: "old",
        item_id: "n",
        chapter: "Book",
        section: 8,
        fraction: 0.5,
      },
    ],
    novel_preferences: [
      { profile_id: "old", size: 24, spacing: 1.8, width: 760, theme: "sepia" },
    ],
  };
  const plan = buildRestorePlan(
    data,
    "old",
    { id: "p" },
    {},
    {
      getManga: (id) =>
        id === "n"
          ? {
              rating: "PG",
              chapters: [{ name: "Book", format: "novel", pageCount: 3 }],
            }
          : null,
      getShow: () => null,
    },
    "merge",
  );
  assert.equal(plan.novels.length, 1);
  assert.equal(plan.skipped, 1);
  applyRestorePlan(db, plan);
  assert.equal(
    db.prepare("SELECT fraction FROM novel_progress").get().fraction,
    0.4,
  );
  assert.equal(
    db.prepare("SELECT theme FROM novel_preferences").get().theme,
    "sepia",
  );
  db.close();
});
async function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `PRAGMA foreign_keys=ON;CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('a'),('b');CREATE TABLE profiles(id TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),name TEXT,handle TEXT,avatar TEXT,banner TEXT,status TEXT,is_kids INTEGER,created_at TEXT,watched_seconds INTEGER);INSERT INTO profiles VALUES('p','a','Alice','','','','',0,'now',0),('q','b','Bob','','','','',0,'now',0);CREATE TABLE my_list(profile_id TEXT,item_type TEXT,item_id TEXT,status TEXT,PRIMARY KEY(profile_id,item_type,item_id));INSERT INTO my_list VALUES('p','anime','s','completed');CREATE TABLE top_picks(profile_id TEXT,item_type TEXT,item_id TEXT,PRIMARY KEY(profile_id,item_type,item_id));CREATE TABLE progress(profile_id TEXT,item_id TEXT,episode_rel_path TEXT,seconds REAL,duration REAL,updated_at TEXT,hidden INTEGER,PRIMARY KEY(profile_id,item_id));CREATE TABLE manga_progress(profile_id TEXT,manga_id TEXT,chapter_name TEXT,page INTEGER,total_pages INTEGER,updated_at TEXT,PRIMARY KEY(profile_id,manga_id));CREATE TABLE watched_episodes(profile_id TEXT,item_id TEXT,item_type TEXT,episode_rel_path TEXT,episode_title TEXT,watched_at TEXT,PRIMARY KEY(profile_id,item_id,episode_rel_path));CREATE TABLE account_email(account_id TEXT,email TEXT,verified_at TEXT);INSERT INTO account_email VALUES('a','alice@io.invalid','now');`,
  );
  let sent = [];
  const app = express();
  app.use(express.json());
  registerAccountData(app, {
    db,
    requireAuth: (req, res) => {
      const id = req.headers["x-user"];
      return { id, username: id };
    },
    accounts: {
      verifyPassword: async (b) =>
        b.password === "correct" ? { id: b.username } : null,
    },
    services: {
      status: () => ({ email: true }),
      send: async (...args) => sent.push(args),
    },
    getLibrary: () => ({
      getShow: (id) =>
        id === "s"
          ? { id, rating: "PG", groups: [{ episodes: [{ relPath: "01" }] }] }
          : null,
      getManga: () => null,
    }),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  return {
    db,
    sent,
    request: (user, path, body) =>
      fetch("http://127.0.0.1:" + server.address().port + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user": user },
        body: JSON.stringify(body),
      }),
  };
}
const archive = {
  formatVersion: 1,
  account: { username: "Old account" },
  profiles: [{ id: "old", name: "Old profile" }],
  my_list: [
    { profile_id: "old", item_id: "s", item_type: "anime", status: "planned" },
    {
      profile_id: "old",
      item_id: "missing",
      item_type: "anime",
      status: "planned",
    },
  ],
  progress: [
    {
      profile_id: "old",
      item_id: "s",
      episode_rel_path: "01",
      seconds: 20,
      duration: 100,
    },
  ],
  top_picks: [{ profile_id: "old", item_id: "s", item_type: "anime" }],
};
test("restore previews are scoped, consumed once and merge or replace only the selected profile’s validated data", async (t) => {
  const f = await fixture(t),
    base = "/api/account-data/restore/",
    body = {
      password: "correct",
      data: archive,
      sourceId: "old",
      targetId: "p",
      mode: "merge",
    };
  assert.equal((await f.request("b", base + "preview", body)).status, 403);
  assert.equal(
    (await f.request("a", base + "preview", { ...body, password: "wrong" }))
      .status,
    400,
  );
  let plan = await (await f.request("a", base + "preview", body)).json();
  assert.equal(plan.skipped, 1);
  assert.equal(plan.counts.lists, 1);
  assert.equal(
    (
      await f.request("b", base + "apply", {
        password: "correct",
        planId: plan.id,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("a", base + "apply", {
        password: "correct",
        planId: plan.id,
      })
    ).status,
    200,
  );
  assert.equal(
    f.db.prepare("SELECT status FROM my_list").get().status,
    "completed",
  );
  assert.equal(f.db.prepare("SELECT seconds FROM progress").get().seconds, 20);
  assert.equal(
    (
      await f.request("a", base + "apply", {
        password: "correct",
        planId: plan.id,
      })
    ).status,
    400,
  );
  plan = await (
    await f.request("a", base + "preview", {
      ...body,
      mode: "replace-conflicts",
    })
  ).json();
  await f.request("a", base + "apply", {
    password: "correct",
    planId: plan.id,
  });
  assert.equal(
    f.db.prepare("SELECT status FROM my_list").get().status,
    "planned",
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM my_list WHERE profile_id='q'").get().n,
    0,
  );
});
test("email exports require proof and a verified recipient; caller-supplied addresses are ignored and repeated requests are limited", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request("a", "/api/account-data/email", { password: "wrong" }))
      .status,
    400,
  );
  assert.equal(
    (await f.request("b", "/api/account-data/email", { password: "correct" }))
      .status,
    503,
  );
  assert.equal(
    (
      await f.request("a", "/api/account-data/email", {
        password: "correct",
        to: "not-allowed@io.invalid",
      })
    ).status,
    200,
  );
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0][0], "alice@io.invalid");
  assert.equal(f.sent[0][3][0].filename, "I-O-account.zip");
  assert.equal(f.sent[0][3][0].content[0], 0x50);
  assert.equal(
    (await f.request("a", "/api/account-data/email", { password: "correct" }))
      .status,
    429,
  );
});
test("browser ZIP reader accepts the personal export and rejects archives without the account JSON", async () => {
  const vm = require("node:vm"),
    fs = require("node:fs"),
    fflate = require("fflate"),
    source = fs
      .readFileSync(require.resolve("../public/js/io-restore.js"), "utf8")
      .split("(function")[0],
    ctx = { fflate, TextDecoder, Uint8Array, JSON, Promise };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const zip = fflate.zipSync({
      "I-O-account.json": fflate.strToU8(JSON.stringify(archive)),
    }),
    file = {
      name: "I-O-account.zip",
      size: zip.length,
      arrayBuffer: async () => zip.buffer,
    };
  assert.equal((await ctx.ioReadAccountExport(file)).profiles[0].id, "old");
  const bad = fflate.zipSync({ "other.json": fflate.strToU8("{}") });
  await assert.rejects(() =>
    ctx.ioReadAccountExport({
      ...file,
      size: bad.length,
      arrayBuffer: async () => bad.buffer,
    }),
  );
});
