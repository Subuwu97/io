const fs = require("node:fs"),
  path = require("node:path"),
  { acquireStateLock } = require("../server/state-lock"),
  {
    packState,
    unpackState,
    snapshotState,
    restoreState,
  } = require("../server/state-backup");
function main() {
  const [command, archive, directory] = process.argv.slice(2),
    password = process.env.IO_BACKUP_PASSPHRASE;
  if (
    !["create", "inspect", "restore"].includes(command) ||
    !archive ||
    (command !== "inspect" && !directory)
  )
    throw Error(
      "Usage: node scripts/server-state.cjs <create|inspect|restore> <archive.io-backup> [data-directory]. Set IO_BACKUP_PASSPHRASE privately first.",
    );
  let lock;
  try {
    if (command === "create") {
      lock = acquireStateLock(path.resolve(directory));
      const bytes = packState(snapshotState(path.resolve(directory)), password);
      fs.writeFileSync(path.resolve(archive), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      console.log(
        "Encrypted server-state backup created. Media files and generated caches are excluded.",
      );
    } else {
      const backup = unpackState(
        fs.readFileSync(path.resolve(archive)),
        password,
      );
      if (command === "inspect")
        console.log(
          JSON.stringify(
            {
              createdAt: backup.manifest.createdAt,
              files: backup.manifest.files.map((f) => ({
                name: f.name,
                size: f.size,
              })),
            },
            null,
            2,
          ),
        );
      else {
        lock = acquireStateLock(path.resolve(directory));
        restoreState(path.resolve(directory), backup);
        console.log(
          "Server state restored into the new directory. Sign in again, re-pair TVs, and review media paths and disabled tracker automation before use.",
        );
      }
    }
  } finally {
    lock?.release();
  }
}
try {
  main();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
