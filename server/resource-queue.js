function createQueue(initial = {}) {
  let hardware = false;
  let limits = { software: 2, hardware: 3, maxQueue: 12, timeoutMs: 30000, ...initial };
  let running = 0;
  const queue = [];
  const maximum = () => hardware ? limits.hardware : limits.software;
  const error = (message, code) => Object.assign(new Error(message), { code, status: 503 });
  function configure(input = {}) {
    const next = { ...limits };
    for (const [name, max] of [['software', 16], ['hardware', 32], ['maxQueue', 100], ['timeoutMs', 120000]]) {
      if (input[name] === undefined) continue;
      const value = Number(input[name]);
      if (!Number.isInteger(value) || value < (name === 'timeoutMs' ? 100 : 1) || value > max) throw new Error(`Invalid transcode limit: ${name}`);
      next[name] = value;
    }
    limits = next; runNext();
  }
  function runNext() {
    while (running < maximum() && queue.length) {
      const item = queue.shift(); item.cleanup(); running++;
      let released = false;
      item.resolve(() => { if (released) return; released = true; running--; runNext(); });
    }
  }
  function acquireSlot({ signal, timeoutMs = limits.timeoutMs } = {}) {
    if (signal?.aborted) return Promise.reject(error('Playback request was cancelled.', 'ABORT_ERR'));
    if (queue.length >= limits.maxQueue) return Promise.reject(error('Transcode queue is full. Retry shortly.', 'QUEUE_FULL'));
    return new Promise((resolve, reject) => {
      const item = { resolve };
      const remove = reason => { const at = queue.indexOf(item); if (at < 0) return; queue.splice(at, 1); item.cleanup(); reject(reason); };
      const cancel = () => remove(error('Playback request was cancelled.', 'ABORT_ERR'));
      const timer = setTimeout(() => remove(error('Timed out waiting for a transcoder. Retry shortly.', 'QUEUE_TIMEOUT')), timeoutMs);
      item.cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
      signal?.addEventListener('abort', cancel, { once: true }); queue.push(item); runNext();
    });
  }
  function setHardwareAccelActive(value) { hardware = !!value; runNext(); }
  function getStatus() { return { running, queued: queue.length, maxConcurrent: maximum(), hardwareAcceleration: hardware, ...limits }; }
  return { acquireSlot, configure, getStatus, setHardwareAccelActive };
}
module.exports = { createQueue };
