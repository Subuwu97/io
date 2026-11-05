// Optional PDF support via poppler-utils (pdftoppm/pdfinfo), the same
// widely-available command-line tools most Linux distros and Homebrew
// ship. Mirrors the ffmpeg.js pattern: detect availability, degrade
// gracefully (fall back to "open the raw PDF" in the browser) if missing.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function checkBinary(name) {
  try {
    const r = spawnSync(name, ['-v']);
    return !r.error;
  } catch (e) {
    return false;
  }
}

const HAS_PDFTOPPM = checkBinary('pdftoppm');
const HAS_PDFINFO = checkBinary('pdfinfo');
if (!HAS_PDFINFO) {
  console.log('[pdf] pdfinfo (poppler-utils) not found - PDF chapters will use a slower, less precise fallback for page counts. Install poppler-utils (or, on Windows, a poppler-for-windows build with its bin/ folder added to PATH) for faster, more accurate PDF handling.');
}

// Async (non-blocking) - this runs once per PDF chapter during a library
// scan, and a synchronous spawn here would block the whole server (every
// other request) for as long as the subprocess takes, once per chapter.
// With a manga library that has many PDF chapters, that adds up to a
// very real, very noticeable freeze.
function getPageCount(pdfPath) {
  return new Promise((resolve) => {
    if (!HAS_PDFINFO) {
      resolve(estimatePageCountFromFile(pdfPath));
      return;
    }
    try {
      const proc = spawn('pdfinfo', [pdfPath]);
      let stdout = '';
      proc.stdout.on('data', (d) => { stdout += d; });
      proc.on('close', (code) => {
        const m = code === 0 ? stdout.match(/Pages:\s*(\d+)/) : null;
        resolve(m ? parseInt(m[1], 10) : estimatePageCountFromFile(pdfPath));
      });
      proc.on('error', () => resolve(estimatePageCountFromFile(pdfPath)));
    } catch (e) {
      resolve(estimatePageCountFromFile(pdfPath));
    }
  });
}

// Rough fallback estimate for when pdfinfo isn't available (or fails):
// count "/Type /Page" object markers (but not the "/Type /Pages" tree
// nodes). Not bulletproof for every PDF producer, but good enough as a
// fallback. Capped to a reasonable read size rather than the entire
// file - a large, image-heavy manga-style PDF can easily be tens to
// hundreds of MB, and reading the whole thing just to run a regex over
// it for an estimate that's already documented as imprecise is exactly
// the same category of unbounded-read cost already fixed for CBZ
// files. This estimate was never a guarantee of exact accuracy, so
// accepting a bit more of that on unusually large files in exchange for
// a dramatically smaller read is consistent with its existing purpose.
function estimatePageCountFromFile(pdfPath) {
  try {
    const SAMPLE_BYTES = 8 * 1024 * 1024; // 8MB - comfortably fast to read and regex-scan, while still being a meaningfully large, representative sample
    const fileSize = fs.statSync(pdfPath).size;
    const sampleSize = Math.min(fileSize, SAMPLE_BYTES);
    const fd = fs.openSync(pdfPath, 'r');
    let text;
    try {
      const buf = Buffer.alloc(sampleSize);
      let bytesRead = 0;
      while (bytesRead < sampleSize) {
        const n = fs.readSync(fd, buf, bytesRead, sampleSize - bytesRead, bytesRead);
        if (n === 0) break;
        bytesRead += n;
      }
      text = buf.toString('latin1', 0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }
    const matches = text.match(/\/Type\s*\/Page(?!s)/g);
    const countInSample = matches ? matches.length : 0;
    if (countInSample === 0) return 1;
    // If the whole file was read, this IS the actual count - no
    // extrapolation needed or appropriate. Otherwise, scale up by how
    // much larger the full file is than what was actually sampled,
    // assuming page objects are roughly evenly distributed through the
    // file (true for the vast majority of real-world PDF producers,
    // which write pages sequentially as they're generated).
    if (sampleSize >= fileSize) return countInSample;
    return Math.max(1, Math.round(countInSample * (fileSize / sampleSize)));
  } catch (e) {
    return 1;
  }
}

// Renders a single page to PNG into `outDir`, returning the file path.
// Synchronous/blocking (pdftoppm is fast for a single page) - fine for a
// personal-scale app; callers should cache the result on disk themselves.
function renderPage(pdfPath, pageNum, outDir, baseName) {
  fs.mkdirSync(outDir, { recursive: true });
  const prefix = path.join(outDir, baseName);
  const r = spawnSync('pdftoppm', ['-png', '-f', String(pageNum), '-l', String(pageNum), '-r', '150', pdfPath, prefix]);
  if (r.error || r.status !== 0) {
    throw new Error('pdftoppm failed: ' + (r.stderr ? r.stderr.toString().slice(0, 300) : r.error && r.error.message));
  }
  const files = fs.readdirSync(outDir).filter((f) => f.startsWith(baseName));
  if (files.length === 0) throw new Error('pdftoppm produced no output file');
  return path.join(outDir, files[0]);
}

module.exports = { HAS_PDFTOPPM, HAS_PDFINFO, getPageCount, renderPage };
