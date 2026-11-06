# Remaining Serika comparison backlog

Updated for I/O 0.4.0, November 5, 2026. This list corrects the earlier overly broad parity assessment. Similar appearance does not establish equivalent behavior. Exact Serika parity is not certified.

## Delivered in 0.4.0

- Saved-list statuses and grouped views, preserving existing entries as Planned.
- Title-request submission, private tracking, slot limits, owner cancellation and administrator review.
- Media-issue reports and administrator response/status handling.
- Double-page and webtoon reading, direction, zoom, fit, page slider, saved preferences and chapter discussions.

## Still missing or partial

1. **Public community profiles:** real public username URLs, user discovery, opt-in visibility, per-section privacy, favorite characters and social links. Current I/O profiles remain account-owned household profiles.
2. **Passkeys:** local passwords and TOTP exist; WebAuthn/passkeys do not.
3. **Personal tracker synchronization:** authenticated MAL/AniList progress and list sync. Metadata imports and external links already exist.
4. **Discord watch activity:** Discord authorization exists; activity publishing does not.
5. **Recommendation onboarding:** a per-profile tailoring questionnaire beyond local history/list-based recommendations.
6. **Profile preferences:** translated interface, title-language display selection, preferred subtitle/dub catalog filters, default quality, timeline-section display controls and selective mature-artwork blur.
7. **Subtitle customization:** font family, percentage size, text opacity, detailed effects and background opacity beyond the existing presets.
8. **Notification delivery:** separate email/in-app/Discord categories for episodes, seasons, upcoming titles and announcements. Current episode/community/admin notifications cover part of this.
9. **TV devices/remotes:** dedicated registered-TV device management and remote controls beyond browser sessions, QR pairing, casting and watch parties.
10. **Account self-service:** personal ZIP/email data export and user-driven account deletion. Administrator backups and account deletion already exist.
11. **Discovery/New & Popular:** hierarchical categories, live/user search, dedicated ranked Top 10 rows and an upcoming-release workflow beyond the local-library grid, home rows and calendar.
12. **Books/community refinements:** volume grouping, richer author/publication metadata, GIF/rich discussion content, additional exact editor/interaction comparison, and reflowable novel-reader investigation.
13. **Optional service features:** referrals/rewards and a dedicated feedback/issue portal. Their value for an independent I/O installation should be decided separately.

## Setup and verification rather than missing code

- Choose the public address, configure SMTP and the owner's Discord application, then test real verification/recovery and provider authorization. The owner explicitly deferred this setup.
- Test physical iOS/Android/tablet devices, native casting/TV hardware, weak networks and high-bitrate media. Responsive viewport checks and synthetic stream tests do not certify these.
- Other account roles, inaccessible Serika administration screens, full friendship/block interactions, offline/download behavior and every experimental UI feature have not been exhaustively audited. Friend-list privacy wording alone was not treated as proof of a complete friendship feature.
- Serika's hosted catalog, its channels, branding and commercial infrastructure are not part of I/O. Its self-hosting connection option was labeled Coming Soon during inspection.

Reference surfaces inspected: signed-in Serika settings (all visible sections), profile, search/discovery, New & Popular, book details, list status menu, manga reader and playback issue-reporting dialog. No Serika settings, reports or external connections were submitted during that audit.
