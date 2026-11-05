// Real per-episode thumbnails for episode lists - a single frame pulled
// from ~20% into each episode (past the intro/recap, into actual
// content), instead of repeating the series banner on every row like a
// placeholder. Extracted once per file via a fast input-side seek
// (sub-second even on big files), cached forever keyed by file mtime,
// and run through the shared concurrency limiter so a detail page full
// of episodes can't burst-spawn a pile of ffmpeg processes at once.
const { spawn } = require('child_process');
const fs = require('fs');
const mediaIO = require('./media-io');
const path = require('path');
const crypto = require('crypto');

const THUMB_WIDTH = 320;
const inFlight = new Map();

async function getOrExtract(thumbsDir, filePath, durationSeconds, acquireSlot, trackLive = (p) => p) {
  const stat = await mediaIO.stat(filePath);
  const key = crypto.createHash('md5').update(`${filePath}|${stat.mtimeMs}|epthumb`).digest('hex');
  const thumbPath = path.join(thumbsDir, `${key}.jpg`);
  if (fs.existsSync(thumbPath)) return Promise.resolve(thumbPath);
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    const release = await acquireSlot();
    try {
      if (fs.existsSync(thumbPath)) return thumbPath; // built while queued
      fs.mkdirSync(thumbsDir, { recursive: true });
      // 20% in, clamped to something sane when duration is unknown/short.
      const t = durationSeconds ? Math.max(5, Math.min(durationSeconds * 0.2, durationSeconds - 1)) : 30;
      const tmpPath = `${thumbPath}.${process.pid}.tmp.jpg`;
      await new Promise((resolve, reject) => {
        const proc = trackLive(spawn('ffmpeg', [
          '-y', '-ss', String(t), '-i', filePath,
          '-frames:v', '1', '-vf', `scale=${THUMB_WIDTH}:-2`, '-q:v', '4', tmpPath,
        ]));
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d; });
        proc.on('close', (code) => (code === 0 && fs.existsSync(tmpPath) ? resolve() : reject(new Error(stderr.slice(-200) || `ffmpeg exited ${code}`))));
        proc.on('error', reject);
      });
      fs.renameSync(tmpPath, thumbPath);
      return thumbPath;
    } finally {
      release();
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

module.exports = { getOrExtract };
