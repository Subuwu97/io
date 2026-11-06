const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const archive = require('./archive');
const { isWithin } = require('./path-safety');
const epub = require('./epub');
const activeScans = new Map();
const directoryEntries = new Map();
function readEntries(dir) {
  if (!directoryEntries.has(dir)) directoryEntries.set(dir, fs.readdirSync(dir, { withFileTypes: true }));
  return directoryEntries.get(dir);
}
const pdfLib = require('./pdf');

// The media-asset route serving cover/banner/theme files sets an
// aggressive 1-hour browser cache (good - these rarely change, and
// there's no reason to re-fetch an unchanged image constantly). But
// without a way to invalidate that cache when the file DOES change -
// e.g. re-importing metadata replaces cover.jpg/banner.jpg in place,
// same filename - a person's browser would keep showing the old image
// for up to an hour after a fresh import, making it look like nothing
// happened. Appending the file's real modification time makes the URL
// itself change exactly when the file's content does, so a browser
// correctly treats it as a brand new resource instead of reusing a
// stale cached one.
function withCacheBust(url, filePath) {
  if (!url) return url;
  try {
    return `${url}?v=${fs.statSync(filePath).mtimeMs}`;
  } catch (e) {
    return url;
  }
}

/**
 * Expected folder layout:
 *
 * media/anime/<Show Name>/
 *    cover.jpg | cover.png          (poster, optional)
 *    banner.jpg | banner.png        (hero image, optional)
 *    info.json                      (optional: { description, year, rating, genres:[] })
 *    Season 01/  (optional grouping - any subfolder works as a "season")
 *        01 - Episode Title.mp4
 *        02 - Episode Title.mp4
 *    01 - Episode Title.mp4         (episodes can also sit flat, no season folder)
 *
 * media/manga/<Manga Title>/
 *    cover.jpg | cover.png
 *    info.json
 *    Chapter 001/                    (a folder of loose page images)
 *        001.jpg
 *        002.jpg
 *    Chapter 002.cbz                 (or a .cbz / .epub / .pdf file - each
 *    Chapter 003.epub                 one is its own chapter, named after
 *    Chapter 004.pdf                  the filename, sitting next to folders)
 */

// Scanning uses plain synchronous fs calls - measured meaningfully
// faster than the async equivalents at real library sizes (the async
// per-call overhead - thread-pool dispatch, promise scheduling - adds
// up across the many thousands of small fs operations a big library
// needs). This is safe from freezing the server because scan() below
// always runs this work inside a disposable worker thread rather than
// on the main thread - see scan-worker.js. A hang there blocks only
// that worker, which gets killed on timeout; the actual HTTP server
// never blocks on it at all.
function safeReadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.warn(`[scanner] Failed to parse ${filePath}: ${e.message}`);
  }
  return fallback;
}

function findFirstMatch(dir, names) {
  // One directory listing replaces repeated network round trips for absent assets.
  const key = name => process.platform === 'win32' ? name.toLowerCase() : name;
  const files = new Map(readEntries(dir).filter(entry => entry.isFile() || entry.isSymbolicLink()).map(entry => [key(entry.name), entry.name]));
  const name = names.find(name => files.has(key(name)));
  return name ? path.join(dir, files.get(key(name))) : null;
}

function slugify(str) {
  return Buffer.from(str).toString('base64url');
}
function unslugify(slug) {
  return Buffer.from(slug, 'base64url').toString('utf-8');
}

function listDirs(dir) {
  return readEntries(dir)
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function listFiles(dir, extensions) {
  return readEntries(dir)
    .filter(d => d.isFile() && extensions.includes(path.extname(d.name).toLowerCase()))
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// Yields control back to the event loop so other requests (from anyone
// else using the server right now) get a chance to run in between
// chunks of a big scan, instead of one long synchronous stretch that
// blocks literally everything else until it finishes.
function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

// A Unix-style absolute path (leading slash, no drive letter) means
// something very different on Windows than it looks like it should:
// Node resolves it against whatever drive the server process itself is
// running from, not any specific drive - so "/A/Anime" on a server
// running from C:\ actually means C:\A\Anime, not A:\Anime. This is a
// very easy mistake to make (and a very confusing one to diagnose from
// the symptom alone: it just looks like the folder doesn't exist),
// especially when copying paths between platforms or documentation.
function looksLikeMissingWindowsDriveLetter(configuredPath) {
  return process.platform === 'win32' && /^[\\/]/.test(configuredPath) && !/^[a-zA-Z]:/.test(configuredPath);
}

function pathNotFoundHint(configuredPath) {
  if (looksLikeMissingWindowsDriveLetter(configuredPath)) {
    return ` This path is missing a drive letter, which matters a lot on Windows: "${configuredPath}" doesn't mean "the A: drive" the way it might look like it should - it resolves relative to whichever drive the server itself happens to be running from. If this is meant to be on a specific drive, it needs that drive letter in front, e.g. "A:${configuredPath}" instead of "${configuredPath}".`;
  }
  return " If this is a mapped network drive, check it's actually connected, and that whatever account is running the server (not just your own login) can see it - a drive mapped in your own user session isn't automatically visible to a process running as a different account (e.g. the SYSTEM account, if this server is set up via Task Scheduler/a service).";
}

class Library {
  constructor(config, baseDir, options = {}) {
    this.config = structuredClone(config);
    this.baseDir = baseDir;
    this.animeRoot = path.resolve(baseDir, config.mediaPaths.anime);
    this.movieRoot = path.resolve(baseDir, config.mediaPaths.movies || './media/movies');
    this.mangaRoot = path.resolve(baseDir, config.mediaPaths.manga);
    this.cache = { anime: [], movies: [], manga: [], scannedAt: 0 };
    this._flatShowIds = new Set(); // populated by _scanVideoRoot for loose movie files (no wrapping folder)
    this._chapterIndex = {}; // populated by _scanManga - { mangaId: { chapterName: { type, fullPath } } }
    this.snapshotPath = options.snapshotPath || null;
    this.scanStatus = {};
    let previous = options.previous;
    if (!previous && this.snapshotPath) {
      try { const saved = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8')); if (saved.version === 1) previous = saved; }
      catch (error) { if (error.code !== 'ENOENT') console.warn(`[scanner] Could not restore saved catalog: ${error.message}`); }
    }
    for (const [kind, property] of [['anime', 'animeRoot'], ['movies', 'movieRoot'], ['manga', 'mangaRoot']]) {
      if (previous && previous[property] === this[property] && Array.isArray(previous.cache?.[kind])) {
        this.cache[kind] = previous.cache[kind];
        this.cache.scannedAt = previous.cache.scannedAt || 0;
        this.scanStatus[kind] = { ...previous.scanStatus?.[kind], state: 'cached' };
        if (kind === 'movies') this._flatShowIds = new Set(previous._flatShowIds instanceof Set || Array.isArray(previous._flatShowIds) ? previous._flatShowIds : []);
        if (kind === 'manga') this._chapterIndex = previous._chapterIndex && typeof previous._chapterIndex === 'object' && !Array.isArray(previous._chapterIndex) ? previous._chapterIndex : {};
      }
    }
    this._createWorker = data => new Worker(path.join(__dirname, 'scan-worker.js'), { workerData: data });

  }

  // Preferred way to get a ready-to-use, already-scanned Library.
  static async create(config, baseDir, options = {}) {
    const lib = new Library(config, baseDir, options);
    await lib.scan();
    return lib;
  }

  // Runs one media root's scan in its own worker thread (scan-worker.js)
  // so a hang there - the classic case being a network share that's
  // slow, disconnected, or stuck on an auth prompt - can only ever
  // block that disposable worker. If it doesn't finish in time, the
  // worker is killed outright and this falls back to whatever was
  // found last time (or empty on a first run) instead of leaving the
  // whole server unable to start.
  _scanRootInWorker(mode, timeoutMs, label, previous) {
    const root = mode === 'anime' ? this.animeRoot : mode === 'movies' ? this.movieRoot : this.mangaRoot;
    const key = JSON.stringify([mode, root]);
    const failed = (state, message) => ({ ok: false, items: previous, state, message });
    if (activeScans.has(key)) return Promise.resolve(failed('busy', 'Previous filesystem operation is still returning; keeping the saved catalog.'));
    return new Promise(resolve => {
      let worker;
      try { worker = this._createWorker({ mode, config: this.config, baseDir: this.baseDir }); }
      catch (error) { resolve(failed('error', error.message)); return; }
      activeScans.set(key, worker);
      let settled = false;
      let timer;
      const finish = result => {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(result);
      };
      // Termination cannot interrupt every blocked OS filesystem call. Do not
      // wait for it, or spawn another worker for this root until it has exited.
      const stop = () => { worker.unref(); worker.terminate().catch(() => {}); };
      timer = setTimeout(() => {
        const message = `${label} timed out after ${timeoutMs / 1000}s. Keeping ${previous.length} saved title(s). Check share availability and the server account's permissions.`;
        console.error(`[scanner] ${message}`);
        finish(failed('timeout', message)); stop();
      }, timeoutMs);
      worker.once('message', msg => {
        if (msg.ok) finish({ ok: true, items: msg.items, flatShowIds: msg.flatShowIds, chapterIndex: msg.chapterIndex });
        else {
          console.error(`[scanner] ${label}: ${msg.error}; keeping ${previous.length} saved title(s).`);
          finish(failed('error', msg.error));
        }
        stop();
      });
      worker.once('error', error => finish(failed('error', error.message)));
      worker.once('exit', code => {
        if (activeScans.get(key) === worker) activeScans.delete(key);
        finish(failed('error', `${label} worker exited before returning a complete scan (code ${code}).`));
      });
    });
  }

  async saveSnapshot() {
    if (!this.snapshotPath) return;
    const temporary = `${this.snapshotPath}.${process.pid}.tmp`;
    try {
      await fs.promises.mkdir(path.dirname(this.snapshotPath), { recursive: true });
      await fs.promises.writeFile(temporary, JSON.stringify({ version: 1,
        animeRoot: this.animeRoot, movieRoot: this.movieRoot, mangaRoot: this.mangaRoot,
        cache: this.cache, scanStatus: this.scanStatus,
        _flatShowIds: [...this._flatShowIds], _chapterIndex: this._chapterIndex }), { mode: 0o600 });
      await fs.promises.rename(temporary, this.snapshotPath);
    } catch (error) {
      console.error(`[scanner] Could not save local catalog snapshot: ${error.message}`);
      await fs.promises.unlink(temporary).catch(() => {});
    }
  }

  async scan() {
    // Default is intentionally generous - this was originally 25s, which
    // is comfortably enough in a fast test environment, but a large
    // real-world anime library (by far the biggest of the three folders
    // for most people) on real disk I/O - antivirus scanning every file
    // access, an HDD instead of an SSD, or just genuinely more titles -
    // can legitimately take longer than that. Configurable in Settings
    // for anyone whose library needs more room than even this.
    const SCAN_TIMEOUT_MS = (this.config.libraryScanTimeoutSec || 240) * 1000;
    // Each root scans in its own fully isolated worker thread with no
    // logical dependency on the others - but a real report showed both
    // anime and manga hitting the exact same timeout simultaneously when
    // scanned together, even though anime scans fine completely on its
    // own. That's a strong sign of genuine resource contention on that
    // machine (CPU/disk I/O) between the workers, even though they're
    // logically isolated - isolation at the JavaScript level doesn't
    // mean isolation from the underlying hardware they all still share.
    // Running them one at a time instead of all three simultaneously
    // removes any possibility of that entirely. Anime goes first, since
    // it's the largest/most important library for most people, so it
    // becomes available as quickly as possible without competing with
    // anything else for resources - each one's cache still updates the
    // moment its own scan finishes, so movies/manga are still available
    // as soon as they're each done, without waiting for one another.
    const timed = async (mode, label, previous) => {
      const t0 = Date.now();
      this.scanStatus[mode] = { ...this.scanStatus[mode], state: 'scanning', lastAttemptAt: t0 };
      const result = await this._scanRootInWorker(mode, SCAN_TIMEOUT_MS, label, previous);
      console.log(`[scanner] ${label} finished in ${((Date.now() - t0) / 1000).toFixed(1)}s (${result.items.length} title(s))`);
      this.scanStatus[mode] = { ...this.scanStatus[mode], state: result.ok ? 'ready' : result.state,
        message: result.message || null,
        lastSuccessAt: result.ok ? Date.now() : this.scanStatus[mode]?.lastSuccessAt || null };
      return result;
    };
    const animeResult = await timed('anime', 'Anime folder', this.cache.anime || []);
    this.cache.anime = animeResult.items;
    const moviesResult = await timed('movies', 'Movies folder', this.cache.movies || []);
    this.cache.movies = moviesResult.items;
    if (moviesResult.ok) this._flatShowIds = new Set(moviesResult.flatShowIds);
    const mangaResult = await timed('manga', 'Manga folder', this.cache.manga || []);
    this.cache.manga = mangaResult.items;
    if (mangaResult.chapterIndex) this._chapterIndex = mangaResult.chapterIndex;
    this.cache.scannedAt = Math.max(Date.now(), this.cache.scannedAt + 1);
    await this.saveSnapshot();
    return this.cache;
  }

  async _scanVideoRoot(root, assetFolder, defaultType, allowRootFiles) {
    const shows = [];
    let processedSinceYield = 0;
    for (const showName of listDirs(root)) {
      if (++processedSinceYield >= 5) { processedSinceYield = 0; await yieldToEventLoop(); }
      const showDir = path.join(root, showName);
      const info = safeReadJSON(path.join(showDir, 'info.json'), {});
      const cover = findFirstMatch(showDir, ['cover.jpg', 'cover.png', 'cover.webp']);
      const banner = findFirstMatch(showDir, ['banner.jpg', 'banner.png', 'banner.webp']);
      // Optional theme song - purely a local file, same as cover/banner.
      // Nothing is ever fetched or downloaded for this; if you want a
      // show to have one, you place an audio file in its folder
      // yourself, however you legitimately obtained it.
      const theme = findFirstMatch(showDir, ['theme.mp3', 'theme.m4a', 'theme.ogg', 'theme.wav']);

      // Sub-directories are treated as seasons/groups. Flat video files count as "Episodes".
      const subDirs = listDirs(showDir);
      const groups = [];

      if (subDirs.length > 0) {
        for (const groupName of subDirs) {
          const groupDir = path.join(showDir, groupName);
          const files = listFiles(groupDir, this.config.videoExtensions);
          if (files.length === 0) continue;
          groups.push({
            name: groupName,
            episodes: files.map((f, idx) => ({
              index: idx + 1,
              title: path.parse(f).name,
              file: f,
              relPath: path.join(showName, groupName, f),
            })),
          });
        }
      }
      // flat files directly in show root
      const flatFiles = listFiles(showDir, this.config.videoExtensions);
      if (flatFiles.length > 0) {
        groups.push({
          name: 'Episodes',
          episodes: flatFiles.map((f, idx) => ({
            index: idx + 1,
            title: path.parse(f).name,
            file: f,
            relPath: path.join(showName, f),
          })),
        });
      }

      const totalEpisodes = groups.reduce((sum, g) => sum + g.episodes.length, 0);
      if (totalEpisodes === 0) continue; // skip empty show folders

      // "Date added" for the NEW badge - birthtime (true creation time)
      // where the filesystem supports it, falling back to mtime on
      // filesystems/platforms that don't reliably report it.
      const dirStat = fs.statSync(showDir);
      const dateAdded = (dirStat.birthtimeMs && dirStat.birthtimeMs > 0 ? dirStat.birthtimeMs : dirStat.mtimeMs);

      shows.push({
        id: slugify(showName),
        title: info.title || showName,
        titles:info.titles||{},
        audioLanguages:Array.isArray(info.audioLanguages)?info.audioLanguages:[],
        subtitleLanguages:Array.isArray(info.subtitleLanguages)?info.subtitleLanguages:[],
        description: info.description || '',
        year: info.year || null,
        rating: info.rating || '16+',
        genres: info.genres || [],
        studios: info.studios || [],
        tagline: info.tagline || '',
        cover: withCacheBust(cover ? `/media-asset/${assetFolder}/${slugify(showName)}/${path.basename(cover)}` : null, cover),
        banner: withCacheBust(banner ? `/media-asset/${assetFolder}/${slugify(showName)}/${path.basename(banner)}` : null, banner),
        theme: withCacheBust(theme ? `/media-asset/${assetFolder}/${slugify(showName)}/${path.basename(theme)}` : null, theme),
        malId: info.malId || null,
        anilistId: info.anilistId || null,
        groups,
        episodeCount: totalEpisodes,
        type: info.type || defaultType,
        dateAdded: new Date(dateAdded).toISOString(),
        // Optional manual skip windows (seconds) shared by every episode in
        // this show, e.g. { "introStart": 0, "introEnd": 88, "outroStart": 1350 }.
        // Left unset, the player falls back to a generic heuristic instead.
        skipIntro: (info.introStart != null && info.introEnd != null) ? { start: info.introStart, end: info.introEnd } : null,
        skipOutro: (info.outroStart != null) ? { start: info.outroStart, end: info.outroEnd != null ? info.outroEnd : null } : null,
      });
    }

    // Movies (unlike series) are also allowed to sit directly as a single
    // video file with no wrapping folder at all - e.g.
    // media/movies/My Movie.mp4 - since a movie is inherently "one file",
    // requiring a folder just for that is unnecessary friction. There's
    // no cover/banner/info.json possible for these (nothing to attach
    // them to), but they'll still show up and play fine.
    if (allowRootFiles) {
      const rootFiles = listFiles(root, this.config.videoExtensions);
      for (const f of rootFiles) {
        const title = path.parse(f).name;
        const id = slugify(f);
        this._flatShowIds.add(id);
        const fileStat = fs.statSync(path.join(root, f));
        const dateAdded = (fileStat.birthtimeMs && fileStat.birthtimeMs > 0 ? fileStat.birthtimeMs : fileStat.mtimeMs);
        shows.push({
          id, // keyed by filename (incl. extension) so same-named folder + file never collide
          title,
          description: '',
          year: null,
          rating: '16+',
          genres: [],
          studios: [],
          tagline: '',
          cover: null,
          banner: null,
          groups: [{ name: 'Movie', episodes: [{ index: 1, title, file: f, relPath: f }] }],
          episodeCount: 1,
          type: defaultType,
          dateAdded: new Date(dateAdded).toISOString(),
          skipIntro: null,
          skipOutro: null,
        });
      }
    }
    return shows;
  }

  async _scanManga() {
    const titles = [];
    this._chapterIndex = {};
    const archiveExtensions = ['.cbz', '.epub', '.pdf'];

    let processedSinceYield = 0;
    for (const titleName of listDirs(this.mangaRoot)) {
      if (++processedSinceYield >= 5) { processedSinceYield = 0; await yieldToEventLoop(); }
      const titleDir = path.join(this.mangaRoot, titleName);
      const info = safeReadJSON(path.join(titleDir, 'info.json'), {});
      const cover = findFirstMatch(titleDir, ['cover.jpg', 'cover.png', 'cover.webp']);
      const mangaId = slugify(titleName);

      const chapters = [];
      const chapterTypes = {};

      // Folders of loose page images (the original, still-supported layout).
      for (const chapName of listDirs(titleDir)) {
        const chapDir = path.join(titleDir, chapName);
        const pages = listFiles(chapDir, this.config.imageExtensions);
        if (pages.length === 0) continue;
        chapters.push({ name: chapName, pageCount: pages.length, format: 'images' });
        chapterTypes[chapName] = { type: 'images', fullPath: chapDir };
      }

      // CBZ / EPUB / PDF files sitting directly in the title folder, each
      // one its own chapter named after the filename (extension stripped).
      const archiveFiles = fs.readdirSync(titleDir, { withFileTypes: true })
        .filter((d) => d.isFile() && archiveExtensions.includes(path.extname(d.name).toLowerCase()))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      // Modest concurrency instead of strictly one file at a time -
      // order doesn't matter here since chapters get sorted by name
      // right after this anyway, and overlapping I/O wait across
      // several files at once meaningfully reduces total scan time for
      // a large manga library, the same reasoning already used for
      // MAL/AniList enrichment elsewhere in this codebase.
      const ARCHIVE_CONCURRENCY = 2;
      let nextArchiveIdx = 0;
      async function archiveWorker() {
        while (nextArchiveIdx < archiveFiles.length) {
          const fileName = archiveFiles[nextArchiveIdx++];
          await yieldToEventLoop();
          const ext = path.extname(fileName).toLowerCase();
          const fullPath = path.join(titleDir, fileName);
          const chapName = path.parse(fileName).name;
          try {
            if (ext === '.cbz') {
              const entries = archive.listZipEntriesEfficiently(fullPath);
              const imageEntries = entries
                .filter((e) => !e.name.endsWith('/') && this.config.imageExtensions.includes(path.extname(e.name).toLowerCase()))
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
              if (imageEntries.length === 0) continue;
              chapters.push({ name: chapName, pageCount: imageEntries.length, format: 'cbz' });
              chapterTypes[chapName] = { type: 'cbz', fullPath };
            } else if (ext === '.epub') {
              const buf = fs.readFileSync(fullPath);
              let pages = [];
              try { pages = epub.resolvePageOrder(buf, this.config.imageExtensions); } catch (e) { pages = []; }
              if (pages.length === 0) {
                // Fall back to every image in the zip, naturally sorted, for
                // EPUBs whose OPF we couldn't parse.
                const entries = archive.readZipEntries(buf);
                pages = entries
                  .filter((e) => !e.name.endsWith('/') && this.config.imageExtensions.includes(path.extname(e.name).toLowerCase()))
                  .map((e) => e.name)
                  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
              }
              if (pages.length === 0) continue;
              chapters.push({ name: chapName, pageCount: pages.length, format: 'epub' });
              chapterTypes[chapName] = { type: 'epub', fullPath };
            } else if (ext === '.pdf') {
              const pageCount = await pdfLib.getPageCount(fullPath);
              if (!pageCount || pageCount < 1) continue;
              chapters.push({ name: chapName, pageCount, format: 'pdf', pdfSupported: pdfLib.HAS_PDFTOPPM });
              chapterTypes[chapName] = { type: 'pdf', fullPath };
            }
          } catch (e) {
            if (['ENOENT', 'EACCES', 'EPERM', 'EIO', 'ETIMEDOUT', 'ENOTCONN', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'].includes(e.code)) throw e;
            console.log(`[library] skipped unreadable chapter file "${fileName}" in "${titleName}": ${e.message}`);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(ARCHIVE_CONCURRENCY, archiveFiles.length) }, () => archiveWorker.call(this)));

      if (chapters.length === 0) continue;
      chapters.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      this._chapterIndex[mangaId] = chapterTypes;

      const titleDirStat = fs.statSync(titleDir);
      const dateAdded = (titleDirStat.birthtimeMs && titleDirStat.birthtimeMs > 0 ? titleDirStat.birthtimeMs : titleDirStat.mtimeMs);

      titles.push({
        id: mangaId,
        title: info.title || titleName,
        titles:info.titles||{},
        author:info.author||'',artist:info.artist||'',publisher:info.publisher||'',publicationStatus:info.publicationStatus||'',language:info.language||'',volumes:Array.isArray(info.volumes)?info.volumes:[],
        description: info.description || '',
        year: info.year || null,
        rating: info.rating || null,
        genres: info.genres || [],
        cover: withCacheBust(cover ? `/media-asset/manga/${mangaId}/${path.basename(cover)}` : null, cover),
        malId: info.malId || null,
        anilistId: info.anilistId || null,
        chapters,
        chapterCount: chapters.length,
        dateAdded: new Date(dateAdded).toISOString(),
      });
    }
    return titles;
  }

  getShow(id) {
    return this.cache.anime.find(s => s.id === id) || this.cache.movies.find(s => s.id === id) || null;
  }

  _rootForShow(id) {
    if (this.cache.anime.find(s => s.id === id)) return this.animeRoot;
    if (this.cache.movies.find(s => s.id === id)) return this.movieRoot;
    return null;
  }

  getShowDir(id) {
    if (this._flatShowIds && this._flatShowIds.has(id)) return null; // no folder to attach a cover/info.json to
    const root = this._rootForShow(id);
    if (!root) return null;
    return path.join(root, unslugify(id));
  }

  resolveEpisodeFile(showId, relEpisodePath) {
    const root = this._rootForShow(showId);
    if (!root) return null;
    const full = path.join(root, relEpisodePath);
    const resolved = path.resolve(full);
    if (!isWithin(root, resolved)) return null; // path traversal guard
    const show = this.getShow(showId);
    if (!show || !(show.groups || []).some(group => group.episodes.some(episode => path.resolve(root, episode.relPath) === resolved))) return null;
    return resolved;
  }

  getManga(id) {
    return this.cache.manga.find(m => m.id === id) || null;
  }

  getMangaDir(id) {
    const m = this.getManga(id);
    if (!m) return null;
    return path.join(this.mangaRoot, unslugify(id));
  }

  // Returns { type: 'images'|'cbz'|'epub'|'pdf', fullPath } for a chapter,
  // or null if unknown. Built during the scan in _scanManga.
  getChapterInfo(mangaId, chapterName) {
    const forTitle = this._chapterIndex && this._chapterIndex[mangaId];
    return (forTitle && forTitle[chapterName]) || null;
  }

  resolveMangaPage(mangaId, chapterName, pageFile) {
    const dir = this.getMangaDir(mangaId);
    if (!dir) return null;
    const full = path.resolve(path.join(dir, chapterName, pageFile));
    if (!isWithin(dir, full)) return null;
    return full;
  }
}

module.exports = { Library, slugify, unslugify };
