// I/O data is isolated from Minami. Set IO_DATA_DIR to keep data outside
// the checkout; otherwise use this installation's ignored data directory.
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.IO_DATA_DIR ? path.resolve(process.env.IO_DATA_DIR) : path.join(APP_ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
module.exports = { DATA_DIR, APP_ROOT };
