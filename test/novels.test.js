const { test } = require("node:test");
const assert = require("node:assert/strict");
const { zipSync, strToU8 } = require("fflate");
const { resolveTextSpine } = require("../server/epub");
const { resolveTextNavigation } = require("../server/epub");
const { sanitizeSection } = require("../server/novels");
function book(body) {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries({
          "META-INF/container.xml": `<container><rootfile full-path='OPS/book.opf'/></container>`,
          "OPS/book.opf": `<package><manifest><item id='one' href='one.xhtml'/></manifest><spine><itemref idref='one'/></spine></package>`,
          "OPS/one.xhtml": `<html><body><h1>Chapter One</h1>${body}</body></html>`,
        }).map(([k, v]) => [k, strToU8(v)]),
      ),
    ),
  );
}
test("text EPUB detection follows the spine and leaves image books in their existing reader", () => {
  assert.equal(
    resolveTextSpine(book("<p>" + "A story unfolds. ".repeat(40) + "</p>"))[0]
      .name,
    "OPS/one.xhtml",
  );
  assert.deepEqual(resolveTextSpine(book('<img src="page.jpg"/>')), []);
  assert.equal(resolveTextSpine(book("<p>Short story</p>"), true).length, 1);
});
test("novel HTML removes executable and external content while retaining local illustrations", () => {
  const html = sanitizeSection(
    '<script>alert(1)</script><style>body{display:none}</style><p onclick="bad()">Hello <em>reader</em></p><img src="https://outside.invalid/x"><img src="art.png" onerror="bad()"><iframe src="x"></iframe>',
    "OPS/one.xhtml",
    "/assets/",
    [{ name: "OPS/art.png" }],
  );
  assert.match(html, /<em>reader<\/em>/);
  assert.match(html, /src="\/assets\/OPS\/art.png"/);
  assert.doesNotMatch(
    html,
    /script|onclick|onerror|iframe|outside.invalid|display:none/,
  );
});
test("EPUB navigation uses internal spine targets and rejects external or non-spine links", () => {
  const bytes = Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries({
          "META-INF/container.xml":
            '<container><rootfile full-path="OPS/book.opf"/></container>',
          "OPS/book.opf":
            '<manifest><item id="nav" properties="nav" href="nav.xhtml"/></manifest>',
          "OPS/nav.xhtml":
            '<nav epub:type="toc"><a href="one.xhtml#start">The Beginning &amp; Beyond</a><a href="https://outside.test/one.xhtml">External</a><a href="missing.xhtml">Missing</a><a href="one.xhtml">Duplicate</a></nav>',
        }).map(([k, v]) => [k, strToU8(v)]),
      ),
    ),
  );
  assert.deepEqual(resolveTextNavigation(bytes, [{ name: "OPS/one.xhtml" }]), [
    { index: 0, title: "The Beginning & Beyond" },
  ]);
});
test("novel notes bind to the owning profile and allowed book, validate locations and persist privately", async (t) => {
  const express = require("express"),
    { DatabaseSync } = require("node:sqlite"),
    fs = require("node:fs/promises"),
    path = require("node:path");
  const folder = await fs.mkdtemp(
    path.join(
      process.env.IO_TEST_ROOT || require("node:os").tmpdir(),
      "io-notes-",
    ),
  );
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, "book.epub");
  await fs.writeFile(
    file,
    book("<p>" + "A story unfolds. ".repeat(40) + "</p>"),
  );
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE profiles(id TEXT PRIMARY KEY,account_id TEXT,is_kids INTEGER);INSERT INTO profiles VALUES('p','a',0),('q','b',0)",
  );
  const app = express();
  app.use(express.json());
  require("../server/novels").registerNovels(app, {
    db,
    requireAuth: (req, res) => ({ id: req.headers["x-user"] || "a" }),
    getLibrary: () => ({
      getManga: (id) =>
        id === "book" ? { id, title: "Book", rating: "PG" } : null,
      getChapterInfo: () => ({ type: "novel", fullPath: file }),
    }),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  const base =
    "http://127.0.0.1:" + server.address().port + "/api/novels/book/Book/notes";
  const write = (body) =>
    fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await write({
        profileId: "q",
        section: 0,
        fraction: 0,
        quote: "",
        note: "private",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await write({
        profileId: "p",
        section: 2,
        fraction: 0,
        quote: "",
        note: "bad",
      })
    ).status,
    400,
  );
  const saved = await (
    await write({
      profileId: "p",
      section: 0,
      fraction: 0.4,
      quote: "A story",
      note: "Remember this",
    })
  ).json();
  assert.ok(saved.id);
  const own = await (await fetch(base + "?profile=p")).json();
  assert.equal(own.length, 1);
  assert.equal(own[0].note, "Remember this");
  assert.equal((await fetch(base + "?profile=q")).status, 404);
  assert.equal(
    (
      await fetch(base + "/" + saved.id, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: "q" }),
      })
    ).status,
    404,
  );
  assert.equal(db.prepare("SELECT count(*) AS n FROM novel_notes").get().n, 1);
});
