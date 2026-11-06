const fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { DatabaseSync } = require("node:sqlite");
function acquireStateLock(directory, kind = "maintenance") {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "io-runtime.lock"),
    nonce = randomUUID(),
    guard = new DatabaseSync(path.join(directory, ".io-state-lock.sqlite"));
  let held = false,
    released = false;
  try {
    guard.exec(
      "PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS state_guard(id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE",
    );
    held = true;
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, nonce, kind }), {
      mode: 0o600,
    });
  } catch (e) {
    try {
      if (held) guard.exec("ROLLBACK");
      guard.close();
    } catch {}
    if (/locked|busy/i.test(e.message))
      throw Error(
        "Stop I/O before backing up or restoring this data directory",
      );
    throw e;
  }
  return {
    release() {
      if (released) return;
      released = true;
      try {
        if (JSON.parse(fs.readFileSync(file, "utf8")).nonce === nonce)
          fs.unlinkSync(file);
      } catch {}
      try {
        guard.exec("ROLLBACK");
      } finally {
        guard.close();
      }
    },
  };
}
module.exports = { acquireStateLock };
