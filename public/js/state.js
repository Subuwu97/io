const AVAILABLE_AVATARS = Array.from({ length: 8 }, (_, i) => `/img/avatars/avatar${i + 1}.svg`);
const AVAILABLE_BANNERS = Array.from({ length: 6 }, (_, i) => `/img/banners/banner${i + 1}.svg`);

const Store = {
  config: null,
  account: null,
  hasAnyAccounts: false,
  profiles: [],
  activeProfile: null,
  anime: [],
  movies: [],
  manga: [],

  async init() {
    const status = await API.authStatus();
    this.hasAnyAccounts = status.hasAnyAccounts;
    this.account = status.account || null;
    // authStatus always returns siteName/theme even when logged out, so the
    // login screen can be branded before any authenticated request is made.
    this.config = { siteName: status.siteName, theme: status.theme, malClientId: '', mediaPaths: {}, allowSelfRegistration: status.allowSelfRegistration };
    document.title = this.config.siteName;
    applyTheme(this.config.theme);

    if (this.account) {
      await this.loadAfterLogin();
    }
    return this;
  },

  async loadAfterLogin() {
    this.config = await API.getConfig();
    this.profiles = await API.listProfiles();
    this.activeProfile = await API.getActiveProfile().catch(() => null);
    document.title = this.config.siteName;
    applyTheme(this.config.theme);
  },

  // Refetching all three lists on every page navigation re-downloads and
  // re-parses the whole library each time you tap between Home / Series /
  // Movies - noticeable on a big library, and pointless within a short
  // window since the server rescans in the background anyway. Data
  // fetched within the last minute is reused; anything that genuinely
  // changes the library right now (rescan button, MAL import, bulk
  // genre edits) passes { force: true } to skip the window.
  _libraryFetchedAt: 0,
  async loadLibrary(opts = {}) {
    const FRESH_MS = 60 * 1000;
    if (!opts.force && this.anime.length > 0 && Date.now() - this._libraryFetchedAt < FRESH_MS) return;
    const [anime, movies, manga] = await Promise.all([API.listAnime(), API.listMovies(), API.listManga()]);
    this.anime = anime;
    this.movies = movies;
    this.manga = manga;
    this._libraryFetchedAt = Date.now();
  },

  // Series and movies share the same show shape and the same detail/player
  // pages, they just live in separate folders on disk - so anywhere the
  // app needs "the show with this id" (detail page, player, My List,
  // reviews, etc.) checks both lists rather than caring which one it's in.
  findAnime(id) { return this.anime.find(a => a.id === id) || this.movies.find(a => a.id === id); },
  findManga(id) { return this.manga.find(m => m.id === id); },

  // Kids profiles hide anything with a rating string that looks like an
  // explicitly mature/adult classification. Ratings are free-text (some
  // set manually, some pulled from MyAnimeList), so this matches on
  // common keywords rather than a fixed enum - not perfect, but catches
  // the standard "R+", "Rx", "NC-17", "TV-MA" style ratings people
  // actually use for mature content.
  // Only Rx-equivalent content is filtered - R and R+ are considered
  // fine for the base audience, not held back by this at all. hentai
  // and x-rated are kept alongside rx specifically because they're
  // direct synonyms for the same thing, not a separate, lesser
  // category - not because this list is trying to catch anything
  // beyond Rx itself.
  MATURE_RATING_KEYWORDS: ['rx', 'hentai', 'x-rated'],
  isMatureRating(rating) {
    if (!rating) return false;
    const r = String(rating).toLowerCase();
    return this.MATURE_RATING_KEYWORDS.some((kw) => r.includes(kw));
  },
  isKidsActive() {
    // The account itself can act as a master switch, set once at
    // registration (and changeable later in Settings) - if the account
    // says no to adult content at all, every profile under it is
    // treated as effectively "kids" regardless of that specific
    // profile's own isKids setting, on top of - not instead of - a
    // profile's own individual choice.
    if (this.account && this.account.adultContentAllowed === false) return true;
    return !!(this.activeProfile && this.activeProfile.isKids);
  },
  filterForActiveProfile(items) {
    if (!this.isKidsActive()) return items;
    return items.filter((item) => !this.isMatureRating(item.rating));
  },

  isInMyList(itemId, itemType) {
    if (!this.activeProfile) return false;
    return this.activeProfile.myList.includes(`${itemType}:${itemId}`);
  },
  isTopPick(itemId, itemType) {
    if (!this.activeProfile) return false;
    return (this.activeProfile.topPicks || []).includes(`${itemType}:${itemId}`);
  },
};

function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  if (theme.accent) root.style.setProperty('--accent', theme.accent);
  if (theme.accent2) root.style.setProperty('--accent-2', theme.accent2);
  if (theme.background) root.style.setProperty('--bg', theme.background);
}

function showToast(message, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), ms);
}

function fmtDuration(totalSeconds) {
  if (!totalSeconds) return '0m';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtHours(totalSeconds) {
  const hours = (totalSeconds || 0) / 3600;
  return hours < 0.1 && hours > 0 ? '0.1h' : `${hours.toFixed(1)}h`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// WebVTT cues can legitimately contain a small set of real markup tags
// (<b>, <i>, <u>) that should render as actual bold/italic/underline,
// not show up as literal "<b>" text on screen - which is what plain
// escapeHtml() alone would do, since it can't tell "safe WebVTT markup"
// apart from anything else. This escapes everything first (the safe
// default), then selectively un-escapes only that specific known tag
// whitelist - so nothing else in subtitle text can ever inject real
// HTML, only exactly those three formatting tags render as intended.
function renderSubtitleCueText(text) {
  return escapeHtml(text)
    .replace(/&lt;(\/?)(b|i|u)&gt;/gi, '<$1$2>')
    .replace(/\n/g, '<br>');
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Resizes/compresses a user-selected image file in the browser before
// upload, so we never ship multi-megabyte phone photos to the server as
// base64 JSON. Returns a "data:image/jpeg;base64,..." string.
function resizeImageFile(file, maxWidth, maxHeight, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Please choose an image file')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image'));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxWidth / width, maxHeight / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
