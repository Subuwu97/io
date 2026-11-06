# I/O 0.6.0 — community, recovery, discovery and TV previews

This development release extends 0.5.0. Exact Serika parity and production readiness are not certified.

## Added

- Follows, accepted friend requests, account-wide blocking and members/followers/friends/private audiences. Blocks suppress discussion access and clear existing relationship notifications.
- Reviewed bulk MAL/AniList jobs for up to 500 uniquely mapped local titles, stale-progress and mapping conflict checks, and opt-in background publishing of I/O progress. Remote-only titles are not imported into the media library. Automatic pulling, scores/dates and complex season mapping remain unsupported.
- Password/TOTP-gated personal ZIP/JSON restore with keep-current/replace-conflicts previews. Novel positions and appearance preferences are included. Exports can be emailed only to the account's verified address when SMTP is configured.
- Reflowable text EPUB reading, local illustrations, saved section/scroll position, font/spacing/width settings and three themes. Image EPUB behavior is retained.
- A local visual comment editor with formatting, lists, quotes, links, undo/redo and GIF attachments. The server sanitizes HTML, rejects executable embeds, limits GIF uploads, protects attachments with account/block checks, and removes attachments with deleted comments. Existing inline-format comments remain supported.
- Advanced local library search with format, all/excluded genres, years, list status, language tags, sorting and pagination. Find it from New & Popular.
- Optional hourly AniList airing-schedule imports for the next 14 days. Adult results are excluded; unrated imported entries are hidden from children's views. Dates do not mean media is available locally. Updates retain the previous schedule on provider failure.
- Expanded Spanish, French and Japanese control/setting translations. Complete copy coverage, dynamic messages, native-client translations and professional language review remain pending.
- Remembered browser TV registrations with inactivity expiry and revocation. Separate native-device pairing is profile-bound and PIN-aware; native tokens cannot access account settings. HLS access is limited to approved streams and rechecks current restrictions.
- Android/Google/Fire TV native preview source and a successful debug APK build; Roku source with successful static validation/package creation; Apple TV source using AVPlayer and Keychain. Physical playback and remote-focus testing remain unverified. Apple TV requires a Mac/Xcode build. These clients do not yet match the full web player, provide native remote-control mirroring, or meet all store requirements. See [native TV notes](../clients/README.md).
- [Encrypted server-state backup/recovery](SERVER-STATE-BACKUP.md), including integration keys, service settings and uploaded avatars. Restore targets a fresh empty directory, revokes old sessions/device registrations and disables tracker automation. Application source, media and generated caches are separate backups.

## Validation and setup

Automated checks cover community access controls, tracker conflicts, restoration safeguards, archive integrity/encryption, novel sanitization, GIF access/removal, release imports and native pairing/stream scoping. Browser checks confirmed novel resume, filtered search and formatted-comment posting. The public AniList schedule query returned a valid response; no user provider credentials or live mail were used.

I/O continues to use port 5921. The preview and owner data remain outside the public source tree. Configure your own public HTTPS address and email/Discord/tracker applications privately when ready. Real passkeys, provider authorization, email delivery, Discord activity, hardware playback/casting, platform builds and longer physical-device sessions still require owner/service/device verification.
