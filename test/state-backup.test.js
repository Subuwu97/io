const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { DatabaseSync } = require("node:sqlite");
const {
    packState,
    unpackState,
    snapshotState,
    restoreState,
  } = require("../server/state-backup"),
  { acquireStateLock } = require("../server/state-lock");
test("encrypted server-state backups preserve integration secrets, reject damage and restore only into empty destinations with sessions and automation revoked", (t) => {
  const root = fs.mkdtempSync(
    path.join(process.env.IO_TEST_ROOT || os.tmpdir(), "io-state-backup-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  fs.mkdirSync(source);
  const db = new DatabaseSync(path.join(source, "io.db"));
  db.exec(
    "PRAGMA journal_mode=WAL;CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('a');CREATE TABLE profiles(id TEXT PRIMARY KEY);CREATE TABLE sessions(id TEXT);INSERT INTO sessions VALUES('old-session');CREATE TABLE tracker_automation(enabled INTEGER);INSERT INTO tracker_automation VALUES(1);",
  );
  db.close();
  fs.writeFileSync(path.join(source, "config.json"), '{"port":5921}');
  const settings = require("../server/private-settings").createPrivateSettings(
    source,
  );
  settings.save({ malSecret: "private-test-secret" });
  const password = "test-only long backup passphrase",
    packed = packState(snapshotState(source), password);
  assert.equal(packed.includes(Buffer.from("private-test-secret")), false);
  assert.throws(() => unpackState(packed, "incorrect long passphrase"));
  const corrupt = Buffer.from(packed);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => unpackState(corrupt, password));
  assert.throws(() => packState({ "../escape": Buffer.from("no") }, password));
  const backup = unpackState(packed, password),
    dest = path.join(root, "restored");
  restoreState(dest, backup);
  assert.equal(
    require("../server/private-settings").createPrivateSettings(dest).get()
      .malSecret,
    "private-test-secret",
  );
  assert.throws(() => restoreState(dest, backup), /empty/);
  const restored = new DatabaseSync(path.join(dest, "io.db"));
  assert.equal(restored.prepare("SELECT COUNT(*) n FROM sessions").get().n, 0);
  assert.equal(
    restored.prepare("SELECT enabled FROM tracker_automation").get().enabled,
    0,
  );
  restored.close();
});
test("server-state locking prevents concurrent maintenance and releases only its own lock", (t) => {
  const root = fs.mkdtempSync(
    path.join(process.env.IO_TEST_ROOT || os.tmpdir(), "io-state-lock-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lock = acquireStateLock(root, "server");
  assert.throws(() => acquireStateLock(root), /Stop I\/O/);
  lock.release();
  const next = acquireStateLock(root);
  lock.release();
  assert.equal(fs.existsSync(path.join(root, "io-runtime.lock")), true);
  next.release();
});
