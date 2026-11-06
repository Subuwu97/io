const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  express = require("express"),
  { DatabaseSync } = require("node:sqlite");
test("advanced library search combines text, all/excluded genres, formats, dates, list status and language tags", () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    fs
      .readFileSync(
        require.resolve("../public/js/io-advanced-search.js"),
        "utf8",
      )
      .split("async function")[0],
    ctx,
  );
  const titles = [
    {
      title: "Lantern",
      description: "A quiet journey",
      type: "anime",
      genres: ["Adventure", "Fantasy"],
      year: 2024,
      audioLanguages: ["ja"],
      _listStatus: "planned",
    },
    { title: "Other", type: "movie", genres: ["Horror"], year: 2025 },
    {
      title: "Paper",
      type: "manga",
      chapters: [{ format: "novel" }],
      genres: ["Fantasy"],
      year: 2023,
    },
  ];
  assert.equal(
    ctx.ioSearchCatalog(titles, {
      q: "quiet journey",
      include: "Adventure, Fantasy",
      exclude: "Horror",
      language: "ja",
      status: "planned",
      from: "2020",
      to: "2024",
    }).length,
    1,
  );
  assert.equal(
    ctx.ioSearchCatalog(titles, { kind: "novel" })[0].title,
    "Paper",
  );
  assert.equal(
    ctx.ioSearchCatalog(titles, { include: "Fantasy", exclude: "Adventure" })[0]
      .title,
    "Paper",
  );
  assert.equal(ctx.ioSearchCatalog(titles, { sort: "year" })[0].title, "Other");
});
test("upcoming importer is opt-in/admin controlled, deduplicates anime, excludes adults and preserves the previous schedule on failure", async (t) => {
  const db = new DatabaseSync(":memory:"),
    app = express();
  app.use(express.json());
  let fail = false,
    calls = 0;
  const now = Date.now(),
    future = Math.floor(now / 1000) + 100;
  const sync = require("../server/upcoming-sync").registerUpcomingSync(app, {
    db,
    requireAuth: (req) => ({ role: req.headers["x-role"] || "user" }),
    now: () => now,
    startWorker: false,
    fetcher: async () => {
      calls++;
      if (fail) throw Error("Offline");
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            data: {
              Page: {
                pageInfo: { hasNextPage: false },
                airingSchedules: [
                  {
                    airingAt: future,
                    episode: 1,
                    media: {
                      id: 1,
                      title: { english: "Upcoming" },
                      format: "TV",
                      isAdult: false,
                    },
                  },
                  {
                    airingAt: future + 10,
                    episode: 2,
                    media: {
                      id: 1,
                      title: { english: "Upcoming" },
                      isAdult: false,
                    },
                  },
                  {
                    airingAt: future,
                    episode: 1,
                    media: { id: 2, title: { romaji: "Adult" }, isAdult: true },
                  },
                ],
              },
            },
          }),
      };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    sync.stop();
    await new Promise((r) => server.close(r));
    db.close();
  });
  const base =
    "http://127.0.0.1:" +
    server.address().port +
    "/api/discovery-plus/upcoming-sync";
  assert.equal(calls, 0);
  assert.equal(sync.status().enabled, 0);
  assert.equal((await fetch(base)).status, 403);
  assert.equal(await sync.refresh(), 1);
  assert.equal(sync.items()[0].title, "Upcoming");
  fail = true;
  await assert.rejects(() => sync.refresh());
  assert.equal(sync.items().length, 1);
  assert.match(sync.status().error, /Offline/);
});
