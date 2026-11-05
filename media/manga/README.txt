Put your manga here, one folder per title:

media/manga/My Manga Title/
    cover.jpg               <- cover art (optional)
    info.json                <- optional metadata (same shape as anime)
    Chapter 001/              <- a folder of loose page images
        001.jpg
        002.jpg
    Chapter 002.cbz           <- or a single .cbz file - each one is its
    Chapter 003.epub             own chapter, named after the filename
    Chapter 004.pdf

You can mix and match - some chapters as folders, some as CBZ/EPUB/PDF
files, all inside the same title folder. They'll be sorted together
naturally by name.

Supported chapter formats:
- Folders of loose images (jpg, jpeg, png, webp)
- .cbz  (a zip file of images - the standard "comic book zip" format)
- .epub (reading order follows the book's own spine; works best for
         image-per-page "manga style" EPUBs, which is the common case)
- .pdf  (requires poppler-utils installed on the server for page-by-page
         reading - see the main README's FFmpeg/PDF setup section. If it's
         not installed, PDF chapters still show up and can be opened
         directly in a new browser tab instead of the in-app reader.)
