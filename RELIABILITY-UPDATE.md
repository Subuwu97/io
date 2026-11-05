# IO 1.1 reliability and subtitle update

Song lyrics default to steady near-white text with soft white/violet side glints and an underline shimmer. There is no flashing yellow text. Reduced-motion settings are respected. Select **Original ASS styling** in subtitle appearance to render authored ASS karaoke, positioning, vector drawings and animations with JASSUB and embedded fonts. That option preserves the subtitle author's colors and effects. Picture-in-picture uses basic captions. Native phone/TV/WPF clients still use their existing caption fallback; full ASS support in this update is in the web player and browser-based desktop wrapper.

## Reliability and security

Failed or timed-out network scans retain saved catalogs, including across restart after a successful scan establishes a snapshot. HTTP starts before scanning. Playback filesystem operations and stream reads use bounded workers; periodic network checks have deadlines. Missing shares remain visible with their last successful scan and error rather than silently emptying the library. See NETWORK-DRIVES.md for share setup.

Watch parties require a valid account session, reject foreign browser origins, use server account names and enforce room/message limits. Path checks reject sibling-prefix traversal. Password hashing is asynchronous with bounded concurrency and safe concurrent first-account registration.

Transcode capacity and waiting time are bounded and configurable in the admin dashboard. Defaults are two software or three hardware slots, twelve waiting requests and a thirty-second wait deadline. Probe and ASS extraction work also have bounded queues and deadlines. HLS/JASSUB assets and licenses are included locally.

## Measurements and health

The player measures startup to first rendered frame (or the playing event fallback), buffering after playback begins, dropped/total frames where supported, errors and playback mode. Measurements are available in Admin Health; no measurement panel appears beneath the video. Authenticated reports are held only in server memory for thirty minutes, up to five hundred sessions. Admin health shows median/p95 startup and aggregate stalls, drops and errors. These are real client reports, not benchmark claims; seeking and paused time are excluded from stalls.

Admin health distinguishes saved drive catalogs, scan failures and last-success times. GPU encoder capability is separate from live telemetry and actual playback success. NVIDIA telemetry uses nvidia-smi when available; unsupported/unavailable telemetry is shown explicitly rather than as a healthy zero reading. Intel/AMD live telemetry is not implemented.

## Install on the server

1. Stop IO. Back up the existing installation, configuration, data directory and certificates.
2. Copy updated source files including server/, public/ (especially public/vendor/), package.json and package-lock.json over the installation. Preserve your data, configuration, certificates and media.
3. With supported Node.js (22.5 or later), run `npm ci --omit=dev`, then start.bat. Built player assets are included; no vendor build is required for normal installation.
4. Confirm `/api/version` reports build `reliability-ass-shimmer-2026-11-05`, review admin health, complete one successful library scan and try an actual song subtitle track.

For development, run `npm ci`, `npm run build:vendor` and `npm test`. Third-party notices and upstream source links are in public/vendor/THIRD-PARTY.md.

Fourteen automated tests passed, including offline/restart recovery, timeout deadlines, a real ranged video response, async account operations, authenticated watch parties, queue limits, metrics and preservation of synthetic ASS karaoke/drawings/fonts. Browser checks confirmed JASSUB initialization and steady text with animation confined to glints. Real NAS throughput, long fansub sequences and each native device still need testing on your installation. Repository updates do not deploy to your running server or replace its TLS certificate.
