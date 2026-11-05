Put your anime here, one folder per show:

media/anime/My Show Name/
    cover.jpg              <- poster art (optional)
    banner.jpg              <- wide hero image (optional)
    info.json                <- optional metadata, see example below
    Season 01/
        01 - Episode Title.mp4
        02 - Episode Title.mp4

Episodes can also sit directly in the show folder with no season
subfolder - Minami Project will group them under "Episodes".

Supported video formats: mp4, mkv, webm, mov, avi

Example info.json:
{
  "title": "Petals of Reincarnation",
  "description": "Touya Senji is talentless...",
  "tagline": "New episode out now!",
  "year": 2026,
  "rating": "16+",
  "genres": ["Action", "Fantasy"],
  "introStart": 0,
  "introEnd": 88,
  "outroStart": 1350
}

introStart/introEnd/outroStart/outroEnd are all optional, in seconds, and
apply to every episode in this show (handy since the OP/ED timing is
usually the same across a season). They power the "Skip Intro" / "Next
Episode" buttons in the player. If you leave them out, the player falls
back to a rough guess (skip the first/last ~90 seconds of anything over
3 minutes long) - set them explicitly for exact timing. outroEnd can be
left out; it defaults to the end of the episode.
