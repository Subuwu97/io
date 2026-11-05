const { execFile } = require('node:child_process');
let current = { available: false, sampledAt: null, devices: [], note: 'GPU utilization has not been sampled.' };
let polling = false;
function start() {
  if (polling) return; polling = true;
  async function sample() {
    execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits'],
      { timeout: 2000, maxBuffer: 16384, windowsHide: true }, (error, stdout) => {
        if (error) current = { available: false, sampledAt: Date.now(), devices: [], note: 'Live GPU utilization unavailable. This does not mean hardware encoding is unavailable (Intel/AMD and some drivers do not expose nvidia-smi).' };
        else {
          const devices = stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
            const parts = line.split(',').map(value => value.trim()); const [load, used, total, temperature] = parts.splice(-4).map(Number);
            return { name: parts.join(', '), utilizationPercent: Number.isFinite(load) ? load : null, usedMiB: Number.isFinite(used) ? used : null, totalMiB: Number.isFinite(total) ? total : null, temperatureC: Number.isFinite(temperature) ? temperature : null };
          });
          current = { available: true, sampledAt: Date.now(), devices, note: null };
        }
      });
  }
  sample(); setInterval(sample, 10000).unref();
}
module.exports = { start, getStatus: () => current };
