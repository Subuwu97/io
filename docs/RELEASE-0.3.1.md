# I/O 0.3.1

This release refines browse cards, spacing, account menus and player controls against the signed-in Serika reference.

- Poster rows use 192px cards on tablet/desktop and 160px cards on phones, with a 2:3 image ratio, compact captions and consistent gutters. Media cards support keyboard navigation, and the two-column phone grid stays inside the screen.
- Account menus stay within the viewport and scroll when needed. Closed account/notification menus are removed from keyboard navigation. The account menu supports Escape, arrows, Home and End.
- Player settings use compact labeled rows with selected quality/speed values. Audio/subtitles also have a direct toolbar button. Previous/next episode controls sit together; small phones use the episode drawer to preserve space. The drawer moves focus to its close button and restores focus on dismissal.
- Player time labels stay together on tablets, the seek bar has its own full-width track, and phone controls fit at 320px. Title actions, profile text, settings content and programme names adapt to narrow screens.

Validation: all 28 automated tests pass. Browser checks cover 28 page/viewport combinations, player menus and episode navigation, more than 12 minutes of uninterrupted direct playback, more than three minutes of HLS playback and seeking beyond minute 16 in a generated 20-minute fixture. See [the validation record](QA-0.3.1.md) for scope and pending checks.

Email and Discord remain disabled until the administrator configures their services. The owner chose to defer real provider testing until that setup is ready. No credentials or media fixtures are included in this release.
