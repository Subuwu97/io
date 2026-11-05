const sessions = new Map();
const lastReport = new Map();
const accountRates = new Map();
function record(accountId, input) {
  if (!input || typeof input.id !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(input.id)) throw new Error('Invalid playback measurement ID');
  const now = Date.now(); const key = accountId + ':' + input.id;
  if (now - (lastReport.get(key) || 0) < 4000) return;
  const rate = accountRates.get(accountId) || { start: now, count: 0 };
  if (now - rate.start >= 60000) { rate.start = now; rate.count = 0; }
  if (++rate.count > 120) throw Object.assign(new Error('Too many playback reports'), { status: 429 });
  accountRates.set(accountId, rate);
  for (const [id, value] of accountRates) if (now - value.start > 60000) accountRates.delete(id);
  while (accountRates.size > 500) accountRates.delete(accountRates.keys().next().value);
  const value = { updatedAt: now, mode: ['hls', 'direct'].includes(input.mode) ? input.mode : 'unknown' };
  for (const name of ['startupMs', 'stallCount', 'stallMs', 'droppedFrames', 'totalFrames', 'errorCount']) {
    const n = input[name]; if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e9) throw new Error('Invalid playback measurement'); value[name] = n;
  }
  sessions.set(key, value); lastReport.set(key, now);
  for (const [id, session] of sessions) if (now - session.updatedAt > 30 * 60 * 1000) { sessions.delete(id); lastReport.delete(id); }
  while (sessions.size > 500) { const id = sessions.keys().next().value; sessions.delete(id); lastReport.delete(id); }
}
function summary() {
  const values = [...sessions.values()].filter(item => Date.now() - item.updatedAt < 30 * 60 * 1000);
  const starts = values.filter(value => value.startupMs > 0).map(value => value.startupMs).sort((a, b) => a - b);
  return { samples: values.length, medianStartupMs: starts.length ? starts[Math.floor(starts.length / 2)] : null,
    p95StartupMs: starts.length ? starts[Math.min(starts.length - 1, Math.ceil(starts.length * .95) - 1)] : null,
    stalls: values.reduce((sum, value) => sum + value.stallCount, 0), stallMs: values.reduce((sum, value) => sum + value.stallMs, 0),
    errors: values.reduce((sum, value) => sum + value.errorCount, 0), droppedFrames: values.reduce((sum, value) => sum + value.droppedFrames, 0), windowMinutes: 30 };
}
module.exports = { record, summary };
