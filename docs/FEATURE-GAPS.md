# Remaining Serika comparison backlog

Updated for I/O 0.5.0, November 5, 2026. Similar appearance does not establish equivalent behavior. Exact Serika parity is not certified. See RELEASE-0.5.0.md for implementation details and validation.

## Implemented in 0.5.0

- Opt-in member profiles, username URLs, discovery and separate section privacy. Kids profiles stay private; mature titles are excluded from shared sections.
- Passkey management and sign-in with verified challenges and password proof for management.
- Personal MAL/AniList OAuth connections and previewed one-title status/progress push/pull.
- Optional Discord desktop activity companion with revocable activity-only keys.
- Genre recommendation onboarding and expanded playback/subtitle preferences.
- Partial navigation localization, title-language fallback and tagged catalog-language filters.
- Categorized in-app/email/Discord-webhook alerts, private delivery status and bounded retries.
- Registered TV browser tabs and same-account remote playback controls.
- Password-gated personal ZIP export and confirmed account deletion.
- New & Popular arrivals/local Top 10/coming-soon schedule.
- Manga author/publication/volume details and safe inline comment formatting.

## Still partial or missing

1. Anonymous public-web profiles, follows/friends/blocks and finer audience groups need further comparison/product decisions. Discovery is paginated username/name search, not a social network.
2. Tracker synchronization is manual and one title at a time. Whole-list reconciliation, automatic updates, scores/dates, complex season mapping and detailed on-hold/rewatch preservation remain missing.
3. Discord presence requires the supplied desktop companion. Native mobile/TV clients and an identical service-specific badge are not implemented.
4. Localization covers navigation/settings headings only. Fully translated copy, translation review and automatic per-file subtitle/dub indexing remain pending. Unknown catalog languages must be tagged.
5. Timeline segment styling, detailed ASS overrides and exact subtitle-editor parity remain partial.
6. Notifications are event alerts. Provider push/DM delivery, schedules/digests and richer delivery administration remain pending.
7. Registered TVs are browser tabs with basic controls. Persistent native device enrollment, advanced navigation and hardware certification remain pending.
8. Exports download as ZIP; export-by-email and turnkey restoration of integration secrets remain pending. Privately back up integrations.key/integrations.json with the database.
9. Discovery still lacks every hierarchical/live-search mode and hosted-service catalog behavior. Upcoming entries are administrator maintained and do not acquire media.
10. Manga volumes use explicit chapter assignments. GIF attachments, a full rich-text editor and reflowable novels remain pending.
11. Referrals/rewards and a dedicated feedback/issue portal remain optional future work.

## Setup and verification

- The owner has not chosen a public address or configured SMTP/Discord and explicitly deferred this setup. MAL/AniList require the owner's registered application credentials, entered privately in I/O settings.
- Real platform passkeys, live provider authorization, email/webhook delivery and Discord Desktop presence need owner/device verification. Automated provider tests use controlled simulations.
- Physical iOS/Android/tablets, casting/TV hardware, weak networks and high-bitrate media remain unverified. Responsive checks and synthetic streams do not certify those environments.
- Inaccessible Serika administration, all friendship/block behavior, offline/download behavior and experimental UI features have not been exhaustively audited.
- Serika's hosted catalog, channels, branding and commercial infrastructure are not copied. Its self-hosting connection option was labeled Coming Soon during inspection.
