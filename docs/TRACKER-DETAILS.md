# Tracker details and automatic imports

Open Settings → Trackers and select a connected provider and a mapped local title. In **Scores, dates & repeat settings**, load the current details, choose the fields to change, and preview before applying. Unselected fields and episode/chapter progress are left untouched.

MyAnimeList scores use whole numbers from 0–10; AniList uses 0–100. Zero clears a score. Dates must be complete calendar dates or blank to clear them. Imported partial AniList dates remain visible but must be completed or cleared before publishing dates. Repeat counts and paused/repeating list states are supported.

Previews expire after five minutes, can be applied once, and are rejected if the account connection, title mapping, local details or remote entry changes. Refresh and review a new preview after a conflict.

Automatic progress sync is opt-in. Choose either publishing local progress or importing tracker progress. Imports initialize empty matched titles, then update only while local progress still agrees with the last sync baseline. Local edits are held for review. Missing remote entries are skipped. Publishing does not overwrite paused/repeating entries. Scores and dates require the separate reviewed editor.

Batch and automatic sync require unique local tracker mappings. Text novels are excluded until chapter mapping is available. Remote-only catalog import and complex season mapping remain unfinished. Real provider connections still require the owner's private configuration and verification.

Validation: 73 automated tests pass, including selected-field updates, stale preview rejection, paused/repeat preservation, automatic import conflicts and missing-entry handling. These tests use controlled provider responses; no production tracker entries were changed.
