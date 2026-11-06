# Serika reference comparison

Reference inspected: signed-in Serika browse, watch, title, profile, settings, Live TV, discovery, New & Popular and manga reader pages on November 5, 2026. I/O keeps Minami's server and local-library model. The deeper audit found gaps missed by the initial comparison; [FEATURE-GAPS.md](FEATURE-GAPS.md) is the current functional backlog. Exact visual and service parity is not certified.

| Area | Current I/O state | Remaining parity work |
| --- | --- | --- |
| Branding/login | I/O artwork and SVG logo; black, indigo and light login palettes; local and verified-email login, optional Discord sign-in, recovery screens | Fine visual comparison across more devices |
| Browse | Carousel, continue/currently watching, recommendations, curated rows, themed collections, refresh flow, footer; 192px/160px poster rows, 2:3 artwork, compact captions and bounded keyboard-accessible menus | More screen-by-screen comparison with production library artwork |
| Details | Large uppercase italic title, background-led hero, metadata, actions, watch progress, genres, More menu; local episodes, reviews, lists and related titles | Further pixel-level comparison |
| Player | HLS, quality, audio, subtitles, speed, skip points, casting and watch parties; episode drawer, compact labeled settings panel, direct subtitles control, grouped episode controls and chapter seeking; phone/tablet spacing checked | Physical-device and further pixel-level comparison |
| Discussions | Threaded replies, likes, six emoji reactions, spoiler hiding, pagination, reports, audited moderation and private reply/reaction inbox with unread state and preferences | Further visual comparison |
| Accounts | Local accounts, approval, private household profiles, TOTP, pairing, history; list statuses and grouped views; banner/header, accessible tabs, settings sidebar; email/recovery | Public profiles, privacy, user discovery, passkeys and personal export/deletion; real email setup |
| Library requests/reports | Private title requests, slot limits, tracking, admin review; media reports with issue types, replies and audit records | Notifications and richer queue filtering/pagination |
| Manga reader | Single/double/webtoon, direction, zoom, fit, page slider, saved preferences/progress, chapter navigation and discussions | Rich book/volume metadata, text-novel investigation and physical-device comparison |
| Live TV | Admin-managed local-library channels, measured durations, continuous shared-clock playout, six-hour guide, now/next, programme details, on-demand links and live jump | Uses your own library; Serika's channels/catalogue are not included |
| External services | Private SMTP and Discord configuration, test email, OAuth connection/disconnection and 2FA-aware sign-in | Choose a public HTTPS address and configure SMTP/Discord credentials on your server |

Tests cover playback/security behavior, live schedules and profile filtering, private notifications, account recovery and simulated SMTP/Discord flows. Browser checks include creating a channel, playing it across programme boundaries, blank-domain setup, title actions and profile tabs. Live email delivery and real Discord authorization have not been tested with production credentials. This remains a development release; passing tests do not certify exact parity.
