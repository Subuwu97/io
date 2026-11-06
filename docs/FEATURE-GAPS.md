# Remaining Serika comparison backlog

Updated for I/O 0.6.0, November 6, 2026. See [release details](RELEASE-0.6.0.md). Exact visual and functional parity is not certified.

1. Native TV clients are previews. Android has a debug APK build; Roku passes static validation and packaging; Apple TV source requires a Mac/Xcode build. Device playback, focus/navigation, audio/subtitle choices, remote mirroring, live TV, watch parties, store compliance and broad feature parity need further implementation and physical testing. Browser remotes remain available.
2. Tracker jobs cover uniquely mapped titles in the local library, with reviewed push/pull and opt-in local publishing. Scores, dates, automatic pulling, detailed on-hold/rewatch preservation, complex season mapping and importing remote-only titles remain unsupported. Real owner authorization is unverified.
3. Spanish, French and Japanese cover navigation and many common setting, search, reader and comment controls. Long-form copy, dynamic messages, native apps, complete string coverage and language review remain unfinished. Catalog languages still need tags when unknown.
4. Fine visual comparison remains necessary across phones, tablets and real library artwork. Physical casting, weak networks, high-bitrate media, long sessions, platform passkeys and accessibility need hardware testing.
5. Email/Discord/tracker service configuration is deferred by the owner until a public HTTPS address and private service applications are ready. Automated service tests do not certify production delivery or account linking. No passwords or service credentials should be posted in chat.
6. Public profiles are signed-in member features. Anonymous public-web pages, social-network scale/search, referrals/rewards and a dedicated feedback portal remain optional future work.
7. Notifications are categorized event alerts. Provider push/DM delivery, scheduled digests and richer administration remain pending. The Discord activity companion still needs real Discord Desktop verification.
8. Text EPUB reading has size/section limits and intentionally strips external/executable content. Advanced typography, EPUB navigation documents, annotations, physical reader testing and exact reader/editor parity remain partial.

Encrypted server-state recovery now includes integration keys and uploaded avatars, but application source and media are separate backups. Recovery is offline into a fresh empty folder, with old sessions/device grants revoked and automation disabled for review. It is not an in-place hot restore.

Serika administration and every experimental feature have not been exhaustively audited. Its hosted catalog, channels, branding and commercial infrastructure are not included.
