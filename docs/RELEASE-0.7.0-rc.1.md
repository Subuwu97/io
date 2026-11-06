# I/O 0.7.0-rc.1 — acceptance testing candidate

This candidate includes the previously local tracker improvements and custom home banner, plus the reader and TV changes below. It is ready for acceptance testing of the browser features; it is not a claim that every Serika feature or native platform is complete.

- Reviewed tracker scores, complete dates, repeat counts and list states; opt-in automatic progress imports that hold local edits.
- Season-specific reviewed episode syncing. Map each local season to its tracker entry. Pulling updates only that season's watched markers; publishing sends only the episode count. Other seasons, resume positions, list status and scores stay unchanged. The season must already exist on the remote list, and the local season must contain enough episodes for the remote count. Watched gaps block publishing. Mapped titles are excluded from whole-title automation. Remote-only catalog import, split-cour offsets and automatic multi-season aggregation remain unsupported.
- A custom PNG/JPEG image entry in the home banner rotation, with optional text, chosen position and visibility setting.
- EPUB 3 navigation and EPUB 2 NCX labels linked to existing text sections, plus private location bookmarks, selected quotes and notes. Notes are included in personal exports and reviewed restore, with ownership and limits enforced.
- TV quality and audio choices for Android/Google/Fire TV, Roku and Apple TV source. Android debug build and Roku static validation/package checks pass. Apple TV source still requires compilation on a Mac. Native subtitles, live TV, watch parties and browser-to-native remote mirroring remain incomplete.
- More Spanish/French/Japanese reader and settings strings. Full interface/native localization and language review remain incomplete.
- A minimal `/healthz` endpoint, optional non-root container definition and isolated Compose setup, plus [production acceptance steps](PRODUCTION-TESTING.md). Docker is unavailable on the development machine, so the container must be built on the target host before use.

Validation: 77 automated server/browser-unit checks pass on the development machine, including tracker conflicts, season boundaries, reader note ownership and restore, passkey verification, privacy, native device revocation and backup recovery. An automated Windows/Linux workflow is included; its remote result must be checked after publication. Real external providers and physical devices are not represented by these tests.

Before production, complete the acceptance steps with the final HTTPS domain, your private SMTP/OAuth services and intended devices. Keep unverified integrations disabled. Back up and restore into an isolated folder before upgrading production. No production server or external account data was modified for this candidate.
