const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');
function directory(entry, full) { return entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory()); }
const result = {};
for (const { label, dir } of workerData.roots) {
  try {
    const root = fs.statSync(dir), entries = fs.readdirSync(dir, { withFileTypes: true });
    const lines = [`.|${root.mtimeMs}|${entries.length}`];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      try {
        if (!directory(entry, full)) { lines.push(`f:${entry.name}`); continue; }
        const stat = fs.statSync(full), kids = fs.readdirSync(full, { withFileTypes: true });
        lines.push(`d:${entry.name}|${stat.mtimeMs}|${kids.length}`);
        for (const kid of kids) {
          const child = path.join(full, kid.name);
          try { lines.push(directory(kid, child) ? `s:${entry.name}/${kid.name}|${fs.statSync(child).mtimeMs}` : `f:${entry.name}/${kid.name}`); }
          catch { lines.push(`s:${entry.name}/${kid.name}|err`); }
        }
      } catch { lines.push(`d:${entry.name}|err`); }
    }
    result[label] = crypto.createHash('sha1').update(lines.sort().join('\n')).digest('hex');
  } catch { result[label] = 'unreachable'; }
}
parentPort.postMessage(result);
