const fs = require('node:fs');
const { parentPort, workerData } = require('node:worker_threads');
try {
  let value;
  if (workerData.operation === 'stat') {
    const s = fs.statSync(workerData.file);
    value = { size: s.size, mtimeMs: s.mtimeMs, mtime: s.mtime, isFile: s.isFile(), isDirectory: s.isDirectory() };
  } else if (workerData.operation === 'realpath') value = fs.realpathSync(workerData.file);
  else if (workerData.operation === 'read') value = fs.readFileSync(workerData.file);
  else if (workerData.operation === 'readdir') value = fs.readdirSync(workerData.file);
  else if (workerData.operation === 'page') {
    const path = require('node:path');
    const archive = require('./archive');
    const mime = require('./mime');
    const { format, number, extensions, cacheRoot } = workerData;
    if (format === 'pdf') {
      const pdf = require('./pdf');
      if (!pdf.HAS_PDFTOPPM) throw new Error('PDF rendering requires poppler-utils');
      const hash = require('node:crypto').createHash('sha256').update(workerData.file + '|' + fs.statSync(workerData.file).mtimeMs).digest('hex');
      const cache = path.join(cacheRoot, hash); const file = path.join(cache, `page-${number}.png`);
      const result = fs.existsSync(file) ? file : pdf.renderPage(workerData.file, number, cache, `page-${number}`);
      if (result !== file) fs.renameSync(result, file);
      value = { data: fs.readFileSync(file), mime: 'image/png' };
    } else {
      if (fs.statSync(workerData.file).size > 256 * 1024 * 1024) throw new Error('Manga archive exceeds the 256 MiB page-rendering limit');
      const data = fs.readFileSync(workerData.file); const entries = archive.readZipEntries(data);
      let pages = format === 'epub' ? require('./epub').resolvePageOrder(data, extensions) : [];
      if (!pages.length) pages = entries.filter(entry => !entry.name.endsWith('/') && extensions.includes(path.extname(entry.name).toLowerCase())).map(entry => entry.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const name = pages[number - 1]; if (!name) throw Object.assign(new Error('Page not found'), { code: 'ENOENT' });
      value = { data: archive.extractEntryByName(data, entries, name), mime: mime.lookup(name) };
    }
  } else throw new Error('Unsupported media operation');
  parentPort.postMessage({ ok: true, value });
} catch (error) { parentPort.postMessage({ ok: false, message: error.message, code: error.code }); }
