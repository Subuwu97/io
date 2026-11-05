const fs = require('node:fs');
const { parentPort, workerData } = require('node:worker_threads');
let fd, position = workerData.start;
function close() { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} fd = undefined; } }
function next() {
  try {
    if (position > workerData.end) { close(); parentPort.postMessage({ end: true }); parentPort.close(); return; }
    const buffer = Buffer.allocUnsafeSlow(Math.min(65536, workerData.end - position + 1));
    const count = fs.readSync(fd, buffer, 0, buffer.length, position);
    if (!count) { close(); parentPort.postMessage({ end: true }); parentPort.close(); return; }
    position += count; parentPort.postMessage({ data: buffer.subarray(0, count) }, [buffer.buffer]);
  } catch (error) { close(); parentPort.postMessage({ error: error.message }); parentPort.close(); }
}
try { fd = fs.openSync(workerData.file, 'r'); parentPort.on('message', next); next(); }
catch (error) { parentPort.postMessage({ error: error.message }); parentPort.close(); }
