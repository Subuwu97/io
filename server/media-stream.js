const { Worker } = require('node:worker_threads');
const path = require('node:path');
const active = new Set();
function pipeFile(file, start, end, res) {
  if (active.size >= 24) throw Object.assign(new Error('Media streaming capacity is busy; retry shortly'), { status: 503 });
  const worker = new Worker(path.join(__dirname, 'media-stream-worker.js'), { workerData: { file, start, end } });
  active.add(worker); let lastData = Date.now();
  const stop = () => { worker.unref(); worker.terminate().catch(() => {}); };
  const fail = () => {
    if (!res.destroyed) {
      if (res.headersSent) res.destroy();
      else { res.removeHeader('Content-Length'); res.removeHeader('Content-Range'); res.status(503).json({ error: 'Media storage could not be read. Retry when the share is online.' }); }
    }
    stop();
  };
  const timer = setInterval(() => { if (Date.now() - lastData > 30000) fail(); }, 5000); timer.unref();
  worker.on('message', message => {
    if (res.destroyed) { stop(); return; }
    if (message.error) { fail(); return; }
    if (message.end) { res.end(); return; }
    lastData = Date.now();
    const next = () => { if (!res.destroyed) worker.postMessage('next'); };
    if (res.write(Buffer.from(message.data))) next(); else res.once('drain', next);
  });
  worker.once('error', fail);
  worker.once('exit', () => { clearInterval(timer); active.delete(worker); });
  res.once('close', () => { clearInterval(timer); stop(); });
}
module.exports = { pipeFile, getStatus: () => ({ active: active.size, limit: 24 }) };
