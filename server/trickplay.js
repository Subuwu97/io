// Trickplay: the little preview image that appears when hovering or
// scrubbing the seek bar. One sprite sheet per episode (a grid of tiny
// frames sampled every few seconds) plus the metadata the player needs
// to slice it - generated once per file via ffmpeg, cached forever
// (keyed by file mtime), built through the same concurrency limiter as
// transcodes so it can never crowd out live playback.
const { spawn } = require('child_process');
const fs = require('fs');
const mediaIO = require('./media-io');
const path = require('path');
const crypto = require('crypto');

const INTERVAL_SECONDS = 10; // one preview frame every 10s of video
const THUMB_WIDTH = 160;
const COLS = 10;

const inFlight = new Map(); // key -> Promise

function keyFor(filePath, mtimeMs) {
  return crypto.createHash('md5').update(`${filePath}|${mtimeMs}|trickplay`).digest('hex');
}

// Returns { spritePath, metaPath, key } - generating if needed.
// durationSeconds comes from the caller's (already cached) ffprobe data.
async function getOrBuild(trickplayDir, filePath, durationSeconds, acquireSlot, trackLive = (p) => p) {
  const stat = await mediaIO.stat(filePath);
  const key = keyFor(filePath, stat.mtimeMs);
  const spritePath = path.join(trickplayDir, `${key}.jpg`);
  const metaPath = path.join(trickplayDir, `${key}.json`);

  if (fs.existsSync(spritePath) && fs.existsSync(metaPath)) {
    return Promise.resolve({ spritePath, metaPath, key });
  }
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    const release = await acquireSlot();
    try {
      // Re-check after waiting for a slot - a parallel request may have
      // finished the build while this one was queued.
      if (fs.existsSync(spritePath) && fs.existsSync(metaPath)) return { spritePath, metaPath, key };

      fs.mkdirSync(trickplayDir, { recursive: true });
      const frameCount = Math.max(1, Math.ceil(durationSeconds / INTERVAL_SECONDS));
      const rows = Math.max(1, Math.ceil(frameCount / COLS));
      const tmpSprite = `${spritePath}.${process.pid}.tmp.jpg`;

      await new Promise((resolve, reject) => {
        // fps=1/N samples a frame every N seconds; tile packs them into
        // one grid image. -q:v 5 keeps the sheet small (these are tiny
        // thumbnails, quality barely matters).
        const proc = trackLive(spawn('ffmpeg', [
          '-y', '-i', filePath,
          '-vf', `fps=1/${INTERVAL_SECONDS},scale=${THUMB_WIDTH}:-2,tile=${COLS}x${rows}`,
          '-frames:v', '1', '-q:v', '5', tmpSprite,
        ]));
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d; });
        proc.on('close', (code) => (code === 0 && fs.existsSync(tmpSprite) ? resolve() : reject(new Error(stderr.slice(-200) || `ffmpeg exited ${code}`))));
        proc.on('error', reject);
      });

      // The player needs the per-thumb pixel height to slice the sheet;
      // read it back from the generated sprite via ffprobe-free math:
      // total sheet height / rows. Cheapest reliable way without adding
      // an image library: ffprobe the sprite itself.
      const sheetDims = await new Promise((resolve, reject) => {
        const proc = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', tmpSprite]);
        let out = '';
        proc.stdout.on('data', (d) => { out += d; });
        proc.on('close', (code) => {
          const [w, h] = out.trim().split(',').map(Number);
          return code === 0 && w && h ? resolve({ w, h }) : reject(new Error('sprite probe failed'));
        });
        proc.on('error', reject);
      });

      const meta = {
        interval: INTERVAL_SECONDS,
        cols: COLS,
        rows,
        count: frameCount,
        thumbWidth: Math.round(sheetDims.w / COLS),
        thumbHeight: Math.round(sheetDims.h / rows),
      };
      fs.writeFileSync(`${metaPath}.${process.pid}.tmp`, JSON.stringify(meta));
      fs.renameSync(`${metaPath}.${process.pid}.tmp`, metaPath);
      fs.renameSync(tmpSprite, spritePath);
      return { spritePath, metaPath, key };
    } finally {
      release();
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

module.exports = { getOrBuild };
