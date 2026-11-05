const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const mediaIO = require('./media-io');
const pending = new Map();
function createAssService({ directory, probe, trackLive }) {
  const probes = new Map();
  const lyrics = new Map();
  const extractionQueue = require('./resource-queue').createQueue({ software: 2, maxQueue: 16, timeoutMs: 30000 });
  async function extract(file, index, font = false) {
    const stat = await mediaIO.stat(file);
    const key = crypto.createHash('sha256').update(`${file}|${stat.mtimeMs}|${index}|${font}`).digest('hex');
    const destination = path.join(directory, `${key}.${font ? 'font' : 'ass'}`);
    try { return await fs.readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (pending.has(key)) return pending.get(key);
    const job = extractionQueue.acquireSlot().then(release => new Promise((resolve, reject) => {
      const args = font
        ? ['-v', 'error', '-nostdin', `-dump_attachment:${index}`, 'pipe:1', '-i', file, '-t', '0', '-f', 'null', '-']
        : ['-v', 'error', '-nostdin', '-i', file, '-map', `0:${index}`, '-c:s', 'copy', '-f', 'ass', 'pipe:1'];
      let proc;
      try { proc = trackLive(spawn('ffmpeg', args, { windowsHide: true })); } catch (error) { release(); reject(error); return; }
      proc.once('close', release); proc.once('error', release);
      const chunks = []; let length = 0, settled = false;
      const finish = (error, data) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (error) { proc.kill(); reject(error); } else resolve(data);
      };
      const timer = setTimeout(() => finish(Object.assign(new Error('Subtitle/font extraction timed out'), { status: 503 })), 45000);
      proc.stdout.on('data', data => { length += data.length; if (length > (font ? 8 : 32) * 1024 * 1024) finish(new Error('Subtitle/font exceeds the size limit')); else chunks.push(data); });
      proc.stderr.on('data', () => {});
      proc.once('error', finish);
      proc.once('close', code => {
        const data = Buffer.concat(chunks);
        if (code !== 0 || !data.length) finish(new Error('Could not extract the original subtitle/font'));
        else finish(null, data);
      });
    })).then(async data => {
      await fs.mkdir(directory, { recursive: true });
      const temporary = `${destination}.${process.pid}.tmp`;
      await fs.writeFile(temporary, data); await fs.rename(temporary, destination); return data;
    }).finally(() => pending.delete(key));
    pending.set(key, job); return job;
  }
  async function manifest(file, trackIndex) {
    const stat = await mediaIO.stat(file); const key = file + '|' + stat.mtimeMs;
    if (!probes.has(key)) {
      if (probes.size >= 100) probes.delete(probes.keys().next().value);
      probes.set(key, probe(file).catch(error => { probes.delete(key); throw error; }));
    }
    const raw = await probes.get(key);
    const track = raw.streams?.find(stream => stream.index === trackIndex && stream.codec_type === 'subtitle');
    if (!track || !['ass', 'ssa'].includes(track.codec_name)) throw Object.assign(new Error('This track is not an ASS/SSA subtitle track'), { status: 422 });
    const fonts = (raw.streams || []).filter(stream => stream.codec_type === 'attachment' &&
      (/\.(ttf|otf|woff2?)$/i.test(stream.tags?.filename || '') || ['ttf', 'otf'].includes(stream.codec_name)) &&
      (!stream.extradata_size || stream.extradata_size <= 8 * 1024 * 1024)).slice(0, 16).map(stream => stream.index);
    const lyricKey = key + '|' + trackIndex;
    if (!lyrics.has(lyricKey)) {
      if (lyrics.size >= 100) lyrics.delete(lyrics.keys().next().value);
      lyrics.set(lyricKey, extract(file, trackIndex).then(data => require('./ass-lyrics').lyricWindows(data.toString('utf8'))).catch(error => { lyrics.delete(lyricKey); throw error; }));
    }
    return { codec: track.codec_name, fonts, lyrics: await lyrics.get(lyricKey) };
  }
  return { extract, manifest };
}
module.exports = { createAssService };
