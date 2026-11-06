# I/O

**Every story, your way.** Watch anime. Read manga.

I/O is an independent, self-hosted media application built from [Minami](https://github.com/Subuwu97/minami-project), starting at commit `e281530`. Its interface is being rebuilt against the signed-in Serika reference, with I/O branding and the original I/O login concept. This is an early development version; it does **not** yet reproduce every Serika screen or function.

## Run

Install Node.js 22.5 or newer, then:

```sh
npm ci
npm start
```

Open **http://localhost:5921** and create the first administrator account. Install FFmpeg and FFprobe for transcoding, audio tracks, styled subtitles and thumbnails. Add your own media folders in Settings.

I/O uses its own `io_session` cookie and `io.db` database. By default, settings and accounts live in this installation's ignored `data/` directory. Set `IO_DATA_DIR` to an absolute directory for durable storage outside the checkout. Minami settings and accounts are not imported automatically. I/O defaults to port 5921 so it can run alongside Minami on 4820.

## Available

- Local anime, movie and manga libraries; metadata imports, search and categories.
- Featured carousel, Continue Watching, Currently Watching, recommendations, curated rows and refreshable themed collections.
- HLS playback, quality selection, audio/subtitle selection and styled ASS subtitles.
- Playback speed, skip points, casting, picture-in-picture and synchronized watch parties.
- Episode drawer and threaded episode discussions with replies, likes, spoiler hiding, reports and an admin moderation queue.
- Accounts, profiles, two-factor authentication, device pairing and library administration.
- Shared-schedule Live TV channels from your library, now/next cards and a TV guide.
- Emoji reactions and a private reply/reaction inbox with unread state and preferences.
- Verified email sign-in, expiring password recovery and optional Discord authorization.
- Revised title/profile/settings layouts and private administrator service setup; the public address can be configured later.
- List statuses, private title requests and media-issue reports with administrator review.
- Single/double-page and webtoon reading, direction/zoom/fit preferences, a page slider and chapter discussions.
- I/O login with saved light/indigo/black themes, original mascot artwork, coral play/book mark and responsive navigation.

- Opt-in member profiles/discovery/privacy, passkeys, taste onboarding and expanded playback/subtitle preferences.
- Previewed personal MAL/AniList sync, categorized notification delivery and an optional Discord desktop activity companion.
- Registered TV browsers/remotes, personal ZIP export/deletion, local Top 10/upcoming discovery, manga volumes and formatted comments.

See [0.5.0 features, setup, limits and validation](docs/RELEASE-0.5.0.md), [remaining feature gaps](docs/FEATURE-GAPS.md), [service setup](docs/RELEASE-0.3.0.md) and [installation details](docs/INSTALLATION.md). External services require your own private configuration. Full interface translation, unattended tracker sync and native TV clients remain partial or pending.

## Development

```sh
npm test
```

Private settings, databases, uploads, certificates, caches, dependencies and local media are excluded from Git. No Serika account, media, session, credentials or licensed catalogue is distributed with I/O.

## Credits

Base application: Minami by Subuwu97. I/O branding: the user's original I/O concept pack. The standalone SVG mark is a code-native recreation of the play/book symbol in that pack. Serika is the interface and behavior reference; I/O is an independent project. Third-party browser dependency notices are in `public/vendor/`.
