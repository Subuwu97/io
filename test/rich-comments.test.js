const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express"),
  { DatabaseSync } = require("node:sqlite");
const { richComment, gifAttachment } = require("../server/rich-comments");
const gif =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
test("rich comments retain supported formatting and remove executable, styled and external embedded content", () => {
  const result = richComment(
    '<p onclick="bad()">Hello <strong>world</strong><img src="https://outside.invalid/a"><script>bad()</script><a href="javascript:bad()">bad link</a><a href="https://example.com">safe</a></p>',
  );
  assert.match(result.html, /<strong>world<\/strong>/);
  assert.doesNotMatch(result.html, /onclick|<script|<img|javascript:/);
  assert.match(result.html, /noopener/);
  assert.throws(() => richComment("<script>only executable</script>"));
  assert.throws(() => richComment("<p>" + "a".repeat(2001) + "</p>"));
  assert.equal(gifAttachment(gif).subarray(0, 6).toString(), "GIF89a");
  assert.throws(() => gifAttachment("data:image/gif;base64,PHNjcmlwdD4="));
});
test("formatted comments and GIFs persist, require sign-in, respect blocking and are removed together", async (t) => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE accounts(id TEXT PRIMARY KEY,username TEXT);INSERT INTO accounts VALUES('a','Alice'),('b','Bob');CREATE TABLE account_blocks(source TEXT,target TEXT);",
  );
  const app = express();
  app.use(express.json());
  require("../server/episode-discussions")(app, {
    db,
    requireAuth: (req, res) => {
      const id = req.headers["x-user"];
      if (!["a", "b"].includes(id)) {
        res.sendStatus(401);
        return null;
      }
      return { id, role: "user" };
    },
    getShow: (id) =>
      id === "s" ? { groups: [{ episodes: [{ relPath: "one" }] }] } : null,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  const base =
      "http://127.0.0.1:" + server.address().port + "/api/discussions/s",
    headers = { "Content-Type": "application/json", "x-user": "a" };
  const response = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({
      episode: "one",
      richHtml: "<p>A <em>formatted</em> comment</p>",
      gif,
    }),
  });
  assert.equal(response.status, 201);
  const c = await response.json();
  assert.equal(c.hasGif, true);
  assert.match(c.richHtml, /<em>formatted/);
  const asset = base + "/" + c.id + "/gif";
  assert.equal((await fetch(asset)).status, 401);
  assert.equal(
    (await fetch(asset, { headers })).headers.get("content-type"),
    "image/gif",
  );
  db.prepare("INSERT INTO account_blocks VALUES(?,?)").run("a", "b");
  assert.equal(
    (await fetch(asset, { headers: { "x-user": "b" } })).status,
    404,
  );
  await fetch(base + "/" + c.id, { method: "DELETE", headers });
  assert.equal((await fetch(asset, { headers })).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM discussion_gifs").get().n, 0);
});
