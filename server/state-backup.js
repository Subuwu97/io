const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { DatabaseSync } = require("node:sqlite"),
  { zipSync, strToU8 } = require("fflate"),
  archive = require("./archive");
const limit = 256 * 1024 * 1024,
  header = Buffer.from("IOBACKUP1\n"),
  files = [
    "io.db",
    "config.json",
    "services.json",
    "integrations.json",
    "integrations.key",
    "library-index.json",
  ];
const allowed = (name) =>
  files.includes(name) ||
  /^(uploads\/(avatars|banners)|avatar-gallery)\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/.test(
    name,
  );
function key(password, salt) {
  if (
    typeof password !== "string" ||
    password.length < 16 ||
    password.length > 1024
  )
    throw Error("Use a backup passphrase between 16 and 1,024 characters");
  return crypto.scryptSync(password, salt, 32, {
    N: 65536,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024,
  });
}
function packState(entries, password) {
  let total = 0;
  const manifest = {
      format: "I/O server state",
      version: 1,
      createdAt: new Date().toISOString(),
      files: [],
    },
    payload = {};
  for (const [name, value] of Object.entries(entries)) {
    if (!allowed(name) || !Buffer.isBuffer(value))
      throw Error("Unsupported server backup file");
    total += value.length;
    if (total > limit || value.length > 128 * 1024 * 1024)
      throw Error("Server state exceeds the supported 256 MB backup limit");
    manifest.files.push({
      name,
      size: value.length,
      sha256: crypto.createHash("sha256").update(value).digest("hex"),
    });
    payload[name] = value;
  }
  if (!payload["io.db"] || !payload["config.json"])
    throw Error("Server database and configuration are required");
  payload["manifest.json"] = strToU8(JSON.stringify(manifest));
  const salt = crypto.randomBytes(16),
    iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key(password, salt), iv);
  cipher.setAAD(header);
  const encrypted = Buffer.concat([
    cipher.update(zipSync(payload)),
    cipher.final(),
  ]);
  return Buffer.concat([header, salt, iv, cipher.getAuthTag(), encrypted]);
}
function unpackState(bytes, password) {
  if (
    bytes.length > limit + 1024 * 1024 ||
    !bytes.subarray(0, header.length).equals(header)
  )
    throw Error("Choose an I/O encrypted server-state backup");
  let zip;
  try {
    const start = header.length,
      decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key(password, bytes.subarray(start, start + 16)),
        bytes.subarray(start + 16, start + 28),
      );
    decipher.setAAD(header);
    decipher.setAuthTag(bytes.subarray(start + 28, start + 44));
    zip = Buffer.concat([
      decipher.update(bytes.subarray(start + 44)),
      decipher.final(),
    ]);
  } catch {
    throw Error("Wrong passphrase or damaged server backup");
  }
  const entries = archive.readZipEntries(zip);
  if (entries.length > 5000) throw Error("Too many backup files");
  const output = {};
  let total = 0;
  for (const e of entries) {
    if (e.name !== "manifest.json" && !allowed(e.name))
      throw Error("Unexpected backup path");
    if (Object.hasOwn(output, e.name)) throw Error("Duplicate backup path");
    total += e.uncompressedSize;
    if (total > limit) throw Error("Backup expands beyond the supported limit");
    output[e.name] = archive.extractEntry(zip, e, 128 * 1024 * 1024);
  }
  const manifest = JSON.parse(output["manifest.json"]?.toString() || "{}");
  delete output["manifest.json"];
  if (
    manifest.format !== "I/O server state" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== Object.keys(output).length ||
    !output["io.db"] ||
    !output["config.json"]
  )
    throw Error("Invalid server backup manifest");
  const seen = new Set();
  for (const f of manifest.files) {
    if (
      seen.has(f.name) ||
      !output[f.name] ||
      output[f.name].length !== f.size ||
      crypto.createHash("sha256").update(output[f.name]).digest("hex") !==
        f.sha256
    )
      throw Error("Backup integrity check failed");
    seen.add(f.name);
  }
  if (output["integrations.json"] && !output["integrations.key"])
    throw Error("Integration encryption key is missing");
  JSON.parse(output["config.json"].toString());
  return { manifest, files: output };
}
function snapshotState(directory) {
  const dbFile = path.join(directory, "io.db");
  if (!fs.existsSync(dbFile) || fs.lstatSync(dbFile).isSymbolicLink())
    throw Error("Choose an I/O data directory");
  const source = new DatabaseSync(dbFile);
  try {
    const check = source.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (check.busy) throw Error("Database is busy; stop I/O first");
  } finally {
    source.close();
  }
  const output = {};
  for (const file of files) {
    const target = path.join(directory, file);
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink())
        throw Error("Backup source contains a symbolic link");
      output[file] = fs.readFileSync(target);
    }
  }
  for (const dir of ["uploads/avatars", "uploads/banners", "avatar-gallery"]) {
    const root = path.join(directory, dir);
    if (!fs.existsSync(root)) continue;
    if (fs.lstatSync(root).isSymbolicLink())
      throw Error("Backup source contains a symbolic link");
    for (const name of fs.readdirSync(root)) {
      const relative = dir + "/" + name,
        target = path.join(root, name);
      if (allowed(relative)) {
        if (
          !fs.lstatSync(target).isFile() ||
          fs.lstatSync(target).isSymbolicLink()
        )
          throw Error("Unsupported upload path");
        output[relative] = fs.readFileSync(target);
      }
    }
  }
  return output;
}
function restoreState(directory, backup) {
  fs.mkdirSync(directory, { recursive: true });
  if (
    fs
      .readdirSync(directory)
      .some(
        (n) =>
          ![
            "io-runtime.lock",
            ".io-state-lock.sqlite",
            ".io-state-lock.sqlite-journal",
          ].includes(n),
      )
  )
    throw Error(
      "Restore into a new, empty data directory. Existing server data will not be overwritten.",
    );
  const staging = path.join(directory, ".restore-" + crypto.randomUUID());
  fs.mkdirSync(staging);
  try {
    for (const [name, bytes] of Object.entries(backup.files)) {
      if (!allowed(name)) throw Error("Invalid restore path");
      const target = path.join(staging, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
    }
    const db = new DatabaseSync(path.join(staging, "io.db"));
    try {
      if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
        throw Error("Backup database integrity check failed");
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((r) => r.name),
      );
      if (!tables.has("accounts") || !tables.has("profiles"))
        throw Error("This is not an I/O account database");
      db.exec("PRAGMA foreign_keys=ON");
      for (const table of [
        "sessions",
        "native_tv_devices",
        "tv_devices",
        "tracker_states",
        "tracker_plans",
        "tracker_jobs",
        "account_restore_plans",
        "passkey_challenges",
        "identity_tokens",
        "delivery_queue",
        "watch_activity",
      ])
        if (tables.has(table)) db.exec("DELETE FROM " + table);
      if (tables.has("activity_preferences"))
        db.exec("UPDATE activity_preferences SET enabled=0,token_hash=NULL");
      if (tables.has("tracker_automation"))
        db.exec("UPDATE tracker_automation SET enabled=0");
    } finally {
      db.close();
    }
    for (const name of fs.readdirSync(staging))
      fs.renameSync(path.join(staging, name), path.join(directory, name));
    fs.rmdirSync(staging);
    return backup.manifest;
  } catch (e) {
    throw Error(
      "Restore did not finish; the staging folder is preserved for inspection. " +
        e.message,
    );
  }
}
module.exports = { packState, unpackState, snapshotState, restoreState };
