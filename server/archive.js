// Minimal ZIP reader using only Node's built-in zlib - no external dependency.
// Good enough for CBZ (comic book zip) and EPUB (which is also a zip
// container), since we only need to list entries and pull out individual
// files, not full write/append support.
const zlib = require("zlib");
const fs = require("fs");

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

// Locates and parses the End Of Central Directory + Central Directory
// records, returning a flat list of { name, compressionMethod,
// compressedSize, uncompressedSize, localHeaderOffset }.
function readZipEntries(buffer) {
  const maxCommentSize = 65557; // 22-byte EOCD record + up to 65535-byte comment
  const searchStart = Math.max(0, buffer.length - maxCommentSize);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1)
    throw new Error(
      "Not a valid zip file (no end-of-central-directory record found)",
    );

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = [];
  let offset = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CEN_SIG)
      break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Listing what's inside a zip only ever needs its central directory -
// a compact index that's always near the end of the file - never the
// actual (often much larger) file contents themselves. Reading the
// whole file into memory just to count entries, like a naive
// fs.readFileSync + readZipEntries does, means fully loading every
// single manga chapter's complete image data just to find out how
// many pages it has - for a library with many sizable chapters, that
// adds up to a lot of wasted I/O and memory during a scan. This reads
// only a generous tail chunk (enough to cover the index for the very
// large majority of real-world archives) and falls back to a full
// read only in the rare case that's genuinely not enough.
// fs.readSync isn't guaranteed to fill the whole requested length in a
// single call - especially for a read this size - it returns however
// many bytes it actually managed to read. Silently assuming a single
// call always fills the buffer is exactly what caused every real CBZ
// file to fail: on a short read, the un-filled tail of the buffer
// stays zeroed out (Buffer.alloc), which is exactly where the actual
// end-of-file data - containing the very record this function is
// searching for - needed to land. This loops until the full requested
// length has actually been read, or genuine EOF is hit.
function readFullySync(fd, buffer, length, position) {
  let bytesRead = 0;
  while (bytesRead < length) {
    const n = fs.readSync(
      fd,
      buffer,
      bytesRead,
      length - bytesRead,
      position + bytesRead,
    );
    if (n === 0) break; // genuine EOF - shouldn't happen given how length/position are computed, but never loop forever
    bytesRead += n;
  }
  return bytesRead;
}

function listZipEntriesEfficiently(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const fileSize = fs.fstatSync(fd).size;
    const tailSize = Math.min(fileSize, 512 * 1024); // ~8x the max possible index distance from the end (65557 bytes) - safe margin, smaller footprint
    const tailStart = fileSize - tailSize;
    const tailBuf = Buffer.alloc(tailSize);
    readFullySync(fd, tailBuf, tailSize, tailStart);

    const maxCommentSize = 65557; // 22-byte EOCD record + up to 65535-byte comment - the true maximum possible distance from the end of any valid zip file
    const searchStart = Math.max(0, tailBuf.length - maxCommentSize);
    let eocdOffset = -1;
    for (let i = tailBuf.length - 22; i >= searchStart; i--) {
      if (tailBuf.readUInt32LE(i) === EOCD_SIG) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) {
      // Our tail window (2MB) is already about 30x larger than the
      // maximum possible distance an EOCD record can be from the end of
      // a valid zip file (65557 bytes) - if it's genuinely not here,
      // reading the rest of the file won't find it either for any file
      // that's actually a valid zip. This isn't an edge case worth an
      // expensive full-file fallback for - it means the file itself is
      // corrupted, truncated, or not really a zip at all, and that
      // fallback would just be wasted I/O reading the whole thing before
      // still failing - for exactly the files where that cost is worst
      // (large, and already broken).
      throw new Error(
        "Not a valid zip file (no end-of-central-directory record found)",
      );
    }

    const cdOffset = tailBuf.readUInt32LE(eocdOffset + 16); // absolute, relative to the whole file
    const localCdOffset = cdOffset - tailStart;
    if (localCdOffset >= 0) {
      // The central directory is fully within what we already read -
      // the common case for essentially any realistic manga chapter.
      return readZipEntriesFromOffset(
        tailBuf,
        localCdOffset,
        tailBuf.readUInt16LE(eocdOffset + 10),
      );
    }
    // The EOCD itself was found (so this genuinely is a valid zip), but
    // its central directory starts before our tail window - possible
    // for an archive with an unusually large number of entries. This is
    // the one case actually worth a full-file fallback for, since we
    // know for certain the data we need exists, just further back than
    // we initially read.
    const fullBuf = Buffer.alloc(fileSize);
    readFullySync(fd, fullBuf, fileSize, 0);
    return readZipEntries(fullBuf);
  } finally {
    fs.closeSync(fd);
  }
}

// Parses central directory entries starting at a known offset within a
// buffer - shared by the efficient tail-read path once it's located the
// central directory's actual position within whatever was read.
function readZipEntriesFromOffset(buffer, cdOffsetInBuffer, entryCount) {
  const entries = [];
  let offset = cdOffsetInBuffer;
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CEN_SIG)
      break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Extracts and decompresses a single entry's bytes (STORED or DEFLATE only,
// which covers essentially every CBZ/EPUB in the wild).
function extractEntry(buffer, entry, maxOutputLength = 64 * 1024 * 1024) {
  if (
    entry.uncompressedSize > maxOutputLength ||
    entry.compressedSize > maxOutputLength
  )
    throw new Error("Archive entry exceeds the supported size");
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== LOC_SIG)
    throw new Error("Invalid local file header for " + entry.name);
  const nameLen = buffer.readUInt16LE(offset + 26);
  const extraLen = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLen + extraLen;
  const compressed = buffer.subarray(
    dataStart,
    dataStart + entry.compressedSize,
  );
  if (entry.compressionMethod === 0) return Buffer.from(compressed);
  if (entry.compressionMethod === 8)
    return zlib.inflateRawSync(compressed, { maxOutputLength });
  throw new Error(
    `Unsupported zip compression method ${entry.compressionMethod} for ${entry.name}`,
  );
}

function extractEntryByName(buffer, entries, name) {
  const entry = entries.find((e) => e.name === name);
  if (!entry) return null;
  return extractEntry(buffer, entry);
}

module.exports = {
  readZipEntries,
  extractEntry,
  extractEntryByName,
  listZipEntriesEfficiently,
};
