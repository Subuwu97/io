// ==================== HOME ====================
async function pageHome(root) {
  await Store.loadLibrary();
  // Newest-first by when each title was actually added to the library
  // (not release year - a 2015 series you just downloaded still shows
  // up here first), same field the Recently Added row already uses.
  const heroPool = Store.filterForActiveProfile([...Store.anime])
    .filter((s) => s.dateAdded)
    .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
    .slice(0, 5);
  const p = Store.activeProfile;

  root.innerHTML = `
    ${renderNavbar('home')}
    <section class="hero" id="hero">
      <div class="loading-spin" style="margin-top:200px"></div>
    </section>
    <div class="rows-wrap" id="rows"></div>
    ${ioFooterHTML()}
  `;
  wireNavbar();

  renderHero(heroPool);

  const continueItems = (p ? Object.entries(p.progress || {})
    .map(([itemId, prog]) => ({ show: Store.findAnime(itemId), prog }))
    .filter(x => x.show && !x.prog.hidden) : [])
    .filter(x => !Store.isKidsActive() || !Store.isMatureRating(x.show.rating))
    .sort((a, b) => new Date(b.prog.updatedAt) - new Date(a.prog.updatedAt));

  const continueHTML = continueItems.map(({ show, prog }) => {
    const pct = prog.duration ? Math.min(100, (prog.seconds / prog.duration) * 100) : 0;
    const card = animeCardHTML(show, { progressPct: pct });
    // Injects a small remove (X) control into the card - "Remove from
    // Continue Watching" hides the entry without losing the resume
    // position; watching the show again brings it back automatically.
    return card.replace('<div class="card-body">', `<button class="cw-remove-btn" data-cw-remove="${show.id}" title="Remove from Continue Watching">&times;</button><div class="card-body">`);
  }).join('');

  const continueReadingItems = (p ? Object.entries(p.mangaProgress || {})
    .map(([mangaId, prog]) => ({ manga: Store.findManga(mangaId), prog }))
    .filter(x => x.manga) : [])
    .filter(x => !Store.isKidsActive() || !Store.isMatureRating(x.manga.rating))
    .sort((a, b) => new Date(b.prog.updatedAt) - new Date(a.prog.updatedAt));

  const continueReadingHTML = continueReadingItems.map(({ manga, prog }) => {
    const pct = prog.totalPages ? Math.min(100, (prog.page / prog.totalPages) * 100) : 0;
    return mangaCardHTML(manga, { progressPct: pct });
  }).join('');

  const seriesHTML = Store.filterForActiveProfile(Store.anime).slice(0, 12).map(s => animeCardHTML(s, { tall: true })).join('');
  const moviesHTML = Store.filterForActiveProfile(Store.movies).slice(0, 12).map(s => animeCardHTML(s, { tall: true })).join('');
  const mangaHTML = Store.filterForActiveProfile(Store.manga).slice(0, 12).map(m => mangaCardHTML(m)).join('');

  // "New This Year" - titles whose release year matches the current year.
  // We don't have a real airing calendar (that needs a live season/schedule
  // feed we don't have access to), but the year is real metadata from your
  // files or MyAnimeList import, so this is an honest stand-in.
  const currentYear = new Date().getFullYear();
  const newThisYearHTML = Store.filterForActiveProfile([...Store.anime, ...Store.movies].filter(s => s.year === currentYear))
    .slice(0, 12).map(s => animeCardHTML(s, { tall: true })).join('');

  // "Recently Added" - genuinely sorted by when each title was actually
  // added to the library (folder creation time, falling back to last
  // modified if creation time isn't available), independent of the
  // show's release year - so a 2015 series you just downloaded still
  // shows up here.
  const recentlyAddedHTML = Store.filterForActiveProfile([...Store.anime, ...Store.movies])
    .filter(s => s.dateAdded)
    .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
    .slice(0, 12).map(s => animeCardHTML(s, { tall: true })).join('');

  // "Inspired by You" - a simple, honest genre-overlap recommender using
  // your own top picks/My List/watch history as the signal, not a black
  // box. Only shows up once there's actually something to base it on.
  const inspiredHTML = computeInspiredByYou(12).map(s => animeCardHTML(s, { tall: true })).join('');

  // "Most Watched" - real aggregate watch time across every profile on
  // this server (not a fake global trending list), so it reflects what
  // your own household actually watches.
  const mostWatchedData = await API.getMostWatched().catch(() => []);
  const mostWatchedHTML = Store.filterForActiveProfile(
    mostWatchedData.map((d) => Store.findAnime(d.itemId)).filter(Boolean)
  ).slice(0, 12).map((s) => animeCardHTML(s, { tall: true })).join('');

  // Admin-curated rows ("Staff Picks", or any custom name an admin gave
  // it) - server-wide, the same for every profile. Items that no longer
  // exist (deleted/moved since being added) are silently skipped rather
  // than showing a broken card.
  const curatedRowsData = await API.getCuratedRows().catch(() => []);
  const curatedRowsHTML = curatedRowsData.map((row) => {
    const items = Store.filterForActiveProfile(
      row.items.map((it) => (it.itemType === 'manga' ? Store.findManga(it.itemId) : Store.findAnime(it.itemId))).filter(Boolean)
    );
    if (items.length === 0) return '';
    const cardsHTML = items.map((it) => (it.chapters ? mangaCardHTML(it) : animeCardHTML(it, { tall: true }))).join('');
    return rowSectionHTML(row.title, cardsHTML);
  }).join('');

  // "Recently Added Episodes" - genuinely tracks when each individual
  // episode was first seen, not just when its show was added - a new
  // episode 15 landing in a series that's been in the library for
  // months belongs here even though the show itself isn't new.
  const recentEpisodesData = await API.getRecentEpisodes(12).catch(() => []);
  const recentEpisodesHTML = recentEpisodesData
    .filter((ep) => {
      const show = Store.findAnime(ep.showId);
      return show && Store.filterForActiveProfile([show]).length > 0;
    })
    .map((ep) => episodeCardHTML(ep)).join('');

  const rowsWrap = document.getElementById('rows');
  rowsWrap.innerHTML = [
    rowSectionHTML('Continue Watching', continueHTML),
    rowSectionHTML('Currently Watching', continueItems.map(({show}) => animeCardHTML(show, {tall:true})).join('')),
    rowSectionHTML('For You', inspiredHTML || seriesHTML),
    rowSectionHTML('Recently Added Episodes', recentEpisodesHTML),
    rowSectionHTML('Recently Added', recentlyAddedHTML),
    curatedRowsHTML,
    rowSectionHTML('Continue Reading', continueReadingHTML),
    rowSectionHTML('Most Watched', mostWatchedHTML),
    rowSectionHTML('New This Year', newThisYearHTML),
    rowSectionHTML('TV Shows', seriesHTML),
    rowSectionHTML('Movies', moviesHTML),
    rowSectionHTML('Manga Library', mangaHTML),
  ].join('') || emptyStateHTML();

  if (Store.anime.length === 0 && Store.movies.length === 0 && Store.manga.length === 0) {
    rowsWrap.innerHTML = emptyStateHTML();
  }

  wireCardNav(rowsWrap);
  wireRowArrows(rowsWrap);

  rowsWrap.querySelectorAll('[data-cw-remove]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // don't trigger the card's own navigation
      const itemId = btn.dataset.cwRemove;
      try {
        await API.hideContinueWatching(Store.activeProfile.id, itemId);
        if (Store.activeProfile.progress && Store.activeProfile.progress[itemId]) Store.activeProfile.progress[itemId].hidden = true;
        const card = btn.closest('.card');
        if (card) card.remove();
      } catch (err) { showToast(err.message); }
    });
  });
}

// Scores every other title in the library by how many genres it shares
// with what this profile has actually engaged with (top picks weighted
// highest, then My List, then anything with watch progress), and returns
// the best matches. Pure client-side, no external "AI" - just genre
// overlap against your own signal, which is honest about what it is.
// Same genre-overlap idea as computeInspiredByYou, but seeded from one
// specific title (for that title's own detail page) rather than a
// profile's whole watch history.
function computeMoreLikeThis(show, limit) {
  if (!show || !show.genres || show.genres.length === 0) return [];
  const genreSet = new Set(show.genres);
  const candidates = Store.filterForActiveProfile([...Store.anime, ...Store.movies])
    .filter((s) => s.id !== show.id && s.genres && s.genres.length);
  const scored = candidates.map((s) => ({
    show: s,
    score: s.genres.reduce((sum, g) => sum + (genreSet.has(g) ? 1 : 0), 0),
  })).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.show);
}

function computeInspiredByYou(limit) {
  const p = Store.activeProfile;
  if (!p) return [];

  const genreWeight = {};
  function addSignal(item, weight) {
    if (!item || !item.genres) return;
    for (const g of item.genres) genreWeight[g] = (genreWeight[g] || 0) + weight;
  }
  (p.topPicks || []).forEach((key) => {
    const [type, id] = key.split(':');
    addSignal(type === 'anime' ? Store.findAnime(id) : Store.findManga(id), 3);
  });
  (p.myList || []).forEach((key) => {
    const [type, id] = key.split(':');
    addSignal(type === 'anime' ? Store.findAnime(id) : Store.findManga(id), 2);
  });
  Object.keys(p.progress || {}).forEach((id) => addSignal(Store.findAnime(id), 1));

  if (Object.keys(genreWeight).length === 0) return []; // nothing to base a recommendation on yet

  const seenIds = new Set([
    ...(p.topPicks || []).map((k) => k.split(':')[1]),
    ...(p.myList || []).map((k) => k.split(':')[1]),
    ...Object.keys(p.progress || {}),
  ]);

  const candidates = Store.filterForActiveProfile([...Store.anime, ...Store.movies])
    .filter((s) => !seenIds.has(s.id) && s.genres && s.genres.length);

  const scored = candidates.map((s) => ({
    show: s,
    score: s.genres.reduce((sum, g) => sum + (genreWeight[g] || 0), 0),
  })).filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.show);
}

function emptyStateHTML() {
  return `
  <div class="empty-state">
    <h3>Your library is empty</h3>
    <p>Drop anime folders into <code>media/anime/&lt;Show Name&gt;/</code> and manga into <code>media/manga/&lt;Title&gt;/&lt;Chapter&gt;/</code>,<br/>
    then hit Rescan in Settings.</p>
  </div>`;
}

let heroRotationTimer = null; // module-level so a later renderHero call can clear a still-running timer from an earlier visit to this page
let seriesEndRotationTimer = null; // same reasoning - the player page can be revisited for a different show without a full reload

// The active hls.js instance, when one is in use (null on Safari,
// which has native HLS support, or when the current file doesn't need
// transcoding at all) - module-level, not local to pagePlayer, so
// navigating away from the player entirely (not just switching sources
// within it) can still reach and tear it down. Without this, leaving
// the player page left the instance - and its worker, and its
// MediaSource - running in the background indefinitely, since nothing
// outside pagePlayer's own local scope could ever reach it to clean
// it up.
let activeHlsPlayer = null;
function teardownActiveHlsPlayer() {
  if (activeHlsPlayer) { try { activeHlsPlayer.destroy(); } catch (e) { /* noop */ } activeHlsPlayer = null; }
}

function renderHero(shows) {
  clearInterval(heroRotationTimer); // a previous visit to this page may have left one running
  const heroEl = document.getElementById('hero');
  if (!heroEl) return;
  if (shows.length === 0) {
    heroEl.innerHTML = `<div class="hero-bg hero-bg-empty-state"></div>
      <div class="hero-content"><h1 class="hero-title">${escapeHtml(Store.config.siteName)}</h1>
      <p class="hero-desc">Add anime to your media/anime folder to get started.</p></div>`;
    return;
  }
  let idx = 0;
  // The dots are built once and never recreated - only the .active class
  // moves between them on each slide change. That's what actually lets
  // the CSS transition (width/shape/color) play smoothly; rebuilding
  // them from scratch via innerHTML every 7 seconds (like the rest of
  // the hero content) would give the browser no "before" state to
  // animate from, so a dot would just snap into its new shape instead
  // of sliding into it.
  heroEl.innerHTML = `<div id="heroMainContent"></div>`;
  const mainEl = document.getElementById('heroMainContent');
  const dotsEl = el(`<div class="hero-dots">${shows.map((_, i) => `<button data-i="${i}"></button>`).join('')}</div>`);
  heroEl.appendChild(dotsEl);
  dotsEl.querySelectorAll('button').forEach((b, i) => {
    b.addEventListener('click', () => { idx = i; paint(); updateDots(); resetTimer(); });
  });
  function updateDots() {
    dotsEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === idx));
  }
  function paint() {
    const s = shows[idx];
    const bg = s.banner || s.cover || '/img/placeholder-banner.svg';
    mainEl.innerHTML = `
      <div class="hero-bg" style="background-image:url('${bg}')"></div>
      <div class="hero-content">
        <h1 class="hero-title">${escapeHtml(s.title)}</h1>
        <div class="hero-meta"><span class="badge">${escapeHtml(s.rating || '16+')}</span><span class="hero-year">${s.year || ''}</span></div>
        ${s.tagline ? `<p class="hero-tagline">${escapeHtml(s.tagline)}</p>` : ''}
        <p class="hero-desc">${escapeHtml(s.description || 'No description available. Add an info.json to this folder to customize this text.')}</p>
        <div class="hero-actions">
          <button class="btn btn-primary" id="heroPlayBtn">&#9654; Play</button>
          <a class="btn btn-secondary" href="#/title/${s.id}">&#9432; More Info</a>
        </div>
      </div>
    `;
    const heroPlayBtn = document.getElementById('heroPlayBtn');
    if (heroPlayBtn) heroPlayBtn.addEventListener('click', () => playOrResume(s));
  }
  function resetTimer() {
    clearInterval(heroRotationTimer);
    heroRotationTimer = setInterval(() => { idx = (idx + 1) % shows.length; paint(); updateDots(); }, 7000);
  }
  paint();
  updateDots();
  resetTimer();
}

async function playOrResume(show) {
  if (!show.groups) show = await API.getAnime(show.id).catch(() => show);
  if (!show.groups) { location.hash = `#/title/${show.id}`; return; }
  const allEpisodes = [];
  for (const g of show.groups) for (const ep of g.episodes) allEpisodes.push(ep);
  if (allEpisodes.length === 0) { location.hash = `#/title/${show.id}`; return; }

  const p = Store.activeProfile;
  const watchedSet = new Set(p && p.watchedEpisodes ? p.watchedEpisodes : []);
  const firstUnwatched = allEpisodes.find((ep) => !watchedSet.has(`${show.id}:${ep.relPath}`));
  const target = firstUnwatched || allEpisodes[allEpisodes.length - 1]; // everything watched - replay the last one
  location.hash = `#/watch/${show.id}/${encodeURIComponent(target.relPath)}`;
}

// ==================== GRID PAGES (Series / Movies / Books / New) ====================
async function pageGrid(root, kind) {
  await Store.loadLibrary();
  const titleMap = { series: 'Series', movies: 'Movies', books: 'Books', new: 'New & Popular' };

  let items;
  if (kind === 'books') {
    items = Store.manga;
  } else if (kind === 'new') {
    items = [...Store.anime, ...Store.movies].reverse();
  } else if (kind === 'movies') {
    items = Store.movies;
  } else {
    items = Store.anime;
  }
  items = Store.filterForActiveProfile(items);

  const allGenres = [...new Set(items.flatMap((s) => s.genres || []))].sort();
  const allStudios = kind === 'books' ? [] : [...new Set(items.flatMap((s) => s.studios || []))].sort();

  root.innerHTML = `
    ${renderNavbar(kind)}
    <div class="page-wrap">
      <div class="page-header">
        <h1>${titleMap[kind]}</h1>
        <div class="filter-bar">
          <select id="sortSelect">
            <option value="title">A-Z</option>
            <option value="newest">Recently Added</option>
          </select>
          ${kind!=='books'?`<select id="catalogAudio" aria-label="Catalog audio"><option value="">All audio</option><option value="dub">English dub available</option><option value="jpn">Japanese audio (tagged)</option><option value="eng">English audio (tagged)</option></select><select id="catalogSubtitles" aria-label="Catalog subtitles"><option value="">All subtitles</option><option value="eng">English subtitles (tagged)</option><option value="jpn">Japanese subtitles (tagged)</option><option value="spa">Spanish subtitles (tagged)</option></select>`:''}
          ${allStudios.length > 0 ? `
          <select id="studioSelect">
            <option value="">All Studios</option>
            ${allStudios.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
          </select>` : ''}
        </div>
      </div>
      ${allGenres.length > 0 ? `
      <div class="genre-chips" id="genreChips">
        <button class="genre-chip active" data-genre="">All</button>
        ${allGenres.map((g) => `<button class="genre-chip" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}
      </div>` : ''}
      <div class="grid" id="gridContent"></div>
    </div>`;
  wireNavbar();

  const grid = document.getElementById('gridContent');
  function paint(list) {
    if (list.length === 0) {
      grid.innerHTML = `<div class="empty-state"><h3>Nothing here</h3><p>Try a different genre, or add more media and rescan from Settings.</p></div>`;
      return;
    }
    grid.innerHTML = kind === 'books'
      ? list.map(m => mangaCardHTML(m)).join('')
      : list.map(s => animeCardHTML(s, { tall: true })).join('');
    wireCardNav(grid);
  }
  paint(items);

  let activeGenres = new Set();
  function applyFilters() {
    let filtered = activeGenres.size > 0
      ? items.filter((s) => [...activeGenres].every((g) => (s.genres || []).includes(g)))
      : items;
    const studioSelect = document.getElementById('studioSelect');
    const audio=document.getElementById('catalogAudio')?.value,subtitle=document.getElementById('catalogSubtitles')?.value;
    if(audio)filtered=filtered.filter(s=>audio==='dub'?s.hasDub===true:(s.audioLanguages||[]).includes(audio));
    if(subtitle)filtered=filtered.filter(s=>(s.subtitleLanguages||[]).includes(subtitle));
    if (studioSelect && studioSelect.value) {
      filtered = filtered.filter((s) => (s.studios || []).includes(studioSelect.value));
    }
    const v = document.getElementById('sortSelect').value;
    filtered = [...filtered].sort((a, b) => v === 'title'
      ? a.title.localeCompare(b.title)
      : (b.year || 0) - (a.year || 0));
    paint(filtered);
  }

  document.getElementById('sortSelect').addEventListener('change', applyFilters);
  for(const id of ['catalogAudio','catalogSubtitles'])document.getElementById(id)?.addEventListener('change',applyFilters);
  const studioSelectEl = document.getElementById('studioSelect');
  if (studioSelectEl) studioSelectEl.addEventListener('change', applyFilters);
  const chipsWrap = document.getElementById('genreChips');
  if (chipsWrap) {
    chipsWrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.genre-chip');
      if (!btn) return;
      if (!btn.dataset.genre) {
        activeGenres.clear(); // "All" chip - reset everything
      } else if (activeGenres.has(btn.dataset.genre)) {
        activeGenres.delete(btn.dataset.genre);
      } else {
        activeGenres.add(btn.dataset.genre);
      }
      chipsWrap.querySelectorAll('.genre-chip').forEach((c) => {
        c.classList.toggle('active', c.dataset.genre ? activeGenres.has(c.dataset.genre) : activeGenres.size === 0);
      });
      applyFilters();
    });
  }
}

// ==================== SHOW DETAIL ====================
// Theme song: if a show has a theme.mp3 (or .m4a/.ogg/.wav) file in its
// own folder - placed there by the person running the server, exactly
// like their episodes or a custom cover image, never fetched or
// downloaded by the app itself - it plays quietly in the background
// while that show's page is open. Browsers block audio-with-sound from
// autoplaying until the person has interacted with the page at least
// once; when that happens, a small "Play Theme" button appears instead
// of just silently failing.
let activeThemeAudio = null; // singleton - only one theme should ever be considered "current"

function stopActiveThemeAudio() {
  if (!activeThemeAudio) return;
  const { audio, controlWrap, state } = activeThemeAudio;
  state.destroyed = true;
  audio.pause();
  audio.src = '';
  audio.load(); // makes the browser actually abort the in-flight resource instead of leaving it dangling
  if (controlWrap.isConnected) controlWrap.remove();
  activeThemeAudio = null;
}

function wireSeriesLogo(showId, isAdmin) {
  const wrap = document.getElementById('detailTitleWrap');
  if (!wrap) { console.log('[series-logo] detailTitleWrap not found in the DOM - skipping'); return; }
  function request(forceRefresh) {
    const url = `/api/anime/${encodeURIComponent(showId)}/series-logo${forceRefresh ? '?refresh=1' : ''}`;
    console.log(`[series-logo] requesting ${url}`);
    const img = new Image();
    img.onload = () => {
      console.log('[series-logo] image loaded successfully - swapping in the logo');
      wrap.innerHTML = '';
      img.className = 'detail-title-logo';
      img.alt = '';
      wrap.appendChild(img);
    };
    img.onerror = () => {
      console.log('[series-logo] image failed to load (no logo available) - keeping the text title');
      // Only an admin can trigger a recheck at all, and only once a
      // "no logo" result has actually been confirmed - added here
      // (rather than always present) specifically for updating Jellyfin
      // itself and wanting to see that reflected immediately, instead
      // of waiting on the normal week-long expiry on a negative result.
      if (isAdmin) {
        let btn = document.getElementById('seriesLogoRecheckBtn');
        if (!btn) {
          btn = document.createElement('button');
          btn.id = 'seriesLogoRecheckBtn';
          btn.className = 'btn-ghost';
          btn.style.cssText = 'margin-top:6px;font-size:12px;padding:4px 10px';
          btn.addEventListener('click', () => {
            btn.disabled = true;
            btn.textContent = 'Checking...';
            request(true);
          });
          wrap.appendChild(btn);
        }
        btn.disabled = false;
        btn.textContent = 'Recheck logo in Jellyfin';
      }
    };
    img.src = url;
  }
  request(false);
}

function wireThemeSong(item) {
  // Always fully stop whatever theme (if any) was playing before,
  // regardless of exactly how we got here - a normal navigation, an
  // in-place page refresh after an import, anything - so there's never
  // a chance of two overlapping, or one becoming silently orphaned and
  // stuck playing behind a page that's already gone.
  stopActiveThemeAudio();
  if (!item.theme) return;

  const state = { destroyed: false };
  const audio = new Audio(item.theme);
  audio.loop = true;
  audio.volume = 0.35;

  const controlWrap = el(`
    <div class="theme-song-control" title="Theme song">
      <button id="themeSongToggle">&#128264;</button>
    </div>`);
  document.body.appendChild(controlWrap);
  const toggleBtn = controlWrap.querySelector('#themeSongToggle');

  function updateIcon() {
    if (state.destroyed) return;
    toggleBtn.innerHTML = audio.paused ? '&#128264;' : '&#128266;';
  }
  function tryPlay() {
    audio.play().then(() => {
      // play() can resolve AFTER cleanup already ran - a real browser
      // race when navigating away right as playback was starting. If
      // that happens, stop it again immediately instead of letting it
      // start playing behind a page that's already gone.
      if (state.destroyed) { audio.pause(); return; }
      updateIcon();
    }).catch(() => {
      if (state.destroyed) return;
      // Autoplay blocked - show a clear one-click way to start it instead
      // of failing silently forever.
      toggleBtn.innerHTML = '&#9654; Play Theme';
      controlWrap.classList.add('needs-tap');
    });
  }
  toggleBtn.addEventListener('click', () => {
    controlWrap.classList.remove('needs-tap');
    if (audio.paused) tryPlay();
    else { audio.pause(); updateIcon(); }
  });

  tryPlay();
  activeThemeAudio = { audio, controlWrap, state };

  // Stop cleanly the moment the person navigates anywhere else, rather
  // than leaving it playing in the background over whatever's next.
  window.addEventListener('hashchange', () => {
    if (activeThemeAudio && activeThemeAudio.state === state) stopActiveThemeAudio();
  }, { once: true });
}

async function pageDetail(root, id) {
  if (Store.anime.length === 0) await Store.loadLibrary();
  let show = Store.findAnime(id) || await API.getAnime(id).catch(() => null);
  if (show && !show.groups) show = await API.getAnime(id).catch(() => show);
  if (!show) { root.innerHTML = `${renderNavbar('')}<div class="page-wrap"><div class="empty-state"><h3>Title not found</h3></div></div>`; wireNavbar(); return; }
  if (Store.isKidsActive() && Store.isMatureRating(show.rating)) {
    showToast("This title isn't available on a kids profile");
    location.hash = '#/';
    return;
  }

  const bg = show.banner || show.cover || '/img/placeholder-banner.svg';
  const inList = Store.isInMyList(show.id, 'anime');

  root.innerHTML = `
    ${renderNavbar('')}
    <div class="detail-hero">
      <div class="detail-hero-bg" style="background-image:url('${bg}')"></div>
      <div class="detail-content">
        <img class="detail-poster" src="${show.cover || '/img/placeholder-poster.svg'}" alt=""/>
        <div class="detail-info">
          <div id="detailTitleWrap"><h1 id="detailTitleText">${escapeHtml(show.title)}</h1></div>
          <div class="detail-meta">
            <span class="badge">${escapeHtml(show.rating || '16+')}</span>
            <span>${show.year || ''}</span>
            <span>${show.episodeCount} episodes</span>
            ${(show.studios || []).map((s) => `<a href="#/studio/${encodeURIComponent(s)}" class="detail-studio-link">${escapeHtml(s)}</a>`).join('')}
          </div>
          <div class="detail-genres">${(show.genres || []).map(g => `<span class="chip">${escapeHtml(g)}</span>`).join('')}</div>
          <p class="detail-desc">${escapeHtml(show.description || 'No description yet. Add an info.json file to this folder to customize title info.')}</p>
          <div class="detail-actions">
            <button class="btn btn-primary" id="playBtn">${(Store.activeProfile && Store.activeProfile.progress && Store.activeProfile.progress[show.id]) ? '&#9654; Resume' : '&#9654; Play'}</button>
            <button class="btn btn-secondary" id="listBtn">${inList ? '&#10003; In My List' : '+ My List'}</button>
            <button class="btn-ghost" id="topPickBtn">${Store.isTopPick(show.id, 'anime') ? '&#9733; Top Pick' : '&#9734; Top Pick'}</button>
            <button class="btn-ghost" id="reviewBtn">&#128221; Write a Review</button>
            ${Store.account && Store.account.role === 'admin' ? `<button class="btn-ghost" id="malImportBtn" title="Pull poster, banner, description and genres from MyAnimeList">&#128218; Import from MAL</button>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="episodes-wrap">
      <div class="episodes-header-row">
        <h2 class="row-title" style="margin-bottom:0;padding:0">Episodes</h2>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="season-pill-wrap">
            <button class="season-pill" id="seasonPillBtn">${escapeHtml(show.groups[0].name)}</button>
            <div class="season-pill-menu" id="seasonPillMenu">
              ${show.groups.map((g, i) => `<button data-group="${i}" class="${i === 0 ? 'active' : ''}">${escapeHtml(g.name)}</button>`).join('')}
            </div>
          </div>
          <div class="season-pill-wrap">
            <button class="episodes-menu-btn" id="episodesMenuBtn">&#8942;</button>
            <div class="season-pill-menu" id="episodesActionsMenu" style="right:0;left:auto">
              <button id="markSeasonWatchedBtn">Mark Season as Watched</button>
            </div>
          </div>
        </div>
      </div>
      <div class="episode-grid" id="episodeList"></div>
    </div>
    ${reviewsSectionHTML()}
    ${externalLinksSectionHTML(show, 'anime')}
    ${relatedSectionHTML()}
    ${castSectionHTML()}
    <div class="rows-wrap" id="moreLikeThisWrap" style="margin-top:20px"></div>
    <div class="footer"></div>
  `;
  wireNavbar();
  wireSeriesLogo(show.id, !!(Store.account && Store.account.role === 'admin'));
  wireReviewsSection(root, show, 'anime');
  wireRelatedSection(show.id);
  wireCastSection(show.id);
  wireThemeSong(show);

  const moreLikeThis = computeMoreLikeThis(show, 12);
  if (moreLikeThis.length > 0) {
    document.getElementById('moreLikeThisWrap').innerHTML = rowSectionHTML('More Like This', moreLikeThis.map(s => animeCardHTML(s, { tall: true })).join(''));
    wireCardNav(document.getElementById('moreLikeThisWrap'));
    wireRowArrows(document.getElementById('moreLikeThisWrap'));
  }

  document.getElementById('playBtn').addEventListener('click', () => playOrResume(show));
  document.getElementById('listBtn').addEventListener('click', async (e) => {
    if (!Store.activeProfile) { showToast('Select a profile first'); return; }
    const res = await API.toggleMyList(Store.activeProfile.id, show.id, 'anime');
    Store.activeProfile.myList = res.myList;
    const nowIn = Store.isInMyList(show.id, 'anime');
    e.target.innerHTML = nowIn ? '&#10003; In My List' : '+ My List';
  });
  document.getElementById('topPickBtn').addEventListener('click', async (e) => {
    if (!Store.activeProfile) { showToast('Select a profile first'); return; }
    try {
      const res = await API.toggleTopPick(Store.activeProfile.id, show.id, 'anime');
      Store.activeProfile.topPicks = res.topPicks;
      e.target.innerHTML = Store.isTopPick(show.id, 'anime') ? '&#9733; Top Pick' : '&#9734; Top Pick';
    } catch (err) { showToast(err.message); }
  });
  document.getElementById('reviewBtn').addEventListener('click', () => {
    if (!Store.activeProfile) { showToast('Select a profile first'); return; }
    openReviewModal(show, 'anime');
  });
  const malImportBtn = document.getElementById('malImportBtn');
  if (malImportBtn) {
    malImportBtn.addEventListener('click', () => {
      openMalSearchModal(show, async () => {
        await Store.loadLibrary({ force: true });
        await pageDetail(root, id);
      });
    });
  }

  function isEpisodeWatched(relPath) {
    return !!(Store.activeProfile && Store.activeProfile.watchedEpisodes && Store.activeProfile.watchedEpisodes.includes(`${show.id}:${relPath}`));
  }

  function fmtEpisodeDuration(seconds) {
    const mins = Math.round(seconds / 60);
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  }

  function paintEpisodes(groupIdx) {
    const group = show.groups[groupIdx];
    const listEl = document.getElementById('episodeList');
    const fallbackImg = show.banner || show.cover || '/img/placeholder-banner.svg';
    listEl.innerHTML = group.episodes.map(ep => `
      <div class="episode-card ${isEpisodeWatched(ep.relPath) ? 'is-watched' : ''}" data-relpath="${encodeURIComponent(ep.relPath)}">
        <div class="episode-card-thumb-wrap">
          <img class="episode-card-thumb" src="/api/episode-thumb/${show.id}/${encodeURIComponent(ep.relPath)}" data-fallback="${escapeHtml(fallbackImg)}" loading="lazy" alt=""/>
          <span class="episode-card-duration" data-duration-for="${encodeURIComponent(ep.relPath)}" style="display:none"></span>
          <button class="episode-card-watched-badge" data-watched-toggle="${encodeURIComponent(ep.relPath)}" data-title="${escapeHtml(ep.title)}" title="${isEpisodeWatched(ep.relPath) ? 'Mark as unwatched' : 'Mark as watched'}">&#10003;</button>
          <div class="episode-card-play-overlay"><div class="play-circle">&#9654;</div></div>
        </div>
        <div class="episode-card-title" data-title-for-episode="${ep.index}">${ep.index}. ${escapeHtml(ep.title)}</div>
        <div class="episode-card-desc">${escapeHtml(ep.file)}</div>
      </div>`).join('');
    listEl.querySelectorAll('.episode-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-watched-toggle]')) return;
        location.hash = `#/watch/${show.id}/${card.dataset.relpath}`;
      });
    });
    listEl.querySelectorAll('[data-watched-toggle]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!Store.activeProfile) { showToast('Select a profile first'); return; }
        const relPath = decodeURIComponent(btn.dataset.watchedToggle);
        const nowWatched = !btn.closest('.episode-card').classList.contains('is-watched');
        try {
          if (nowWatched) {
            await API.markWatched(Store.activeProfile.id, show.id, 'anime', relPath, btn.dataset.title);
            Store.activeProfile.watchedEpisodes = Store.activeProfile.watchedEpisodes || [];
            Store.activeProfile.watchedEpisodes.push(`${show.id}:${relPath}`);
          } else {
            await API.markUnwatched(Store.activeProfile.id, show.id, relPath);
            Store.activeProfile.watchedEpisodes = (Store.activeProfile.watchedEpisodes || []).filter(k => k !== `${show.id}:${relPath}`);
          }
          btn.closest('.episode-card').classList.toggle('is-watched', nowWatched);
          btn.title = nowWatched ? 'Mark as unwatched' : 'Mark as watched';
        } catch (err) { showToast(err.message); }
      });
    });

    // Real runtimes fetched in the background (a metadata-only probe per
    // file, cached server-side) - the grid renders instantly without
    // waiting on this, and each badge fills in as the data arrives.
    API.getEpisodeDurations(show.id, groupIdx).then((durations) => {
      for (const [relPath, seconds] of Object.entries(durations)) {
        const badge = listEl.querySelector(`[data-duration-for="${encodeURIComponent(relPath)}"]`);
        if (badge) { badge.textContent = fmtEpisodeDuration(seconds); badge.style.display = ''; }
      }
    }).catch(() => {});

    // Real episode titles, same background/non-blocking pattern - only
    // available for titles imported from AniList, and only replaces a
    // card's title where AniList actually has a matching one for that
    // episode number; everything else keeps its filename-derived title.
    API.getEpisodeTitles(show.id).then(({ episodes }) => {
      for (const realEp of episodes) {
        const el = listEl.querySelector(`[data-title-for-episode="${realEp.number}"]`);
        if (el) el.textContent = `${realEp.number}. ${realEp.title}`;
      }
    }).catch(() => {});
  }
  paintEpisodes(0);

  // ---- Season pill dropdown ----
  const seasonPillBtn = document.getElementById('seasonPillBtn');
  const seasonPillMenu = document.getElementById('seasonPillMenu');
  const episodesMenuBtn = document.getElementById('episodesMenuBtn');
  const episodesActionsMenu = document.getElementById('episodesActionsMenu');
  seasonPillBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    episodesActionsMenu.classList.remove('open');
    seasonPillMenu.classList.toggle('open');
  });
  episodesMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    seasonPillMenu.classList.remove('open');
    episodesActionsMenu.classList.toggle('open');
  });
  document.addEventListener('click', () => { seasonPillMenu.classList.remove('open'); episodesActionsMenu.classList.remove('open'); });
  seasonPillMenu.querySelectorAll('button[data-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const groupIdx = parseInt(btn.dataset.group, 10);
      seasonPillBtn.textContent = btn.textContent;
      seasonPillMenu.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      seasonPillMenu.classList.remove('open');
      paintEpisodes(groupIdx);
    });
  });

  document.getElementById('markSeasonWatchedBtn').addEventListener('click', async () => {
    if (!Store.activeProfile) { showToast('Select a profile first'); return; }
    const activeBtn = seasonPillMenu.querySelector('button.active');
    const groupIdx = activeBtn ? parseInt(activeBtn.dataset.group, 10) : 0;
    const group = show.groups[groupIdx];
    for (const ep of group.episodes) {
      await API.markWatched(Store.activeProfile.id, show.id, 'anime', ep.relPath, ep.title).catch(() => {});
      Store.activeProfile.watchedEpisodes = Store.activeProfile.watchedEpisodes || [];
      if (!Store.activeProfile.watchedEpisodes.includes(`${show.id}:${ep.relPath}`)) {
        Store.activeProfile.watchedEpisodes.push(`${show.id}:${ep.relPath}`);
      }
    }
    showToast(`Marked "${group.name}" as watched`);
    episodesActionsMenu.classList.remove('open');
    paintEpisodes(groupIdx);
  });
}

// ==================== PLAYER ====================
const LANGUAGE_NAMES = {
  jpn: 'Japanese', eng: 'English', spa: 'Spanish', fre: 'French', fra: 'French',
  ger: 'German', deu: 'German', ita: 'Italian', por: 'Portuguese', rus: 'Russian',
  kor: 'Korean', chi: 'Chinese', zho: 'Chinese', ara: 'Arabic', und: 'Unknown',
};
function langName(code) {
  if (!code) return 'Unknown';
  return LANGUAGE_NAMES[code.toLowerCase()] || code.toUpperCase();
}
function trackLabelText(t) {
  const base = t.title ? `${t.title} (${langName(t.language)})` : langName(t.language);
  return t.imageBased ? `${base} - image-based, may not display` : base;
}
function fmtClock(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// Heuristic fallback when a show doesn't define explicit skip windows in
// info.json: assume a ~90s intro at the start and a ~90s outro at the end,
// only offered on episodes long enough that this is a sane guess (>3 min).
function computeSkipWindows(show, duration) {
  const skipIntro = show.skipIntro
    ? { start: show.skipIntro.start, end: show.skipIntro.end }
    : (duration && duration > 180 ? { start: 0, end: Math.min(90, duration * 0.15) } : null);
  const skipOutro = show.skipOutro
    ? { start: show.skipOutro.start, end: show.skipOutro.end != null ? show.skipOutro.end : duration }
    : (duration && duration > 180 ? { start: Math.max(duration - 90, duration * 0.85), end: duration } : null);
  return { skipIntro, skipOutro };
}

const PLAYER_ICONS = {
  scissors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.5 8 20 20M20 4 8.5 16"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  rewind10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span class="skip-num">10</span>',
  forward10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg><span class="skip-num">10</span>',
  volumeHigh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 9v6h4l5 5V4l-5 5H5z"/><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  volumeMuted: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 9v6h4l5 5V4l-5 5H5z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  nextEp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5v14l10-7z"/><rect x="17" y="5" width="2.5" height="14"/></svg>',
  captions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><line x1="6.5" y1="10" x2="10.5" y2="10"/><line x1="6.5" y1="14" x2="14.5" y2="14"/><line x1="14" y1="10" x2="17.5" y2="10"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  fullscreenOpen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  fullscreenClose: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v3a2 2 0 0 1-2 2H4"/><path d="M15 3v3a2 2 0 0 0 2 2h3"/><path d="M9 21v-3a2 2 0 0 0-2-2H4"/><path d="M15 21v-3a2 2 0 0 1 2-2h3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" opacity="0.15"/><polyline points="7 12.5 10.5 16 17 8.5"/></svg>',
  cast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16.1A5 5 0 0 1 5.9 20"/><path d="M2 12.05A9 9 0 0 1 9.95 20"/><path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-8"/><line x1="2" y1="20" x2="2.01" y2="20"/></svg>',
  pip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor" stroke="none"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
};

async function pagePlayer(root, showId, relPathEncoded, options = {}) {
  if (Store.anime.length === 0) await Store.loadLibrary();
  let show = Store.findAnime(showId);
  if (show && !show.groups) show = await API.getAnime(showId).catch(() => show);
  if (!show) { root.innerHTML = `<div class="page-wrap"><div class="empty-state"><h3>Title not found</h3></div></div>`; return; }
  if (Store.isKidsActive() && Store.isMatureRating(show.rating)) {
    showToast("This title isn't available on a kids profile");
    location.hash = '#/';
    return;
  }
  const relPath = decodeURIComponent(relPathEncoded);

  let currentEp = null, group = null, epIdxInGroup = -1, groupIdx = -1;
  for (let gi = 0; gi < show.groups.length; gi++) {
    const g = show.groups[gi];
    const idx = g.episodes.findIndex(e => e.relPath === relPath);
    if (idx >= 0) { group = g; currentEp = g.episodes[idx]; epIdxInGroup = idx; groupIdx = gi; break; }
  }
  if (!currentEp) { location.hash = `#/title/${showId}`; return; }

  const prevEp = !options.live && epIdxInGroup > 0 ? group.episodes[epIdxInGroup - 1] : null;
  let nextEp = !options.live && epIdxInGroup < group.episodes.length - 1 ? group.episodes[epIdxInGroup + 1] : null;
  let nextEpIsNewSeason = false;
  let nextSeasonName = null;
  if (!nextEp && !options.live) {
    // Last episode of this season - look into the next one, if there
    // is one, rather than treating this as the end of the whole show
    // just because this particular season is done.
    for (let gi = groupIdx + 1; gi < show.groups.length && !nextEp; gi++) {
      if (show.groups[gi].episodes.length > 0) { nextEp = show.groups[gi].episodes[0]; nextEpIsNewSeason = true; nextSeasonName = show.groups[gi].name; }
    }
  }
  const encodedRelPath = currentEp.relPath.split('/').map(encodeURIComponent).join('/');
  const streamBase = `/api/stream/${showId}/${encodedRelPath}`;

  root.innerHTML = `
    <div class="player-page">
      <div class="player-container" id="playerContainer">
        <div class="player-top" id="playerTop">
          <button class="back-btn" id="backBtn">&#8592;</button>
          <div class="title-block">
            <div class="show-title">${escapeHtml(show.title)}</div>
            <div class="ep-title">Ep ${currentEp.index} &middot; ${escapeHtml(currentEp.title)}</div>
          </div>
          <span class="track-fix-badge" id="fixBadge" style="display:none"></span>
        </div>
        ${(show.rating || (show.genres && show.genres[0])) ? `
        <div class="rating-badge-wrap" id="ratingBadgeWrap">
          ${show.rating ? `<span class="rating-chip">${escapeHtml(show.rating)}</span>` : ''}
          ${show.genres && show.genres[0] ? `<span class="rating-descriptor">${escapeHtml(show.genres[0])}</span>` : ''}
        </div>` : ''}
        ${prevEp ? `<button class="episode-nav-btn prev" id="prevBtn">&#8249;</button>` : ''}
        ${nextEp ? `<button class="episode-nav-btn next" id="nextBtn">&#8250;</button>` : ''}
        <video class="main-video" id="mainVideo" playsinline></video>
        <div class="custom-sub-overlay-top" id="customSubOverlayTop"></div>
        <div class="custom-sub-overlay" id="customSubOverlay"></div>
        <div class="player-error-banner" id="playerErrorBanner" style="display:none">
          <span class="player-error-icon">&#9888;</span>
          <span class="player-error-text" id="playerErrorText"></span>
          <button class="player-error-dismiss" id="playerErrorDismiss">Dismiss</button>
        </div>
        <button class="skip-btn" id="skipIntroBtn" style="display:none">Skip Intro &#9654;</button>
        <button class="skip-btn" id="skipOutroBtn" style="display:none">${nextEp ? 'Next Episode &#9654;' : 'Skip Outro &#9654;'}</button>
        ${nextEp ? `
        <div class="next-ep-overlay" id="nextEpOverlay" style="display:none">
          <div class="next-ep-card">
            <img class="next-ep-thumb" src="/api/episode-thumb/${showId}/${encodeURIComponent(nextEp.relPath)}" data-fallback="${escapeHtml(show.banner || show.cover || '/img/placeholder-banner.svg')}" alt="" loading="lazy"/>
            <div class="next-ep-progress"><div class="next-ep-progress-bar" id="nextEpProgressBar"></div></div>
            <div class="next-ep-body">
              <div class="next-ep-label">${nextEpIsNewSeason ? `Up Next &middot; ${escapeHtml(nextSeasonName)}` : 'Up Next'}</div>
              <div class="next-ep-title">Ep ${nextEp.index} &middot; ${escapeHtml(nextEp.title)}</div>
              <div class="next-ep-actions">
                <button class="btn-ghost" id="nextEpCancelBtn">Cancel</button>
                <button class="btn btn-primary" id="nextEpPlayBtn">
                  Play Now <span id="nextEpCountdown">(10)</span>
                </button>
              </div>
            </div>
          </div>
        </div>` : `
        <div class="series-end-overlay" id="seriesEndOverlay" style="display:none"></div>`}

        <div class="cc-panel-overlay" id="ccPanelOverlay">
          <div class="cc-panel" id="ccPanel">
            <div class="cc-panel-col">
              <h4>Audio</h4>
              <div class="cc-panel-list" id="ccAudioList"></div>
            </div>
            <div class="cc-panel-col">
              <h4>Subtitles/CC</h4>
              <div class="cc-panel-list" id="ccSubList"></div>
              <div class="cc-appearance-row">
                <label>Size</label>
                <select id="subSizeSelect">
                  <option value="small">Small</option>
                  <option value="medium" selected>Medium</option>
                  <option value="large">Large</option>
                </select>
                <label>Color</label>
                <select id="subColorSelect">
                  <option value="#ffffff">White</option>
                  <option value="#ffff00">Yellow</option>
                  <option value="#00ffff">Cyan</option>
                  <option value="#ff6666">Red</option>
                </select>
                <label>Background</label>
                <select id="subBgSelect">
                  <option value="box">Black box</option>
                  <option value="semi">See-through</option>
                  <option value="none">None (outlined text)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="player-controls-bar" id="controlsBar">
          <button class="ctl-btn ctl-icon" id="ctlRewindBtn" title="Back 10 seconds">${PLAYER_ICONS.rewind10}</button>
          <button class="ctl-btn ctl-icon ctl-play" id="ctlPlay" title="Play/Pause">${PLAYER_ICONS.play}</button>
          <button class="ctl-btn ctl-icon" id="ctlForwardBtn" title="Forward 10 seconds">${PLAYER_ICONS.forward10}</button>
          <div class="ctl-menu-wrap ctl-volume-wrap">
            <button class="ctl-btn ctl-icon" id="ctlMuteBtn" title="Mute">${PLAYER_ICONS.volumeHigh}</button>
            <input type="range" id="ctlVolume" class="ctl-volume" min="0" max="1" step="0.01" value="1"/>
          </div>
          <span class="ctl-time" id="ctlCurrentTime">0:00</span>
          <input type="range" id="ctlSeek" class="ctl-seek" min="0" max="100" value="0" step="0.1"/>
          <div class="seek-preview" id="seekPreview" style="display:none"><div class="seek-preview-img" id="seekPreviewImg"></div><div class="seek-preview-time" id="seekPreviewTime"></div></div>
          <span class="ctl-time" id="ctlDuration">0:00</span>

          ${nextEp ? `<button class="ctl-btn ctl-icon" id="ctlNextEpBtn" title="Next Episode">${PLAYER_ICONS.nextEp}</button>` : ''}

          <div class="ctl-menu-wrap" id="ccMenuWrap" style="display:none">
            <button class="ctl-btn ctl-icon" id="ctlCCBtn" title="Audio &amp; Subtitles">${PLAYER_ICONS.captions}</button>
          </div>

          <div class="ctl-menu-wrap" id="speedMenuWrap">
            <button class="ctl-btn ctl-speed-btn" id="ctlSpeedBtn" title="Playback speed">1x</button>
            <div class="ctl-popup ctl-popup-up" id="speedPopup"></div>
          </div>

          <div class="ctl-menu-wrap" id="settingsMenuWrap" style="display:none">
            <button class="ctl-btn ctl-icon" id="ctlSettingsBtn" title="Quality">${PLAYER_ICONS.gear}</button>
            <div class="ctl-popup ctl-popup-up" id="qualityPopup"></div>
          </div>

          <div class="ctl-menu-wrap" id="skipPointsMenuWrap">
            <button class="ctl-btn ctl-icon" id="ctlSkipPointsBtn" title="Set Skip Points">${PLAYER_ICONS.scissors}</button>
            <div class="ctl-popup ctl-popup-up skip-points-popup" id="skipPointsPopup"></div>
          </div>

          <button class="ctl-btn ctl-icon" id="ctlPipBtn" title="Picture-in-Picture (plays in a floating window)" style="display:none">${PLAYER_ICONS.pip}</button>
          <button class="ctl-btn ctl-icon" id="ctlCastBtn" title="Cast to TV" style="display:none">${PLAYER_ICONS.cast}</button>
          <button class="ctl-btn ctl-icon" id="ctlWatchPartyBtn" title="Watch Party">${PLAYER_ICONS.people}</button>
          <button class="ctl-btn ctl-icon" id="ctlFullscreenBtn" title="Fullscreen">${PLAYER_ICONS.fullscreenOpen}</button>
        </div>
      </div>
    </div>`;

  ioWirePlayer(root, show, currentEp);

  document.getElementById('backBtn').addEventListener('click', () => {
    // Not history.back() - every episode transition (next/prev, autoplay,
    // clicking a different episode) pushes its own history entry, so
    // after watching a few episodes in a row, "back" would only ever
    // step back one episode at a time instead of actually returning to
    // the series page. Going there directly is correct regardless of
    // how many episodes were watched in this session.
    location.hash = `#/title/${showId}`;
  });
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  if (prevBtn) prevBtn.addEventListener('click', () => { location.hash = `#/watch/${showId}/${encodeURIComponent(prevEp.relPath)}`; });
  if (nextBtn) nextBtn.addEventListener('click', () => { location.hash = `#/watch/${showId}/${encodeURIComponent(nextEp.relPath)}`; });
  const ctlNextEpBtn = document.getElementById('ctlNextEpBtn');
  if (ctlNextEpBtn) ctlNextEpBtn.addEventListener('click', () => { location.hash = `#/watch/${showId}/${encodeURIComponent(nextEp.relPath)}`; });

  const playerContainer = document.getElementById('playerContainer');
  const video = document.getElementById('mainVideo');
  const measurements = new window.IOPlaybackMeasurements(video, () => video.currentSrc.startsWith('blob:') || video.currentSrc.includes('.m3u8') ? 'hls' : 'direct');
  window.addEventListener('hashchange', () => measurements.destroy(), { once: true });
  const savedProgress = Store.activeProfile && Store.activeProfile.progress && Store.activeProfile.progress[showId];
  const resumeAt = options.live ? (options.startAt || 0) : (savedProgress && savedProgress.episodeRelPath === relPath && savedProgress.seconds > 5) ? savedProgress.seconds : 0;

  // ---- Fetch track info (audio/subtitle languages, resolution, duration) ----
  let streamInfo = { ffmpegAvailable: false, canPassthrough: true, audioTracks: [], subtitleTracks: [], duration: null, videoHeight: null };
  try { streamInfo = await API.getStreamInfo(showId, currentEp.relPath); } catch (e) { /* raw playback still works without this */ }

  const transcodeMode = streamInfo.ffmpegAvailable && (!streamInfo.canPassthrough || streamInfo.audioTracks.length > 1);
  // Prefer whichever language this profile picked last time (the same
  // "remember my audio/subtitle language" behavior Crunchyroll/Netflix
  // have), falling back to the file's own default track if this profile
  // has no preference yet or this episode doesn't have that language.
  // Below that: sensible defaults for a profile that's never picked a
  // track before - prefer an English dub if one exists, and if the
  // audio you end up with isn't English, auto-turn-on English subtitles
  // when they're available, rather than leaving you to notice and pick
  // it yourself every time.
  const prefAudioLang = Store.activeProfile?.experience?.preferredAudio || (Store.activeProfile && Store.activeProfile.preferredAudioLang);
  const prefSubLang = Store.activeProfile?.experience?.preferredSubtitles || (Store.activeProfile && Store.activeProfile.preferredSubtitleLang);
  const isEnglish = (lang) => !!lang && /^en/i.test(lang);
  let selectedAudio = (
    (prefAudioLang && streamInfo.audioTracks.find(a => a.language === prefAudioLang)) ||
    (!prefAudioLang && streamInfo.audioTracks.find(a => isEnglish(a.language))) ||
    streamInfo.audioTracks.find(a => a.default) ||
    streamInfo.audioTracks[0] || {}
  ).index ?? null;
  const selectedAudioIsEnglish = isEnglish((streamInfo.audioTracks.find(a => a.index === selectedAudio) || {}).language);
  // Image-based subtitle tracks (PGS/DVD formats) can never actually be
  // displayed - ffmpeg's text extraction can't convert them at all - so
  // auto-selection skips them entirely rather than silently picking a
  // track guaranteed to come up blank. Still manually selectable from
  // the subtitle menu if someone wants to try anyway, just not the
  // automatic default.
  let selectedSubtitle = (
    (prefSubLang && streamInfo.subtitleTracks.find(s => s.language === prefSubLang && !s.imageBased)) ||
    (!prefSubLang && !selectedAudioIsEnglish && streamInfo.subtitleTracks.find(s => isEnglish(s.language) && !s.imageBased)) ||
    {}
  ).index ?? null;
  let selectedQuality = transcodeMode ? 'auto' : 'original';
  const preferredQuality=Store.activeProfile?.experience?.quality;
  if(preferredQuality==='original'||preferredQuality==='auto'&&transcodeMode)selectedQuality=preferredQuality;
  else if(streamInfo.ffmpegAvailable&&['1080','720','480','360','240'].includes(preferredQuality)&&Number(preferredQuality)<streamInfo.videoHeight)selectedQuality=preferredQuality;
  let streamOffset = 0; // seconds already skipped server-side for the current source (transcode mode only)
  let hlsStreamOffset = 0; // same concept as streamOffset above, but for a seek-triggered HLS session restart - video.currentTime is relative to that fresh session's own start, not the actual position in the full file
  let lastSeekAt = null; // timestamp of the last explicit seek - used to distinguish a genuine far-seek network error from an ordinary buffering hiccup during otherwise-uninterrupted playback
  let bufferStallStartTime = null; // when the current, ongoing buffer-stall episode since the last seek first began - non-fatal bufferStalledError events fire repeatedly for what is really just one continuous stall, so this tracks duration, not a raw event count
  let currentAutoLevelHeight = null; // the resolution hls.js's own adaptive bitrate logic is actually playing at right now, when quality is set to Auto - shown in the quality menu so the existing, already-working auto-switching is actually visible, not just happening silently
  let lastKnownGoodTime = 0; // highest absoluteTime() seen during normal forward playback - used to detect a native-HLS "phantom reset" (currentTime jumping backward with no real seek behind it)
  let phantomResetRepeatCount = 0;
  let reloading = false;

  // Whether the *currently selected* audio track + quality will come back
  // as a real, complete, Range-seekable file (native scrubbing, no reload
  // needed) versus an indefinite live pipe (needs a reload-to-seek). A
  // container-only fix (the common MKV-with-fine-codecs-inside case) is
  // now backed by a fast cached remux on the server, so it behaves like
  // native seeking too - only a genuine re-encode (bad video codec, or a
  // quality downscale) actually requires the live-pipe fallback.
  const BROWSER_AUDIO_CODECS_FE = ['aac', 'mp3', 'opus', 'vorbis'];
  function isForcedTranscode() {
    if (selectedQuality !== 'original') return true;
    if (!streamInfo.ffmpegAvailable) return false;
    // A fully-built cached copy (default settings) is served as a normal
    // seekable file - so even codec-incompatible sources behave like
    // direct playback: native seeking, no stream restarts, and subtitle
    // timestamps that never need shifting at all.
    if (streamInfo.cachedReady && selectedAudio === streamInfo.defaultAudioIndex) return false;
    if (streamInfo.videoCodecOk === false) return true;
    const track = streamInfo.audioTracks.find((t) => t.index === selectedAudio);
    return !(track && BROWSER_AUDIO_CODECS_FE.includes(track.codec));
  }
  function absoluteTime() {
    if (pipeMode) return streamOffset + (video.currentTime || 0);
    if (usesHls) return hlsStreamOffset + (video.currentTime || 0);
    return video.currentTime;
  }
  function totalDuration() { return streamInfo.duration || video.duration || 0; }
  const remoteCommand=e=>{const {command,value}=e.detail||{};if(command==='seek')seekTo(value);else if(command==='back')seekTo(Math.max(0,absoluteTime()-10));else if(command==='forward')seekTo(Math.min(totalDuration(),absoluteTime()+10));};
  video.addEventListener('io-remote-command',remoteCommand);

  // iPadOS deliberately identifies as desktop Mac Safari in its default
  // User-Agent string (since iPadOS 13) - the server has no way to tell
  // an iPad from a real desktop Mac purely from that header, but the
  // browser itself can: a real Mac has no touchscreen, while an iPad
  // masquerading as one still reports touch support. This matters here
  // specifically because iPadOS Safari has the exact same media
  // playback restrictions as iPhone (no reliable indefinite live-pipe
  // streaming), so misclassifying it as "desktop" server-side means it
  // gets served a stream it fundamentally can't play reliably.
  const isIpadMasqueradingAsDesktop = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  function buildSrc(offsetSeconds) {
    const params = new URLSearchParams();
    if (transcodeMode && selectedAudio != null) params.set('audio', selectedAudio);
    if (selectedQuality !== 'original') params.set('quality', selectedQuality);
    if (offsetSeconds) params.set('t', offsetSeconds.toFixed(2));
    if (isIpadMasqueradingAsDesktop) params.set('platformHint', 'ipad');
    const qs = params.toString();
    return streamBase + (qs ? '?' + qs : '');
  }

  // Phones and tablets never use offset (?t=) streaming: the server
  // always gives mobile clients a complete, Range-seekable file (a live
  // pipe doesn't play on them at all), so resume and seeking work as
  // plain native video.currentTime - which also means subtitles never
  // need timestamp shifting on mobile.
  const IS_MOBILE_CLIENT = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // pipeMode: true when the CURRENT <video> src is a restart-the-stream
  // live conversion. Recomputed fresh on every loadVideo call (NOT
  // frozen once) because changing quality or audio track mid-session is
  // a direct, deliberate user action that genuinely changes whether
  // transcoding is needed - e.g. switching to 720p on an otherwise
  // directly-playable file requires a real conversion. What was removed
  // is different: a background timer that could silently flip this
  // behavior with NO user action at all (the moment a background cache
  // finished), which made seek behavior unpredictable mid-session in a
  // way that was hard to reason about and, apparently, buggy - a
  // background cache finishing now simply benefits the NEXT time this
  // episode is opened, not silently mid-session.
  let pipeMode = false;
  let loadGeneration = 0; // bumped on every loadVideo call - guards against a stale seek "winning" after a newer one
  // Whenever the file needs transcoding at all, HLS is now the
  // approach - segments become playable as they're generated instead
  // of needing the whole thing done first (the fix for playback never
  // starting on mobile), and it gets desktop genuine native seeking
  // instead of the old restart-the-stream-from-a-new-offset approach.
  const usesHls = transcodeMode;

  async function loadHlsVideo(offsetSeconds, autoplay, isRestart) {
    const myGeneration = ++loadGeneration;
    console.log(`[hls-debug] loadHlsVideo starting, generation ${myGeneration}, offset ${offsetSeconds || 0}, isRestart ${!!isRestart}`);
    reloading = true;
    teardownActiveHlsPlayer();
    // Reset here, not just at initial declaration - this function
    // handles every load, restart, and episode change, so this is the
    // one point guaranteed to run before any of them. Without it, a
    // stale, high value left over from whatever was playing before
    // could wrongly flag a freshly-loaded video's own legitimate low
    // starting position as a phantom reset.
    phantomResetRepeatCount = 0;
    currentAutoLevelHeight = null;
    // Only use offsetSeconds as the actual server-side transcode start
    // point on a genuine restart - not proactively on every load. Progress
    // autosaves every 8 seconds, so a typical re-visit's resume point
    // almost never exactly matches whatever offset an existing,
    // already-running session started at - making the offset part of
    // the cache key unconditionally meant a warm session that used to
    // get reused instantly now got thrown away and restarted from
    // scratch on nearly every single load, which is the actual cause
    // of "videos take longer to load now". A fresh load starts the
    // session at 0 (letting cache reuse work exactly like before) and
    // does a native client-side seek to the resume point once ready -
    // a restart (seekTo landing before the current session's own
    // start, or the network-error escalation after a demonstrated
    // seek failure) is the only time an offset-based session start is
    // actually needed, since only then is it already known a native
    // seek won't work.
    const sessionStartOffset = isRestart ? (offsetSeconds || 0) : 0;
    hlsStreamOffset = sessionStartOffset;
    // Initialized from hlsStreamOffset, not offsetSeconds directly -
    // on a genuine restart these are the same value (the stream itself
    // already starts at the offset, so this is correctly where
    // playback begins), but on a fresh, non-restart resume they are
    // NOT the same: the underlying stream starts at 0 and a separate
    // client-side seek (below, in onReady) is what actually reaches
    // the resume point, which takes real time to land. Using
    // offsetSeconds here instead was a real, confirmed bug - a
    // timeupdate firing before that pending seek completed would read
    // as "dropped from the resume target to 0 with no real seek",
    // misidentifying totally normal, expected startup as a phantom
    // reset and forcing an entirely unnecessary correction or, if it
    // happened twice, a full session restart.
    lastKnownGoodTime = hlsStreamOffset;
    let playlistUrl;
    if (selectedQuality === 'auto') {
      // The master playlist route is stateless (it just lists the
      // applicable variants) - no separate "start" call needed here.
      // Each variant's actual session still only starts lazily, the
      // first time a player requests that specific variant's playlist
      // (via the redirect route on the server), not upfront for all of
      // them just because they're listed.
      playlistUrl = API.getHlsMasterPlaylistUrl(showId, currentEp.relPath, { audio: transcodeMode && selectedAudio != null ? selectedAudio : null, offset: sessionStartOffset || undefined });
      console.log(`[hls-debug] using adaptive master playlist: ${playlistUrl}`);
    } else {
      try {
        const result = await API.startHlsSession(showId, currentEp.relPath, { audio: transcodeMode && selectedAudio != null ? selectedAudio : null, quality: selectedQuality !== 'original' ? selectedQuality : null, offset: sessionStartOffset || undefined });
        playlistUrl = result.playlistUrl;
        console.log(`[hls-debug] session started, playlistUrl: ${playlistUrl}`);
      } catch (e) {
        // Couldn't even start the session (ffmpeg missing, etc.) - fall
        // back to the old direct-transcode approach rather than a hard
        // failure. Not ideal, but better than nothing playing at all.
        console.error('[hls-debug] HLS session failed to start, falling back:', e.message);
        showToast("Couldn't start optimized playback, using fallback");
        return loadLegacyVideo(offsetSeconds, autoplay);
      }
    }
    if (myGeneration !== loadGeneration) {
      console.log(`[hls-debug] generation ${myGeneration} superseded by ${loadGeneration} before setup - aborting this call`);
      return; // a newer load already took over while this was starting
    }

    const onReady = () => {
      console.log(`[hls-debug] onReady fired for generation ${myGeneration} (current: ${loadGeneration})`);
      if (myGeneration !== loadGeneration) return;
      reloading = false;
      // A restart's session already starts at sessionStartOffset on the
      // server, so video.currentTime naturally begins at (or near) 0
      // for THIS session, already the right absolute position once
      // hlsStreamOffset (set above) is accounted for by absoluteTime() -
      // no client-side seek needed. A fresh, non-restart load's session
      // always starts at 0 regardless of offsetSeconds though, so this
      // native seek is exactly what actually gets it to the resume
      // point, same as before offset-based restarts existed at all.
      if (!isRestart && offsetSeconds) video.currentTime = offsetSeconds;
      video.playbackRate = currentSpeed;
      if (autoplay) video.play().catch((e) => console.error('[hls-debug] video.play() rejected:', e.message));
    };

    // canPlayType() can return "maybe" for a format a browser merely
    // hasn't explicitly ruled out, not one it can actually play -
    // Chrome/Edge do exactly this for HLS despite having zero real
    // native support. Only "probably" means genuine, confident
    // support, and only Safari/WebKit actually returns that for HLS -
    // treating "maybe" as truthy here silently handed the video
    // element a format it fundamentally couldn't parse, with no error
    // and no request ever made for it.
    const nativeHlsSupport = video.canPlayType('application/vnd.apple.mpegurl') === 'probably';
    console.log(`[hls-debug] native HLS support: "${nativeHlsSupport}", window.Hls present: ${!!window.Hls}, Hls.isSupported(): ${window.Hls ? window.Hls.isSupported() : 'n/a'}`);

    if (nativeHlsSupport) {
      // Safari (desktop and iOS/iPadOS) has HLS support built directly
      // into the video element - no library needed, just point it at
      // the playlist like any other source.
      video.addEventListener('loadedmetadata', onReady, { once: true });
      console.log(`[hls-debug] setting video.src = ${playlistUrl}`);
      video.src = playlistUrl;
      video.load();
    } else if (window.Hls && window.Hls.isSupported()) {
      console.log('[hls-debug] using hls.js');
      activeHlsPlayer = new window.Hls({
        // "event" playlists (what the server produces) keep growing
        // until the transcode finishes - this tells hls.js to keep
        // re-checking for new segments rather than assuming the first
        // fetch is the complete picture.
        liveSyncDurationCount: 3,
        // The server can take up to 90s to produce a first segment for
        // a known-slow source (AV1 in software decode) - hls.js's own
        // default manifest-load timeout is much shorter than that, so
        // without raising this too, it would give up on the client
        // side long before the server's own longer wait ever mattered.
        manifestLoadingTimeOut: 95000,
        manifestLoadingMaxRetry: 1,
        // Same reasoning extended to individual segment/playlist
        // fetches, not just the initial manifest - confirmed directly
        // from a real error log hitting hls.js's own 10s default here.
        // Checked the server's own segment-serving route to find the
        // actual cause rather than just guessing: it can legitimately
        // wait up to 15s (120s for a known-slow source) for a segment
        // to finish encoding before it even starts responding at all -
        // the previous 10s client timeout could fire before the server
        // even finished its own normal wait, which is exactly what a
        // stall scattered throughout playback (not just at the start)
        // looks like from the client's side.
        fragLoadingTimeOut: 30000,
        levelLoadingTimeOut: 30000,
        // A bigger buffer target gives more cushion built up during
        // good-throughput moments to draw down from when throughput
        // dips, rather than the buffer running dry the instant it does
        // - hls.js's own default (30s) is tuned more for a typical CDN
        // than a single self-hosted server whose available throughput
        // can vary a lot more from one moment to the next.
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
      });
      activeHlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, onReady);
      activeHlsPlayer.on(window.Hls.Events.LEVEL_SWITCHED, (event, data) => {
        const level = activeHlsPlayer.levels && activeHlsPlayer.levels[data.level];
        currentAutoLevelHeight = level ? level.height : null;
        console.log(`[hls-debug] adaptive bitrate switched to level ${data.level}${currentAutoLevelHeight ? ` (${currentAutoLevelHeight}p)` : ''}`);
        if (typeof paintQualityMenu === 'function' && selectedQuality === 'auto') paintQualityMenu();
      });
      let lastNetworkErrorPosition = null;
      let networkErrorRepeatCount = 0;
      activeHlsPlayer.on(window.Hls.Events.ERROR, (event, data) => {
        console.error('[hls-debug] hls.js error event:', data.type, data.details, 'fatal:', data.fatal, 'reason:', data.reason, 'error:', data.error && data.error.message, 'frag:', data.frag && data.frag.url);
        if (data.details === 'bufferStalledError' && !data.fatal && myGeneration === loadGeneration) {
          const nearRecentSeek = lastSeekAt !== null && (Date.now() - lastSeekAt) < 30000;
          if (nearRecentSeek) {
            if (bufferStallStartTime === null) bufferStallStartTime = Date.now();
            const stalledFor = Date.now() - bufferStallStartTime;
            if (stalledFor > 20000) {
              console.error(`[hls-debug] buffer stall ongoing for ${(stalledFor / 1000).toFixed(1)}s near a recent seek (likely landed ahead of the sequential transcode) - escalating to a fresh session at ${absoluteTime().toFixed(1)}`);
              bufferStallStartTime = null;
              loadHlsVideo(absoluteTime(), !video.paused, true);
              return;
            }
          }
        }
        if (!data.fatal || myGeneration !== loadGeneration) return;
        measurements.recordError();
        console.error('hls.js fatal error:', data.type, data.details);
        // Try to recover from the two well-documented recoverable-ish
        // fatal categories before giving up entirely.
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          const pos = video.currentTime;
          // Only even consider escalating to a full restart if this is
          // actually happening near a recent seek - a genuine far-seek
          // (a segment that will never arrive without a restart, since
          // it's well beyond where the sequential transcode currently
          // is) versus completely ordinary buffering (the transcode is
          // only slightly behind real-time and just needs the server's
          // own poll-wait, already built in, to catch up) can look
          // identical from "2 errors near the same position" alone.
          // Gating on recency of an actual seek is what tells these
          // apart - restarting a session that was otherwise working
          // fine, just because of a normal, momentary catch-up delay,
          // risks the new session hitting the same real-time limit
          // again quickly and looping, which is worse than the
          // straightforward retry this used to just rely on.
          const nearRecentSeek = lastSeekAt !== null && (Date.now() - lastSeekAt) < 20000;
          if (nearRecentSeek && lastNetworkErrorPosition !== null && Math.abs(pos - lastNetworkErrorPosition) < 2) {
            networkErrorRepeatCount++;
          } else {
            networkErrorRepeatCount = 1;
          }
          lastNetworkErrorPosition = pos;
          if (nearRecentSeek && networkErrorRepeatCount >= 2) {
            console.error(`[hls-debug] network error repeated near position ${pos} shortly after a seek - escalating to a fresh session at this offset`);
            loadHlsVideo(absoluteTime(), !video.paused, true);
            return;
          }
          // startLoad() with no argument defaults startPosition to -1,
          // which per hls.js's own docs means "start from initialTime=0
          // for VoD" - this is hls.js's own official example recovery
          // code, but on a VoD stream (all this app ever serves) it
          // silently resets playback to the very beginning instead of
          // resuming from wherever it actually was. Explicitly passing
          // the current position is what actually makes this first
          // attempt mean resume, not restart.
          activeHlsPlayer.startLoad(pos);
        }
        else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) activeHlsPlayer.recoverMediaError();
        else { teardownActiveHlsPlayer(); loadLegacyVideo(offsetSeconds, autoplay); }
      });
      console.log(`[hls-debug] calling activeHlsPlayer.loadSource(${playlistUrl}) and attachMedia`);
      activeHlsPlayer.loadSource(playlistUrl);
      activeHlsPlayer.attachMedia(video);
    } else {
      // hls.js itself didn't load (most likely no internet access
      // reaching the CDN it's served from) - fall back rather than a
      // silently broken player.
      console.error('hls.js not available - falling back to direct transcode');
      return loadLegacyVideo(offsetSeconds, autoplay);
    }
    if (currentSubtitleTrack != null) applySubtitle(currentSubtitleTrack);
  }

  function loadLegacyVideo(offsetSeconds, autoplay) {
    const myGeneration = ++loadGeneration;
    reloading = true;
    pipeMode = !IS_MOBILE_CLIENT && isForcedTranscode();
    streamOffset = pipeMode ? (offsetSeconds || 0) : 0;
    // Registered BEFORE load()/src assignment (not after) so there is no
    // window, however unlikely, where metadata could finish loading
    // before the listener is attached to catch it.
    video.addEventListener('loadedmetadata', () => {
      // A newer loadVideo call (another seek fired before this one's
      // metadata arrived) has already taken over - applying THIS call's
      // now-stale offset/autoplay here would yank playback back to
      // wherever this older seek was heading, undoing the real one.
      if (myGeneration !== loadGeneration) return;
      reloading = false;
      if (!pipeMode && offsetSeconds) video.currentTime = offsetSeconds;
      video.playbackRate = currentSpeed;
      if (autoplay) video.play().catch(() => {});
    }, { once: true });
    video.src = buildSrc(streamOffset);
    video.load();
    // Re-attach the active subtitle track re-based to the new stream
    // offset - the old track's cue times belong to the previous
    // offset's timeline and would be wrong from here on.
    if (currentSubtitleTrack != null) applySubtitle(currentSubtitleTrack);
  }

  function loadVideo(offsetSeconds, autoplay) {
    if (usesHls) { loadHlsVideo(offsetSeconds, autoplay); return; }
    teardownActiveHlsPlayer();
    loadLegacyVideo(offsetSeconds, autoplay);
  }

  // ---- Subtitles: independent of audio/transcode, uses sidecar WebVTT ----
  // Rendered with a custom overlay instead of the browser's native ::cue
  // box-drawing, which is how real spacing/gap between simultaneous lines
  // becomes possible - ::cue only supports a narrow set of CSS
  // properties (margin/padding aren't part of its spec and behave
  // inconsistently across browsers), while a real DOM element supports
  // anything. This still uses the browser's own battle-tested WebVTT
  // parser under the hood (via the <track> element's TextTrack API) -
  // only the final drawing step is custom, not the parsing.
  const subOverlay = document.getElementById('customSubOverlay');
  let currentSubtitleTrack = null;
  let songEffectMode;
  try { songEffectMode = localStorage.getItem('ioSongEffectMode') || 'shimmer'; } catch { songEffectMode = 'shimmer'; }
  let subtitleRequest = 0;
  let subtitlesDisposed = false;
  const assPlayer = new window.IOAss(video);
  window.addEventListener('hashchange', () => { subtitlesDisposed = true; subtitleRequest++; assPlayer.clear(); }, { once: true });

  const subOverlayTop = document.getElementById('customSubOverlayTop');

  function softLyric(text) {
    return `<div class="custom-sub-line lyric-soft"><span class="lyric-glint glint-a" aria-hidden="true"></span><span class="lyric-glint glint-b" aria-hidden="true"></span><span class="lyric-words">${escapeHtml(text).replace(/\n/g, '<br>')}</span><span class="lyric-glint glint-c" aria-hidden="true"></span><span class="lyric-glint glint-d" aria-hidden="true"></span></div>`;
  }
  function renderActiveCues() {
    const tt = video.textTracks[0];
    if (!tt || !tt.activeCues || tt.activeCues.length === 0) {
      subOverlay.innerHTML = '';
      subOverlayTop.innerHTML = '';
      return;
    }
    const cues = Array.from(tt.activeCues);
    const songTime = video.currentTime + streamOffset;
    const lyrics = songEffectMode === 'shimmer' ? assPlayer.lyrics.filter(line => songTime >= line.start && songTime < line.end) : [];
    if (lyrics.length) {
      const lines = [...new Set(lyrics.map(line => line.text))];
      const lyricKey = lyrics.map(line => line.start + ':' + line.text).join('|');
      if (subOverlayTop.dataset.lyricKey !== lyricKey || !subOverlayTop.firstChild) {
        subOverlayTop.innerHTML = lines.map(softLyric).join(''); subOverlayTop.dataset.lyricKey = lyricKey;
      }
      const normalize = text => text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const ordinary = cues.filter(cue => !lines.some(line => normalize(line).includes(normalize(cue.text))));
      subOverlay.innerHTML = ordinary.map(cue => `<div class="custom-sub-line">${renderSubtitleCueText(cue.text)}</div>`).join('');
      return;
    }
    // Genuine simultaneous dialogue (two people talking at once) is
    // virtually always just 1-2 unrelated lines. Karaoke-style song
    // lines converted from ASS often end up as several overlapping,
    // very short-lived cues representing a per-syllable highlight
    // progression - a feature VTT has no native way to express - where
    // each fragment's text is the previous one plus a bit more (more of
    // the line getting revealed as it's "sung"). Rendered the same way
    // as normal dialogue, every fragment stacked as its own line and
    // looked like a jumbled word-soup. Two signals catch this: more
    // than a couple simultaneous cues at once, OR - even with just two
    // overlapping - one cue's text being a near-prefix of the other's,
    // which real independent dialogue lines essentially never look
    // like. Either signal treats it as a song line instead: show only
    // the most recently started fragment (the current state, not every
    // historical one), moved to its own region near the top so it
    // never competes for space with real dialogue.
    const looksLikeProgression = cues.length === 2 && (() => {
      const [a, b] = [...cues].sort((x, y) => x.text.length - y.text.length).map((c) => c.text.trim().toLowerCase());
      return a.length > 0 && b.startsWith(a);
    })();
    if (cues.length > 2 || looksLikeProgression) {
      const latest = cues.reduce((a, b) => (b.startTime > a.startTime ? b : a));
      subOverlay.innerHTML = '';
      subOverlayTop.innerHTML = songEffectMode === "shimmer" && looksLikeProgression ? softLyric(latest.text.replace(/<[^>]*>/g, "")) : `<div class="custom-sub-line">${renderSubtitleCueText(latest.text)}</div>`;
    } else {
      subOverlayTop.innerHTML = '';
      subOverlay.innerHTML = cues.map((c) => `<div class="custom-sub-line">${renderSubtitleCueText(c.text)}</div>`).join('');
    }
  }

  async function applySubtitle(trackIndex) {
    const request = ++subtitleRequest;
    currentSubtitleTrack = trackIndex;
    await assPlayer.clear();
    if (subtitlesDisposed || request !== subtitleRequest) return;
    subOverlay.innerHTML = '';
    subOverlayTop.innerHTML = '';
    video.querySelectorAll('track').forEach(t => t.remove());
    if (trackIndex == null) return;
    const selected = streamInfo.subtitleTracks.find(track => track.index === trackIndex);
    if (['ass', 'ssa'].includes(selected?.codec) && !document.pictureInPictureElement) {
      try {
        const loaded = await assPlayer.load({ showId, encodedRelPath, track: trackIndex, offset: streamOffset, soft: songEffectMode === "shimmer" });
        if (loaded || currentSubtitleTrack !== trackIndex) return;
      } catch (error) { if (currentSubtitleTrack === trackIndex) showToast('Styled subtitles unavailable; using basic subtitles. ' + error.message); }
    }
    if (currentSubtitleTrack !== trackIndex) return;
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = trackLabelText(streamInfo.subtitleTracks.find(s => s.index === trackIndex) || {});
    track.srclang = 'und';
    // During a live transcode the video's clock restarts at 0 on every
    // seek (the stream begins at the seek point), so the subtitle file's
    // timestamps are re-based server-side by the same offset - otherwise
    // every cue after a seek is late by exactly the seek amount, which
    // looks like subtitles freezing/disappearing once you jump around.
    const shiftParam = streamOffset > 0 ? `&shift=${streamOffset.toFixed(3)}` : '';
    const subUrl = `/api/subtitle/${showId}/${encodedRelPath}?track=${trackIndex}${shiftParam}`;
    // The browser's own <track> error events are unreliable across
    // browsers for HTTP error statuses, so this checks explicitly
    // instead - this is what surfaces a clear reason (e.g. "this is an
    // image-based format, which can't be displayed") rather than
    // leaving subtitles just silently blank with no indication why.
    fetch(subUrl).then((res) => {
      if (!res.ok) return res.json().catch(() => ({})).then((body) => { throw new Error(body.error || `Couldn't load this subtitle track (${res.status}).`); });
    }).catch((e) => { if (currentSubtitleTrack === trackIndex) showToast(e.message); });
    track.src = subUrl;
    track.default = true;
    // Set synchronously, before this is ever appended to the video -
    // HTMLTrackElement.track (the underlying TextTrack) is available
    // immediately on element creation, not tied to DOM insertion, so
    // there's no need to wait for it. This closes a real race window:
    // Safari requires default=true for this app's own cue-tracking to
    // work at all, and per spec a track's default mode is 'showing'
    // when default is set - so between appending the track and the
    // (necessarily later, since video.textTracks[0] needs the element
    // attached first) point where mode got set to 'hidden' below, the
    // track could genuinely be in 'showing' mode for a moment. Once a
    // browser starts natively rendering a cue, switching mode away
    // later doesn't always cleanly retract what's already drawn -  a
    // concrete, plausible explanation for a duplicate, differently-
    // styled subtitle (the custom overlay plus a leftover native one),
    // and mobile browsers are more likely to lose this particular race
    // than desktop.
    if (track.track) track.track.mode = 'hidden';
    video.appendChild(track);
    setTimeout(() => {
      const tt = video.textTracks[0];
      if (!tt) return;
      // 'hidden' - not 'showing' - is what stops the browser drawing its
      // own boxes while still computing/tracking which cues are active,
      // which the custom overlay above needs. Picture-in-Picture only
      // shows the actual <video> element's own content, not other page
      // elements layered on top of it, so a DOM overlay is invisible
      // there - falling back to native 'showing' specifically while in
      // PiP is what keeps subtitles working in that mode at all.
      tt.mode = document.pictureInPictureElement === video ? 'showing' : 'hidden';
      tt.addEventListener('cuechange', renderActiveCues);
    }, 50);
  }

  video.addEventListener('enterpictureinpicture', () => {
    applySubtitle(currentSubtitleTrack);
    showToast('Picture-in-Picture uses basic subtitles. Return to the player for full song effects.');
    const tt = video.textTracks[0];
    if (tt) tt.mode = 'showing';
    subOverlay.innerHTML = '';
  });
  video.addEventListener('leavepictureinpicture', () => {
    applySubtitle(currentSubtitleTrack);
    const tt = video.textTracks[0];
    if (tt) tt.mode = 'hidden';
  });

  // ==================== Subtitle appearance (size/color) ====================
  // ::cue only works via a real <style> rule (can't be set inline), and it
  // has to target this specific <video> since multiple videos could
  // theoretically exist on the page with different preferences.
  const subStyleTag = document.createElement('style');
  document.head.appendChild(subStyleTag);
  const SUB_SIZES = { small: '1.4vw', medium: '2vw', large: '2.8vw' };
  // Background styles: the browser default is an opaque black box behind
  // every line. "semi" keeps a hint of it for contrast on bright scenes;
  // "none" removes it entirely and instead outlines the glyphs (layered
  // text-shadow in all directions), which is what keeps the text
  // readable over white/bright video without any box at all.
  const SUB_BGS = {
    box: 'background: rgba(0,0,0,0.8);',
    semi: 'background: rgba(0,0,0,0.35);',
    none: 'background: transparent; text-shadow: 1.5px 1.5px 2px #000, -1.5px 1.5px 2px #000, 1.5px -1.5px 2px #000, -1.5px -1.5px 2px #000, 0 0 6px rgba(0,0,0,0.9);',
  };
  function applySubtitleAppearance(size, color, bg) {
    const fontSize = SUB_SIZES[size] || SUB_SIZES.medium;
    const bgRule = SUB_BGS[bg] || SUB_BGS.box;
    // A real DOM element (unlike ::cue) supports every CSS property
    // reliably, including margin/padding/border-radius/gap - which is
    // what actually gives multiple simultaneous lines proper breathing
    // room and a distinct rounded box per line, closer to how
    // Crunchyroll spaces overlapping dialogue.
    const prefs=Store.activeProfile?.experience;
    const subHex=/^#[a-f0-9]{6}$/i.test(color)?color:'#ffffff',subRGB=[1,3,5].map(i=>parseInt(subHex.slice(i,i+2),16)).join(' ');
    const advanced=prefs?`font-family:${prefs.subtitleFont};font-size:calc(${fontSize} * ${prefs.subtitleScale/100});color:rgb(${subRGB} / ${prefs.subtitleOpacity}%);opacity:1;background:rgba(0,0,0,${prefs.subtitleBackgroundOpacity/100});text-shadow:${prefs.subtitleEffect==='outline'?'1px 1px 2px #000,-1px -1px 2px #000,1px -1px 2px #000,-1px 1px 2px #000':prefs.subtitleEffect==='shadow'?'2px 2px 4px #000':'none'};`:'';
    subStyleTag.textContent = `.custom-sub-line { font-size: ${fontSize}; color: ${color || '#ffffff'}; ${bgRule} ${advanced} }`;
  }
  window.addEventListener('hashchange', () => subStyleTag.remove(), { once: true });

  const subSizeSelect = document.getElementById('subSizeSelect');
  const subColorSelect = document.getElementById('subColorSelect');
  const subBgSelect = document.getElementById('subBgSelect');
  const songModeLabel = document.createElement('label');
  songModeLabel.textContent = 'Song effects ';
  const songModeSelect = document.createElement('select');
  songModeSelect.innerHTML = '<option value="shimmer">Soft sparkles · steady text</option><option value="original">Original ASS styling</option>';
  songModeSelect.value = songEffectMode; songModeLabel.appendChild(songModeSelect);
  subBgSelect.parentElement.insertAdjacentElement('afterend', songModeLabel);
  songModeSelect.title = 'Soft sparkles use steady lyric text and subtle side glints. Original mode preserves authored ASS colors and effects.';
  songModeSelect.addEventListener('click', event => event.stopPropagation());
  songModeSelect.addEventListener('change', () => {
    songEffectMode = songModeSelect.value; try { localStorage.setItem('ioSongEffectMode', songEffectMode); } catch {}
    applySubtitle(currentSubtitleTrack);
  });
  if (Store.activeProfile) {
    subSizeSelect.value = Store.activeProfile.subtitleSize || 'medium';
    subColorSelect.value = Store.activeProfile.subtitleColor || '#ffffff';
    subBgSelect.value = Store.activeProfile.subtitleBg || 'box';
  }
  applySubtitleAppearance(subSizeSelect.value, subColorSelect.value, subBgSelect.value);
  function saveSubtitleAppearance() {
    applySubtitleAppearance(subSizeSelect.value, subColorSelect.value, subBgSelect.value);
    if (!Store.activeProfile) return;
    Store.activeProfile.subtitleSize = subSizeSelect.value;
    Store.activeProfile.subtitleColor = subColorSelect.value;
    Store.activeProfile.subtitleBg = subBgSelect.value;
    API.setSubtitleAppearance(Store.activeProfile.id, { size: subSizeSelect.value, color: subColorSelect.value, bg: subBgSelect.value }).catch(() => {});
  }
  for (const sel of [subSizeSelect, subColorSelect, subBgSelect]) {
    sel.addEventListener('change', saveSubtitleAppearance);
    sel.addEventListener('click', (e) => e.stopPropagation());
  }

  // ==================== Bottom control bar ====================
  const ctlPlay = document.getElementById('ctlPlay');
  const ctlSeek = document.getElementById('ctlSeek');
  const ctlCurrentTime = document.getElementById('ctlCurrentTime');
  const ctlDuration = document.getElementById('ctlDuration');
  const ctlMuteBtn = document.getElementById('ctlMuteBtn');
  const ctlVolume = document.getElementById('ctlVolume');
  const ctlFullscreenBtn = document.getElementById('ctlFullscreenBtn');
  const ctlRewindBtn = document.getElementById('ctlRewindBtn');
  const ctlForwardBtn = document.getElementById('ctlForwardBtn');

  // video.play() returns a promise that rejects if there's genuinely no
  // playable source yet (a real possibility with HLS, where the source
  // gets set up asynchronously) - left uncaught, that shows up as a
  // confusing raw browser error with no context. This gives it
  // somewhere to go, and only surfaces something to the person if
  // playback is still actually loading (rather than every rejection,
  // e.g. a deliberate pause happening to race with this).
  function togglePlayPause() {
    if (!video.paused) { video.pause(); return; }
    video.play().catch((e) => {
      if (reloading) showToast('Still loading - try again in a moment');
      else console.error('Playback failed:', e.message);
    });
  }

  ctlPlay.addEventListener('click', togglePlayPause);
  video.addEventListener('play', () => { ctlPlay.innerHTML = PLAYER_ICONS.pause; });
  video.addEventListener('pause', () => { ctlPlay.innerHTML = PLAYER_ICONS.play; });
  video.addEventListener('click', togglePlayPause);

  function seekTo(target) {
    target = Math.max(0, Math.min(totalDuration() || target, target));
    if (pipeMode) { loadVideo(target, true); return; } // restart-the-stream from the seek point
    if (usesHls) {
      lastSeekAt = Date.now();
      bufferStallStartTime = null;
      const relative = target - hlsStreamOffset;
      if (relative < 0) {
        // Before this session's own start - there's genuinely nothing
        // here for it to seek to (that portion of the file was never
        // transcoded by this particular session), not just a segment
        // that hasn't finished generating yet. Needs a fresh session
        // starting from the new target instead.
        loadHlsVideo(target, !video.paused, true);
      } else {
        video.currentTime = relative;
      }
      return;
    }
    video.currentTime = target; // direct file or already-cached copy - native seeking just works
  }
  ctlRewindBtn.addEventListener('click', () => seekTo(absoluteTime() - 10));
  ctlForwardBtn.addEventListener('click', () => seekTo(absoluteTime() + 10));

  let seekDragging = false;
  ctlSeek.addEventListener('input', () => {
    seekDragging = true;
    ctlCurrentTime.textContent = fmtClock(parseFloat(ctlSeek.value));
  });
  // ==================== Trickplay seek previews ====================
  // Fetched in the background once playback is underway - the first
  // request per episode triggers the one-time sprite build server-side,
  // so previews just appear when ready and never delay playback itself.
  let trickplayMeta = null;
  API.getTrickplay(showId, relPath).then((m) => { trickplayMeta = m; }).catch(() => {});
  const seekPreview = document.getElementById('seekPreview');
  const seekPreviewImg = document.getElementById('seekPreviewImg');
  const seekPreviewTime = document.getElementById('seekPreviewTime');
  function showSeekPreview(clientX) {
    if (!trickplayMeta || !totalDuration()) return;
    const rect = ctlSeek.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t = frac * totalDuration();
    const idx = Math.min(trickplayMeta.count - 1, Math.floor(t / trickplayMeta.interval));
    const col = idx % trickplayMeta.cols;
    const row = Math.floor(idx / trickplayMeta.cols);
    seekPreviewImg.style.width = trickplayMeta.thumbWidth + 'px';
    seekPreviewImg.style.height = trickplayMeta.thumbHeight + 'px';
    seekPreviewImg.style.backgroundImage = `url(${trickplayMeta.sprite})`;
    seekPreviewImg.style.backgroundPosition = `-${col * trickplayMeta.thumbWidth}px -${row * trickplayMeta.thumbHeight}px`;
    seekPreviewTime.textContent = fmtClock(t);
    seekPreview.style.display = 'block';
    // clamp the bubble inside the bar's width
    const half = (trickplayMeta.thumbWidth + 8) / 2;
    const x = Math.min(rect.width - half, Math.max(half, clientX - rect.left));
    seekPreview.style.left = x + 'px';
  }
  ctlSeek.addEventListener('mousemove', (e) => showSeekPreview(e.clientX));
  ctlSeek.addEventListener('mouseleave', () => { seekPreview.style.display = 'none'; });
  ctlSeek.addEventListener('touchmove', (e) => { if (e.touches[0]) showSeekPreview(e.touches[0].clientX); }, { passive: true });
  ctlSeek.addEventListener('touchend', () => { seekPreview.style.display = 'none'; });

  ctlSeek.addEventListener('change', () => {
    seekDragging = false;
    seekTo(parseFloat(ctlSeek.value));
  });

  video.addEventListener('timeupdate', () => {
    if (seekDragging || reloading || !usesHls) return;
    const abs = absoluteTime();
    video.dataset.ioAbsoluteTime=String(abs);video.dataset.ioDuration=String(totalDuration());
    const recentRealSeek = lastSeekAt !== null && (Date.now() - lastSeekAt) < 3000;
    if (recentRealSeek) {
      // A real seek just happened - this drop is expected, not a
      // phantom reset. Resync the baseline to wherever it actually
      // landed instead of comparing against the pre-seek position.
      lastKnownGoodTime = abs;
    } else if (abs > lastKnownGoodTime) {
      lastKnownGoodTime = abs;
      phantomResetRepeatCount = 0;
    } else if (lastKnownGoodTime - abs > 5) {
      // currentTime dropped significantly with no real seek behind it -
      // native HLS's own internal recovery quietly restarting itself
      // from the beginning is the only thing that produces this. There's
      // no error event to react to here the way hls.js has; this drop
      // itself is the only signal available at all.
      phantomResetRepeatCount++;
      console.log(`[hls-debug] native HLS phantom reset detected: dropped from ${lastKnownGoodTime.toFixed(1)} to ${abs.toFixed(1)} with no real seek (repeat count ${phantomResetRepeatCount})`);
      if (phantomResetRepeatCount >= 2) {
        // Happened again at roughly the same spot - a direct correction
        // alone isn't holding, so escalate to the same offset-based
        // session restart already proven for the hls.js path, rather
        // than repeating a correction that clearly isn't working.
        console.log(`[hls-debug] phantom reset repeated - escalating to a fresh session at ${lastKnownGoodTime.toFixed(1)}`);
        phantomResetRepeatCount = 0;
        loadHlsVideo(lastKnownGoodTime, !video.paused, true);
      } else {
        video.currentTime = lastKnownGoodTime - hlsStreamOffset;
      }
    }
  });
  video.addEventListener('timeupdate', () => {
    if (seekDragging || reloading) return;
    const abs = absoluteTime();
    ctlSeek.value = abs;
    ctlCurrentTime.textContent = fmtClock(abs);
    updateSkipButtons(abs);
  });
  video.addEventListener('loadedmetadata', () => {
    const dur = totalDuration();
    ctlSeek.max = dur || 100;
    ctlDuration.textContent = fmtClock(dur);
  });

  ctlMuteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    ctlMuteBtn.innerHTML = video.muted ? PLAYER_ICONS.volumeMuted : PLAYER_ICONS.volumeHigh;
    ctlVolume.value = video.muted ? 0 : video.volume;
  });
  ctlVolume.addEventListener('input', () => {
    video.volume = parseFloat(ctlVolume.value);
    video.muted = video.volume === 0;
    ctlMuteBtn.innerHTML = video.muted ? PLAYER_ICONS.volumeMuted : PLAYER_ICONS.volumeHigh;
  });

  function isFullscreen() {
    return document.fullscreenElement || document.webkitFullscreenElement;
  }
  ctlFullscreenBtn.addEventListener('click', () => {
    // Fullscreen the whole player container (video + controls), not just
    // the <video> element - fullscreening the video alone hides every
    // sibling element (including this control bar) outside the browser's
    // native video chrome, which is why track/quality pickers used to
    // become unreachable once you went fullscreen.
    if (!isFullscreen()) {
      (playerContainer.requestFullscreen || playerContainer.webkitRequestFullscreen).call(playerContainer);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
  });
  document.addEventListener('fullscreenchange', () => {
    ctlFullscreenBtn.innerHTML = isFullscreen() ? PLAYER_ICONS.fullscreenClose : PLAYER_ICONS.fullscreenOpen;
  });

  // ==================== Cast to TV (AirPlay / Chromecast) ====================
  // Two entirely separate browser APIs, so this checks for and uses
  // whichever the current browser actually supports. Both are optional -
  // the button only appears once we can confirm one of them is real.
  const ctlCastBtn = document.getElementById('ctlCastBtn');
  let castContext = null;

  function hasAirPlay() {
    return typeof video.webkitShowPlaybackTargetPicker === 'function';
  }
  function hasChromecast() {
    return !!(window.chrome && window.chrome.cast && window.chrome.cast.isAvailable && window.cast && window.cast.framework);
  }
  function showCastButtonIfAvailable() {
    if (hasAirPlay() || hasChromecast()) ctlCastBtn.style.display = 'flex';
  }
  showCastButtonIfAvailable();
  // The Chromecast SDK loads asynchronously and calls this global when
  // ready - it may well finish loading well after this player already
  // rendered, so the button needs to be able to appear late too.
  const previousGCastCallback = window.__onGCastApiAvailable;
  window.__onGCastApiAvailable = (isAvailable) => {
    if (typeof previousGCastCallback === 'function') previousGCastCallback(isAvailable);
    if (isAvailable) {
      cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      showCastButtonIfAvailable();
    }
  };

  ctlCastBtn.addEventListener('click', async () => {
    if (hasChromecast()) {
      try {
        castContext = cast.framework.CastContext.getInstance();
        await castContext.requestSession();
        const session = castContext.getCurrentSession();
        if (!session) return;
        const mediaInfo = new chrome.cast.media.MediaInfo(video.currentSrc || video.src, 'video/mp4');
        mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
        mediaInfo.metadata.title = `${show.title} - ${currentEp.title}`;
        const request = new chrome.cast.media.LoadRequest(mediaInfo);
        request.currentTime = absoluteTime();
        await session.loadMedia(request);
        video.pause();
        showToast('Casting to TV');
      } catch (e) {
        if (e !== 'cancel') showToast("Couldn't start casting");
      }
    } else if (hasAirPlay()) {
      video.webkitShowPlaybackTargetPicker();
    }
  });

  // ==================== Watch Party ====================
  const ctlWatchPartyBtn = document.getElementById('ctlWatchPartyBtn');
  let watchPartySocket = null;
  let watchPartyIsHost = false;
  let watchPartyCode = null;
  let applyingRemoteSync = false; // guards against a locally-applied remote sync re-triggering our own play/pause listeners

  function wsProtocol() { return location.protocol === 'https:' ? 'wss:' : 'ws:'; }

  function watchPartyBannerHTML() {
    return `<div class="watch-party-banner" id="watchPartyBanner">
      <span>${PLAYER_ICONS.people}</span>
      <span id="watchPartyBannerText">Watch Party &middot; ${escapeHtml(watchPartyCode)}</span>
      <button id="watchPartyLeaveBtn" title="Leave Watch Party">&times;</button>
    </div>`;
  }

  function showWatchPartyBanner() {
    let el = document.getElementById('watchPartyBanner');
    if (!el) {
      document.getElementById('playerContainer').insertAdjacentHTML('beforeend', watchPartyBannerHTML());
      document.getElementById('watchPartyLeaveBtn').addEventListener('click', leaveWatchParty);
    } else {
      document.getElementById('watchPartyBannerText').textContent = `Watch Party \u00b7 ${watchPartyCode}`;
    }
  }

  function leaveWatchParty() {
    if (watchPartySocket) watchPartySocket.close();
    watchPartySocket = null;
    watchPartyCode = null;
    watchPartyIsHost = false;
    const el = document.getElementById('watchPartyBanner');
    if (el) el.remove();
  }

  function connectWatchPartySocket(roomCode) {
    const socket = new WebSocket(`${wsProtocol()}//${location.host}/api/watch-party/ws`);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'join', roomCode, profileName: (Store.activeProfile && Store.activeProfile.name) || 'Someone' }));
    });
    socket.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === 'error') { showToast(msg.message); leaveWatchParty(); return; }
      if (msg.type === 'joined') {
        watchPartyIsHost = msg.isHost;
        watchPartyCode = roomCode;
        showWatchPartyBanner();
        showToast(watchPartyIsHost ? `Watch party started \u00b7 share code ${roomCode}` : 'Joined the watch party');
      } else if (msg.type === 'roster') {
        const el = document.getElementById('watchPartyBannerText');
        if (el) el.textContent = `Watch Party \u00b7 ${watchPartyCode} \u00b7 ${msg.participants.length} watching`;
      } else if (msg.type === 'sync' && !watchPartyIsHost) {
        // Only a non-host ever applies an incoming sync - the host is
        // the one whose actions this whole thing is built to mirror,
        // so it should never adjust its own playback in response to
        // what it just sent out itself.
        applyingRemoteSync = true;
        if (Math.abs(video.currentTime - msg.time) > 1.5) video.currentTime = msg.time; // small gaps are normal network jitter, not worth a visible seek every time
        if (msg.action === 'play') video.play().catch(() => {});
        else if (msg.action === 'pause') video.pause();
        setTimeout(() => { applyingRemoteSync = false; }, 300);
      }
    });
    socket.addEventListener('close', () => { if (watchPartySocket === socket) leaveWatchParty(); });
    watchPartySocket = socket;
  }

  async function startWatchParty() {
    try {
      const { roomCode } = await API.createWatchParty(showId, currentEp.relPath);
      connectWatchPartySocket(roomCode);
    } catch (e) { showToast("Couldn't start watch party"); }
  }

  async function joinWatchPartyByCode(codeRaw) {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return;
    let info;
    try { info = await API.getWatchPartyInfo(code); } catch (e) { showToast(e.message || 'Watch party not found'); return; }
    if (info.showId === showId && info.relPath === currentEp.relPath) {
      connectWatchPartySocket(code);
    } else {
      // The party's watching something else - carry the join across
      // the page navigation to that episode's own player, since
      // joining and that page actually loading are two separate steps.
      sessionStorage.setItem('pendingWatchPartyJoin', code);
      location.hash = `#/watch/${info.showId}/${encodeURIComponent(info.relPath)}`;
    }
  }

  ctlWatchPartyBtn.addEventListener('click', () => {
    if (watchPartyCode) { showToast(`Already in a watch party \u00b7 code ${watchPartyCode}`); return; }
    const choice = prompt('Enter a watch party code to join, or leave blank and press OK to start a new one:');
    if (choice === null) return; // cancelled
    if (choice.trim()) joinWatchPartyByCode(choice);
    else startWatchParty();
  });

  const pendingJoin = sessionStorage.getItem('pendingWatchPartyJoin');
  if (pendingJoin) {
    sessionStorage.removeItem('pendingWatchPartyJoin');
    connectWatchPartySocket(pendingJoin);
  }

  video.addEventListener('play', () => {
    if (watchPartyIsHost && watchPartySocket && !applyingRemoteSync) watchPartySocket.send(JSON.stringify({ type: 'sync', action: 'play', time: video.currentTime }));
  });
  video.addEventListener('pause', () => {
    if (watchPartyIsHost && watchPartySocket && !applyingRemoteSync) watchPartySocket.send(JSON.stringify({ type: 'sync', action: 'pause', time: video.currentTime }));
  });
  video.addEventListener('seeked', () => {
    if (watchPartyIsHost && watchPartySocket && !applyingRemoteSync) watchPartySocket.send(JSON.stringify({ type: 'sync', action: video.paused ? 'pause' : 'play', time: video.currentTime }));
  });
  window.addEventListener('hashchange', leaveWatchParty, { once: true });

  // ==================== Picture-in-Picture ====================
  const ctlPipBtn = document.getElementById('ctlPipBtn');
  if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
    ctlPipBtn.style.display = 'flex';
    ctlPipBtn.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch (e) { /* browser refused (e.g. not playing yet) - nothing to do */ }
    });
  }

  // ==================== Keyboard shortcuts ====================
  // Space/K play-pause, arrows seek 10s / volume, F fullscreen, M mute -
  // the standard set every big streaming player supports. Ignored while
  // typing in any field, and unregistered when leaving the player page
  // so handlers never stack up across navigations.
  function onPlayerKey(e) {
    if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case ' ': case 'k': case 'K':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekTo(Math.max(0, absoluteTime() - 10));
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekTo(Math.min(totalDuration() || Infinity, absoluteTime() + 10));
        break;
      case 'ArrowUp':
        e.preventDefault();
        video.muted = false;
        video.volume = Math.min(1, video.volume + 0.1);
        ctlVolume.value = video.volume;
        ctlMuteBtn.innerHTML = PLAYER_ICONS.volumeHigh;
        break;
      case 'ArrowDown':
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        video.muted = video.volume === 0;
        ctlVolume.value = video.volume;
        ctlMuteBtn.innerHTML = video.muted ? PLAYER_ICONS.volumeMuted : PLAYER_ICONS.volumeHigh;
        break;
      case 'f': case 'F':
        e.preventDefault();
        ctlFullscreenBtn.click();
        break;
      case 'm': case 'M':
        e.preventDefault();
        ctlMuteBtn.click();
        break;
    }
  }
  document.addEventListener('keydown', onPlayerKey);
  window.addEventListener('hashchange', () => document.removeEventListener('keydown', onPlayerKey), { once: true });

  // Auto-hide the chrome (top bar + controls bar) after a few seconds of
  // no interaction while playing, like any normal video player. Includes
  // touch listeners since mousemove never fires on phones/tablets.
  let hideTimer;
  function showChrome() {
    playerContainer.classList.remove('chrome-hidden');
    clearTimeout(hideTimer);
    const anyPopupOpen = document.querySelector('.ctl-popup.open, .io-settings-panel.open') || ccPanelOverlay.classList.contains('open');
    if (!video.paused && !anyPopupOpen) hideTimer = setTimeout(() => playerContainer.classList.add('chrome-hidden'), 4000);
  }
  playerContainer.addEventListener('mousemove', showChrome);
  playerContainer.addEventListener('touchstart', showChrome, { passive: true });
  playerContainer.addEventListener('click', showChrome);
  video.addEventListener('play', showChrome);
  video.addEventListener('pause', showChrome);

  // ==================== Small dropdown popups (speed / quality) ====================
  function wirePopupMenu(wrapId, btnId, popupId) {
    const wrap = document.getElementById(wrapId);
    const btn = document.getElementById(btnId);
    const popup = document.getElementById(popupId);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showChrome();
      const isOpen = popup.classList.contains('open');
      document.querySelectorAll('.ctl-popup.open').forEach(p => p.classList.remove('open'));
      ccPanelOverlay.classList.remove('open');
      ctlCCBtn && ctlCCBtn.classList.remove('ctl-btn-active');
      if (!isOpen) popup.classList.add('open');
    });
    return { wrap, btn, popup };
  }
  document.addEventListener('click', () => {
    document.querySelectorAll('.ctl-popup.open').forEach(p => p.classList.remove('open'));
  });

  // -- Playback speed --
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  let currentSpeed = 1;
  const speedMenu = wirePopupMenu('speedMenuWrap', 'ctlSpeedBtn', 'speedPopup');
  function paintSpeedMenu() {
    speedMenu.popup.innerHTML = speeds.map(s =>
      `<button class="ctl-popup-item ${s === currentSpeed ? 'active' : ''}" data-s="${s}">${s}x${s === 1 ? ' (Normal)' : ''}</button>`
    ).join('');
    speedMenu.popup.querySelectorAll('.ctl-popup-item').forEach(item => {
      item.addEventListener('click', () => {
        currentSpeed = parseFloat(item.dataset.s);
        video.playbackRate = currentSpeed;
        document.getElementById('ctlSpeedBtn').textContent = `${currentSpeed}x`;
        speedMenu.popup.classList.remove('open');
        paintSpeedMenu();
      });
    });
  }
  paintSpeedMenu();

  // -- Quality (housed under the settings gear) --
  const qualityMenu = wirePopupMenu('settingsMenuWrap', 'ctlSettingsBtn', 'qualityPopup');

  // -- Skip points editor --
  const skipPointsMenu = wirePopupMenu('skipPointsMenuWrap', 'ctlSkipPointsBtn', 'skipPointsPopup');
  let pendingSkipPoints = {
    introStart: show.skipIntro ? show.skipIntro.start : null,
    introEnd: show.skipIntro ? show.skipIntro.end : null,
    outroStart: show.skipOutro ? show.skipOutro.start : null,
  };
  function paintSkipPointsMenu() {
    const row = (label, key) => `
      <div class="skip-points-row">
        <span>${label}</span>
        <span class="skip-points-value">${pendingSkipPoints[key] != null ? fmtClock(pendingSkipPoints[key]) : '&mdash;'}</span>
        <button class="ctl-popup-item skip-points-set-btn" data-key="${key}">Set to current</button>
      </div>`;
    skipPointsMenu.popup.innerHTML = `
      <div class="skip-points-title">Skip Points for this show</div>
      ${row('Intro start', 'introStart')}
      ${row('Intro end', 'introEnd')}
      ${row('Outro start', 'outroStart')}
      <div class="skip-points-actions">
        <button class="ctl-popup-item" id="skipPointsClearBtn">Clear all</button>
        <button class="ctl-popup-item skip-points-save-btn" id="skipPointsSaveBtn">Save</button>
      </div>`;
    skipPointsMenu.popup.querySelectorAll('.skip-points-set-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        pendingSkipPoints[btn.dataset.key] = video.currentTime;
        paintSkipPointsMenu();
      });
    });
    document.getElementById('skipPointsClearBtn').addEventListener('click', () => {
      pendingSkipPoints = { introStart: null, introEnd: null, outroStart: null };
      paintSkipPointsMenu();
    });
    document.getElementById('skipPointsSaveBtn').addEventListener('click', async () => {
      try {
        const result = await API.saveSkipPoints(showId, {
          introStart: pendingSkipPoints.introStart,
          introEnd: pendingSkipPoints.introEnd,
          outroStart: pendingSkipPoints.outroStart,
          outroEnd: pendingSkipPoints.outroStart != null ? video.duration : null,
        });
        show.skipIntro = result.skipIntro;
        show.skipOutro = result.skipOutro;
        if (typeof skipWindows !== 'undefined') {
          skipWindows.skipIntro = result.skipIntro;
          skipWindows.skipOutro = result.skipOutro;
        }
        skipPointsMenu.popup.classList.remove('open');
        showToast('Skip points saved');
      } catch (e) {
        showToast(e.message || "Couldn't save skip points");
      }
    });
  }
  paintSkipPointsMenu();

  const qualityTiers = [1080, 720, 480, 360, 240].filter(h => streamInfo.videoHeight && h < streamInfo.videoHeight);
  if (streamInfo.ffmpegAvailable && (qualityTiers.length > 0 || usesHls)) {
    document.getElementById('settingsMenuWrap').style.display = 'flex';
    function paintQualityMenu() {
      const originalLabel = `Original${streamInfo.videoHeight ? ` (${streamInfo.videoHeight}p)` : ''}`;
      const autoOption = usesHls ? `<button class="ctl-popup-item ${selectedQuality === 'auto' ? 'active' : ''}" data-q="auto">Auto${selectedQuality === 'auto' && currentAutoLevelHeight ? ` (${currentAutoLevelHeight}p)` : ''}</button>` : '';
      qualityMenu.popup.innerHTML = autoOption + `<button class="ctl-popup-item ${selectedQuality === 'original' ? 'active' : ''}" data-q="original">${originalLabel}</button>` +
        qualityTiers.map(h => `<button class="ctl-popup-item ${selectedQuality === String(h) ? 'active' : ''}" data-q="${h}">${h}p</button>`).join('');
      qualityMenu.popup.querySelectorAll('.ctl-popup-item').forEach(item => {
        item.addEventListener('click', () => {
          selectedQuality = item.dataset.q;
          qualityMenu.popup.classList.remove('open');
          paintQualityMenu();
          loadVideo(absoluteTime(), true);
        });
      });
    }
    paintQualityMenu();
  }

  if (streamInfo.ffmpegAvailable && !streamInfo.canPassthrough && streamInfo.audioTracks.length <= 1) {
    document.getElementById('fixBadge').innerHTML = '&#9881; Audio fixed for playback';
    document.getElementById('fixBadge').style.display = 'inline-block';
  }
  if (!streamInfo.ffmpegAvailable) {
    // Without ffprobe on the server, we can't inspect the file at all, so
    // audio-track/subtitle/quality selection is unavailable no matter what
    // the file actually contains. Say so, rather than silently showing
    // nothing and leaving it looking like a bug.
    const badge = document.getElementById('fixBadge');
    badge.textContent = '\u26A0 FFmpeg not detected \u2013 audio/subtitle/quality selection unavailable';
    badge.style.display = 'inline-block';
  }

  // ==================== Combined Audio + Subtitles/CC panel ====================
  const ccMenuWrap = document.getElementById('ccMenuWrap');
  const ctlCCBtn = document.getElementById('ctlCCBtn');
  const ccPanelOverlay = document.getElementById('ccPanelOverlay');
  const ccAudioList = document.getElementById('ccAudioList');
  const ccSubList = document.getElementById('ccSubList');
  const hasAudioChoices = streamInfo.audioTracks.length > 1;

  if (streamInfo.audioTracks.length > 0 || streamInfo.subtitleTracks.length > 0) {
    ccMenuWrap.style.display = 'flex';

    function paintCCPanel() {
      ccAudioList.innerHTML = streamInfo.audioTracks.length
        ? streamInfo.audioTracks.map(t => `
          <button class="cc-item ${!hasAudioChoices ? 'cc-item-single' : ''} ${t.index === selectedAudio ? 'active' : ''}" data-idx="${t.index}">
            <span>${escapeHtml(trackLabelText(t))}</span>
            <span class="cc-check">${t.index === selectedAudio ? PLAYER_ICONS.check : ''}</span>
          </button>`).join('')
        : `<div class="cc-empty">No audio info available</div>`;

      ccSubList.innerHTML =
        `<button class="cc-item ${selectedSubtitle == null ? 'active' : ''}" data-idx="">
           <span>Off</span><span class="cc-check">${selectedSubtitle == null ? PLAYER_ICONS.check : ''}</span>
         </button>` +
        streamInfo.subtitleTracks.map(t => `
          <button class="cc-item ${t.index === selectedSubtitle ? 'active' : ''}" data-idx="${t.index}">
            <span>${escapeHtml(trackLabelText(t))}</span>
            <span class="cc-check">${t.index === selectedSubtitle ? PLAYER_ICONS.check : ''}</span>
          </button>`).join('');

      if (hasAudioChoices) {
        ccAudioList.querySelectorAll('.cc-item').forEach(item => {
          item.addEventListener('click', () => {
            selectedAudio = parseInt(item.dataset.idx, 10);
            loadVideo(absoluteTime(), true);
            paintCCPanel();
            if (Store.activeProfile) {
              const track = streamInfo.audioTracks.find((t) => t.index === selectedAudio);
              if (track) {
                Store.activeProfile.preferredAudioLang = track.language;
                API.setLanguagePreferences(Store.activeProfile.id, { audioLang: track.language }).catch(() => {});
              }
            }
          });
        });
      }
      ccSubList.querySelectorAll('.cc-item').forEach(item => {
        item.addEventListener('click', () => {
          selectedSubtitle = item.dataset.idx ? parseInt(item.dataset.idx, 10) : null;
          applySubtitle(selectedSubtitle);
          paintCCPanel();
          if (Store.activeProfile) {
            const track = streamInfo.subtitleTracks.find((t) => t.index === selectedSubtitle);
            const lang = track ? track.language : 'off';
            Store.activeProfile.preferredSubtitleLang = lang;
            API.setLanguagePreferences(Store.activeProfile.id, { subtitleLang: lang }).catch(() => {});
          }
        });
      });
    }
    paintCCPanel();

    ctlCCBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showChrome();
      const isOpen = ccPanelOverlay.classList.contains('open');
      document.querySelectorAll('.ctl-popup.open').forEach(p => p.classList.remove('open'));
      ccPanelOverlay.classList.toggle('open', !isOpen);
      ctlCCBtn.classList.toggle('ctl-btn-active', !isOpen);
    });
    document.getElementById('ccPanel').addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('click', () => {
    ccPanelOverlay.classList.remove('open');
    ctlCCBtn.classList.remove('ctl-btn-active');
  });

  ioConfigurePlayer(root, streamInfo.chapters || [], seekTo);
  showChrome();

  // ==================== Up Next overlay ====================
  const autoplayEnabled = !options.live && (!Store.activeProfile || Store.activeProfile.autoplayNext !== false);
  const nextEpOverlay = document.getElementById('nextEpOverlay');
  let upNextShown = false; // prevents re-triggering once dismissed/navigated for this episode
  let upNextTimer = null;
  let upNextCountdown = 10;

  function goToNextEpisode() {
    if (nextEp) location.hash = `#/watch/${showId}/${encodeURIComponent(nextEp.relPath)}`;
  }

  if (nextEp && autoplayEnabled && nextEpOverlay) {
    const countdownEl = document.getElementById('nextEpCountdown');
    const playBtn = document.getElementById('nextEpPlayBtn');
    const cancelBtn = document.getElementById('nextEpCancelBtn');

    const progressBar = document.getElementById('nextEpProgressBar');
    function stopUpNextTimer() { clearInterval(upNextTimer); upNextTimer = null; }
    function showUpNext() {
      if (upNextShown) return;
      upNextShown = true;
      upNextCountdown = 10;
      countdownEl.textContent = `(${upNextCountdown})`;
      nextEpOverlay.style.display = 'flex';
      if (progressBar) {
        progressBar.classList.remove('counting');
        void progressBar.offsetWidth; // forces a reflow, so the class removal above is actually committed before re-adding it below - otherwise the browser can batch both together and the transition never visibly replays
        progressBar.classList.add('counting');
      }
      upNextTimer = setInterval(() => {
        upNextCountdown--;
        countdownEl.textContent = `(${upNextCountdown})`;
        if (upNextCountdown <= 0) {
          stopUpNextTimer();
          goToNextEpisode();
        }
      }, 1000);
    }
    function dismissUpNext() {
      stopUpNextTimer();
      nextEpOverlay.style.display = 'none';
      if (progressBar) progressBar.classList.remove('counting');
    }
    playBtn.addEventListener('click', () => { stopUpNextTimer(); goToNextEpisode(); });
    cancelBtn.addEventListener('click', dismissUpNext);

    video.addEventListener('timeupdate', () => {
      if (reloading || upNextShown) return;
      const remaining = totalDuration() - absoluteTime();
      if (remaining > 0 && remaining <= 10) showUpNext();
    });
    window.addEventListener('hashchange', stopUpNextTimer, { once: true });
  }

  // ==================== Skip Intro / Skip Outro ====================
  let skipWindows = computeSkipWindows(show, streamInfo.duration);
  const skipIntroBtn = document.getElementById('skipIntroBtn');
  const skipOutroBtn = document.getElementById('skipOutroBtn');
  function updateSkipButtons(t) {
    const { skipIntro, skipOutro } = skipWindows;
    skipIntroBtn.style.display = (Store.activeProfile?.experience?.showIntro!==false && skipIntro && t >= skipIntro.start && t < skipIntro.end) ? 'block' : 'none';
    skipOutroBtn.style.display = (Store.activeProfile?.experience?.showOutro!==false && skipOutro && skipOutro.end != null && t >= skipOutro.start && t < skipOutro.end && !upNextShown) ? 'block' : 'none';
  }
  skipIntroBtn.addEventListener('click', () => seekTo(skipWindows.skipIntro.end));
  skipOutroBtn.addEventListener('click', () => {
    if (nextEp) {
      location.hash = `#/watch/${showId}/${encodeURIComponent(nextEp.relPath)}`;
    } else {
      seekTo(skipWindows.skipOutro.end || totalDuration());
    }
  });
  // Recompute once we actually know the duration (transcode mode already
  // has it from streaminfo; passthrough mode only learns it once metadata loads).
  video.addEventListener('loadedmetadata', () => {
    skipWindows = computeSkipWindows(show, totalDuration());
  }, { once: true });

  // ==================== Playback error handling ====================
  // Shows a clear in-player explanation instead of leaving a black screen
  // (or the browser's own cryptic error) when a file genuinely can't be
  // played - e.g. a codec the device can't decode and the server has no
  // FFmpeg installed to convert it, or FFmpeg itself failing partway
  // through a transcode.
  const errorBanner = document.getElementById('playerErrorBanner');
  const errorText = document.getElementById('playerErrorText');
  document.getElementById('playerErrorDismiss').addEventListener('click', () => {
    errorBanner.style.display = 'none';
  });
  video.addEventListener('error', () => {
    if (reloading) return; // a normal src swap (seek/track change) also fires 'error' transiently
    const code = video.error && video.error.code;
    // MEDIA_ERR_DECODE (3) / MEDIA_ERR_SRC_NOT_SUPPORTED (4) mean the
    // browser genuinely can't decode this file's codec.
    const isCodecIssue = code === 3 || code === 4;
    let message;
    if (isCodecIssue && !streamInfo.ffmpegAvailable) {
      message = "This device can't decode this video's format, and the server doesn't have FFmpeg installed to convert it. Try a different device/browser, or install FFmpeg on the server for automatic compatibility conversion.";
    } else if (isCodecIssue) {
      message = "This device can't decode this video's format. FFmpeg attempted to convert it, but playback still failed - try a different device or browser, or check the server logs for the FFmpeg error.";
    } else {
      message = 'Playback failed unexpectedly. Try refreshing, or check the server logs for details.';
    }
    errorText.textContent = message;
    errorBanner.style.display = 'flex';
    showChrome();
  });


  // ==================== Progress saving ====================
  let saveTimer = setInterval(saveProgress, 8000);
  let autoMarkedWatched = false;
  let precacheFired = false;
  function saveProgress() {
    if (options.live || !Store.activeProfile || reloading || !totalDuration()) return;
    API.setProgress(Store.activeProfile.id, showId, relPath, absoluteTime(), totalDuration()).catch(() => {});
    // Halfway through, quietly ask the server to start preparing the
    // next episode's cached copy in the background, so "Next Episode"
    // (and autoplay) starts instantly instead of waiting on a fresh
    // conversion - best-effort, fires once per episode.
    if (!precacheFired && nextEp && absoluteTime() / totalDuration() >= 0.5) {
      precacheFired = true;
      API.precacheEpisode(showId, nextEp.relPath, selectedQuality, isIpadMasqueradingAsDesktop ? 'ipad' : null).catch(() => {});
    }
    if (!autoMarkedWatched && absoluteTime() / totalDuration() >= 0.9) {
      autoMarkedWatched = true;
      API.markWatched(Store.activeProfile.id, showId, 'anime', relPath, currentEp.title, totalDuration()).then(() => {
        Store.activeProfile.watchedEpisodes = Store.activeProfile.watchedEpisodes || [];
        const key = `${showId}:${relPath}`;
        if (!Store.activeProfile.watchedEpisodes.includes(key)) Store.activeProfile.watchedEpisodes.push(key);
      }).catch(() => {});
    }
  }
  video.addEventListener('ended', () => {
    if (options.live) { options.onEnded?.(); return; }
    if (nextEp && autoplayEnabled && !upNextTimer) { location.hash = `#/watch/${showId}/${encodeURIComponent(nextEp.relPath)}`; return; }
    if (!nextEp) showSeriesEndRecommendation();
  });

  function pickRecommendations() {
    const candidates = Store.filterForActiveProfile([...Store.anime]).filter((s) => s.id !== showId);
    if (candidates.length === 0) return [];
    const currentGenres = new Set(show.genres || []);
    const scored = candidates.map((s) => {
      const sharedGenres = (s.genres || []).filter((g) => currentGenres.has(g)).length;
      const started = !!(Store.activeProfile && Store.activeProfile.progress && Store.activeProfile.progress[s.id]);
      return { show: s, score: sharedGenres - (started ? 0.5 : 0) }; // a slight, not absolute, preference for something not already started - a strong genre match that's partway watched is still a reasonable suggestion
    });
    scored.sort((a, b) => b.score - a.score);
    // Shuffle among comparably-scored candidates before taking the top
    // few, not just sort-then-slice - otherwise the same fixed 5 shows
    // (whichever happen to sort first among ties) would cycle in the
    // exact same order literally every time a series ends, rather than
    // genuinely varying.
    for (let i = scored.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      if (scored[i].score === scored[j].score) [scored[i], scored[j]] = [scored[j], scored[i]];
    }
    return scored.slice(0, Math.min(5, scored.length)).map((s) => s.show);
  }

  async function showSeriesEndRecommendation() {
    const overlay = document.getElementById('seriesEndOverlay');
    if (!overlay) return;
    const recs = pickRecommendations();
    if (recs.length === 0) return; // nothing else in the library at all (or everything's filtered out) - nothing sensible to suggest
    let idx = 0;
    overlay.innerHTML = `
      <div class="series-end-frame">
        <div id="seriesEndMain"></div>
        <button class="series-end-close" id="seriesEndCloseBtn" aria-label="Close">&times;</button>
      </div>`;
    const frameEl = overlay.querySelector('.series-end-frame');
    const mainEl = document.getElementById('seriesEndMain');
    // Same reasoning as the hero's own dots: built once here and only
    // ever toggled afterward, not rebuilt on every rotation, so the
    // CSS transition between states actually has a "before" to animate
    // from instead of just snapping into place. Skipped entirely for a
    // single recommendation - a one-dot indicator that can't do
    // anything is just clutter.
    let dotsEl = null;
    if (recs.length > 1) {
      dotsEl = el(`<div class="series-end-dots">${recs.map((_, i) => `<button data-i="${i}"></button>`).join('')}</div>`);
      frameEl.appendChild(dotsEl);
      dotsEl.querySelectorAll('button').forEach((b, i) => {
        b.addEventListener('click', () => { idx = i; paint(); updateDots(); resetTimer(); });
      });
    }
    function updateDots() {
      if (dotsEl) dotsEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === idx));
    }
    function paint() {
      const rec = recs[idx];
      const firstEp = (rec.groups && rec.groups[0] && rec.groups[0].episodes && rec.groups[0].episodes[0]) || null;
      const isInMyList = !!(Store.activeProfile && (Store.activeProfile.myList || []).includes(`anime:${rec.id}`));
      mainEl.innerHTML = `
        <div class="series-end-bg" style="background-image:url('${escapeHtml(rec.banner || rec.cover || '/img/placeholder-banner.svg')}')"></div>
        <div class="series-end-content">
          <div class="series-end-eyebrow">Let's find what's next!</div>
          <h1 class="series-end-title">${escapeHtml(rec.title)}</h1>
          <div class="series-end-meta">
            ${rec.rating ? `<span class="series-end-rating">${escapeHtml(rec.rating)}</span><span class="series-end-dot"></span>` : ''}
            <span class="series-end-dot"></span>
            ${escapeHtml((rec.genres || []).slice(0, 4).join(', '))}
          </div>
          <div class="series-end-reason">We think you'll like this</div>
          <div class="series-end-actions">
            ${firstEp ? `<button class="series-end-play-btn" id="seriesEndPlayBtn">&#9654; Start Watching E${firstEp.index}</button>` : `<a href="#/title/${rec.id}" class="series-end-play-btn">View Title</a>`}
            <button class="series-end-bookmark ${isInMyList ? 'active' : ''}" id="seriesEndBookmarkBtn" aria-label="Add to My List">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3a1 1 0 0 0-1 1v17l7-4 7 4V4a1 1 0 0 0-1-1H6z"/></svg>
            </button>
          </div>
        </div>`;
      if (firstEp) {
        document.getElementById('seriesEndPlayBtn').addEventListener('click', () => {
          location.hash = `#/watch/${rec.id}/${encodeURIComponent(firstEp.relPath)}`;
        });
      }
      const bookmarkBtn = document.getElementById('seriesEndBookmarkBtn');
      bookmarkBtn.addEventListener('click', async () => {
        if (!Store.activeProfile) return;
        try {
          await API.toggleMyList(Store.activeProfile.id, rec.id, 'anime');
          bookmarkBtn.classList.toggle('active');
          showToast(bookmarkBtn.classList.contains('active') ? 'Added to My List' : 'Removed from My List');
        } catch (e) { showToast(e.message); }
      });
    }
    function resetTimer() {
      clearInterval(seriesEndRotationTimer);
      if (recs.length > 1) seriesEndRotationTimer = setInterval(() => { idx = (idx + 1) % recs.length; paint(); updateDots(); }, 7000);
    }
    paint();
    updateDots();
    resetTimer();
    overlay.style.display = 'flex';
    document.getElementById('seriesEndCloseBtn').addEventListener('click', () => {
      clearInterval(seriesEndRotationTimer);
      overlay.style.display = 'none';
    });
  }

  window.addEventListener('hashchange', () => { clearInterval(saveTimer); clearInterval(seriesEndRotationTimer); }, { once: true });


  if (selectedSubtitle != null) applySubtitle(selectedSubtitle);
  loadVideo(resumeAt, true);
  options.onReady?.({video, seekTo, absoluteTime, totalDuration});
}


// ==================== MANGA DETAIL ====================
async function pageMangaDetail(root, id) {
  if (Store.manga.length === 0) await Store.loadLibrary();
  let manga = Store.findManga(id) || await API.getManga(id).catch(() => null);
  if (manga && !manga.chapters) manga = await API.getManga(id).catch(() => manga);
  if (!manga) { root.innerHTML = `${renderNavbar('')}<div class="page-wrap"><div class="empty-state"><h3>Title not found</h3></div></div>`; wireNavbar(); return; }
  if (Store.isKidsActive() && Store.isMatureRating(manga.rating)) {
    showToast("This title isn't available on a kids profile");
    location.hash = '#/';
    return;
  }

  const inList = Store.isInMyList(manga.id, 'manga');
  const mangaProgress = Store.activeProfile && Store.activeProfile.mangaProgress ? Store.activeProfile.mangaProgress[manga.id] : null;

  root.innerHTML = `
    ${renderNavbar('books')}
    <div class="detail-hero" style="min-height:340px">
      <div class="detail-hero-bg" style="background-image:url('${manga.cover || '/img/placeholder-banner.svg'}');filter:blur(30px) brightness(0.5);"></div>
      <div class="detail-content">
        <img class="detail-poster" src="${manga.cover || '/img/placeholder-poster.svg'}" alt=""/>
        <div class="detail-info">
          <h1>${escapeHtml(manga.title)}</h1>
          <div class="detail-meta"><span>${manga.chapters.length} chapters</span>${manga.year ? `<span>&middot; ${manga.year}</span>` : ''}</div>
          <div class="detail-genres">${(manga.genres || []).map(g => `<span class="chip">${escapeHtml(g)}</span>`).join('')}</div>
          <p class="detail-desc">${escapeHtml(manga.description || 'No description yet. Add an info.json to this folder to customize.')}</p>
          <div class="detail-actions">
            <button class="btn btn-primary" id="readBtn">${mangaProgress ? '&#128214; Continue Reading' : '&#128214; Start Reading'}</button>
            <button class="btn btn-secondary" id="listBtn">${inList ? '&#10003; In My List' : '+ My List'}</button>
            <button class="btn-ghost" id="topPickBtn">${Store.isTopPick(manga.id, 'manga') ? '&#9733; Top Pick' : '&#9734; Top Pick'}</button>
            <button class="btn-ghost" id="reviewBtn">&#128221; Write a Review</button>
            ${Store.account && Store.account.role === 'admin' ? `<button class="btn-ghost" id="malImportBtn" title="Pull cover, description and genres from MyAnimeList">&#128218; Import from MAL</button>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="episodes-wrap">
      <div id="chapterList"></div>
    </div>
    ${reviewsSectionHTML()}
    ${externalLinksSectionHTML(manga, 'manga')}
  `;
  wireNavbar();
  wireReviewsSection(root, manga, 'manga');

  document.getElementById('readBtn').addEventListener('click', () => {
    if (mangaProgress) {
      location.hash = `#/read/${manga.id}/${encodeURIComponent(mangaProgress.chapterName)}/${mangaProgress.page}`;
      return;
    }
    const first = manga.chapters[0];
    if (!first) return;
    if (first.format === 'pdf' && first.pdfSupported === false) {
      window.open(`/api/manga/${manga.id}/pdf/${encodeURIComponent(first.name)}`, '_blank');
      return;
    }
    location.hash = `#/read/${manga.id}/${encodeURIComponent(first.name)}/1`;
  });
  document.getElementById('listBtn').addEventListener('click', async (e) => {
    if (!Store.activeProfile) { showToast('Select a profile first'); return; }
    const res = await API.toggleMyList(Store.activeProfile.id, manga.id, 'manga');
    Store.activeProfile.myList = res.myList;
    e.target.innerHTML = Store.isInMyList(manga.id, 'manga') ? '&#10003; In My List' : '+ My List';
  });
  document.getElementById('topPickBtn').addEventListener('click', async (e) => {
    if (!Store.activeProfile) { showToast('Select a profile first'); return; }
    try {
      const res = await API.toggleTopPick(Store.activeProfile.id, manga.id, 'manga');
      Store.activeProfile.topPicks = res.topPicks;
      e.target.innerHTML = Store.isTopPick(manga.id, 'manga') ? '&#9733; Top Pick' : '&#9734; Top Pick';
    } catch (err) { showToast(err.message); }
  });
  document.getElementById('reviewBtn').addEventListener('click', () => {
    if (!Store.activeProfile) { showToast('Select a profile first'); return; }
    openReviewModal(manga, 'manga');
  });
  const malImportBtn = document.getElementById('malImportBtn');
  if (malImportBtn) {
    malImportBtn.addEventListener('click', () => {
      openMalSearchModal(manga, async () => {
        await Store.loadLibrary({ force: true });
        await pageMangaDetail(root, id);
      }, 'manga');
    });
  }

  const formatLabels = { images: null, cbz: 'CBZ', epub: 'EPUB', pdf: 'PDF' };
  const listEl = document.getElementById('chapterList');
  listEl.innerHTML = manga.chapters.map((c, i) => {
    const badge = formatLabels[c.format] ? `<span class="chip" style="margin-left:8px">${formatLabels[c.format]}</span>` : '';
    const pdfBlocked = c.format === 'pdf' && c.pdfSupported === false;
    return `
    <div class="episode-row ${pdfBlocked ? '' : 'data-chapter-row'}" ${pdfBlocked ? '' : `data-chapter="${encodeURIComponent(c.name)}"`}>
      <div class="episode-num">${i + 1}</div>
      <div class="episode-info">
        <div class="episode-title">${escapeHtml(c.name)}${badge}</div>
        <div class="episode-file">${pdfBlocked ? 'Page-by-page reading needs poppler-utils installed - click to open the raw PDF instead' : `${c.pageCount} pages`}</div>
      </div>
      ${pdfBlocked
        ? `<a class="play-circle" href="/api/manga/${manga.id}/pdf/${encodeURIComponent(c.name)}" target="_blank" rel="noopener" title="Open PDF in a new tab">&#128196;</a>`
        : `<div class="play-circle">&#128214;</div>`}
    </div>`;
  }).join('');
  listEl.querySelectorAll('.data-chapter-row').forEach(row => {
    row.addEventListener('click', () => {
      location.hash = `#/read/${manga.id}/${row.dataset.chapter}/1`;
    });
  });
}

// ==================== MANGA READER ====================
async function pageReader(root, mangaId, chapterEncoded, pageNumStr) {
  if (Store.manga.length === 0) await Store.loadLibrary();
  let manga = Store.findManga(mangaId);
  if (manga && !manga.chapters) manga = await API.getManga(mangaId).catch(() => manga);
  if (!manga) { location.hash = `#/books`; return; }
  if (Store.isKidsActive() && Store.isMatureRating(manga.rating)) {
    showToast("This title isn't available on a kids profile");
    location.hash = '#/';
    return;
  }
  const chapterName = decodeURIComponent(chapterEncoded);
  const chapterIdx = manga.chapters.findIndex(c => c.name === chapterName);
  if (chapterIdx === -1) { location.hash = `#/manga/${mangaId}`; return; }

  const chapterMeta = manga.chapters[chapterIdx];
  if (chapterMeta.format === 'pdf' && chapterMeta.pdfSupported === false) {
    showToast('Page-by-page reading needs poppler-utils - opening the PDF directly instead');
    window.open(`/api/manga/${mangaId}/pdf/${encodeURIComponent(chapterName)}`, '_blank');
    location.hash = `#/manga/${mangaId}`;
    return;
  }

  const { pages } = await API.getMangaPages(mangaId, chapterName);
  let pageNum = Math.max(1, Math.min(pages.length, parseInt(pageNumStr, 10) || 1));

  root.innerHTML = `
    <div class="reader-page">
      <div class="reader-top">
        <div class="rt-left">
          <button class="icon-btn" id="readerBack">&#8592;</button>
          <strong>${escapeHtml(manga.title)}</strong>
          <select id="chapterSelect">
            ${manga.chapters.map((c, i) => `<option value="${i}" ${i === chapterIdx ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div id="pageIndicator">Page ${pageNum} / ${pages.length}</div>
      </div>
      <div class="reader-body" id="readerBody"></div>
      <div class="reader-footer">
        <button class="btn-ghost" id="prevPageBtn">&#8249; Prev</button>
        <button class="btn-ghost" id="nextPageBtn">Next &#8250;</button>
      </div>
    </div>`;

  function paintPage() {
    const file = pages[pageNum - 1];
    const url = `/api/manga/${mangaId}/page/${encodeURIComponent(chapterName)}/${encodeURIComponent(file)}`;
    document.getElementById('readerBody').innerHTML = `<img src="${url}" alt="Page ${pageNum}"/>`;
    document.getElementById('pageIndicator').textContent = `Page ${pageNum} / ${pages.length}`;
    history.replaceState(null, '', `#/read/${mangaId}/${encodeURIComponent(chapterName)}/${pageNum}`);
    if (Store.activeProfile) {
      API.setMangaProgress(Store.activeProfile.id, mangaId, chapterName, pageNum, pages.length).then((p) => {
        Store.activeProfile.mangaProgress = Store.activeProfile.mangaProgress || {};
        Store.activeProfile.mangaProgress[mangaId] = p;
      }).catch(() => {});
    }
  }
  paintPage();

  async function goToChapter(newIdx, atPage) {
    if (newIdx < 0 || newIdx >= manga.chapters.length) return;
    location.hash = `#/read/${mangaId}/${encodeURIComponent(manga.chapters[newIdx].name)}/${atPage}`;
  }

  document.getElementById('readerBack').addEventListener('click', () => { location.hash = `#/manga/${mangaId}`; });
  document.getElementById('chapterSelect').addEventListener('change', (e) => goToChapter(parseInt(e.target.value, 10), 1));
  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (pageNum > 1) { pageNum--; paintPage(); } else { goToChapter(chapterIdx - 1, 999); }
  });
  document.getElementById('nextPageBtn').addEventListener('click', () => {
    if (pageNum < pages.length) { pageNum++; paintPage(); } else { goToChapter(chapterIdx + 1, 1); }
  });
  document.addEventListener('keydown', function keyHandler(e) {
    if (!document.body.contains(document.getElementById('readerBody'))) {
      document.removeEventListener('keydown', keyHandler);
      return;
    }
    if (e.key === 'ArrowRight') document.getElementById('nextPageBtn').click();
    if (e.key === 'ArrowLeft') document.getElementById('prevPageBtn').click();
  });
}

// ==================== ACCOUNT / PROFILE PAGE ====================
async function pageAccount(root, profileId) {
  const profile = Store.profiles.find(p => p.id === profileId) || Store.activeProfile;
  if (!profile) { location.hash = '#/switch-profile'; return; }
  if (Store.anime.length === 0) await Store.loadLibrary();
  // Every profile in Store.profiles already belongs to the signed-in
  // account (the server only ever returns your own), so all of them -
  // not just whichever one happens to be active right now - are yours to
  // edit. This matters when arriving here from Manage Profiles rather
  // than from "My List" on the currently active profile.
  const isOwnProfile = Store.profiles.some(p => p.id === profile.id);

  root.innerHTML = `
    ${renderNavbar('')}
    <div class="account-page">
      <div class="account-banner" style="background-image:url('${profile.banner || AVAILABLE_BANNERS[0]}')" id="accountBannerBg">
        ${isOwnProfile ? `
          <button class="banner-edit-btn" id="bannerEditBtn" title="Upload a banner image">&#128247; Change Banner</button>
          <input type="file" id="bannerUploadInput" accept="image/*" style="display:none"/>
        ` : ''}
      </div>
      <div class="account-header">
        <div class="avatar-edit-wrap">
          <img src="${profile.avatar}" alt="" id="accountAvatarImg"/>
          ${isOwnProfile ? `
            <button class="avatar-edit-btn" id="avatarEditBtn" title="Change profile photo">&#128247;</button>
            <input type="file" id="avatarUploadInput" accept="image/*" style="display:none"/>
          ` : ''}
        </div>
        <div class="info">
          <h2>${escapeHtml(profile.name)} <span class="handle-badge">@${escapeHtml(profile.handle)}</span></h2>
          <div class="status" id="statusText" contenteditable="false">"${escapeHtml(profile.status)}"</div>
          <div class="joined">&#128197; Joined ${new Date(profile.createdAt).toLocaleString('en-US', { month: 'short', year: 'numeric' })}</div>
        </div>
        <button class="btn btn-primary" id="editProfileBtn">&#9998; Edit Profile</button>
      </div>
      <div class="account-stats">
        <div class="stat-card">
          <div class="stat-top"><span>WATCHED</span><span>&#128340;</span></div>
          <div class="stat-value">${fmtHours(profile.watchedSeconds)}</div>
          <div class="stat-label">Total hours</div>
        </div>
        <div class="stat-card">
          <div class="stat-top"><span>MY LIST</span><span>&#10084;</span></div>
          <div class="stat-value">${(profile.myList || []).length}</div>
          <div class="stat-label">Saved titles</div>
        </div>
      </div>
      <div class="account-tabs">
        <button class="active" data-tab="activity">&#10024; Activity</button>
        <button data-tab="reviews">&#9733; Reviews</button>
        <button data-tab="comments">&#128172; Comments</button>
        <button data-tab="toppicks">&#9733; Top Picks</button>
        <button data-tab="mylist">&#128278; My List</button>
      </div>
      <div class="account-tab-content" id="tabContent"></div>
    </div>`;
  wireNavbar();

  document.getElementById('editProfileBtn').addEventListener('click', () => {
    openProfileModal(profile, async () => {
      Store.profiles = await API.listProfiles();
      if (Store.activeProfile && Store.activeProfile.id === profile.id) {
        Store.activeProfile = await API.getActiveProfile();
      }
      pageAccount(root, profileId);
    });
  });

  // ---- Direct banner/avatar upload from the profile page itself ----
  if (isOwnProfile) {
    const isActiveProfile = Store.activeProfile && Store.activeProfile.id === profile.id;
    const bannerBtn = document.getElementById('bannerEditBtn');
    const bannerInput = document.getElementById('bannerUploadInput');
    bannerBtn.addEventListener('click', () => bannerInput.click());
    bannerInput.addEventListener('change', async () => {
      const file = bannerInput.files[0];
      if (!file) return;
      bannerBtn.textContent = 'Uploading...';
      try {
        const dataUrl = await resizeImageFile(file, 1280, 720, 0.85);
        const updated = await API.uploadBanner(profile.id, dataUrl);
        profile.banner = updated.banner;
        if (isActiveProfile) Store.activeProfile.banner = updated.banner;
        const listEntry = Store.profiles.find(p => p.id === profile.id);
        if (listEntry) listEntry.banner = updated.banner;
        document.getElementById('accountBannerBg').style.backgroundImage = `url('${updated.banner}')`;
        showToast('Banner updated');
      } catch (e) {
        showToast(e.message);
      } finally {
        bannerBtn.innerHTML = '&#128247; Change Banner';
      }
    });

    const avatarBtn = document.getElementById('avatarEditBtn');
    const avatarInput = document.getElementById('avatarUploadInput');
    avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files[0];
      if (!file) return;
      try {
        const dataUrl = await resizeImageFile(file, 400, 400, 0.85);
        const updated = await API.uploadAvatar(profile.id, dataUrl);
        profile.avatar = updated.avatar;
        if (isActiveProfile) Store.activeProfile.avatar = updated.avatar;
        const listEntry = Store.profiles.find(p => p.id === profile.id);
        if (listEntry) listEntry.avatar = updated.avatar;
        document.getElementById('accountAvatarImg').src = updated.avatar;
        showToast('Profile photo updated');
      } catch (e) {
        showToast(e.message);
      }
    });

    function showAvatarError(message) {
      const existing = document.getElementById('galleryDiagBanner');
      if (existing) existing.remove();
      const banner = document.createElement('div');
      banner.id = 'galleryDiagBanner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:14px;background:#7f1d1d;color:#fff;font-size:13px;font-family:monospace;white-space:pre-wrap;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
      banner.textContent = message;
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Dismiss';
      closeBtn.style.cssText = 'display:block;margin-top:10px;padding:6px 14px;background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:4px';
      closeBtn.addEventListener('click', () => banner.remove());
      banner.appendChild(closeBtn);
      document.body.appendChild(banner);
    }
    avatarBtn.addEventListener('click', async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Gallery request timed out after 8s')), 8000));
        const gallery = await Promise.race([API.getAvatarGallery(), timeoutPromise]);
        const allIcons = gallery.custom;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay open';
        overlay.innerHTML = `
          <div class="modal-box" style="max-width:420px">
            <h3 style="margin-bottom:14px">Change profile photo</h3>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;max-height:340px;overflow-y:auto">
              <button id="galleryUploadOwnBtn" style="aspect-ratio:1;border-radius:50%;border:2px dashed var(--border);background:var(--bg-card);color:var(--text-dim);display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:20px;cursor:pointer;padding:0">
                &#128247;<span style="font-size:9px;margin-top:2px">Upload</span>
              </button>
              ${allIcons.map((url) => `<img src="${escapeHtml(url)}" data-icon-url="${escapeHtml(url)}" style="width:100%;aspect-ratio:1;border-radius:50%;cursor:pointer;object-fit:cover;border:2px solid transparent" class="gallery-icon-option"/>`).join('')}
            </div>
            <button class="btn-ghost" id="galleryModalCancelBtn" style="margin-top:16px">Cancel</button>
          </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#galleryModalCancelBtn').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        overlay.querySelector('#galleryUploadOwnBtn').addEventListener('click', () => {
          overlay.remove();
          avatarInput.click();
        });
        overlay.querySelectorAll('.gallery-icon-option').forEach((img) => {
          img.addEventListener('click', async () => {
            const url = img.dataset.iconUrl;
            try {
              const updated = await API.updateProfile(profile.id, { avatar: url });
              profile.avatar = updated.avatar;
              if (isActiveProfile) Store.activeProfile.avatar = updated.avatar;
              const listEntry = Store.profiles.find(p => p.id === profile.id);
              if (listEntry) listEntry.avatar = updated.avatar;
              document.getElementById('accountAvatarImg').src = updated.avatar;
              showToast('Profile photo updated');
              overlay.remove();
            } catch (e) {
              showAvatarError(`Setting avatar failed: ${e.message}`);
            }
          });
        });
      } catch (e) {
        showAvatarError(`Gallery picker failed: ${e.message}`);
      }
    });
  }

  const tabContent = document.getElementById('tabContent');
  function paintTab(tab) {
    if (tab === 'mylist') {
      const items = (profile.myList || []).map(key => {
        const [type, id] = key.split(':');
        return type === 'anime' ? { type, item: Store.findAnime(id) } : { type, item: Store.findManga(id) };
      }).filter(x => x.item);
      tabContent.innerHTML = items.length
        ? `<div class="grid">${items.map(({ type, item }) => type === 'anime' ? animeCardHTML(item, { tall: true }) : mangaCardHTML(item)).join('')}</div>`
        : `<div class="empty-state"><h3>No saved titles yet</h3><p>Add titles to My List from any show or manga page.</p></div>`;
      wireCardNav(tabContent);
    } else if (tab === 'toppicks') {
      const items = (profile.topPicks || []).map(key => {
        const [type, id] = key.split(':');
        return type === 'anime' ? { type, item: Store.findAnime(id) } : { type, item: Store.findManga(id) };
      }).filter(x => x.item);
      tabContent.innerHTML = items.length
        ? `<div class="grid">${items.map(({ type, item }) => type === 'anime' ? animeCardHTML(item, { tall: true }) : mangaCardHTML(item)).join('')}</div>`
        : `<div class="empty-state"><h3>No top picks yet</h3><p>Pin up to 5 favorites from any show or manga page.</p></div>`;
      wireCardNav(tabContent);
    } else if (tab === 'reviews') {
      const reviews = profile.reviews || [];
      tabContent.innerHTML = reviews.length
        ? reviews.map(r => {
            const item = r.itemType === 'anime' ? Store.findAnime(r.itemId) : Store.findManga(r.itemId);
            if (!item) return '';
            return `<div class="review-card">
              <div class="review-head">
                <a href="#/${r.itemType === 'anime' ? 'title' : 'manga'}/${r.itemId}" class="review-title-link">${escapeHtml(item.title)}</a>
                <span class="review-stars">${'&#9733;'.repeat(r.rating)}${'&#9734;'.repeat(5 - r.rating)}</span>
                ${isOwnProfile ? `<button class="review-del" data-id="${r.id}" title="Delete review">&times;</button>` : ''}
              </div>
              ${r.text ? `<div class="review-text">${escapeHtml(r.text)}</div>` : ''}
              <div class="review-date">${new Date(r.createdAt).toLocaleDateString()}</div>
            </div>`;
          }).join('')
        : `<div class="empty-state"><h3>No reviews yet</h3><p>Write one from any show or manga page.</p></div>`;
      tabContent.querySelectorAll('.review-title-link').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); location.hash = a.getAttribute('href'); }));
      tabContent.querySelectorAll('.review-del').forEach(btn => btn.addEventListener('click', async () => {
        await API.deleteReview(profile.id, btn.dataset.id);
        profile.reviews = profile.reviews.filter(r => r.id !== btn.dataset.id);
        paintTab('reviews');
      }));
    } else if (tab === 'comments') {
      const comments = profile.comments || [];
      const listHtml = comments.length
        ? comments.map(c => `
          <div class="comment-card">
            <div class="comment-text">${escapeHtml(c.text)}</div>
            <div class="comment-meta">${new Date(c.createdAt).toLocaleString()} ${isOwnProfile ? `<button class="comment-del" data-id="${c.id}">Delete</button>` : ''}</div>
          </div>`).join('')
        : `<div class="empty-state" style="padding:40px 20px"><h3>No comments yet</h3></div>`;
      tabContent.innerHTML = isOwnProfile
        ? `<div class="comment-composer">
            <textarea id="newCommentText" placeholder="Say something..." maxlength="500"></textarea>
            <button class="btn btn-primary" id="postCommentBtn">Post</button>
          </div>${listHtml}`
        : listHtml;
      const postBtn = document.getElementById('postCommentBtn');
      if (postBtn) postBtn.addEventListener('click', async () => {
        const textEl = document.getElementById('newCommentText');
        const text = textEl.value.trim();
        if (!text) return;
        try {
          const comment = await API.addComment(profile.id, text);
          profile.comments = [comment, ...(profile.comments || [])];
          textEl.value = '';
          paintTab('comments');
        } catch (e) { showToast(e.message); }
      });
      tabContent.querySelectorAll('.comment-del').forEach(btn => btn.addEventListener('click', async () => {
        await API.deleteComment(profile.id, btn.dataset.id);
        profile.comments = profile.comments.filter(c => c.id !== btn.dataset.id);
        paintTab('comments');
      }));
    } else {
      const recent = Object.entries(profile.progress || {}).sort((a, b) => new Date(b[1].updatedAt) - new Date(a[1].updatedAt)).slice(0, 10);
      tabContent.innerHTML = recent.length
        ? recent.map(([itemId, prog]) => {
            const show = Store.findAnime(itemId);
            if (!show) return '';
            return `<div class="episode-row" data-nav="#/title/${itemId}">
              <img class="episode-thumb" src="${show.banner || show.cover || '/img/placeholder-banner.svg'}" alt=""/>
              <div class="episode-info">
                <div class="episode-title">${escapeHtml(show.title)}</div>
                <div class="episode-file">Last watched ${new Date(prog.updatedAt).toLocaleDateString()}</div>
              </div>
            </div>`;
          }).join('')
        : `<div class="empty-state"><h3>No activity yet</h3><p>Start watching something!</p></div>`;
      tabContent.querySelectorAll('[data-nav]').forEach(n => n.addEventListener('click', () => location.hash = n.dataset.nav));
    }
  }
  paintTab('activity');
  document.querySelectorAll('.account-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.account-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      paintTab(btn.dataset.tab);
    });
  });

  const statusEl = document.getElementById('statusText');
  statusEl.addEventListener('dblclick', () => {
    statusEl.contentEditable = 'true';
    statusEl.focus();
  });
  statusEl.addEventListener('blur', async () => {
    statusEl.contentEditable = 'false';
    const newStatus = statusEl.textContent.replace(/^"|"$/g, '').trim();
    if (newStatus && newStatus !== profile.status) {
      await API.updateProfile(profile.id, { status: newStatus });
      profile.status = newStatus;
      showToast('Status updated');
    }
  });
}

// ==================== MANAGE PROFILES ====================
function pageManageProfiles(root) {
  root.innerHTML = `
  <div class="gate">
    <div class="gate-logo-image"><img src="/img/io-logo.svg" alt="${escapeHtml(Store.config.siteName)}"/></div>
    <h2>Manage Profiles</h2>
    <p class="auth-subtitle">Click a profile to open its full page - banner, stats, reviews, and more.<br/>Use the pencil for a quick name/avatar edit instead.</p>
    <div class="gate-profiles" id="manageGrid"></div>
    <div class="gate-actions"><button id="doneBtn">DONE</button></div>
  </div>`;
  const grid = document.getElementById('manageGrid');
  grid.innerHTML = Store.profiles.map(p => `
    <button class="gate-profile" data-view="${p.id}">
      <div class="avatar-wrap" style="position:relative">
        <img src="${p.avatar}" alt=""/>
        <button class="quick-edit-btn" data-edit="${p.id}" title="Quick edit name/avatar">&#9998;</button>
      </div>
      <span>${escapeHtml(p.name)}</span>
    </button>`).join('');
  if (Store.profiles.length < 5) {
    grid.innerHTML += `<button class="gate-profile add" id="addProfileBtn2"><div class="avatar-wrap">+</div><span>Add Profile</span></button>`;
  }
  grid.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      location.hash = `#/account/${btn.dataset.view}`;
    });
  });
  grid.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const profile = Store.profiles.find(p => p.id === btn.dataset.edit);
      openProfileModal(profile, async () => { Store.profiles = await API.listProfiles(); pageManageProfiles(root); });
    });
  });
  const addBtn = document.getElementById('addProfileBtn2');
  if (addBtn) addBtn.addEventListener('click', () => openProfileModal(null, async () => { Store.profiles = await API.listProfiles(); pageManageProfiles(root); }));
  document.getElementById('doneBtn').addEventListener('click', () => { location.hash = '#/switch-profile'; });
}

// ==================== SETTINGS ====================
async function pageSettings(root) {
  const isAdmin = Store.account && Store.account.role === 'admin';
  root.innerHTML = `
    ${renderNavbar('')}
    <div class="page-wrap" style="max-width:640px">
      <div class="page-header"><h1>Settings</h1></div>

      <h3 style="margin-bottom:14px">Your Account</h3>
      <div style="font-size:13.5px;color:var(--text-dim);margin-bottom:16px">Signed in as <strong style="color:var(--text)">@${escapeHtml(Store.account.username)}</strong> (${isAdmin ? 'Admin' : 'User'})</div>
      <form id="passwordForm">
        <div class="field"><label>Current Password</label><input type="password" id="oldPassword" autocomplete="current-password" required/></div>
        <div class="field"><label>New Password</label><input type="password" id="newPasswordInput" autocomplete="new-password" required/></div>
        <div id="passwordError" class="auth-error"></div>
        <button type="submit" class="btn-ghost">Change Password</button>
      </form>

      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin-bottom:6px">Two-Factor Authentication</h3>
        <p style="font-size:12.5px;color:var(--text-faint);margin-bottom:14px">Adds a code from an authenticator app (like Google Authenticator or Authy) as a second step when signing in.</p>
        <div id="twoFactorArea"><div class="loading-spin" style="margin:16px auto"></div></div>
      </div>

      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin-bottom:6px">Mature Content</h3>
        <p style="font-size:12.5px;color:var(--text-faint);margin-bottom:14px">
          Whether mature/adult-rated titles (R+, Rx, etc.) can show up at all under this account.
          Applies across every profile - a profile can still be individually marked "Kids Profile"
          for extra restriction, but turning this off here hides mature content everywhere regardless
          of any individual profile's own setting. Turning it back on requires your account password,
          so a profile alone can't unlock it.
        </p>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="adultContentToggle" ${Store.account.adultContentAllowed !== false ? 'checked' : ''} style="width:16px;height:16px"/>
          <label for="adultContentToggle" style="margin:0">Allow mature/adult-rated titles</label>
        </div>
        <div id="adultContentPasswordField" style="display:none;margin-top:10px">
          <div class="field"><label>Account Password</label><input type="password" id="adultContentPasswordInput" autocomplete="current-password"/></div>
          <div id="adultContentError" class="auth-error"></div>
          <button class="btn-ghost" id="adultContentConfirmBtn">Confirm</button>
          <button class="auth-mode-toggle-link" id="adultContentCancelBtn" type="button">Cancel</button>
        </div>
      </div>

      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin-bottom:6px">Signed-in Devices</h3>
        <p style="font-size:12.5px;color:var(--text-faint);margin-bottom:14px">
          Everywhere your account is currently signed in - useful for checking nothing was left
          signed in on a shared or borrowed device (e.g. after using "Sign in with QR code").
        </p>
        <div id="sessionsList"><div class="loading-spin" style="margin:20px auto"></div></div>
        <button class="btn-ghost" id="revokeOthersBtn" style="margin-top:10px">Sign out all other devices</button>
      </div>

      ${isAdmin ? `
      <div style="margin-top:36px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin-bottom:14px">Site (Admin)</h3>
        <div class="field">
          <label>Site Name</label>
          <input type="text" id="siteNameInput" value="${escapeHtml(Store.config.siteName)}"/>
        </div>
        <div class="field">
          <label>Accent Color</label>
          <div class="color-grid">
            ${['#8b30f0', '#e11d48', '#0891b2', '#16a34a', '#ea580c', '#4f46e5', '#db2777'].map(c => `<button class="color-swatch ${c === Store.config.theme.accent ? 'selected' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
          </div>
        </div>
        <div class="field">
          <label>MyAnimeList Client ID <span style="color:var(--text-faint);font-weight:400">(needed for the "Import from MAL" poster/metadata button)</span></label>
          <input type="text" id="malClientIdInput" value="${escapeHtml(Store.config.malClientId || '')}" placeholder="Paste your MAL API Client ID here"/>
          <div style="font-size:12px;color:var(--text-faint);margin-top:6px">
            Free to get: sign in at myanimelist.net &rarr; Account Settings &rarr; API &rarr; Create ID,
            set app type to "hobbyist", no redirect URL needed since we only use public GET requests.
          </div>
        </div>
        <div class="field">
          <label>Jellyfin Server URL <span style="color:var(--text-faint);font-weight:400">(optional - reuses series logo art from a Jellyfin server you already run)</span></label>
          <input type="text" id="jellyfinServerUrlInput" value="${escapeHtml(Store.config.jellyfinServerUrl || '')}" placeholder="http://localhost:8096"/>
        </div>
        <div class="field">
          <label>Jellyfin API Key</label>
          <input type="password" id="jellyfinApiKeyInput" value="${escapeHtml(Store.config.jellyfinApiKey || '')}" placeholder="Paste your Jellyfin API key here"/>
          <div style="font-size:12px;color:var(--text-faint);margin-top:6px">
            In Jellyfin, go to Dashboard &rarr; API Keys &rarr; + (top right) to create a dedicated key
            just for this - it can be renamed and revoked independently at any time, without touching
            your actual Jellyfin login.
          </div>
        </div>
        <div class="field">
          <label>Automatic Enrichment Source</label>
          <select id="metadataSourceInput">
            <option value="mal" ${Store.config.metadataSource !== 'anilist' ? 'selected' : ''}>MyAnimeList</option>
            <option value="anilist" ${Store.config.metadataSource === 'anilist' ? 'selected' : ''}>AniList (no API key needed)</option>
          </select>
          <div style="font-size:12px;color:var(--text-faint);margin-top:6px">
            Which source auto-enrichment (after a rescan) searches for missing posters/info. The
            manual "Import Metadata" button on a title's page always lets you pick either one
            regardless of this setting.
          </div>
        </div>
        <div class="field" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="preferEnglishInput" ${Store.config.preferEnglishTitles ? 'checked' : ''} style="width:16px;height:16px"/>
          <label for="preferEnglishInput" style="margin:0">Prefer English titles when importing from MyAnimeList<br/><span style="color:var(--text-faint);font-weight:400;font-size:12px">Uses MAL's English name (e.g. "Attack on Titan") instead of the Japanese/romaji one when available. Applies to auto-enrichment on rescan, and is the default for the manual import search too.</span></label>
        </div>
        <div class="field" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="hwAccelInput" ${Store.config.hardwareAcceleration !== false ? 'checked' : ''} style="width:16px;height:16px"/>
          <label for="hwAccelInput" style="margin:0">Use hardware video encoding when available<br/><span style="color:var(--text-faint);font-weight:400;font-size:12px">Uses your GPU (NVIDIA NVENC, Intel Quick Sync, AMD AMF, or VAAPI on Linux) instead of pure software encoding for audio/codec fixes and quality downscaling - much faster and far less CPU usage on hardware that supports it. Falls back to software automatically if none is detected. Turn off only if you suspect it's causing playback issues.</span></label>
        </div>
        <div id="hwAccelStatus" style="font-size:12.5px;color:var(--text-faint);margin:-8px 0 4px 26px">Checking hardware acceleration&hellip;</div>
        <div class="field">
          <label>HTTPS</label>
          <div id="httpsStatus" style="font-size:12.5px;color:var(--text-faint)">Checking&hellip;</div>
        </div>
        <div class="field" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="allowSelfRegInput" ${Store.config.allowSelfRegistration !== false ? 'checked' : ''} style="width:16px;height:16px"/>
          <label for="allowSelfRegInput" style="margin:0">Allow anyone to create their own account<br/><span style="color:var(--text-faint);font-weight:400;font-size:12px">Adds a "Create Account" option on the login page. New accounts made this way are always basic, non-admin accounts - never able to grant themselves admin access. Turn off to go back to requiring you to add every account yourself from Manage Accounts below.</span></label>
        </div>
        <div class="field" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="requireApprovalInput" ${Store.config.requireApprovalForSelfRegistration !== false ? 'checked' : ''} style="width:16px;height:16px"/>
          <label for="requireApprovalInput" style="margin:0">Require admin approval for new self-registered accounts<br/><span style="color:var(--text-faint);font-weight:400;font-size:12px">Only applies when self-registration above is on. A new account can be created but can't sign in until you approve it from Manage Accounts. Turn off to let new accounts in immediately with no approval step.</span></label>
        </div>
        <div class="field">
          <label>Max Stream Cache Size (GB)</label>
          <input type="text" id="maxCacheInput" value="${Store.config.maxStreamCacheGB || 15}" inputmode="numeric" style="max-width:120px"/>
          <div style="color:var(--text-faint);font-weight:400;font-size:12px;margin-top:4px">
            Videos that need fixing (wrong container/codec, or a quality change) get cached after
            the first play so repeat views are instant - this caps how much disk space that's
            allowed to use, automatically removing the least-recently-watched cached copies first
            once it's exceeded. Doesn't affect your actual media files, only the cache.
          </div>
        </div>
        <div id="cacheSizeStatus" style="font-size:12.5px;color:var(--text-faint);margin:-8px 0 14px 0"></div>
        <div class="field">
          <label>Library Scan Timeout (seconds)</label>
          <input type="text" id="scanTimeoutInput" value="${Store.config.libraryScanTimeoutSec || 240}" inputmode="numeric" style="max-width:120px"/>
          <div style="color:var(--text-faint);font-weight:400;font-size:12px;margin-top:4px">
            How long a single media folder gets to finish scanning before it's treated as
            unreachable and skipped for that scan (with whatever was found last time kept, rather
            than showing empty). If you have a very large library and rescans sometimes report a
            local folder as unreachable, raise this.
          </div>
        </div>
        <div class="field">
          <label>Check for New Media Every (minutes)</label>
          <input type="text" id="autoScanIntervalInput" value="${Store.config.autoScanIntervalMinutes === undefined ? 15 : Store.config.autoScanIntervalMinutes}" inputmode="decimal" style="max-width:120px"/>
          <div style="color:var(--text-faint);font-weight:400;font-size:12px;margin-top:4px">
            New files are normally picked up the moment they appear, but that only works for
            changes made on this computer. If your library is on a network share (NAS) and new
            media gets copied onto it from another machine, this periodic check is what notices.
            It's a quick look at folder timestamps, not a full scan - a real rescan only starts
            if something actually changed. Set to 0 to turn it off.
          </div>
        </div>
        <div class="modal-actions" style="justify-content:flex-start">
          <button class="btn btn-primary" id="saveSettingsBtn">Save Settings</button>
          <button class="btn-ghost" id="rescanBtn">&#8635; Rescan Library</button>
        </div>
        <div style="margin-top:20px">
          <strong>Media folders</strong>
          <p style="font-size:12.5px;color:var(--text-faint);margin:6px 0 12px">
            Point these at any folders on this server's disks (e.g. <code>D:/Anime</code> or
            <code>/mnt/media/movies</code>). Saving rescans from the new locations immediately -
            no restart needed. Relative paths are relative to the app's folder.
          </p>
          <div class="field"><label>Anime folder</label><input type="text" id="pathAnimeInput" value="${escapeHtml(Store.config.mediaPaths.anime || './media/anime')}"/></div>
          <div class="field"><label>Movies folder</label><input type="text" id="pathMoviesInput" value="${escapeHtml(Store.config.mediaPaths.movies || './media/movies')}"/></div>
          <div class="field"><label>Manga folder</label><input type="text" id="pathMangaInput" value="${escapeHtml(Store.config.mediaPaths.manga || './media/manga')}"/></div>
        </div>
        <div style="margin-top:20px">
          <a href="#/manage-accounts" class="btn-ghost" style="display:inline-block">&#128101; Manage Accounts</a>
        </div>
      </div>` : ''}
    </div>`;
  wireNavbar();

  document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPasswordInput').value;
    const errEl = document.getElementById('passwordError');
    errEl.textContent = '';
    try {
      await API.changePassword(oldPassword, newPassword);
      showToast('Password updated');
      e.target.reset();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  async function paintTwoFactorArea() {
    const area = document.getElementById('twoFactorArea');
    let status;
    try {
      status = await API.get2FAStatus();
    } catch (e) {
      area.innerHTML = `<p style="font-size:13px;color:var(--text-faint)">${escapeHtml(e.message)}</p>`;
      return;
    }
    if (status.enabled) {
      area.innerHTML = `
        <p style="font-size:13px;margin-bottom:10px">Currently <strong style="color:#4ade80">enabled</strong> - ${status.remainingBackupCodes} unused backup code${status.remainingBackupCodes === 1 ? '' : 's'} remaining.</p>
        <div class="field"><label>Current Password (required to turn off)</label><input type="password" id="disable2FAPassword" autocomplete="current-password"/></div>
        <div id="twoFactorError" class="auth-error"></div>
        <button class="btn-ghost" id="disable2FABtn">Turn Off Two-Factor Authentication</button>
      `;
      document.getElementById('disable2FABtn').addEventListener('click', async () => {
        const password = document.getElementById('disable2FAPassword').value;
        const errEl = document.getElementById('twoFactorError');
        errEl.textContent = '';
        try {
          await API.disable2FA(password);
          showToast('Two-factor authentication turned off');
          paintTwoFactorArea();
        } catch (e) {
          errEl.textContent = e.message;
        }
      });
    } else {
      area.innerHTML = `
        <p style="font-size:13px;margin-bottom:10px">Currently <strong>off</strong>.</p>
        <button class="btn-ghost" id="begin2FABtn">Enable Two-Factor Authentication</button>
      `;
      document.getElementById('begin2FABtn').addEventListener('click', beginTwoFactorSetup);
    }
  }

  async function beginTwoFactorSetup() {
    const area = document.getElementById('twoFactorArea');
    area.innerHTML = `<div class="loading-spin" style="margin:16px auto"></div>`;
    let setup;
    try {
      setup = await API.begin2FASetup();
    } catch (e) {
      area.innerHTML = `<p style="font-size:13px;color:var(--text-faint)">${escapeHtml(e.message)}</p>`;
      return;
    }
    area.innerHTML = `
      <p style="font-size:13px;margin-bottom:10px">Scan this with your authenticator app, or enter the code manually.</p>
      <div style="background:#fff;padding:12px;border-radius:8px;width:fit-content;margin-bottom:10px">${IOQR.toSVG(setup.otpauthUri, { moduleSize: 5, margin: 2 })}</div>
      <div style="font-family:monospace;font-size:13px;background:var(--bg-card);padding:8px 12px;border-radius:6px;margin-bottom:14px;word-break:break-all">${escapeHtml(setup.secret)}</div>
      <div class="field"><label>Enter the 6-digit code it shows now, to confirm it's working</label><input type="text" id="confirm2FACode" inputmode="numeric" placeholder="123456"/></div>
      <div id="twoFactorError" class="auth-error"></div>
      <button class="btn-ghost" id="confirm2FABtn">Confirm & Turn On</button>
      <button class="auth-mode-toggle-link" id="cancel2FABtn" type="button">Cancel</button>
    `;
    document.getElementById('cancel2FABtn').addEventListener('click', paintTwoFactorArea);
    document.getElementById('confirm2FABtn').addEventListener('click', async () => {
      const code = document.getElementById('confirm2FACode').value.trim();
      const errEl = document.getElementById('twoFactorError');
      errEl.textContent = '';
      try {
        const { backupCodes } = await API.confirm2FASetup(code);
        showBackupCodes(backupCodes);
      } catch (e) {
        errEl.textContent = e.message;
      }
    });
  }

  function showBackupCodes(codes) {
    const area = document.getElementById('twoFactorArea');
    area.innerHTML = `
      <p style="font-size:13px;margin-bottom:10px">
        <strong style="color:#facc15">Save these backup codes somewhere safe now</strong> - each works once, and
        this is the only time they're ever shown. They're the only way back in if you lose your authenticator device.
      </p>
      <div style="font-family:monospace;font-size:13px;background:var(--bg-card);padding:12px;border-radius:6px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
        ${codes.map((c) => `<div>${escapeHtml(c)}</div>`).join('')}
      </div>
      <button class="btn-ghost" id="savedBackupCodesBtn">I've saved these codes</button>
    `;
    document.getElementById('savedBackupCodesBtn').addEventListener('click', () => {
      showToast('Two-factor authentication enabled');
      paintTwoFactorArea();
    });
  }
  paintTwoFactorArea();

  const adultContentToggle = document.getElementById('adultContentToggle');
  const adultContentPasswordField = document.getElementById('adultContentPasswordField');
  adultContentToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      // Unlocking requires proving you actually know the account
      // password - restricting it further never does, since anyone
      // using the account should be free to make things more
      // restrictive, but only the password-holder should be able to
      // loosen it.
      adultContentPasswordField.style.display = 'block';
      document.getElementById('adultContentPasswordInput').focus();
      return;
    }
    try {
      const updated = await API.setAdultContent(false);
      Store.account.adultContentAllowed = updated.adultContentAllowed;
      showToast('Mature content hidden across all profiles');
    } catch (err) {
      e.target.checked = true; // revert - the change never actually took effect server-side
      showToast(err.message);
    }
  });
  document.getElementById('adultContentCancelBtn').addEventListener('click', () => {
    adultContentToggle.checked = false;
    adultContentPasswordField.style.display = 'none';
    document.getElementById('adultContentPasswordInput').value = '';
    document.getElementById('adultContentError').textContent = '';
  });
  document.getElementById('adultContentConfirmBtn').addEventListener('click', async () => {
    const password = document.getElementById('adultContentPasswordInput').value;
    const errEl = document.getElementById('adultContentError');
    errEl.textContent = '';
    try {
      const updated = await API.setAdultContent(true, password);
      Store.account.adultContentAllowed = updated.adultContentAllowed;
      adultContentPasswordField.style.display = 'none';
      document.getElementById('adultContentPasswordInput').value = '';
      showToast('Mature content allowed');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  async function loadSessions() {
    const listEl = document.getElementById('sessionsList');
    try {
      const sessions = await API.listSessions();
      listEl.innerHTML = sessions.map((s) => `
        <div class="episode-row" style="align-items:center">
          <div class="episode-info">
            <div class="episode-title">${s.isCurrent ? 'This device' : 'Other device'} ${s.isCurrent ? '<span class="handle-badge" style="margin-left:6px">Current</span>' : ''}</div>
            <div class="episode-file">Signed in ${new Date(s.createdAt).toLocaleString()}</div>
          </div>
          ${!s.isCurrent ? `<button class="btn-ghost" data-revoke="${s.id}">Sign out</button>` : ''}
        </div>`).join('') || `<div style="color:var(--text-faint);font-size:13px">No active sessions found.</div>`;
      listEl.querySelectorAll('[data-revoke]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await API.revokeSession(btn.dataset.revoke).catch(() => {});
          showToast('Device signed out');
          loadSessions();
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div style="color:var(--text-faint);font-size:13px">Couldn't load sessions.</div>`;
    }
  }
  loadSessions();
  document.getElementById('revokeOthersBtn').addEventListener('click', async () => {
    if (!confirm('Sign out every other device currently signed into your account?')) return;
    await API.revokeOtherSessions().catch(() => {});
    showToast('All other devices signed out');
    loadSessions();
  });

  if (!isAdmin) return;

  let selectedColor = Store.config.theme.accent;
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      selectedColor = sw.dataset.color;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      document.documentElement.style.setProperty('--accent', selectedColor);
    });
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const siteName = document.getElementById('siteNameInput').value.trim() || 'I/O';
    const malClientId = document.getElementById('malClientIdInput').value.trim();
    const jellyfinServerUrl = document.getElementById('jellyfinServerUrlInput').value.trim();
    const jellyfinApiKey = document.getElementById('jellyfinApiKeyInput').value.trim();
    const metadataSource = document.getElementById('metadataSourceInput').value;
    const preferEnglishTitles = document.getElementById('preferEnglishInput').checked;
    const hardwareAcceleration = document.getElementById('hwAccelInput').checked;
    const allowSelfRegistration = document.getElementById('allowSelfRegInput').checked;
    const requireApprovalForSelfRegistration = document.getElementById('requireApprovalInput').checked;
    const maxStreamCacheGB = parseFloat(document.getElementById('maxCacheInput').value) || 15;
    const libraryScanTimeoutSec = parseInt(document.getElementById('scanTimeoutInput').value, 10) || 240;
    const autoScanIntervalMinutes = parseFloat(document.getElementById('autoScanIntervalInput').value);
    const mediaPaths = {
      anime: document.getElementById('pathAnimeInput').value,
      movies: document.getElementById('pathMoviesInput').value,
      manga: document.getElementById('pathMangaInput').value,
    };
    const updated = await API.updateConfig({ siteName, theme: { accent: selectedColor }, malClientId, jellyfinServerUrl, jellyfinApiKey, metadataSource, preferEnglishTitles, hardwareAcceleration, allowSelfRegistration, requireApprovalForSelfRegistration, maxStreamCacheGB, libraryScanTimeoutSec, autoScanIntervalMinutes, mediaPaths });
    Store.config = updated;
    applyTheme(updated.theme);
    document.title = updated.siteName;
    if (updated.pathWarnings && updated.pathWarnings.length) {
      showToast(updated.pathWarnings[0]);
    } else {
      showToast('Settings saved');
    }
    await Store.loadLibrary({ force: true });
    renderApp();
  });

  document.getElementById('rescanBtn').addEventListener('click', async () => {
    const res = await API.rescan();
    showToast(`Rescanned: ${res.animeCount} anime, ${res.movieCount} movies, ${res.mangaCount} manga found`);
    await Store.loadLibrary({ force: true });
  });

  API.getHwaccelStatus().then((status) => {
    const el = document.getElementById('hwAccelStatus');
    if (!el) return;
    if (status.type === 'none') {
      if (Store.config.hardwareAcceleration === false) {
        el.textContent = 'Currently: disabled';
      } else {
        el.innerHTML = 'Currently: no compatible hardware detected on this server - using software encoding' +
          (status.attemptReasons ? `<div style="font-size:11.5px;color:var(--text-faint);margin-top:6px;font-family:monospace;white-space:pre-wrap">` +
            Object.entries(status.attemptReasons).map(([method, reason]) => `${method.toUpperCase()}: ${escapeHtml(reason)}`).join('\n') +
            `</div>` : '');
      }
    } else {
      el.textContent = `Currently active: ${status.label}`;
      el.style.color = '#4ade80';
    }
  }).catch(() => {
    const el = document.getElementById('hwAccelStatus');
    if (el) el.textContent = '';
  });

  API.getHttpsStatus().then((status) => {
    const el = document.getElementById('httpsStatus');
    if (!el) return;
    if (status.active) {
      el.textContent = 'Active - this connection is encrypted.';
      el.style.color = '#4ade80';
    } else if (status.needsRestart) {
      el.innerHTML = `A certificate is set up and its files exist (${escapeHtml(status.certPath)}), but this server hasn't loaded it yet - <strong>restart the server</strong> to actually start using it.`;
      el.style.color = '#facc15';
    } else if (status.configured) {
      el.textContent = `A certificate is configured (${status.certPath}) but its files can't be found on disk - regenerate it with generate-cert.sh / generate-cert.bat.`;
      el.style.color = '#f87171';
    } else {
      el.innerHTML = `Not set up - this server is reachable over plain HTTP only. Run <code>generate-cert.sh</code> (or <code>generate-cert.bat</code> on Windows) in the project folder to enable it.`;
    }
  }).catch(() => {
    const el = document.getElementById('httpsStatus');
    if (el) el.textContent = '';
  });

  API.getCacheStatus().then((cache) => {
    const el = document.getElementById('cacheSizeStatus');
    if (el) el.textContent = `Currently using ${cache.usedGB.toFixed(2)} GB of the ${cache.limitGB} GB limit.`;
  }).catch(() => {});
}

// ==================== SEARCH ====================
// ==================== GENRES ====================
function collectAllGenres() {
  const counts = {};
  for (const item of Store.filterForActiveProfile([...Store.anime, ...Store.movies, ...Store.manga])) {
    for (const g of item.genres || []) counts[g] = (counts[g] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([genre, count]) => ({ genre, count }));
}

// ==================== WATCH HISTORY ====================
// ==================== LIBRARY STATS ====================
function fmtHours(seconds) {
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)} min`;
  return `${hours.toFixed(1)} hrs`;
}

async function pageStats(root) {
  await Store.loadLibrary();
  root.innerHTML = `
    ${renderNavbar('')}
    <div class="page-wrap">
      <div class="page-header"><h1>Library Stats</h1></div>
      <div id="statsContent"><div class="loading-spin" style="margin:30px auto"></div></div>
    </div>`;
  wireNavbar();

  try {
    const data = await API.getLibraryStats(Store.activeProfile ? Store.activeProfile.id : null);
    const el2 = document.getElementById('statsContent');
    el2.innerHTML = `
      <h3 style="margin-bottom:14px">Your Library</h3>
      <div class="stats-grid" style="margin-bottom:32px">
        <div class="stat-card"><div class="stat-label">Series</div><div class="stat-value">${data.library.animeCount}</div></div>
        <div class="stat-card"><div class="stat-label">Movies</div><div class="stat-value">${data.library.movieCount}</div></div>
        <div class="stat-card"><div class="stat-label">Manga</div><div class="stat-value">${data.library.mangaCount}</div></div>
      </div>
      ${data.library.topGenres.length ? `
      <h3 style="margin-bottom:14px">Top Genres in Your Library</h3>
      <div class="genre-pill-grid" style="margin-bottom:32px">
        ${data.library.topGenres.map(({ genre, count }) => `<div class="genre-pill" style="cursor:default"><span>${escapeHtml(genre)}</span><span class="genre-pill-count">${count}</span></div>`).join('')}
      </div>` : ''}
      ${data.personal ? `
      <h3 style="margin-bottom:14px">Your Watch Stats</h3>
      <div class="stats-grid" style="margin-bottom:32px">
        <div class="stat-card"><div class="stat-label">Time Watched</div><div class="stat-value">${fmtHours(data.personal.totalSeconds)}</div><div class="stat-sub">Only counts episodes watched through the player - manually marked episodes without a known length aren't included.</div></div>
        <div class="stat-card"><div class="stat-label">Episodes Watched</div><div class="stat-value">${data.personal.episodeCount}</div></div>
      </div>
      ${data.personal.topGenres.length ? `
      <h3 style="margin-bottom:14px">Genres You Watch Most</h3>
      <div class="genre-pill-grid" style="margin-bottom:32px">
        ${data.personal.topGenres.map(({ genre, count }) => `<div class="genre-pill" style="cursor:default"><span>${escapeHtml(genre)}</span><span class="genre-pill-count">${count}</span></div>`).join('')}
      </div>` : ''}` : ''}
      <h3 style="margin-bottom:14px">Everyone on This Server</h3>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Combined Time Watched</div><div class="stat-value">${fmtHours(data.serverWide.totalSeconds)}</div></div>
        <div class="stat-card"><div class="stat-label">Combined Episodes Watched</div><div class="stat-value">${data.serverWide.episodeCount}</div></div>
      </div>`;
  } catch (e) {
    document.getElementById('statsContent').innerHTML = `<div class="empty-state"><h3>Couldn't load stats</h3></div>`;
  }
}

async function pageHistory(root) {
  if (!Store.activeProfile) { location.hash = '#/switch-profile'; return; }
  if (Store.anime.length === 0) await Store.loadLibrary();
  root.innerHTML = `
    ${renderNavbar('')}
    <div class="page-wrap">
      <div class="page-header"><h1>Watch History</h1></div>
      <div id="historyList"><div class="loading-spin" style="margin:30px auto"></div></div>
    </div>`;
  wireNavbar();

  try {
    const history = await API.getWatchHistory(Store.activeProfile.id);
    const listEl = document.getElementById('historyList');
    if (history.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><h3>Nothing watched yet</h3><p>Episodes show up here automatically once you're about 90% through them.</p></div>`;
      return;
    }
    listEl.innerHTML = history.map((h) => {
      const show = h.itemType === 'manga' ? Store.findManga(h.itemId) : Store.findAnime(h.itemId);
      if (!show) return '';
      const cover = show.cover || show.banner || '/img/placeholder-poster.svg';
      return `
      <div class="episode-row" data-nav="#/watch/${h.itemId}/${encodeURIComponent(h.episodeRelPath)}">
        <img class="episode-thumb" src="${cover}" alt="" style="border-radius:6px"/>
        <div class="episode-info">
          <div class="episode-title">${escapeHtml(show.title)}</div>
          <div class="episode-file">${escapeHtml(h.episodeTitle || h.episodeRelPath)} &middot; ${new Date(h.watchedAt).toLocaleString()}</div>
        </div>
        <div class="play-circle">&#9654;</div>
      </div>`;
    }).join('') || `<div class="empty-state"><h3>Nothing watched yet</h3></div>`;
    wireCardNav(listEl);
  } catch (e) {
    document.getElementById('historyList').innerHTML = `<div class="empty-state"><h3>Couldn't load history</h3></div>`;
  }
}

// Groups a timestamp into a friendly day label - Today/Tomorrow for the
// near term, then the weekday name, falling back to a full date once
// it's far enough out that "which Wednesday" would be ambiguous.
function calendarDayLabel(timestampMs) {
  const date = new Date(timestampMs);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfDate - startOfToday) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

async function pageCalendar(root) {
  if (!Store.activeProfile) { location.hash = '#/switch-profile'; return; }
  if (Store.anime.length === 0) await Store.loadLibrary();
  root.innerHTML = `
    ${renderNavbar('calendar')}
    <div class="page-wrap">
      <div class="page-header"><h1>Calendar</h1></div>
      <div id="calendarList"><div class="loading-spin" style="margin:30px auto"></div></div>
    </div>`;
  wireNavbar();

  try {
    const { upcoming } = await API.getCalendar();
    const listEl = document.getElementById('calendarList');
    if (!upcoming || upcoming.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><h3>Nothing airing soon</h3><p>Add ongoing shows to My List or Top Picks, and their upcoming episodes will show up here.</p></div>`;
      return;
    }
    // Groups consecutive entries under the same day label into one
    // heading, rather than repeating "Today" above every single row.
    let lastLabel = null;
    listEl.innerHTML = upcoming.map((ep) => {
      const label = calendarDayLabel(ep.airingAt);
      const heading = label !== lastLabel ? `<h2 class="row-title" style="margin-top:24px">${escapeHtml(label)}</h2>` : '';
      lastLabel = label;
      const cover = ep.coverUrl || '/img/placeholder-poster.svg';
      const time = new Date(ep.airingAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return `${heading}
      <div class="episode-row" data-nav="#/title/${ep.showId}">
        <img class="episode-thumb" src="${escapeHtml(cover)}" alt="" style="border-radius:6px"/>
        <div class="episode-info">
          <div class="episode-title">${escapeHtml(ep.title)}</div>
          <div class="episode-file">Episode ${ep.episode} &middot; ${time}</div>
        </div>
      </div>`;
    }).join('');
    wireCardNav(listEl);
  } catch (e) {
    document.getElementById('calendarList').innerHTML = `<div class="empty-state"><h3>Couldn't load the calendar</h3><p>${escapeHtml(e.message || '')}</p></div>`;
  }
}

async function pageGenres(root) {
  await Store.loadLibrary();
  const genres = collectAllGenres();
  root.innerHTML = `
    ${renderNavbar('genres')}
    <div class="page-wrap">
      <div class="page-header"><h1>Genres</h1></div>
      ${genres.length === 0
        ? `<div class="empty-state"><h3>No genre info yet</h3><p>Genres come from each title's <code>info.json</code>, or automatically via MyAnimeList import.</p></div>`
        : `<div class="genre-pill-grid">${genres.map(({ genre, count }) => `
            <a class="genre-pill" href="#/genre/${encodeURIComponent(genre)}">
              <span>${escapeHtml(genre)}</span>
              <span class="genre-pill-count">${count}</span>
            </a>`).join('')}</div>`}
    </div>`;
  wireNavbar();
}

async function pageGenreGrid(root, genreName) {
  await Store.loadLibrary();
  const matches = Store.filterForActiveProfile(
    [...Store.anime, ...Store.movies, ...Store.manga].filter((item) => (item.genres || []).includes(genreName))
  );
  root.innerHTML = `
    ${renderNavbar('genres')}
    <div class="page-wrap">
      <div class="page-header">
        <h1>${escapeHtml(genreName)}</h1>
        <a href="#/genres" class="btn-ghost">&larr; All Genres</a>
      </div>
      <div class="grid" id="genreGridContent">
        ${matches.length === 0
          ? `<div class="empty-state"><h3>Nothing in this genre yet</h3></div>`
          : matches.map((item) => item.chapterCount !== undefined ? mangaCardHTML(item) : animeCardHTML(item, { tall: true })).join('')}
      </div>
    </div>`;
  wireNavbar();
  wireCardNav(document.getElementById('genreGridContent'));
}

// Everything in the local library from a given studio - the studio
// name/filter dropdown already existed, but there was no way to
// actually land on this view by clicking a studio name anywhere.
async function pageStudioGrid(root, studioName) {
  await Store.loadLibrary();
  const matches = Store.filterForActiveProfile(
    [...Store.anime, ...Store.movies].filter((item) => (item.studios || []).includes(studioName))
  );
  root.innerHTML = `
    ${renderNavbar('')}
    <div class="page-wrap">
      <div class="page-header">
        <h1>${escapeHtml(studioName)}</h1>
      </div>
      <div class="grid" id="studioGridContent">
        ${matches.length === 0
          ? `<div class="empty-state"><h3>Nothing from this studio yet</h3></div>`
          : matches.map((item) => animeCardHTML(item, { tall: true })).join('')}
      </div>
    </div>`;
  wireNavbar();
  wireCardNav(document.getElementById('studioGridContent'));
}

// Everything a specific voice actor or staff member has worked on, in
// the local library - matched by their exact AniList person id, not
// just anyone sharing their name. The name in the URL is shown
// immediately for a fast page title while the actual credit list (and
// the API's own copy of the name) loads over the network.
async function pagePersonCredits(root, personId, nameFromUrl) {
  await Store.loadLibrary();
  root.innerHTML = `
    ${renderNavbar('')}
    <div class="page-wrap">
      <div class="page-header"><h1>${escapeHtml(nameFromUrl || 'Loading...')}</h1></div>
      <div class="grid" id="personCreditsContent"><div class="loading-spin" style="margin:30px auto"></div></div>
    </div>`;
  wireNavbar();

  try {
    const { name, credits } = await API.getPersonCredits(personId);
    if (name) document.querySelector('.page-header h1').textContent = name;
    const shows = credits.map((c) => Store.findAnime(c.localShowId)).filter(Boolean);
    const contentEl = document.getElementById('personCreditsContent');
    contentEl.innerHTML = shows.length === 0
      ? `<div class="empty-state"><h3>Nothing else by them in your library yet</h3></div>`
      : shows.map((s) => animeCardHTML(s, { tall: true })).join('');
    wireCardNav(contentEl);
  } catch (e) {
    document.getElementById('personCreditsContent').innerHTML = `<div class="empty-state"><h3>Couldn't load credits</h3></div>`;
  }
}

async function pageSearch(root) {
  if (Store.anime.length === 0) await Store.loadLibrary();
  const genres = collectAllGenres();
  const allStudios = [...new Set(Store.filterForActiveProfile([...Store.anime, ...Store.movies]).flatMap((s) => s.studios || []))].sort();
  root.innerHTML = `
    ${renderNavbar('')}
    <div class="page-wrap">
      <div class="page-header"><h1>Search</h1></div>
      <div class="filter-bar" style="margin-bottom:18px;flex-wrap:wrap">
        <div class="field" style="max-width:420px;margin:0;flex:1;min-width:220px"><input type="text" id="searchInput" placeholder="Search anime, movies & manga..." autofocus/></div>
        <select id="searchGenreFilter">
          <option value="">All Genres</option>
          ${genres.map(({ genre }) => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`).join('')}
        </select>
        <select id="searchStudioFilter">
          <option value="">All Studios</option>
          ${allStudios.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
        </select>
        <select id="searchSort">
          <option value="relevance">Best Match</option>
          <option value="az">A-Z</option>
          <option value="newest">Recently Added</option>
        </select>
        <label class="filter-checkbox-label">
          <input type="checkbox" id="searchDubOnly"/> Dub Only
        </label>
      </div>
      <div id="recentSearchesWrap" style="display:none;margin-bottom:18px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="color:var(--text-faint);font-size:12.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Recent Searches</span>
          <button class="btn-ghost" id="clearRecentSearchesBtn" style="padding:4px 10px;font-size:12px">Clear</button>
        </div>
        <div class="genre-chips" id="recentSearchesChips"></div>
      </div>
      <div class="grid" id="searchResults"></div>
    </div>`;
  wireNavbar();
  const input = document.getElementById('searchInput');
  const genreFilter = document.getElementById('searchGenreFilter');
  const studioFilter = document.getElementById('searchStudioFilter');
  const sortSelect = document.getElementById('searchSort');
  const dubOnlyFilter = document.getElementById('searchDubOnly');
  const results = document.getElementById('searchResults');
  const recentWrap = document.getElementById('recentSearchesWrap');
  const recentChips = document.getElementById('recentSearchesChips');
  let searchHistory = [];

  async function loadRecentSearches() {
    if (!Store.activeProfile) return;
    try {
      const { history } = await API.getSearchHistory(Store.activeProfile.id);
      searchHistory = history || [];
      renderRecentChips();
    } catch (e) { /* not worth a toast for a below-the-fold extra */ }
  }
  function renderRecentChips() {
    const showChips = searchHistory.length > 0 && !input.value.trim();
    recentWrap.style.display = showChips ? '' : 'none';
    if (!showChips) return;
    recentChips.innerHTML = searchHistory.map((q) => `<button class="genre-chip" data-recent-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('');
    recentChips.querySelectorAll('[data-recent-q]').forEach((btn) => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.recentQ;
        runSearch();
        recentWrap.style.display = 'none';
      });
    });
  }
  document.getElementById('clearRecentSearchesBtn').addEventListener('click', async () => {
    searchHistory = [];
    renderRecentChips();
    if (Store.activeProfile) await API.clearSearchHistory(Store.activeProfile.id).catch(() => {});
  });
  loadRecentSearches();

  // Only records a genuine, settled query - not every keystroke, and
  // not anything trivially short that's more likely mid-typing than an
  // actual finished search term.
  let recordSearchTimer = null;
  function scheduleRecordSearch(q) {
    clearTimeout(recordSearchTimer);
    if (!Store.activeProfile || q.trim().length < 2) return;
    recordSearchTimer = setTimeout(() => {
      API.addSearchHistory(Store.activeProfile.id, q.trim()).catch(() => {});
    }, 1200);
  }

  function runSearch() {
    const q = input.value.trim().toLowerCase();
    renderRecentChips();
    scheduleRecordSearch(q);
    const genre = genreFilter.value;
    const studio = studioFilter.value;
    const sort = sortSelect.value;
    const dubOnly = dubOnlyFilter.checked;
    if (!q && !genre && !studio && !dubOnly) { results.innerHTML = ''; return; }

    function matches(item) {
      // Typing a studio name (e.g. "MAPPA") matches by title too - a
      // studio search is really just a search, not a separate mode, so
      // it belongs in the same query box rather than only being
      // reachable through the dropdown.
      const titleOk = !q || item.title.toLowerCase().includes(q) || (item.studios || []).some((s) => s.toLowerCase().includes(q));
      const genreOk = !genre || (item.genres || []).includes(genre);
      const studioOk = !studio || (item.studios || []).includes(studio);
      const dubOk = !dubOnly || item.hasDub === true;
      return titleOk && genreOk && studioOk && dubOk;
    }
    let animeMatches = Store.filterForActiveProfile(Store.anime.filter(matches));
    let movieMatches = Store.filterForActiveProfile(Store.movies.filter(matches));
    let mangaMatches = Store.filterForActiveProfile(Store.manga.filter(matches));

    function applySort(list) {
      if (sort === 'az') return [...list].sort((a, b) => a.title.localeCompare(b.title));
      if (sort === 'newest') return [...list].sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
      return list; // relevance = natural/title-match order
    }
    animeMatches = applySort(animeMatches);
    movieMatches = applySort(movieMatches);
    mangaMatches = applySort(mangaMatches);

    results.innerHTML = animeMatches.map(s => animeCardHTML(s, { tall: true })).join('') + movieMatches.map(s => animeCardHTML(s, { tall: true })).join('') + mangaMatches.map(m => mangaCardHTML(m)).join('');
    if (!results.innerHTML) results.innerHTML = `<div class="empty-state"><h3>No matches</h3></div>`;
    wireCardNav(results);
  }
  input.addEventListener('input', runSearch);
  genreFilter.addEventListener('change', runSearch);
  studioFilter.addEventListener('change', runSearch);
  sortSelect.addEventListener('change', runSearch);
  dubOnlyFilter.addEventListener('change', runSearch);
  input.focus();
}

// ==================== AUTH: LOGIN / FIRST-RUN SETUP ====================
async function pageAuthGate(root) {
  const isFirstRun = !Store.hasAnyAccounts;
  const iconPerson = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>';
  const iconLock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  const iconEye = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  const iconEyeOff = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.6 21.6 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a21.6 21.6 0 0 1-2.16 3.19"/><path d="M1 1l22 22"/><path d="M9.53 9.53a3 3 0 0 0 4.24 4.24"/></svg>';

  root.innerHTML = `
  <div class="login-page io-login">
<header class="io-login-header"><img src="/img/io-logo.svg" alt="I/O"/><span>Every story, your way.</span></header>
<div class="login-card"><div class="io-login-art" role="img" aria-label="I/O mascot with anime and manga"></div><div class="login-form-area">
<img class="io-form-logo" src="/img/io-logo.svg" alt="I/O"/><h1>Welcome to I/O</h1><p class="io-tagline">Every story, your way.</p><p class="io-login-description">Watch anime. Read manga.</p>
        ${isFirstRun ? `
          <h2 class="login-heading">Create the admin account</h2>
          <p class="auth-subtitle">This first account manages the media library and can add accounts for everyone else in your household.</p>
        ` : ''}
        <div id="authFormView">
          <form id="authForm" class="login-form">
            <div class="login-field">
              <span class="login-field-icon">${iconPerson}</span>
              <input type="text" id="authUsername" aria-label="Username" placeholder="${isFirstRun ? 'Choose a username' : 'Username'}" autocomplete="username" required/>
            </div>
            <div class="login-field">
              <span class="login-field-icon">${iconLock}</span>
              <input type="password" id="authPassword" aria-label="Password" placeholder="Password" autocomplete="${isFirstRun ? 'new-password' : 'current-password'}" required/>
              <button type="button" class="login-field-toggle" id="togglePasswordBtn" aria-label="Show or hide password">${iconEye}</button>
            </div>
            ${!isFirstRun ? `<a href="#" class="forgot-link" id="forgotPasswordLink">Forgot Password?</a>` : ''}
            <div id="adultContentField" class="login-field" style="display:${isFirstRun ? 'flex' : 'none'};align-items:center;gap:10px;background:transparent;border:none;padding:0">
              <input type="checkbox" id="wantsAdultContentInput" checked style="width:16px;height:16px;flex-shrink:0"/>
              <label for="wantsAdultContentInput" style="margin:0;font-size:12.5px;color:var(--text-dim);text-align:left">Show mature/adult-rated titles (R+, Rx, etc.) - can be changed later in Settings</label>
            </div>
            <div id="authError" class="auth-error"></div>
            <button type="submit" class="login-submit-btn" id="authSubmitBtn">${isFirstRun ? 'CREATE ACCOUNT' : 'LOG IN'}</button>
          </form>
          ${!isFirstRun && Store.config.allowSelfRegistration ? `<button class="auth-mode-toggle-link" id="authModeToggleBtn" type="button">New here? Create an account</button>` : ''}
          ${!isFirstRun ? `
          <div class="login-divider">OR</div>
          <button class="login-qr-btn" id="showQrBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z"/></svg>
            Sign in with QR code
          </button>
          ` : ''}
        </div>
        ${!isFirstRun ? `
        <div id="qrView" style="display:none">
          <div class="qr-box" style="background:none;border:none;padding:0">
            <div id="qrCodeHolder" class="qr-code-holder"><div class="loading-spin" style="margin:40px auto"></div></div>
            <div class="qr-instructions">
              On a device that's already signed in: open your avatar menu &rarr; <strong>Sign In Another Device</strong>,
              then scan this code or enter it manually.
            </div>
            <div class="qr-manual-code" id="qrManualCode"></div>
            <div class="qr-status" id="qrStatusText">Waiting for approval&hellip;</div>
          </div>
          <button class="qr-toggle-link" id="backToFormBtn">&#8592; Use username &amp; password instead</button>
        </div>` : ''}
      </div>
    </div>
  </div>`;

  const passwordInput = document.getElementById('authPassword');
  const toggleBtn = document.getElementById('togglePasswordBtn');
  toggleBtn.addEventListener('click', () => {
    const showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    toggleBtn.innerHTML = showing ? iconEye : iconEyeOff;
  });
  const forgotLink = document.getElementById('forgotPasswordLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      showToast("Ask an admin to help you sign in - there's no self-serve email reset on a self-hosted server.");
    });
  }

  const form = document.getElementById('authForm');
  const errEl = document.getElementById('authError');
  let creatingAccount = false; // separate from isFirstRun - this toggles the same form between "log in" and "self-register" for anyone after the first admin account
  const authModeToggleBtn = document.getElementById('authModeToggleBtn');
  const authUsernameInput = document.getElementById('authUsername');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const adultContentField = document.getElementById('adultContentField');
  if (authModeToggleBtn) {
    authModeToggleBtn.addEventListener('click', () => {
      creatingAccount = !creatingAccount;
      authSubmitBtn.textContent = creatingAccount ? 'CREATE ACCOUNT' : 'LOG IN';
      authUsernameInput.placeholder = creatingAccount ? 'Choose a username' : 'Username';
      authModeToggleBtn.textContent = creatingAccount ? 'Already have an account? Log in' : 'New here? Create an account';
      if (adultContentField) adultContentField.style.display = creatingAccount ? 'flex' : 'none';
      errEl.textContent = '';
    });
  }
  function showTotpStep(username, password) {
    const view = document.getElementById('authFormView');
    view.innerHTML = `
      <h2 class="login-heading">Two-factor code</h2>
      <p class="auth-subtitle">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
      <form id="totpForm" class="login-form">
        <div class="login-field">
          <span class="login-field-icon">${iconLock}</span>
          <input type="text" id="totpCodeInput" placeholder="123456" autocomplete="one-time-code" inputmode="numeric" autofocus required/>
        </div>
        <div id="totpError" class="auth-error"></div>
        <button type="submit" class="login-submit-btn" id="totpSubmitBtn">VERIFY</button>
      </form>
      <button class="auth-mode-toggle-link" id="totpBackBtn" type="button">&larr; Back</button>
    `;
    document.getElementById('totpBackBtn').addEventListener('click', () => { pageAuthGate(root); });
    const totpForm = document.getElementById('totpForm');
    const totpErrEl = document.getElementById('totpError');
    totpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      totpErrEl.textContent = '';
      const code = document.getElementById('totpCodeInput').value.trim();
      const btn = document.getElementById('totpSubmitBtn');
      btn.disabled = true;
      try {
        await API.login(username, password, code);
        await Store.init();
        location.hash = '#/';
        renderApp();
      } catch (err) {
        totpErrEl.textContent = err.message;
        btn.disabled = false;
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    const btn = document.getElementById('authSubmitBtn');
    btn.disabled = true;
    try {
      if (isFirstRun || creatingAccount) {
        const wantsAdultContent = document.getElementById('wantsAdultContentInput') ? document.getElementById('wantsAdultContentInput').checked : true;
        const result = await API.register(username, password, undefined, wantsAdultContent);
        if (result.pendingApproval) {
          document.getElementById('authFormView').innerHTML = `<div class="empty-state" style="padding:20px 0"><h3>Account created</h3><p>An admin needs to approve your account before you can sign in. Check back once they have.</p></div>`;
          return;
        }
      } else {
        const result = await API.login(username, password);
        if (result && result.requiresTotp) {
          showTotpStep(username, password);
          return;
        }
      }
      await Store.init();
      location.hash = '#/';
      renderApp();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
    }
  });

  if (isFirstRun) return;

  // ---- QR code sign-in ----
  const authFormView = document.getElementById('authFormView');
  const qrView = document.getElementById('qrView');
  const showQrBtn = document.getElementById('showQrBtn');
  const backToFormBtn = document.getElementById('backToFormBtn');
  let pollTimer = null;

  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

  showQrBtn.addEventListener('click', async () => {
    authFormView.style.display = 'none';
    qrView.style.display = 'block';
    await startQrPairing();
  });
  backToFormBtn.addEventListener('click', () => {
    stopPolling();
    qrView.style.display = 'none';
    authFormView.style.display = 'block';
  });

  async function startQrPairing() {
    const holder = document.getElementById('qrCodeHolder');
    const statusText = document.getElementById('qrStatusText');
    statusText.textContent = 'Waiting for approval\u2026';
    try {
      const { code } = await API.qrStart();
      const pairUrl = `${location.origin}/#/pair/${code}`;
      holder.innerHTML = IOQR.toSVG(pairUrl, { moduleSize: 6, margin: 3 });
      document.getElementById('qrManualCode').textContent = code;

      pollTimer = setInterval(async () => {
        try {
          const result = await API.qrStatus(code);
          if (result.status === 'approved') {
            stopPolling();
            statusText.textContent = 'Approved! Signing in\u2026';
            await Store.init();
            location.hash = '#/';
            renderApp();
          } else if (result.status === 'denied') {
            stopPolling();
            statusText.textContent = 'Sign-in was denied on the other device.';
          } else if (result.status === 'expired') {
            stopPolling();
            statusText.textContent = 'This code expired. Generating a new one\u2026';
            setTimeout(startQrPairing, 1200);
          }
        } catch (e) { /* transient network hiccup - keep polling */ }
      }, 2000);
    } catch (e) {
      holder.innerHTML = `<div class="qr-error">Couldn't generate a code: ${escapeHtml(e.message)}</div>`;
    }
  }

  window.addEventListener('hashchange', stopPolling, { once: true });
}

// ==================== QR PAIRING APPROVAL (scanned on an already signed-in device) ====================
async function pageApprovePairing(root, code) {
  if (!Store.account) {
    root.innerHTML = `
    <div class="gate">
      <div class="gate-logo-image"><img src="/img/io-logo.svg" alt="${escapeHtml(Store.config.siteName)}"/></div>
      <h2>Sign in first</h2>
      <p class="auth-subtitle">Sign in on this device, then reopen this link (or scan the code again) to approve the other device.</p>
      <a class="btn btn-primary" href="#/">Go to Sign In</a>
    </div>`;
    return;
  }
  root.innerHTML = `
  <div class="gate">
    <div class="gate-logo-image"><img src="/img/io-logo.svg" alt="${escapeHtml(Store.config.siteName)}"/></div>
    <h2>Sign in another device?</h2>
    <p class="auth-subtitle">A device is waiting to sign in as <strong>@${escapeHtml(Store.account.username)}</strong>.<br/>Only approve this if it's really you.</p>
    <div id="pairResult"></div>
    <div class="gate-actions">
      <button class="btn btn-primary" id="approvePairBtn" style="border:none">Approve</button>
      <button id="denyPairBtn">Deny</button>
    </div>
  </div>`;

  document.getElementById('approvePairBtn').addEventListener('click', async () => {
    try {
      await API.qrApprove(code);
      document.getElementById('pairResult').innerHTML = `<p class="auth-subtitle" style="color:#4ade80">Approved! The other device should sign in automatically.</p>`;
      document.querySelector('.gate-actions').style.display = 'none';
    } catch (e) {
      document.getElementById('pairResult').innerHTML = `<p class="auth-error">${escapeHtml(e.message)}</p>`;
    }
  });
  document.getElementById('denyPairBtn').addEventListener('click', async () => {
    await API.qrDeny(code).catch(() => {});
    location.hash = '#/';
  });
}

// ==================== MANAGE ACCOUNTS (admin only) ====================
// ==================== ADMIN DASHBOARD ====================
async function pageAdminDashboard(root) {
  if (!Store.account || Store.account.role !== 'admin') { location.hash = '#/'; return; }
  root.innerHTML = `
    ${renderNavbar('')}
    <div class="page-wrap" style="max-width:900px">
      <div class="page-header"><h1>Admin Dashboard</h1></div>

      <h3 style="margin-bottom:14px">Drive, GPU & playback health</h3><div id="serviceHealth" class="service-health"></div>
      <form id="transcodeLimitsForm" class="health-card" style="margin-bottom:24px">
        <strong>Transcode capacity</strong>
        <label>Software streams <input name="software" type="number" min="1" max="16" required></label>
        <label>GPU streams <input name="hardware" type="number" min="1" max="32" required></label>
        <label>Maximum queued requests <input name="maxQueue" type="number" min="1" max="100" required></label>
        <label>Queue deadline (seconds) <input name="timeoutSeconds" type="number" min="1" max="120" required></label>
        <small>Set limits from measured throughput. Higher limits can increase buffering.</small>
        <button class="btn-ghost" type="submit">Save capacity limits</button>
      </form>
      <h3 style="margin-bottom:14px">Server Resources</h3>
      <div class="stats-grid" id="statsGrid">
        <div class="loading-spin" style="margin:30px auto"></div>
      </div>

      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin-bottom:6px">Active Sessions</h3>
        <p style="font-size:12.5px;color:var(--text-faint);margin-bottom:14px">
          Every signed-in session across every account on this server. Revoking one signs that
          device out immediately.
        </p>
        <div id="allSessionsList"><div class="loading-spin" style="margin:20px auto"></div></div>
      </div>

      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin-bottom:6px">Backups</h3>
        <p style="font-size:12.5px;color:var(--text-faint);margin-bottom:14px">
          A snapshot of the database - accounts, profiles, watch history, everything that exists
          nowhere else (your media files aren't included; they're already your own copies). One is
          taken automatically every day; the last 7 are kept. Download one somewhere safe now and
          then - restoring is just replacing <code>io.db</code> in the data folder with a
          downloaded copy while the server is stopped.
        </p>
        <button class="btn-ghost" id="createBackupBtn" style="margin-bottom:14px">Create Backup Now</button>
        <div id="backupsList"><div class="loading-spin" style="margin:20px auto"></div></div>
      </div>

      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin-bottom:6px">Curated Rows</h3>
        <p style="font-size:12.5px;color:var(--text-faint);margin-bottom:14px">
          Hand-picked home page rows with any name you want - "Staff Picks", "Truck Kun's Top
          Picks", anything. Shown to every profile, alongside the automatic rows.
        </p>
        <div style="display:flex;gap:10px;margin-bottom:14px">
          <input type="text" id="newCuratedRowInput" placeholder="New row name..." style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:6px;flex:1"/>
          <button class="btn-ghost" id="createCuratedRowBtn">Create Row</button>
        </div>
        <div id="curatedRowsList"><div class="loading-spin" style="margin:20px auto"></div></div>
      </div>

      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin-bottom:6px">Needs Attention</h3>
        <p style="font-size:12.5px;color:var(--text-faint);margin-bottom:14px">
          Titles the last MyAnimeList sync couldn't confidently match on its own, with why. Select
          any of them to bulk-retag genres, or retry the whole batch (useful after tweaking a
          folder name).
        </p>
        <button class="btn-ghost" id="retryEnrichmentBtn" style="margin-bottom:14px">Retry Enrichment</button>
        <button class="btn-ghost" id="fillMissingMetadataBtn" style="margin-bottom:14px;margin-left:10px" title="Fills in studio and cast info on titles that already matched MAL/AniList but are missing one or both">Fill Missing Studio/Cast Info</button>
        <div id="needsAttentionList"><div class="loading-spin" style="margin:20px auto"></div></div>
        <div id="bulkGenreBar" style="display:none;margin-top:14px;gap:10px;align-items:center" >
          <input type="text" id="bulkGenreInput" placeholder="Genre name" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:6px;flex:1"/>
          <button class="btn-ghost" id="bulkAddGenreBtn">Add to Selected</button>
          <button class="btn-ghost" id="bulkRemoveGenreBtn">Remove from Selected</button>
        </div>
      </div>

      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin-bottom:6px">Duplicate Series</h3>
        <p style="font-size:12.5px;color:var(--text-faint);margin-bottom:14px">
          The same series scanned into more than one folder - usually a rename, a re-download, or a
          folder that never got merged with an existing one. Grouped by the strongest signal
          available: a shared AniList/MAL match is close to certain proof; a matching title (for
          titles that never matched either) is a weaker hint worth a manual look.
        </p>
        <div id="duplicateSeriesList"><div class="loading-spin" style="margin:20px auto"></div></div>
      </div>

      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin-bottom:6px">Profile Icons</h3>
        <p style="font-size:12.5px;color:var(--text-faint);margin-bottom:14px">
          Add your own images to the set everyone can pick from when choosing a profile icon.
          Stored separately from the app itself, so they're never lost when updating to a new version.
        </p>
        <input type="file" id="galleryUploadInput" accept="image/*" style="display:none"/>
        <button class="btn-ghost" id="galleryUploadBtn" style="margin-bottom:14px">Add Icon</button>
        <div id="adminGalleryList" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:10px"></div>
      </div>
    </div>`;
  wireNavbar();

  async function loadBackups() {
    const listEl = document.getElementById('backupsList');
    try {
      const backups = await API.getBackups();
      if (backups.length === 0) {
        listEl.innerHTML = `<div style="color:var(--text-faint);font-size:13px">No backups yet - the first automatic one is taken shortly after startup.</div>`;
        return;
      }
      listEl.innerHTML = backups.map((b) => `
        <div class="episode-row" style="align-items:center">
          <div class="episode-info">
            <div class="episode-title">${new Date(b.createdAt).toLocaleString()}</div>
            <div class="episode-file">${(b.sizeBytes / 1024 / 1024).toFixed(1)} MB</div>
          </div>
          <a class="btn-ghost" href="/api/admin/backup-download/${encodeURIComponent(b.file)}" download>Download</a>
        </div>`).join('');
    } catch (e) {
      listEl.innerHTML = `<div style="color:var(--text-faint);font-size:13px">Couldn't load backups.</div>`;
    }
  }
  loadBackups();
  document.getElementById('createBackupBtn').addEventListener('click', async () => {
    try {
      await API.createBackup();
      showToast('Backup created');
      loadBackups();
    } catch (e) { showToast(e.message); }
  });

  async function loadCuratedRows() {
    const listEl = document.getElementById('curatedRowsList');
    try {
      const rows = await API.getCuratedRows();
      if (rows.length === 0) {
        listEl.innerHTML = `<div style="color:var(--text-faint);font-size:13px">No curated rows yet - create one above.</div>`;
        return;
      }
      listEl.innerHTML = rows.map((row) => `
        <div class="episode-row" style="align-items:center">
          <div class="episode-info">
            <div class="episode-title">${escapeHtml(row.title)}</div>
            <div class="episode-file">${row.items.length} title${row.items.length === 1 ? '' : 's'}</div>
          </div>
          <button class="btn-ghost" data-manage-row="${row.id}">Manage Titles</button>
          <button class="btn-ghost" data-rename-row="${row.id}" data-current-title="${escapeHtml(row.title)}">Rename</button>
          <button class="btn-ghost" data-delete-row="${row.id}">Delete</button>
        </div>`).join('');
      listEl.querySelectorAll('[data-manage-row]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (Store.anime.length === 0) await Store.loadLibrary();
          const row = rows.find((r) => r.id === btn.dataset.manageRow);
          openCuratedRowManageModal(row, loadCuratedRows);
        });
      });
      listEl.querySelectorAll('[data-rename-row]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const next = prompt('Rename row to:', btn.dataset.currentTitle);
          if (!next || !next.trim()) return;
          try { await API.renameCuratedRow(btn.dataset.renameRow, next.trim()); loadCuratedRows(); }
          catch (e) { showToast(e.message); }
        });
      });
      listEl.querySelectorAll('[data-delete-row]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this row? The titles in it stay in your library - only the row itself goes away.')) return;
          try { await API.deleteCuratedRow(btn.dataset.deleteRow); loadCuratedRows(); }
          catch (e) { showToast(e.message); }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div style="color:var(--text-faint);font-size:13px">Couldn't load.</div>`;
    }
  }
  loadCuratedRows();
  document.getElementById('createCuratedRowBtn').addEventListener('click', async () => {
    const input = document.getElementById('newCuratedRowInput');
    if (!input.value.trim()) { showToast('Enter a row name first'); return; }
    try {
      await API.createCuratedRow(input.value.trim());
      input.value = '';
      loadCuratedRows();
    } catch (e) { showToast(e.message); }
  });

  async function loadNeedsAttention() {
    const listEl = document.getElementById('needsAttentionList');
    const bulkBar = document.getElementById('bulkGenreBar');
    try {
      const { items, enrichmentRunning } = await API.getNeedsAttention();
      if (enrichmentRunning) {
        listEl.innerHTML = `<div style="color:var(--text-faint);font-size:13px">Enrichment is currently running - check back in a bit.</div>`;
        bulkBar.style.display = 'none';
        return;
      }
      if (items.length === 0) {
        listEl.innerHTML = `<div style="color:var(--text-faint);font-size:13px">Nothing needs attention right now.</div>`;
        bulkBar.style.display = 'none';
        return;
      }
      listEl.innerHTML = items.map((item) => `
        <div class="episode-row" style="align-items:center">
          <input type="checkbox" class="needs-attn-check" data-id="${item.id}" data-type="${item.type}" style="width:16px;height:16px;flex-shrink:0"/>
          <div class="episode-info">
            <div class="episode-title">${escapeHtml(item.title)} <span class="handle-badge" style="margin-left:6px">${item.type}</span></div>
            <div class="episode-file">${escapeHtml(item.reason)}</div>
          </div>
          <button class="btn-ghost" data-search="${item.id}" data-searchtype="${item.type}" data-title="${escapeHtml(item.title)}">Search MAL</button>
        </div>`).join('');
      bulkBar.style.display = 'flex';
      listEl.querySelectorAll('[data-search]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const fakeItem = { id: btn.dataset.search, title: btn.dataset.title };
          openMalSearchModal(fakeItem, () => { showToast('Imported'); loadNeedsAttention(); }, btn.dataset.searchtype);
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div style="color:var(--text-faint);font-size:13px">Couldn't load.</div>`;
    }
  }
  loadNeedsAttention();

  async function loadDuplicateSeries() {
    const container = document.getElementById('duplicateSeriesList');
    try {
      const { groups } = await API.getDuplicateSeries();
      if (groups.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding:16px 0"><p style="font-size:13px">No likely duplicates found.</p></div>`;
        return;
      }
      const matchLabel = { anilistId: 'matched the same AniList entry', malId: 'matched the same MAL entry', title: 'same title - not matched to AniList/MAL, so this is a weaker hint' };
      container.innerHTML = groups.map((g) => `
        <div class="episode-row" style="flex-direction:column;align-items:stretch;gap:8px">
          <div style="font-size:12px;color:var(--text-faint)">${escapeHtml(matchLabel[g.matchType] || g.matchType)}</div>
          ${g.shows.map((s) => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
              <div>
                <div class="episode-title">${escapeHtml(s.title)}</div>
                <div class="episode-file">Folder: ${escapeHtml(s.folderName)}</div>
              </div>
              <a href="#/title/${encodeURIComponent(s.id)}" class="btn-ghost" style="flex-shrink:0">View</a>
            </div>
          `).join('')}
        </div>`).join('');
    } catch (e) {
      container.innerHTML = `<div class="empty-state" style="padding:16px 0"><p style="font-size:13px">${escapeHtml(e.message)}</p></div>`;
    }
  }
  loadDuplicateSeries();

  async function loadAdminGallery() {
    const container = document.getElementById('adminGalleryList');
    try {
      const gallery = await API.getAvatarGallery();
      if (gallery.custom.length === 0) {
        container.innerHTML = `<p style="font-size:12.5px;color:var(--text-faint);grid-column:1/-1">No custom icons added yet.</p>`;
        return;
      }
      container.innerHTML = gallery.custom.map((url) => `
        <div style="position:relative">
          <img src="${escapeHtml(url)}" style="width:100%;aspect-ratio:1;border-radius:50%;object-fit:cover"/>
          <button data-delete-icon="${escapeHtml(url.split('/').pop())}" style="position:absolute;top:-4px;right:-4px;width:20px;height:20px;border-radius:50%;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-dim);font-size:11px;line-height:1;cursor:pointer">&times;</button>
        </div>`).join('');
      container.querySelectorAll('[data-delete-icon]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await API.deleteAvatarGalleryIcon(btn.dataset.deleteIcon);
            loadAdminGallery();
          } catch (e) {
            showToast(e.message);
          }
        });
      });
    } catch (e) {
      container.innerHTML = `<p style="font-size:12.5px;color:var(--text-faint);grid-column:1/-1">${escapeHtml(e.message)}</p>`;
    }
  }
  loadAdminGallery();
  const galleryUploadBtn = document.getElementById('galleryUploadBtn');
  const galleryUploadInput = document.getElementById('galleryUploadInput');
  if (galleryUploadBtn) {
    galleryUploadBtn.addEventListener('click', () => galleryUploadInput.click());
    galleryUploadInput.addEventListener('change', async () => {
      const file = galleryUploadInput.files[0];
      if (!file) return;
      try {
        const dataUrl = await resizeImageFile(file, 400, 400, 0.85);
        await API.addAvatarGalleryIcon(dataUrl);
        loadAdminGallery();
        showToast('Icon added');
      } catch (e) {
        showToast(e.message);
      } finally {
        galleryUploadInput.value = '';
      }
    });
  }

  document.getElementById('retryEnrichmentBtn').addEventListener('click', async () => {
    try {
      await API.retryEnrichment();
      showToast('Enrichment started - check back in a bit');
    } catch (e) {
      showToast(e.message);
    }
  });

  document.getElementById('fillMissingMetadataBtn').addEventListener('click', async () => {
    try {
      await API.fillMissingMetadata();
      showToast('Filling in missing studio/cast info - check back in a bit');
    } catch (e) {
      showToast(e.message);
    }
  });

  function getSelectedItems() {
    return [...document.querySelectorAll('.needs-attn-check:checked')].map((c) => ({ id: c.dataset.id, type: c.dataset.type }));
  }
  async function bulkGenre(action) {
    const items = getSelectedItems();
    const genre = document.getElementById('bulkGenreInput').value.trim();
    if (items.length === 0) { showToast('Select at least one title first'); return; }
    if (!genre) { showToast('Enter a genre name'); return; }
    try {
      const result = await API.bulkGenre(items, genre, action);
      showToast(`${action === 'add' ? 'Added to' : 'Removed from'} ${result.updated} title(s)`);
      await Store.loadLibrary({ force: true });
    } catch (e) {
      showToast(e.message);
    }
  }
  document.getElementById('bulkAddGenreBtn').addEventListener('click', () => bulkGenre('add'));
  document.getElementById('bulkRemoveGenreBtn').addEventListener('click', () => bulkGenre('remove'));

  function fmtBytes(bytes) {
    if (bytes == null) return '—';
    const gb = bytes / (1024 ** 3);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
  }
  function fmtUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function barColor(pct) {
    if (pct >= 85) return '#f87171';
    if (pct >= 60) return '#fbbf24';
    return 'var(--accent)';
  }

  async function loadStats() {
    try {
      const s = await API.getSystemStats();
      const ramPct = s.totalMemBytes ? (s.usedMemBytes / s.totalMemBytes) * 100 : 0;
      document.getElementById('statsGrid').innerHTML = `
        <div class="stat-card">
          <div class="stat-label">CPU Usage</div>
          <div class="stat-value">${s.cpuPercent}%</div>
          <div class="stat-bar"><span style="width:${s.cpuPercent}%;background:${barColor(s.cpuPercent)}"></span></div>
          <div class="stat-sub">${s.cpuCount} core${s.cpuCount === 1 ? '' : 's'} &middot; ${escapeHtml(s.cpuModel)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Memory Usage</div>
          <div class="stat-value">${fmtBytes(s.usedMemBytes)} <span style="font-size:13px;color:var(--text-faint)">/ ${fmtBytes(s.totalMemBytes)}</span></div>
          <div class="stat-bar"><span style="width:${ramPct}%;background:${barColor(ramPct)}"></span></div>
          <div class="stat-sub">I/O itself: ${fmtBytes(s.processMemBytes)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">This Process's CPU</div>
          <div class="stat-value">${s.processCpuPercent}%</div>
          <div class="stat-sub">Server uptime: ${fmtUptime(s.uptimeSeconds)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active Transcodes</div>
          <div class="stat-value">${s.transcode.running} <span style="font-size:13px;color:var(--text-faint)">/ ${s.transcode.maxConcurrent} max</span></div>
          <div class="stat-sub">${s.transcode.queued > 0 ? `${s.transcode.queued} waiting for a free slot` : 'Uses configured software/GPU limits'}</div>
        </div>`;
    } catch (e) {
      document.getElementById('statsGrid').innerHTML = `<div style="color:var(--text-faint);font-size:13px">Couldn't load system stats.</div>`;
    }
  }

  async function loadSessions() {
    const listEl = document.getElementById('allSessionsList');
    try {
      const sessions = await API.listAllSessions();
      listEl.innerHTML = sessions.map((s) => `
        <div class="episode-row" style="align-items:center">
          <div class="episode-info">
            <div class="episode-title">
              @${escapeHtml(s.username)} ${s.role === 'admin' ? '<span class="handle-badge" style="margin-left:6px">Admin</span>' : ''}
              ${s.isCurrent ? '<span class="handle-badge" style="margin-left:6px">This session</span>' : ''}
            </div>
            <div class="episode-file">${escapeHtml(s.device)} &middot; last active ${s.lastSeen ? new Date(s.lastSeen).toLocaleString() : 'unknown'}</div>
          </div>
          ${!s.isCurrent ? `<button class="btn-danger" data-revoke="${s.id}">Revoke</button>` : ''}
        </div>`).join('') || `<div style="color:var(--text-faint);font-size:13px">No active sessions.</div>`;
      listEl.querySelectorAll('[data-revoke]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Revoke this session? That device will be signed out immediately.')) return;
          await API.revokeAnySession(btn.dataset.revoke).catch(() => {});
          showToast('Session revoked');
          loadSessions();
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div style="color:var(--text-faint);font-size:13px">Couldn't load sessions.</div>`;
    }
  }

  loadStats();
  loadSessions();
  async function loadHealth() {
    try {
      const health = await API._fetch('/api/admin/health');
      const target = document.getElementById('serviceHealth'); if (!target) return;
      const form = document.getElementById('transcodeLimitsForm');
      if (!form.dataset.loaded) {
        for (const key of ['software', 'hardware', 'maxQueue']) form.elements[key].value = health.transcode[key];
        form.elements.timeoutSeconds.value = health.transcode.timeoutMs / 1000; form.dataset.loaded = '1';
      }
      target.innerHTML = health.drives.map(drive => `<div class="health-card ${drive.state === 'ready' ? 'healthy' : 'degraded'}"><strong>${escapeHtml(drive.kind)}</strong><span>${escapeHtml(drive.state || 'not scanned')} · ${drive.titles} saved titles</span><small>${escapeHtml(drive.path)}</small><small>Last successful scan: ${drive.lastSuccessAt ? new Date(drive.lastSuccessAt).toLocaleString() : 'none yet'}</small>${drive.message ? `<small>${escapeHtml(drive.message)}</small>` : ''}</div>`).join('') +
        `<div class="health-card"><strong>GPU / encoder</strong><span>${escapeHtml(health.gpu.encoder.label || health.gpu.encoder.type || 'unknown')}</span><small>${health.gpu.available ? health.gpu.devices.map(gpu => escapeHtml(`${gpu.name}: ${gpu.utilizationPercent ?? '?'}% load, ${gpu.usedMiB ?? '?'}/${gpu.totalMiB ?? '?'} MiB, ${gpu.temperatureC ?? '?'}°C`)).join('<br>') : escapeHtml(health.gpu.note || 'Live utilization unavailable')}</small><small>Transcodes: ${health.transcode.running}/${health.transcode.maxConcurrent} · ${health.transcode.queued} queued · queue deadline ${health.transcode.timeoutMs / 1000}s</small></div>` +
        `<div class="health-card"><strong>Playback · last 30 minutes</strong><span>${health.playback.samples} measured sessions</span><small>Median startup: ${health.playback.medianStartupMs == null ? 'no data' : (health.playback.medianStartupMs / 1000).toFixed(2) + 's'} · p95: ${health.playback.p95StartupMs == null ? 'no data' : (health.playback.p95StartupMs / 1000).toFixed(2) + 's'}</small><small>${health.playback.stalls} buffering events · ${(health.playback.stallMs / 1000).toFixed(1)}s buffering · ${health.playback.droppedFrames} dropped frames · ${health.playback.errors} errors</small></div>`;
    } catch { const target = document.getElementById('serviceHealth'); if (target) target.textContent = 'Health data could not be loaded. Retry shortly.'; }
  }
  document.getElementById('transcodeLimitsForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true;
    try {
      const limits = Object.fromEntries(['software', 'hardware', 'maxQueue'].map(key => [key, Number(form.elements[key].value)]));
      limits.timeoutMs = Number(form.elements.timeoutSeconds.value) * 1000;
      await API.updateConfig({ transcodeLimits: limits }); showToast('Transcode limits saved'); loadHealth();
    } catch (error) { showToast(error.message); } finally { button.disabled = false; }
  });
  loadHealth(); const healthTimer = setInterval(loadHealth, 4000);
  window.addEventListener('hashchange', () => clearInterval(healthTimer), { once: true });
  const statsTimer = setInterval(loadStats, 4000);
  const sessionsTimer = setInterval(loadSessions, 10000);
  window.addEventListener('hashchange', () => { clearInterval(statsTimer); clearInterval(sessionsTimer); }, { once: true });
}

async function pageManageAccounts(root) {
  if (!Store.account || Store.account.role !== 'admin') { location.hash = '#/'; return; }
  root.innerHTML = `
    ${renderNavbar('')}
    <div class="page-wrap" style="max-width:640px">
      <div class="page-header"><h1>Manage Accounts</h1></div>
      <div id="pendingAccountsWrap" style="display:none;margin-bottom:24px">
        <h3 style="margin-bottom:6px">Pending Approval</h3>
        <p style="font-size:12.5px;color:var(--text-faint);margin-bottom:14px">These self-registered accounts can't sign in yet.</p>
        <div id="pendingAccountsList"></div>
      </div>
      <div id="accountsList"></div>
      <div style="margin-top:28px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin-bottom:14px">Add an account</h3>
        <form id="addAccountForm">
          <div class="field"><label>Username</label><input type="text" id="newUsername" required/></div>
          <div class="field"><label>Password</label><input type="password" id="newPassword" required/></div>
          <div class="field">
            <label>Role</label>
            <select id="newRole" style="background:var(--bg-elevated);border:1px solid var(--border);color:var(--text);padding:9px 14px;border-radius:6px">
              <option value="user">User (watch &amp; read only)</option>
              <option value="admin">Admin (can manage media &amp; settings)</option>
            </select>
          </div>
          <div id="addAccountError" class="auth-error"></div>
          <button type="submit" class="btn btn-primary">Create Account</button>
        </form>
      </div>
    </div>`;
  wireNavbar();

  function paintAccounts(accounts) {
    const pending = accounts.filter((a) => !a.approved);
    const approved = accounts.filter((a) => a.approved);

    const pendingWrap = document.getElementById('pendingAccountsWrap');
    pendingWrap.style.display = pending.length > 0 ? '' : 'none';
    document.getElementById('pendingAccountsList').innerHTML = pending.map(a => `
      <div class="episode-row" style="align-items:center">
        <div class="episode-info">
          <div class="episode-title">${escapeHtml(a.username)}</div>
          <div class="episode-file">Requested ${new Date(a.createdAt).toLocaleDateString()}</div>
        </div>
        <button class="btn btn-primary" data-approve="${a.id}" style="margin-right:8px">Approve</button>
        <button class="btn-danger" data-reject="${a.id}">Reject</button>
      </div>`).join('');

    document.getElementById('accountsList').innerHTML = approved.map(a => `
      <div class="episode-row" style="align-items:center">
        <div class="episode-info">
          <div class="episode-title">${escapeHtml(a.username)} ${a.id === Store.account.id ? '<span class="handle-badge" style="margin-left:6px">You</span>' : ''}</div>
          <div class="episode-file">${a.role === 'admin' ? 'Admin' : 'User'} &middot; joined ${new Date(a.createdAt).toLocaleDateString()}</div>
        </div>
        ${a.id !== Store.account.id ? `
          <select class="role-select" data-id="${a.id}" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;margin-right:8px">
            <option value="user" ${a.role === 'user' ? 'selected' : ''}>User</option>
            <option value="admin" ${a.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
          <button class="btn-ghost" data-reset="${a.id}" data-username="${escapeHtml(a.username)}" style="margin-right:8px">Reset Password</button>
          ${a.adultContentAllowed !== false ? `<button class="btn-ghost" data-restrict-adult="${a.id}" data-username="${escapeHtml(a.username)}" style="margin-right:8px">Restrict Mature Content</button>` : ''}
          <button class="btn-danger" data-del="${a.id}">Delete</button>
        ` : ''}
      </div>`).join('');

    document.querySelectorAll('[data-approve]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.approveAccount(btn.dataset.approve);
          const accounts2 = await API.listAccounts();
          paintAccounts(accounts2);
          showToast('Account approved');
        } catch (e) { showToast(e.message); }
      });
    });
    document.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Reject and delete this pending account?')) return;
        try {
          await API.deleteAccount(btn.dataset.reject);
          const accounts2 = await API.listAccounts();
          paintAccounts(accounts2);
          showToast('Account rejected');
        } catch (e) { showToast(e.message); }
      });
    });
    document.querySelectorAll('.role-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await API.setAccountRole(sel.dataset.id, sel.value);
          showToast('Role updated');
        } catch (e) { showToast(e.message); }
      });
    });
    document.querySelectorAll('[data-reset]').forEach(btn => {
      btn.addEventListener('click', () => {
        openResetPasswordModal(btn.dataset.reset, btn.dataset.username);
      });
    });
    document.querySelectorAll('[data-restrict-adult]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Hide mature/adult-rated content for "${btn.dataset.username}"? Only they can turn it back on, from their own Settings, using their account password.`)) return;
        try {
          await API.restrictAdultContent(btn.dataset.restrictAdult);
          const accounts2 = await API.listAccounts();
          paintAccounts(accounts2);
          showToast(`Mature content hidden for "${btn.dataset.username}"`);
        } catch (e) { showToast(e.message); }
      });
    });
    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this account and all its profiles? This cannot be undone.')) return;
        try {
          await API.deleteAccount(btn.dataset.del);
          const accounts2 = await API.listAccounts();
          paintAccounts(accounts2);
          showToast('Account deleted');
        } catch (e) { showToast(e.message); }
      });
    });
  }

  const accounts = await API.listAccounts();
  paintAccounts(accounts);

  document.getElementById('addAccountForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;
    const errEl = document.getElementById('addAccountError');
    errEl.textContent = '';
    try {
      await API.register(username, password, role);
      showToast('Account created');
      const accounts2 = await API.listAccounts();
      paintAccounts(accounts2);
      e.target.reset();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}
