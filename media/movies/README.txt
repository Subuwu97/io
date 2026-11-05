Put movies here. Two ways to do it:

1) Just drop the video file straight in - simplest, no folder needed:

   media/movies/My Movie Title.mp4

   This gets picked up automatically with the filename as the title. The
   only downside: there's no folder to put a cover.jpg/banner.jpg/
   info.json next to, so it won't have a poster and can't use "Import
   from MAL" until you move it into its own folder (see below).

2) One folder per movie - lets you add a poster, banner, and metadata:

   media/movies/My Movie Title/
       cover.jpg              <- poster art (optional)
       banner.jpg              <- wide hero image (optional)
       info.json                <- optional metadata, same shape as media/anime
       My Movie Title.mp4        <- just one video file, sitting directly in the folder

You can mix both styles freely in the same media/movies/ folder.

This is a completely separate folder from media/anime/, so a long-running
series and a standalone film are never mixed together - anything placed
here always shows up under "Movies", anything in media/anime/ always
shows up under "Series" (regardless of episode count).

Supported video formats: mp4, mkv, webm, mov, avi
