const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express"),
  { DatabaseSync } = require("node:sqlite");
test("native TV pairing binds the polling secret and owned PIN-protected profile; playback tokens are limited to approved streams and revoke immediately", async (t) => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `PRAGMA foreign_keys=ON;CREATE TABLE accounts(id TEXT PRIMARY KEY,approved INTEGER,adult_content_allowed INTEGER);INSERT INTO accounts VALUES('a',1,1),('b',1,1);CREATE TABLE profiles(id TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),name TEXT,is_kids INTEGER);INSERT INTO profiles VALUES('p','a','Alice',0),('q','b','Bob',0);CREATE TABLE progress(profile_id TEXT,item_id TEXT,episode_rel_path TEXT,seconds REAL,duration REAL,updated_at TEXT,hidden INTEGER,PRIMARY KEY(profile_id,item_id));`,
  );
  const app = express();
  app.use(express.json());
  let clock = Date.now(),
    rating = "PG";
  const show = {
      id: "s",
      title: "Story",
      groups: [
        { name: "Season", episodes: [{ relPath: "one", title: "One" }] },
      ],
    },
    lib = {
      cache: { anime: [show], movies: [] },
      getShow: (id) => (id === "s" ? { ...show, rating } : null),
    };
  const tv = require("../server/tv-native").registerNativeTV(app, {
    db,
    requireAuth: (req, res) => {
      const id = req.headers["x-user"];
      if (!["a", "b"].includes(id)) {
        res.sendStatus(401);
        return null;
      }
      return { id };
    },
    profiles: { verifyPin: (_a, _p, pin) => pin === "1234" },
    getLibrary: () => lib,
    startHls: async () => ({ cacheKey: "stream123" }),
    now: () => clock,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  const base = "http://127.0.0.1:" + server.address().port + "/api/tv-native";
  const request = (path, body, user, token, method = "POST") =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(user ? { "x-user": user } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const pairing = await (
    await request("/pair/start", { name: "Test TV" })
  ).json();
  assert.equal(
    (
      await request(
        "/pair/" + pairing.code + "/approve",
        { profileId: "q", pin: "1234" },
        "a",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/pair/" + pairing.code + "/approve",
        { profileId: "p", pin: "bad" },
        "a",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/pair/" + pairing.code + "/approve",
        { profileId: "p", pin: "1234" },
        "a",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/pair/poll", {
        code: pairing.code,
        pollSecret: "stolen-code",
      })
    ).status,
    404,
  );
  const grant = await (
    await request("/pair/poll", {
      code: pairing.code,
      pollSecret: pairing.pollSecret,
    })
  ).json();
  assert.equal(grant.status, "approved");
  assert.equal(
    (
      await request("/pair/poll", {
        code: pairing.code,
        pollSecret: pairing.pollSecret,
      })
    ).status,
    404,
  );
  assert.equal(
    (await request("/catalog", null, null, grant.token, "GET")).status,
    200,
  );
  assert.equal(
    (await request("/devices", null, null, grant.token, "GET")).status,
    401,
  );
  assert.equal(
    (await request("/play", { id: "s", episode: "other" }, null, grant.token))
      .status,
    404,
  );
  const playback = await request(
    "/play",
    { id: "s", episode: "one" },
    null,
    grant.token,
  );
  assert.equal(playback.status, 200);
  const streamCookie = (await playback.json()).streamCookie;
  const media = {
    path: "/api/hls/stream123/playlist.m3u8",
    headers: { authorization: "Bearer " + grant.token },
  };
  assert.equal(tv.mediaAccount(media).id, "a");
  const cookieMedia = {
    ...media,
    headers: { cookie: "io_tv_stream=" + streamCookie },
  };
  assert.equal(tv.mediaAccount(cookieMedia).id, "a");
  assert.equal(
    tv.mediaAccount({ ...cookieMedia, path: "/api/hls/foreign/one.ts" }),
    null,
  );
  clock += 6 * 3600000 + 1;
  assert.equal(tv.mediaAccount(cookieMedia), null);
  clock -= 6 * 3600000 + 1;
  assert.equal(
    tv.mediaAccount({ ...media, path: "/api/admin/settings" }),
    null,
  );
  assert.equal(
    tv.mediaAccount({ ...media, path: "/api/hls/foreign/playlist.m3u8" }),
    null,
  );
  db.prepare("UPDATE profiles SET is_kids=1 WHERE id=?").run("p");
  rating = "Rx";
  assert.equal(tv.mediaAccount(media), null);
  assert.equal(tv.mediaAccount(cookieMedia), null);
  assert.equal(
    (await request("/title/s", null, null, grant.token, "GET")).status,
    404,
  );
  await request("/devices/" + grant.deviceId, null, "b", null, "DELETE");
  assert.equal(
    (await request("/catalog", null, null, grant.token, "GET")).status,
    200,
  );
  await request("/devices/" + grant.deviceId, null, "a", null, "DELETE");
  assert.equal(
    (await request("/catalog", null, null, grant.token, "GET")).status,
    401,
  );
  assert.equal(tv.mediaAccount(media), null);
});
