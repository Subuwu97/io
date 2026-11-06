# Encrypted server-state backup and recovery

Stop I/O before creating or restoring a server-state backup. The server and backup tool share a data-directory lock; current I/O versions refuse concurrent use. Keep using the same I/O source version when first recovering a backup, then update normally.

Privately set `IO_BACKUP_PASSPHRASE` to a unique passphrase of at least 16 characters in your local terminal. Do not put the passphrase in a command argument, repository, screenshot or chat. Store it separately: recovery without it is not possible. Clear the environment variable afterward.

Commands, run from the I/O installation folder:

```text
node scripts/server-state.cjs create <new-archive.io-backup> <stopped-data-directory>
node scripts/server-state.cjs inspect <archive.io-backup>
node scripts/server-state.cjs restore <archive.io-backup> <new-empty-data-directory>
```

Backups use authenticated AES-256-GCM encryption with a random salt/nonce and scrypt password derivation. They include the database, server/service configuration, encrypted integrations and their encryption key, the saved library index, uploaded profile pictures/banners and custom avatar gallery. File names, sizes and hashes are verified during recovery. The archive is limited to 256 MB of state, 128 MB per file. Media files, generated caches and application source are separate backups.

Recovery refuses to overwrite an existing installation. Inspect the archive first, restore into a new empty directory, set `IO_DATA_DIR` to that directory, then start I/O. Review media paths for the target machine. Existing data remains available for rollback by switching back to its directory.

Restoration clears account sessions, recovery/OAuth challenges, pending sync jobs, pending outbound messages, TV registrations and watch-activity state. Tracker automation and Discord activity keys are disabled so an old snapshot cannot automatically overwrite current remote progress or reuse revoked device sessions. Reauthenticate, re-pair TVs, issue a new activity key and review external-service settings before enabling automation again. Passkeys, password hashes, account data and encrypted provider credentials remain private within the encrypted backup.

If validation fails, the tool preserves a staging directory for inspection and reports the failure. Choose a fresh empty directory when retrying. Never publish the decrypted restored data or the backup passphrase.
