# I/O 0.5.0 — community and personal integrations

This release implements the next feature batch from the Serika comparison. Exact Serika parity is not certified. External integrations remain optional; no owner credentials, public address or media are bundled.

I/O now defaults to port **5921**, independently of Minami's 4820. Existing installations retain their saved port unless changed in configuration; the inspection instance has been moved to 5921. Launchers and installation instructions use the new default.

The built-in profile picture collection includes 70 distinct user-supplied images from 75 selected files (five identical duplicates were consolidated), alongside the original eight icons. The profile editor now loads shipped pictures as well as custom uploads, with search, lazy-loaded thumbnails, accessible selection labels and a bounded scrolling grid. Original image bytes are preserved; JFIF images use the browser-compatible .jpg extension. The files are shipped with I/O, so the shared source folder is not needed at runtime.

## Public profiles, discovery and privacy

Each household profile can choose a unique username and private, unlisted or public member visibility. Profiles are private initially; discovery requires a separate opt-in. Kids profiles cannot publish. Independent section controls cover My List/statuses, favorite titles/characters, reviews, aggregate statistics and HTTPS social links. Mature titles are excluded. The API returns an allowlisted projection, never household/account identifiers, playback positions, PINs, email or credentials. Community profile URLs require I/O sign-in; they are not anonymous public web pages.

## Passkeys

Registration/removal requires current password and local two-factor proof when enabled. Registration/authentication requires authenticator user verification. Challenges are browser-bound, expiring and single-use; verification checks the expected origin/RP and stored keys/counters. Only approved accounts can sign in. Password sign-in remains available. Use localhost for development or configure the real HTTPS origin before enrolling production passkeys. A different hostname requires separate enrollment.

## Personal tracker sync

Settings → Personal tracker sync connects the current viewing profile to the owner's registered MAL/AniList OAuth application. Application setup requires administrator reauthentication. Callbacks bind the browser, account, provider and profile. Tokens/private settings are encrypted using a per-installation key in the ignored data directory. MAL token refresh is supported; expired AniList authorization requires reconnecting.

Sync is **manual, one title at a time**, in either direction. Preview shows local/remote status and completion count; Apply rejects stale, expired or reused previews. Correct `malId`/`anilistId` metadata is required: verify the season/edition mapping. Push updates only that entry. Pull replaces the selected title's local status/completion markers, limited to local episodes/chapters; video resume positions are retained. On-hold/paused maps to Planned; rewatching maps to In progress. Scores, dates, unattended synchronization, whole-list reconciliation and complex cross-season mapping remain pending.

## Taste, language, playback and subtitles

Onboarding collects preferred/avoided genres for local recommendations. Playback preferences add default quality (when source/player supports it), preferred audio/subtitles, title display language with metadata fallback, mature card-artwork blur and intro/outro control visibility. English/Spanish/French/Japanese navigation and settings headings are available; descriptions and many controls remain English. This is partial localization.

Plain-text subtitles add font family, percentage size, independent text/background opacity and outline/shadow effects. Authored ASS styling remains separate. Catalog filters use detected English dub availability and explicit `audioLanguages`/`subtitleLanguages` tags in `info.json` (three-letter codes). Unknown language metadata is not confirmed availability. Localized titles use `titles: {"english":"…","romaji":"…","native":"…"}`.

## Notifications and Discord activity

Episode/chapter, new season-group, upcoming (within 24 hours) and announcement categories have independent in-app/email/Discord choices. External channels default off. Email requires configured SMTP and a verified recipient. Discord delivery uses a private user-supplied discord.com webhook; it is separate from Discord sign-in. Queued delivery deduplicates events, checks preferences again, retries at most three times and shows recent status privately. Webhooks are encrypted; arbitrary hosts/redirects are rejected and mentions are disabled. Mature upcoming entries are not broadcast. Replies/reactions retain separate preferences. Ambiguous network acknowledgements can produce duplicate external delivery on retry; there is no digest scheduler.

Watch activity is separately opt-in per profile; kids/mature titles are excluded. A revocable activity-only companion key exposes only recent playback. Run `node scripts/discord-activity.cjs` **on the computer running Discord Desktop**, enter the I/O address/key, and configure your own Discord application client ID. The companion publishes title/episode rich presence via local IPC and clears on pause/inactivity/failure. It never uses a Discord user token. Disabling sharing revokes the key. This is an optional desktop companion, not browser-only/mobile activity; Discord's application label can differ from Serika's badge.

## TV browsers and account data

Register a signed-in TV tab, then control it from the same I/O account on another device. Receiver secrets are hashed; other accounts cannot list/control it. Play, pause, ±10 seconds and volume are supported. Commands expire; offline devices reject control; unregister revokes access. Registration is tab-scoped in session storage, not a persistent native TV client. Browser autoplay may require pressing Play on the TV once. Remote seeks use the player's absolute timeline, including HLS/transcode offsets.

Personal ZIP export and deletion require password/two-factor proof. Deletion additionally requires the exact username and explicit acknowledgement; the last administrator cannot delete their account. Credentials, keys, tokens and PINs are excluded from exports. Deletion cascades through personal profiles/data while retaining media. Existing administrator announcements/moderation audit records can retain server-owned history. Export-by-email is not implemented.

## Discovery, books and comments

New & Popular adds a distinct hero, New today/recent arrivals, genuine local Top 10 shows/movies (viewers completing episodes in the previous 30 days) and administrator-managed coming-soon entries. Empty rankings stay empty. Scheduling announces a title; it does not acquire media or guarantee availability. Existing release calendar remains separate.

Manga details add author, artist, publisher, publication status, language, page/chapter totals and named volume/chapter assignments through form controls. Metadata can also come from `info.json`; administrator overrides live in the database. Chapter rows retain keyboard links. Discussion formatting supports escaped bold, italic, code and strikethrough, including inside spoilers. GIF attachments and a full rich-text editor remain pending.

## Verification and remaining setup

- 47 automated tests passed: ownership/privacy, passkey signatures/origins/challenge replay, export/deletion guards, remote expiry/revocation, OAuth binding, stale sync conflicts, delivery retries/opt-out, encryption tampering and comment escaping. Passkey signature tests use a simulated authenticator; provider/delivery tests use controlled mocks.
- Browser checks covered private profile saving; Japanese navigation save/reversion; taste/subtitle settings; manga metadata/volume persistence and integration setup screens. Nine screens at 320/768/1024 pixels had no horizontal document overflow.
- Two signed-in browser tabs verified TV registration, remote pause, +10-second seek and resume using generated local media. Native TV hardware is untested.
- Real platform passkey enrollment, live MAL/AniList authorization, SMTP/webhook delivery and the Discord Desktop companion require owner services/devices. No external test messages were sent. Physical mobile/tablet, high-bitrate and weak-network checks remain pending.

Privately back up `integrations.key`, `integrations.json` and the database together. The key is required to decrypt tracker authorizations/webhooks after restoration. Never publish it. Existing administrator database-only backups do not automatically include the new integration key/settings file.
