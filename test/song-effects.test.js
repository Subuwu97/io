const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('soft song mode uses stable lyric text without requiring WebAssembly and stale loads cannot replace a newer selection', async () => {
  let calls = 0;
  const context = vm.createContext({ window: {}, fetch: async () => { calls++; return { ok: true, json: async () => ({ lyrics: [{ start: 0, end: 2, text: 'Steady lyrics' }] }) }; }, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/ass-player.js'), 'utf8'), context);
  const player = new context.window.IOAss({});
  assert.equal(await player.load({ showId: 'show', encodedRelPath: 'song.mkv', track: 1, soft: true }), false);
  assert.equal(player.lyrics[0].text, 'Steady lyrics');
  const previous = calls;
  await Promise.all([player.load({ showId: 'show', encodedRelPath: 'song.mkv', track: 1, soft: true }), player.load({ showId: 'show', encodedRelPath: 'song.mkv', track: 2, soft: true })]);
  assert.equal(calls - previous, 1);
  await player.clear(); assert.equal(player.lyrics.length, 0);
});
