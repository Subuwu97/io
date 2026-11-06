const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express"),
  { DatabaseSync } = require("node:sqlite"),
  { unzipSync, strFromU8 } = require("fflate");
async function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `PRAGMA foreign_keys=ON;CREATE TABLE accounts(id TEXT PRIMARY KEY,username TEXT,role TEXT,approved INTEGER,adult_content_allowed INTEGER);INSERT INTO accounts VALUES('a','Alice','admin',1,1),('b','Bob','user',1,1);CREATE TABLE profiles(id TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,name TEXT,handle TEXT,avatar TEXT,banner TEXT,status TEXT,is_kids INTEGER,created_at TEXT,watched_seconds INTEGER,pin TEXT);INSERT INTO profiles VALUES('p','a','Alice','alice','','','',0,'today',3600,'1234'),('q','b','Bob','bob','','','',0,'today',0,'secret'),('kid','a','Child','child','','','',1,'today',0,'');CREATE TABLE my_list(profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,item_type TEXT,item_id TEXT,status TEXT,PRIMARY KEY(profile_id,item_type,item_id));INSERT INTO my_list VALUES('p','anime','s','in_progress');CREATE TABLE top_picks(profile_id TEXT,item_id TEXT);CREATE TABLE progress(profile_id TEXT,item_id TEXT);CREATE TABLE manga_progress(profile_id TEXT,manga_id TEXT,chapter_name TEXT,page INTEGER,total_pages INTEGER,updated_at TEXT,PRIMARY KEY(profile_id,manga_id));CREATE TABLE watched_episodes(profile_id TEXT,item_id TEXT,item_type TEXT,episode_rel_path TEXT,episode_title TEXT,watched_at TEXT,PRIMARY KEY(profile_id,item_id,episode_rel_path));CREATE TABLE account_email(account_id TEXT,email TEXT);INSERT INTO account_email VALUES('a','alice@io.invalid');`,
  );
  const app = express();
  app.use(express.json());
  let clock = Date.now();
  const requireAuth = (req, res) => {
    const a = db
      .prepare("SELECT * FROM accounts WHERE id=?")
      .get(req.headers["x-user"]);
    if (!a) {
      res.sendStatus(401);
      return null;
    }
    return {
      ...a,
      approved: !!a.approved,
      adultContentAllowed: !!a.adult_content_allowed,
    };
  };
  const accounts = {
    verifyPassword: async ({ username, password }) =>
      password === "correct"
        ? db.prepare("SELECT * FROM accounts WHERE username=?").get(username)
        : null,
    deleteAccount: (id) => {
      if (id === "a") throw Error("Cannot delete the last admin account");
      db.prepare("DELETE FROM accounts WHERE id=?").run(id);
    },
  };
  const show = {
      id: "s",
      title: "Show",
      rating: "PG",
      malId: 10,
      anilistId: 20,
      groups: [
        {
          name: "Season 1",
          episodes: [
            { relPath: "01.mp4", title: "One" },
            { relPath: "02.mp4", title: "Two" },
          ],
        },
      ],
    },
    book = {
      id: "m",
      title: "Book",
      rating: "PG",
      malId: 11,
      anilistId: 21,
      chapters: [
        { name: "Chapter 1", pageCount: 5 },
        { name: "Chapter 2", pageCount: 4 },
      ],
    };
  const library = {
    cache: { anime: [show], movies: [] },
    getShow: (id) =>
      id === "s" ? show : id === "adult" ? { ...show, id, rating: "Rx" } : null,
    getManga: (id) => (id === "m" ? book : null),
  };
  let privateConfig = {
    malClientId: "client",
    anilistClientId: "ani",
    anilistSecret: "secret",
  };
  const secrets = {
      get: () => ({ ...privateConfig }),
      save: (v) => (privateConfig = v),
      seal: (v) =>
        "encrypted:" + Buffer.from(JSON.stringify(v)).toString("base64"),
      open: (v) => JSON.parse(Buffer.from(v.slice(10), "base64").toString()),
    },
    services = {
      get: () => ({
        publicUrl: "http://localhost",
        discordClientId: "123456789",
      }),
      status: () => ({ email: true }),
      send: async () => {},
    };
  const options = {
    db,
    requireAuth,
    accounts,
    services,
    secrets,
    getLibrary: () => library,
    now: () => clock,
    publicOrigin: () => "http://localhost",
  };
  let server;
  return {
    ...options,
    app,
    show,
    book,
    advance: (n) => (clock += n),
    start: async () => {
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
    },
    request: async (path, method = "GET", body, user = "a", extra = {}) =>
      fetch("http://127.0.0.1:" + server.address().port + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-user": user,
          ...extra,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    close: t.after(async () => {
      if (server) await new Promise((r) => server.close(r));
      db.close();
    }),
  };
}
test("experience preferences validate language and subtitle bounds and stay scoped to the owning profile", async (t) => {
  const f = await fixture(t),
    { registerExperience, defaults } = require("../server/experience");
  registerExperience(f.app, f);
  await f.start();
  assert.equal(
    (await f.request("/api/experience/p", "GET", null, "b")).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/experience/p", "PUT", {
        ...defaults,
        interfaceLanguage: "ja",
        genres: ["Action"],
        subtitleScale: 150,
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await f.request("/api/experience/p")).json()).interfaceLanguage,
    "ja",
  );
  assert.equal(
    (
      await f.request("/api/experience/p", "PUT", {
        ...defaults,
        subtitleOpacity: -1,
      })
    ).status,
    400,
  );
});
test("TV remotes cannot control foreign devices, need the receiver secret, expire commands and revoke cleanly", async (t) => {
  const f = await fixture(t);
  require("../server/tv-devices").registerTVDevices(f.app, f);
  await f.start();
  const d = await (
      await f.request("/api/tv-devices", "POST", { name: "TV" })
    ).json(),
    url = "/api/tv-devices/" + d.id,
    state = {
      title: "Show",
      paused: true,
      position: 10,
      duration: 100,
      volume: 0.5,
    };
  assert.equal(
    (await f.request(url + "/command", "POST", { command: "play" }, "b"))
      .status,
    404,
  );
  assert.equal(
    (await f.request(url + "/heartbeat", "POST", { token: "wrong", state }))
      .status,
    403,
  );
  await f.request(url + "/command", "POST", { command: "seek", value: 30 });
  let r = await (
    await f.request(url + "/heartbeat", "POST", { token: d.token, state })
  ).json();
  assert.equal(r.commands[0].value, 30);
  assert.equal(
    (
      await (
        await f.request(url + "/heartbeat", "POST", { token: d.token, state })
      ).json()
    ).commands.length,
    0,
  );
  await f.request(url + "/command", "POST", { command: "play" });
  f.advance(16000);
  assert.equal(
    (await f.request(url + "/command", "POST", { command: "pause" })).status,
    409,
  );
  assert.equal(
    (
      await (
        await f.request(url + "/heartbeat", "POST", { token: d.token, state })
      ).json()
    ).commands.length,
    0,
  );
  await f.request(url, "DELETE");
  assert.equal(
    (await f.request(url + "/heartbeat", "POST", { token: d.token, state }))
      .status,
    404,
  );
});
test("activity is opt-in, excludes kids and mature media, expires and revoked keys cannot read it", async (t) => {
  const f = await fixture(t);
  require("../server/watch-activity").registerWatchActivity(f.app, f);
  await f.start();
  assert.equal(
    (
      await f.request("/api/watch-activity/kid/settings", "PUT", {
        enabled: true,
      })
    ).status,
    400,
  );
  await f.request("/api/watch-activity/p/settings", "PUT", { enabled: true });
  const { token } = await (
      await f.request("/api/watch-activity/p/companion-key", "POST", {})
    ).json(),
    body = {
      itemId: "s",
      episode: "01.mp4",
      position: 2,
      duration: 100,
      paused: false,
    };
  assert.equal(
    (
      await f.request("/api/watch-activity/p/heartbeat", "POST", {
        ...body,
        itemId: "adult",
      })
    ).status,
    400,
  );
  await f.request("/api/watch-activity/p/heartbeat", "POST", body);
  let r = await (
    await f.request("/api/watch-activity/companion", "GET", null, "b", {
      Authorization: "Bearer " + token,
    })
  ).json();
  assert.equal(r.activity.title, "Show");
  assert.equal(r.activity.account_id, undefined);
  f.advance(21000);
  assert.equal(
    (
      await (
        await f.request("/api/watch-activity/companion", "GET", null, "b", {
          Authorization: "Bearer " + token,
        })
      ).json()
    ).activity,
    null,
  );
  await f.request("/api/watch-activity/p/settings", "PUT", { enabled: false });
  assert.equal(
    (
      await f.request("/api/watch-activity/companion", "GET", null, "b", {
        Authorization: "Bearer " + token,
      })
    ).status,
    401,
  );
});
test("account export excludes credentials and other accounts, while deletion needs proof, exact confirmation and last-admin protection", async (t) => {
  const f = await fixture(t);
  f.db.exec("ALTER TABLE account_email ADD COLUMN verified_at TEXT");
  require("../server/account-data").registerAccountData(f.app, f);
  await f.start();
  assert.equal(
    (await f.request("/api/account-data/export", "POST", { password: "wrong" }))
      .status,
    400,
  );
  const response = await f.request("/api/account-data/export", "POST", {
    password: "correct",
  });
  assert.equal(response.status, 200);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer())),
    data = JSON.parse(strFromU8(files["I-O-account.json"]));
  assert.equal(data.profiles.length, 2);
  assert.equal(data.profiles[0].pin, undefined);
  assert.equal(JSON.stringify(data).includes("Bob"), false);
  assert.equal(
    (
      await f.request("/api/account-data/delete", "POST", {
        password: "correct",
        confirmation: "wrong",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/account-data/delete", "POST", {
        password: "correct",
        confirmation: "Alice",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(
        "/api/account-data/delete",
        "POST",
        { password: "correct", confirmation: "Bob" },
        "b",
      )
    ).status,
    200,
  );
  assert.equal(
    f.db.prepare("SELECT * FROM accounts WHERE id='b'").get(),
    undefined,
  );
  assert.equal(
    f.db.prepare("SELECT * FROM profiles WHERE id='q'").get(),
    undefined,
  );
});
test("discovery ranks genuine completion viewers, requires admin scheduling and validates volume chapter membership", async (t) => {
  const f = await fixture(t);
  require("../server/discovery-plus").registerDiscoveryPlus(f.app, f);
  await f.start();
  f.db
    .prepare("INSERT INTO watched_episodes VALUES(?,?,?,?,?,?)")
    .run("p", "s", "anime", "01.mp4", "One", new Date().toISOString());
  let data = await (await f.request("/api/discovery-plus")).json();
  assert.deepEqual(data.series, [{ id: "s", rank: 1 }]);
  const body = {
    title: "Soon",
    description: "A title",
    kind: "series",
    releaseAt: new Date(Date.now() + 3600000).toISOString(),
    rating: "PG",
  };
  assert.equal(
    (await f.request("/api/discovery-plus/upcoming", "POST", body, "b")).status,
    403,
  );
  assert.equal(
    (await f.request("/api/discovery-plus/upcoming", "POST", body)).status,
    201,
  );
  const details = {
    author: "Author",
    artist: "Artist",
    publisher: "Publisher",
    publicationStatus: "Ongoing",
    language: "Japanese",
    volumes: [{ name: "Volume 1", chapters: ["Chapter 1"] }],
  };
  assert.equal(
    (await f.request("/api/discovery-plus/books/m", "PUT", details)).status,
    200,
  );
  assert.equal(
    (
      await f.request("/api/discovery-plus/books/m", "PUT", {
        ...details,
        volumes: [{ name: "Invalid", chapters: ["Not here"] }],
      })
    ).status,
    400,
  );
  assert.equal(
    (await (await f.request("/api/discovery-plus/books/m")).json()).author,
    "Author",
  );
});
test("tracker authorization binds browser/account; previews prevent stale or cross-profile sync and pull only the reviewed title", async (t) => {
  const f = await fixture(t);
  let remoteCount = 1,
    remoteStatus = "watching",
    calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    let data;
    if (url.includes("/oauth2/token"))
      data = {
        access_token: "private-token",
        refresh_token: "refresh",
        expires_in: 3600,
      };
    else if (url.endsWith("/users/@me"))
      data = { id: 99, name: "TrackerAlice" };
    else if (options.method === "PATCH") {
      const b = new URLSearchParams(options.body);
      remoteCount = Number(b.get("num_watched_episodes"));
      remoteStatus = b.get("status");
      data = { status: remoteStatus };
    } else
      data = {
        my_list_status: {
          status: remoteStatus,
          num_episodes_watched: remoteCount,
        },
      };
    return { ok: true, json: async () => data };
  };
  require("../server/trackers").registerTrackers(f.app, { ...f, fetchImpl });
  await f.start();
  const connect = await f.request("/api/trackers/p/mal/connect", "POST", {}),
    url = new URL((await connect.json()).url),
    state = url.searchParams.get("state"),
    cookie = connect.headers.get("set-cookie").split(";")[0],
    callback = "/api/trackers/callback/mal?state=" + state + "&code=code";
  assert.equal(url.searchParams.get("code_challenge_method"), "plain");
  assert.equal(
    (await f.request(callback, "GET", null, "b", { Cookie: cookie })).status,
    400,
  );
  assert.equal((await f.request(callback)).status, 400);
  const response = await fetch(
    new URL((await f.request("/api/trackers/setup")).url).origin + callback,
    { headers: { "x-user": "a", Cookie: cookie }, redirect: "manual" },
  );
  assert.equal(response.status, 302);
  assert.equal(
    (await f.request(callback, "GET", null, "a", { Cookie: cookie })).status,
    400,
  );
  assert.equal(
    (await (await f.request("/api/trackers/p/connections")).json())[0]
      .displayName,
    "TrackerAlice",
  );
  assert.equal(
    f.db
      .prepare("SELECT credentials FROM tracker_connections")
      .get()
      .credentials.includes("private-token"),
    false,
  );
  const body = { itemId: "s", itemType: "anime", direction: "pull" };
  let plan = await (
    await f.request("/api/trackers/p/mal/preview", "POST", body)
  ).json();
  assert.equal(plan.beforeRemote.count, 1);
  assert.equal(
    (await f.request("/api/trackers/q/mal/apply", "POST", { planId: plan.id }))
      .status,
    403,
  );
  remoteCount = 2;
  assert.equal(
    (await f.request("/api/trackers/p/mal/apply", "POST", { planId: plan.id }))
      .status,
    400,
  );
  f.advance(1001);
  plan = await (
    await f.request("/api/trackers/p/mal/preview", "POST", body)
  ).json();
  assert.equal(
    (await f.request("/api/trackers/p/mal/apply", "POST", { planId: plan.id }))
      .status,
    200,
  );
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM watched_episodes WHERE profile_id='p'")
      .get().n,
    2,
  );
  assert.equal(
    (await f.request("/api/trackers/p/mal/apply", "POST", { planId: plan.id }))
      .status,
    400,
  );
  f.advance(1001);
  plan = await (
    await f.request("/api/trackers/p/mal/preview", "POST", {
      ...body,
      direction: "push",
    })
  ).json();
  f.db
    .prepare("UPDATE my_list SET status='completed' WHERE profile_id='p'")
    .run();
  assert.equal(
    (await f.request("/api/trackers/p/mal/apply", "POST", { planId: plan.id }))
      .status,
    400,
  );
});
test("categorized delivery validates destinations, deduplicates events, retries failures and honors opt-out before sending", async (t) => {
  const f = await fixture(t);
  f.db.exec(
    "CREATE TABLE notifications(id TEXT PRIMARY KEY,title TEXT,message TEXT,link TEXT,profile_id TEXT);CREATE TABLE upcoming_titles(id TEXT,title TEXT,description TEXT,release_at TEXT,rating TEXT)",
  );
  let hook,
    sends = 0,
    fail = true;
  const notifications = {
    listForProfile: () => [],
    setDeliveryHook: (fn) => (hook = fn),
    create: (n) => {
      const id = require("node:crypto").randomUUID();
      f.db
        .prepare("INSERT INTO notifications VALUES(?,?,?,?,?,?)")
        .run(
          id,
          n.title,
          n.message || "",
          n.link || "",
          n.profileId || null,
          n.category || "announcements",
        );
      const value = { ...n, id };
      hook(value);
      return value;
    },
  };
  const engine =
    require("../server/notification-delivery").registerNotificationDelivery(
      f.app,
      {
        ...f,
        notifications,
        startWorker: false,
        fetchImpl: async (url, options) => {
          sends++;
          assert.equal(
            url.startsWith("https://discord.com/api/webhooks/"),
            true,
          );
          assert.deepEqual(JSON.parse(options.body).allowed_mentions, {
            parse: [],
          });
          return { ok: !fail };
        },
      },
    );
  await f.start();
  const { categories } = require("../server/notification-delivery"),
    preferences = Object.fromEntries(
      categories.map((k) => [
        k,
        { inapp: true, email: false, discord: k === "episodes" },
      ]),
    ),
    url = "https://discord.com/api/webhooks/123456789/" + "a".repeat(40);
  assert.equal(
    (
      await f.request("/api/notification-delivery", "PUT", {
        preferences,
        webhook: "https://localhost/private",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/notification-delivery", "PUT", {
        preferences,
        webhook: url,
      })
    ).status,
    200,
  );
  assert.equal(
    f.db
      .prepare("SELECT webhook FROM notification_delivery_preferences")
      .get()
      .webhook.includes(url),
    false,
  );
  const n = notifications.create({
    title: "New episode",
    message: "Hello @everyone",
    category: "episodes",
    profileId: "p",
    link: "#/title/s",
  });
  hook(n);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM delivery_queue").get().n,
    1,
  );
  await engine.work();
  assert.equal(sends, 1);
  assert.equal(
    f.db.prepare("SELECT status FROM delivery_queue").get().status,
    "pending",
  );
  fail = false;
  f.advance(61000);
  await engine.work();
  assert.equal(
    f.db.prepare("SELECT status FROM delivery_queue").get().status,
    "sent",
  );
  notifications.create({
    title: "Another",
    category: "episodes",
    profileId: "p",
  });
  preferences.episodes.discord = false;
  await f.request("/api/notification-delivery", "PUT", { preferences });
  await engine.work();
  assert.equal(sends, 2);
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM delivery_queue WHERE status='cancelled'")
      .get().n,
    1,
  );
  engine.checkSeasons();
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM notifications WHERE category='seasons'")
      .get().n,
    0,
  );
  f.show.groups.push({ name: "Season 2", episodes: [] });
  engine.checkSeasons();
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM notifications WHERE category='seasons'")
      .get().n,
    1,
  );
});
test("rich comment formatting never turns HTML, attributes or script schemes into executable content", () => {
  const vm = require("node:vm"),
    fs = require("node:fs");
  const source = fs
      .readFileSync(require.resolve("../public/js/io-rich-comments.js"), "utf8")
      .split("(function")[0],
    escapeHtml = (s) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
  const ctx = { escapeHtml };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const html = ctx.ioRichComment(
    "**<img src=x onerror=alert(1)>** `javascript:alert(1)` *hello*",
  );
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("<strong>&lt;img"), true);
  assert.equal(html.includes("<em>hello</em>"), true);
  assert.equal(html.includes("<a"), false);
});
test("integration secrets survive restart encrypted and reject modified ciphertext", (t) => {
  const fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os"),
    { createPrivateSettings } = require("../server/private-settings"),
    root = fs.mkdtempSync(
      path.join(process.env.IO_TEST_ROOT || os.tmpdir(), "io-secrets-"),
    );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createPrivateSettings(root),
    token = store.seal({ access_token: "keep-private" });
  assert.equal(token.includes("keep-private"), false);
  store.save({ anilistSecret: "another-private-value" });
  assert.equal(
    fs
      .readFileSync(path.join(root, "integrations.json"), "utf8")
      .includes("another-private-value"),
    false,
  );
  const restarted = createPrivateSettings(root);
  assert.equal(restarted.get().anilistSecret, "another-private-value");
  assert.equal(restarted.open(token).access_token, "keep-private");
  const altered = Buffer.from(token, "base64");
  altered[30] ^= 1;
  assert.throws(() => restarted.open(altered.toString("base64")));
});
test("AniList authorization and reviewed mutation use the linked profile, status mapping and recorded completion count", async (t) => {
  const f = await fixture(t);
  let mutations = [];
  require("../server/trackers").registerTrackers(f.app, {
    ...f,
    fetchImpl: async (url, options) => {
      let data;
      if (url.includes("/oauth/token")) {
        assert.equal(
          new URLSearchParams(options.body).get("client_secret"),
          "secret",
        );
        data = { access_token: "ani-private", expires_in: 3600 };
      } else {
        const b = JSON.parse(options.body);
        if (b.query.startsWith("mutation")) {
          mutations.push(b);
          data = { data: { SaveMediaListEntry: { id: 1 } } };
        } else if (b.query.includes("Media("))
          data = {
            data: {
              Viewer: { id: 123 },
              Media: { mediaListEntry: { status: "PLANNING", progress: 0 } },
            },
          };
        else data = { data: { Viewer: { id: 123, name: "AniAlice" } } };
      }
      return { ok: true, json: async () => data };
    },
  });
  await f.start();
  const r = await f.request("/api/trackers/p/anilist/connect", "POST", {}),
    url = new URL((await r.json()).url),
    cookie = r.headers.get("set-cookie").split(";")[0],
    origin = new URL((await f.request("/api/trackers/setup")).url).origin;
  assert.equal(
    (
      await fetch(
        origin +
          "/api/trackers/callback/anilist?code=code&state=" +
          url.searchParams.get("state"),
        { headers: { "x-user": "a", Cookie: cookie }, redirect: "manual" },
      )
    ).status,
    302,
  );
  f.db
    .prepare("INSERT INTO watched_episodes VALUES(?,?,?,?,?,?)")
    .run("p", "s", "anime", "01.mp4", "One", new Date().toISOString());
  const plan = await (
    await f.request("/api/trackers/p/anilist/preview", "POST", {
      itemId: "s",
      itemType: "anime",
      direction: "push",
    })
  ).json();
  assert.equal(
    (
      await f.request("/api/trackers/p/anilist/apply", "POST", {
        planId: plan.id,
      })
    ).status,
    200,
  );
  assert.deepEqual(mutations[0].variables, {
    id: 20,
    status: "CURRENT",
    progress: 1,
  });
  assert.equal(
    (await f.request("/api/trackers/p/anilist", "DELETE")).status,
    200,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM tracker_connections").get().n,
    0,
  );
});
