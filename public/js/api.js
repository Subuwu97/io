const API = {
  async _fetch(url, opts) {
    const bar = document.getElementById('topBar');
    bar.classList.add('active');
    try {
      return await this._fetchOnce(url, opts);
    } catch (e) {
      // One quiet retry, only for reads (GETs) and only when the request
      // itself failed to complete (network blip / server momentarily
      // swamped, e.g. mid-scan on slow disks) - a real HTTP error like
      // 401/404 carries a status and is NOT retried. Mutations are never
      // retried: repeating one could double an action.
      const isGet = !opts || !opts.method || opts.method === 'GET';
      if (isGet && e.status === undefined) {
        await new Promise((r) => setTimeout(r, 1200));
        return await this._fetchOnce(url, opts);
      }
      throw e;
    } finally {
      bar.classList.remove('active');
    }
  },

  async _fetchOnce(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const e = new Error(err.error || 'Request failed');
      e.status = res.status;
      throw e;
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  },

  authStatus() { return this._fetch('/api/auth/status'); },
  qrStart() { return this._fetch('/api/auth/qr/start', { method: 'POST' }); },
  qrStatus(code) { return this._fetch(`/api/auth/qr/${code}/status`); },
  qrApprove(code) { return this._fetch(`/api/auth/qr/${code}/approve`, { method: 'POST' }); },
  qrDeny(code) { return this._fetch(`/api/auth/qr/${code}/deny`, { method: 'POST' }); },
  register(username, password, role, wantsAdultContent) {
    return this._fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, role, wantsAdultContent }) });
  },
  login(username, password, totpCode) {
    return this._fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, totpCode }) });
  },
  logout() { return this._fetch('/api/auth/logout', { method: 'POST' }); },
  get2FAStatus() { return this._fetch('/api/auth/2fa/status'); },
  begin2FASetup() { return this._fetch('/api/auth/2fa/setup', { method: 'POST' }); },
  confirm2FASetup(code) {
    return this._fetch('/api/auth/2fa/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  },
  disable2FA(password) {
    return this._fetch('/api/auth/2fa/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  },
  setAdultContent(allowed, password) {
    return this._fetch('/api/auth/adult-content', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed, password }) });
  },
  changePassword(oldPassword, newPassword) {
    return this._fetch('/api/auth/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldPassword, newPassword }) });
  },
  listAccounts() { return this._fetch('/api/accounts'); },
  setAccountRole(id, role) {
    return this._fetch(`/api/accounts/${id}/role`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
  },
  deleteAccount(id) { return this._fetch(`/api/accounts/${id}`, { method: 'DELETE' }); },
  approveAccount(id) { return this._fetch(`/api/accounts/${id}/approve`, { method: 'POST' }); },
  resetAccountPassword(id, newPassword) {
    return this._fetch(`/api/accounts/${id}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword }) });
  },
  restrictAdultContent(id) {
    return this._fetch(`/api/accounts/${id}/restrict-adult-content`, { method: 'POST' });
  },
  listSessions() { return this._fetch('/api/auth/sessions'); },
  revokeSession(id) { return this._fetch(`/api/auth/sessions/${id}`, { method: 'DELETE' }); },
  revokeOtherSessions() { return this._fetch('/api/auth/sessions/revoke-others', { method: 'POST' }); },

  listNotifications() { return this._fetch('/api/notifications'); },
  createNotification(title, message) {
    return this._fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, message }) });
  },
  deleteNotification(id) { return this._fetch(`/api/notifications/${id}`, { method: 'DELETE' }); },
  markNotificationRead(id) { return this._fetch(`/api/notifications/${id}/read`, { method: 'POST' }); },
  markAllNotificationsRead() { return this._fetch('/api/notifications/read-all', { method: 'POST' }); },
  getConfig() { return this._fetch('/api/config'); },
  async updateConfig(patch) {
    const result = await this._fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (result.libraryScanInProgress) {
      try { result.scanResult = await this.waitForLibraryScan(); }
      catch (error) { throw new Error(`Settings were saved. ${error.message}`); }
    }
    return result;
  },
  async waitForLibraryScan() {
    let status;
    do {
      await new Promise(resolve => setTimeout(resolve, 1500));
      status = await this._fetch('/api/admin/library-status');
    } while (status.scanning);
    const failed = Object.entries(status.roots || {}).filter(([, value]) => value.state !== 'ready');
    if (failed.length) throw new Error(`Scan incomplete for ${failed.map(([name]) => name).join(', ')}. The saved library was kept. Check the share connection and server permissions, then retry.`);
    return status;
  },
  async rescan() {
    const result = await this._fetch('/api/rescan', { method: 'POST' });
    return result.scanning ? this.waitForLibraryScan() : result;
  },
  getHwaccelStatus() { return this._fetch('/api/hwaccel-status'); },
  createWatchParty(showId, relPath) {
    return this._fetch('/api/watch-party/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showId, relPath }) });
  },
  getWatchPartyInfo(code) { return this._fetch(`/api/watch-party/${encodeURIComponent(code)}`); },
  getHttpsStatus() { return this._fetch('/api/https-status'); },
  getCacheStatus() { return this._fetch('/api/admin/cache-status'); },
  getBackups() { return this._fetch('/api/admin/backups'); },
  createBackup() { return this._fetch('/api/admin/backup', { method: 'POST' }); },
  getMostWatched() { return this._fetch('/api/stats/most-watched'); },
  getCuratedRows() { return this._fetch('/api/curated-rows'); },
  createCuratedRow(title) { return this._fetch('/api/curated-rows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }); },
  renameCuratedRow(rowId, title) { return this._fetch(`/api/curated-rows/${rowId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }); },
  deleteCuratedRow(rowId) { return this._fetch(`/api/curated-rows/${rowId}`, { method: 'DELETE' }); },
  reorderCuratedRows(orderedIds) { return this._fetch('/api/curated-rows-order', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderedIds }) }); },
  addCuratedRowItem(rowId, itemId, itemType) { return this._fetch(`/api/curated-rows/${rowId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, itemType }) }); },
  removeCuratedRowItem(rowId, itemId, itemType) { return this._fetch(`/api/curated-rows/${rowId}/items/${itemType}/${itemId}`, { method: 'DELETE' }); },
  getLibraryStats(profileId) { return this._fetch(`/api/stats/library${profileId ? '?profileId=' + profileId : ''}`); },
  getNeedsAttention() { return this._fetch('/api/admin/needs-attention'); },
  getDuplicateSeries() { return this._fetch('/api/admin/duplicate-series'); },
  retryEnrichment() { return this._fetch('/api/admin/retry-enrichment', { method: 'POST' }); },
  fillMissingMetadata() { return this._fetch('/api/admin/fill-missing-metadata', { method: 'POST' }); },
  bulkGenre(items, genre, action) {
    return this._fetch('/api/admin/bulk-genre', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, genre, action }) });
  },

  getSystemStats() { return this._fetch('/api/admin/system-stats'); },
  listAllSessions() { return this._fetch('/api/admin/sessions'); },
  revokeAnySession(id) { return this._fetch(`/api/admin/sessions/${id}`, { method: 'DELETE' }); },

  listProfiles() { return this._fetch('/api/profiles'); },
  createProfile(data) {
    return this._fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  },
  updateProfile(id, patch) {
    return this._fetch(`/api/profiles/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  },
  deleteProfile(id) { return this._fetch(`/api/profiles/${id}`, { method: 'DELETE' }); },
  activateProfile(id, pin) {
    return this._fetch(`/api/profiles/${id}/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
  },
  getActiveProfile() { return this._fetch('/api/profiles/active'); },
  toggleMyList(id, itemId, itemType) {
    return this._fetch(`/api/profiles/${id}/mylist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, itemType }) });
  },
  setProgress(id, itemId, episodeRelPath, seconds, duration) {
    return this._fetch(`/api/profiles/${id}/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, episodeRelPath, seconds, duration }) });
  },
  setMangaProgress(id, mangaId, chapterName, page, totalPages) {
    return this._fetch(`/api/profiles/${id}/manga-progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mangaId, chapterName, page, totalPages }) });
  },
  setLanguagePreferences(id, prefs) {
    return this._fetch(`/api/profiles/${id}/language-preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefs) });
  },
  markWatched(id, itemId, itemType, episodeRelPath, episodeTitle, durationSeconds) {
    return this._fetch(`/api/profiles/${id}/watched`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, itemType, episodeRelPath, episodeTitle, durationSeconds }) });
  },
  markUnwatched(id, itemId, episodeRelPath) {
    return this._fetch(`/api/profiles/${id}/watched`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, episodeRelPath }) });
  },
  getWatchHistory(id) { return this._fetch(`/api/profiles/${id}/history`); },
  getTrickplay(showId, relPath) { return this._fetch(`/api/trickplay/${showId}/${encodeURIComponent(relPath)}`); },
  precacheEpisode(showId, relPath, quality, platformHint) {
    const params = new URLSearchParams();
    if (quality && quality !== 'original') params.set('quality', quality);
    if (platformHint) params.set('platformHint', platformHint);
    const qs = params.toString();
    return this._fetch(`/api/precache/${showId}/${encodeURIComponent(relPath)}${qs ? '?' + qs : ''}`, { method: 'POST' });
  },
  hideContinueWatching(id, itemId) {
    return this._fetch(`/api/profiles/${id}/hide-continue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId }) });
  },
  setSubtitleAppearance(id, prefs) {
    return this._fetch(`/api/profiles/${id}/subtitle-appearance`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefs) });
  },
  uploadAvatar(profileId, imageData) {
    return this._fetch(`/api/profiles/${profileId}/avatar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageData }) });
  },
  getAvatarGallery() { return this._fetch('/api/avatar-gallery'); },
  addAvatarGalleryIcon(imageData) {
    return this._fetch('/api/admin/avatar-gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageData }) });
  },
  deleteAvatarGalleryIcon(filename) {
    return this._fetch(`/api/admin/avatar-gallery/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  },
  uploadBanner(profileId, imageData) {
    return this._fetch(`/api/profiles/${profileId}/banner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageData }) });
  },
  toggleTopPick(profileId, itemId, itemType) {
    return this._fetch(`/api/profiles/${profileId}/toppicks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, itemType }) });
  },
  addReview(profileId, itemId, itemType, rating, text) {
    return this._fetch(`/api/profiles/${profileId}/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, itemType, rating, text }) });
  },
  deleteReview(profileId, reviewId) {
    return this._fetch(`/api/profiles/${profileId}/reviews/${reviewId}`, { method: 'DELETE' });
  },
  getReviewsForItem(itemId, itemType) {
    return this._fetch(`/api/reviews/${itemType}/${itemId}`);
  },
  addComment(profileId, text) {
    return this._fetch(`/api/profiles/${profileId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  },
  deleteComment(profileId, commentId) {
    return this._fetch(`/api/profiles/${profileId}/comments/${commentId}`, { method: 'DELETE' });
  },

  listAnime() { return this._fetch('/api/anime?light=1'); },
  listMovies() { return this._fetch('/api/movies?light=1'); },
  getAnime(id) { return this._fetch(`/api/anime/${id}`); },
  getStreamInfo(showId, relPath) { return this._fetch(`/api/streaminfo/${showId}/${relPath.split('/').map(encodeURIComponent).join('/')}`); },
  getEpisodeDurations(showId, groupIndex) { return this._fetch(`/api/episode-durations/${showId}/${groupIndex}`); },
  getCastAndStaff(showId) { return this._fetch(`/api/anime/${showId}/cast`); },
  getRelatedShows(showId) { return this._fetch(`/api/anime/${showId}/related`); },
  getCalendar() { return this._fetch(`/api/calendar`); },
  getPersonCredits(personId) { return this._fetch(`/api/person/${personId}/credits`); },
  addSearchHistory(profileId, query) { return this._fetch(`/api/profiles/${profileId}/search-history`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }); },
  getSearchHistory(profileId) { return this._fetch(`/api/profiles/${profileId}/search-history`); },
  clearSearchHistory(profileId) { return this._fetch(`/api/profiles/${profileId}/search-history`, { method: 'DELETE' }); },
  getEpisodeTitles(showId) { return this._fetch(`/api/anime/${showId}/episode-titles`); },
  getRecentEpisodes(limit) { return this._fetch(`/api/recent-episodes${limit ? `?limit=${limit}` : ''}`); },
  saveSkipPoints(showId, points) { return this._fetch(`/api/anime/${showId}/skip-points`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(points) }); },
  startHlsSession(showId, relPath, opts) {
    const params = new URLSearchParams();
    if (opts && opts.audio != null) params.set('audio', opts.audio);
    if (opts && opts.quality) params.set('quality', opts.quality);
    if (opts && opts.offset) params.set('offset', opts.offset);
    const qs = params.toString();
    return this._fetch(`/api/hls-start/${showId}/${relPath.split('/').map(encodeURIComponent).join('/')}${qs ? '?' + qs : ''}`);
  },
  // A plain URL, not a fetch call - the master playlist gets requested
  // directly by hls.js (or the native video element on Safari), not
  // parsed as JSON by this app's own code.
  getHlsMasterPlaylistUrl(showId, relPath, opts) {
    const params = new URLSearchParams();
    if (opts && opts.audio != null) params.set('audio', opts.audio);
    if (opts && opts.offset) params.set('offset', opts.offset);
    const qs = params.toString();
    return `/api/hls-master/${showId}/${relPath.split('/').map(encodeURIComponent).join('/')}${qs ? '?' + qs : ''}`;
  },

  malSearch(q) { return this._fetch(`/api/mal/search?q=${encodeURIComponent(q)}`); },  importMal(showId, malId, useEnglishTitle) {
    return this._fetch(`/api/anime/${showId}/import-mal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ malId, useEnglishTitle }) });
  },
  malSearchManga(q) { return this._fetch(`/api/mal/search-manga?q=${encodeURIComponent(q)}`); },
  importMalManga(mangaId, malId, useEnglishTitle) {
    return this._fetch(`/api/manga/${mangaId}/import-mal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ malId, useEnglishTitle }) });
  },
  anilistSearch(q) { return this._fetch(`/api/anilist/search?q=${encodeURIComponent(q)}`); },
  importAniList(showId, anilistId, useEnglishTitle) {
    return this._fetch(`/api/anime/${showId}/import-anilist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anilistId, useEnglishTitle }) });
  },
  anilistSearchManga(q) { return this._fetch(`/api/anilist/search-manga?q=${encodeURIComponent(q)}`); },
  importAniListManga(mangaId, anilistId, useEnglishTitle) {
    return this._fetch(`/api/manga/${mangaId}/import-anilist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anilistId, useEnglishTitle }) });
  },

  listManga() { return this._fetch('/api/manga'); },
  getManga(id) { return this._fetch(`/api/manga/${id}`); },
  getMangaPages(id, chapter) { return this._fetch(`/api/manga/${id}/pages/${encodeURIComponent(chapter)}`); },
};
