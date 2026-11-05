// ---------------- Navbar ----------------
function renderNavbar(activeRoute) {
  const p = Store.activeProfile;
  const avatar = p ? p.avatar : AVAILABLE_AVATARS[0];
  const isAdmin = Store.account && Store.account.role === 'admin';
  return `
  <nav class="navbar" id="navbar">
    <div class="nav-left">
      <a href="#/" class="logo-link"><img src="/img/io-logo.svg" class="logo-mark" alt="${escapeHtml(Store.config.siteName)}"/></a>
      <ul class="nav-links">
        <li><a href="#/" class="${activeRoute === 'home' ? 'active' : ''}">Home</a></li>
        <li><a href="#/series" class="${activeRoute === 'series' ? 'active' : ''}">Series</a></li>
        <li><a href="#/movies" class="${activeRoute === 'movies' ? 'active' : ''}">Movies</a></li>
        <li><a href="#/books" class="${activeRoute === 'books' ? 'active' : ''}">Books</a></li>
        <li><a href="#/new" class="${activeRoute === 'new' ? 'active' : ''}">New &amp; Popular</a></li>
        <li><a href="#/genres" class="${activeRoute === 'genres' ? 'active' : ''}">Genres</a></li>
        <li><a href="#/calendar" class="${activeRoute === 'calendar' ? 'active' : ''}">Calendar</a></li>
      </ul>
    </div>
    <div class="nav-right">
      <button class="icon-btn" id="shuffleBtn" title="Surprise Me"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg></button>
      <button class="icon-btn" id="searchBtn" title="Search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg></button>
      <div class="notif-wrap">
        <button class="icon-btn" id="notifBtn" title="Notifications"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span class="notif-badge" id="notifBadge" style="display:none">0</span></button>
        <div class="notif-panel" id="notifPanel">
          <div class="notif-panel-header">
            <span>Notifications</span>
            ${isAdmin ? `<button id="postNotifBtn" class="notif-post-btn" title="Post a notification">+ New</button>` : ''}
          </div>
          <div class="notif-list" id="notifList"><div class="notif-empty">Loading&hellip;</div></div>
        </div>
      </div>
      <button class="profile-chip" id="profileChipBtn">
        <img src="${avatar}" alt="" />
        <span class="chevron">&#9660;</span>
      </button>
    </div>
  </nav>
  <div class="profile-menu" id="profileMenu">
    <a href="#/account/${p ? p.id : ''}" class="profile-menu-header">
      <img src="${avatar}" alt="" />
      <div>
        <div class="pname">${escapeHtml(p ? p.name : 'Guest')}</div>
        <div class="psub">Manage your account</div>
      </div>
    </a>
    <ul>
      <li><a href="#/switch-profile">&#128100; Switch Profile</a></li>
      <li><a href="#/account/${p ? p.id : ''}">&#10084; My List</a></li>
      <li><a href="#/history">&#128337; Watch History</a></li>
      <li><a href="#/stats">&#128202; Library Stats</a></li>
      <li><button id="signInDeviceBtn">&#128241; Sign In Another Device</button></li>
      <li><a href="#/settings">&#9881; Settings</a></li>
      ${isAdmin ? `<li><a href="#/manage-accounts">&#128101; Manage Accounts</a></li>` : ''}
      ${isAdmin ? `<li><a href="#/admin-dashboard">&#128202; Admin Dashboard</a></li>` : ''}
      <li class="divider"><button class="signout" id="signOutBtn">&#8618; Sign out</button></li>
    </ul>
  </div>
  <nav class="io-mobile-nav" aria-label="Main navigation"><a href="#/" class="${activeRoute === 'home' ? 'active' : ''}"><span>⌂</span>Home</a><a href="#/search"><span>◎</span>Discover</a><a href="#/account/${p ? p.id : ''}"><span>♡</span>My List</a><a href="#/account/${p ? p.id : ''}"><span>♙</span>Account</a></nav>`;
}

function wireNavbar() {
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 10) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
  });
  const chip = document.getElementById('profileChipBtn');
  const menu = document.getElementById('profileMenu');
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    chip.classList.toggle('open');
    menu.classList.toggle('open');
  });
  document.addEventListener('click', () => {
    chip.classList.remove('open');
    menu.classList.remove('open');
  });
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await API.logout().catch(() => {});
    Store.activeProfile = null;
    Store.account = null;
    Store.profiles = [];
    location.hash = '#/';
    renderApp();
  });
  document.getElementById('signInDeviceBtn').addEventListener('click', () => {
    openEnterCodeModal();
  });
  document.getElementById('searchBtn').addEventListener('click', () => {
    location.hash = '#/search';
  });
  document.getElementById('shuffleBtn').addEventListener('click', async () => {
    if (Store.anime.length === 0 && Store.movies.length === 0) await Store.loadLibrary();
    const pool = Store.filterForActiveProfile([...Store.anime, ...Store.movies]);
    if (pool.length === 0) { showToast('Nothing in your library yet'); return; }
    const p = Store.activeProfile;
    // Prefer something not already watched, but fall back to the full
    // pool if everything has been started (or there's no profile yet).
    const unwatched = p ? pool.filter((s) => !p.progress || !p.progress[s.id]) : pool;
    const choices = unwatched.length > 0 ? unwatched : pool;
    const pick = choices[Math.floor(Math.random() * choices.length)];
    location.hash = `#/title/${pick.id}`;
  });

  wireNotificationBell();
}

// ---------------- Notification bell ----------------
function wireNotificationBell() {
  const notifBtn = document.getElementById('notifBtn');
  const notifPanel = document.getElementById('notifPanel');
  const notifBadge = document.getElementById('notifBadge');
  const notifList = document.getElementById('notifList');
  const isAdmin = Store.account && Store.account.role === 'admin';
  let cachedNotifications = [];

  function renderBadge() {
    const unread = cachedNotifications.filter((n) => !n.read).length;
    if (unread > 0) {
      notifBadge.textContent = unread > 9 ? '9+' : String(unread);
      notifBadge.style.display = 'flex';
    } else {
      notifBadge.style.display = 'none';
    }
  }

  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function renderList() {
    if (cachedNotifications.length === 0) {
      notifList.innerHTML = `<div class="notif-empty">No notifications yet</div>`;
      return;
    }
    notifList.innerHTML = cachedNotifications.map((n) => `
      <div class="notif-item ${n.read ? '' : 'unread'} ${n.link ? 'clickable' : ''}" data-id="${n.id}" ${n.link ? `data-link="${escapeHtml(n.link)}"` : ''}>
        <div class="notif-item-body">
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          ${n.message ? `<div class="notif-item-msg">${escapeHtml(n.message)}</div>` : ''}
          <div class="notif-item-time">${timeAgo(n.createdAt)}</div>
        </div>
        ${(isAdmin || n.targeted) ? `<button class="notif-item-del" data-del="${n.id}" title="Delete">&times;</button>` : ''}
      </div>`).join('');
    notifList.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await API.deleteNotification(btn.dataset.del).catch(() => {});
        cachedNotifications = cachedNotifications.filter((n) => n.id !== btn.dataset.del);
        renderBadge();
        renderList();
      });
    });
    notifList.querySelectorAll('[data-link]').forEach((item) => {
      item.addEventListener('click', () => { location.hash = item.dataset.link; notifPanel.classList.remove('open'); });
    });
  }

  async function loadNotifications() {
    try {
      cachedNotifications = await API.listNotifications();
      renderBadge();
      renderList();
    } catch (e) {
      notifList.innerHTML = `<div class="notif-empty">Couldn't load notifications</div>`;
    }
  }
  loadNotifications();

  notifBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    document.getElementById('profileMenu').classList.remove('open');
    document.getElementById('profileChipBtn').classList.remove('open');
    const isOpen = notifPanel.classList.contains('open');
    notifPanel.classList.toggle('open', !isOpen);
    if (!isOpen && cachedNotifications.some((n) => !n.read)) {
      await API.markAllNotificationsRead().catch(() => {});
      cachedNotifications = cachedNotifications.map((n) => ({ ...n, read: true }));
      renderBadge();
      renderList();
    }
  });
  document.addEventListener('click', () => notifPanel.classList.remove('open'));
  notifPanel.addEventListener('click', (e) => e.stopPropagation());

  const postBtn = document.getElementById('postNotifBtn');
  if (postBtn) {
    postBtn.addEventListener('click', () => {
      openPostNotificationModal(async (created) => {
        cachedNotifications = [created, ...cachedNotifications];
        renderBadge();
        renderList();
      });
    });
  }
}

function openPostNotificationModal(onCreated) {
  const overlay = el(`
  <div class="modal-overlay">
    <div class="modal" style="width:420px">
      <h3>Post a Notification</h3>
      <div class="field">
        <label>Title</label>
        <input type="text" id="notifTitleInput" maxlength="120" placeholder="e.g. New season added!"/>
      </div>
      <div class="field">
        <label>Message (optional)</label>
        <textarea id="notifMessageInput" rows="3" maxlength="1000" style="width:100%;background:var(--bg-card);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:10px 12px;font-size:14px;font-family:inherit;resize:vertical"></textarea>
      </div>
      <div id="notifModalError" class="auth-error"></div>
      <div class="modal-actions">
        <button class="btn-ghost" id="notifCancelBtn">Cancel</button>
        <button class="btn btn-primary" id="notifSendBtn">Post</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  function close() { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 150); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#notifCancelBtn').addEventListener('click', close);
  overlay.querySelector('#notifSendBtn').addEventListener('click', async () => {
    const title = overlay.querySelector('#notifTitleInput').value.trim();
    const message = overlay.querySelector('#notifMessageInput').value.trim();
    const errEl = overlay.querySelector('#notifModalError');
    if (!title) { errEl.textContent = 'Title is required'; return; }
    try {
      const created = await API.createNotification(title, message);
      close();
      showToast('Notification posted');
      onCreated && onCreated(created);
    } catch (e) {
      errEl.textContent = e.message;
    }
  });
}

// ---------------- Sign In Another Device (manual code entry) ----------------
// ---------------- Admin: reset another account's password ----------------
function openResetPasswordModal(accountId, username) {
  const overlay = el(`
  <div class="modal-overlay">
    <div class="modal" style="width:380px">
      <h3>Reset Password</h3>
      <p style="color:var(--text-dim);font-size:13.5px;margin-bottom:16px">
        Set a new password for <strong>@${escapeHtml(username)}</strong>. They'll need to use it
        the next time they sign in - this doesn't require knowing their current password.
      </p>
      <div class="field">
        <label>New password</label>
        <input type="password" id="resetPwInput" autocomplete="new-password" placeholder="At least 6 characters"/>
      </div>
      <div id="resetPwError" class="auth-error"></div>
      <div class="modal-actions">
        <button class="btn-ghost" id="resetPwCancelBtn">Cancel</button>
        <button class="btn btn-primary" id="resetPwSubmitBtn">Reset Password</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  function close() { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 150); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#resetPwCancelBtn').addEventListener('click', close);
  overlay.querySelector('#resetPwSubmitBtn').addEventListener('click', async () => {
    const newPassword = overlay.querySelector('#resetPwInput').value;
    const errEl = overlay.querySelector('#resetPwError');
    try {
      await API.resetAccountPassword(accountId, newPassword);
      close();
      showToast(`Password reset for @${username}`);
    } catch (e) {
      errEl.textContent = e.message;
    }
  });
}

function openEnterCodeModal() {
  const overlay = el(`
  <div class="modal-overlay">
    <div class="modal" style="width:360px;text-align:center">
      <h3>Sign In Another Device</h3>
      <p style="color:var(--text-dim);font-size:13.5px;margin-bottom:18px">
        Enter the code shown on the other device's screen.
      </p>
      <div class="field">
        <input type="text" id="pairCodeInput" placeholder="e.g. AB12CD34" maxlength="8"
          style="text-align:center;letter-spacing:3px;font-size:18px;font-weight:700;text-transform:uppercase"/>
      </div>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn-ghost" id="pairCodeCancelBtn">Cancel</button>
        <button class="btn btn-primary" id="pairCodeGoBtn">Continue</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  function close() { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 150); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#pairCodeCancelBtn').addEventListener('click', close);
  overlay.querySelector('#pairCodeGoBtn').addEventListener('click', () => {
    const code = overlay.querySelector('#pairCodeInput').value.trim().toUpperCase();
    if (!code) return;
    close();
    location.hash = `#/pair/${code}`;
  });
}

// ---------------- Cards ----------------
const NEW_BADGE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
function isRecentlyAdded(dateAdded) {
  if (!dateAdded) return false;
  return (Date.now() - new Date(dateAdded).getTime()) <= NEW_BADGE_WINDOW_MS;
}

function episodeCardHTML(ep) {
  const fallback = ep.banner || ep.cover || '/img/placeholder-banner.svg';
  return `
  <div class="card" data-nav="#/watch/${ep.showId}/${encodeURIComponent(ep.relPath)}">
    <img class="thumb" src="/api/episode-thumb/${ep.showId}/${encodeURIComponent(ep.relPath)}" data-fallback="${escapeHtml(fallback)}" alt="${escapeHtml(ep.showTitle)}" loading="lazy"/>
    <div class="card-body">
      <div class="card-title">${escapeHtml(ep.showTitle)}</div>
      <div class="card-sub">Episode ${ep.episodeIndex} &middot; ${escapeHtml(ep.episodeTitle)}</div>
    </div>
  </div>`;
}

function animeCardHTML(show, opts = {}) {
  const cover = show.cover || '/img/placeholder-poster.svg';
  const wide = show.banner || show.cover || '/img/placeholder-banner.svg';
  const img = opts.tall ? cover : wide;
  const progress = opts.progressPct;
  const bookmarked = typeof Store !== 'undefined' && Store.activeProfile && Store.isInMyList(show.id, 'anime');
  const mainStudio = (show.studios && show.studios[0]) || null;
  return `
  <div class="card ${opts.tall ? 'poster-card' : ''}" data-nav="#/title/${show.id}">
    <img class="thumb ${opts.tall ? 'thumb-tall' : ''}" src="${img}" alt="${escapeHtml(show.title)}" loading="lazy"/>
    ${opts.tag ? `<div class="card-tag">${escapeHtml(opts.tag)}</div>` : ''}
    ${isRecentlyAdded(show.dateAdded) ? '<div class="card-new-badge">NEW</div>' : ''}
    ${show.hasDub ? '<div class="card-dub-badge" title="English dub available">DUB</div>' : ''}
    ${bookmarked ? '<div class="card-bookmark" title="In My List">&#128278;</div>' : ''}
    ${typeof progress === 'number' ? `<div class="card-progress"><span style="width:${progress}%"></span></div>` : ''}
    <div class="card-body">
      <div class="card-title">${escapeHtml(show.title)}</div>
      <div class="card-sub">${show.episodeCount} episode${show.episodeCount === 1 ? '' : 's'}${show.year ? ' &middot; ' + show.year : ''}${mainStudio ? ' &middot; ' + escapeHtml(mainStudio) : ''}</div>
    </div>
  </div>`;
}

function mangaCardHTML(m, opts = {}) {
  const cover = m.cover || '/img/placeholder-poster.svg';
  const bookmarked = typeof Store !== 'undefined' && Store.activeProfile && Store.isInMyList(m.id, 'manga');
  const progress = opts.progressPct;
  return `
  <div class="card poster-card" data-nav="#/manga/${m.id}">
    <img class="thumb thumb-tall" src="${cover}" alt="${escapeHtml(m.title)}" loading="lazy"/>
    ${isRecentlyAdded(m.dateAdded) ? '<div class="card-new-badge">NEW</div>' : ''}
    ${bookmarked ? '<div class="card-bookmark" title="In My List">&#128278;</div>' : ''}
    ${typeof progress === 'number' ? `<div class="card-progress"><span style="width:${progress}%"></span></div>` : ''}
    <div class="card-body">
      <div class="card-title">${escapeHtml(m.title)}</div>
      <div class="card-sub">${m.chapterCount} chapter${m.chapterCount === 1 ? '' : 's'}</div>
    </div>
  </div>`;
}

function wireCardNav(container) {
  container.querySelectorAll('[data-nav]').forEach(node => {
    node.addEventListener('click', () => { location.hash = node.getAttribute('data-nav'); });
  });
}

let rowIdCounter = 0;
function rowSectionHTML(title, cardsHTML) {
  if (!cardsHTML) return '';
  const id = `rowscroll_${++rowIdCounter}`;
  return `
  <div class="row-section">
    <h2 class="row-title">${escapeHtml(title)}</h2>
    <div class="row-wrap-inner">
      <button class="row-arrow row-arrow-left" data-scrolltarget="${id}" data-dir="-1" aria-label="Scroll left">&#10094;</button>
      <div class="row-scroll" id="${id}">${cardsHTML}</div>
      <button class="row-arrow row-arrow-right" data-scrolltarget="${id}" data-dir="1" aria-label="Scroll right">&#10095;</button>
    </div>
  </div>`;
}

// Call once after inserting any HTML built with rowSectionHTML - wires the
// arrow buttons and hides whichever one is at a dead end (nothing left to
// scroll to), the same way Crunchyroll/HiDive-style rows behave.
function wireRowArrows(container) {
  container.querySelectorAll('.row-arrow').forEach((btn) => {
    const scroller = document.getElementById(btn.dataset.scrolltarget);
    if (!scroller) return;
    btn.addEventListener('click', () => {
      scroller.scrollBy({ left: parseInt(btn.dataset.dir, 10) * scroller.clientWidth * 0.85, behavior: 'smooth' });
    });
  });
  container.querySelectorAll('.row-scroll').forEach((scroller) => {
    const wrap = scroller.closest('.row-wrap-inner');
    if (!wrap) return;
    const leftBtn = wrap.querySelector('.row-arrow-left');
    const rightBtn = wrap.querySelector('.row-arrow-right');
    function updateArrows() {
      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      leftBtn.classList.toggle('hidden', scroller.scrollLeft <= 4);
      rightBtn.classList.toggle('hidden', scroller.scrollLeft >= maxScroll - 4);
    }
    updateArrows();
    scroller.addEventListener('scroll', updateArrows);
    window.addEventListener('resize', updateArrows);
  });
}

// ---------------- Profile Gate (who's watching) ----------------
function renderGate() {
  const cards = Store.profiles.map(p => `
    <button class="gate-profile" data-id="${p.id}" data-haspin="${p.hasPin ? '1' : ''}">
      <div class="avatar-wrap">
        <img src="${p.avatar}" alt="${escapeHtml(p.name)}"/>
        ${p.hasPin ? '<span class="gate-lock-badge">&#128274;</span>' : ''}
      </div>
      <span>${escapeHtml(p.name)}</span>
    </button>`).join('');
  const addCard = Store.profiles.length < 5 ? `
    <button class="gate-profile add" id="addProfileBtn">
      <div class="avatar-wrap">+</div>
      <span>Add Profile</span>
    </button>` : '';

  return `
  <div class="gate">
    <div class="gate-logo-image"><img src="/img/io-logo.svg" alt="${escapeHtml(Store.config.siteName)}"/></div>
    <h2>Who's watching?</h2>
    <div class="gate-account-sub">Signed in as @${escapeHtml(Store.account ? Store.account.username : '')}</div>
    <div class="gate-profiles">${cards}${addCard}</div>
    <div class="gate-actions">
      <button id="manageProfilesBtn">MANAGE PROFILES</button>
      <button id="gateSignOutBtn" class="gate-signout-link">Sign out</button>
    </div>
  </div>`;
}

function wireGate(root, onSelected) {
  root.querySelectorAll('.gate-profile[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (btn.dataset.haspin) {
        openPinPromptModal(async (pin) => {
          const profile = await API.activateProfile(id, pin);
          Store.activeProfile = profile;
          onSelected();
        });
        return;
      }
      const profile = await API.activateProfile(id);
      Store.activeProfile = profile;
      onSelected();
    });
  });
  const addBtn = document.getElementById('addProfileBtn');
  if (addBtn) addBtn.addEventListener('click', () => openProfileModal(null, async () => {
    Store.profiles = await API.listProfiles();
    renderApp();
  }));
  const manageBtn = document.getElementById('manageProfilesBtn');
  if (manageBtn) manageBtn.addEventListener('click', () => location.hash = '#/manage-profiles');
  const signOutBtn = document.getElementById('gateSignOutBtn');
  if (signOutBtn) signOutBtn.addEventListener('click', async () => {
    await API.logout().catch(() => {});
    Store.account = null;
    Store.activeProfile = null;
    Store.profiles = [];
    location.hash = '#/';
    renderApp();
  });
}

// ---------------- Profile Create/Edit Modal ----------------
function openProfileModal(profile, onSaved) {
  const isEdit = !!profile;
  const overlay = el(`
  <div class="modal-overlay">
    <div class="modal">
      <h3>${isEdit ? 'Edit Profile' : 'Add Profile'}</h3>
      <div class="field">
        <label>Name</label>
        <input type="text" id="pfName" value="${isEdit ? escapeHtml(profile.name) : ''}" maxlength="20" placeholder="e.g. Subaru97"/>
      </div>
      <div class="field">
        <label>Avatar</label>
        <div class="avatar-grid" id="avatarGrid"></div>
        <button class="upload-link-btn" id="uploadAvatarBtn">&#128247; Upload your own photo</button>
        <input type="file" id="avatarFileInput" accept="image/*" style="display:none"/>
      </div>
      <div class="field">
        <label>Profile Banner</label>
        <div class="color-grid" id="bannerGrid"></div>
        <button class="upload-link-btn" id="uploadBannerBtn">&#128247; Upload your own image</button>
        <input type="file" id="bannerFileInput" accept="image/*" style="display:none"/>
        <div class="banner-preview" id="bannerPreviewWrap" style="display:none"><img id="bannerPreviewImg"/></div>
      </div>
      <div class="field" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="pfIsKids" ${isEdit && profile.isKids ? 'checked' : ''} style="width:16px;height:16px"/>
        <label for="pfIsKids" style="margin:0">Kids Profile<br/><span style="color:var(--text-faint);font-weight:400;font-size:12px">Hides mature-rated titles from browsing and search on this profile.</span></label>
      </div>
      <div class="field" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="pfAutoplay" ${!isEdit || profile.autoplayNext !== false ? 'checked' : ''} style="width:16px;height:16px"/>
        <label for="pfAutoplay" style="margin:0">Autoplay next episode<br/><span style="color:var(--text-faint);font-weight:400;font-size:12px">Shows a countdown near the end of an episode and plays the next one automatically. Turn off to just stop and ask each time.</span></label>
      </div>
      <div class="field">
        <label>PIN Lock (optional)</label>
        <input type="text" id="pfPin" inputmode="numeric" maxlength="6" placeholder="${isEdit && profile.hasPin ? 'Leave blank to keep current PIN' : '4-6 digits - leave blank for no PIN'}"/>
        ${isEdit && profile.hasPin ? '<button type="button" class="upload-link-btn" id="pfClearPin">Remove PIN</button>' : ''}
      </div>
      <div class="modal-actions">
        ${isEdit ? '<button class="btn-danger" id="deleteProfileBtn">Delete</button>' : ''}
        <button class="btn-ghost" id="cancelModalBtn">Cancel</button>
        <button class="btn btn-primary" id="saveProfileBtn">Save</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  let selectedAvatar = isEdit ? profile.avatar : AVAILABLE_AVATARS[0];
  let selectedBanner = isEdit ? profile.banner : AVAILABLE_BANNERS[0];
  let stagedAvatarDataUrl = null; // set when the person picks a custom photo instead of a preset
  let stagedBannerDataUrl = null;

  const avatarGrid = overlay.querySelector('#avatarGrid');
  let customAvatarOptions = [];
  function paintAvatarGrid() {
    avatarGrid.innerHTML = '';
    if (stagedAvatarDataUrl) {
      avatarGrid.appendChild(el(`<button class="selected"><img src="${stagedAvatarDataUrl}"/></button>`));
    }
    customAvatarOptions.forEach(a => {
      const b = el(`<button class="${!stagedAvatarDataUrl && a === selectedAvatar ? 'selected' : ''}"><img src="${a}"/></button>`);
      b.addEventListener('click', () => {
        selectedAvatar = a;
        stagedAvatarDataUrl = null;
        paintAvatarGrid();
      });
      avatarGrid.appendChild(b);
    });
  }
  paintAvatarGrid();
  API.getAvatarGallery().then((gallery) => {
    customAvatarOptions = gallery.custom;
    paintAvatarGrid();
  }).catch((e) => showToast(e.message));

  const bannerGrid = overlay.querySelector('#bannerGrid');
  const bannerPreviewWrap = overlay.querySelector('#bannerPreviewWrap');
  const bannerPreviewImg = overlay.querySelector('#bannerPreviewImg');
  function paintBannerGrid() {
    bannerGrid.querySelectorAll('button').forEach(x => x.classList.remove('selected'));
    if (stagedBannerDataUrl) {
      bannerPreviewWrap.style.display = 'block';
      bannerPreviewImg.src = stagedBannerDataUrl;
    } else {
      bannerPreviewWrap.style.display = 'none';
    }
  }
  const colors = ['#6b21a8', '#be185d', '#1d4ed8', '#15803d', '#c2410c', '#4338ca'];
  AVAILABLE_BANNERS.forEach((banner, i) => {
    const sw = el(`<button class="color-swatch ${!stagedBannerDataUrl && banner === selectedBanner ? 'selected' : ''}" style="background:${colors[i]}"></button>`);
    sw.addEventListener('click', () => {
      selectedBanner = banner;
      stagedBannerDataUrl = null;
      bannerGrid.querySelectorAll('button').forEach(x => x.classList.remove('selected'));
      sw.classList.add('selected');
      paintBannerGrid();
    });
    bannerGrid.appendChild(sw);
  });

  const avatarFileInput = overlay.querySelector('#avatarFileInput');
  overlay.querySelector('#uploadAvatarBtn').addEventListener('click', () => avatarFileInput.click());
  avatarFileInput.addEventListener('change', async () => {
    const file = avatarFileInput.files[0];
    if (!file) return;
    try {
      stagedAvatarDataUrl = await resizeImageFile(file, 400, 400, 0.85);
      paintAvatarGrid();
    } catch (e) {
      showToast(e.message);
    }
  });

  const bannerFileInput = overlay.querySelector('#bannerFileInput');
  overlay.querySelector('#uploadBannerBtn').addEventListener('click', () => bannerFileInput.click());
  bannerFileInput.addEventListener('change', async () => {
    const file = bannerFileInput.files[0];
    if (!file) return;
    try {
      stagedBannerDataUrl = await resizeImageFile(file, 1280, 720, 0.85);
      paintBannerGrid();
    } catch (e) {
      showToast(e.message);
    }
  });

  function close() {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 150);
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#cancelModalBtn').addEventListener('click', close);

  let clearPin = false;
  const pfPinInput = overlay.querySelector('#pfPin');
  const pfClearPinBtn = overlay.querySelector('#pfClearPin');
  if (pfClearPinBtn) {
    pfClearPinBtn.addEventListener('click', () => {
      clearPin = true;
      pfPinInput.value = '';
      pfPinInput.placeholder = 'PIN will be removed on save';
      pfPinInput.disabled = true;
      pfClearPinBtn.style.display = 'none';
    });
  }

  overlay.querySelector('#saveProfileBtn').addEventListener('click', async () => {
    const name = overlay.querySelector('#pfName').value.trim();
    if (!name) { showToast('Please enter a name'); return; }
    const isKids = overlay.querySelector('#pfIsKids').checked;
    const autoplayNext = overlay.querySelector('#pfAutoplay').checked;
    const pinValue = pfPinInput.value.trim();
    if (pinValue && !/^\d{4,6}$/.test(pinValue)) { showToast('PIN must be 4-6 digits'); return; }
    const saveBtn = overlay.querySelector('#saveProfileBtn');
    saveBtn.disabled = true;
    try {
      let saved;
      const patch = { name, avatar: selectedAvatar, banner: selectedBanner, isKids, autoplayNext };
      if (clearPin) patch.pin = null;
      else if (pinValue) patch.pin = pinValue;
      if (isEdit) {
        saved = await API.updateProfile(profile.id, patch);
      } else {
        saved = await API.createProfile({ name, avatar: selectedAvatar, banner: selectedBanner, isKids, autoplayNext });
        // New profiles can't take a PIN at creation time, so set it as an
        // immediate follow-up (same pattern as the avatar/banner uploads below).
        if (pinValue) saved = await API.updateProfile(saved.id, { pin: pinValue });
      }
      // Custom photo uploads need a profile id to attach to, so they run
      // as a follow-up call after the profile itself is created/updated.
      if (stagedAvatarDataUrl) saved = await API.uploadAvatar(saved.id, stagedAvatarDataUrl);
      if (stagedBannerDataUrl) saved = await API.uploadBanner(saved.id, stagedBannerDataUrl);
      close();
      showToast('Profile saved');
      onSaved && onSaved();
    } catch (e) {
      showToast(e.message);
      saveBtn.disabled = false;
    }
  });

  const delBtn = overlay.querySelector('#deleteProfileBtn');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) return;
      await API.deleteProfile(profile.id);
      close();
      showToast('Profile deleted');
      onSaved && onSaved();
    });
  }
}

// ---------------- MyAnimeList Import Modal ----------------
function openMalSearchModal(item, onImported, mediaType = 'anime') {
  const isManga = mediaType === 'manga';
  const overlay = el(`
  <div class="modal-overlay">
    <div class="modal" style="width:560px">
      <h3>Import Metadata</h3>
      <div class="field" style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn-ghost source-toggle-btn active" data-source="mal" style="flex:1">MyAnimeList</button>
        <button class="btn-ghost source-toggle-btn" data-source="anilist" style="flex:1">AniList</button>
      </div>
      <div class="field">
        <input type="text" id="malQuery" value="${escapeHtml(item.title)}" placeholder="Name, MAL ID, or myanimelist.net link..."/>
      </div>
      <div class="field" style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <input type="checkbox" id="malUseEnglish" ${Store.config.preferEnglishTitles ? 'checked' : ''} style="width:15px;height:15px"/>
        <label for="malUseEnglish" style="margin:0;font-size:13px;color:var(--text-dim)">Use English title when available</label>
      </div>
      <div id="malResults" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px"></div>
      <div class="modal-actions">
        <button class="btn-ghost" id="malCancelBtn">Cancel</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  function close() {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 150);
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#malCancelBtn').addEventListener('click', close);

  const resultsEl = overlay.querySelector('#malResults');
  const queryInput = overlay.querySelector('#malQuery');
  const useEnglishCheckbox = overlay.querySelector('#malUseEnglish');
  let source = 'mal'; // 'mal' or 'anilist' - MAL stays the default so existing muscle memory/behavior doesn't change
  const sourceButtons = overlay.querySelectorAll('.source-toggle-btn');

  const SOURCE_CONFIG = {
    mal: {
      label: 'MyAnimeList', placeholder: 'Name, MAL ID, or myanimelist.net link...',
      search: (q) => (isManga ? API.malSearchManga(q) : API.malSearch(q)),
      importFn: (targetId, id, useEnglish) => (isManga ? API.importMalManga(targetId, id, useEnglish) : API.importMal(targetId, id, useEnglish)),
    },
    anilist: {
      label: 'AniList', placeholder: 'Name, AniList ID, or anilist.co link...',
      search: (q) => (isManga ? API.anilistSearchManga(q) : API.anilistSearch(q)),
      importFn: (targetId, id, useEnglish) => (isManga ? API.importAniListManga(targetId, id, useEnglish) : API.importAniList(targetId, id, useEnglish)),
    },
  };

  sourceButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      source = btn.dataset.source;
      sourceButtons.forEach((b) => b.classList.toggle('active', b === btn));
      queryInput.placeholder = SOURCE_CONFIG[source].placeholder;
      runSearch();
    });
  });

  async function runSearch() {
    const q = queryInput.value.trim();
    if (!q) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = `<div class="loading-spin" style="grid-column:1/-1;margin:30px auto"></div>`;
    try {
      const results = await SOURCE_CONFIG[source].search(q);
      if (results.length === 0) {
        resultsEl.innerHTML = `<div style="grid-column:1/-1;color:var(--text-faint);text-align:center;padding:20px">No matches found.</div>`;
        return;
      }
      resultsEl.innerHTML = results.map(r => {
        const primary = (useEnglishCheckbox.checked && r.englishTitle) ? r.englishTitle : r.title;
        const secondary = (useEnglishCheckbox.checked && r.englishTitle && r.englishTitle !== r.title) ? r.title : null;
        return `
        <button class="mal-result" data-id="${r.id}" style="text-align:left;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;overflow:hidden;padding:0">
          <img src="${r.image || '/img/placeholder-poster.svg'}" style="width:100%;aspect-ratio:2/3;object-fit:cover"/>
          <div style="padding:8px">
            <div style="font-size:12.5px;font-weight:600;line-height:1.3;margin-bottom:2px">${escapeHtml(primary)}</div>
            ${secondary ? `<div style="font-size:10.5px;color:var(--text-faint);line-height:1.3;margin-bottom:3px">${escapeHtml(secondary)}</div>` : ''}
            <div style="font-size:11px;color:var(--text-faint)">${r.year || ''}${r.score ? ' &middot; &#9733; ' + r.score : ''}</div>
          </div>
        </button>`;
      }).join('');
      resultsEl.querySelectorAll('.mal-result').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.style.opacity = '0.5';
          try {
            const id = parseInt(btn.dataset.id, 10);
            await SOURCE_CONFIG[source].importFn(item.id, id, useEnglishCheckbox.checked);
            close();
            showToast(`Imported from ${SOURCE_CONFIG[source].label}`);
            onImported && onImported();
          } catch (e) {
            showToast(e.message);
            btn.style.opacity = '1';
          }
        });
      });
    } catch (e) {
      resultsEl.innerHTML = `<div style="grid-column:1/-1;color:#f87171;text-align:center;padding:20px">${escapeHtml(e.message)}</div>`;
    }
  }

  useEnglishCheckbox.addEventListener('change', runSearch);
  let debounceTimer;
  queryInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 400);
  });
  runSearch();
}

// ---------------- Write a Review Modal ----------------
// Renders a title's aggregate reviews - a rating summary (average stars,
// count) plus the full list of what everyone on the server has said
// about it. Shared by both the anime/movie and manga detail pages.
// Returns the HTML shell synchronously (with a loading state) and kicks
// off the actual fetch in the background - call wireReviewsSection
// right after inserting this into the DOM.
// External Links - direct pill buttons to a title's MyAnimeList/AniList
// page, using whichever IDs were stored on it (from an import via
// either source - see applyMalToShowDir/applyAniListToShowDir). Only
// renders IDs that actually exist, and nothing at all if neither does.
function externalLinksSectionHTML(item, itemType) {
  const malUrl = item.malId
    ? `https://myanimelist.net/${itemType}/${item.malId}`
    : `https://myanimelist.net/${itemType}.php?q=${encodeURIComponent(item.title)}&cat=${itemType}`;
  const anilistUrl = item.anilistId
    ? `https://anilist.co/${itemType}/${item.anilistId}`
    : `https://anilist.co/search/${itemType}?search=${encodeURIComponent(item.title)}`;
  return `
    <div class="rows-wrap" style="margin-top:32px">
      <h2 class="row-title">External Links</h2>
      <div style="padding:0 48px;display:flex;gap:12px;flex-wrap:wrap">
        <a class="external-link-btn external-link-mal" href="${malUrl}" target="_blank" rel="noopener" title="${item.malId ? '' : 'Not imported from MAL yet - searching by title instead'}">MAL</a>
        <a class="external-link-btn external-link-anilist" href="${anilistUrl}" target="_blank" rel="noopener" title="${item.anilistId ? '' : 'Not imported from AniList yet - searching by title instead'}">AniList</a>
      </div>
    </div>`;
}

// Cast & Production - only renders anything once the fetch confirms
// data is actually available (titles imported from AniList specifically
// have this; MAL-only titles don't), so nothing shows for titles
// without it instead of an empty section.
function castSectionHTML() {
  return `<div class="rows-wrap" id="castSectionWrap" style="margin-top:32px;display:none">
    <h2 class="row-title">Cast &amp; Production</h2>
    <div class="cast-grid" style="padding:0 48px" id="castGridInner"></div>
  </div>`;
}

// Canonical sequels/prequels/side stories/spin-offs from AniList's
// relations data - distinct from the separate, genre-similarity-based
// "More Like This" section elsewhere on this page. A relation here
// means actual series continuity (the next season, a side story in the
// same continuity), not just "shares some genre tags".
const RELATION_TYPE_LABELS = {
  SEQUEL: 'Sequel', PREQUEL: 'Prequel', SIDE_STORY: 'Side Story',
  SPIN_OFF: 'Spin-off', ALTERNATIVE: 'Alternative Version', SUMMARY: 'Summary', PARENT: 'Parent Story',
};
function relatedSectionHTML() {
  return `<div class="rows-wrap" id="relatedSectionWrap" style="margin-top:32px;display:none">
    <h2 class="row-title">Related</h2>
    <div class="row-scroll" id="relatedGridInner"></div>
  </div>`;
}
async function wireRelatedSection(showId) {
  const wrap = document.getElementById('relatedSectionWrap');
  if (!wrap) return;
  try {
    const { related, available } = await API.getRelatedShows(showId);
    if (!available || related.length === 0) return; // stays hidden
    document.getElementById('relatedGridInner').innerHTML = related.map((r) => `
      <div class="card ${r.localShowId ? '' : 'card-unavailable'}" ${r.localShowId ? `data-nav="#/title/${r.localShowId}"` : ''}>
        <img class="thumb" src="${r.coverUrl || '/img/placeholder-poster.svg'}" alt="" loading="lazy"/>
        <div class="card-body">
          <div class="card-title">${escapeHtml(r.title || 'Unknown')}</div>
          <div class="card-sub">${escapeHtml(RELATION_TYPE_LABELS[r.relationType] || r.relationType)}${r.year ? ` &middot; ${r.year}` : ''}</div>
          ${!r.localShowId ? '<div class="card-badge-unowned">Not in your library</div>' : ''}
        </div>
      </div>`).join('');
    wrap.style.display = '';
  } catch (e) { /* stays hidden - not worth a toast for a below-the-fold extra */ }
}

async function wireCastSection(showId) {
  const wrap = document.getElementById('castSectionWrap');
  if (!wrap) return;
  try {
    const { cast, staff, available } = await API.getCastAndStaff(showId);
    const people = [...cast, ...staff];
    if (!available || people.length === 0) return; // stays hidden
    document.getElementById('castGridInner').innerHTML = people.map((p) => `
      <div class="cast-person" ${p.personId ? `data-nav="#/person/${p.personId}/${encodeURIComponent(p.name)}"` : ''} ${p.personId ? 'style="cursor:pointer"' : ''}>
        <img src="${p.image || '/img/avatars/avatar1.svg'}" data-fallback="/img/avatars/avatar1.svg" alt="" loading="lazy"/>
        <div class="cast-person-name">${escapeHtml(p.name)}</div>
        <div class="cast-person-role">${escapeHtml(p.role)}</div>
      </div>`).join('');
    wireCardNav(document.getElementById('castGridInner'));
    wrap.style.display = '';
  } catch (e) { /* stays hidden - not worth a toast for a below-the-fold extra */ }
}

function reviewsSectionHTML() {
  return `
    <div class="rows-wrap" style="margin-top:32px">
      <h2 class="row-title">Reviews</h2>
      <div style="padding:0 48px" id="reviewsSectionInner">
        <div class="loading-spin" style="margin:30px auto"></div>
      </div>
    </div>`;
}

function reviewStarsHTML(rating) {
  return [1, 2, 3, 4, 5].map((n) => `<span class="review-star ${n <= Math.round(rating) ? 'filled' : ''}">&#9733;</span>`).join('');
}

async function wireReviewsSection(container, item, itemType) {
  const inner = container.querySelector('#reviewsSectionInner');
  if (!inner) return;
  try {
    const reviews = await API.getReviewsForItem(item.id, itemType);
    const avg = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : null;
    inner.innerHTML = `
      <div class="reviews-layout">
        <div class="review-summary-card">
          <div class="review-summary-avg">${avg ? avg.toFixed(1) : '&mdash;'}</div>
          <div class="review-summary-stars">${reviewStarsHTML(avg || 0)}</div>
          <div class="review-summary-count">${reviews.length} REVIEW${reviews.length === 1 ? '' : 'S'}</div>
        </div>
        <div style="flex:1;min-width:0">
          <button class="btn-ghost" id="reviewsSectionWriteBtn" style="margin-bottom:18px">&#9998; Write a Review</button>
          <div id="reviewsListEl">
            ${reviews.length === 0 ? `<p style="color:var(--text-faint);font-style:italic">No reviews yet. Be the first!</p>` : reviews.map((r) => `
              <div class="review-row">
                <img class="review-avatar" src="${r.reviewerAvatar || '/img/avatars/avatar1.svg'}" alt=""/>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
                    <strong>${escapeHtml(r.reviewerName)}</strong>
                    <span class="review-row-stars">${reviewStarsHTML(r.rating)}</span>
                  </div>
                  ${r.text ? `<p style="color:var(--text-dim);margin:0;white-space:pre-wrap">${escapeHtml(r.text)}</p>` : ''}
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>`;
    const writeBtn = inner.querySelector('#reviewsSectionWriteBtn');
    if (writeBtn) {
      writeBtn.addEventListener('click', () => {
        if (!Store.activeProfile) { showToast('Select a profile first'); return; }
        openReviewModal(item, itemType, () => wireReviewsSection(container, item, itemType));
      });
    }
  } catch (e) {
    inner.innerHTML = `<p style="color:var(--text-faint)">Couldn't load reviews.</p>`;
  }
}

// Manage which titles are in one curated row - search is entirely
// client-side against the already-loaded library (Store.anime/movies/
// manga), so it's instant with no extra network round-trips per keystroke.
function openCuratedRowManageModal(row, onChanged) {
  const overlay = el(`
  <div class="modal-overlay">
    <div class="modal" style="width:560px">
      <h3>${escapeHtml(row.title)}</h3>
      <div class="field">
        <input type="text" id="curatedSearchInput" placeholder="Search your library to add a title..."/>
      </div>
      <div id="curatedSearchResults" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px"></div>
      <div style="font-size:12.5px;color:var(--text-faint);margin-bottom:8px">In this row (${row.items.length})</div>
      <div id="curatedCurrentItems"></div>
      <div class="modal-actions">
        <button class="btn-ghost" id="curatedDoneBtn">Done</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  function close() {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 150);
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#curatedDoneBtn').addEventListener('click', () => { close(); onChanged && onChanged(); });

  function resolveItem(it) {
    return it.itemType === 'manga' ? Store.findManga(it.itemId) : Store.findAnime(it.itemId);
  }

  function paintCurrent() {
    const listEl = overlay.querySelector('#curatedCurrentItems');
    if (row.items.length === 0) {
      listEl.innerHTML = `<p style="color:var(--text-faint);font-size:13px">Nothing added yet - search above to add titles.</p>`;
      return;
    }
    listEl.innerHTML = row.items.map((it) => {
      const found = resolveItem(it);
      const title = found ? found.title : `${it.itemId} (not found - may have been removed from the library)`;
      return `
      <div class="episode-row" style="align-items:center">
        <div class="episode-info">
          <div class="episode-title">${escapeHtml(title)} <span class="handle-badge" style="margin-left:6px">${it.itemType}</span></div>
        </div>
        <button class="btn-ghost" data-remove-id="${encodeURIComponent(it.itemId)}" data-remove-type="${it.itemType}">Remove</button>
      </div>`;
    }).join('');
    listEl.querySelectorAll('[data-remove-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const itemId = decodeURIComponent(btn.dataset.removeId);
        try {
          await API.removeCuratedRowItem(row.id, itemId, btn.dataset.removeType);
          row.items = row.items.filter((it) => !(it.itemId === itemId && it.itemType === btn.dataset.removeType));
          paintCurrent();
        } catch (e) { showToast(e.message); }
      });
    });
  }
  paintCurrent();

  const searchInput = overlay.querySelector('#curatedSearchInput');
  const resultsEl = overlay.querySelector('#curatedSearchResults');
  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) { resultsEl.innerHTML = ''; return; }
      const pool = [
        ...Store.anime.map((s) => ({ ...s, itemType: 'anime' })),
        ...Store.movies.map((s) => ({ ...s, itemType: 'anime' })),
        ...Store.manga.map((m) => ({ ...m, itemType: 'manga' })),
      ];
      const already = new Set(row.items.map((it) => `${it.itemType}:${it.itemId}`));
      const matches = pool.filter((it) => it.title.toLowerCase().includes(q) && !already.has(`${it.itemType}:${it.id}`)).slice(0, 9);
      resultsEl.innerHTML = matches.map((it) => `
        <button class="mal-result" data-add-id="${encodeURIComponent(it.id)}" data-add-type="${it.itemType}" style="text-align:left;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;overflow:hidden;padding:0">
          <img src="${it.cover || '/img/placeholder-poster.svg'}" style="width:100%;aspect-ratio:2/3;object-fit:cover"/>
          <div style="padding:6px"><div style="font-size:11.5px;font-weight:600;line-height:1.3">${escapeHtml(it.title)}</div></div>
        </button>`).join('') || `<div style="grid-column:1/-1;color:var(--text-faint);font-size:13px;padding:8px 0">No matches.</div>`;
      resultsEl.querySelectorAll('[data-add-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const itemId = decodeURIComponent(btn.dataset.addId);
          try {
            await API.addCuratedRowItem(row.id, itemId, btn.dataset.addType);
            row.items.push({ itemId, itemType: btn.dataset.addType });
            paintCurrent();
            searchInput.dispatchEvent(new Event('input'));
          } catch (e) { showToast(e.message); }
        });
      });
    }, 250);
  });
}

function openReviewModal(item, itemType, onSaved) {
  const existing = (Store.activeProfile && Store.activeProfile.reviews || []).find(r => r.itemId === item.id && r.itemType === itemType);
  let rating = existing ? existing.rating : 5;
  const overlay = el(`
  <div class="modal-overlay">
    <div class="modal">
      <h3>Review "${escapeHtml(item.title)}"</h3>
      <div class="field">
        <label>Rating</label>
        <div class="star-picker" id="starPicker"></div>
      </div>
      <div class="field">
        <label>Your thoughts (optional)</label>
        <textarea id="reviewText" rows="4" style="width:100%;background:var(--bg-card);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:10px 12px;font-size:14px;font-family:inherit;resize:vertical" maxlength="2000">${existing ? escapeHtml(existing.text) : ''}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="reviewCancelBtn">Cancel</button>
        <button class="btn btn-primary" id="reviewSaveBtn">${existing ? 'Update Review' : 'Post Review'}</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const starPicker = overlay.querySelector('#starPicker');
  function paintStars() {
    starPicker.innerHTML = [1, 2, 3, 4, 5].map(n => `<button class="star-btn" data-n="${n}">${n <= rating ? '&#9733;' : '&#9734;'}</button>`).join('');
    starPicker.querySelectorAll('.star-btn').forEach(b => b.addEventListener('click', () => { rating = parseInt(b.dataset.n, 10); paintStars(); }));
  }
  paintStars();

  function close() { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 150); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#reviewCancelBtn').addEventListener('click', close);
  overlay.querySelector('#reviewSaveBtn').addEventListener('click', async () => {
    const text = overlay.querySelector('#reviewText').value.trim();
    try {
      const review = await API.addReview(Store.activeProfile.id, item.id, itemType, rating, text);
      Store.activeProfile.reviews = [review, ...(Store.activeProfile.reviews || []).filter(r => r.id !== review.id && !(r.itemId === item.id && r.itemType === itemType))];
      close();
      showToast('Review saved');
      onSaved && onSaved();
    } catch (e) {
      showToast(e.message);
    }
  });
}

// ---------------- PIN entry prompt (for PIN-locked profiles) ----------------
function openPinPromptModal(onSubmit) {
  const overlay = el(`
  <div class="modal-overlay">
    <div class="modal" style="width:320px;text-align:center">
      <h3>&#128274; Enter PIN</h3>
      <div class="field">
        <input type="password" id="pinInput" inputmode="numeric" maxlength="6" placeholder="&bull;&bull;&bull;&bull;"
          style="text-align:center;letter-spacing:8px;font-size:22px;font-weight:700"/>
      </div>
      <div id="pinError" class="auth-error"></div>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn-ghost" id="pinCancelBtn">Cancel</button>
        <button class="btn btn-primary" id="pinSubmitBtn">Unlock</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    overlay.querySelector('#pinInput').focus();
  });
  function close() { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 150); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#pinCancelBtn').addEventListener('click', close);

  const pinInput = overlay.querySelector('#pinInput');
  const errEl = overlay.querySelector('#pinError');
  async function submit() {
    errEl.textContent = '';
    try {
      await onSubmit(pinInput.value);
      close();
    } catch (e) {
      errEl.textContent = e.message === 'wrong_pin' ? 'Incorrect PIN' : e.message;
      pinInput.value = '';
      pinInput.focus();
    }
  }
  overlay.querySelector('#pinSubmitBtn').addEventListener('click', submit);
  pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}
