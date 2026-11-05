# Network-drive recovery update

Build marker: `network-library-recovery-2026-11-05`.

## What was wrong

The scanner already attempted to preserve previous results on timeout, but the server constructed a new empty Library object for every scan. The fallback therefore had nothing to preserve. Missing roots were also returned as successful empty scans, and there was no persisted catalog for a restart while a share was disconnected. Timed-out movie scans cleared the separate loose-file lookup index. In addition, the periodic check's timer did not release an await on stalled filesystem I/O, and synchronous folder-watcher setup ran on the HTTP thread.

## What this update changes

- Reuses the last complete catalog for the same configured root after a scan error or timeout, including loose-movie and manga chapter lookup indexes.
- Saves the catalog in `library-index.json` in the persistent IO data directory, and restores it before startup scanning.
- Treats unreadable/missing directories as scan failures. A genuinely readable empty root still applies intentional deletions. It cannot distinguish an empty unmounted Linux mountpoint from a legitimately empty directory.
- Opens HTTP before scanning. Rescan and media-path settings requests queue background work rather than keeping an HTTP request open for several minutes.
- Adds the admin-only `/api/admin/library-status` endpoint. The updated web client polls it and reports incomplete scans rather than claiming success.
- Gives periodic checks a real response deadline, isolates watcher setup in workers, and avoids duplicate scan workers for a root whose previous OS operation is still blocked.
- Reuses directory listings during a scan instead of issuing separate existence requests for each possible cover/banner/theme filename.

This keeps indexed titles visible; it does not make an offline share playable or repair SMB permissions. Restart protection is available only after this version has successfully scanned and saved that root at least once. An old version's already-lost, unpersisted catalog cannot be reconstructed without reading the share again. Catalogs from one configured path are not reused as if they belong to another path.

Keep IO's persistent data directory on a local disk. A local snapshot cannot help if the data directory itself is on the disconnected share.

## Update an installation launched with start.bat

1. Close the running server normally. Keep a copy of the previous application folder for rollback.
2. Extract the supplied full-project ZIP to a separate folder first. Copy the updated `server/` and `public/` folders and `package.json` into the actual application folder you launch with `start.bat`. The update adds `server/watch-worker.js`; it must be copied too. No dependency changes are required.
3. Preserve your existing live `config.json`, database, certificates, uploads, and media. Do not replace or delete your persistent data directory.
4. Start IO with the usual `start.bat`. Confirm the build marker above appears in the console.
5. With the share reachable, run Rescan once and confirm it completes. This creates the initial recovery snapshot. On a later disconnect, failed scans should retain the saved titles and report which roots failed.

If testing a freshly extracted application folder instead of updating in place, explicitly select the existing persistent data directory with `IO_DATA_DIR` if your installation used a legacy local data folder; otherwise the new folder may select a different default profile/data location.

If a mapped drive such as `Z:` is still timing out, check that the same Windows session launching `start.bat` can open that folder. Running the batch file as administrator can change mapped-drive visibility. An existing authenticated UNC path such as `\\server\share\Anime` avoids reliance on a drive letter; IO does not store SMB passwords or establish network sessions for you. Do not expose share credentials in config or logs.

## Verification

Run `npm test` on Node 24 (or another supported Node version with built-in SQLite enabled). Tests cover disconnect and recovery, restart with an offline root, preservation of movie/manga indexes, worker timeout fallback, damaged snapshots, changed roots, intentional removals, a stalled periodic check, immediate rescan acceptance, and HTTP availability.

The tests use local fixtures and simulated stuck workers; they are not a throughput benchmark or a reproduction against your actual NAS. If running in a restricted environment whose temporary directory disallows rename, set `IO_TEST_ROOT` to a writable local test folder.
