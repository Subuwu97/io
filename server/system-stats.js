// Live CPU/RAM stats for the admin dashboard. CPU usage isn't something
// Node exposes directly (unlike memory) - it has to be computed from two
// snapshots of cumulative CPU time take a moment apart. Rather than
// stalling an HTTP request while that sampling happens, a background
// timer keeps a rolling snapshot updated every couple of seconds, so the
// API route can just return whatever was last computed - instantly.
const os = require('os');

let lastCpuSample = os.cpus();
let lastProcessCpuUsage = process.cpuUsage();
let lastProcessSampleTime = Date.now();

let current = {
  cpuPercent: 0,       // whole-system CPU usage across all cores, 0-100
  processCpuPercent: 0, // this Node process's own CPU usage (can exceed 100 on a multi-core box if it's using more than one core)
  totalMemBytes: os.totalmem(),
  freeMemBytes: os.freemem(),
  usedMemBytes: os.totalmem() - os.freemem(),
  processMemBytes: process.memoryUsage().rss,
  cpuCount: os.cpus().length,
  cpuModel: (os.cpus()[0] && os.cpus()[0].model) || 'Unknown CPU',
  uptimeSeconds: os.uptime(),
};

function sample() {
  const newCpuSample = os.cpus();
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < newCpuSample.length; i++) {
    const prev = lastCpuSample[i] ? lastCpuSample[i].times : null;
    const next = newCpuSample[i].times;
    if (!prev) continue;
    const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
    const nextTotal = next.user + next.nice + next.sys + next.idle + next.irq;
    idleDelta += next.idle - prev.idle;
    totalDelta += nextTotal - prevTotal;
  }
  const cpuPercent = totalDelta > 0 ? Math.max(0, Math.min(100, 100 - (idleDelta / totalDelta) * 100)) : 0;
  lastCpuSample = newCpuSample;

  const now = Date.now();
  const newProcessCpuUsage = process.cpuUsage();
  const elapsedMs = now - lastProcessSampleTime;
  const processCpuMicros = (newProcessCpuUsage.user - lastProcessCpuUsage.user) + (newProcessCpuUsage.system - lastProcessCpuUsage.system);
  const processCpuPercent = elapsedMs > 0 ? Math.max(0, (processCpuMicros / 1000 / elapsedMs) * 100) : 0;
  lastProcessCpuUsage = newProcessCpuUsage;
  lastProcessSampleTime = now;

  current = {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    processCpuPercent: Math.round(processCpuPercent * 10) / 10,
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    usedMemBytes: os.totalmem() - os.freemem(),
    processMemBytes: process.memoryUsage().rss,
    cpuCount: os.cpus().length,
    cpuModel: (os.cpus()[0] && os.cpus()[0].model) || 'Unknown CPU',
    uptimeSeconds: os.uptime(),
  };
}

let started = false;
function start() {
  if (started) return;
  started = true;
  sample(); // first real sample shortly after startup
  setInterval(sample, 2000).unref(); // unref so this timer never keeps the process alive on its own
}

function getStats() {
  return current;
}

module.exports = { start, getStats };
