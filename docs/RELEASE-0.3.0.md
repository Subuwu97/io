# I/O 0.3.0

The remaining feature groups from the 0.2 comparison are implemented: local Live TV, email recovery and Discord sign-in, community reactions and a private inbox, plus revised title/profile/settings layouts.

- Build continuous channels from library episodes in **Live channels**. FFprobe measures programme lengths; all viewers join the same server-clock schedule. The TV guide shows now/next and a movable six-hour timeline. Programme details offer live and on-demand playback. Live viewing does not overwrite on-demand progress or mark episodes watched.
- **Email & connections** supports verified email login and password recovery. Recovery links expire after 30 minutes, are single-use, preserve two-factor authentication, and revoke old sessions after a reset.
- Optional Discord authorization supports connecting existing accounts and local two-factor checks. Matching provider emails never silently take over existing accounts. New Discord accounts respect registration and approval policy.
- Discussions support six emoji reactions. Replies and reactions produce private, deduplicated notifications with unread state, preferences and links to the discussion. Notification previews omit comment/spoiler text.
- Title pages use a large background-led hero, watch progress and a More menu. Profiles have an overlapping header and keyboard-accessible section tabs. Settings have section navigation and retain the existing account/library controls.

## Setup later

No public address is required for local use. In **Email & sign-in setup**, leave the address blank and both external services disabled until an address is chosen. Then set the public HTTPS origin, your SMTP settings and/or your own Discord application credentials. Register the redirect URL displayed by I/O in the Discord Developer Portal. Save and use **Test email** before relying on recovery.

Settings are saved in the ignored private data directory (`services.json`); secrets are never returned by the API or shipped in source. Back up this directory securely. Discord-created accounts use provider sign-in initially; a verified email and configured recovery delivery let their owners establish a local password through Forgot Password, or an administrator can reset it.

## Validation and limits

28 automated tests pass. Tests cover scheduling, admin/profile authorization, adult filtering, notification privacy and preferences, recovery expiry/replay, session revocation, OAuth state binding and local 2FA. SMTP and Discord are simulated in tests; production delivery/authorization must be checked after setup. Browser checks cover channel creation, live programme changes, blank-address setup, profile tabs and title actions.

I/O remains a development release based on Minami. It uses your media and I/O branding. Serika's catalogue, hosted channels, accounts and service credentials are not included. Exact screen-for-screen parity has not been certified.
