const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express"),
  { DatabaseSync } = require("node:sqlite");
const { registerPublicProfiles } = require("../server/public-profiles");
async function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `PRAGMA foreign_keys=ON;CREATE TABLE accounts(id TEXT PRIMARY KEY,approved INTEGER);INSERT INTO accounts VALUES('a',1),('b',1);CREATE TABLE profiles(id TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),name TEXT,avatar TEXT,is_kids INTEGER,watched_seconds INTEGER);INSERT INTO profiles VALUES('p','a','Alice','/img/avatars/avatar1.svg',0,7200),('q','b','Bob','bad',0,0),('kid','a','Child','bad',1,0);CREATE TABLE my_list(profile_id TEXT,item_type TEXT,item_id TEXT,status TEXT);INSERT INTO my_list VALUES('p','anime','s','completed'),('p','anime','adult','completed');CREATE TABLE top_picks(profile_id TEXT,item_type TEXT,item_id TEXT);CREATE TABLE reviews(profile_id TEXT,item_type TEXT,item_id TEXT,rating INTEGER,text TEXT,created_at TEXT);`,
  );
  const app = express();
  app.use(express.json());
  registerPublicProfiles(app, {
    db,
    requireAuth: (req, res) => {
      const id = req.headers["x-user"];
      if (!["a", "b"].includes(id)) {
        res.sendStatus(401);
        return null;
      }
      return { id };
    },
    getLibrary: () => ({
      getShow: (id) => ({
        id,
        title: id,
        rating: id === "adult" ? "Rx" : "PG",
      }),
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
    request: (user, path, method = "GET", body, origin) =>
      fetch("http://127.0.0.1:" + server.address().port + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-user": user,
          ...(origin ? { Origin: origin } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
  };
}
const config = {
  slug: "alice",
  visibility: "private",
  discoverable: false,
  bio: "Hello",
  privacy: {
    list: false,
    favorites: false,
    reviews: false,
    statistics: false,
    social: false,
  },
  characters: ["A character"],
  links: [{ label: "Website", url: "https://example.com" }],
};
test("public profiles are opt-in, allowlisted, private by section, and exclude mature titles", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("b", "/api/people/settings/p")).status, 403);
  await f.request("a", "/api/people/settings/p", "PUT", config);
  assert.equal((await f.request("b", "/api/people/u/alice")).status, 404);
  assert.equal(
    (await (await f.request("b", "/api/people")).json()).items.length,
    0,
  );
  await f.request("a", "/api/people/settings/p", "PUT", {
    ...config,
    visibility: "unlisted",
    discoverable: true,
  });
  assert.equal(
    (await (await f.request("b", "/api/people")).json()).items.length,
    0,
  );
  let p = await (await f.request("b", "/api/people/u/alice")).json();
  for (const key of [
    "account_id",
    "profile_id",
    "list",
    "links",
    "characters",
    "statistics",
    "reviews",
    "watched_seconds",
  ])
    assert.equal(p[key], undefined);
  await f.request("a", "/api/people/settings/p", "PUT", {
    ...config,
    visibility: "public",
    discoverable: true,
    privacy: { ...config.privacy, list: true, statistics: true },
  });
  assert.equal(
    (await (await f.request("b", "/api/people?q=ali")).json()).items.length,
    1,
  );
  p = await (await f.request("b", "/api/people/u/alice")).json();
  assert.deepEqual(
    p.list.map((i) => i.id),
    ["s"],
  );
  assert.equal(p.statistics.completedTitles, 1);
  await f.request("a", "/api/people/settings/p", "PUT", config);
  assert.equal((await f.request("b", "/api/people/u/alice")).status, 404);
});
test("public usernames, links, child restrictions and origin validation cannot bypass privacy", async (t) => {
  const f = await fixture(t);
  await f.request("a", "/api/people/settings/p", "PUT", config);
  assert.equal(
    (
      await f.request("b", "/api/people/settings/q", "PUT", {
        ...config,
        slug: "ALICE",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request("a", "/api/people/settings/kid", "PUT", {
        ...config,
        slug: "child",
        visibility: "public",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("a", "/api/people/settings/p", "PUT", {
        ...config,
        links: [{ label: "Bad", url: "javascript:alert(1)" }],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(
        "a",
        "/api/people/settings/p",
        "PUT",
        config,
        "https://bad.example",
      )
    ).status,
    403,
  );
});
