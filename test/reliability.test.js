const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createQueue } = require('../server/resource-queue');
const { isWithin } = require('../server/path-safety');
test('directory containment rejects sibling prefixes, parent traversal and other roots', () => {
  const root = path.resolve('library', 'show');
  assert.equal(isWithin(root, path.join(root, 'season', 'episode.mp4')), true);
  assert.equal(isWithin(root, root + '-private/secret.key'), false);
  assert.equal(isWithin(root, path.resolve(root, '..', 'secret.key')), false);
  assert.equal(isWithin(root, root), true);
});
test('transcode queue enforces capacity, cancels waiters, times out, and releases once', async () => {
  const queue = createQueue({ software: 1, maxQueue: 1, timeoutMs: 1000 });
  const release = await queue.acquireSlot();
  const controller = new AbortController();
  const waiting = queue.acquireSlot({ signal: controller.signal });
  await assert.rejects(queue.acquireSlot(), { code: 'QUEUE_FULL' });
  controller.abort(); await assert.rejects(waiting, { code: 'ABORT_ERR' });
  await assert.rejects(queue.acquireSlot({ timeoutMs: 20 }), { code: 'QUEUE_TIMEOUT' });
  release(); release(); assert.equal(queue.getStatus().running, 0);
  const next = await queue.acquireSlot(); next();
  queue.configure({ hardware: 2 }); queue.setHardwareAccelActive(true);
  assert.equal(queue.getStatus().maxConcurrent, 2);
  assert.throws(() => queue.configure({ software: 999 }));
});
test('playback summaries reject invalid values and expose measured aggregates only', () => {
  const metrics = require('../server/playback-metrics');
  assert.throws(() => metrics.record('test', { id: 'bad' }));
  const value = { id: 'a'.repeat(32), startupMs: 1200, stallCount: 2, stallMs: 500, droppedFrames: 3, totalFrames: 100, errorCount: 0, mode: 'hls' };
  metrics.record('test', value); metrics.record('test', value);
  assert.equal(metrics.summary().samples, 1); assert.equal(metrics.summary().medianStartupMs, 1200);
  assert.equal(metrics.summary().stalls, 2);
  assert.throws(() => metrics.record('test', { ...value, id: 'b'.repeat(32), startupMs: -1 }));
});
