# I/O 0.3.1 validation record

Date: November 5, 2026. Reference: signed-in Serika browse and player pages. I/O branding is retained; Serika artwork and media are not distributed.

## Responsive layout

Browser viewport measurements were taken at 320, 390, 768 and 1024 pixels wide. Each width was checked on Browse, Series, Title, Settings, Profile, Notifications and TV guide: 28 combinations, with no document-level horizontal overflow. The guide intentionally scrolls horizontally inside its own timeline. Poster rows measured 160px at 320/390 and 192px at 768/1024, with a 2:3 image ratio. Serika's inspected poster card was 192×288px on desktop.

The viewport override was reapplied immediately before each measurement because accessibility snapshots can restore a tab's earlier dimensions in this browser. Actual `innerWidth` was checked against every requested width. These are responsive browser checks, not physical iOS/Android device certification.

## Interaction checks

- Account menu opens, fits the screen, scrolls, and closes with Escape, restoring focus. Closed menus are excluded from keyboard navigation.
- Profile section tabs retain their selection and keyboard behavior.
- Title More disclosure opens without horizontal overflow.
- Phone player controls fit at 320/390; tablet controls stay aligned on one row with the seek track above.
- Playback speed changes to 1.25×. Settings submenus and the audio/subtitle entry remain available.
- Episode drawer opens, focuses its close button, closes on Escape and restores focus. Previous episode navigation changes the playing episode correctly.

## Longer playback

Private fixtures were generated locally: a 20-minute H.264/AAC MP4 at 640×360/24fps and an MKV copy for the HLS path. Fixtures and preview account data are outside the repository.

- Direct playback advanced continuously from startup past 12:06, with `paused=false`, ready state 4 and no reported media error before the deliberate pause.
- Reload restored the saved 12:06 position. Seeking to 18:00 and pressing Play resumed direct playback with ready state 4 and no reported media error.
- HLS playback advanced for more than three minutes after an explicit Play gesture. Seeking into the final quarter resumed playback and reached 16:25 with ready state 4 and no reported media error.
- Opening HLS in a fresh tab initially encountered the browser's expected autoplay restriction; an explicit Play gesture started playback.

The result covers synthetic local media. High-bitrate/4K playback, weak networks, background suspension, real casting devices, Safari and physical phones/tablets require separate device testing.

## Automated tests and external services

All 28 automated tests pass, including live schedules, profile authorization, child filtering, notification privacy, recovery expiry/replay/session revocation, OAuth state binding and local two-factor checks. Changed JavaScript also passes syntax checks.

Real SMTP delivery, email verification/recovery links and real Discord authorization are **pending**. Both services are disabled and no public address has been chosen. The owner explicitly requested finishing everything else first. Mock integration tests pass; they are not a substitute for real provider testing after setup. Use the administrator setup and Test email, then complete verification, recovery and Discord sign-in with a test account when those services are ready.

This record does not certify exact pixel-level Serika parity or production readiness.
