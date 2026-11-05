const { Worker } = require('node:worker_threads');
const path = require('node:path');
const active = new Map();
const MAX_ACTIVE = 8;
const slots = require('./resource-queue').createQueue({ software: MAX_ACTIVE, maxQueue: 64, timeoutMs: 10000 });
function operation(type, file, timeoutMs = 10000, extra = {}) {
  const key = JSON.stringify([type, file, extra]);
  if (active.has(key)) return active.get(key).promise;
  if (type === 'page' && [...active.keys()].filter(key => key.startsWith('["page",')).length >= 2) return Promise.reject(Object.assign(new Error('Manga rendering is busy; retry shortly.'), { status: 503 }));
  if (active.size >= 72) return Promise.reject(Object.assign(new Error('Media storage is busy or unresponsive; retry shortly.'), { code: 'EBUSY', status: 503 }));
  const record = {};
  const promise = slots.acquireSlot().then(release => new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(path.join(__dirname, 'media-io-worker.js'), { workerData: { operation: type, file, ...extra } }); }
    catch (error) { release(); if (active.get(key) === record) active.delete(key); reject(error); return; }
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(type === 'read' ? Buffer.from(value) : value);
      worker.unref(); worker.terminate().catch(() => {});
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('Media storage timed out. Check the network share and retry.'), { code: 'ETIMEDOUT', status: 503 })), timeoutMs);
    worker.once('message', result => result.ok ? finish(null, result.value) : finish(Object.assign(new Error(result.message), { code: result.code, status: result.code === 'ENOENT' ? 404 : 503 })));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { release(); if (active.get(key) === record) active.delete(key); if (!settled) finish(new Error(`Media worker exited early (${code})`)); });
  }), error => { if (active.get(key) === record) active.delete(key); throw error; });
  record.promise = promise; active.set(key, record); return promise;
}
module.exports = { stat: file => operation('stat', file), realpath: file => operation('realpath', file), read: file => operation('read', file), readdir: file => operation('readdir', file), getStatus: () => ({ active: slots.getStatus().running, queued: slots.getStatus().queued, limit: MAX_ACTIVE }), operation };
