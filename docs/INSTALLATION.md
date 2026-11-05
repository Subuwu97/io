# I/O

A self-hosted anime streaming & manga reading service that runs entirely on
your own machine and reads from local folders on disk. No accounts, no
cloud, no internet required after setup. Works identically on **Windows**
and **Linux** (and macOS) because it's just Node.js.

---

## 1. Install Node.js

You need Node.js 22.5 or newer (I/O uses Node's built-in SQLite
support for accounts/profiles, which needs a reasonably recent version).

- **Windows:** download the installer from https://nodejs.org (LTS version)
  and run it. This also installs `npm`.
- **Linux (Debian/Ubuntu):** the version in `apt` is often too old - use
  [NodeSource](https://github.com/nodesource/distributions) or
  [nvm](https://github.com/nvm-sh/nvm) instead:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install nodejs
  ```
- **Linux (Fedora):**
  ```bash
  sudo dnf install nodejs
  ```
Check it worked:
```bash
node --version
npm --version
```

## 2. Install FFmpeg (optional, but recommended)

Many anime rips are MKV files with AC3/DTS/FLAC audio, which **browsers
cannot decode natively** - the video will play but there'll be no sound.
I/O detects this automatically and, if FFmpeg is installed,
transcodes just the audio track to AAC on the fly (video is copied
untouched, so this is fast and lossless for picture quality). FFmpeg is
also required for the audio-language / subtitle track picker.

- **Windows:** download a build from https://www.gyan.dev/ffmpeg/builds/
  (the "essentials" build is enough), unzip it, and add the `bin` folder to
  your PATH. Verify with `ffmpeg -version` in a new terminal.
- **Linux (Debian/Ubuntu):** `sudo apt install ffmpeg`
- **Linux (Fedora):** `sudo dnf install ffmpeg`

If FFmpeg isn't installed, I/O still works and streams files
directly - you just won't get audio-track fixing or the subtitle picker
for files that need them.

**Hardware acceleration:** if your server has an NVIDIA GPU (NVENC),
Intel Quick Sync (most Intel CPUs since ~2011), an AMD GPU (AMF, mainly
on Windows), or another VAAPI-capable GPU (Linux), I/O
detects and uses it automatically for the on-the-fly video re-encodes
described above (fixing an unsupported codec like HEVC, or a quality
downscale) - this is dramatically faster and uses a fraction of the CPU
compared to software encoding, which matters if more than one person
might be streaming at once, or you're running on modest hardware like a
NUC or NAS box. Nothing to configure; check Settings for the detected
status, or look at the server's startup log (`Video transcoding: ...`).
There's a toggle in Settings to force software-only encoding if you
ever suspect a driver issue.

## 3. Install poppler-utils (optional, only for PDF manga)

If any of your manga chapters are `.pdf` files, page-by-page reading needs
`pdftoppm`/`pdfinfo` from poppler-utils to render each page as an image.
CBZ, EPUB, and plain image folders don't need this - only PDF chapters do.

- **Windows:** download a build from https://github.com/oschwartz10612/poppler-windows/releases
  (get the "Release" zip), unzip it, and add its `Library\bin` folder to
  your PATH. Verify with `pdftoppm -v` in a new terminal.
- **Linux (Debian/Ubuntu):** `sudo apt install poppler-utils`
- **Linux (Fedora):** `sudo dnf install poppler-utils`
- **macOS:** `brew install poppler`

Without it, PDF chapters still show up in your library - they just open
in a new browser tab using the browser's own PDF viewer instead of the
in-app page reader.

## 4. Install Node.js dependencies

Open a terminal (Command Prompt / PowerShell on Windows, or your shell on
Linux) inside this project folder, then run:

```bash
npm install
```

This installs Express and WebSocket support (`ws`) into `node_modules/`.
For a reproducible install from the committed lockfile, use `npm ci`.

## 5. Add your media

Drop your files into these folders (see the `README.txt` inside each
for the exact layout expected):

```
media/anime/<Show Name>/[Season 01/]episode.mp4
media/movies/<Movie Title>.mp4              (or in its own folder - see media/movies/README.txt)
media/manga/<Manga Title>/Chapter 001/page.jpg
```

You can also point `mediaPaths` in your `config.json` (in the persistent
data folder - see "Keeping your data across updates" below, or just use
the in-app Settings page) at folders anywhere else on your disk (e.g. an
external drive or a NAS mount) instead of copying files into this project:

```json
"mediaPaths": {
  "anime": "D:/Anime",
  "movies": "D:/Movies",
  "manga": "D:/Manga"
}
```
(Use forward slashes even on Windows.)

## 6. Run it

**Easiest way:** double-click `start.sh` (Linux/macOS) or `start.bat`
(Windows) in the project folder. It checks that Node.js is installed
**and new enough** (22.5+, with a clear message telling you exactly
what to update if not), enables Node's SQLite module automatically on
the couple of Node 22.x versions that ship it behind a flag, warns if
FFmpeg is missing, runs `npm install` automatically the first time, and
then starts the server. If anything goes wrong, the window stays open
with the actual error visible instead of just closing.

**Manual way**, if you'd rather use a terminal:

```bash
npm start
```

## 7. Start automatically on boot (optional)

If this is running on a machine that should just always have IO
Project available - a home server, a mini PC tucked away somewhere -
you can have it launch automatically when the machine starts, without
needing to log in and double-click `start.sh`/`start.bat` yourself.

**Windows:** right-click `install-autostart.bat` and choose **"Run as
administrator"**. It creates a Windows Task Scheduler task that starts
the server at boot, running completely hidden in the background (no
console window) - `autostart.log` in the project folder captures its
output since there's nothing visible to see it in otherwise. To
remove it later, run `uninstall-autostart.bat` (also as
administrator).

**Linux (systemd-based distros - Ubuntu, Debian, Fedora, Arch, and
most others):**
```bash
sudo ./install-autostart.sh
```
This installs and starts a systemd service that launches at boot -
even before anyone logs in - and restarts itself automatically if it
ever crashes. Check on it any time with `sudo systemctl status
io-stream` or watch its live log with `sudo journalctl -u
io-stream -f`. Remove it with `sudo ./uninstall-autostart.sh`.

Both installers detect your Node.js version and re-check everything
`start.sh`/`start.bat` already checks (including the couple of Node
22.x versions that need the SQLite flag), so you don't need to set
anything up differently first - just run the normal setup steps above
once, then install auto-start whenever you're ready.

You'll see:
```
================================================
 I/O is running
 http://localhost:4821
 Anime titles found: X
 Manga titles found: Y
================================================
```

Open **http://localhost:4821** in your browser. To use it from another
device on your home network, visit `http://<your-computer's-LAN-IP>:4821`
instead of localhost.

To stop the server, press `Ctrl+C` in the terminal.

## 8. Using the app

- **Accounts:** the first time you open I/O, you'll create the
  admin account (username + password). This account manages the media
  library and site settings, and can add further accounts for everyone
  else in your household from Settings → Manage Accounts (each new
  account can be "User" or "Admin"). Every account has its own completely
  separate set of profiles, watch history, and My List — nobody sees
  anyone else's. Only Admin accounts can rescan the library, change site
  settings, or import from MyAnimeList; User accounts can watch, read,
  and manage their own profiles freely.
  - **Forgot a password?** There's no email system on a self-hosted
    server, so an admin resets it instead — Settings → Manage Accounts →
    "Reset Password" next to that account. This doesn't require knowing
    their old password.
  - **Signed-in devices:** every account's Settings page has a "Signed-in
    Devices" section listing everywhere it's currently logged in, with a
    button to sign out any one of them (or everywhere else at once).
    Handy after using "Sign in with QR code" on a device you don't want
    to stay signed in, like a friend's phone used just to approve one.
  - **Admin Dashboard** (avatar menu → Admin Dashboard, admins only):
    live CPU and memory usage for the machine the server is running on
    (refreshes automatically), plus every active session across *every*
    account on the server — not just your own — with a "Revoke" button
    to sign any of them out immediately. Useful once more than one
    person is actually using the server, to see who's connected and
    make sure nothing's using more resources than expected.
- **Signing in with a QR code:** typing a password on a TV remote is
  painful, so any device on the sign-in screen can click "Sign in with QR
  code instead" to show a QR code (plus the same code as plain text,
  in case scanning isn't convenient). On a device that's *already* signed
  in, open your avatar menu → **Sign In Another Device**, enter that code
  (or just scan the QR with your phone's camera, which opens the approval
  page directly), and tap Approve — the waiting device signs in
  automatically within a couple seconds, no typing required there. Codes
  expire after 5 minutes and can only be used once.
- **Notifications:** the bell icon in the navbar shows real notifications
  now, with an unread-count badge. Admin accounts can post one to
  everyone (e.g. "New season added!") from the "+ New" button inside the
  bell's dropdown — it shows up for every account/profile on the server,
  with read state tracked per profile so everyone's unread count is their
  own. Admins can delete a notification (the &times; on each item) to
  remove it for everyone. The server also posts one **automatically**
  whenever a rescan finds new episodes/chapters added to a title someone
  actually has in their My List, Top Picks, or watch history — nothing
  fires for your existing library the first time you set things up, only
  for genuinely new content on things you're already tracking.
- **Browsing & discovery:**
  - **Genres** (top nav) lists every genre in your library as a pill you
    can click to see everything tagged with it.
  - **Most Watched** on the home page is real aggregate watch time across
    everyone on your server — not a fake trending list, just what your
    own household actually watches.
  - **"NEW" badges** show up on posters for anything added to your
    library in the last two weeks.
  - The shuffle icon (navbar, next to search) jumps to a random title,
    preferring things you haven't started yet.
  - Search has genre and sort filters (A-Z, Recently Added) alongside the
    text box, for narrowing down a large library.
- **Profiles:** after signing in you'll land on a "Who's watching?"
  screen, just like the reference screenshots — this is per-account, so
  each person's household login gets their own profile picker. Click a
  profile to enter, or "Add Profile" to create a new one with a custom
  name, avatar, and banner color. Click "Manage Profiles" to edit or
  delete existing ones.
  - **PIN lock:** give a profile a 4-6 digit PIN from the Add/Edit
    Profile screen so it can't be opened without it — the profile picker
    shows a lock icon on protected ones. Useful for a household where
    not everyone should be able to switch into everyone else's profile.
  - **Kids profiles:** tick "Kids Profile" in the same screen to hide
    anything tagged with a mature rating (R+, Rx, TV-MA, NC-17, etc. —
    set per-title via `info.json`, or picked up automatically from a
    MyAnimeList/AniList import) from browsing, search, and even direct
    links on that profile.
  - Instead of a preset avatar/banner, click "Upload your own photo/image"
    in the Add/Edit Profile screen to use your own picture (it's resized
    in your browser before upload, so even large phone photos stay
    small). You can also update your banner or profile photo directly
    from your profile page — the camera icon on the banner and on your
    avatar — matching the layout in the reference screenshot.
- **Home:** rotating hero banner of your recently-added shows, plus rows
  for Continue Watching, New Episodes, Your Series, and Manga Library.
- **Series / Movies / Books / New & Popular:** browsable grids of your
  whole library. A title with only one episode is treated as a "Movie".
- **Watching:** click any episode to stream it. Playback position is
  saved automatically every few seconds and resumes next time. Controls
  live in the bar at the bottom of the player (play/pause, seek, volume,
  fullscreen) and stay visible even in fullscreen, since fullscreen
  covers the whole player rather than just the video itself.
  - If a file has more than one audio track (e.g. dub + sub), or its
    default audio codec isn't browser-friendly (common on MKV anime
    rips with AC3/DTS audio), a speaker button on the control bar opens
    a menu to pick the language. When FFmpeg needs to fix the audio, a
    small "Audio fixed for playback" badge shows up top-right.
  - Audio is only ever re-encoded when it actually has to be - if it's
    already a codec your browser can play, it's copied through
    bit-for-bit (e.g. when you pick a lower video quality but the audio
    was already fine, there's no pointless extra lossy pass). When a
    re-encode genuinely is needed, it targets a solid 192kbps for
    stereo and scales up automatically for 5.1/7.1 surround sources
    instead of flattening everything down to stereo.
  - If the video itself is in a codec browsers can't play (HEVC/H.265
    is the common case - many phones/TVs and most browsers can't decode
    it without hardware support), FFmpeg automatically re-encodes it to
    H.264 on the fly, the same way it fixes audio. This needs FFmpeg
    installed on the server (step 2); without it, that file will fail to
    play and the player shows a clear explanation rather than a silent
    black screen or a cryptic browser error.
  - AV1 plays natively with no conversion needed at all (in an MP4 or
    WebM container, which is how AV1 rips are normally packaged) -
    browsers have supported it directly for years. If a specific device
    still can't decode it (some older phones/TVs lack AV1 hardware
    decode), picking a lower quality from the player forces a re-encode
    to H.264, which works on virtually everything.
  - Every common source format works: H.264, HEVC/H.265, AV1, VP9/VP8,
    and older codecs like MPEG-2/MPEG-4 all either play directly or get
    converted automatically. Efficient formats that desktop browsers
    play natively (AV1, VP9) pass straight through there, but are
    converted to universally-supported H.264 for phones and tablets,
    since most iPhones/iPads can't decode AV1 at all.
  - Any file that needs fixing before it'll play in a browser - wrong
    container (MKV is the big one), an incompatible codec like HEVC, or
    a quality downscale you picked - streams immediately on desktop
    browsers (same snappy start as always), while the same output is
    also cached in the background for next time. Mobile browsers (iOS
    Safari especially) are much stricter about needing genuine
    Range/seek support from the very first response, so on a phone or
    tablet it instead waits for that same cache to be ready before
    responding - a bit slower the first time a given file/quality is
    watched, but it actually plays reliably, and every later request
    (any device) is instant either way once it's cached. A simple
    container fix (video/audio already fine, just repackaging) skips
    all of this and is cached immediately either way since it only
    takes a couple of seconds regardless.
  - If a file's audio isn't English and an English subtitle track
    exists, it turns on automatically - no more hunting for it every
    episode. If an English dub track exists, that's used as the default
    audio instead of whatever the file marks as "default" (often
    Japanese). Once you manually pick something different for a given
    profile, that choice is remembered instead and always wins.
  - If the file has embedded subtitle tracks, a "CC" button on the
    control bar lets you turn them on/off and pick the language (soft
    subs are rendered by the browser via WebVTT, so this works even
    without re-encoding).
  - An "HD" button lets you drop to a lower resolution (1080p/720p/480p,
    whichever are below the source's native resolution) for a slow
    connection or older device. Switching quality re-encodes on the fly,
    so there's a short pause while it catches up.
  - A "Skip Intro" button appears during the opening and a "Next
    Episode" button near the end, based on either the exact timings you
    set in that show's `info.json` (see `media/anime/README.txt`) or a
    generic guess (skip the first/last ~90 seconds) if you haven't.
  - In the last 10 seconds of an episode, an "Up Next" card shows the
    next episode with a countdown, auto-playing it when it reaches zero
    (Cancel stops it, Play Now skips the wait). Turn this off per-profile
    in Add/Edit Profile → "Autoplay next episode" if you'd rather it just
    stop and let you choose each time.
  - Your last-picked audio language and subtitle language are remembered
    per profile and applied automatically on the next episode or show, so
    you don't have to reselect "English dub" (or whatever you prefer)
    every time.
  - Subtitle size and color are customizable from the Subtitles/CC panel
    (size: small/medium/large; color: white/yellow/cyan/red) - saved per
    profile, same as everything else here.
  - A Cast button appears in the control bar if your browser supports
    AirPlay (Safari) or Chromecast (Chrome, once Google's Cast SDK loads
    - it's fetched from their CDN, so this needs your browser to have
    internet access even though the video itself streams from your own
    server). It's simply absent if neither is available - nothing else
    depends on it.
  - Audio/subtitle/quality selection requires FFmpeg to be installed
    (see step 2). Without it, the file plays as-is with its default
    audio/subs/quality - skip intro/outro and fullscreen still work.
  - "Mark as Watched" (a checkmark button next to each episode, plus a
    "Mark Season as Watched" button above the episode list) lets you flag
    individual episodes as done without actually watching them again -
    useful if you'd already seen something elsewhere. Episodes are also
    marked automatically once you're about 90% through them during
    normal viewing. The "Play"/"Resume" button on a title's page uses
    this to jump to your actual next unwatched episode, not always
    episode 1.
  - Everything you watch shows up in **Watch History** (avatar menu),
    a full chronological log separate from Continue Watching (which
    only shows what's currently in progress).
  - Subtitles stay in sync when seeking or resuming mid-episode during
    conversion playback - the subtitle timing is re-based to the seek
    point automatically (previously, jumping around could leave
    subtitles frozen or offset by exactly the seek amount).
  - Seeking never restarts the episode from the beginning. On the first
    watch of a file that needs converting, each seek restarts the
    conversion FROM the seek point (a couple seconds of buffering) - and
    once the background cached copy finishes (checked quietly during
    playback), seeking upgrades to instant, native jumps for the rest of
    the session and every session after.
  - On phones and tablets, playback always uses complete, seekable
    files (a live conversion stream simply doesn't play on mobile
    browsers) - resume and seeking work natively, and mobile subtitles
    never need timestamp adjustment at all.
  - Subtitle text is cleaned automatically: some FFmpeg versions leak
    styling codes from fansub files into the converted subtitles - ASS
    override blocks with hex colors and positions (the "hex codes and
    numbers" that can appear on screen), stray formatting escapes, and
    HTML font tags. All of that is stripped server-side no matter which
    FFmpeg version produced it. This also fixed a specific bug: signs
    drawn with a background shape behind real text (a single subtitle
    line combining a vector drawing AND dialogue) could leak the raw
    drawing coordinates directly next to the real words - that whole
    drawing span is now removed as one unit rather than just its tags,
    and cues that are nothing but a drawing are dropped entirely.
  - The home screen has a **Recently Added** row, and the rotating hero
  banner at the top shows your 5 most recently added series too - both
  genuinely sorted by when each title was actually added to *this*
  library, not by anything derived from the files themselves. That
  distinction matters: download tools, torrent clients, and archive
  extractors often preserve a file's original release timestamp rather
  than setting it to when it landed on your machine, so a filesystem
  timestamp alone is an unreliable way to know what's actually new to
  your library. Instead, the first time the scanner ever sees a given
  title, it records that moment in its own database and keeps that
  as the permanent, stable "date added" from then on - regardless of
  what the files' own timestamps say, and regardless of how many times
  you rescan afterward. One nuance worth knowing: on the very first
  scan after updating to this (an existing library, not a fresh one),
  every title is - by definition - new to that tracking, so seeding
  every single one with "right now" would make them all look equally
  recent and lose whatever real order they already had. That one-time
  migration instead seeds from each file's own existing timestamp,
  preserving your library's real relative order - it's only titles
  added *after* that point where "now" is used, which is what actually
  protects against a misleadingly old preserved file timestamp.
- Fixed two real seeking bugs on desktop, confirmed with a direct
  simulation of the exact state transition (not just theory): (1) rapid
  seeking could let a stale, already-superseded seek "win" a moment
  later and snap playback back to wherever it was heading; (2) more
  seriously, the tracked playback position could silently jump backward
  by however many minutes you'd seeked ahead - with no seek involved at
  all - the instant the background cache for that episode finished
  mid-watch, because the position calculation and the actual stream's
  timing basis could briefly disagree. Both are fixed - each seek is
  tagged so a stale one can't win, and the position calculation now
  always agrees with whatever the current video source actually is.
- Subtitles stay in sync through seeks. During a live conversion the
    video clock restarts at the seek point, so the subtitle file's
    timestamps are re-based server-side to match - and once an episode's
    converted copy is fully cached, the player switches to normal native
    seeking where subtitles never need adjusting at all. (This fixed a
    real bug where seeking after the background cache finished could
    restart the video at 0:00 while subtitles stayed shifted -
    subtitles appeared stuck on the wrong lines.)
  - Subtitles stay in sync through seeks: their timestamps are
    re-based to every jump, and the subtitle text itself is extracted
    from the file once and cached - previously every seek re-read the
    entire media file to rebuild them, which left subtitles blank or
    frozen for many seconds after jumping around.
  - Subtitle appearance is adjustable per profile from the player's
    Subtitles/CC menu: size, text color, and the background - the
    classic black box, a subtle see-through one, or no box at all with
    outlined text that stays readable over bright scenes. Remembered
    automatically for each profile.
  - The episode list on a series page is a grid of cards (thumbnail,
    title, and real runtime once it's fetched - a lightweight metadata
    read done in the background so the grid itself never waits on it),
    with the season picker as a pill next to a small menu for bulk
    actions like marking a whole season watched. Click a card's corner
    badge to mark that one episode watched/unwatched directly, without
    opening it.
  - The player's back/exit button always returns to the series page
  directly, rather than relying on the browser's own back button
  behavior - watching several episodes in a row via autoplay/next each
  pushes its own step into your browser history, so relying on that
  would only ever step back one episode at a time instead of actually
  returning to the series.
  - Standard keyboard shortcuts: Space or K play/pause, Left/Right
    arrows skip 10 seconds, Up/Down adjust volume, F fullscreen, M mute.
  - A Picture-in-Picture button (next to fullscreen) pops the video out
    into a small floating window that stays on top while you do other
    things - shown only in browsers that support it.
  - Episode lists show a real frame from ~20% into each episode instead
    of repeating the series banner - generated the first time each
    episode's row scrolls into view, instant afterward.
  - Genre filters on the Series/Movies/Books pages support selecting
    multiple genres at once (tap a genre again to remove it) - results
    narrow to titles matching *all* selected genres, so picking Action
    and Comedy together shows things that are both, not either.
  - Hovering (or scrubbing on touch) the seek bar shows a small preview
    thumbnail of that moment in the episode. The preview strip is
    generated once per episode in the background the first time it's
    played, so it may not appear for the very first minute or so of a
    brand-new episode - after that it's instant, forever.
  - Halfway through an episode, the *next* one quietly starts being
    prepared in the background, so "Next Episode" and autoplay start
    instantly instead of waiting on a fresh conversion - biggest win on
    phones, where the prepared copy is exactly what mobile playback
    needs anyway.
  - Hover a card in **Continue Watching** and an &times; appears -
    "Remove from Continue Watching" hides it without losing your place:
    start watching again later and it comes back, resuming exactly
    where you left off. (On phones the &times; is always visible.)
- **Reading:** click into a manga title and a chapter to open the page
  reader. Use the on-screen Prev/Next buttons or the left/right arrow
  keys to turn pages. Chapters can be plain image folders, `.cbz`, `.epub`,
  or `.pdf` files (mixed freely within the same title) - see
  `media/manga/README.txt` for the exact layout. PDF chapters need
  poppler-utils (step 3) for page-by-page reading; without it they open in
  a new browser tab instead.
- **My List / Account page:** click your avatar → My List to see your
  saved titles, watch history, top picks, reviews, and comments (mirroring
  the reference profile screenshot). Double-click the status line under
  your name to edit it, just like the screenshot. From any show or manga
  page you can pin it as a "Top Pick" (up to 5) or "Write a Review" —
  both show up in the matching tabs on your profile page. Every show
  and manga's own page also has a **Reviews** section further down —
  an average rating, star breakdown, and everyone's individual reviews
  for that specific title, not just your own. Right below that, if a
  title was ever imported from MAL and/or AniList, an **External
  Links** section shows direct buttons out to its page on whichever of
  those it has - only the ones that actually apply are shown, and the
  whole section stays hidden if neither does. Titles imported from
  AniList also get real per-episode titles on the episode grid, where
  AniList actually has them (sourced from streaming partner data, same
  as the rest of this integration) - worth being upfront that AniList's
  public API has no per-episode overview/synopsis field, and that kind
  of editorial writing is specific to licensed streaming platforms with
  their own content deals, so there's no legitimate free source for
  that. Episode cards show the real title where one exists, and the
  actual filename otherwise - never anything invented. The home
  screen's
  rotating hero banner prefers a genuinely wide, high-resolution
  banner image over a stretched poster - MAL's own API doesn't really
  have an equivalent to AniList's dedicated banner field (its "banner"
  is really just the last image in a promotional gallery, usually
  another portrait poster), so importing via MAL now also does a
  quick best-effort AniList lookup just for a better banner image,
  without touching any of the rest of MAL's own title/description/
  genre data. The dots under the hero banner now animate smoothly
  between slides instead of snapping instantly. Titles imported from
  AniList specifically also get a **Cast & Production** section -
  voice actors with the character they play, plus key staff like
  writers and composers, the same kind of credits listing you'd see on
  AniList's own site - cached after the first fetch so it doesn't
  re-hit AniList's API on every visit. This one needs AniList
  specifically since MAL's public API doesn't expose this data as
  readily.
- **Importing posters & info from MyAnimeList or AniList:** any anime,
  movie, *or manga* title missing a cover and description is
  automatically matched and filled in every time the library is
  scanned — at server startup and whenever an admin clicks Rescan — no
  need to import each title by hand. Two sources are supported:
  MyAnimeList (needs a free Client ID, see below) and **AniList, which
  needs no API key or account at all** and works immediately. Pick
  which one auto-enrichment uses in Settings. Either way, you can still
  open any show, movie, or manga's detail page and click "Import
  Metadata" to search manually with either source and pick a specific
  match — e.g. to fix one title the automatic match got wrong, or to
  pull from whichever source has better data for that particular title
  — without waiting on a full rescan. Auto-enrichment also falls back
  automatically per-title: if your primary source (whichever is chosen
  in Settings, MAL by default) doesn't find a confident match - or
  errors out entirely - for a given title, it automatically retries
  that one title with the other source before giving up on it. This
  applies to anime, movies, *and* manga alike. AniList is always
  available as a fallback (it needs no key); MAL only gets tried as a
  fallback if a Client ID is actually configured.
- **Settings:** change the site name, accent color, MyAnimeList Client
  ID, and which source auto-enrichment uses, and trigger a manual
  library rescan after adding new files (found via your avatar menu →
  Settings).

## Notes on image-based subtitle tracks

Some subtitle tracks - especially an official English track bundled
alongside a fan-translated one on a Blu-ray-sourced release - are
image-based formats (PGS, DVD subtitles) rather than text. Those are
literally pictures of text, not text data, so they can't be extracted
or displayed at all - that would need OCR, which isn't supported. This
used to fail silently: the track would appear selectable, get picked,
and just show nothing with no indication why. Now: these tracks are
skipped by automatic subtitle selection entirely (so the app never
silently picks one that's guaranteed to fail), they're labeled
"image-based, may not display" in the subtitle menu if you want to try
one anyway, and selecting one shows a clear message explaining why
instead of just going blank.

## Filtering by studio

Anime and movies pages now have a Studio filter alongside the existing
genre chips and sort dropdown - a dropdown rather than chips, since a
large library can realistically have dozens or hundreds of unique
studios, unlike the smaller, bounded set of genre tags. Studio data
comes from MAL/AniList the same way genres do (AniList specifically
uses only the main animation studio, filtering out secondary
production companies) - it's populated automatically the next time a
title is imported or re-imported from either source, and stays empty
for anything that hasn't been enriched yet, same as any other
MAL/AniList-sourced field. Manga doesn't get this filter, since studios
aren't a manga concept.

## Notes on library scan performance and reliability

Two real issues were found and fixed here, both about the scanner
itself rather than anything you'd need to configure:

- **Counting pages in a CBZ chapter used to read the entire chapter
  file into memory** - every page's full image data - just to find
  out how many pages it has. For a large manga library with sizable
  chapters, that's a lot of wasted I/O and memory during every scan.
  Listing what's inside a zip only actually needs its central
  directory - a compact index that's always near the end of the file -
  so this now reads only a small tail portion of each file instead of
  the whole thing, producing identical results measurably faster
  (verified directly - same entries, same page counts, meaningfully
  less time and I/O even on a modest-sized test file, with the gap
  growing for larger real chapters since the new approach's read size
  never grows with the file). An early version of this had a real
  bug: a single read call isn't guaranteed to fill the entire
  requested amount in one go, especially for a read this size, and
  assuming it always would meant some real-world CBZ files failed to
  be read at all ("not a valid zip file") purely because of where the
  file happened to land relative to how much actually came back from
  one read call - fixed by looping until the full amount is genuinely
  read, verified directly by forcibly simulating partial reads and
  confirming the fix handles it correctly where the original code did
  not. It only falls back to a full-file read for the one case that
  can genuinely benefit from it (an unusually large central directory
  starting further back in the file than the initial read covers) -
  not when the index isn't found at all, since the initial read window
  (2MB) is already about 30x larger than the maximum possible distance
  for a valid zip file's index from its end. If it's genuinely not
  there, the file is corrupted, truncated, or not really a zip at all
  - and reading the rest of it first, only to still fail, would be
  pure wasted time for exactly the files where that cost matters most.
  Manga chapters within a title are also now processed with modest
  concurrency instead of strictly one at a time, meaningfully reducing
  total scan time for a large manga library - the same reasoning
  already used for MAL/AniList enrichment elsewhere in this project.

  A few more reinforcements on top of that: the tail-read window itself
  was reduced (2MB down to 512KB - still about 8x more than any valid
  zip file's index could ever need), and chapter concurrency was
  brought down from 4 to 2, both trading a little raw speed for a
  meaningfully smaller peak resource footprint. The server log now also
  times each of the three folders on every scan, so exactly how long
  each one took is immediately visible in the log rather than something
  that has to be guessed at from the outside.

  One thing worth being candid about: an earlier version of this also
  added a fixed 512MB memory ceiling per scanning worker, intended as a
  safeguard. That turned out to be a real risk of its own - Node's own
  default heap limit is typically well above that on most systems, and
  a genuinely large manga library (many titles, many chapters) can
  legitimately need more than 512MB just to hold its own data in
  memory, with nothing actually wrong. An arbitrary ceiling picked
  without knowing the real library size could end up crashing a scan
  that would otherwise have finished fine - worse than the problem it
  was meant to prevent. That's been removed in favor of Node's own
  default, and the worker's crash-detection log now specifically calls
  out when a crash looks memory-related, so if anything like that ever
  happens again it's immediately obvious from the log rather than
  looking like an unrelated failure.

  A real report showed something important: anime and manga both
  hitting the *exact same* scan timeout when scanned together, even
  though anime finishes fine entirely on its own. That's a strong sign
  of genuine resource contention between them on that machine - even
  though each root scans in its own fully isolated worker thread with
  no logical dependency on the others, isolation at the JavaScript
  level doesn't mean isolation from the underlying CPU/disk they all
  still share. The three folders are now scanned one at a time instead
  of all three simultaneously, which removes any possibility of that
  entirely - anime goes first, since it's the largest/most important
  library for most people, so it becomes available as quickly as
  possible without competing with anything else for resources. Each
  one's cache still updates the moment its own scan finishes, so movies
  and manga are still available as soon as they're each done, without
  waiting on one another.

  Also worth knowing: the scan timeout increase from 90 to 240 seconds
  only ever applied to configs that didn't already have a value saved -
  anyone who'd been running an earlier version already had 90 saved
  explicitly, which looked identical to someone who'd deliberately
  chosen it, so the increase silently never reached existing
  installations at all. A one-time migration now bumps an existing 90
  up to the new default - safe even for someone who really did want 90
  specifically, since it only ever happens once, not on every restart.

  A genuinely large PDF chapter turned out to be its own real
  bottleneck, separate from everything above. Counting a PDF's pages
  prefers pdfinfo (part of poppler-utils) when it's available, but that
  isn't a tool Windows ships with by default - without it, the fallback
  used to read the entire PDF file into memory just to estimate a page
  count from it, exactly the same category of problem already fixed for
  CBZ files, just in a completely different code path. That fallback
  now samples a representative chunk and extrapolates proportionally
  from the file's actual size instead of reading the whole thing -
  verified directly against a realistic large test file: within about
  1.5% of the exact count, at roughly 13x the speed. The server log
  also now says plainly at startup whether pdfinfo was actually found,
  rather than silently falling back with no visibility into which path
  is actually running.
- **A slow manga scan used to hold anime and movies back too**, even
  though each one scans in its own fully isolated thread with no
  actual dependency on the others - all three were only ever made
  available together, gated behind the slowest one of the three to
  finish. Now each one updates the moment its own scan completes, so a
  large or slow-to-scan manga library can only ever delay manga itself
  (verified directly: with manga deliberately held up, anime is
  already correctly available well before manga finishes).

## Notes on subtitle rendering

Subtitles are drawn with a custom overlay rather than the browser's
native (CSS-limited) subtitle box rendering, closer to how Crunchyroll
presents overlapping dialogue. When multiple subtitle lines are active
at the same time - two people talking at once, or a longer line
wrapping - each one gets its own distinct rounded box with real,
visible spacing between them, which isn't reliably achievable through
the browser's native styling hooks (margin/padding aren't actually
part of the relevant CSS spec there, so they behave inconsistently
across browsers). Under the hood this still uses the browser's own
battle-tested WebVTT parser - only the actual on-screen drawing is
custom, not the parsing/timing, so sync and format support are
unaffected. One deliberate exception: while a video is in
Picture-in-Picture, subtitles temporarily fall back to the browser's
native rendering, since PiP only shows the video element's own
content and wouldn't display a separate overlay at all - switching
back automatically the moment PiP closes.

Karaoke-style song lines (OP/ED lyrics with a per-syllable highlight
effect) are a special case worth knowing about. That kind of
progressive highlighting is an ASS/SSA feature with no real equivalent
in WebVTT, so converting it often produces many overlapping,
very-short-lived cues - one per syllable-timing step - each holding
just a fragment of the line. Rendered the same way as normal dialogue,
every one of those fragments stacked as its own line and looked like a
jumbled mess. Genuine simultaneous dialogue (two people talking at
once) is virtually always just 1-2 unrelated lines, so this is
detected two ways: more than a couple simultaneous cues at once, or -
even with just two overlapping - one cue's text being a near-prefix of
the other's (more of the line getting progressively revealed), which
real independent dialogue essentially never looks like. Either signal
treats it as a song line instead: only the most recently started
fragment is shown (the current state, not every historical one), moved
to its own region near the top of the frame so it's out of the way of
any real dialogue that might also be active.
This won't reproduce the original fansub's animated per-syllable
highlight - WebVTT genuinely can't represent that - but it replaces
the jumbled stacking with a single clean, readable line.

WebVTT's small set of real formatting tags (`<b>`, `<i>`, `<u>`) also
render correctly as actual bold/italic/underline now, rather than
showing up as literal text like `<b>this</b>` on screen - a real gap
in the very first version of the custom renderer, since blanket-
escaping all subtitle text (the correct safe default in general) can't
tell "legitimate WebVTT markup" apart from anything else without
specifically allowing for it. Only that exact small tag whitelist is
allowed through; nothing else in subtitle text can render as real
HTML.

## Notes on image freshness

Cover, banner, and theme files are served with an aggressive 1-hour
browser cache for performance, but the URL for each one includes the
file's own last-modified time as a version tag - so re-importing
metadata (which replaces cover.jpg/banner.jpg in place) is reflected
immediately in your browser instead of only becoming visible up to an
hour later.

## Generating an HTTPS certificate (optional)

I/O supports HTTPS out of the box (see the security notes
above), but you need an actual certificate to point it at. For a
personal/home server without a public domain name, run:

```bash
./generate-cert.sh 10.50.100.235
```

(replacing that with whatever address you actually type into your
browser to reach this server - an IP on your local network, or a
hostname). On Windows, double-click `generate-cert.bat` instead - it
needs Git for Windows installed (https://git-scm.com/download/win),
since that's what actually provides `openssl` there; if you already
have Git, there's nothing else to set up.

This generates a self-signed certificate and automatically updates
your config to use it - just restart the server afterward. Your
browser will still show a warning the first time you visit, and
that's expected for a self-signed certificate: nothing external
vouches for it the way a certificate authority does for a public
domain, but the connection is still genuinely encrypted underneath
that warning. Click through it once ("Advanced" -> "Proceed") and
you're set. A common way self-signed certificates go wrong is only
covering the wrong address - this one is generated to cover
`localhost`, `127.0.0.1`, and the exact address you provide, so
whichever way you actually reach the server matches what the
certificate lists.

## Accent color

The app's default accent color is now the actual IO brand palette -
sakura pink and sunset orange, matching the logo and native client
apps - instead of a generic purple/magenta that had nothing to do with
the brand. This affects buttons, active nav states, the notification
badge, and gradients throughout the app; still fully customizable in
Settings if you'd rather use something else.

## Fixing stale JavaScript getting served after an update

Found a real, recurring cause of confusion, and fixed it two ways.
First, the app's own JS/CSS/HTML files were being cached by the
browser for a full hour by default, same as any other static asset -
a device could easily still be running an old, pre-update version of
the player for up to an hour after a genuine fix had already been
shipped, which looks exactly like "the fix didn't work" when it's
actually "the fix never even loaded yet." Those files now tell the
browser to always check back with the server before using a cached
copy.

That alone can only prevent NEW staleness going forward, though - it
can't force out an entry the browser already cached under the old
rules before this fix even existed, so a device could still need one
hard refresh to actually pick it up. For a stronger, permanent
guarantee, each local script/stylesheet reference in the page now
carries a version query param based on that specific file's own
actual last-modified time (e.g. pages.js?v=1785267232094) - a
versioned URL is a genuinely different resource to the browser, so no
existing cache entry can ever serve it stale, regardless of whatever
caching policy was in effect when that entry was created. Verified
this directly: confirmed the version updates correctly when a file
actually changes, confirmed external CDN references (the Google Cast
SDK, hls.js) are correctly left untouched, and confirmed a
version-suffixed URL still correctly serves the real file.

Images keep their existing longer cache, since those already have a
separate cache-busting mechanism and don't change nearly as often.

## Fixed the freeze navigating away from the player

Found a real, direct gap: the app already had a "guaranteed cleanup
point" pattern for stopping a show's theme song audio whenever
navigating to any new page, but nothing equivalent existed for the
active hls.js instance. hls.js's worker and MediaSource don't get
cleaned up on their own just because the video element they were
attached to got removed from the DOM - leaving the player page kept
that transcoding/decoding pipeline running in the background
indefinitely, which is a very plausible, direct cause of the page
feeling like it freezes for a moment on the way back to the series
page.

Fixed by moving the HLS player reference and its teardown to the same
level as the app's page-routing logic (previously it only lived inside
the player page's own local scope, reachable only when switching
sources within the player itself - never when leaving the page
entirely), and calling that teardown at the same guaranteed point the
theme-song cleanup already uses. Also confirmed the existing
progress-saving timer was already being cleaned up correctly on
navigation, so this was the one missing piece.

## Re-enabled hardware decode for AV1, for real speed

AV1 was previously forced to always use software decode specifically,
based on testing done before the real root cause of AV1 playback
issues (the -c:v copy bug just above) was found and fixed. Since video
was never actually being decoded at all under that bug - it was being
copied raw, regardless of any decode setting - decode method genuinely
could not have caused anything observed at the time. That restriction
was very likely based on an invalid conclusion the whole time.

Now that video is genuinely being transcoded, AV1 gets the same
hardware-decode-first treatment as every other codec, which should
meaningfully speed up AV1 transcoding on systems with real hardware
decode support (QSV/NVENC). Still protected by the existing watchdog
and automatic software fallback if a specific hardware/driver
combination genuinely doesn't support AV1 decode - this isn't a blind
re-enable, it's re-enabling with the same safety net already proven
to work correctly.

Verified thoroughly: ran a complete, real end-to-end test through the
server (not just a syntax check, after catching a dangling-reference
bug from this exact kind of edit once already) - confirmed no crash,
confirmed the correct fallback path is exercised when hardware isn't
available, and confirmed valid h264/aac output either way.

## The actual, complete root cause: AV1 was never being transcoded for HLS at all

"Audio and subtitles play, but no video" led directly to the real,
complete answer this time. Traced the actual ffmpeg command line the
server was constructing and found: -c:v copy. The video wasn't being
re-encoded at all - raw AV1 data was being copied straight into an
MPEG-TS container that fundamentally can't hold it, since HLS only
ever supported H.264 for video.

The root mechanism is identical to the earlier Opus audio bug: a
general "can browsers play this codec" check (which correctly
includes AV1, since browsers do support it natively in MP4/WebM) was
being reused to decide whether HLS output needed re-encoding, without
accounting for HLS/MPEG-TS's much narrower, H.264-only requirement.
This retroactively explains every AV1 symptom chased throughout this
entire investigation at once - the "bin_data" stream misidentification,
the fragment parsing failures, all of it were hls.js's transmuxer
correctly failing to parse a codec its container format was never
designed to carry. It also explains why the hardware-decode fixes from
earlier in this investigation never resolved anything: -c:v copy skips
decode entirely regardless of what decode method is configured, so
none of that work was ever actually being exercised for AV1 sources.

Fixed by requiring the source to specifically already be H.264 (not
just "browser-compatible" in general) before copying it for HLS
output. Verified thoroughly and completely: captured the real ffmpeg
command line before and after the fix, confirmed it changed from -c:v
copy to genuine libx264 re-encoding with the correct 8-bit pixel
format and profile, confirmed the resulting segment is now correctly
identified as h264 (not bin_data), and confirmed it decodes cleanly.
Also confirmed H.264 sources are completely unaffected and still use
the fast copy path as before.

## A real, immediate follow-up bug: a crash from the previous fix itself

The Opus-audio fix, while correctly diagnosed, shipped with a genuine
mistake: the edit that fixed the audio-codec check accidentally
deleted three lines directly beneath it that were still needed
(audioChannels, hwaccel, and the transcodeOpts object itself),
producing an immediate crash - "transcodeOpts is not defined" - on
every single attempt to start a stream. This was a real bug in the
previous delivery, not something to work around.

Fixed by restoring the deleted lines. Verified thoroughly this time,
beyond a syntax check: ran the actual HLS pipeline end-to-end through
the real server with a genuine Opus-audio test source, confirming the
session starts without error, the playlist is served correctly, and
the resulting segment has the correct h264/aac codecs and decodes
cleanly - the complete, working fix this time, not just code that
merely parses.

## Found it: Opus audio copied directly into HLS, which it can't support

The expanded, complete validation logging finally showed the actual
truth, and it was different from everything chased before: every
failing segment's audio stream was "opus", not "aac". HLS's MPEG-TS
segment format has always specifically required AAC for audio -
unlike general browser playback (where Opus is genuinely fine, just in
a different container like MP4 or WebM), hls.js's transmuxer isn't
built to parse Opus inside an MPEG-TS segment at all. The audio-copy
decision was reusing a general "is this browser-compatible" codec
check that correctly includes Opus for other contexts, but isn't safe
specifically for HLS - so an Opus source track was being copied
straight through into the HLS output uncorrected, rather than being
re-encoded to AAC.

This also explains the "bin_data" video misidentification from earlier
in this investigation, which had genuinely seemed like a separate,
unrelated puzzle: the malformed audio stream was confusing the whole
container's parsing, corrupting how the video stream got read too -
not two different problems, one single root cause.

Fixed by requiring the source to specifically already be AAC before
copying it for HLS output; anything else (Opus included) now correctly
gets re-encoded. Verified this concretely and completely: built a real
test source with genuine Opus audio, confirmed the old logic produced
exactly the same "bin_data" video / "opus" audio misidentification
seen in production, and confirmed the fix produces correct "h264"
video and "aac" audio from the identical source, with the segment
decoding cleanly.

## The validation logging was checking the wrong segments

server-log.txt worked correctly this time (the full, complete session
log was captured), which confirmed something more useful than another
theory: the ffprobe validation genuinely never ran, even though
playback clearly succeeded through segment 53 before failing at 54.
That's a real gap in the diagnostic itself, not evidence about the
underlying bug - the check was restricted to only the first three
segments, and those early ones can be served from the browser's own
HTTP cache on a repeat attempt against the same cache key, never
touching this server route again at all.

Fixed by validating every segment as it's served, not just the first
few - this now covers the exact range (54-60, or whichever segments a
given test actually fails at) that matters, rather than a proxy for
it. Also strengthened the cache headers for both the playlist and
segments from no-cache to no-store, since the same cache key gets
reused across separate attempts against the same file and each new
session regenerates fresh content from scratch - no-store is a
stronger guarantee against the browser ever serving something stale
instead of hitting the server for what's actually there right now.

## Reliable log capture - server-log.txt

Several rounds of this investigation were slowed down not by the
underlying bug, but by copying the server log from a live, scrolling
terminal window - genuinely easy to grab at the wrong moment, or miss
lines that already scrolled past, especially with a fast-moving log
full of library-scan and metadata-enrichment output ahead of the
actual issue.

start.bat now tees everything the server prints to server-log.txt in
the project folder, in addition to the normal live console output.
After any test, that file always has the complete, correctly-ordered
log for that run - open or copy from it directly instead of the
terminal window, and there's no more risk of grabbing an incomplete
snapshot mid-flight.

## A real lead, reconsidered: bin_data instead of h264

Confirmed the sc_threshold fix genuinely didn't resolve this - the
same failure, starting from segment 0, happened again on a fresh
transcode (server process confirmed restarted). That theory is now
ruled out with actual evidence, not just left unverified.

Added direct, server-side validation instead of continuing to guess:
running the exact same ffprobe-based function this app already relies
on everywhere else for real stream detection against the first few
segments, and logging exactly what it finds. The result reopened
something dismissed too early in an earlier round: the video stream
is being identified as generic "bin_data" instead of "h264" -
reproduced now through the app's own production code path, not a
one-off manual check. Both ffprobe and hls.js's own transmuxer depend
on the same underlying MPEG-TS stream-type declaration to know how to
interpret the data, so if that declaration isn't being written
correctly, it would directly explain both symptoms at once: ffprobe
misreading the stream, and hls.js failing to parse the same segments
as media.

This is the most concrete, reproducible lead so far - surfaced through
the app's real code path rather than an external, symptom-only
observation - but the specific mechanism causing it isn't identified
or fixed yet. This diagnostic will confirm it precisely on the next
test.

## Two confirmed findings, and a targeted keyframe-boundary fix

With live ffmpeg warning/error logging active, a real test run showed
zero ffmpeg complaints of any kind despite hls.js failing on every
segment starting from the very first one. That rules out ffmpeg-side
corruption or errors as the cause - ffmpeg considers its own output
completely fine. Combined with the failure now starting at segment 0
instead of partway through, this points at something structural in
how segments are being cut, not a runtime error or a timing issue.

The specific, well-documented mechanism this matches: hls.js requires
every segment to start with a genuine keyframe to be independently
decodable. If the encoder can insert its own additional keyframes at
detected scene changes on top of the explicit, time-based schedule
already being used, that can shift exactly where a segment boundary
lands relative to where it was intended - producing a segment that
doesn't cleanly start on the keyframe hls.js expects. That's
essentially what "found no media, falling back to playlist timing"
describes from hls.js's side.

Fixed by disabling scene-change-triggered keyframe insertion, leaving
only the explicit, predictable time-based schedule in control of where
keyframes land. Verified directly: confirmed every single segment
produced genuinely starts with a real keyframe, not just most of them.

Worth being upfront about: this is a deep, hard-to-fully-verify-
remotely category of ffmpeg/HLS issue, and the test source available
here doesn't have real scene changes to fully exercise the exact
mechanism being targeted. This is a genuine, well-reasoned, verified
fix for the specific hypothesis - not a guaranteed resolution without
testing against the actual file.

## Ruling out the timeout theory, and finally getting real diagnostic data

The failure still happened at essentially the same point (51-57, not
meaningfully later) even after extending both timeouts to several
minutes. That's real evidence the timeout/idle-cleanup theory was not
the actual cause - a failure anchored to roughly the same point in the
content regardless of how much time the process is given points at
something in the video content or transcode itself at that specific
timestamp, not a timing issue.

The real gap: ffmpeg's own warnings and errors were only ever exposed
if the process eventually exited with a failure code - but this
process never fails at all, it just quietly starts producing bad
segments partway through while continuing to run "successfully"
overall. That's exactly the kind of problem the existing on-failure-
only logging was blind to. Fixed by surfacing any genuine warning/
error line from ffmpeg's own output live, as it happens, filtered to
exclude the constant per-frame progress noise. Verified the filter
against realistic ffmpeg output: routine progress and status lines are
correctly ignored, while genuine problem indicators (errors, invalid
data, non-monotonic timestamps, corruption) are correctly surfaced.

## Real progress, not "no change": the failure point moved from segment 14 to 53

The next test showed the identical error, but starting at segment 53
instead of 14 - roughly 4x more content playing successfully first.
The race-condition fix genuinely helped; it just weren't the complete
picture. A failure point that moves later as related things get fixed,
rather than either disappearing or staying fixed at the same spot, is
a strong signal of something time-based rather than content-based.

The likely mechanism: AV1 software decode measurably runs slower than
real-time. Once the player catches up to the "live edge" of the
growing playlist, it has to wait for the next segment - and if that
wait is long enough, it can exceed the 60-second idle-session cleanup,
which was built to catch "nobody's watching anymore" but had no way to
tell that apart from "someone's still watching, just waiting on a
genuinely slow transcode." Killing the ffmpeg process mid-write during
that wait permanently corrupts whatever segment was in progress -
exactly the "found no media" symptom, just appearing later each time
other fixes bought more headroom before this kicked in.

Extended both the idle-session timeout (5 minutes instead of 60
seconds) and the segment-completion wait (2 minutes instead of 15
seconds) specifically for known-slow sessions, giving a genuinely slow
transcode room to actually finish a segment instead of being killed or
served incomplete partway through.

## The actual fragment-parsing bug: a segment-serving race condition

With the cache-busting fix in place, the real hls.js error was finally
visible: "Found no media in fragment 14 of level 0", then 15, 16, 17,
18, 19, 20 - all the same error, escalating to fatal. The critical
detail: segments 0 through 13 played back successfully first. This
wasn't corruption from the start - something changed specifically
partway through.

Found it: the segment-serving route only checked whether a segment's
file existed, not whether ffmpeg had actually finished writing it.
ffmpeg's HLS muxer creates a segment file and writes into it
progressively, and can update the playlist to reference a segment
very close to when writing starts - not only once it's complete. A
request landing in that narrow window could receive a file that
exists but isn't finished yet, which is exactly what "found no media"
looks like from hls.js's side. Segments 0-13 likely just happened to
be fully written by the time they were requested; something about the
timing at segment 14 onward exposed the race.

Fixed using the fact that ffmpeg writes segments strictly in sequence:
a segment is only served once segment N+1 has started (proving N is
done) or the whole transcode has finished (if N is the last one).
Verified this precisely against the exact race condition - a segment
whose file exists but whose successor doesn't yet correctly waits
rather than being served prematurely, and correctly serves once that
proof exists.

Also chased down and ruled out a "bin_data" stream-identification
result during this investigation - confirmed byte-for-byte identical
files were sometimes read differently by ffprobe when analyzed as an
isolated segment out of context, not a genuine difference in the
underlying data. Worth documenting as a case of thorough verification
correctly telling the difference between a real bug and a red herring.

## Found the real reason debugging kept stalling: the cache-busting fix had its own bug

The console log kept showing the identical version number even after
a genuinely fresh extraction to a new folder - that turned out to be
a real bug in the cache-busting fix itself, not a deployment mistake.
It was based on each file's own last-modified time, but zip extraction
(especially on Windows) commonly preserves each file's *original*
timestamp from inside the archive rather than setting it to the moment
of extraction. That meant a completely fresh deploy could still
compute the exact same "version" as a stale one - silently
undermining several rounds of debugging, since the browser had no
signal that anything had actually changed.

Replaced entirely with a single, explicit version string bumped by
hand with each delivery, with zero dependency on filesystem timestamp
behavior - both the startup banner and every JS/CSS reference on the
page now pull from the exact same constant, so they can never drift
out of sync with each other again. Verified this concretely: simulated
the exact failure mode (a file with an old, artificially preserved
timestamp, mimicking what zip extraction does) and confirmed the new
version still updates correctly regardless.

## A surprising result: fragParsingError even with software decode

Your latest log showed something genuinely important: the playlist
was fetched successfully this time (onReady fired), and the server
confirmed it correctly used software decode for this AV1 source - yet
hls.js's fragment parser still failed with the same error as before.
That's a real signal the original "hardware decode causes corruption"
diagnosis may not be the complete picture.

One concrete gap worth closing regardless of the ultimate cause: the
output directory for a given cache key was never explicitly cleared
before a new session started. A session for that exact same file could
have run before - including under an earlier hardware-decode attempt,
before this fix even existed - and simply creating the directory
doesn't remove pre-existing files in it. Fixed by explicitly clearing
it first, guaranteeing every new attempt starts from a genuinely clean
state rather than potentially alongside leftover files from a prior,
possibly-corrupted run. Verified this directly: confirmed stale files
placed in a cache directory are actually removed before a fresh
session begins.

Also expanded the hls.js error logging to capture the full diagnostic
payload it provides (reason, the underlying error message, which
specific fragment failed) rather than just the error type - the
current logging only showed "fragParsingError" without the detail
needed to know why, which is the actual next thing needed to get to
the bottom of this precisely rather than guessing further.

## The AV1 fix's own blind spot: no watchdog, and too short a timeout

Your latest log revealed a real bug in the AV1 fix itself: the
watchdog only activates "if (decodeHwaccel)" - but AV1 sources are now
deliberately started with decodeHwaccel already false (that's the fix
itself), meaning AV1 sessions completely bypassed watchdog protection.
Combined with a measured fact from earlier - AV1 software decode
running slower than real-time even on a simple test clip - the
existing 30s playlist-wait timeout was very plausibly just not enough
time for a real episode to produce its first segment, with nothing
around to catch or explain that.

Fixed two ways: a known-slow session (AV1 in software decode) now gets
a realistic 90s window instead of the same 30s used for everything
else, with progress logged periodically while waiting (so a future
investigation can see definitively whether a session is making real,
slow progress or is genuinely stuck, rather than a black box either
way). Also raised hls.js's own client-side manifest-loading timeout to
match - without this, the browser could give up well before the
server's longer wait ever came into play, making that extension
pointless for the exact case it was built for.

## AV1 decode via QSV was producing broken segments, not just slow ones

Narrowed down precisely: with the CSP fixes in place, HEVC files
(using the same hardware transcode pipeline) play correctly, while AV1
specifically still failed - hls.js's fragment parser rejecting the
segments outright (fragParsingError). That's a genuinely different,
more specific finding than "AV1 is slow" from earlier: hardware AV1
decode via QSV is a much newer, less mature feature than HEVC/H.264
decode, and on this system it's producing segments that exist as valid
files but contain corrupted, unparseable video data. This is a failure
mode the existing exit-code/no-segments-produced fallback checks
genuinely cannot catch, since a segment file does get created - its
content is just broken.

Fixed by having AV1 sources skip the hardware-decode attempt entirely
and go straight to software decode, while HEVC, H.264, and other
codecs keep using hardware decode as before (verified this only
affects AV1 specifically, nothing else). Software AV1 decode is slower
- a real, full-length episode could still take a while to produce its
first segment - but produces correct, playable output rather than
fast, broken output, which is the right trade to make here. If AV1
startup still feels slow, that's the known, remaining cost of this
specific codec in software - a genuinely different, smaller problem
than "doesn't play at all."

## A second, distinct CSP block - hls.js's Web Worker

Your latest log showed the previous blob-URL fix genuinely helped
(that specific violation is gone), and revealed the next real blocker
underneath it: "Creating a worker from 'blob:...' violates...
script-src... worker-src was not explicitly set, so script-src is used
as a fallback." hls.js creates a Web Worker (again via a blob: URL) to
handle fragment parsing off the main thread - without an explicit
worker-src directive, the browser falls back to script-src for worker
creation too, which also didn't allow blob:. The worker got silently
blocked, and every fragment parse failed as a direct result - matching
the fragParsingError cascade in the log exactly, escalating to fatal
after several attempts.

Fixed with its own explicit worker-src directive allowing blob:,
rather than loosening script-src itself.

## The actual, final root cause: CSP blocking hls.js's own blob URL

The debug logging paid off completely - the browser console showed
the exact moment of failure: "Loading media from 'blob:...' violates
Content Security Policy directive: media-src 'self'". This explains
every symptom across this entire investigation, including why it
failed identically on Chrome, Edge, and Safari alike: hls.js doesn't
point the video element at the playlist URL directly - it uses Media
Source Extensions internally, creating a blob: URL as video.src to
actually feed data in. The playlist was being fetched and parsed
successfully every time (that's why the session always looked fine on
the server, and why onReady was firing) - the browser was correctly
blocking its own video element from loading what hls.js had already
successfully prepared, at the very last step, because media-src didn't
allow blob: URLs. Fixed by allowing it specifically for that purpose.

Worth knowing separately: the same log showed a play() rejection
because "the user didn't interact with the document first" - that's
standard, expected browser autoplay policy (most browsers block
autoplay with sound until there's been a click somewhere on the page
first), not a bug. If a video doesn't start automatically, a manual
tap/click on play resolves it.

## Found it: the actual root cause of "session started, nothing else happens"

The debug logging did exactly its job - the browser console showed
native HLS support: "maybe" for Edge. That single value was the whole
bug. canPlayType() doesn't return true/false; it returns "" (definitely
not supported), "maybe" (a genuine guess - the browser hasn't ruled it
out, not confirmed it works), or "probably" (confident support). Only
Safari/WebKit actually returns "probably" for HLS. Chrome and Edge
routinely return "maybe" for HLS despite having zero real native
support for it - and the code was treating any non-empty string as
"use native playback here." That silently handed the video element a
format it fundamentally couldn't parse, with no error and no request
for it ever made - exactly matching a session that started successfully
on the server and then never got asked for anything.

Fixed by checking specifically for "probably" - the only value that
means genuine, confident native support - so Chrome/Edge/Firefox
correctly go through hls.js (which had already loaded successfully the
whole time) instead of a native path that was never going to work for
them. Verified the corrected check against all three real-world
return values.

Also cleaned up a related but non-fatal console warning about hls.js's
source map being blocked by CSP - cosmetic only, didn't affect actual
script execution, but was adding confusing noise while diagnosing the
real issue.

## Definitively confirmed: the build marker rules out stale deployment

Your log includes the build marker (hls-decode-watchdog-2026-07-28),
which means this genuinely was the current code running - the
deployment/caching explanation is now ruled out with certainty, not
just assumed fixed.

That points at something more precise: the session started
successfully, but was cleaned up as "idle" - which specifically means
the playlist was never once requested afterward, not that the
transcode failed or hung. The server did its job; the browser never
actually asked it for the video. That's a different, more specific
problem than anything targeted so far, and it lives in the handoff
between "session started" and "now go fetch it" on the frontend.

Added precise, step-by-step logging through that exact handoff
(tagged [hls-debug] in the browser console) - which branch gets taken
(native Safari/iOS HLS vs hls.js vs neither), the exact playlist URL,
and specifically whether a load ever gets silently superseded by
another one starting around the same time. The next browser console
check should show exactly where this breaks, rather than continuing
to infer it from server-side symptoms alone.

## A hung transcode process, not just a failing one

Your log ("session started, then nothing, then cleared out as idle")
pointed at something the previous fallback genuinely couldn't catch:
it only retried when the transcode process actually exited with an
error. A process that hangs and never exits at all - a real, known
class of issue with QSV in certain driver/configuration combinations -
would sit there producing nothing until the idle-session cleanup
eventually killed it, with no retry ever happening.

Added a proper time-based watchdog specifically for this: a
hardware-decode attempt that hasn't produced even one segment within
20 seconds gets killed and retried in software, rather than waiting
indefinitely for an exit that might never come. Verified this
precisely: simulated a genuinely hung process directly, confirmed the
watchdog correctly detects it, kills it, and retries - producing a
working result - while correctly ignoring the stale close event from
the killed process so it can't cause a confusing double-handling. Also
added logging for a playlist request that times out waiting for a
session to produce anything, which was previously completely silent
server-side.

## Hardware-accelerated decode, back with a safe fallback this time

Traced "nothing plays" for an AV1 source directly to a real,
measurable cause: decoding AV1 in pure software genuinely runs well
under real-time speed - measured a real 1080p AV1 test source taking
12 seconds to produce even the first HLS segment (versus ~2 seconds
for HEVC/H.264), and the full transcode ran slower than the source's
own runtime. A real, full-length episode scales that same ratio - the
transcode can genuinely never catch up to what playback needs.

Hardware-accelerated decode (not just encode) is the direct fix -
brought back after being cautiously reverted a few rounds ago, now
with confidence, since the actual cause of that earlier issue turned
out to be a missing pixel-format conversion (already fixed separately)
rather than decode acceleration itself. This time it's built with a
safe, automatic fallback: decode hardware support for a given source
codec varies by exact hardware/driver generation (AV1 decode via QSV
specifically needs a fairly recent Intel generation), so a failure
before even one segment gets produced - a strong, specific signal of a
genuine incompatibility - triggers one automatic retry without
hardware decode, rather than a hard failure with no way to recover.
Verified this retry mechanism directly: forced a genuine decode
failure and confirmed it's correctly detected and retried, rather than
just reasoning about it in theory.

## A couple of real bugs found from actual browser console errors

Traced two genuine issues directly from a real browser console error
report, rather than guessing:

- The home page's rotating hero banner left its rotation timer running
  in the background after navigating away to a different page (like
  the player) - each visit to the home page created its own
  independent timer with no way for a later one to find and clear an
  earlier one, so it would eventually fire against DOM elements that
  no longer existed. Fixed by tracking the timer somewhere a later
  visit can actually reach it, plus a defensive check as a second
  layer of protection.
- Clicking play (or the spacebar/K shortcut) while a source was still
  being set up - a real possibility with HLS, since starting a session
  and loading the playlist happens asynchronously - could surface a
  raw, uncaught "NotSupportedError" with no context about what
  actually happened. Play/pause now goes through one shared function
  that handles a still-loading source gracefully instead.

## Fixing "audio plays but no video" on hardware-accelerated transcodes

Found and fixed a real, concrete bug: the hardware encode paths (QSV,
NVENC, AMF) never explicitly forced 8-bit output, unlike the software
path, which always did. For a 10-bit HEVC source - extremely common in
real anime releases - that meant the "H.264" output was actually
encoded as "High 10 Profile", which essentially no hardware H.264
decoder supports, including iOS's. That's exactly the failure mode of
audio playing while video doesn't: the audio track is completely
unaffected, while the video track is fundamentally undecodable on the
device.

Verified this concretely, not just in theory: reproduced the exact
broken output (confirmed "High 10" profile, 10-bit pixel format) from
a genuine 10-bit test source, confirmed the fix produces standard
"High" profile 8-bit output from the identical source, confirmed that
corrected output decodes cleanly with zero errors, and confirmed the
fix correctly reaches the actual HLS segments served through the real
running server, not just the underlying encode function in isolation.

## Genuine segmented (HLS) streaming

The real, complete fix for playback needing a transcode: instead of
producing one monolithic file that has to be fully finished before
anything can be sent to the player, the server now generates HLS -
small segments plus a playlist that grows as more of them become
available. A player can start on the first segment as soon as it
exists instead of waiting for the whole episode, which is what
actually solves the "never starts playing" problem on mobile, and
gets desktop genuine native seeking instead of the old
restart-the-stream-from-a-new-offset approach.

Verified this thoroughly against real ffmpeg, not just in theory:
confirmed segments genuinely appear progressively (the first one
existed well before the full transcode finished on a test clip),
confirmed a downloaded segment decodes cleanly on its own, confirmed
the playlist correctly signals "more segments coming" while a
transcode is still in progress and correctly finalizes once it's
actually done, and confirmed the whole pipeline end-to-end through the
real HTTP server with a genuine HEVC source file - session start to a
ready, servable playlist in about a second.

Uses native HLS support in Safari (built into the browser, no
extra library needed) and hls.js everywhere else (Chrome, Firefox,
Edge don't have native support) - worth knowing this needs
`hls.js` loaded from a CDN for anything other than Safari, so
non-Safari playback of anything needing a transcode needs the server
to have internet access reaching that CDN. Falls back to the previous
direct-transcode approach if that library can't load, rather than
failing outright.

## Fixing playback on iPad specifically

Found the real cause of a "waits forever or never plays" report,
traced through actual server logs rather than guessed at: iPadOS has
deliberately identified itself as desktop Mac Safari in its default
User-Agent string since iPadOS 13, so an iPad is genuinely
indistinguishable from a real desktop Mac by that header alone. That
matters a lot here specifically, because iPadOS Safari has the exact
same media playback restrictions as iPhone (no reliable indefinite
live-pipe streaming) - misclassifying it as desktop meant it was being
served a stream type it fundamentally can't play. The browser itself
can tell the difference even though the header can't: a real Mac has
no touchscreen, while an iPad masquerading as one still reports touch
support, so the player now checks for that and tells the server
directly. Verified the underlying detection logic directly against
several cases: a real desktop Mac (correctly still not treated as
mobile), the exact same User-Agent string but from an iPad with the
new signal (correctly now treated as mobile), a genuine iPhone (still
detected the old way, unaffected), and genuine desktop Windows Chrome
(correctly unaffected).

Also added explicit logging throughout the streaming route, since
several failure points there were previously completely silent -
including an auth rejection, which could otherwise look identical to
"nothing happening" with zero trace of why.

## Hardware-accelerated decode (not just encode)

Previously, only the *encode* half of a hardware-accelerated
transcode was actually using the GPU/iGPU (QSV/NVENC) - decode was
still happening entirely in software on the CPU, which matters a lot
for HEVC/10-bit sources specifically, since those are expensive to
decode in software. Both halves of the pipeline are now
hardware-accelerated for QSV and NVENC. Deliberately using the safer
"-hwaccel X" form rather than "-hwaccel_output_format X" alongside it
- the latter keeps decoded frames as GPU-opaque surfaces, which would
need a GPU-aware scale filter variant instead of the existing one and
meaningfully raises the risk of breaking resolution downscaling. This
simpler form decodes on the GPU/iGPU and downloads frames back to
regular memory automatically, so the existing filter keeps working
unchanged while still meaningfully offloading the decode work off the
CPU. Verified the exact resulting ffmpeg command is correctly
structured (hwaccel flag before the input, as ffmpeg requires), but
this couldn't be tested against real QSV/NVENC hardware directly in
the environment this was built in - worth confirming playback still
works correctly after updating.

## Hardware-aware transcode concurrency

The limit on how many transcodes can run at once now actually accounts
for whether hardware acceleration is active, rather than always using
the same CPU-core-based rule. A hardware-accelerated stream (NVENC,
QSV, AMF, or VAAPI) offloads the actual encode/decode work to
dedicated silicon, leaving the CPU mostly just handling
demuxing/muxing/audio - genuinely different load characteristics than
pure software encoding, where each stream really does saturate
multiple CPU cores on its own. With hardware acceleration active, the
concurrency ceiling now uses the full core count (previously always
one fewer) with a floor of 4, instead of quietly leaving real headroom
unused on any system with a capable GPU/iGPU.

## Mobile and tablet video player controls

Below 1024px wide, or on any touch-primary screen up to 1366px wide
(catching tablets in landscape too, which can be wider than 1024px),
the player's control bar restructures itself:
the seek bar moves to its own full-width row above the buttons (the
same pattern virtually every mobile video player uses) instead of
squeezing into the same row as everything else, the on-screen volume
slider is hidden (a touch device already has hardware volume buttons,
so it was mostly just taking up space this layout needs elsewhere),
and touch targets grow from 34px to 40px for easier tapping. There
were simply too many controls - rewind/play/forward, volume, seek bar,
time, next episode, captions, speed, quality, skip points,
fullscreen - to fit comfortably in one row on a phone screen; the seek
bar, being the one flexible element, was shrinking down toward its
minimum width while every button around it stayed full-size and spread
apart, which is what actually made this hard to use.

## Filling in missing studio and cast info

Separate from the main enrichment pass (which finds a MAL/AniList
match at all for titles that don't have one yet), this specifically
targets titles that already matched but are missing studio or cast
info - either because those fields didn't exist as a tracked feature
yet when the title was originally imported, or the source simply
didn't have that data at the time (worth trying again later, since
AniList/MAL data does get filled in over time). Runs automatically
after every rescan and at startup (a genuine no-op once everything's
already filled in, so this never does unnecessary work), and there's
also a "Fill Missing Studio/Cast Info" button in Settings for
triggering it manually. Deliberately only merges in the specific
fields that are actually missing, never touching title or description
- so it can't clobber a manual edit made since the original import,
verified directly by confirming a manually-edited description survived
a backfill run untouched while studios/cast still got filled in
correctly.

## Skip intro/outro accuracy, and Recently Added Episodes

**Skip points**: rather than relying on a generic guess ("assume the
first ~90 seconds is the intro"), which is frequently wrong since
actual intro lengths vary a lot and some episodes don't have one right
at the start at all, there's now a "Set Skip Points" button (scissors
icon) in the player controls. Seek to where the intro/outro actually
starts and ends, click "Set to current" for each, and save - applies
to every episode of that show going forward. The generic guess is now
only a fallback for shows you haven't marked yet.

**Recently Added Episodes**: a new home screen row, genuinely
tracking when each individual episode was first seen - distinct from
"Recently Added" (shows). A new episode 15 landing in a series that's
been in the library for months belongs here even though the show
itself isn't new to the library. This replaces the old "New Episodes"
row, which wasn't actually tracking recency at all.

While building this, found and fixed a real, pre-existing bug: the
server's startup sequence was bypassing the code path that populates
all of this "first seen" tracking (both this new episode-level version
and the existing show-level one), meaning it was empty or stale from
every fresh startup until the next rescan happened to occur, rather
than being correct from the moment the server actually started.

## Studio display and search

Anime/movie cards now show the main studio alongside the episode count
and year, wherever that card is used - browsing, continue watching,
and search results alike. The Search page also picked up a studio
filter dropdown next to the existing genre one, and typing a studio
name directly into the search box (e.g. "MAPPA") matches it the same
way a title would, rather than only being reachable through the
dropdown.

## Notes on the empty-library hero

Before any titles are added, the home screen's hero background is now
a gradient built from your actual theme colors, rather than a fixed
image with its own hardcoded colors that could never reflect a
customized accent color. Change the accent color in Settings and this
updates right along with everything else that uses it.

## Theme songs (optional)

Drop an audio file named `theme.mp3` (or `.m4a`/`.ogg`/`.wav`) into a
series or movie's own folder, next to its `cover.jpg`/`info.json`, and
it plays quietly in the background whenever that title's page is open
- muted/unmuted via a small floating button, stopping automatically the
moment you navigate elsewhere. This works exactly like the cover image
or episodes themselves: **the app never fetches, downloads, or
generates this audio for you** - it only plays a local file you've
placed there yourself, however you legitimately obtained it. Browsers
generally block audio-with-sound from autoplaying until you've clicked
somewhere on the page at least once; if that happens, the floating
button shows "Play Theme" instead of just silently doing nothing.

## 9. Customization

- **Site name & accent color:** editable live from the in-app Settings
  page, or by editing `config.json` directly (it lives in the persistent
  data folder - see "Keeping your data across updates" below, not in the
  app folder itself).
- **Avatars & profile banners:** the picker uses the SVGs in
  `public/img/avatars/` and `public/img/banners/` — drop your own image
  files in there (any name) and reference them, or replace the existing
  ones, to fully personalize the look.
- **Port:** change `"port"` in `config.json`, or set the `PORT`
  environment variable when starting the server (default `4821`).
- **Per-title metadata:** add an `info.json` next to any show/manga folder
  to set a custom title, description, tagline, year, rating, and genres
  (see the `README.txt` files inside `media/anime` and `media/manga`),
  or use the "Import Metadata" button to fetch this automatically from
  either MyAnimeList or AniList.
- **MyAnimeList Client ID:** go to myanimelist.net → log in → Account
  Settings → API → Create ID. Choose app type "hobbyist" and you don't
  need a redirect URL since I/O only makes public read
  requests (poster/synopsis/genre lookups) on your behalf, never posts
  to your MAL account. Paste the Client ID into Settings. **AniList
  needs no equivalent setup at all** — it's usable immediately, with no
  account or key of any kind.

## 10. Rescanning your library

The library rescans **automatically** a few seconds after anything
changes in your media folders (adding, removing, or renaming files) -
no need to restart or click anything. If you'd rather trigger it
yourself right away, **Rescan Library** in Settings still works too.
Either way, scanning no longer blocks the server while it runs, so
everyone else stays unaffected even during a big library's rescan.

## 11. Keeping your data across updates

Your accounts, profiles, watch history, site settings, and uploaded
avatars/banners are stored in a real SQLite database (`io.db`, using
Node's built-in SQLite support - no separate database server to install),
plus a couple of small JSON/media files, all living in one place that is
**not** inside this app folder:

- **Linux/macOS:** `~/.io-stream/data`
- **Windows:** `C:\Users\<you>\.io-stream\data`

This means that if you ever download a newer version of I/O
and unzip it to a brand new folder, it will automatically find and use
this same location — every account, profile, and setting is already
there, with nothing to copy or reconfigure. The server prints the exact
path it's using right in the startup log, so you can always confirm it.

If you're upgrading a very old install (from before the SQLite switch,
where accounts/profiles lived in `accounts.json`/`profiles.json`), those
are detected and imported into the database automatically the first time
you start the new version - you'll see a `[migrate]` line in the startup
log confirming what was imported. The original JSON files are kept
alongside the database as `.migrated` backups rather than deleted.

Want full control over where this lives instead - e.g. a shared network
drive, or to keep multiple separate libraries? Set the `IO_DATA_DIR`
environment variable to any folder before starting the server:

```bash
IO_DATA_DIR=/path/to/your/data npm start
```

(On Windows: `set IO_DATA_DIR=C:\path\to\your\data` before `npm start`,
or add it as a system environment variable so `start.bat` picks it up too.)

## Project structure

```
io-stream/
├── server/                Express backend (routes, streaming, scanner)
├── public/                 Frontend (HTML/CSS/vanilla JS, no build step)
├── config.default.json      Default settings, copied on first run
├── media/anime/               Your anime goes here (or point elsewhere)
└── media/manga/               Your manga goes here (or point elsewhere)

~/.io-stream/data/    Everything persistent lives here instead (see
├── config.json             "Keeping your data across updates" above) -
├── io.db                not inside the app folder, so replacing the
├── uploads/                  app with a newer version never touches it.
└── pdf-cache/
```

No build step, no bundler, no separate database server to install and
run — SQLite is just a file, which is what makes this portable across
Windows and Linux.

## Performance

A few things run automatically to keep the server responsive, especially
on modest hardware:

- **API responses are gzip-compressed** when the browser supports it
  (basically always) - a library with a few hundred titles can easily be
  several hundred KB of JSON, and this typically shrinks it by
  70-90%, which matters most over a slower connection.
- **Hardware video encoding** (NVIDIA NVENC, Intel Quick Sync, AMD AMF,
  or VAAPI) is used
  automatically when available - see step 2 above and the Admin
  Dashboard for status.
- **Repackaged and re-encoded video is cached** - both the MKV
  container-fix repackaging described above and any genuine re-encode
  (fixing HEVC, or a quality downscale) avoid redoing the same work
  twice for the same file/settings.
- **Static assets and images are cache-controlled** so repeat visits
  don't re-download the app's own JS/CSS/images every time - and the
  app's own JS/CSS is served gzipped (compressed once per file version
  and kept in memory), measured ~76% smaller over the wire, which is
  most noticeable on first loads and on phones.
- **Scans and MAL syncs no longer slow the site down.** The folder
  watcher used to see the covers and info files the sync itself writes
  and schedule another full library scan every few seconds for the
  entire sync - constant heavy disk churn that made pages crawl or time
  out while it ran. The app's own metadata writes are now ignored by
  the watcher (every flow that writes them already refreshes the
  library itself), and the web app quietly retries a read once if a
  request gets dropped while the server is momentarily busy, instead of
  collapsing to an error page.
- **MyAnimeList sync runs several titles at once** - three polite
  parallel workers instead of strictly one-by-one, measured ~3x faster
  across a big batch while keeping the request rate to MAL modest, and
  backing off automatically if MAL asks to slow down. A first full sync
  of a very large library drops from roughly half an hour to under ten
  minutes.
- **API compatibility for the native apps.** `/api/anime` and
  `/api/movies` now return full data (every episode, same shape this
  API has always had) by default - the exact thing the native Android
  TV, Windows, and iOS clients were built against, with zero changes
  needed on their end. Only a request that explicitly asks for the
  trimmed browse-page version (`?light=1`, which just the web app uses)
  gets it. A previous change had made the trimmed version the default
  for everyone, which is what broke those apps' series listing - this
  restores the original, always-worked contract as the default and
  makes the fast path opt-in instead.
- **Large libraries stay fast.** Browse/search views only load what's
  needed for a poster grid (not every episode's file/title for every
  show) - measured at roughly 9x smaller over the wire for a library in
  the thousands of titles. On top of that, the library lists are
  compressed and cached server-side once per rescan instead of being
  rebuilt for every request - measured ~25ms of blocking work per page
  load at ~1,700 titles, now paid once per library change instead of
  once per visit per user - and the app itself reuses its copy for up
  to a minute when you tap between Home/Series/Movies rather than
  re-downloading everything each time (anything that changes the
  library right then, like a rescan or MAL import, refreshes
  immediately). Every title shows on the page at once (no
  "Load More" needed) - the browser is told to skip rendering work for
  posters that are off-screen until you actually scroll near them, so a
  library of any size stays smooth without splitting it into pages. And
  a full rescan's bookkeeping is now a single database transaction
  instead of one write per title - at ~1,700 titles that measured out
  to as much as ~400x faster (seconds down to milliseconds), which
  matters a lot given a rescan now also runs automatically on file
  changes.
- The Admin Dashboard (avatar menu, admin accounts only) shows live
  CPU and memory usage for the machine the server is running on, so you
  can see directly whether it's actually under load - including how many
  transcodes are running right now.
- **Automatic daily database backups.** The database is the one
  irreplaceable thing here (accounts, profiles, watch history - your
  media files are already your own copies). A snapshot is taken safely
  from the live database once a day and the last 7 are kept; the Admin
  Dashboard has a Backups section to create one on demand and download
  any of them. Restoring is just replacing `io.db` in the data
  folder with a downloaded copy while the server is stopped.
- **The server is hardened against crashes.** A stray error anywhere -
  a background cache build hitting a corrupt file, a folder watcher
  failing on a network drive - is logged with a full stack trace but no
  longer takes the whole service down for everyone (verified: a folder
  watcher error previously crashed the entire process). Stopping the
  server also cleanly kills any in-flight video conversions instead of
  leaving orphaned encoders burning CPU, and simultaneous progress
  saves from several viewers wait briefly for the database instead of
  erroring on rare timing collisions.
- **Transcoding automatically scales to the server's hardware.** Only
  as many transcodes run at once as the CPU can realistically handle
  well (one less than the number of cores, so the server itself always
  keeps some headroom) - anything beyond that briefly queues instead of
  piling on more ffmpeg processes than the machine can handle, which is
  what actually protects smooth playback under a burst of simultaneous
  viewers.
- Fixed a real stuttering bug: playing a file that needed fixing (wrong
  codec, or a quality change) was quietly building a cached copy in the
  background at the same time - if that background disk write ever fell
  behind for any reason, it was accidentally holding back the actual
  live video too, since they briefly shared the same internal
  buffering. The background copy is now fully decoupled, so it can
  never affect what's actually playing.
- **The cached-copy folder has a size limit** (Settings, default 15GB) -
  without one, an actively-growing library would eventually fill up the
  disk entirely with cached copies, which is a real stability risk over
  time. Once the limit is hit, the least-recently-*watched* cached
  copies are removed first automatically - actively popular episodes
  stay cached, stale ones get cleared to make room.
- The Admin Dashboard has a **Curated Rows** section - hand-picked
  home page rows with any name you want ("Staff Picks," "Truck Kun's
  Top Picks," anything), shown to every profile alongside the
  automatic ones (Continue Watching, Recently Added, etc.). Create a
  row, then "Manage Titles" to search your library and add or remove
  whatever you want featured in it.
- The Admin Dashboard also has a **Needs Attention** section - every
  title the last MyAnimeList sync couldn't confidently match, with the
  specific reason why (no results at all, or found results but nothing
  matched confidently enough). Each has a one-click "Search MAL" to pick
  the right match manually - and that search box accepts a title, a bare
  MAL id (e.g. `5114`), or a pasted myanimelist.net link, so when name
  search keeps landing on the wrong entry (remakes and sequels are the
  usual culprits) the id nails the exact one, a "Retry Enrichment" button re-runs the
  whole batch (handy after renaming a folder to something MAL will
  recognize better), and you can select multiple titles there to
  bulk-add or bulk-remove a genre tag across all of them at once.
- **Library Stats** (avatar menu) shows your library's composition and
  top genres, your own watch time and episode count (only counting
  episodes actually watched through the player, not manually marked
  ones without a known length), and the combined total across everyone
  on the server.

## Notes & limitations

- Video playback uses the browser's native `<video>` element. Files that
  are already browser-friendly (MP4 container, H.264 video, AAC/MP3/Opus
  audio) stream directly with full instant scrubbing. Files that need
  FFmpeg to fix the audio (or when you pick a non-default audio track)
  are streamed as they're transcoded; seeking on those uses a custom
  progress bar that restarts the stream at the requested time (a short
  pause is normal — this isn't full HLS segmenting, just a live remux).
  Resuming/seeking always cuts audio and video at the exact same point,
  so they stay in sync (it just snaps to the nearest keyframe, which can
  be a couple seconds before your exact saved position — normal for this
  kind of on-the-fly seek).
## Network drives / shared folders

If a configured media folder doesn't exist or isn't accessible to the
server process at scan time, that's now called out clearly - both in
the startup banner and, just as importantly, on every rescan
afterward (not just at startup) - instead of just silently finding
zero titles with no indication why. On Windows specifically, the
warning also checks for a very easy mistake to make and a very
confusing one to diagnose from the symptom alone: a path written in
Unix style (e.g. `/A/Anime`, no drive letter) doesn't mean "the A:
drive" the way it looks like it should - Windows resolves that
relative to whichever drive the server itself happens to be running
from, so it silently points somewhere else entirely. If that's what's
going on, the warning says so directly rather than leaving it looking
like an unrelated network/permissions issue. Separately, a mapped
network drive is usually tied to your own interactive login session,
and isn't automatically visible to a process running as a different
account - notably the SYSTEM account, if the server was set up to
auto-start via Task Scheduler/a service (see the auto-start section
below). If some folders on the same drive work and others don't,
that's a strong sign worth checking specifically.

Fixed a related issue: several different things can trigger a rescan
(auto-rescan reacting to a file change, a manual Rescan click, a MAL
import finishing, a settings change, or simply more than one device or
app hitting the server around the same time) - previously, two of
those happening close together would each start their own full scan,
each spawning its own set of scanning threads on top of each other.
Enough of those competing for the same CPU was, in practice, capable
of making even a fast, healthy *local* folder occasionally exceed the
timeout meant for a genuinely slow network drive, wrongly reporting it
as unreachable. All of those trigger points now share a single gate -
at most one scan ever runs at a time; anything that asks for a rescan
while one is already in progress simply gets that one's result rather
than starting a second one (verified directly: 8 rescans fired at
once all completed fast and returned identical, consistent results,
instead of piling up).

The scan timeout itself is also now configurable in Settings (default
raised to 90s from the original 25s) - if a rescan ever reports a
genuinely-reachable local folder as unreachable, that's this timeout
being too tight for your library's real-world scan time on your actual
hardware (disk speed and antivirus overhead vary a lot machine to
machine), not a sign anything is actually broken - raise it there.

Pointing a media folder at a network share (SMB/NFS, a mapped drive)
works, but a share that's slow, briefly disconnected, or has an auth
prompt hanging in the background used to be able to freeze the entire
server at startup - the folder scan would just wait forever with no
way to even open the app. Anime, Movies, and Manga are now each
scanned in their own short-lived background thread, completely
isolated from the thread that actually answers requests - a hang in
one can only ever block its own disposable thread, never the server
itself. If a folder doesn't respond within 25 seconds, that thread is
stopped and the folder is skipped for this scan (with a clear message
in the server log explaining why) while the other folders - and the
server itself - carry on completely normally. If it was reachable
moments ago, whatever was found last time is kept rather than being
wiped to empty. Once the share is reachable again, Rescan picks it
back up. This isolation is also what keeps scanning itself fast even
for large libraries on local disks, since each thread can use the
same quick, direct filesystem calls as always.

## Changing where your media lives

Settings (as an admin) now has editable **Media folders** fields - point
anime/movies/manga at any folders on the server (e.g. `D:/Movies` or
`/mnt/media/anime`), hit Save, and the library rescans from the new
locations immediately, no restart needed. Use forward slashes even on
Windows. If you'd rather edit by hand: the live settings file is
`config.json` **inside the data folder** (its exact path is printed at
the top of the server's startup log) - `config.default.json` in the
project folder is only a first-run template, and editing it after that
does nothing. The startup log also prints each media folder it's using,
flagging any that don't exist.

## HTTPS (recommended if reachable from outside your home)

Point `https.certPath` and `https.keyPath` in `config.json` at a
certificate and key, restart, and the server runs fully over TLS -
built into Node, no extra software, and with no measurable speed
difference (video streaming dwarfs the encryption cost on any modern
CPU). With HTTPS on, session cookies are marked Secure and browsers are
told (HSTS) to never try plain HTTP for the host again. Certificate
renewals are picked up automatically without a restart, so Let's
Encrypt's 60-90-day cycle just works with a standard certbot setup.

Three common setups, easiest first:
1. **Not exposing it to the internet at all** (home LAN, or remote
   access via Tailscale/WireGuard): HTTPS is optional - those tunnels
   already encrypt everything.
2. **Own domain + Let's Encrypt:** get a certificate with certbot, set
   the two paths to the `fullchain.pem` and `privkey.pem` it produces.
3. **Reverse proxy** (Caddy/nginx) doing TLS in front: also completely
   fine - leave `https` empty and let the proxy handle certificates.

## Security notes

Beyond accounts, sessions, and HTTPS (covered above), a few more
things are worth knowing about:

- **Profile PINs are rate-limited.** A 4-digit PIN only has 10,000
  possible values, so without a limit it's trivially brute-forceable
  by a script in well under a minute - which would silently defeat
  whatever it's meant to restrict (kids-mode content, in practice).
  5 wrong attempts locks that profile's PIN for 5 minutes; legitimate
  users essentially never need more than 1-2 tries.
- **A Content-Security-Policy header locks down where scripts can load
  from** - only this server itself, with a couple of specific,
  intentional exceptions for the Cast SDK and Google Fonts. This is
  real, meaningful protection against the most dangerous class of
  injected-content attack, not just a header for its own sake -
  getting there also meant removing the last few inline event-handler
  attributes in the UI (replaced with one shared fallback handler) and
  auditing every external resource the app actually loads to make sure
  none of them broke silently. Inline *styles* are still allowed, since
  the interface is built with them extensively and locking that down
  too would need a much larger rewrite than the security benefit
  (CSS injection is a real but far lower-severity risk than script
  injection) currently justifies.


- Accounts are stored locally with hashed+salted passwords (Node's
  built-in scrypt) and simple server-side sessions — there's no email
  verification or password reset flow, since this is meant for a small
  trusted household, not the public internet. This is designed for
  personal/local use on a trusted network; don't expose port 4821
  directly to the public internet without adding a proper auth layer.
- The MyAnimeList Client ID only enables read-only lookups (search,
  poster/synopsis/genre fetch) — it never posts to your MAL account and
  no OAuth/login step is required. AniList needs no key or account at
  all for the same kind of lookups.

## True adaptive bitrate streaming

Quality was previously a manual, single-stream choice - a fixed
resolution picked up front and stuck with regardless of how the actual
network connection behaves during playback. Real streaming services
instead offer several quality variants at once and let the player
switch between them automatically based on real, measured throughput.

Implemented this on top of the existing HLS pipeline rather than
building anything parallel to it: a new master playlist route lists a
handful of practical quality tiers (not many fine-grained ones - each
one is a fully separate transcode on this server's own hardware, not a
dedicated encoding farm), and a new lazy-start-and-redirect route
means a given tier's transcode only ever actually starts if a player
requests that specific variant - not all of them upfront just because
they're listed in the playlist. Verified this precisely: requesting
only one variant starts exactly one session, not three.

Segments are served through the exact same, already-proven
cacheKey-based playlist/segment routes via a redirect, rather than any
new segment-serving code - nothing new to keep in sync with the
existing, thoroughly-tested path.

"Auto" is now the default quality option whenever HLS applies, with
the existing manual quality choices (Original, 1080p, 720p, etc.)
still available as an override that bypasses adaptive selection
entirely and behaves exactly as before.

Also refactored the session-resolution logic (probing the source,
deciding whether video/audio need re-encoding, computing the cache
key, starting or reusing a session) into one shared helper function
used by both the original single-quality route and these new routes -
duplicating that logic risked exactly the kind of subtle drift that's
caused real bugs earlier in this project.

Caught and fixed two real bugs of my own while building this (a
missing closing brace producing a genuine syntax error, found via
node --check rather than shipped blind) before finalizing - both
confirmed fixed via full syntax checks and real end-to-end server
tests, not just review.

## Up Next overlay: added a thumbnail preview

The Up Next auto-play overlay already existed and was genuinely
thorough - a 10-second countdown, play/cancel buttons, a profile-level
setting to disable it, cleanup on navigation, and an ended-event
fallback - but it was text-only, unlike the visual preview cards real
streaming services use. Added a landscape thumbnail using the episode
thumbnail endpoint already used elsewhere in the app, plus a visual
countdown progress bar overlaid on it, replacing what was previously
just a text countdown number in the button.

Reused the existing image-fallback pattern (a data-fallback attribute
picked up automatically by the app's own global image-error handler)
rather than adding any new fallback-handling code, and verified the
CSS transition driving the progress bar animation actually replays on
each new episode's overlay rather than only firing once.

## Fixed the subtitle drawing-command leak, for real this time

There was already an attempt at this fix, but it had a genuine, root
flaw: it looked for ASS's {\p1}...{\p0} marker tags to know what
drawing-mode coordinate data to strip - but confirmed directly, with a
real ffmpeg ASS-to-VTT conversion test, that ffmpeg always strips
those exact marker tags during conversion, leaving the raw coordinate
data behind as plain text. The existing detector was checking for a
signal that's already gone by the time it ever sees the text, meaning
it could never actually match anything in real-world use - only a
narrower fallback (for a cue that's nothing BUT drawing data on its
own line) had any real chance of working, and even that couldn't
handle drawing commands mixed with real text on the same line.

Replaced it with a detector that recognizes the drawing-command
pattern directly by its shape (a command letter - m/n/l/b/s/p/c -
followed by 2+ numbers, repeated multiple times in a row) rather than
depending on marker tags that don't survive conversion. Tested this
thoroughly against the actual pattern from the report, a short 2-shape
case, drawing commands mixed with real text on the same line, and
several "should never match" cases (ordinary dialogue, a name starting
with a command letter, natural sentences containing numbers) - all
behaved correctly. Verified the complete, real pipeline too: a genuine
video file with an actual embedded ASS drawing-mode subtitle, through
the real ffmpeg extraction and the real subtitle-serving route,
correctly strips the drawing data while preserving a real subtitle
line elsewhere in the same file.

## Automatic new-episode notifications

Notifications previously existed only as admin-posted broadcasts,
visible to everyone. Extended the same system to also support
notifications targeted at one specific profile, rather than building
a separate, parallel notification system - a site-wide announcement
and a personal new-episode alert now both live in the same table and
the same bell icon UI, distinguished by an optional profile_id.

Also found and finished a genuinely half-built feature: an
episode_count_tracker table already existed in the schema, clearly
designed for exactly this purpose, but had zero references anywhere
in the code - an earlier, abandoned attempt. Wired it up: the scanner
now compares each show's episode count against the last-recorded
value on every scan, and a genuine increase (not just the first time
a show is ever tracked, which would otherwise flag the entire existing
library as "new" the moment this ships) notifies every profile
actually following that show - on their list, or with any watch
progress on it - linking directly to the show's page.

Verified this thoroughly at every layer: the episode-count tracking
across first-sight/no-change/genuine-increase scenarios, the
following-profiles lookup against real watchlist and progress data,
the notification targeting and cross-profile deletion security (one
profile genuinely cannot delete another's), and the complete real
scanner pipeline end to end - a seeding scan that's correctly silent,
followed by a real new episode file appearing and correctly notifying
exactly the profile following that show, with the correct title,
message, and link.

## Related shows ("Sequels, prequels, side stories")

A new, distinct section from the existing genre-similarity "More Like
This" - this one shows actual series continuity (the next season, a
side story in the same continuity) via AniList's relations data,
rather than just shared genre tags. Follows the exact same lazy-load
and caching pattern already established for Cast & Production, and
each related title gets matched against the local library, so a show
already owned links directly to it while one that isn't shows clearly
as "Not in your library" rather than a dead link.

Verified thoroughly given no live network access in this environment:
tested the AniList response filtering/mapping logic against a
realistic simulated response matching AniList's actual schema
(correctly keeps sequels/prequels, correctly excludes the manga
source material and loose character-cameo relations), then verified
the complete real route through the actual server with a pre-seeded
cache - confirmed correct local-library matching for a related show
that exists locally versus one that doesn't, and confirmed genuinely
graceful error handling (a clear message, not a crash) when the
network call itself fails.

## Correction: new-episode notifications was a duplicate, now fixed

Important correction to the "Automatic new-episode notifications"
entry above. While building the next feature, discovered that
episode_count_tracker was NOT actually unused - it was fully wired up
through a separate module (episode-tracker.js) that an index.js-only
search had missed entirely. That pre-existing system already detected
new episodes and posted notifications; it just posted them site-wide
to everyone rather than only to people actually following that title.

Building a second, parallel system against the same table was a real
mistake, not a harmless duplication - mine ran first inside the scan
transaction and would have consumed the change-detection signal
before the pre-existing system ever saw it, silently breaking already-
working functionality.

Fixed properly: removed the duplicate logic entirely, and instead
integrated per-profile targeting into the existing, working system -
episode-tracker.js now returns which type each changed item is, and
the existing notification loop now looks up actual followers (My
List, Top Picks, or watch progress) and sends each one their own
targeted, dismissible alert with a link to the show, rather than one
site-wide announcement. Verified the corrected flow directly: a
silent seeding scan, a real detected increase, correct follower
lookup, and a correctly targeted notification.

## Dub/Sub indicator and filter

No way to tell at a glance from browsing whether a show has an
English dub, without opening the player and checking audio tracks
manually. Added a "DUB" badge on cards and a "Dub Only" filter on the
search page.

Checking every show's audio tracks on every single scan would mean
probing potentially thousands of titles every time - instead, this is
checked once per show (via ffprobe on its first episode) and cached,
using the same rate-limited background-worker pattern the app already
uses for metadata enrichment. A show counts as having a dub when at
least one audio track is genuinely tagged (or titled) English -
distinct from a single, language-undefined Japanese track, which is
extremely common on sub-only fan releases and should not count.

Found and fixed a real gap while building this: the list-response
cache is keyed to the scan timestamp, and the background dub-check
doesn't trigger a rescan - so without explicit invalidation, the very
first request after startup would have cached a response with no dub
data at all, and that stale response would have stuck around until
the next full rescan. Fixed the same way an existing, similar case in
the code already does: explicitly bumping the cache key once the
background check completes.

Verified with a real dual-audio test file (genuine Japanese+English
tracks) against a real sub-only file, confirming correct detection
immediately after startup and confirming the badge/filter data
actually reaches the API response.

## Airing calendar / simulcast schedule

Explicitly, knowingly absent before ("We don't have a real airing
calendar" said so directly in the code) - added a Calendar page
showing upcoming episodes, grouped by day (Today/Tomorrow/weekday),
for shows the active profile is actually following (My List, Top
Picks, or watch progress).

Deliberately scoped to followed shows only, not the whole library -
both because that's what's actually relevant to a personal calendar,
and because querying AniList for potentially thousands of titles
nobody's even watching would be wasteful and slow. Airing schedules
are batched into as few AniList requests as possible (up to 50 shows
per request via its id_in filter) rather than one request per show,
and cached with a 6-hour TTL - genuinely time-sensitive data, unlike
the cache-forever pattern used for cast/relations which rarely change.

Verified thoroughly: the batch-query chunking math for more than 50
followed shows, the response-mapping logic against a realistic
simulated AniList response (a releasing show with a next episode
versus a finished one without), the complete real route through the
actual server (correct followed-show detection via a real watchlist
addition, graceful error handling - a clear message, not a crash -
when the network call itself fails), the TTL expiry logic directly
against both a fresh and a genuinely-expired cache file, and the
day-label grouping logic across Today/Tomorrow/this-week/further-out,
including the late-night edge case staying correctly grouped as
"Today" rather than off-by-one into tomorrow.

## Studio and cast click-through pages

Studio names and cast data both already existed and rendered on
title pages, but as plain text - no way to tap through to see
everything else by that studio or person in the library. Studio
names weren't even shown on the title page's own hero section at
all before this (only used behind the scenes for the search filter).

Studio click-through was straightforward - studios are already local
data on every show, so this is a pure frontend filter, no new backend
needed, following the exact same pattern as the existing genre pages.

Cast click-through needed more: the existing AniList query for cast
and staff never actually fetched each person's ID, only their name and
photo, so there was no reliable way to identify a specific person for
cross-referencing (name-only matching risks conflating two different
people who happen to share a name). Fixed that, then added a route
that fetches a person's full body of work from AniList and matches it
against the local library, filtered down to only what's actually
owned - a list mostly full of titles nobody has isn't useful here.

Found and fixed a real gap while wiring this up: cast data is cached
forever with no expiry, so every show already viewed before this
update would have kept silently serving old cached data missing the
new person-id field indefinitely. Versioned the cache filename to
force everyone to refetch with the new field included, rather than
leaving already-viewed titles stuck without the feature.

Verified thoroughly: the credit-list dedup/filtering logic against a
realistic simulated response (someone credited as both voice actor and
staff on an overlapping show, plus a manga credit that should be
excluded), and the complete real routes through the actual server for
both studio and person pages.

## Search history

Added per-profile recent-search chips on the search page. A capped,
deduplicating list (re-searching something bumps it to the top rather
than creating a duplicate entry, capped at 15) rather than growing
unbounded, with its own DB table since this is a list that changes
over time, unlike the single-value preferences already stored
directly on a profile.

Ownership-checked the same way every other profile-scoped mutation in
this app already is (my_list, progress, etc.) - added wrapper
functions using the same requireProfile validation already
established, rather than skipping that check or inventing a new
pattern. Verified this specifically and directly: one account
attempting to read, write, or clear another account's profile's
search history is correctly blocked on all three, with the legitimate
owner's data provably unaffected by the attempted access.

Recording is debounced to a settled pause in typing (not every
keystroke) and requires a minimally meaningful length, so partial,
mid-typing fragments don't clutter the list.

## Fixed cast images not showing, and cast coverage across the library

Two related issues, one root cause each.

**No cast images anywhere**: found directly - the CSP's img-src only
allows 'self' and data: (posters and banners already respect this,
always downloaded and served locally rather than linked directly to
AniList's CDN), but cast/staff photos never followed that same
established pattern - they were just handed back as a raw external
AniList URL, which the browser's own CSP enforcement was silently
blocking the whole time. Fixed by downloading each person's photo
locally (keyed by their AniList person id, so someone appearing in
multiple shows' cast lists is only ever downloaded once, not once per
show) and rewriting the URL to a local, CSP-compliant path before the
data is ever cached or sent to the frontend. A genuine download
failure leaves that one person's original URL in place rather than
crashing anything, and the frontend now has a proper fallback image
for that case too, rather than a broken image icon.

**Only some titles have cast info at all**: this was always meant to
be filled in automatically in the background for the whole library
(the existing "Fill Missing Studio/Cast Info" process), not something
that needs manual, per-title action. Re-versioned the cast cache
(already at v2 from the person-id fix two rounds ago, now v3) so the
very next time that backfill runs, it treats every title as needing a
fresh check again - otherwise titles that already had partial/stale
cast data (without the new local image path) would have stayed stuck
that way indefinitely, since this cache has no expiry.

Verified thoroughly: all four realistic image-localization scenarios
directly (an already-cached person skips re-downloading, a genuine
download failure degrades gracefully rather than crashing, a person
with no id or no image is correctly left untouched), the complete
real serving route through the actual server, and specifically
checked for path-traversal and injection attempts against the new
route (URL-encoded traversal, a non-numeric id, null-byte injection) -
all correctly rejected.

## Fixed the actual reason the backfill "ran but didn't do anything"

Found the real cause: Cast & Production strictly requires an AniList
id (only AniList's API exposes this data in this app), but a show
matched via the MAL import flow only ever stored its MAL id, never an
AniList one - MAL and AniList use entirely separate id spaces for the
same shows, and nothing was ever cross-referencing between them. Any
title matched through MAL was therefore permanently invisible to the
cast backfill, no matter how many times it ran - it wasn't a bug in
the backfill's logic itself, the eligible list was correctly computed,
it was just correctly empty for those titles.

Fixed properly, not just patched: AniList's API can look up its own
entry directly by MAL id (an exact cross-reference, not fuzzy title
search), so the backfill now has a first phase that finds the AniList
id for every MAL-matched show missing one, before computing what's
missing - and updates the in-memory library immediately, not just the
saved info.json, so a show cross-referenced in this same run is
immediately visible to the cast-backfill step right after it, rather
than only taking effect on a future run.

Also noticed and replaced a related, weaker version of this same idea
already in the MAL import path itself - it was already doing an
AniList lookup, but via fuzzy title search purely to grab a better
banner image, then discarding the result entirely rather than storing
it. Replaced with the same reliable idMal cross-reference, and now the
found id is actually kept, so newly-imported MAL shows are
automatically Cast & Production-eligible going forward too, not just
existing ones caught by the retroactive backfill.

Verified the complete real flow through the actual server: a genuine
MAL-only show correctly detected as needing cross-reference, the
lookup attempted, and graceful (not crashing) failure handling when
the network call itself fails, with the server fully responsive
afterward.

## Fixed the actual cause of overwhelming AniList's API

Confirmed against AniList's own documentation: the real limit is 90
requests/minute, and sustained abuse can result in an outright IP
block - a far worse outcome than some requests just running slower.

The previous rate-limiting approach only spaced out each worker's own
requests individually (350ms between one worker's own calls) - but
with 3 concurrent workers all doing that independently, the actual
aggregate rate across all of them together was far beyond the real
limit, easily exceeding 500 requests/minute at the theoretical
ceiling. And when a 429 did happen, only the one worker that hit it
paused - the other two kept firing throughout that entire wait,
which if anything made the situation worse, not better.

Replaced this with a single, global, serialized limiter that every
AniList request in the entire module funnels through, regardless of
which part of the app is calling it (search, imports, the backfill,
all of it) - so what's actually being limited is the true aggregate
rate, not just one call site's own local spacing. A 429 now reads the
API's own Retry-After header and pauses every subsequent request
globally until that specific time, not a guessed fixed delay applied
to just the one request that got limited.

Verified the actual mechanism directly, not just trusted the design:
simulated 5 concurrent callers all firing at once (the exact shape of
the backfill's worker pool) and confirmed they get correctly
serialized to a true aggregate rate around 83/min, safely under the
documented ceiling - then simulated a 429 with a Retry-After value and
confirmed two other, otherwise-concurrent callers both correctly
waited out the full specified pause, not just 900ms.

## Fixed subtitles showing twice on mobile (a bigger and a smaller version)

Found a genuine race condition, confirmed against the actual spec
rather than guessed at. Safari requires a subtitle track's default
attribute to be set to true for this app's own cue-tracking (the
custom, styleable overlay) to work at all - that's a hard Safari
requirement, not something that can just be removed. But per spec, a
track's default mode is "showing" whenever default is set, and mode
was only being switched to "hidden" inside a short delayed callback
(needed because reading the track back through the video element
requires it to be attached to the DOM first) - meaning there was a
real, if brief, window where the track could start out in native
"showing" mode before JS ever suppressed it. Once a browser starts
natively rendering a cue, switching mode away later doesn't reliably
retract what it's already drawn - a concrete, plausible explanation
for exactly what was reported: a duplicate, differently-styled
subtitle (the app's own styled overlay, plus a leftover native one
using default browser styling, typically smaller) - and mobile
browsers are more likely to lose this particular timing race than
desktop.

Fixed by closing the window entirely rather than reacting to it after
the fact: HTMLTrackElement.track (the underlying TextTrack) is
available immediately on element creation, per spec, not tied to DOM
insertion - so mode can be, and now is, set to "hidden" synchronously,
before the track is ever appended to the video at all, rather than
relying on a later fix-up that leaves a real gap for native rendering
to begin.

Verified this against the actual HTML5 specification and MDN's own
documentation for both the default-mode behavior and the timing
guarantees of HTMLTrackElement.track, rather than assuming - the
underlying sandbox environment was reset before this fix could be
tested end-to-end through a live server, so this note is honest about
that: the fix is grounded in confirmed spec behavior and the exact,
correct statement ordering, verified directly, but not yet exercised
against a real mobile browser.

## Self-registration from the login page

Added a "Create Account" option on the login page, toggleable from
admin settings (Server Settings), defaulting to on. New accounts made
this way always get the plain, basic "user" role - the same one
already used for every non-admin account - never able to grant
themselves admin access, and the toggle can be switched off at any
time to go back to requiring an admin to add every account manually.

This is a genuine security-relevant change (self-registration means
literally anyone who can reach the login page can create an account,
unless the server is otherwise firewalled off), so it's worth being
explicit: the security-critical part is that a self-registering,
unauthenticated person has absolutely no way to request admin access
for themselves - the server-side code never reads a role value from
their request at all in that path, it's hardcoded to "user" instead,
regardless of what they submit. Tested this directly and rigorously: 8
scenarios covering first-account setup, normal self-registration, an
admin creating an account on someone else's behalf, and critically, a
simulated attempt to self-register while sneaking role: "admin" into
the request body - confirmed it's still forced to a plain user account
either way.

One honest caveat: the sandbox environment this was built in doesn't
currently have a way to run a real HTTP server for full end-to-end
testing (no cached npm packages available offline). The core security
logic was verified directly and rigorously as described above, and the
full data flow (the setting itself, through to the login page's UI)
was traced by hand and syntax-checked, but this hasn't been exercised
through an actual running server the way most of this project's
features have been. Worth trying this one out and reporting back if
anything looks off.

## Require admin approval for self-registered accounts

Added a second toggle alongside self-registration itself (Server
Settings), defaulting to on: a newly self-registered account can be
created, but can't sign in at all until an admin approves it from
Manage Accounts, which now shows a dedicated "Pending Approval"
section with Approve/Reject actions for exactly this. Doesn't apply
to the very first account ever (which always needs to get in
immediately - there'd be no admin around yet to approve it otherwise)
or to accounts an admin creates directly themselves.

The actual security enforcement happens at login, not just at
registration - a pending account's password can be completely
correct and it's still refused entry with a clear, specific message,
not a generic failure. Deliberately doesn't count as a rate-limited
login failure, since the password being right means this isn't a
brute-force attempt, just someone waiting on approval - and a WRONG
password on a pending account still returns the same generic
"incorrect username or password" as any other failed login, so
someone without the right password can't even find out an account is
sitting there pending. Also added a defense-in-depth check at the
session-validation level itself (not just at login) - if an admin
ever revokes an already-approved account later, this cuts off any of
its still-active sessions immediately too, not only new login
attempts.

Verified this rigorously with the same approach used for the
self-registration feature itself, given the sandbox environment still
doesn't have a live server available to test end-to-end: 12 scenarios
extracted directly from the real logic across registration, login, and
session validation, including the critical privilege-escalation
attempt (self-registering with a forged admin role while approval is
required - still ends up an unapproved plain user) and the
information-leak check (a wrong password never reveals that an
account exists and is merely pending). All 12 passed.

## HTTPS status visibility in Settings

Investigated the report that a generated certificate still showed as
"unsecured". Found a real, previously-invisible gap rather than a bug
in the certificate generation itself: config.json (including the
certificate paths) is only ever read once, at server startup - so if
the server was already running when the certificate got generated,
that process keeps silently serving plain HTTP for the rest of its
life, even though the certificate files genuinely exist and config.json
was correctly updated to point at them. The generate-cert scripts
already say to restart the server afterward, but there was previously
no way to actually confirm from inside the app whether that step had
been done, or whether HTTPS was doing anything at all - the only
signal was the server's own startup console output, easy to miss
entirely if it's running as a background/autostart service.

Added a clear HTTPS status line to Server Settings, distinguishing
three different states rather than a blunt "on/off": genuinely active
(green), configured with the certificate files present but not yet
loaded by this running process (amber, explicitly says a restart is
needed), and not configured at all (with a direct pointer to the
generate-cert scripts). This should make it very fast to tell, at a
glance, whether this is the "just needs a restart" case or something
that actually needs troubleshooting further.

Verified the status logic directly against all four realistic
combinations (nothing configured, fully active, the specific "restart
needed" trap, and configured-but-files-missing/moved) - correctly
identified in every case.

## AMD hardware decode for AV1 sources

Previously the decode-hwaccel selection only had branches for Intel
QSV and NVIDIA NVENC - an AMD setup (iGPU or discrete, including a
Ryzen 7000 non-F iGPU or an RX 6000-series card like the 6700 XT,
both of which do support AV1 hardware decode) always silently fell
back to slow software decode for AV1 source files, purely because
this code path didn't exist yet. Not a hardware limitation - the
hardware was already capable, the app just never asked it to.

AMD doesn't expose hardware decode through AMF the way it exposes
encode through it - AMF is primarily an encode API. Decode instead
goes through d3d11va, Windows' generic, cross-vendor hardware decode
API (it also works for Intel/NVIDIA, though those already have their
own dedicated, more specific paths). Also added the equivalent VAAPI
decode path for Linux AMD/Intel setups while addressing this, for the
same underlying reason.

This automatically inherits the exact same watchdog-and-software-
fallback safety net already built and proven for QSV/NVENC decode -
no separate error handling needed, since that mechanism already wraps
every hardware decode attempt generically, regardless of which vendor
it is.

Verified the branch-selection logic directly against all four hardware
types plus the two edge cases (software/none, and decode not
requested at all) - all six behave correctly, syntax-checked cleanly,
and confirmed no accidental duplication in the surrounding function.

## Fixed seeking resetting playback to the beginning

Found the actual root cause, confirmed directly against hls.js's own
official documentation rather than guessed at. The network-error
recovery code was calling startLoad() with no arguments - which is
hls.js's own official example recovery code, word for word - but per
hls.js's own docs, no argument means startPosition defaults to -1,
and "if set to -1, playback will start from initialTime=0 for VoD."
On a VoD stream (all this app ever serves, never live), that silently
resets playback to the very beginning instead of resuming from
wherever it actually was.

A fatal network error is quite plausible right after seeking somewhere
whose segments haven't been generated yet, since HLS segments are
produced progressively as the transcode catches up, not all upfront -
so seeking forward (or anywhere not yet transcoded) could trigger
exactly this "fatal network error -> recover with startLoad() ->
silently restart from zero" sequence, which matches the reported
behavior directly.

Fixed by explicitly passing the actual current position to startLoad()
instead of leaving it to the -1 default, so recovery actually means
resume, not restart.

## The real fix for seeking/resuming into not-yet-transcoded territory

The earlier seek-reset fix addressed a genuine bug (error recovery
resetting to position 0), but couldn't fix the deeper issue behind
the reported "can't decode this video" error: HLS segments are
generated strictly sequentially from wherever a session starts, and
there was no way anywhere in this codebase to start one from a
different point. Seeking (or resuming saved progress) into a position
significantly ahead of what's actually been transcoded so far meant
the segment genuinely didn't exist and wouldn't for a long time -  the
server's own segment-wait already times out at 15 seconds and 404s,
which is nowhere near enough time for a sequential transcode to
"catch up" to a seek far ahead of it.

Built real, actual seek support for HLS: the transcode session itself
can now start at an arbitrary offset (ffmpeg's own input seeking,
which is fast and keyframe-aligned, not a full decode-and-discard from
position 0), with its own distinct cache key so it doesn't collide
with a from-the-beginning session for the same file. A normal seek
still uses fast, native in-session seeking when the target is already
covered by the current session - a restart only happens when
genuinely needed: seeking before the current session's own start
(nothing there for it to seek to at all), or a real network error
recurring at essentially the same position (the concrete sign that a
resume-in-place retry also failed, meaning the segment truly isn't
available yet rather than a transient blip). Also fixed the closely
related case of resuming an episode from deep into it - previously
this started a fresh session from position 0 and then tried to jump
forward immediately, hitting the exact same wall a live seek would.

Verified the core offset-transcoding capability three separate,
increasingly rigorous ways before building anything else on top of
it: a direct call to the real transcode function, a fully automated,
deterministic pixel-difference comparison (a source video with an
exact, legible timestamp burned into every frame, confirming the
output's first frame is genuinely closest to the requested offset and
not the beginning), and a complete real HTTP round trip through the
actual server and routes, re-verified with the same pixel comparison.
Also confirmed the client-side changes are genuinely present in what
the real server actually serves - caught and fixed a bug in this
session's own test harness along the way (a static-file-serving order
issue that was silently serving the wrong content during testing),
verified it wasn't an application bug before moving on.

## Fixed a regression from the seek-offset work: playback resetting repeatedly during normal use

Found a real design flaw in the escalation logic added alongside true
HLS seek support. It was built to handle one specific case: a genuine
far seek, where a segment will never arrive without a fresh session
because it's well beyond where the sequential transcode currently is.
But the trigger condition for escalating to a full session restart -
two network errors landing near the same position - can't actually
tell that apart from something completely different and totally
normal: the transcode running only slightly behind real-time and
needing a brief moment to catch up, which the server's own existing
poll-and-wait already handles correctly on its own, with no restart
needed at all.

Escalating on the same trigger for both meant an ordinary, harmless
buffering hiccup during otherwise normal playback could throw away a
session that was working perfectly fine and force a full restart -
and if the encoder was already running close to real-time, the fresh
session could easily hit that same limit again quickly, repeating the
same "escalate and restart" cycle. That's a direct, plausible
explanation for exactly what got reported: playback resetting
repeatedly during ordinary use, not specifically tied to seeking at
all.

Fixed by gating the restart escalation behind an actual, recent
explicit seek (within the last 20 seconds) - not just the two-errors-
near-the-same-position pattern alone, which genuine far-seek failures
and ordinary real-time catch-up hiccups can both produce. Without a
recent seek, a network error now falls back to exactly the original,
already-proven-safe behavior: resume-in-place retry, no restart. This
also covers a related, broader risk in the same class - an adaptive-
bitrate quality switch initiated by hls.js itself (not a user action)
could plausibly cause the same kind of transient hiccup while its
newly-selected variant's session is still spinning up, and this same
fix correctly excludes that case from escalating too.

## Fixed videos taking longer to load - a second regression from the seek-offset work

Found the real cause with a direct measurement, not a guess: timed
actual time-to-first-segment for a fresh start versus an offset-based
one, and the offset start wasn't inherently slower at all. The real
issue was cache reuse. Progress autosaves every 8 seconds, so a
typical re-visit to an episode almost never has a resume point that
exactly matches whatever offset an existing, already-running session
happened to start at. Making the offset part of the session's cache
key unconditionally (needed for the actual seek fix to work) meant a
warm session that used to get reused instantly - the previous,
already-fast behavior for the common case of opening or resuming an
episode - now got thrown away and restarted completely from scratch
on nearly every single load.

Fixed by only using an offset-based session start on a genuine
restart - not proactively on every load. A fresh load (including
resuming saved progress) now starts its session at 0, same as always,
restoring cache reuse for the common case - and does a native client-
side seek to the actual resume point once ready, exactly like before
any of this offset work existed. The offset-based start is reserved
for the two cases that actually need it: seeking to before the
current session's own start, or the network-error escalation after a
demonstrated seek failure - both already known, at the point they
fire, that a native seek genuinely won't work.

Verified directly: two separate, non-restart requests for the same
episode now correctly resolve to the exact same cache key and the
server log confirms only one session actually started, not two - and
a genuine restart request still gets its own correctly distinct
session at the requested offset, so the actual seek fix from before
remains intact.

## Fixed the app feeling slow to enter a series - a real gap in the AniList rate limiter

Found a genuine, concrete cause rather than a vague "seems slow":
opening a title page triggers a couple of AniList requests (cast,
related shows), and the global rate limiter added earlier to fix
"overwhelmed the API" was a strict, single first-in-first-out queue -
no priority at all. If the metadata backfill (which now also runs the
MAL<->AniList cross-reference pass) is active in the background,
potentially queuing up requests for hundreds of shows, a request
triggered by someone actually opening a series right now had to wait
behind literally all of them first before it even started - a direct,
concrete way for the app to feel slow specifically around entering a
series, without transcoding or anything else actually being broken.

Rebuilt the limiter with two priority lanes sharing the same overall
rate budget - foreground, user-triggered requests (opening a title
page, importing a specific show by hand) always get served next
whenever a rate-limit slot opens, ahead of anything still waiting in
the background queue, regardless of how long the background items have
already been waiting. The background backfill's own requests now
explicitly request low priority; everything else defaults to high
automatically, without needing to touch every single call site, since
the only calls that ever need to opt into low priority are the
backfill's own. The overall rate limit itself - spacing between
requests and the 429 backoff - is still fully respected across both
lanes combined, so this doesn't reopen the original overwhelming-the-
API problem, it just stops background bulk work from starving
foreground responsiveness while sharing the same budget.

Caught and fixed a real bug of my own while wiring this up: one
function is used by both a foreground flow (an admin actively
importing a specific show by hand, who is waiting on it) and the
background backfill, so it can't have a single correct default - fixed
by having the foreground call site explicitly request high priority
rather than trusting the function's own default, which is correctly
low for its other, actually-background caller.

Verified the priority mechanism directly: simulated a background
process queuing up 10 low-priority requests all at once, then a
high-priority request arriving a moment later, and confirmed the
high-priority one correctly jumps ahead of 7 still-waiting low-
priority items - only waiting for the next available rate-limit slot
(under a second) rather than the full queue (which would have taken
several times longer).

## Found and fixed why QuickSync hardware decode was silently failing every time

A user shared their actual server log, which made this fully
diagnosable rather than a guess. It showed the server correctly
detecting "Video transcoding: Intel Quick Sync (QSV)" at startup, but
every single hardware-decode attempt failing immediately with "Error
reinitializing filters! ... Function not implemented", followed by
the app's own watchdog correctly catching it and retrying with
software decode - which then succeeded. So playback worked, but
silently as software HEVC decode + hardware H.264 encode, a hybrid
that's genuinely CPU-intensive on the decode half alone - a direct,
evidence-based explanation for CPU being pegged even with QuickSync
showing as active.

The actual cause, confirmed directly from ffmpeg's own warning in that
log: with QSV hardware decode active, ffmpeg keeps decoded frames as
GPU-resident hardware surfaces by default (a legacy compatibility
behavior specific to QSV) - but the existing format=nv12 filter (added
earlier to force compatible 8-bit output for 10-bit HEVC sources) is a
plain, software-only filter that can't operate on those hardware
surfaces at all. That mismatch was failing every time hardware decode
was attempted, for any file needing re-encode, not just this one show
- meaning hardware decode had likely never actually worked on this
setup at all.

Fixed by adding hwdownload before the existing filter chain
specifically when QSV hardware decode is active - explicitly copies
frames back to system memory first, letting the existing, already-
correct filter run unchanged after that. Chose this over the
alternative (vpp_qsv/scale_qsv, which can stay fully GPU-resident and
save a little more CPU) deliberately: that alternative has documented,
version-specific breakage across different ffmpeg builds and Intel
MSDK versions, and reliability across many different users' own
ffmpeg installs matters more here than a small additional efficiency
gain. Also explicitly set hwaccel_output_format qsv, matching what
ffmpeg's own deprecation warning recommends, rather than continuing to
rely on a default behavior that warning says will be removed in a
future version. Scoped specifically to QSV, where this was directly
confirmed - not speculatively extended to NVENC/AMF, which don't
default the same way and have no evidence of the same problem.

Verified the exact resulting command directly against the real,
exported function: confirmed hwdownload and the explicit output
format now appear correctly when hardware decode is requested, and
confirmed the software-decode fallback path is produced completely
byte-for-byte unchanged, so this is a purely additive fix with no risk
to the already-working fallback.

## QSV hardware decode fix, round 2: the first attempt wasn't enough

The user's next log showed the previous fix (hwdownload,format=nv12)
still failing, with a more specific error this time: "Invalid output
format nv12 for hwframe download." Different failure, same underlying
root problem, one layer deeper - the source is genuinely 10-bit
("hevc Main 10, yuv420p10le", confirmed directly in the log's own
stream info), and it turns out a 10-bit QSV hardware surface can't be
downloaded directly as 8-bit nv12 through hwdownload+format at all.

Traced this to a specific, already-documented FFmpeg/driver
limitation - confirmed directly from FFmpeg's own official bug
tracker (trac.ffmpeg.org #7764, "Support for HW accelerated 10-bit ->
8-bit conversion support"), which states plainly: "just doing format
conversion fails" for this exact scenario, with the documented,
working alternative being to go through the QSV hardware scaler
filter itself (scale_qsv), which can perform the bit-depth conversion
QSV-side rather than needing a plain system-memory format filter to
do it after the fact. Multiple independent, unrelated sources
converged on this same fix for this same scenario, which is why it's
now the one actually implemented, replacing the hwdownload attempt
entirely - not layered on top of it.

Verified the exact resulting commands directly against the real,
exported function again, for both the no-resize (codec-fix) and
with-resize (quality-tier downscale) cases, and re-confirmed the
software-decode fallback path is still produced completely unchanged.

Worth being direct about: this is now the second attempt at this
specific fix, based on strong evidence (the official FFmpeg tracker,
corroborated by several independent sources) but still not something
directly tested against real QSV hardware in this environment, which
doesn't have any. The existing watchdog fallback this all sits inside
is untouched by any of this and remains fully intact regardless - if
this attempt still isn't enough, playback keeps working via the
proven software-decode path exactly as it already does, just without
the CPU savings hardware decode would add.

## Series logos on the title page, reusing an existing Plex library

Rather than integrating a whole separate metadata source (e.g. TMDB)
just for logo artwork, this reuses logos a Plex Media Server on the
same machine/network has already downloaded, confirmed genuinely
available (the user could see them in their own Plex library already)
before building anything. New Settings fields for the Plex server URL
and an access token (with instructions for finding an existing token
via the Plex web app, rather than the app ever handling Plex account
credentials directly), a new plex.js module that searches Plex's
library by title, prefers an exact title match over Plex's own
relevance ranking, and downloads the logo image locally (Plex is
typically plain http on the local network, unlike the existing
AniList/MAL image downloader which is https-only) - then a route that
checks a small cache table first (so a title page never re-queries
Plex on every single visit) and serves the logo directly, or a clean
404 when there's no Plex configured, no match, or no logo for a
matched show.

The frontend tries loading the logo image directly and only swaps out
the plain text title if it actually loads - silent, permanent
fallback to text in every other case, since this is a nice-to-have
visual touch that should never risk leaving a title page half-broken.

Built defensively throughout given real uncertainty that couldn't be
fully resolved without a live Plex server to test against in this
environment: the exact response shape for Plex's clearLogo field
checks a couple of plausible locations rather than assuming one exact
shape, and every failure mode anywhere in the chain (no match, no
logo, Plex unreachable, unexpected response shape) resolves to a clean
"not available" rather than an error, so a wrong assumption about the
exact API shape degrades gracefully instead of breaking anything.

Caught and fixed a real security issue while building this: the
existing /api/config route returned the complete config, including
the new Plex token, to any logged-in user, not just admins - fine for
a non-secret value like the MAL client ID, not fine for a genuine
full-access credential to someone's Plex server. Fixed by redacting
the token specifically for non-admin requests, verified directly: a
non-admin account now gets no plexToken key in the response at all,
while an admin's is unaffected.

Also caught and fixed a small, separate, pre-existing bug while
investigating what first looked like a save issue: the registration
response's account object was missing the approved field entirely, so
it always displayed as false regardless of the account's actual
approval state - including, confusingly, for the very first account
ever, which always auto-approves. The database and login behavior
were always correct; only this one response's displayed value was
wrong. Verified the fix directly: a first account now correctly shows
approved:true immediately, and a genuinely-pending self-registered
account still correctly shows approved:false.

## Swapped Plex for Jellyfin as the series-logo source

Replaced the whole Plex integration with Jellyfin, at the user's
request, specifically for security reasons - and Jellyfin genuinely is
the better choice here. It authenticates with a dedicated API key
(Dashboard -> API Keys in Jellyfin), which is independently named,
scoped as a service credential, and revocable at any time without
touching anyone's actual login - unlike Plex's token, which is tied to
a full account session. Jellyfin's API is also fully open source with
a clearly documented, versioned spec, so the Logo image type and
search endpoint used here are built on much more solid, verifiable
ground than Plex's less formally documented (and, for the clearLogo
field specifically, much more recently and unevenly rolled out) API
was.

Same overall design as the Plex version: search by title, prefer an
exact match over Jellyfin's own relevance ranking, cache per-show so a
title page never re-queries Jellyfin on every visit, and fall back
silently and permanently to the plain text title for every failure
mode - no Jellyfin configured, no match, no logo for a matched show,
or a network hiccup.

While re-verifying the swap, chased down what looked at first like a
hang on the old, removed Plex route - turned out to be a genuine gap
in this session's own test harness (a minimal Express shim), not an
application issue: it affected any unmatched /api/ path at all, not
just the removed one, and traced back to the app's catch-all handler
correctly calling next() the way real Express expects, which the shim
didn't fully support yet. Fixed the shim and re-verified cleanly: the
old route now correctly returns a normal 404 (not a hang), and the new
series-logo route, the Jellyfin API key's admin-only redaction, and
the full settings/frontend wiring all check out end to end.

## Better diagnostics for "logos aren't showing up"

Investigated a report of logos not appearing on a genuinely fresh
setup. Checked the one concrete risk that seemed most likely first -
whether visiting a title page before Jellyfin was configured could
permanently cache a false "no logo" result, blocking any retry even
after Jellyfin gets set up correctly - and confirmed this specific
concern isn't actually possible: the route already skips caching
entirely whenever Jellyfin isn't configured yet, checked directly in
the code.

That still left several other real possibilities that all look
identical from the outside with only "logo doesn't show" to go on -
Jellyfin unreachable, a wrong API key, a title not matching between
the two libraries (probably the most common real-world cause), or a
matched show genuinely having no Logo image set in Jellyfin itself -
each needing a completely different fix, and no way to tell them
apart without visibility into what's actually happening server-side.

Added detailed, step-by-step logging to make this diagnosable:
console output for what a title search actually returned and how many
matches, whether a match was exact or a fallback to the closest
result, and a clear distinction between "no match found" (most likely
a naming difference) and "matched fine, but the request for its logo
itself failed" (most likely a connectivity/auth problem, or the show
genuinely has no logo in Jellyfin) - all previously silent, with only
a plain "false" coming back either way.

## Chasing "nothing shows up, confirmed Jellyfin has the logos"

Two server logs sent in a row, both after being told a title page had
genuinely been visited, showed zero request-level activity at all for
this feature - no [jellyfin-logo] lines whatsoever, not even the
"request received but not configured" message that already exists
and fires unconditionally the moment the route is hit. That's a
meaningfully different signal than "Jellyfin didn't have a match" -
it means the request was never made in the first place, which points
at the browser/client side, not the server.

Ruled out browser caching of the JS file itself first - this app
already has deliberate cache-busting for its scripts (a build-version
query string applied uniformly to every reference), so stale cached
JavaScript is a less likely explanation than it would otherwise be.

The more likely explanation: wireSeriesLogo was called last among
several wiring functions on the title page (cast, related shows,
reviews, theme song) - if any of those throw a synchronous JavaScript
error, everything listed after it in that same function simply never
runs at all, silently, with nothing appearing anywhere to explain why
- not a server log, not even a network request being made. Moved it
to run first instead, so it can no longer depend on any of the others
succeeding.

Also added direct browser-console logging to the actual check itself,
independent of server logs entirely - since if this turns out to be a
client-side issue, server logs would never show anything no matter
what changes on the server. Opening browser devtools (F12) -> Console
while visiting a title page should now show exactly what's happening:
whether the request was even made, and whether it succeeded or failed
client-side.

## The actual bug behind "db.getSeriesLogoCache is not a function" - genuinely mine, not a deployment issue

A full, clean folder re-extraction still hit the exact same crash,
which correctly ruled out the earlier "stale file" theory entirely -
that diagnosis was wrong, and cost real time. The actual cause was a
real bug in this code: server/index.js imports db.js via destructuring
- `const { db, getFollowingProfiles, ... } = require('./db')` - and in
this file, `db` specifically refers to just the raw SQLite connection
object (used only by the backup system), not the whole module. Every
other database helper in this file is correctly called as a bare
function name pulled out by that destructuring, not as db.something().
The series-logo route was written calling db.getSeriesLogoCache(...)
and db.setSeriesLogoCache(...) as if db were the whole module - it
isn't, in this specific file - so both calls were reaching for a
method that plainly doesn't exist on a raw database connection.

This also explains why testing db.js in isolation earlier didn't catch
it: that test exercised the module correctly on its own terms, but
never went through the specific, narrower way index.js actually
imports and uses it, which is exactly where the mismatch lived.

Fixed by adding the two missing functions to the destructuring import
and calling them as bare function names, consistent with every other
database helper already used throughout this same file. Verified with
a real, live test built to specifically replicate the crash: Jellyfin
configured (even with a nonexistent address, so the actual network
request would fail too) and the exact route hit end to end - confirmed
no crash, a clean graceful failure handled correctly, and the log
showing a genuine connection attempt was made rather than being
skipped, which is the full chain actually working as intended.

## Fixed: no way to ever see a newly-added Jellyfin logo without this

A real gap in the caching, not a bug exactly - once a show was
checked and found to have no logo, that negative result was cached
permanently, with no expiry and no way to trigger a recheck. Adding a
logo in Jellyfin afterward had no way to ever be reflected here again.

Two-part fix. A negative result now naturally expires after a week
and gets re-checked on its own - a reasonable default that doesn't
need anyone to remember to do anything. And for immediate needs (right
after actually fixing something in Jellyfin, not wanting to wait a
week), a small "Recheck logo in Jellyfin" button now appears - admin-
only, and only once a "no logo" result has actually been confirmed -
that clears the cached result and immediately re-queries Jellyfin.

Verified the complete real flow end to end: a first check genuinely
queries Jellyfin and caches a negative result; a second, ordinary
check correctly hits that cache without re-querying Jellyfin at all
(so this doesn't turn into hitting Jellyfin on every single page
load); a non-admin cannot trigger the forced recheck; and an admin's
forced recheck genuinely clears the cached result and queries Jellyfin
again from scratch, confirmed directly in the log by "checking
Jellyfin for the first time" appearing a second time only after the
explicit clear.

## New: Duplicate Series detection in the Admin Dashboard

Finds shows likely scanned into more than one folder for the same
series - usually a rename, a re-download under a different name, or
a folder that never got merged with an existing one.

Groups by the strongest available signal first: a shared AniList or
MAL match is close to certain proof of a genuine duplicate, so that's
checked before anything else. Only for whatever's left uncovered by
that does it fall back to a normalized title match - a much weaker
signal, but still useful given how many real libraries have titles
that never matched either source at all (nothing to compare by id
for those). A pair already caught by a reliable id match never also
shows up again under the weaker title signal.

Each group shows every show's title, its actual folder name (so
there's no ambiguity about which one is which on disk), and a direct
link to its title page to review before deciding what to do.

Verified with a real, realistic test library covering all three
cases at once: two folders deliberately matched to the same AniList
id (a genuine duplicate), two folders sharing a title but never
matched to AniList/MAL at all (a title-only duplicate), and one
completely unique show as a control - confirmed both real duplicate
pairs were found with correct folder names, grouped under the right
signal, and the unique show correctly never appeared in any group at
all.

## Fixed: a title change (re-match, correction, duplicate resolved) leaving the wrong Jellyfin logo stuck

A real, distinct gap from the earlier caching fix - that one handled a
negative result never expiring; this one is about the cache not
knowing the title it was checked under could go stale at all. The
cache is keyed by the show's internal library id, which stays the
same across a title change (re-matching to a different AniList/MAL
entry, a manual correction, a duplicate getting resolved) - so nothing
previously detected that a cached result, positive or negative, no
longer corresponds to what should actually be searched for in
Jellyfin. A show that got a logo attached under a wrong, earlier match
would stay stuck showing that same wrong logo forever, with no
automatic way to notice the title underneath it had changed.

Fixed by storing the title a cached result was actually checked under
alongside it, and treating any mismatch against the show's current
title as automatically stale - not just for a cached "no logo" (which
already got a manual recheck button earlier), but for a cached "yes,
here's a logo" too, since serving the wrong logo silently is worse
than just missing one. A real title change now transparently triggers
a fresh Jellyfin lookup under the corrected title on the very next
visit, with no manual action needed.

Verified directly and precisely: pre-seeded a cached positive result
(a logo hit) under a specific old title, then had the actual library
report a different current title for that same show id - confirmed
the mismatch was correctly detected and a genuine fresh check was
triggered rather than the stale result being served, exactly matching
the reported scenario of a logo staying stuck to an incorrect match.
Also confirmed the same title-change detection applies to a cached
negative result, and that an unchanged title still correctly uses the
cache without any unnecessary re-querying.

## Fixed: unnecessary full-library rescans triggered by Plex's own files sharing the media folders

Found directly in real server logs, not a guess - repeated
[auto-rescan] events triggered by files like ".chapters\...xml" and
"...trickplay", which turned out not to be anything this app writes
at all: its own trickplay cache lives entirely in a separate data
directory, never inside the media folders. These are almost certainly
Plex's own chapter-marker and preview-thumbnail artifacts, written
directly alongside the media since it scans the same shared library -
this app's file watcher had no way to tell those apart from an actual
library change, so it correctly, but wastefully, triggered a full
rescan every time.

Extended the existing exclusion filter (already used for this app's
own info.json/cover/banner writes) to also skip these known third-
party artifact patterns. Verified directly against the real filenames
that actually appeared in a real server log, confirmed the existing
exclusions and all real video-file changes are completely unaffected,
and specifically tested a deliberately tricky edge case - a
legitimately named video file containing the word "Trickplay" in its
own title - to confirm the pattern is properly anchored and would
never suppress a real media change.

## Widened the rescan debounce - reducing disk I/O contention with active playback

Traced a stutter report to a real pattern found directly in a fresh
server log, not a guess: roughly 15 full-library rescans (1633+
titles each) within just a few minutes, several of them interleaved
directly with active HLS playback sessions for the episode actually
being watched.

Checked carefully before touching anything, since a wrong fix here
risked breaking already-correct, deliberate design: confirmed
scanning genuinely runs in its own isolated worker thread, not the
main event loop, exactly as an existing comment in library.js already
documented - so this was never actually blocking the server the way
an initial read of "lots of synchronous fs calls" might suggest.

But that same comment revealed the real, more precise mechanism:
worker-thread isolation doesn't isolate from the underlying hardware
every worker still shares - already documented in that file as a
real, previously-observed source of contention on one real machine
(disk/CPU, even between "isolated" workers). A full rescan of a
1600+-title library competing for the same disk/network I/O active
video playback also needs to read the file being streamed is a
direct, plausible cause of exactly the kind of stutter reported,
independent of whether the main thread itself is ever blocked.

The debounce window (originally 5 seconds) couldn't help here since
real logs showed genuinely spaced-out, distinct changes - each
rescan completing well before the next one's trigger fired, not
rapid bursts a short window already coalesces fine. Widened to 30
seconds, which directly cuts how often a full rescan runs at all,
and by extension how often it can compete with active playback for
the same I/O.

## Fixed: mobile playback resetting to the beginning repeatedly - a real gap the earlier hls.js fix never covered

Investigated carefully before assuming this was the same bug already
fixed earlier this session (HLS error recovery defaulting to position
0) - it wasn't, and checking the actual code confirmed why. That
earlier fix, and everything built since (offset-based restart
sessions, the seek fix), only ever applied to the hls.js code path.
iOS and most mobile browsers use native HLS support built directly
into the video element instead - no hls.js involved at all - and that
native path had genuinely zero error handling of its own: just
setting video.src and nothing else. It relies entirely on the
browser's own opaque, black-box HLS implementation, which offers no
error events to react to the way hls.js does - if that implementation
has its own internal recovery behavior that restarts from the
beginning (a very plausible default for exactly the same underlying
segment-availability reason the original hls.js bug had), there was
never any way to intervene, because there was nothing to hook into at
all.

Since the browser gives no error signal for this, the fix works from
the only thing that actually is observable: currentTime jumping
backward significantly with no real user seek behind it (reusing the
seek-timestamp tracking already built for the hls.js fix to tell a
real seek apart from an unexplained drop). A single occurrence gets a
direct, immediate correction back to the right position - the
underlying session is very likely still fine, so a full restart would
be overkill. A second occurrence at roughly the same spot means the
direct correction isn't holding, so it escalates to the same offset-
based session restart already proven for the hls.js path, rather than
repeating a correction that clearly isn't working.

Verified the core detection logic directly against five scenarios,
including the edge cases that actually matter for not causing new
problems: normal forward playback and a legitimate user seek backward
both correctly produce zero corrections (no false positives), a small
buffering-related fluctuation under the threshold is correctly
ignored, a genuine single phantom reset is detected and corrected
once, and a repeated one at the same position correctly escalates to
a full restart instead of looping on a fix that isn't working. Also
caught and fixed a real risk while wiring this in: the new tracking
variables were initially declared later in the file than a function
that already references them, which could have thrown a definition-
order error - moved the declaration to guarantee it always runs
first, and reset explicitly on every load so a stale value from a
previous episode can never be mistaken for a phantom reset on a
freshly-loaded one.

## Two-factor authentication (TOTP)

New, fully optional per-account security feature - works with any
standard authenticator app (Google Authenticator, Authy, 1Password,
etc). Built on Node's own built-in crypto module, no new dependency,
and reuses the app's own existing, dependency-free QR code generator
(already used for device pairing) to display the setup code, rather
than needing a new one.

Setup, from Settings: scan a QR code (or enter the secret manually),
confirm it's actually working by entering the code it's currently
showing, then save a set of one-time backup codes shown exactly once
- the only way back in if the device itself is ever lost. From then
on, logging in asks for a code after the password, accepting either
a real TOTP code or one of the backup codes (each usable once, then
permanently spent).

The core TOTP algorithm was verified against the official, published
RFC 6238 test vectors before it was ever wired into anything - all 5
passed exactly. The full account-level flow (setup, wrong-code
rejection, correct confirmation, login with a correct code, login
correctly rejected with a wrong code, backup code login, backup code
reuse correctly blocked, a different unused backup code still
working, disable correctly requiring the real password) was verified
directly against a real account and real database state, and the
complete login flow was then verified again through the real HTTP
routes end to end: a password-only login attempt correctly returns a
distinct signal without ever issuing a session, and only a correct
follow-up code actually completes it.

A wrong code counts as a real login failure for rate-limiting
purposes, same as a wrong password - a 6-digit code has far fewer
possibilities than a real password, so brute-forcing it needs exactly
the same protection, not a lesser one.

## Two more fixes: QSV hardware contention, and a real bug in the AniList rate limiter

**QSV concurrent-session contention** - confirmed directly from an
earlier real server log ("Error querying IO surface: unsupported"
repeating rapidly when two HLS sessions for the same show started in
close succession, e.g. "Auto" quality bringing up more than one
variant). Two fixes:
- A lightweight lock that serializes only the brief hardware-
  initialization moment itself, not transcoding overall - the first/
  only hardware session in flight never waits at all, but a second one
  arriving while the first is still in its own startup window now
  waits out the remainder of that window before it also tries to grab
  a QSV context, rather than colliding with it. Verified directly:
  a lone session has zero added delay, a genuinely concurrent one
  correctly waits, and one arriving after a quiet period is never
  delayed either.
- Fast-failure detection for the exact repeating error pattern from
  that real log - five occurrences within one session now triggers an
  immediate kill-and-retry with software decode, instead of waiting
  out the full pre-existing 20-second watchdog for something this
  unambiguous. Verified against the real pattern (correctly triggers),
  a single transient occurrence (correctly does not), and normal
  output (never triggers).

**A real, previously-undiscovered bug in the AniList rate limiter** -
found while investigating why "Too Many Requests" errors were still
showing up despite the existing priority queue. The queue only ever
waited for its own fixed spacing timer between requests, never for
each request's actual response to come back before dispatching the
next one - so if AniList returned a 429, several already-queued
requests (spaced only 900ms apart, less than a typical round trip)
could already be in flight before that first 429 response even
arrived and set the backoff pause. Fixed by having the queue
genuinely await each request's full completion - success or failure -
before processing the next item, so a 429's pause window is set
before anything else in the queue is dispatched, not after several
more requests have already gone out and potentially also failed.
Verified with a simulated burst where the first request deliberately
fails: confirmed none of the four requests behind it in the queue
also failed, each correctly waiting out the pause before proceeding.

## Profile icon gallery - both easy-add and a picker

Built both pieces the user actually asked for. Custom icons live
entirely under the persistent data directory, never inside the app's
own code folder - deliberately, since this app has already been
through many zip re-deployments this session, and anything placed in
public/ would be silently wiped out by the next one. Everything here
survives an update the same way accounts and uploaded profile photos
already do.

The built-in set (8 shipped SVGs) is scanned live from the actual
public/img/avatars folder rather than hardcoded, so anything added
there in a future update shows up automatically with no code change
needed. Admins can add their own on top of that from a new "Profile
Icons" section in the Admin Dashboard - upload, and delete any custom
one later. Anyone editing their own profile now has a "choose from
gallery" option right next to the existing photo-upload button,
opening a simple grid of every available icon (built-in + custom) -
click one, done, no cropping/upload step needed since it's just
picking an already-stored image.

Verified the full backend chain directly through real HTTP routes:
listing correctly shows all 8 built-in icons before anything's added,
a real uploaded image is genuinely servable afterward (confirmed
content-type and status), a non-admin is blocked from managing the
gallery, a path-traversal attempt in the delete route is correctly
rejected (confirmed server/index.js itself was never touched), and a
real delete genuinely removes a custom icon and is reflected in the
list right after.

## Investigating: gallery picker button producing no response at all

A report that clicking the new gallery picker button does nothing -
no modal, and critically, nothing in the browser console either, not
even an error. Re-verified everything checkable from here directly:
the backend (listing and the actual avatar-set call both confirmed
correct through real HTTP tests), the HTML template structure, and
the CSS positioning geometry (the button's wrapper has no overflow
clipping, and the offset math keeps it within the wrapper's actual
width) - nothing found wrong in any of it through static analysis.

Added direct diagnostic logging rather than guessing further: the
button's actual presence and on-screen position/size now logs the
moment the page loads (not just on click), and a click reaching the
handler now logs too. This will show definitively whether the element
exists where expected and whether clicks are actually reaching it,
which is the most direct way to find out what's actually happening
without being able to see the real device directly.

## Resolved the mystery: two completely different consoles

The "nothing shows up in console" report turned out to be about
looking in the right place, not a code bug at all - server-log.txt
and the server's own terminal window only ever show server-side
output, and the gallery diagnostics added were client-side JavaScript
running inside the phone's own browser, which could never appear
there no matter what. Given how much of this whole session has
involved checking that exact server log for other, genuinely
server-side issues, this mix-up made complete sense to run into.

Getting to an actual mobile browser's own DevTools console normally
needs a cable connection to a desktop, which isn't a practical ask
here. Swapped the diagnostics to show up directly on the phone
instead, no extra tools needed: a highly visible temporary red
outline on the button itself (confirms it genuinely exists and shows
exactly where it sits on screen, without needing to inspect anything),
and a plain, blocking alert() the moment a tap is actually received by
the handler - alert() specifically because it can't be hidden by any
styling issue the way a toast notification could be, giving an
unambiguous yes/no on whether the tap is reaching the code at all.

## Narrowed down further: only one alert seen, not two

Confirmed the button and click handler both work correctly - the
click was genuinely registering. But only the first alert ("loading
icons...") was ever seen, never a second one reporting success or
failure - a real, telling clue. The previous code's try/catch only
wrapped the actual network call, not anything after it (building and
showing the picker itself), so any failure there would have been
completely silent - but seeing literally nothing after the first
alert, not even a caught error, points more specifically at the
request itself hanging rather than failing outright, since a genuine
failure would have shown the "Fetch FAILED" alert that was already in
place.

Rebuilt this to close both gaps at once: the entire flow, not just
the initial fetch, is now wrapped so nothing after a successful
request can ever fail silently again, and a request that hangs past 8
seconds is now forced to surface as a visible, readable error instead
of hanging indefinitely with zero feedback - directly matching what
was actually being seen. Removed the temporary red-outline styling now
that it already confirmed what it needed to: the button itself was
never the problem.

## Replaced alert() with an on-page banner - alert() gets auto-suppressed after repeated use

Across several rounds of diagnostics, alert() was used to surface
what was happening since it can't be hidden by a styling issue.
Reported "still nothing" after that, alongside an unrelated
Content-Security-Policy console message about a Chromecast SDK script
- a real, separate finding, but not mechanically connected to this
button's own code (different script entirely, loaded independently),
so it doesn't explain the gallery picker itself going silent.

The far more likely explanation: browsers automatically suppress
further alert() dialogs from the same page after several have been
shown and dismissed in a row, treating it as spam protection - and
after this many rounds of diagnostic alerts on this exact page, that
protection had very likely already kicked in, silently swallowing
the very error messages meant to explain what was going wrong.

Replaced every alert() in this flow with a status banner written
directly into the page itself instead - not a dialog at all, just
regular page content pinned to the top of the screen with a dismiss
button, which can't be suppressed the way a native dialog can.

## Restored an immediate, fully synchronous confirmation before any async work

The previous version's first possible visible feedback only came
after the network request settled or the timeout fired - meaning if
"no banner at all" was being reported, there was genuinely no way to
tell whether the click was even reaching the handler at all versus
something specifically in the async/network portion silently not
working. Added back an immediate banner right at the very top of the
handler, before any await or network call whatsoever - the most
bulletproof possible signal available, completely independent of
whether the fetch, the timeout race, or anything downstream works.
If even this doesn't appear, that pinpoints the problem as being
upstream of this code entirely, rather than anywhere in the actual
gallery-fetching logic.

## Cross-checking against the server, not just the browser

A 10+ second wait with genuinely nothing appearing after the first,
immediate banner is a real anomaly, given the 8-second client-side
timeout should force some visible result no matter what happens. This
points toward a possibility not yet ruled out: the request may never
be reaching the server at all, which would mean the client-side timeout
logic itself never gets a fair chance to run (some mobile browsers are
known to throttle JavaScript timers when a tab isn't fully active,
among other possibilities worth ruling in or out).

Added direct server-side logging to this specific route - both when a
request arrives and separately when the server actually finishes
responding to it - checkable directly against server-log.txt, a tool
already very familiar from earlier in this same session. Verified the
logging itself is genuinely correct against a real request first,
before relying on it for anything further: confirmed both lines
appear with the right counts for a real, successful request.

## Found it - a genuine bug in my own code, not a deployment or environment issue

The actual root cause, once the server log confirmed the request
genuinely reached the server and got a real, successful response back
every time (8 built-in, 28 custom icons): the .modal-overlay CSS class
this picker used is invisible and non-interactive by default
(opacity: 0, pointer-events: none) and only becomes visible once a
separate "open" class is also applied - which was never added. The
modal was being built and correctly inserted into the page this
entire time, with zero JavaScript errors at any point, since nothing
ever actually failed - it was just permanently invisible and
unclickable. This explains every single symptom seen throughout this
whole investigation at once: no console error, no banner, no timeout
ever firing meaningfully, because the code was "succeeding" the whole
time at building something nobody could ever see or touch.

Confirmed this specific CSS class had no other usage anywhere else in
the entire codebase to have copied a working pattern from - this was
its first real use, and the required "open" trigger was missed.
Fixed directly: the overlay is now created with both classes from the
start. Removed the temporary click-confirmation banner and the
server-side request/response logging now that the actual bug is
identified and fixed - both served their diagnostic purpose and would
otherwise just add noise going forward. Kept the genuinely useful
permanent improvement: if the gallery fetch or icon-picking ever
does fail for some other reason in the future, it now shows a real,
visible on-page error banner instead of failing silently, which is
simply better behavior regardless of this specific bug.

## Combined into a single button

Two small overlapping buttons crammed onto a 96px avatar circle was
never great UX, especially given everything just uncovered debugging
it. Consolidated into one button - it now opens the same picker
directly, with "Upload your own photo" as the first tile in the grid
alongside every gallery icon, rather than being a separate entry point
competing for space on the avatar itself.

Caught and fixed a real brace-mismatch bug while merging the two
click handlers into one, before it ever shipped - removing the
wrapper that used to guard the second button's existence left an
orphaned closing brace behind. Verified the final result is
structurally clean and the complete flow - frontend markup, the
gallery listing, and the underlying avatar-setting call - all still
work correctly end to end afterward.

## Picker now shows only custom uploaded icons

The gallery picker no longer includes the app's shipped built-in
icon set - only whatever's actually been uploaded through the admin
Profile Icons section. The backend still returns both separately as
it always did (nothing there needed to change), just the picker now
only draws from the custom list. Existing profiles still using one
of the built-in defaults are unaffected - only the picker's own
options changed, nothing about images already assigned to a profile.

## Fixed the actual create-profile avatar picker too - a completely separate code path

Discovered this was a genuinely different picker entirely from the
one already fixed - profile creation (and the separate quick-edit
modal) goes through openProfileModal in components.js, which had
always used its own hardcoded, built-in-only avatar list
(AVAILABLE_AVATARS), completely independent of the gallery feature
built earlier. The custom-only picker fix never touched this code
path at all, since it's a different function in a different file.

Replaced the hardcoded built-in list with a real fetch of the custom
gallery, matching the same "custom only" behavior already applied
elsewhere. Verified the complete real flow end to end: uploaded a
custom icon as admin, then genuinely created a new profile using that
exact custom icon's URL as its avatar, confirming the whole chain
actually works, not just that the picker's options changed.

## New: adult content preference at account registration

A new account-level, self-service preference asked directly on the
registration form ("Show mature/adult-rated titles?") - changeable
later from Settings if someone changes their mind either way. Built
on infrastructure that turned out to already exist and genuinely work
(discovered mid-investigation, correcting an initial wrong assumption
that it was unused): a per-title rating field and a client-side
filter already used in 14+ places across browsing, search, and
recommendations, driven by a keyword match against common mature-
rating conventions (R+, Rx, NC-17, TV-MA, etc).

This account-level answer acts as a master switch layered on top of
that existing system, not a replacement for it: if the account says
no, every profile under it is treated as restricted regardless of
that specific profile's own "Kids Profile" setting - but a profile
can still be individually marked "Kids Profile" for extra restriction
even when the account itself allows mature content, exactly as
before. Existing accounts default to allowed, since they never
answered this question and shouldn't lose access to anything they
already had.

Verified thoroughly at every layer: the backend end to end through
real HTTP requests (registering both ways, and changing the setting
afterward through Settings), and the actual filtering logic itself
directly against all four real combinations of account-level and
profile-level settings - confirmed the account-level "no" correctly
overrides a permissive profile, a profile's own "Kids Profile" still
independently restricts even when the account allows adult content,
and both layers agree when they point the same direction.

## Closed a real gap in the feature just built: the mature-content toggle had no protection at all

Found this immediately after finishing the adult-content preference -
any profile under an account, including one marked "Kids Profile,"
could freely open Settings and toggle the account-level switch back
on itself, completely undermining the point of the feature. Worth
noting why an admin-role check alone wouldn't have fixed this: every
profile under one account shares that same account's single role, so
checking isAdmin can't tell a parent's profile apart from a kid's
profile on the same account.

Fixed by requiring the actual account password specifically when
turning mature content ON - restricting it further stays a free,
unprompted action available to any profile, since making things more
restrictive needs no protection, but loosening it now requires
proving you actually know the account password. Used an inline
password field in the settings page itself rather than a native
prompt() popup, consistent with how the existing 2FA-disable flow
already handles this same kind of confirmation, and specifically
avoiding native dialogs after an earlier lesson this session about
browsers silently suppressing them after repeated use.

Verified all three real cases through actual HTTP requests:
restricting succeeds with no password required at all, unlocking with
the wrong password is correctly rejected, and unlocking with the
correct password succeeds - confirmed end to end after the frontend
changes too, not just against the backend in isolation.

## New logo applied across the app

Replaced all three logo assets from the new "IO Anime Streaming"
artwork: the full logo (login/who's-watching screens), the compact
navbar mark, and the browser tab favicon.

The uploaded artwork already had proper alpha transparency baked in
(the apparent white background was just how the image viewer
rendered transparency, not the actual image data) - confirmed this
directly before doing any processing, so no background removal was
needed at all.

The full logo carried over cleanly. The two small-scale versions
(navbar mark, favicon) needed real trade-offs, since the source is a
detailed illustrative design that doesn't survive heavy downscaling
the same way a simple geometric mark would - checked each one at its
actual real-world display size (34px navbar height, 32px browser tab)
before finalizing anything, not just at a comfortable preview size.
The favicon crop, centered on the character's face with the bold
circle/geometry around it, held up well at real size. The full-width
navbar crop was honestly blurrier at 34px - flagged this limitation
directly rather than presenting it as flawless, and it's in with that
tradeoff acknowledged and accepted.

## Fixed the navbar mark actually looking cut off, not just blurry

The earlier hard rectangular crop was severing the character's
flowing hair strands mid-stroke at the right and bottom edges - the
actual complaint, distinct from the blurriness already discussed and
accepted. The real cause: this artwork's hair flows dynamically
across nearly the entire composition, well past 95% of the image
width, so no rectangular crop boundary could avoid cutting through it
somewhere without including almost the full image.

Fixed with a gradient alpha fade at the right and bottom edges instead
of a hard cut, so the hair now dissolves naturally rather than being
abruptly severed. Checked at the actual real-world 34px navbar display
size before finalizing, not just a comfortable preview size - the
edges read as intentional now, a clear improvement over the previous
jarring cutoff.

## Fixed: the rotating hero banner ignored the mature-content setting entirely

Confirmed a real, genuine gap - the homepage's hero banner pool was
built directly from the raw library list, sorted and sliced by date
added, without ever going through the existing mature-content filter
that 14+ other places in the app already correctly use. A restricted
account or "Kids Profile" could see mature/adult-rated titles rotate
through the hero banner even though they're correctly hidden
everywhere else.

Fixed by filtering before the "top 5 most recent" selection, not
after - filtering afterward could have left fewer than 5 hero items,
or let a mature title crowd out a legitimate one that should have
made the cut. Verified directly against a realistic mixed library:
a restricted account correctly gets only the non-mature titles (not
padded with mature ones to reach a count), while an unrestricted
account still sees everything, exactly as before.

Also checked, while in this area, every other place in the codebase
that reads directly from the raw library lists rather than going
through the filter, since this exact pattern just turned out to hide
a real bug. Two more genuine, related gaps found and fixed the same
way: the genre browse page's pill counts, and the search page's
studio filter dropdown, both of which were counting/listing across
all titles unfiltered - meaning a genre or studio that only exists on
mature content would still surface in those lists (with an inflated
count, in the genre case) for a restricted account, even though
clicking into either already correctly showed nothing. Several other
similar-looking spots were checked and confirmed to already be
correctly filtered, so weren't touched.

## New: admin can restrict (but never unlock) mature content for existing accounts

A "Restrict Mature Content" button in Manage Accounts, next to each
account - lets an admin hide mature/adult-rated content for any
existing account retroactively, not just at registration time.

Deliberately, carefully one-directional, matching the exact request:
the admin can only ever turn this off, never back on. Enforced at two
layers, not just one - the route itself, and the underlying function
it calls is structurally incapable of ever setting the flag to true
at all, so there's no way for this to accidentally get wired up wrong
later and let an admin bypass the password gate that already protects
unlocking. Unlocking always requires the account's own password
through its own Settings page, exactly as before - the admin path
genuinely cannot do that, by construction, not just by convention.

The button only appears for an account that currently allows mature
content at all - once restricted, there's nothing left for the admin
to do, since only the account itself can reverse it.

Verified the complete real flow end to end: a fresh account
registered with mature content allowed, an admin restricting it with
no password required at all, a non-admin correctly blocked from the
same route, and the account list correctly reflecting the change
immediately afterward.

## New: "what's next" recommendation when a series finishes

Modeled on the reference screenshot - when the last episode of a
series ends, instead of nothing happening at all (confirmed this was
genuinely the previous behavior: the entire Up Next system was being
skipped whenever there was no next episode to autoplay), a full-
screen overlay now suggests something else to watch, with a "Start
Watching E1" button straight into its first episode and a bookmark
toggle.

Picks by shared genre count with the show that just finished, with a
mild (not absolute) preference for something not already started -
randomizes among the top handful of matches so it isn't the exact
same suggestion every time. Correctly goes through the existing
mature-content filter, same as everywhere else in the app now that
that's been audited. Verified the actual scoring logic directly: with
a realistically-sized library, strong genre matches clearly dominate
over unrelated titles even when there are far more of the latter
available, and the finished show itself is never recommended.

Caught two real bugs before they shipped, from checking assumptions
rather than trusting them: the bookmark button was originally wired
to toggleTopPick, which is actually a different, 5-item-capped
"featured picks" mechanism, not a general watchlist - would have
thrown an error for anyone with 5 existing top picks already pinned.
Switched to the correct, uncapped toggleMyList API instead. Also
caught that a profile's myList is stored as an array of
"itemType:itemId" strings, not objects with an itemId property as
first assumed - the "already bookmarked" check would never have
matched anything as originally written.

Deliberately left out for now: the star-rating prompt from the
reference image (rating the show that just finished) - a genuinely
separate feature from "what's next," worth its own dedicated pass
rather than folding in as an afterthought here.

## Restyled the series-end overlay to more closely match the reference

Reworked the layout to be letterboxed rather than full-bleed - a
contained, smaller frame with visible dark space above and below,
matching the reference's proportions instead of filling the entire
player edge to edge. Rebuilt the primary button as a white pill
(matching the reference) instead of the app's accent-colored button,
switched the bookmark from a circular button to a square one, and
added a bordered rating badge with dot separators before the genre
list, matching the reference's "16+ - - Action, ..." layout.

Actually rendered this for real using a headless browser (Playwright,
found available in this environment) and took real screenshots against
the app's own CSS, rather than just trusting the styling by reading
it - this caught a genuine bug that would never have been found
otherwise: the bookmark icon was an emoji, which renders in its own
fixed reddish-orange color no matter what, clashing badly with the
clean white/monochrome look everything else has. Replaced it with an
inline SVG that properly inherits the button's actual color, and
confirmed both its normal and "already bookmarked" (filled) states
render correctly before finalizing anything.

One honest limitation, not fixed here: the reference's title uses a
custom-designed, weathered logo treatment specific to that one show -
not something achievable for arbitrary titles in a real library
without individually designed logo art for each one, so the title
here stays clean, bold text rather than attempting to fake that
effect generically.

## Series-end overlay now cycles through multiple recommendations

Now picks and rotates through up to 5 recommendations instead of a
single one, following the exact same proven pattern the homepage
hero banner already uses - not a new mechanism, the same one: dots
built once and only ever toggled afterward (never rebuilt on each
rotation, so the CSS transition between states actually has
something to animate from instead of snapping), a 7-second auto-
advance timer, and clicking a dot jumps straight there and resets the
timer. A single recommendation skips the dots entirely, since a lone
indicator that can't do anything is just clutter.

Also fixed something the earlier single-pick version didn't need to
worry about: the top 5 are now shuffled among comparably-scored
candidates before being selected, not just sorted-then-sliced -
otherwise the same fixed 5 shows (whichever happened to sort first
among ties) would rotate in the exact same order literally every
time any series ended.

The rotation timer is module-level, matching heroRotationTimer's own
reasoning exactly: a function-local timer would leak and keep running
in the background if the player page were revisited for a different
show before the old one was explicitly cleared, since this is a
single-page app and the function scope alone doesn't stop a running
setInterval. Explicitly cleared both on closing the overlay and on
navigating away entirely.

Verified the actual rendered result with a real headless-browser
screenshot again (not just reading the CSS) to confirm the new
internal structure - the background image now sits inside an
additional wrapper div needed to separate the rotating content from
the dots - didn't break the absolute positioning, and that the dots
themselves render and match the hero banner's own style exactly.
Caught and fixed a real leftover-code bug from the rewrite before it
ever shipped, using node --check rather than assuming the edit landed
cleanly.

## Fixed: low-buffer stalling during playback

Traced directly to a real mismatch, not just tuned blindly - hls.js's
own default fragment/level load timeout is 10 seconds (confirmed
straight from a real error log hitting it), but the server's own
segment-serving route can legitimately wait up to 15 seconds normally
(120 seconds for a known-slow source) for a segment to finish encoding
before it even starts responding at all. The previous 10s client
timeout could fire before the server had even finished its own normal
wait - which is exactly what a stall scattered throughout playback,
not just at the very start, looks like from the client's side, and
matches a report of stalls happening well into an already-playing
video (minutes in), not just during startup.

Raised the fragment and playlist-level load timeouts to give real
headroom above the server's own confirmed 15s normal wait, and raised
the buffer targets so more cushion gets built up during good-
throughput moments to draw down from when throughput dips, rather
than the buffer running dry the instant it does - the same reasoning
already applied to the manifest-load timeout elsewhere in this same
config, now extended consistently to the ongoing segment/playlist
fetches that happen throughout playback, not just the initial load.

## Fixed a real, severe bug in generate-cert.sh causing SSL_ERROR_RX_RECORD_TOO_LONG

Traced a "Secure Connection Failed" report to its actual root cause,
not a guess: this exact browser error means the server the browser is
talking to is still speaking plain HTTP, not HTTPS. Checked how the
server decides which mode to start in - computed once at startup from
config.json, confirmed matching this session's own established
pattern for other settings - and found a real, confirmed bug in the
script that's supposed to write that config.

The script bash-substituted a Windows path (containing backslashes)
directly into JavaScript string literal source text passed to node -e.
Verified this exact failure directly: "C:\Users\Subaru97\.io-
project\data\certs" silently corrupts into "C:UsersSubaru97.io-
projectdatacerts" - every single backslash stripped out by JS's own
escape-sequence parsing, with no error thrown anywhere in the process.
The script would have appeared to finish successfully while quietly
writing a completely broken path into config.json - fs.existsSync on
that path always returns false, which is exactly what keeps HTTPS
permanently disabled no matter how many times the server gets
restarted afterward, matching the reported symptom precisely.

Fixed by passing every path through an environment variable instead
of interpolating it into JS source text at all - process.env reads
the raw string exactly as it is, with zero JS string-literal parsing
involved, so this entire bug class can't happen regardless of what
characters the path contains. Verified rigorously, not just by
re-reading the code: wrote to a real file and inspected the actual
raw bytes on disk plus the value once parsed back by Node, confirming
the real Windows path survives completely intact this time.

Also added a genuinely new safety net, not just a fix: the script now
re-reads what it just wrote and confirms both certificate paths
actually resolve to real files before declaring success, so this
exact class of silent corruption would be caught immediately with a
clear, loud error in the future rather than appearing to succeed
while quietly leaving HTTPS broken. Verified this specifically catches
the exact old bug pattern by deliberately reproducing it and
confirming the new check correctly fails and reports it.

## Fixed a real, confirmed false-positive in the phantom-reset detection

Traced a whole cascade of problems in a real log back to one root
cause. The reported symptoms - "dropped from 527.3 to 0.0", then a
forced session restart, then that restart's own segments failing to
parse across multiple quality levels, eventually fatally - all
stemmed from a single bug: lastKnownGoodTime was being pre-set to the
intended resume target (offsetSeconds) as if the video were already
there, before the actual seek that gets it there had happened at all.

For a fresh, non-restart resume specifically, the underlying stream
genuinely starts at 0 and a separate client-side seek is what reaches
the resume point - that seek takes real time to land. A timeupdate
firing while it's still pending, showing currentTime at 0, was being
misread as "dropped from the resume target to 0 with no real seek" -
completely normal, expected startup misidentified as a phantom reset,
triggering an unnecessary correction and, when it happened twice, an
entirely unnecessary full session restart. That restart's own
resulting segments then failed to parse across three separate quality
levels, eventually fatally - a real, secondary problem, but one this
specific playback attempt should never have triggered in the first
place, since nothing was actually wrong until the false positive
forced a restart that didn't need to happen.

Fixed by initializing from hlsStreamOffset instead of the raw offset
target, and only after that variable's own real value is known: for a
genuine restart these are the same value (the stream itself already
starts there, so the previous behavior was correct in that specific
case and is preserved), but for a fresh resume they are not the same
at all - hlsStreamOffset is correctly 0, matching where the video
actually starts before its pending seek lands.

Verified all three cases that matter directly, not just the one that
was broken: the exact false-positive scenario from the real log no
longer triggers, the genuine-restart case still initializes correctly
(unchanged from before), and a genuine phantom reset well into stable
playback - a real, unexplained backward jump after real forward
progress - is still caught exactly as it should be.

## Fixed the actual cause: generate-cert.bat never successfully ran generate-cert.sh at all

The specific error message the user hit made this unambiguous: bash
reported it literally could not find generate-cert.sh at
"C:\Users\Subaru97\Desktop\IO Anime Server\IO Server\IO
Stream\generate-cert.sh" - a real, exact path that does exist on
disk. The cause: %~dp0 expands to a Windows-style path with
backslashes, which was being handed directly to bash.exe as its
script argument. Bash treats backslash as its own escape character,
so it can't reliably interpret this as a path at all - this is the
same underlying class of bug as the earlier certPath/keyPath
corruption fix, just surfacing in a completely different script this
time. This meant the entire certificate generation and config update
this whole time was never actually running at all - explaining
exactly why the server was still showing plain http at startup no
matter how many times it was restarted, and explains the SSL errors
seen along the way as symptoms of a script that silently never ran,
not a certificate or server configuration problem.

Fixed by removing the path prefix from the bash invocation entirely,
rather than trying to convert between path formats - the script
already changes into its own directory on an earlier line, so the
bash invocation only ever needed the bare filename to begin with, with
no path separators of any kind to get wrong either way.

## Fixed: seeking forward could stall with no way out, since non-fatal stalls were never even watched

Traced a real gap: bufferStalledError is always non-fatal - hls.js
reports it while it's still trying, not as a failure - but the
existing recovery/escalation logic was gated entirely behind
"if (!data.fatal) return", meaning this specific error type was never
even inspected at all, regardless of how many times it repeated or
how long it went on for. Seeking forward past what the sequential
transcode has actually produced so far is exactly the scenario that
produces a string of these - especially now that the fragment/level
timeout was already raised earlier this session, meaning hls.js often
never even reaches a fatal network error at all here anymore, it just
sits reporting non-fatal stalls indefinitely instead.

Added a separate, time-based check specifically for this case, ahead
of the fatal-only guard rather than inside it. Deliberately tracks
duration of one continuous stall episode, not a raw event count,
since a single ongoing stall can fire this event many times in a row.
Gives the transcode a genuinely fair, generous window first (20
seconds) before concluding it's actually stuck rather than just
slowly, normally catching up - checked directly against the real
numbers in an actual log (buffer and playhead position both visibly
growing together over about 10 seconds) to confirm that specific,
real pattern correctly does NOT get escalated, since it was already
resolving on its own. Only escalates to a fresh, offset-based session
once a stall genuinely persists well past that window.

Verified all four cases that matter, not just the positive one:
the exact real log pattern correctly does not escalate, a stall that
genuinely never resolves for 20+ seconds correctly does, a stall with
no recent seek behind it at all never escalates regardless of how
long it lasts (this is specifically about landing ahead of the
transcode after a seek, not a general buffering fix), and a fresh
seek correctly starts its own new window rather than inheriting timing
left over from an earlier, already-resolved stall.

## Fixed: finishing a season didn't roll into the next one, even when it existed

Confirmed a real, genuine gap - the "next episode" logic only ever
looked within the current season's own episode list. Finishing the
last episode of any season fell straight through to "no more episodes
at all", showing the series-end recommendation overlay built earlier
this session even when another season with real content was sitting
right there.

Fixed by looking into the next season when the current one is
exhausted, rather than stopping there - carries the current season's
own position (not just the episode itself) specifically so the
following one in the show's own season list can be found. Every other
place nextEp is already used (the Up Next overlay, the skip-outro
button, the next-episode control, precaching) just navigates using
its relPath/index/title generically, staying within the same show and
letting the existing per-episode lookup correctly resolve whichever
season it's actually in - so this needed no other changes anywhere
else to work correctly.

The Up Next overlay's own label now shows the season name specifically
when the next episode is the start of a new one, so seeing "Ep 1"
right after finishing an episode 12 or higher reads as moving forward
into a new season, not restarting from the beginning.

Verified the actual computation directly against a realistic, multi-
season library structure, including a genuinely tricky edge case
worth checking rather than assuming away: an empty season folder
sitting between two seasons that do have real episodes is correctly
skipped over rather than being mistaken for "nothing left" - lands
correctly on the next season that actually has content. Confirmed
mid-season playback is completely unaffected, and that finishing the
truly final season still correctly falls through to the existing
series-end recommendation.

## Narrowed the mature-content filter to only Rx

R and R+ ratings are no longer filtered at all - only Rx (and its
direct synonyms, hentai and x-rated, kept because they mean the exact
same thing, not because this is trying to catch anything beyond Rx
itself) is now treated as mature content. This is the one shared list
every mature-content check in the app already goes through - the
account-level toggle, individual "Kids Profile" settings, the hero
banner, genre/studio browse counts, and the series-end recommendation
all narrow automatically with this one change, since none of them
have their own separate copy of this list.

Verified directly against every relevant rating string: R, R+, PG,
PG-13, and the other ratings this list used to also catch (NC-17,
TV-MA, 18+) are now all correctly treated as fine for the base
audience, while Rx itself - in any case or format variation - is
still correctly caught.

## Adaptive bitrate quality switching (Crunchyroll-style) - already existed, made it actually visible

Checked the real code before building anything new, and this already
exists: quality already defaults to "Auto", which already loads the
multi-quality master playlist, and the app never touches hls.js's own
level-selection controls at all - meaning its own built-in adaptive
bitrate algorithm, the same underlying technology real streaming
services use, was already dynamically switching quality based on
measured bandwidth this whole time, entirely on its own.

The actual gap: there was no way to see this happening at all. Added
a listener for hls.js's own level-switch event, which now logs every
switch (which level, what resolution) and updates the quality menu's
own "Auto" label to show what it's currently actually playing at -
"Auto (720p)", matching exactly how other streaming services surface
this same information, rather than a plain "Auto" that gives no
indication anything is happening behind it. Reset on every fresh
video load, so a new episode's menu doesn't briefly show a stale
level carried over from whatever the previous one happened to be
playing at.

## Real diagnostic reasons for hardware acceleration falling back to software

Added actual, specific reasons for why each hardware method (NVENC,
QSV, AMF, VAAPI) wasn't usable - previously the only visibility
anywhere was a single "software (libx264)" line with zero explanation
of what was actually tried or why it failed, meaningless for
diagnosing a real setup remotely without being able to run commands
on the machine directly. Now captures ffmpeg's own real stderr output
for each attempt (driver missing, permission denied, no such device,
encoder not compiled in, etc.) and surfaces it in two places: the
server's own startup log, and directly in the admin Settings page any
time it's checked, not just once at startup.

Also widened VAAPI's device detection - it only ever tried
/dev/dri/renderD128 before, but a board with more than one GPU (a
discrete AMD card alongside an Intel iGPU is a very ordinary
combination) can easily have the actual target GPU sitting at a
different render node. Now tries renderD128 through renderD130 and
correctly reports which one actually worked, rather than assuming 128
is always right.

Verified the complete real chain end to end through an actual running
server: the specific per-method reasons are genuinely returned by the
route (confirmed directly against this sandbox's own lack of any
hardware encoder - NVENC/QSV correctly report the encoder producing
no output, AMF correctly reports the encoder not being found at all,
VAAPI correctly reports every candidate device path not existing),
and the frontend correctly serves the code that displays them.

## Improved hwaccel diagnostics further, based on real output from an actual AMD/Ubuntu system

The previous version's last-3-lines-only capture was tested against
genuine output from a real machine, and this immediately proved a
real limitation - libva's own driver-load error (the actual, specific
explanation for a VAAPI failure - a missing driver package looks
completely different from a permissions issue in libva's own message,
even though ffmpeg's own final error can look identical either way)
appeared well before the final three lines and would have been
silently cut off entirely. Now specifically surfaces any libva-
prefixed lines ahead of the generic tail-of-output fallback, verified
directly against a realistic reconstruction of exactly this scenario.

## Forced libva's own verbose logging on for hwaccel detection

Real testing against an actual machine showed the improved
libva-line-surfacing from the previous fix still wasn't seeing
anything at all - even for a confirmed, genuine VAAPI failure, no
libva-prefixed line ever appeared in the captured output. The cause:
libva's own verbosity isn't guaranteed to already be turned up in
whatever environment this server happens to run in, and without it,
even a real driver-level failure can produce zero diagnostic output
through it at all - silently hiding the one thing most likely to
actually explain what's wrong. Now explicitly sets
LIBVA_MESSAGING_LEVEL to libva's own most verbose setting
specifically for this detection test, rather than trusting whatever
the system's own default happens to be.

## Fixed the hwaccel test itself being too minimal to prove a real encoder works

Real-world testing on an actual working VAAPI setup (AMD RX 6700 XT,
Ubuntu 26.04, after fixing a genuinely stale ffmpeg installation)
revealed a second, separate issue once the real underlying device/
driver problem was actually resolved: the detection test's own input
was only 0.2 seconds (about 5 frames) with just a single output frame
requested - too minimal a window for a hardware encoder with any
internal buffering or lookahead latency to actually prove it works,
even once device access itself succeeds correctly. The error changed
from a device-access failure to a generic "nothing was written"
failure, the exact same message NVENC and QSV (which genuinely have
no matching hardware on this system) also produce - meaningfully
different from before, and a sign the real problem was already fixed
by that point.

Increased the test's input to a full second and the requested output
to 5 frames, giving a real encoder a fair, realistic window to
actually emit output, while still running in a fraction of a second
either way.

## Increased the hwaccel test resolution - 64x64 was likely too small for real VCN hardware

The previous fix (longer input window) didn't change anything on
real hardware - same "nothing was written" result even with a full
second of input and 5 requested output frames, which ruled out timing
as the cause. Reconsidered what else could make a device that opens
successfully still refuse to produce any output at all: many hardware
video encode blocks, AMD's VCN included, have a minimum resolution
requirement well above the 64x64 this test was using, and can fail
silently at too small a size rather than raising an explicit error
about it - exactly matching the observed symptom. Increased to
320x240, comfortably above any reasonable minimum, while still
running near-instantly either way.

## generate-cert.sh now supports multiple addresses in one certificate

Reworked to accept as many addresses as needed - a local LAN IP and a
global/public IP both, for native apps that might connect through
either depending on where they are - rather than only ever a single
one. Pass them as multiple arguments (generate-cert.sh 192.168.1.50
75.179.134.253), or leave them off entirely to be prompted separately
for a required local address and an optional global one. Genuinely
matters for native apps specifically, not just browsers: an app's own
HTTP client does real certificate validation and can't be clicked
through the way a browser warning can, so a cert that only lists one
of the two addresses an app might actually connect through would
fail outright for the other.

Caught and fixed a real, separate, pre-existing bug along the way,
found only by actually running the full script end to end rather
than testing the Node.js logic in isolation like before: the
verification step added in an earlier fix was missing its own
IO_CONFIG_PATH environment variable, silently relying on one that
was only ever set as a prefix on an earlier, different command in the
same script - environment variables set that way don't carry over to
later commands. Verified rigorously afterward: multiple addresses
together, the same address passed twice (confirmed no duplicate SAN
entry), a single address alone (existing behavior, unchanged), mixed
IP and hostname together, and both branches of the interactive
prompt (including deliberately leaving the optional global address
blank) - checking the actual generated certificate's real SAN list
directly via openssl each time, not just trusting the script's own
success message.

## Fixed: an inaccessible network-mounted media folder could hang the entire server

Traced "the server's own log says running, but the page never loads
at all" to its actual cause - a real, confirmed bug, not a browser or
certificate issue. The file-watcher setup that runs right after the
server reports itself as running was unconditionally attempting a
synchronous, recursive fs.watch() on every configured media folder,
with no accessibility check first - even for a folder the scanner
itself, moments earlier in the very same startup sequence, had
already logged as "does not exist or isn't accessible right now."

For an unreliable network mount specifically (a GVFS share tied to a
desktop session, or a CIFS mount that isn't actually responding), that
synchronous call can hang indefinitely. Because it's synchronous, a
hang there blocks the entire Node.js event loop - meaning the server
can no longer process any incoming HTTP request at all, even though
it already printed its own "running" banner and appears completely
fine in its own log. Exactly explains the reported symptom: a server
log claiming success, and a browser that never gets any response at
all, not even a certificate warning, since the process itself was
already stuck before it could handle the connection.

Fixed by checking accessibility first with the same lightweight check
the scanner already uses, skipping the heavier recursive watch setup
entirely for a folder already known not to be there, rather than
attempting it regardless. Verified directly: an inaccessible path is
now safely skipped with a clear log message, while a genuinely
accessible folder is still watched exactly as before, confirmed
through both isolated logic tests and a real running server actually
responding to a real HTTP request afterward.

## New: Watch Party - real-time synced playback with other viewers

Real-time, not polling-based - a multi-second lag on every pause or
seek would defeat the entire point of staying in sync with someone
else, so this uses genuine WebSocket connections (added ws as a new
dependency) rather than the app's existing request/response pattern.

Host-authoritative by design: whoever starts a party controls
playback, and everyone else's player mirrors their play/pause/seek
actions. Deliberately not "anyone can control it" - with more than
two people, simultaneous seeks from different participants would
fight each other with no way to resolve the conflict. If the host
disconnects, control hands off automatically to whoever's still
there, rather than leaving the room permanently stuck.

A new Watch Party button in the player controls (next to Cast) lets
anyone start one (creates a short, shareable room code) or join one
by entering a code - if the code is for a different episode than
what's currently open, it navigates there first and completes the
join once that page loads. A small banner shows the room code and
live participant count, with a one-click way to leave.

Rooms are deliberately in-memory only, not saved to the database - a
watch party is inherently a live, short-lived session, not something
that needs to survive a server restart, which sidesteps a lot of
schema and cleanup complexity for something this ephemeral. A brief
disconnect (a phone locking, a flaky wifi moment) gets a 60-second
grace period before the room actually closes, rather than ending the
whole party the instant one connection blips.

Verified thoroughly at every layer, not just by reading the code:
a full real WebSocket integration test (actual clients, actual
server) covering join flow, correct host designation, host actions
correctly relayed to participants, non-host sync attempts correctly
rejected, and host handoff on disconnect - then re-verified the whole
chain again against the real, live, full application server (not a
bare test harness), including real HTTP authentication, real room
creation via the real API, and real WebSocket messages flowing through
the actual attached server. Also caught and fixed two real bugs along
the way rather than assuming the code was right: a wrong CSS selector
that would have silently failed to insert the banner at all, and
confirmed the correct profile-name field by checking actual usage
elsewhere rather than guessing. The banner's actual visual appearance
was confirmed with a real browser screenshot, not just by reading its
CSS.

## New: desktop GUI launcher (IO Control Panel)

A real, cross-platform desktop app for starting, stopping, and
monitoring the server, replacing the command-line-only workflow for
anyone who wants it - lives entirely in a new launcher/ folder as a
separate, optional app, so the main server's own dependencies and
start.bat/start.sh remain completely untouched for anyone who prefers
those.

Built with Electron specifically because it's already the right tool
for a genuinely cross-platform desktop GUI built on the same Node.js
stack this whole project already runs on, and because it let this
literally reuse the login page's own CSS variables and the actual
IO logo image directly, rather than trying to recreate the look
in a different toolkit and risk it drifting out of visual sync over
time.

Start/Stop/Restart buttons control the real server as a child process,
with its actual console output streamed live into a log panel - the
same real startup banner, hwaccel diagnostics, and everything else you'd
see running it from a terminal, just inside the GUI instead. Closing the
window doesn't stop the server - it keeps running via a system tray
icon, matching how this kind of control panel is normally expected to
behave, with Quit as the real way to exit. Also added the admin actions
this was specifically asked for: Open in Browser and Copy Server URL
(both read the real, current port and HTTPS status directly from the
live config, not a guess), and Open Data Folder for direct access to
the config/database/certificates.

Verified this thoroughly, not just by reading the code - found that
Electron and a virtual display (Xvfb) were both genuinely available in
this environment, and used Playwright's own Electron-testing support to
actually launch the real app, click its real buttons, and read its real
screen content back, rather than trusting it would work. This caught a
real, genuine race condition that only timed, realistic testing could
have found: stopping the server and then starting it again within the
same few seconds, quickly enough that its own stale force-kill timer
from the earlier stop was still pending. That timer wasn't being
cancelled once the process it was meant for had already exited cleanly,
so it later fired against the wrong process - the new one that had
since taken its place - and killed a server that had only just started.
Fixed and re-verified with the same exact test sequence afterward,
confirmed via real screenshots of the actual running app that its look
genuinely matches the login page's own theme and logo.

## Fixed: the GUI was genuinely there but too easy to miss

The launcher/ folder existed and worked, but there was no obvious,
discoverable way to actually launch it alongside the existing
start.bat/start.sh - it required knowing to cd into a subfolder and
run npm commands manually, buried in a README rather than being an
option that's actually as easy to find as the two scripts already
sitting at the project root. Added start-gui.sh and start-gui.bat at
the root, right next to start.sh/start.bat, following their exact
same style and conventions (the same prerequisite checks, the same
pause-before-closing-on-error behavior) - handles its own first-run
dependency install the same way start.sh/start.bat already do for the
server itself, just for the launcher's own, separate dependencies.

Also found and fixed a real, genuine issue while actually testing the
new script end to end rather than assuming it would work: Chromium's
own sandbox refuses to start at all when already running as root - a
deliberate security check, not a bug, since it can't meaningfully
isolate a process that already has full system privileges. Confirmed
directly that the fix has to be a real command-line argument passed to
Electron itself, not something set from within the app's own JS code,
since this specific check happens natively before any of that code
ever runs. start-gui.sh now detects the actual root case and passes
the flag only then, so everyone else - the vast majority of users -
keeps the real, full security sandbox untouched.

## Fixed a real, undocumented npm 12+ breaking change blocking Electron's own install

Confirmed directly, not just from the error message alone: npm 12.0.0
quietly changed installing a dependency's own lifecycle scripts
(preinstall/install/postinstall) from "runs with a warning" to
"silently blocked by default" - a genuine breaking change npm's own
release notes never actually mentioned. Electron's own postinstall
script is what downloads its real browser binary at all (the npm
package itself is just a small loader) - block that script, and the
install finishes with no visible error, only failing later, when the
app actually tries to launch.

Reproduced the exact real error directly by installing npm 12 and
running a genuinely fresh install against the previous package.json,
confirming it fails with precisely the same message reported. Fixed
by pre-approving electron's install script directly in package.json's
own allowScripts field, then verified the fix for real the same way -
a fresh install against the corrected package.json, on the same npm
12 install, genuinely succeeds and produces a working Electron this
time, not just a fix that looks right on paper.

## Fixed: a broken GUI install could never recover on its own

Confirmed a real, separate bug directly, not just from a report - the
same "Electron failed to install correctly" error kept appearing even
after the allowScripts fix, because that fix only takes effect during
a genuinely fresh install. start-gui.sh/bat's own first-run check only
asked "does a node_modules folder exist," not "does Electron actually
work inside it" - so anyone whose very first run had already left a
broken install behind (the npm 12+ issue, or anything else) would have
that broken folder mistaken for a working one forever, retrying the
exact same broken Electron on every single run with no way to recover
short of knowing to manually delete the folder themselves.

Reproduced this precisely: temporarily removed the allowScripts fix,
ran a real npm 12 install to create a genuinely broken node_modules
identical to what was reported, confirmed require('electron') failed
exactly as described. Then restored the real fix and ran the actual,
current start-gui.sh against that same broken folder - confirmed it
now correctly recognizes the broken state, cleans it out, and
reinstalls automatically, with require('electron') genuinely
succeeding afterward. Both scripts now validate Electron actually
loads before deciding a previous install can be trusted, rather than
just checking whether a folder happens to be sitting there.

## Periodic new-media check (for libraries on a network share)

Auto-rescan on file changes already existed, using a file watcher -
but on Linux that only reports changes made by THIS machine. With a
library on a NAS and new media copied onto it from another computer,
the watcher never fires at all, so nothing got picked up until a
manual Rescan. Plex solves this with scheduled scans; this does the
same, but cheaply: a full scan of a large share takes close to a
minute of I/O (about 52s for a ~1,700-title library), far too heavy
for a timer, so server/library-change-detector.js only reads folder
timestamps and entry counts two levels deep and starts a real rescan
only when something actually differs. It goes through the same
debounced rescan path as the file watcher, so new-episode
notifications fire from it too.

Settings -> "Check for New Media Every (minutes)", default 15, 0 turns
it off. Details worth knowing:
- Fully async with bounded concurrency, so a slow share can't block
  the server (the failure mode the old synchronous watcher setup had).
- Takes its baseline snapshot BEFORE every scan reads anything, so a
  file landing mid-scan is caught by the next check, never silently
  absorbed - and no redundant second rescan follows a normal one.
- A share dropping offline does NOT trigger a rescan (that would only
  treat it as empty); it coming back does, and re-attaches the file
  watcher that was skipped at startup.
- Skips its round while a scan or enrichment is already running, and
  gives up on a round that exceeds its time budget rather than acting
  on a half-finished picture.

Verified for real: 15 isolated checks on actual directory trees (new
episode, new series, removal, loose movie file, symlinked series,
timeout, unreachable/recovery, busy-skip, no-repeat), then the full
server end to end - a change only the periodic path can see (a
filename the file watcher deliberately ignores) triggered exactly one
rescan; a new series copied in went from 1 to 2 anime with no
redundant rescan afterward; settings save/default/off/floor/garbage
input all behave. Cost on a synthetic 1,700-series library: ~105 ms
locally with a 3 ms worst event-loop stall. Real SMB latency can't be
measured from the development environment - expect seconds rather
than milliseconds, still a fraction of a full scan.
