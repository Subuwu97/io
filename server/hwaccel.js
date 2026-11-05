// Detects whether the server's FFmpeg install can actually use hardware
// video encoding (Intel Quick Sync, NVIDIA NVENC, AMD AMF, or VAAPI more
// generally on Linux) instead of pure software encoding (libx264).
//
// Hardware encoding is much faster and uses a small fraction of the CPU
// compared to software x264 - this matters a lot for a self-hosted media
// server doing on-the-fly audio/codec fixes or quality downscaling,
// especially on modest hardware (NUCs, NAS boxes) or when multiple
// people are streaming different files at once.
//
// Detection does a real tiny test encode rather than just checking
// whether the encoder name exists in `ffmpeg -encoders` - the encoder
// can be compiled in without the actual hardware/drivers being present
// (exactly the situation in a cloud/VM environment with no GPU passed
// through), so only a real successful encode counts as "available".
const { spawnSync } = require('child_process');
const fs = require('fs');

function testEncode(args) {
  try {
    const testArgs = [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1',
      ...args,
      '-frames:v', '5', '-f', 'null', '-',
    ];
    // LIBVA_MESSAGING_LEVEL isn't guaranteed to already be set to
    // something verbose in whatever environment this server happens to
    // run in - without it, even a genuine driver-level failure can
    // produce zero libva-prefixed diagnostic output at all, hiding the
    // one thing most likely to actually explain a VAAPI problem, as
    // confirmed directly against a real machine's own log.
    const r = spawnSync('ffmpeg', testArgs, { timeout: 8000, env: { ...process.env, LIBVA_MESSAGING_LEVEL: '2' } });
    if (!r.error && r.status === 0) return { ok: true };
    // The tail end of ffmpeg's own stderr is where the actual, specific
    // reason lives (driver missing, permission denied, no such device,
    // encoder not compiled in, etc.) - the exit code alone never says
    // which of those it actually was.
    const allLines = r.stderr ? r.stderr.toString('utf-8').trim().split('\n') : [];
    // libva's own lines (its driver load attempt, printed by the VAAPI
    // library itself, not ffmpeg) are usually the actual, specific
    // explanation for a VAAPI failure - a missing driver package versus
    // a permissions issue look identical from ffmpeg's own final error
    // alone, but very different in libva's own message. Surfaced ahead
    // of the generic tail-of-output fallback whenever present, since
    // real-world testing showed the last-3-lines-only capture could cut
    // this off entirely when it wasn't right at the very end.
    const libvaLines = allLines.filter((l) => l.toLowerCase().includes('libva'));
    const stderr = [...libvaLines, ...allLines.slice(-3)].join(' | ');
    return { ok: false, reason: r.error ? r.error.message : (stderr || `ffmpeg exited with code ${r.status}`) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function detectQSV() {
  // Works cross-platform (Windows and Linux) since Quick Sync is exposed
  // through Intel's Media SDK/oneVPL on both, unlike VAAPI (Linux-only).
  return testEncode(['-c:v', 'h264_qsv']);
}

function detectNVENC() {
  // NVIDIA's encoder, exposed the same way on Windows and Linux via the
  // NVIDIA driver - just needs an NVENC-capable GPU (most GeForce/Quadro
  // cards from the last decade-plus) and a reasonably current driver.
  return testEncode(['-c:v', 'h264_nvenc']);
}

function detectAMF() {
  // AMD's encoder - primarily a Windows API, though some AMD Linux
  // drivers expose it too. AMD on Linux more commonly goes through
  // VAAPI instead (checked separately below), which is why this is
  // tried first but VAAPI remains the fallback for AMD-on-Linux setups
  // where AMF itself isn't available.
  return testEncode(['-c:v', 'h264_amf']);
}

function checkDevicePermissions(device) {
  // Best-effort - the actual VAAPI failure reason from ffmpeg still
  // gets reported either way even if any of this itself doesn't work
  // (a non-Linux platform, no getent available, etc.) - this only ever
  // adds extra, more specific context on top of that, never replaces it.
  try {
    const stat = fs.statSync(device);
    const currentGroups = process.getgroups ? process.getgroups() : [];
    if (currentGroups.includes(stat.gid)) return null; // permission looks fine at this level - the failure is something else
    let groupName = String(stat.gid);
    try {
      const r = spawnSync('getent', ['group', String(stat.gid)], { timeout: 2000 });
      if (!r.error && r.status === 0) groupName = r.stdout.toString('utf-8').split(':')[0] || groupName;
    } catch (e) { /* fall back to the bare gid */ }
    return `the account running this server is not in the '${groupName}' group that ${device} belongs to - this is very likely the actual cause. Fix: sudo usermod -aG ${groupName} $USER, then fully log out and back in (or reboot) for it to take effect`;
  } catch (e) {
    return null;
  }
}

function detectVAAPI() {
  // renderD128 is by far the most common single-GPU case, but a board
  // with more than one GPU (a discrete AMD card alongside an Intel
  // iGPU, a very ordinary combination) can easily have the actual
  // target GPU sitting at a different render node - trying a small,
  // realistic range rather than assuming 128 is always correct.
  const candidates = ['/dev/dri/renderD128', '/dev/dri/renderD129', '/dev/dri/renderD130'];
  const attempts = [];
  for (const device of candidates) {
    if (!fs.existsSync(device)) { attempts.push(`${device}: device does not exist`); continue; }
    const result = testEncode(['-vaapi_device', device, '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi']);
    if (result.ok) return { ok: true, device };
    const permissionHint = checkDevicePermissions(device);
    attempts.push(`${device}: ${result.reason}${permissionHint ? ` (${permissionHint})` : ''}`);
  }
  return { ok: false, reason: attempts.join(' || ') };
}

let cached = null;

// hwPreference: config value - true/"auto" to allow hardware encoding if
// available, false to force software-only (an escape hatch in case a
// particular driver setup misbehaves).
function detectHwAccel(hwPreference) {
  if (hwPreference === false) return { type: 'none', label: 'software (libx264) - hardware acceleration disabled in settings' };
  if (cached) return cached;
  const attempts = {};
  attempts.nvenc = detectNVENC();
  if (attempts.nvenc.ok) { cached = { type: 'nvenc', label: 'NVIDIA NVENC' }; return cached; }
  attempts.qsv = detectQSV();
  if (attempts.qsv.ok) { cached = { type: 'qsv', label: 'Intel Quick Sync (QSV)' }; return cached; }
  attempts.amf = detectAMF();
  if (attempts.amf.ok) { cached = { type: 'amf', label: 'AMD AMF' }; return cached; }
  attempts.vaapi = detectVAAPI();
  if (attempts.vaapi.ok) { cached = { type: 'vaapi', device: attempts.vaapi.device, label: 'VAAPI (Intel/AMD)' }; return cached; }
  // Every method was actually tried and failed, not just skipped - log
  // specifically why each one didn't work, the one piece of information
  // that was previously never available anywhere at all, so this can be
  // diagnosed directly from a server log rather than guessing.
  console.log('[hwaccel] no working hardware encoder found - reasons for each method tried:');
  console.log(`[hwaccel]   NVENC: ${attempts.nvenc.reason}`);
  console.log(`[hwaccel]   QSV: ${attempts.qsv.reason}`);
  console.log(`[hwaccel]   AMF: ${attempts.amf.reason}`);
  console.log(`[hwaccel]   VAAPI: ${attempts.vaapi.reason}`);
  cached = {
    type: 'none',
    label: 'software (libx264)',
    attemptReasons: {
      nvenc: attempts.nvenc.reason,
      qsv: attempts.qsv.reason,
      amf: attempts.amf.reason,
      vaapi: attempts.vaapi.reason,
    },
  };
  return cached;
}

module.exports = { detectHwAccel };
