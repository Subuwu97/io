// Minimal, dependency-free QR Code encoder (versions 1-6, byte mode,
// error correction level L only - plenty for the short pairing URLs this
// app uses it for). No external library, no network calls - everything
// needed to turn a string into a scannable QR code lives in this file.
//
// Implements ISO/IEC 18004 Reed-Solomon error correction and standard
// module placement/masking. Structure follows the well-known public
// domain reference algorithm (Nayuki's QR Code generator library).
(function (global) {
  'use strict';

  // ---- Reed-Solomon over GF(256), primitive polynomial 0x11D ----
  function rsMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  function rsComputeDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = rsMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = rsMultiply(root, 0x02);
    }
    return result;
  }

  function rsComputeRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (const b of data) {
      const factor = (b ^ result[0]) & 0xFF;
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (let i = 0; i < result.length; i++) {
        result[i] ^= rsMultiply(divisor[i], factor);
      }
    }
    return result;
  }

  // ---- Per-version capacity table, ECC level L, versions 1-6 ----
  // [totalCodewords, eccPerBlock, numBlocks, dataPerBlock]
  // (versions 1-6 at level L are always a single block, which keeps the
  // interleaving step trivial - plenty of room for our use case.)
  const VERSION_INFO_L = {
    1: { total: 26, eccPerBlock: 7, numBlocks: 1, dataPerBlock: 19 },
    2: { total: 44, eccPerBlock: 10, numBlocks: 1, dataPerBlock: 34 },
    3: { total: 70, eccPerBlock: 15, numBlocks: 1, dataPerBlock: 55 },
    4: { total: 100, eccPerBlock: 20, numBlocks: 1, dataPerBlock: 80 },
    5: { total: 134, eccPerBlock: 26, numBlocks: 1, dataPerBlock: 108 },
    6: { total: 172, eccPerBlock: 18, numBlocks: 2, dataPerBlock: 68 },
  };
  const ALIGNMENT_CENTER = { 2: 18, 3: 22, 4: 26, 5: 30, 6: 34 }; // single alignment pattern center (versions 2-6)

  function sizeForVersion(v) { return 17 + 4 * v; }

  // ---- Build the bit stream: mode + count + data + terminator + padding ----
  function buildDataCodewords(text, version) {
    const info = VERSION_INFO_L[version];
    const dataCapacityBytes = info.dataPerBlock * info.numBlocks;
    const bytes = Array.from(new TextEncoder().encode(text));

    const bits = [];
    function pushBits(value, len) {
      for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    }
    pushBits(0b0100, 4); // byte mode indicator
    const countBits = version <= 9 ? 8 : 16;
    pushBits(bytes.length, countBits);
    for (const b of bytes) pushBits(b, 8);

    const capacityBits = dataCapacityBytes * 8;
    // Terminator (up to 4 zero bits)
    for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
    // Pad to a byte boundary
    while (bits.length % 8 !== 0) bits.push(0);
    // Pad bytes 0xEC / 0x11 alternating until full
    const padBytes = [0xEC, 0x11];
    let p = 0;
    while (bits.length < capacityBits) {
      pushBits(padBytes[p % 2], 8);
      p++;
    }
    if (bits.length > capacityBits) throw new Error('QR: text too long for supported versions');

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      codewords.push(byte);
    }
    return codewords;
  }

  // ---- Interleave data + EC codewords across blocks ----
  function interleave(dataCodewords, version) {
    const info = VERSION_INFO_L[version];
    const blocks = [];
    const eccBlocks = [];
    const divisor = rsComputeDivisor(info.eccPerBlock);
    for (let b = 0; b < info.numBlocks; b++) {
      const block = dataCodewords.slice(b * info.dataPerBlock, (b + 1) * info.dataPerBlock);
      blocks.push(block);
      eccBlocks.push(rsComputeRemainder(block, divisor));
    }
    const result = [];
    for (let i = 0; i < info.dataPerBlock; i++) {
      for (const block of blocks) result.push(block[i]);
    }
    for (let i = 0; i < info.eccPerBlock; i++) {
      for (const ecc of eccBlocks) result.push(ecc[i]);
    }
    return result;
  }

  // ---- Module matrix construction ----
  function makeMatrix(size) {
    return Array.from({ length: size }, () => new Array(size).fill(null)); // null = not yet set
  }

  function setFinder(matrix, row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= matrix.length || cc >= matrix.length) continue;
        const isBorder = r === -1 || r === 7 || c === -1 || c === 7;
        const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const ring = inner && (r === 0 || r === 6 || c === 0 || c === 6);
        const core = inner && r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[rr][cc] = isBorder ? false : (ring || core);
      }
    }
  }

  function setAlignment(matrix, row, col) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const ring = Math.max(Math.abs(r), Math.abs(c));
        matrix[row + r][col + c] = ring !== 1;
      }
    }
  }

  function drawFunctionPatterns(matrix, version, isFunctionModule) {
    const size = matrix.length;
    setFinder(matrix, 0, 0);
    setFinder(matrix, 0, size - 7);
    setFinder(matrix, size - 7, 0);
    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      matrix[6][i] = i % 2 === 0;
      matrix[i][6] = i % 2 === 0;
    }
    // Alignment pattern (versions 2-6 have exactly one, away from the finders)
    if (ALIGNMENT_CENTER[version] != null) {
      setAlignment(matrix, ALIGNMENT_CENTER[version], ALIGNMENT_CENTER[version]);
    }
    // Dark module (always present, fixed position)
    matrix[size - 8][8] = true;
    // Mark every currently-set cell (finder/separator/timing/alignment/dark) as a function module
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c] !== null) isFunctionModule[r][c] = true;
      }
    }
    // Reserve format info areas (filled in later, but must not receive data)
    for (let i = 0; i < 9; i++) {
      if (matrix[8][i] === null) matrix[8][i] = false;
      if (matrix[i][8] === null) matrix[i][8] = false;
      isFunctionModule[8][i] = true;
      isFunctionModule[i][8] = true;
    }
    for (let i = 0; i < 8; i++) {
      matrix[8][size - 1 - i] = false;
      matrix[size - 1 - i][8] = false;
      isFunctionModule[8][size - 1 - i] = true;
      isFunctionModule[size - 1 - i][8] = true;
    }
  }

  function drawData(matrix, isFunctionModule, codewords) {
    const size = matrix.length;
    const bits = [];
    for (const byte of codewords) for (let i = 7; i >= 0; i--) bits.push((byte >>> i) & 1);
    let bitIndex = 0;
    let upward = true;
    for (let colPair = size - 1; colPair >= 1; colPair -= 2) {
      if (colPair === 6) colPair = 5; // skip the vertical timing column
      for (let vert = 0; vert < size; vert++) {
        const row = upward ? size - 1 - vert : vert;
        for (let k = 0; k < 2; k++) {
          const col = colPair - k;
          if (isFunctionModule[row][col]) continue;
          matrix[row][col] = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
          bitIndex++;
        }
      }
      upward = !upward;
    }
  }

  // ---- Masking ----
  function maskFn(pattern, r, c) {
    switch (pattern) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return (r * c) % 2 + (r * c) % 3 === 0;
      case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      case 7: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
    }
  }

  function applyMask(matrix, isFunctionModule, pattern) {
    const size = matrix.length;
    const out = matrix.map((row) => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (isFunctionModule[r][c]) continue;
        if (maskFn(pattern, r, c)) out[r][c] = !out[r][c];
      }
    }
    return out;
  }

  function penaltyScore(m) {
    const size = m.length;
    let score = 0;
    // Rule 1: runs of 5+ same-color modules in a row/column
    function runPenalty(getCell) {
      let p = 0;
      for (let i = 0; i < size; i++) {
        let runColor = null, runLen = 0;
        for (let j = 0; j < size; j++) {
          const v = getCell(i, j);
          if (v === runColor) {
            runLen++;
          } else {
            if (runLen >= 5) p += runLen - 2;
            runColor = v; runLen = 1;
          }
        }
        if (runLen >= 5) p += runLen - 2;
      }
      return p;
    }
    score += runPenalty((i, j) => m[i][j]);
    score += runPenalty((i, j) => m[j][i]);
    // Rule 2: 2x2 blocks of same color
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    // Rule 3: finder-like patterns (1:1:3:1:1)
    const pattern1 = [true, false, true, true, true, false, true, false, false, false, false];
    const pattern2 = [false, false, false, false, true, false, true, true, true, false, true];
    function matchesAt(getCell, i, start) {
      for (let k = 0; k < 11; k++) {
        if (getCell(i, start + k) !== pattern1[k] && getCell(i, start + k) !== pattern2[k]) return false;
      }
      return true;
    }
    for (let i = 0; i < size; i++) {
      for (let j = 0; j <= size - 11; j++) {
        if (matchesAt((r, c) => m[r][c], i, j)) score += 40;
        if (matchesAt((r, c) => m[c][r], i, j)) score += 40;
      }
    }
    // Rule 4: overall dark module balance
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
    const ratio = Math.abs((dark * 100) / (size * size) - 50) / 5;
    score += Math.floor(ratio) * 10;
    return score;
  }

  // ---- Format info (mask pattern + ECC level), BCH(15,5) ----
  function computeFormatBits(eccBits, maskPattern) {
    const data = (eccBits << 3) | maskPattern;
    let rem = data;
    for (let i = 0; i < 10; i++) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }
    let bits = ((data << 10) | rem) ^ 0x5412;
    return bits & 0x7FFF;
  }

  function drawFormatInfo(matrix, maskPattern) {
    const size = matrix.length;
    const bits = computeFormatBits(0b01, maskPattern); // 01 = ECC level L
    function getBit(i) { return ((bits >>> i) & 1) === 1; }
    // First copy (around the top-left finder pattern)
    for (let i = 0; i <= 5; i++) matrix[i][8] = getBit(i);
    matrix[7][8] = getBit(6);
    matrix[8][8] = getBit(7);
    matrix[8][7] = getBit(8);
    for (let i = 9; i <= 14; i++) matrix[8][14 - i] = getBit(i);
    // Second copy (split across top-right and bottom-left)
    for (let i = 0; i <= 7; i++) matrix[8][size - 1 - i] = getBit(i);
    for (let i = 8; i <= 14; i++) matrix[size - 15 + i][8] = getBit(i);
    matrix[size - 8][8] = true; // dark module
  }

  function generateMatrix(text) {
    let version = null, dataCodewords = null;
    for (let v = 1; v <= 6; v++) {
      try {
        dataCodewords = buildDataCodewords(text, v);
        version = v;
        break;
      } catch (e) { /* try next version */ }
    }
    if (version === null) throw new Error('QR: text too long (max ~130 bytes)');

    const size = sizeForVersion(version);
    const matrix = makeMatrix(size);
    const isFunctionModule = Array.from({ length: size }, () => new Array(size).fill(false));
    drawFunctionPatterns(matrix, version, isFunctionModule);

    const allCodewords = interleave(dataCodewords, version);
    drawData(matrix, isFunctionModule, allCodewords);

    let best = null, bestScore = Infinity, bestPattern = 0;
    for (let pattern = 0; pattern < 8; pattern++) {
      const masked = applyMask(matrix, isFunctionModule, pattern);
      drawFormatInfo(masked, pattern);
      const score = penaltyScore(masked);
      if (score < bestScore) { bestScore = score; best = masked; bestPattern = pattern; }
    }
    return { size, matrix: best };
  }

  function toSVG(text, opts) {
    opts = opts || {};
    const moduleSize = opts.moduleSize || 6;
    const margin = opts.margin != null ? opts.margin : 4;
    const dark = opts.dark || '#000000';
    const light = opts.light || '#ffffff';
    const { size, matrix } = generateMatrix(text);
    const px = (size + margin * 2) * moduleSize;
    let rects = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c]) {
          rects += `<rect x="${(c + margin) * moduleSize}" y="${(r + margin) * moduleSize}" width="${moduleSize}" height="${moduleSize}"/>`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}"><rect width="${px}" height="${px}" fill="${light}"/><g fill="${dark}">${rects}</g></svg>`;
  }

  const QR = { generateMatrix, toSVG };
  if (typeof module !== 'undefined' && module.exports) module.exports = QR;
  else global.IOQR = QR;
})(typeof window !== 'undefined' ? window : globalThis);
