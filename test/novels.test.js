const { test } = require("node:test");
const assert = require("node:assert/strict");
const { zipSync, strToU8 } = require("fflate");
const { resolveTextSpine } = require("../server/epub");
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
