# Serika reference comparison

Reference inspected: signed-in https://serika.moe/browse and the user-provided watch page, November 5, 2026. I/O keeps Minami's server and local-library model. This list distinguishes working inherited behavior from exact parity, which has not been achieved.

| Area | Current I/O state | Remaining parity work |
| --- | --- | --- |
| Branding/login | I/O artwork, SVG logo, black/lavender/coral form; real local authentication | Light and indigo login themes; optional external sign-in |
| Browse | Carousel, title cards, continue/currently watching, recommendations, curated rows, footer and mobile navigation | Exact card dimensions, menu layout, dynamic thematic collections and refresh flow |
| Details | Local title metadata, season/episode selection, reviews, lists, cast and related titles | Exact Serika detail layout and all menu interactions |
| Player | Existing HLS, quality, audio, subtitles, speed, skip points, casting and watch parties; new episode drawer, unified settings panel and embedded chapter seeking | Precise overlay, submenu appearance and control parity |
| Discussions | Episode-scoped persistent comments, authenticated posting, delete ownership and rate limit | Replies, reactions, spoilers, reporting and moderation workflow |
| Accounts | Local accounts, approval, profiles, 2FA, pairing, history and lists | Serika profile/settings layout, email authentication and password recovery |
| Live TV | Not implemented | Live playout, channel schedules and TV guide |
| External services | Local metadata integrations inherited from Minami | OAuth applications, email delivery and any service-specific credentials must be configured independently |

Tests verify the base playback/security behavior and discussion authorization. A passing test suite does not certify visual or full functional parity with Serika. The new repository must remain labeled as development until the remaining items are implemented and compared in the browser.
