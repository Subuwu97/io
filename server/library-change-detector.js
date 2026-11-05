// Periodic "did anything change?" check for the media folders - the
// fallback for exactly the case a file watcher can't cover. On Linux,
// fs.watch (inotify) only reports changes made by THIS machine; when a
// library lives on a network share (SMB/NFS) and new media is copied
// onto it from another computer, the watcher never fires at all. Plex
// handles this with scheduled scans; this does the same job, but cheaply:
// a full scan of a large share can take close to a minute of I/O, far too
// heavy to run on a timer, so this only reads directory timestamps and
// entry counts a couple of levels deep and triggers a real rescan only
// when something actually differs.
//
// Everything here is async with bounded concurrency on purpose - a
// synchronous walk over a slow network share would block the whole
// Node.js event loop (the same failure mode the synchronous fs.watch
// setup once caused), so requests keep being served while it runs.

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const UNREACHABLE = 'unreachable';
const DEFAULT_TIMEOUT_MS = 120 * 1000;
let activeCheck = null;
function computeSignature(roots, { timeoutMs = DEFAULT_TIMEOUT_MS, workerFactory = data => new Worker(path.join(__dirname, 'change-check-worker.js'), { workerData: data }) } = {}) {
  if (activeCheck) return Promise.resolve(null);
  return new Promise(resolve => {
    let worker;
    try { worker = workerFactory({ roots }); } catch { resolve(null); return; }
    activeCheck = worker; let settled = false;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); worker.unref(); worker.terminate().catch(() => {}); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    worker.once('message', finish); worker.once('error', () => finish(null));
    worker.once('exit', () => { if (activeCheck === worker) activeCheck = null; finish(null); });
  });
}

function createChangePoller({ getRoots, getIntervalMs, isBusy = () => false, onChange, log = () => {}, timeoutMs }) {
  let baseline = null;
  let timer = null;
  let inFlight = false;
  let stopped = true;

  // Called right before each real scan starts, not after - anything
  // that lands while the scan is running then shows up as a difference
  // on the next check and triggers one more scan, instead of being
  // silently absorbed into a baseline taken after the scan had
  // already looked at that folder.
  async function captureBaseline() {
    try {
      const sig = await computeSignature(getRoots(), { timeoutMs });
      if (sig) baseline = sig;
    } catch (e) { log(`couldn't capture baseline: ${e.message}`); }
  }

  async function check() {
    if (inFlight || isBusy()) return;
    inFlight = true;
    try {
      const sig = await computeSignature(getRoots(), { timeoutMs });
      if (!sig) { log('change check took too long - skipping this round'); return; }
      if (!baseline) { baseline = sig; return; }
      const changed = [];
      const recovered = [];
      for (const [label, hash] of Object.entries(sig)) {
        const prev = baseline[label];
        if (prev === undefined || prev === hash) continue;
        // A folder becoming unreachable (share dropped) must not
        // trigger a rescan - that would only treat it as empty. Coming
        // back from unreachable should, since the library was being
        // treated as empty while it was gone.
        if (hash === UNREACHABLE) continue;
        changed.push(label);
        if (prev === UNREACHABLE) recovered.push(label);
      }
      baseline = sig;
      if (changed.length) onChange(changed, recovered);
    } catch (e) {
      log(`change check failed: ${e.message}`);
    } finally {
      inFlight = false;
    }
  }

  function schedule() {
    if (stopped) return;
    const ms = getIntervalMs();
    // Interval is re-read every round so a settings change takes effect
    // without a restart; 0 means off, checked again in a minute in case
    // it gets switched back on.
    timer = setTimeout(async () => {
      if (getIntervalMs() > 0) await check();
      schedule();
    }, ms > 0 ? ms : 60 * 1000);
    if (timer.unref) timer.unref();
  }

  return {
    captureBaseline,
    check,
    start() { if (!stopped) return; stopped = false; schedule(); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}

module.exports = { computeSignature, createChangePoller, UNREACHABLE };
