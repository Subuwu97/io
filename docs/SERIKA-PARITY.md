# Serika reference comparison

Reference inspected: signed-in Serika browse, watch, title, profile, settings and Live TV pages on November 5, 2026. I/O keeps Minami's server and local-library model. Version 0.3 implements the previously listed feature gaps below. Exact visual and service parity is not certified.

| Area | Current I/O state | Remaining parity work |
| --- | --- | --- |
| Branding/login | I/O artwork and SVG logo; black, indigo and light login palettes; local and verified-email login, optional Discord sign-in, recovery screens | Fine visual comparison across more devices |
| Browse | Carousel, title cards, continue/currently watching, recommendations, curated rows, themed collections, refresh flow, footer and mobile navigation | Exact card dimensions and menu layout |
| Details | Large uppercase italic title, background-led hero, metadata, actions, watch progress, genres, More menu; local episodes, reviews, lists and related titles | Further pixel-level comparison |
| Player | Existing HLS, quality, audio, subtitles, speed, skip points, casting and watch parties; new episode drawer, unified settings panel and embedded chapter seeking | Precise overlay, submenu appearance and control parity |
| Discussions | Threaded replies, likes, six emoji reactions, spoiler hiding, pagination, reports, audited moderation and private reply/reaction inbox with unread state and preferences | Further visual comparison |
| Accounts | Local accounts, approval, profiles, 2FA, pairing, history and lists; banner/profile header and accessible tabs; settings sidebar; verified email and expiring recovery links | Real email delivery requires administrator setup |
| Live TV | Admin-managed local-library channels, measured durations, continuous shared-clock playout, six-hour guide, now/next, programme details, on-demand links and live jump | Uses your own library; Serika's channels/catalogue are not included |
| External services | Private SMTP and Discord configuration, test email, OAuth connection/disconnection and 2FA-aware sign-in | Choose a public HTTPS address and configure SMTP/Discord credentials on your server |

Tests cover playback/security behavior, live schedules and profile filtering, private notifications, account recovery and simulated SMTP/Discord flows. Browser checks include creating a channel, playing it across programme boundaries, blank-domain setup, title actions and profile tabs. Live email delivery and real Discord authorization have not been tested with production credentials. This remains a development release; passing tests do not certify exact parity.
