# Release testing and production setup

The browser application and native TV previews have different release status. Do not interpret passing server tests as native-device certification or verified external account connections.

## Isolated deployment

Keep I/O on port **5921** with a separate data directory and media mounts. Minami's files, database and port remain separate. Use Node 22.5 or newer and install ffmpeg/ffprobe. Run `npm ci --omit=dev` followed by `npm start`, setting `IO_DATA_DIR` to a persistent directory outside the source checkout.

### Windows (PowerShell)

From the extracted I/O source folder:

```powershell
npm ci --omit=dev
$env:IO_DATA_DIR = "$env:LOCALAPPDATA/I-O/data"
$env:PORT = '5921'
npm start
```

Keep the terminal running while testing. For an unattended server, use your normal Windows service or scheduled-task setup under the same user, with the same working folder and environment. Keep the data location fixed between restarts and upgrades.

### Linux/macOS

From the I/O source folder:

```sh
npm ci --omit=dev
IO_DATA_DIR="$HOME/.local/share/io" PORT=5921 npm start
```

For unattended operation, run the same Node process under your service manager with an explicit working directory, persistent data path and restart policy. Install ffmpeg/ffprobe on the host; add Poppler's `pdfinfo` and `pdftoppm` for PDF manga. Configure your actual media folders in I/O Settings. Run I/O as a normal user with read access to its media and write access to its own data directory.

### Check the running server

In a second terminal:

```sh
npm run healthcheck
```

For another server address, use `npm run healthcheck -- https://your-io-address.example`. This checks the running server without changing settings.

For public access, put the Node server behind your HTTPS reverse proxy. Forward WebSocket upgrades as well as ordinary HTTP requests, allow uploads up to 10 MB, and allow long streaming connections. Keep the upstream port private. Set I/O's public HTTPS address in **Email & sign-in setup** before testing passkeys, OAuth callbacks or outbound account links. The address must match your browser's address exactly.

The `/healthz` endpoint returns a minimal database health response. Admin health screens provide detailed drive and playback diagnostics. Monitor free disk space, process restarts and backup failures. Back up the persistent data separately from source and media, then perform a restore into a new empty folder using [server-state recovery](SERVER-STATE-BACKUP.md).

## Acceptance checks before launch

- Create the initial administrator, disable self-registration or require approval as intended, and test a basic account and a child profile separately.
- Browse/search real library artwork on desktop, phone and tablet. Test the custom home banner at its selected position and with the entry hidden.
- Play original and transcoded media, select audio/subtitles, seek and resume, play a long high-bitrate title, interrupt the network and reconnect. Check external subtitles and embedded ASS subtitles separately.
- Test profile privacy, friend acceptance, blocking, comments/GIFs, reports, notifications and account export/restore with disposable accounts. Verify that account deletion affects only the selected account.
- Test email verification, password reset and export delivery using your own SMTP service. Test Discord linking and activity on Discord Desktop. Keep these features disabled until their real flow passes.
- Connect a disposable MAL/AniList test account. Review a single-title change before bulk/automatic sync, test a conflicting edit, and confirm paused/repeat entries remain protected. Verify exact title/season mappings before publishing progress.
- Enroll and use a passkey on the final HTTPS domain, including another device and a failed/wrong-origin attempt. Changing the domain later requires re-enrollment.
- Install Android/Fire/Google TV and Roku previews on actual target devices; test remote focus, pairing expiry/revocation, background/resume, stream duration and network interruption. Apple TV must first be compiled and signed with Xcode on a Mac. Preview debug packages are not store releases.
- Stop the server, back up its data, restore into a fresh folder, start the restored instance on an isolated port, and verify local data before enabling integrations again.

The owner must complete real-service and hardware checks. Exact Serika parity and store certification remain unverified; see [current gaps](FEATURE-GAPS.md).
