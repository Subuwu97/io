const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const testRoot = process.env.IO_TEST_ROOT || os.tmpdir();
fs.mkdirSync(testRoot, { recursive: true });
const temporary = fs.mkdtempSync(path.join(testRoot, 'io-network-tests-'));
process.env.IO_DATA_DIR = path.join(temporary, 'runtime');
const { Library } = require('../server/library');
const { computeSignature } = require('../server/library-change-detector');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(name) {
  const base = path.join(temporary, name);
  const mediaPaths = Object.fromEntries(['anime', 'movies', 'manga'].map(kind => [kind, path.join(base, kind)]));
  for (const root of Object.values(mediaPaths)) fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(mediaPaths.anime, 'Sample Show'));
  fs.writeFileSync(path.join(mediaPaths.anime, 'Sample Show', '01.mp4'), 'fixture');
  fs.writeFileSync(path.join(mediaPaths.movies, 'Sample Movie.mp4'), 'fixture');
  fs.mkdirSync(path.join(mediaPaths.manga, 'Sample Manga', 'Chapter 1'), { recursive: true });
  fs.writeFileSync(path.join(mediaPaths.manga, 'Sample Manga', 'Chapter 1', '001.jpg'), 'fixture');
  return { base, config: { mediaPaths, videoExtensions: ['.mp4'], imageExtensions: ['.jpg'], libraryScanTimeoutSec: 5 }, snapshotPath: path.join(base, 'state', 'library-index.json') };
}

test('missing shares retain complete catalogs and lookup indexes, including across restart; reconnect refreshes them', async () => {
  const f = fixture('disconnect');
  const original = await Library.create(f.config, f.base, { snapshotPath: f.snapshotPath });
  for (const kind of ['anime', 'movies', 'manga']) assert.equal(original.cache[kind].length, 1);
  assert.equal(original._flatShowIds.size, 1);
  assert.equal(Object.keys(original._chapterIndex).length, 1);
  await delay(100);
  for (const root of Object.values(f.config.mediaPaths)) fs.renameSync(root, root + '-offline');
  const offline = await Library.create(f.config, f.base, { previous: original, snapshotPath: f.snapshotPath });
  for (const kind of ['anime', 'movies', 'manga']) {
    assert.equal(offline.cache[kind].length, 1);
    assert.equal(offline.scanStatus[kind].state, 'error');
  }
  assert.deepEqual([...offline._flatShowIds], [...original._flatShowIds]);
  assert.deepEqual(offline._chapterIndex, original._chapterIndex);
  const restored = new Library(f.config, f.base, { snapshotPath: f.snapshotPath });
  for (const kind of ['anime', 'movies', 'manga']) assert.equal(restored.cache[kind].length, 1);
  assert.deepEqual([...restored._flatShowIds], [...original._flatShowIds]);
  assert.deepEqual(restored._chapterIndex, original._chapterIndex);
  await delay(100);
  for (const root of Object.values(f.config.mediaPaths)) fs.renameSync(root + '-offline', root);
  fs.writeFileSync(path.join(f.config.mediaPaths.anime, 'Sample Show', '02.mp4'), 'fixture');
  const recovered = await Library.create(f.config, f.base, { previous: restored, snapshotPath: f.snapshotPath });
  assert.equal(recovered.cache.anime[0].episodeCount, 2);
  for (const kind of ['anime', 'movies', 'manga']) assert.equal(recovered.scanStatus[kind].state, 'ready');
});

test('a worker timeout preserves flat-movie and manga state instead of clearing it', async () => {
  const f = fixture('timeout');
  const good = await Library.create(f.config, f.base);
  await delay(100);
  const slow = new Library({ ...f.config, libraryScanTimeoutSec: 0.03 }, f.base, { previous: good });
  slow._createWorker = () => new Worker('setInterval(() => {}, 1000)', { eval: true });
  await slow.scan();
  assert.deepEqual(slow.cache.anime, good.cache.anime);
  assert.deepEqual(slow.cache.movies, good.cache.movies);
  assert.deepEqual(slow.cache.manga, good.cache.manga);
  assert.deepEqual([...slow._flatShowIds], [...good._flatShowIds]);
  assert.deepEqual(slow._chapterIndex, good._chapterIndex);
  for (const kind of ['anime', 'movies', 'manga']) assert.equal(slow.scanStatus[kind].state, 'timeout');
});

test('complete, readable empty roots apply intentional removals; changed roots never inherit unrelated titles', async () => {
  const f = fixture('removal');
  const good = await Library.create(f.config, f.base, { snapshotPath: f.snapshotPath });
  await delay(100);
  fs.renameSync(path.join(f.config.mediaPaths.anime, 'Sample Show'), path.join(f.base, 'removed-show'));
  const empty = await Library.create(f.config, f.base, { previous: good });
  assert.equal(empty.cache.anime.length, 0);
  assert.equal(empty.scanStatus.anime.state, 'ready');
  const changed = new Library({ ...f.config, mediaPaths: { ...f.config.mediaPaths, anime: path.join(f.base, 'different-share') } }, f.base, { snapshotPath: f.snapshotPath });
  assert.equal(changed.cache.anime.length, 0);
  assert.equal(changed.cache.movies.length, 1);
});

test('catalog restore tolerates a damaged snapshot and captures its own config', () => {
  const f = fixture('damaged');
  fs.mkdirSync(path.dirname(f.snapshotPath), { recursive: true }); fs.writeFileSync(f.snapshotPath, '{broken');
  const lib = new Library(f.config, f.base, { snapshotPath: f.snapshotPath });
  assert.equal(lib.cache.anime.length, 0);
  f.config.mediaPaths.anime = 'changed-during-scan';
  assert.notEqual(lib.config.mediaPaths.anime, f.config.mediaPaths.anime);
});

test('periodic check returns at its deadline even when its worker cannot complete', async () => {
  const start = Date.now();
  const result = await computeSignature([{ label: 'anime', dir: 'unresponsive-share' }], {
    timeoutMs: 25, workerFactory: () => new Worker('setInterval(() => {}, 1000)', { eval: true }) });
  assert.equal(result, null); assert.ok(Date.now() - start < 1000);
});
