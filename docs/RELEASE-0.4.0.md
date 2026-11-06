# I/O 0.4.0

The first four priorities from the deeper Serika audit are now implemented: list statuses, title requests, media reports and expanded manga reading.

## Track your collection

Title and book pages now offer Plan to Watch/Read, Watching/Reading, Completed and Dropped. My List groups saved titles by status and allows changes or removal directly from the list. Existing saved titles migrate to Planned without being removed. Statuses persist per household profile. They are explicit user choices; playing a title does not automatically overwrite them.

## Requests and media reports

Open **My requests & reports** from the account menu or settings navigation. Each account can have three pending/approved title requests. Owners can cancel pending requests and read administrator responses. Administrators use **Library review queue** to approve, decline or fulfill requests. Marking a request fulfilled records the decision; it does not download or acquire media automatically.

Use **Report issue** on a title/book page or reader, or the flag button above the player. Reports support playback, audio, subtitles, metadata and other issues, and can include an episode or chapter context. Administrators can investigate, resolve or dismiss reports and reply to the reporter. User submissions are private to their account and administrators. Review actions are recorded in the audit table. Forms enforce limits and reject duplicate active submissions.

Tracking pages currently display the most recent 200 submissions per user and 500 entries per administrator queue. They can be refreshed manually. This release does not send request/report emails or download content.

## Read manga and image-based books

The reader now supports single-page, double-page and vertical webtoon layouts, right-to-left/left-to-right direction, 50–200% zoom, fit screen/width, a page slider and chapter navigation. Settings persist per profile; reading progress remains per book/chapter. Double-page keyboard movement respects direction. Webtoon mode tracks the visible page and restores the selected page while images load.

Chapter discussions share the episode discussion features: replies, likes, six reactions, spoilers, reports and private reply/reaction notifications. Threads are separated by book and chapter, and inbox/moderation links open the correct reader route.

Existing supported image/CBZ/image-based EPUB/PDF sources remain supported. PDF page rendering still needs Poppler; the existing direct-PDF fallback remains available when it is missing. This does not add reflowable text-novel reading or offline downloads.

## Validation

32 automated tests pass. New tests cover preserving existing list entries, valid statuses, profile ownership and child restrictions, request duplicates/quotas/cancellation/review history, report privacy and episode validation, persistent reader preferences and chapter discussion separation. Browser checks cover submitting/reviewing requests, changing list status, reporting/resolving a media issue, grouped lists, two-page reading, webtoon page retention, saved zoom/direction/layout and separate chapter comments. Phone/tablet browser layout checks are recorded with this release; physical-device and real provider testing remain separate.

Public profiles/privacy/user discovery, passkeys, personal MAL/AniList synchronization, Discord activity, richer notifications/preferences, TV remotes and self-service export/deletion remain in the backlog. See [remaining feature gaps](FEATURE-GAPS.md). Email and Discord sign-in still require the owner's own service setup.
