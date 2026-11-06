function ioSearchCatalog(items, filters) {
  const words = String(filters.q || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean),
    include = String(filters.include || "")
      .toLowerCase()
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    exclude = String(filters.exclude || "")
      .toLowerCase()
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const results = items.filter((item) => {
    const genres = (item.genres || []).map((x) => String(x).toLowerCase()),
      text = [
        item.title,
        item.titleEnglish,
        item.titleRomaji,
        item.titleJapanese,
        item.description,
        ...genres,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
      kind =
        item.type === "manga"
          ? item.chapters?.some((c) => c.format === "novel")
            ? "novel"
            : "manga"
          : item.type === "movie"
            ? "movie"
            : "series";
    return (
      (!filters.kind || kind === filters.kind) &&
      words.every((w) => text.includes(w)) &&
      include.every((g) => genres.includes(g)) &&
      !exclude.some((g) => genres.includes(g)) &&
      (!filters.from || Number(item.year) >= Number(filters.from)) &&
      (!filters.to || Number(item.year) <= Number(filters.to)) &&
      (!filters.status || item._listStatus === filters.status) &&
      (!filters.language ||
        (item.audioLanguages || [])
          .concat(item.subtitleLanguages || [])
          .some(
            (l) => String(l).toLowerCase() === filters.language.toLowerCase(),
          ))
    );
  });
  const sort = filters.sort || "title";
  return results.sort((a, b) =>
    sort === "year"
      ? Number(b.year || 0) - Number(a.year || 0) ||
        String(a.title).localeCompare(b.title)
      : sort === "recent"
        ? new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0) ||
          String(a.title).localeCompare(b.title)
        : String(a.title).localeCompare(b.title),
  );
}
async function ioPageAdvancedSearch(root) {
  await Store.loadLibrary();
  const route = location.hash;
  root.innerHTML =
    renderNavbar("") +
    `<main class="io-popular-page io-advanced-page"><h1>Discover your library</h1><form class="io-search-filters" id="ioAdvancedSearch"><label>Search titles, descriptions and genres<input name="q" type="search"></label><label>Format<select name="kind"><option value="">All formats</option><option value="series">Series</option><option value="movie">Movies</option><option value="manga">Manga</option><option value="novel">Novels</option></select></label><label>Include all these genres<input name="include" placeholder="Adventure, Fantasy"></label><label>Exclude these genres<input name="exclude" placeholder="Horror"></label><label>From year<input name="from" type="number" min="1900" max="2200"></label><label>Through year<input name="to" type="number" min="1900" max="2200"></label><label>My list status<select name="status"><option value="">Any status</option><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="dropped">Dropped</option></select></label><label>Tagged audio/subtitle language<input name="language" placeholder="en"></label><label>Sort<select name="sort"><option value="title">Title</option><option value="year">Newest year</option><option value="recent">Recently added</option></select></label><button class="btn btn-primary">Search library</button><button type="reset" class="btn btn-secondary">Reset filters</button></form><p role="status" id="ioSearchCount"></p><div class="io-search-grid" id="ioSearchResults"></div><button class="btn btn-secondary" id="ioSearchMore" hidden>Show more results</button></main>`;
  wireNavbar();
  const form = root.querySelector("form"),
    results = root.querySelector("#ioSearchResults"),
    count = root.querySelector("#ioSearchCount"),
    more = root.querySelector("#ioSearchMore");
  let shown = 24,
    matches = [];
  const items = Store.filterForActiveProfile([
    ...Store.anime.map((s) => ({ ...s, type: "anime" })),
    ...Store.movies.map((s) => ({ ...s, type: "movie" })),
    ...Store.manga.map((s) => ({ ...s, type: "manga" })),
  ]).map((s) => ({
    ...s,
    _listStatus:
      Store.activeProfile.listStatuses?.[
        (s.type === "movie" ? "anime" : s.type) + ":" + s.id
      ],
  }));
  function paint() {
    if (location.hash !== route) return;
    count.textContent = matches.length + " matching titles";
    results.innerHTML =
      matches
        .slice(0, shown)
        .map((item) =>
          item.type === "manga"
            ? `<a class="io-person-card" href="#/manga/${encodeURIComponent(item.id)}"><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml((item.genres || []).join(" · "))}</p></a>`
            : animeCardHTML(item, { tall: true }),
        )
        .join("") || "<p>No titles match these filters.</p>";
    more.hidden = shown >= matches.length;
    wireCardNav(results);
  }
  function search() {
    shown = 24;
    matches = ioSearchCatalog(items, Object.fromEntries(new FormData(form)));
    paint();
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    search();
  };
  form.onreset = () => queueMicrotask(search);
  more.onclick = () => {
    shown += 24;
    paint();
  };
  search();
}
