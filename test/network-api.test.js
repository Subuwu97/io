const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('HTTP remains available, rescans queue immediately, and an offline catalog survives a server restart', { timeout: 60000 }, async t => {
  const testRoot = process.env.IO_TEST_ROOT || os.tmpdir();
  fs.mkdirSync(testRoot, { recursive: true });
  const state = fs.mkdtempSync(path.join(testRoot, 'io-api-tests-'));
  const mediaPaths = Object.fromEntries(['anime', 'movies', 'manga'].map(kind => [kind, path.join(state, kind)]));
  for (const root of Object.values(mediaPaths)) fs.mkdirSync(root);
  fs.mkdirSync(path.join(mediaPaths.anime, 'Show'));
  fs.writeFileSync(path.join(mediaPaths.anime, 'Show', '01.mp4'), 'fixture');
  const { spawnSync, execFileSync } = require('node:child_process');
  const hasFFmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0;
  if (hasFFmpeg) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=1', '-c:v', 'libx264', path.join(mediaPaths.anime, 'Show', '01.mp4')], { timeout: 10000, windowsHide: true });
  const config = { ...JSON.parse(fs.readFileSync(path.join(__dirname, '../config.default.json'), 'utf8')),
    mediaPaths, autoScanIntervalMinutes: 0, hardwareAcceleration: false, libraryScanTimeoutSec: 1 };
  fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify(config));
  const portFinder = net.createServer();
  await new Promise(resolve => portFinder.listen(0, '127.0.0.1', resolve));
  const port = portFinder.address().port;
  await new Promise(resolve => portFinder.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child, output = '', cookie = '';
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exited;
  }
  t.after(stop);
  async function start() {
    child = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, IO_DATA_DIR: state, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const deadline = Date.now() + 15000;
    for (; Date.now() < deadline;) {
      if (child.exitCode !== null) throw new Error(output);
      try { if ((await fetch(base + '/api/auth/status', { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
      await delay(50);
    }
    throw new Error('HTTP did not start: ' + output);
  }
  async function status() {
    const result = await fetch(base + '/api/admin/library-status', { headers: { Cookie: cookie } });
    assert.equal(result.status, 200); return result.json();
  }
  async function waitForScan() {
    for (let tries = 0; tries < 100; tries++) {
      const result = await status(); if (!result.scanning) return result; await delay(50);
    }
    throw new Error('Scan did not finish: ' + output);
  }
  await start();
  const readiness=await fetch(base+'/healthz');assert.equal(readiness.status,200);assert.deepEqual(await readiness.json(),{status:'ok'});
  const registration = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'networktest', password: 'Disposable-Test-12345' }) });
  assert.ok(registration.ok, await registration.text());
  cookie = registration.headers.get('set-cookie').split(';')[0];
  assert.equal((await waitForScan()).animeCount, 1);
  assert.equal((await fetch(base + '/api/admin/health')).status, 401);
  const health = await (await fetch(base + '/api/admin/health', { headers: { Cookie: cookie } })).json();
  assert.equal(health.drives.length, 3); assert.equal(health.transcode.software, 2);
  assert.equal(typeof health.gpu.available, 'boolean'); assert.equal(health.playback.samples, 0);
  assert.equal((await fetch(base + '/vendor/hls.min.js')).status, 200);
  assert.equal((await fetch(base + '/vendor/jassub/wasm/jassub-worker.wasm')).status, 200);
  const measurement = { id: 'd'.repeat(32), startupMs: 1400, stallCount: 1, stallMs: 200, droppedFrames: 2, totalFrames: 100, errorCount: 0, mode: 'direct' };
  const report = await fetch(base + '/api/playback/metrics', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(measurement) });
  assert.equal(report.status, 200);
  const measured = await (await fetch(base + '/api/admin/health', { headers: { Cookie: cookie } })).json();
  assert.equal(measured.playback.samples, 1); assert.equal(measured.playback.medianStartupMs, 1400);
  const badLimits = await fetch(base + '/api/config', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ transcodeLimits: { software: 999 } }) });
  assert.equal(badLimits.status, 400);
  const limits = await fetch(base + '/api/config', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ transcodeLimits: { software: 1, hardware: 2, maxQueue: 3, timeoutMs: 1000 } }) });
  assert.equal(limits.status, 200);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'networktest', password: 'Disposable-Test-12345' }) });
  assert.equal(login.status, 200); assert.equal((await login.json()).account.username, 'networktest');
  const traversal = await fetch(base + '/media-asset/anime/' + Buffer.from('Show').toString('base64url') + '/..%2fShow-private%2fsecret.key', { headers: { Cookie: cookie } });
  assert.equal(traversal.status, 400);
  if (hasFFmpeg) {
    const stream = base + '/api/stream/' + Buffer.from('Show').toString('base64url') + '/Show/01.mp4';
    const ranged = await fetch(stream, { headers: { Cookie: cookie, Range: 'bytes=0-31' } });
    assert.equal(ranged.status, 206);
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), fs.readFileSync(path.join(mediaPaths.anime, 'Show', '01.mp4')).subarray(0, 32));
    assert.equal((await fetch(stream, { headers: { Cookie: cookie, Range: 'bytes=999999999999-' } })).status, 416);
  }
  fs.renameSync(mediaPaths.anime, mediaPaths.anime + '-offline');
  const started = Date.now();
  const queued = await fetch(base + '/api/rescan', { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(queued.status, 202);
  assert.equal((await queued.json()).scanning, true);
  assert.ok(Date.now() - started < 1000, 'Rescan request waited on filesystem work');
  const failed = await waitForScan();
  assert.equal(failed.animeCount, 1); assert.equal(failed.roots.anime.state, 'error');
  assert.equal((await fetch(base + '/api/auth/status')).status, 200);
  await stop(); await start();
  assert.equal((await status()).animeCount, 1, 'Startup failed to restore local catalog');
  assert.equal((await waitForScan()).animeCount, 1);
});
