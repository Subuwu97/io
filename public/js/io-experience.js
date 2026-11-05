function ioFooterHTML() {
  const profile = Store.activeProfile;
  return `<footer class="io-footer"><div><img src="/img/io-logo.svg" alt="I/O"/><p>Your home for anime, movies, and manga.<br/>Every story, your way.</p></div>
    <div><h4>Browse</h4><a href="#/">Home</a><a href="#/series">TV Shows</a><a href="#/movies">Movies</a><a href="#/genres">Categories</a><a href="#/books">Manga</a></div>
    <div><h4>My stuff</h4><a href="#/account/${profile ? profile.id : ''}">My List</a><a href="#/history">Watch History</a><a href="#/search">Search</a><a href="#/settings">Settings</a></div>
    <div class="io-footer-credit">I/O · Built on Minami · Your own media, on your own server.</div></footer>`;
}

function ioWirePlayer(root, show, currentEp) {
  const container = root.querySelector('#playerContainer');
  container.insertAdjacentHTML('beforeend', `<button class="ctl-btn io-episodes-button" id="ioEpisodesButton" aria-label="Episodes list" title="Episodes list">☷</button>
    <aside class="io-episode-drawer" id="ioEpisodeDrawer" hidden><header><h2>Episodes</h2><button id="ioEpisodesClose" aria-label="Close episodes">×</button></header>
    ${show.groups.map(group => `<h3>${escapeHtml(group.name)}</h3>${group.episodes.map(ep => `<a class="${ep.relPath === currentEp.relPath ? 'active' : ''}" href="#/watch/${show.id}/${encodeURIComponent(ep.relPath)}"><span>${ep.index}</span><div>${escapeHtml(ep.title)}${ep.relPath === currentEp.relPath ? '<small>Now playing</small>' : ''}</div></a>`).join('')}`).join('')}</aside>`);
  const drawer = root.querySelector('#ioEpisodeDrawer');
  const episodesButton=root.querySelector('#ioEpisodesButton');episodesButton.setAttribute('aria-controls','ioEpisodeDrawer');episodesButton.setAttribute('aria-expanded','false');drawer.setAttribute('aria-label','Episode selection');
  episodesButton.onclick = () => { drawer.hidden = !drawer.hidden;episodesButton.setAttribute('aria-expanded',String(!drawer.hidden));if(!drawer.hidden)root.querySelector('#ioEpisodesClose').focus(); };
  function closeEpisodes(){drawer.hidden=true;episodesButton.setAttribute('aria-expanded','false');episodesButton.focus();}
  root.querySelector('#ioEpisodesClose').onclick = closeEpisodes;
  drawer.onkeydown = e => { if (e.key === 'Escape') {e.preventDefault();e.stopPropagation();closeEpisodes();} };
  root.querySelector('.player-page').insertAdjacentHTML('beforeend', `<section class="io-watch-info"><h1>${escapeHtml(currentEp.title)}</h1><p class="io-episode-meta">Episode ${currentEp.index} ${show.year ? '· '+escapeHtml(String(show.year)) : ''}</p><p>${escapeHtml(currentEp.description || show.description || '')}</p>
    <div class="io-track-links">${show.anilistId ? `<a href="https://anilist.co/anime/${encodeURIComponent(show.anilistId)}" target="_blank" rel="noopener noreferrer">AniList ↗</a>` : ''}${show.malId ? `<a href="https://myanimelist.net/anime/${encodeURIComponent(show.malId)}" target="_blank" rel="noopener noreferrer">MAL ↗</a>` : ''}</div>
    <h2>Discussion</h2><form id="ioDiscussionForm"><label for="ioDiscussionText" class="io-sr-only">Your comment</label><textarea id="ioDiscussionText" placeholder="Start the discussion…" maxlength="2000" required></textarea><button type="submit" class="btn btn-primary">Post</button><p id="ioDiscussionError" role="status"></p></form><div id="ioDiscussionList"></div></section>`);
  ioMountDiscussions(root, show, currentEp);
}

function ioConfigurePlayer(root, chapters, seekTo) {
  const container = root.querySelector('#playerContainer');
  const controls = root.querySelector('#controlsBar');
  const trigger = document.createElement('button');
  trigger.className = 'ctl-btn ctl-icon';
  trigger.id = 'ioSettingsButton';
  trigger.title = 'Player settings';
  trigger.setAttribute('aria-label', 'Player settings');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = PLAYER_ICONS.gear;
  controls.insertBefore(trigger, root.querySelector('#ctlFullscreenBtn'));
  const panel = document.createElement('div');
  panel.className = 'io-settings-panel';
  panel.id = 'ioSettingsPanel';
  panel.setAttribute('aria-label', 'Player settings');
  container.appendChild(panel);
  for (const [id, label] of [['settingsMenuWrap','Quality'], ['speedMenuWrap','Speed'], ['skipPointsMenuWrap','Skip points']]) {
    const wrapper = root.querySelector('#'+id);
    wrapper.dataset.settingLabel = label;
    panel.appendChild(wrapper);
  }
  const qualityButton=root.querySelector('#ctlSettingsBtn');
  qualityButton.textContent='Original';
  const syncQuality=()=>{const selected=root.querySelector('#qualityPopup .selected,#qualityPopup .active');if(selected)qualityButton.textContent=selected.textContent.replace(/✓/g,'').trim();};syncQuality();
  const qualityObserver=new MutationObserver(syncQuality);
  qualityObserver.observe(root.querySelector('#qualityPopup'),{subtree:true,childList:true,attributes:true});
  root.querySelector('#ctlSkipPointsBtn').textContent='Edit';
  const subtitles=document.createElement('button');subtitles.className='io-settings-row';subtitles.type='button';subtitles.innerHTML='<span>Audio & subtitles</span><span>Choose ›</span>';
  subtitles.onclick=()=>{panel.classList.remove('open');trigger.setAttribute('aria-expanded','false');root.querySelector('#ctlCCBtn').click();};
  if(root.querySelector('#ccMenuWrap').style.display!=='none')panel.insertBefore(subtitles,root.querySelector('#skipPointsMenuWrap'));
  const chapterButton = document.createElement('button');
  chapterButton.className = 'io-chapters-toggle';
  chapterButton.innerHTML = `<span>Chapters</span><span>${chapters.length} ›</span>`;
  chapterButton.setAttribute('aria-expanded','false');
  const chapterList = document.createElement('div');
  chapterList.className = 'io-chapters-list'; chapterList.hidden = true;
  chapterList.innerHTML = chapters.length ? chapters.map((c,i) => `<button data-chapter-index="${i}"><span>${escapeHtml(c.title)}</span><small>${Math.floor(c.start / 60)}:${String(Math.floor(c.start % 60)).padStart(2,'0')}</small></button>`).join('') : '<p>No chapters in this file.</p>';
  panel.append(chapterButton,chapterList);
  chapterButton.onclick = e => {e.stopPropagation(); chapterList.hidden = !chapterList.hidden;chapterButton.setAttribute('aria-expanded',String(!chapterList.hidden));};
  chapterList.querySelectorAll('button').forEach(button => {button.onclick=e=>{e.stopPropagation();seekTo(chapters[Number(button.dataset.chapterIndex)].start);panel.classList.remove('open');trigger.setAttribute('aria-expanded','false');};});
  trigger.onclick = e => {e.stopPropagation(); const open=panel.classList.toggle('open');trigger.setAttribute('aria-expanded',String(open));container.classList.remove('chrome-hidden');if(open)panel.querySelector('button:not(:disabled)')?.focus();};
  panel.addEventListener('click',e=>e.stopPropagation());
  const close = e => {if(!panel.contains(e.target)&&e.target!==trigger){panel.classList.remove('open');trigger.setAttribute('aria-expanded','false');}};
  document.addEventListener('click',close);
  window.addEventListener('hashchange',()=>{document.removeEventListener('click',close);qualityObserver.disconnect();},{once:true});
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){panel.classList.remove('open');trigger.setAttribute('aria-expanded','false');trigger.focus();}});
  // Serika keeps social/cast controls beside the title, above the video.
  for (const id of ['ctlWatchPartyBtn','ctlCastBtn']) root.querySelector('#playerTop').appendChild(root.querySelector('#'+id));
  const episodes = root.querySelector('#ioEpisodesButton');
  episodes.classList.remove('io-episodes-button'); episodes.classList.add('ctl-icon');
  controls.insertBefore(episodes,trigger);
  const previous=root.querySelector('#prevBtn');if(previous){previous.className='ctl-btn ctl-icon io-previous-episode';previous.innerHTML=PLAYER_ICONS.nextEp;previous.setAttribute('aria-label','Previous episode');previous.title='Previous episode';controls.insertBefore(previous,episodes);}
  const next=root.querySelector('#ctlNextEpBtn');if(next)controls.insertBefore(next,episodes);
  const sideNext=root.querySelector('#nextBtn');if(sideNext)sideNext.hidden=true;
  const captions=root.querySelector('#ccMenuWrap');controls.insertBefore(captions,trigger);
  const pip=root.querySelector('#ctlPipBtn');controls.insertBefore(pip,root.querySelector('#ctlFullscreenBtn'));
  for(const [id,label]of [['ctlSeek','Seek playback'],['ctlVolume','Volume']])root.querySelector('#'+id).setAttribute('aria-label',label);
  const duration=root.querySelector('#ctlDuration');duration.classList.add('io-duration');
}
