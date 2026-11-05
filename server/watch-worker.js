// Recursive fs.watch setup may block on an SMB/NFS mount. Keep all
// filesystem work off the HTTP thread, including the initial setup call.
const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');
try {
  const watcher = fs.watch(workerData.dir, { recursive: true }, (_event, filename) => {
    parentPort.postMessage({ filename: filename == null ? null : filename.toString() });
  });
  watcher.on('error', error => {
    parentPort.postMessage({ error: error.message });
    watcher.close();
  });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
