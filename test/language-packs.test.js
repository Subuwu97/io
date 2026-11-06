const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
test("expanded interface packs have complete Spanish, French and Japanese entries with unique English keys", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(
      require.resolve("../public/js/io-language-packs.js"),
      "utf8",
    ) + "\nglobalThis.packs=IO_UI_TRANSLATIONS;globalThis.rows=IO_UI_STRINGS;",
    context,
  );
  const keys = new Set();
  for (const row of context.rows) {
    assert.equal(row.length, 4);
    assert.equal(keys.has(row[0]), false, row[0]);
    keys.add(row[0]);
    for (const value of row)
      assert.ok(typeof value === "string" && value.trim());
  }
  assert.ok(keys.has("Automatic airing schedule"));
  for (const language of ["es", "fr", "ja"]) {
    assert.equal(Object.keys(context.packs[language]).length, keys.size);
    assert.ok(context.packs[language]["Restore a personal export"]);
  }
});
