const appRoot = document.getElementById('app');

async function renderApp() {
  // Guaranteed cleanup point: whatever page is being left, if a theme
  // song was playing, it stops here - before rendering whatever's next.
  // This is a backup to (not a replacement for) the hashchange listener
  // registered in wireThemeSong itself: that listener only fires
  // reliably when navigating strictly *away* from a show's own page,
  // and only has one single chance to catch it. Centralizing the actual
  // stop here means it's correct regardless of which page comes next,
  // rather than depending on every possible page having its own
  // matching cleanup logic.
  if (typeof stopActiveThemeAudio === 'function') stopActiveThemeAudio();
  // Same reasoning as the theme-audio stop above: whatever page is
  // being left, if HLS playback was active, it needs to actually stop
  // here - hls.js's worker and MediaSource don't get cleaned up on
  // their own just because the video element they were attached to got
  // removed from the DOM. Without this, navigating away from the
  // player kept transcoding/decoding work running in the background
  // indefinitely, which is a very plausible cause of the page feeling
  // like it freezes for a moment on the way back to the series page.
  if (typeof teardownActiveHlsPlayer === 'function') teardownActiveHlsPlayer();

  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\//, '').split('/').filter(Boolean);

  // QR pairing approval works whether or not this device is currently
  // signed in - the page itself shows "sign in first" if needed.
  if (parts[0] === 'pair' && parts[1]) {
    appRoot.innerHTML = '';
    await pageApprovePairing(appRoot, parts[1]);
    return;
  }

  // Outermost gate: no signed-in account -> show login / first-run setup.
  if (!Store.account) {
    appRoot.innerHTML = '';
    await pageAuthGate(appRoot);
    return;
  }

  // Next gate: signed in, but no profile selected yet -> "who's watching".
  const gateExempt = ['switch-profile', 'manage-profiles'];
  if (!Store.activeProfile && !gateExempt.includes(parts[0])) {
    appRoot.innerHTML = renderGate();
    wireGate(appRoot, () => { location.hash = '#/'; renderApp(); });
    return;
  }

  window.scrollTo(0, 0);

  try {
    if (parts.length === 0) {
      await pageHome(appRoot);
    } else if (parts[0] === 'series') {
      await pageGrid(appRoot, 'series');
    } else if (parts[0] === 'movies') {
      await pageGrid(appRoot, 'movies');
    } else if (parts[0] === 'books') {
      await pageGrid(appRoot, 'books');
    } else if (parts[0] === 'new') {
      await pageGrid(appRoot, 'new');
    } else if (parts[0] === 'title' && parts[1]) {
      await pageDetail(appRoot, parts[1]);
    } else if (parts[0] === 'manga' && parts[1]) {
      await pageMangaDetail(appRoot, parts[1]);
    } else if (parts[0] === 'watch' && parts[1] && parts[2]) {
      await pagePlayer(appRoot, parts[1], parts.slice(2).join('/'));
    } else if (parts[0] === 'read' && parts[1] && parts[2]) {
      await pageReader(appRoot, parts[1], parts[2], parts[3] || '1');
    } else if (parts[0] === 'account' && parts[1]) {
      await pageAccount(appRoot, parts[1]);
    } else if (parts[0] === 'settings') {
      await pageSettings(appRoot);
    } else if (parts[0] === 'manage-accounts') {
      await pageManageAccounts(appRoot);
    } else if (parts[0] === 'moderation') {
      await ioPageModeration(appRoot);
    } else if (parts[0] === 'admin-dashboard') {
      await pageAdminDashboard(appRoot);
    } else if (parts[0] === 'search') {
      await pageSearch(appRoot);
    } else if (parts[0] === 'genres') {
      await pageGenres(appRoot);
    } else if (parts[0] === 'genre' && parts[1]) {
      await pageGenreGrid(appRoot, decodeURIComponent(parts[1]));
    } else if (parts[0] === 'studio' && parts[1]) {
      await pageStudioGrid(appRoot, decodeURIComponent(parts[1]));
    } else if (parts[0] === 'person' && parts[1]) {
      await pagePersonCredits(appRoot, parts[1], parts[2] ? decodeURIComponent(parts[2]) : '');
    } else if (parts[0] === 'history') {
      await pageHistory(appRoot);
    } else if (parts[0] === 'calendar') {
      await pageCalendar(appRoot);
    } else if (parts[0] === 'stats') {
      await pageStats(appRoot);
    } else if (parts[0] === 'switch-profile') {
      appRoot.innerHTML = renderGate();
      wireGate(appRoot, () => { location.hash = '#/'; });
    } else if (parts[0] === 'manage-profiles') {
      pageManageProfiles(appRoot);
    } else {
      await pageHome(appRoot);
    }
  } catch (err) {
    console.error(err);
    // If our session expired/was revoked mid-use, bounce back to login
    // instead of showing a raw error screen.
    if (err.status === 401) {
      Store.account = null;
      Store.activeProfile = null;
      renderApp();
      return;
    }
    appRoot.innerHTML = `
      ${Store.config ? renderNavbar('') : ''}
      <div class="page-wrap"><div class="empty-state">
        <h3>Something went wrong</h3>
        <p>${escapeHtml(err.message)}</p>
      </div></div>`;
    if (Store.config) wireNavbar();
  }
}

window.addEventListener('hashchange', renderApp);

// One global fallback handler for every <img> on the site, instead of an
// inline onerror attribute per image (which counts as inline script for
// Content-Security-Policy purposes, and - as it turned out - is easy to
// miss a few of when they're scattered across many call sites). 'error'
// events on <img> don't bubble, but they do fire during the capture
// phase on an ancestor listener, which is what makes one delegated
// listener here work for images anywhere in the page, including ones
// rendered after this listener was attached.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || img.dataset.fallbackApplied) return;
  const fallback = img.dataset.fallback || '/img/placeholder-poster.svg';
  img.dataset.fallbackApplied = '1'; // never retry - a failing fallback must not loop
  img.src = fallback;
}, true);

(async function boot() {
  try {
    await Store.init();
  } catch (e) {
    appRoot.innerHTML = `<div style="padding:60px;color:#f87171;font-family:monospace">
      Failed to reach the ${'"I/O"'} server.<br/>
      Make sure you started it with <code>npm start</code> and are visiting the correct port.<br/><br/>
      ${escapeHtml(e.message)}
    </div>`;
    return;
  }
  renderApp();
})();
