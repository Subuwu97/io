const fs = require('fs');
const path = require('path');

const ALLOWED_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const MAX_BYTES = 8 * 1024 * 1024; // 8MB decoded, generous for a resized client-side image

// Accepts a "data:image/png;base64,...." string (as produced by canvas.toDataURL
// or FileReader.readAsDataURL on the client), validates it, and writes it to
// disk under `dir` with a fresh filename based on `baseName`. Returns the
// absolute path written. Throws on anything that doesn't look like a
// reasonably-sized image data URL.
function saveDataUrlImage(dataUrl, dir, baseName) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('Invalid image data');
  }
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data URL');
  const mime = match[1].toLowerCase();
  const ext = ALLOWED_MIME_EXT[mime];
  if (!ext) throw new Error('Unsupported image type. Use JPEG, PNG, WEBP, or GIF.');

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) throw new Error('Empty image data');
  if (buffer.length > MAX_BYTES) throw new Error('Image is too large (max 8MB)');

  fs.mkdirSync(dir, { recursive: true });
  // Clear any previous upload for this profile under a different extension
  // so switching file types doesn't leave stale images on disk.
  Object.values(ALLOWED_MIME_EXT).forEach((oldExt) => {
    const old = path.join(dir, baseName + oldExt);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  });

  const destPath = path.join(dir, baseName + ext);
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

module.exports = { saveDataUrlImage };
