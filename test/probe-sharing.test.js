const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
test('concurrent consumers share one probe and failures remain retryable', async t => {
  const child = require('node:child_process');
  let calls = 0, fail = false;
  t.mock.method(child, 'spawn', () => {
    calls++;
    const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = () => {};
    setImmediate(() => { proc.stdout.emit('data', '{"streams":[]}'); proc.emit('close', fail ? 1 : 0); });
    return proc;
  });
  const ffm = require('../server/ffmpeg');
  const [a, b] = await Promise.all([ffm.probe('same.mkv'), ffm.probe('same.mkv')]);
  assert.equal(calls, 1); assert.strictEqual(a, b);
  await ffm.probe('same.mkv'); assert.equal(calls, 2);
  fail = true;
  await assert.rejects(ffm.probe('same.mkv'));
  fail = false;
  await ffm.probe('same.mkv'); assert.equal(calls, 4);
});
