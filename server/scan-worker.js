// Runs one media root's scan inside its own worker thread. This is the
// actual fix for a network share (or any slow/misbehaving path) being
// able to freeze the whole server: scanning uses plain, fast
// synchronous fs calls (measured meaningfully faster at real library
// sizes than the async equivalent - the async version's per-call
// overhead adds up across the many thousands of small fs operations a
// big library needs), but if one of those calls hangs, it only blocks
// THIS disposable worker thread. The main thread - the one actually
// answering HTTP requests - never touches this code at all, so it
// can't be blocked by it; a stuck worker just gets killed on timeout
// by whoever spawned it (see withTimeout/scan() in library.js).
const { parentPort, workerData } = require('worker_threads');
const { Library } = require('./library');

const { mode, config, baseDir } = workerData;

try {
  const lib = new Library(config, baseDir);
  let result;
  if (mode === 'anime') result = lib._scanVideoRoot(lib.animeRoot, 'anime', 'series', false);
  else if (mode === 'movies') result = lib._scanVideoRoot(lib.movieRoot, 'movies', 'movie', true);
  else result = lib._scanManga();

  // _scanVideoRoot/_scanManga are `async function`s (they yield to the
  // event loop periodically on a big scan) but do no real async I/O
  // anymore, so this resolves promptly once the synchronous work is
  // actually done - it's only ever slow if the fs calls themselves are.
  Promise.resolve(result).then((items) => {
    parentPort.postMessage({
      ok: true,
      items,
      flatShowIds: mode === 'movies' ? Array.from(lib._flatShowIds) : [],
      chapterIndex: mode === 'manga' ? lib._chapterIndex : null,
    });
  }).catch((e) => {
    parentPort.postMessage({ ok: false, error: e.message });
  });
} catch (e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
