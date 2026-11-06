const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
function createPrivateSettings(directory) {
  const keyFile = path.join(directory, "integrations.key"),
    file = path.join(directory, "integrations.json");
  let key;
  if (fs.existsSync(keyFile)) key = fs.readFileSync(keyFile);
  else {
    key = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, key, { mode: 0o600, flag: "wx" });
  }
  if (key.length !== 32) throw Error("Invalid integration encryption key");
  function seal(value) {
    const iv = crypto.randomBytes(12),
      cipher = crypto.createCipheriv("aes-256-gcm", key, iv),
      data = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  function open(value) {
    const data = Buffer.from(value, "base64"),
      decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        data.subarray(0, 12),
      );
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
  }
  let settings = fs.existsSync(file) ? open(fs.readFileSync(file, "utf8")) : {};
  return {
    seal,
    open,
    get: () => ({ ...settings }),
    save(value) {
      const temp = file + ".tmp";
      fs.writeFileSync(temp, seal(value), { mode: 0o600 });
      fs.renameSync(temp, file);
      settings = { ...value };
    },
  };
}
module.exports = { createPrivateSettings };
