function ioLiveProfileQuery(){return Store.activeProfile?'profileId='+encodeURIComponent(Store.activeProfile.id):'';}
function ioLiveClock(time){return new Date(time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}

async function ioPageLive(root,channelId){
  if(channelId)return ioWatchLive(root,channelId);
  root.innerHTML=renderNavbar('live')+`<main class="page-wrap io-tv-page"><h1>TV guide</h1><p class="io-muted-left">What's on I/O TV, now and later today. Pick a programme for details.</p>
    <section><h2>On now</h2><div id="ioOnNow" class="io-on-now"></div></section>
    <section><div class="io-guide-heading"><h2 id="ioGuideDate"></h2><div><button id="ioGuideEarlier" aria-label="Earlier">‹</button><button id="ioGuideNow">Now</button><button id="ioGuideLater" aria-label="Later">›</button></div></div>
    <div id="ioGuideStatus" role="status"></div><div class="io-tv-scroll"><div id="ioTVGrid" class="io-tv-grid"></div></div></section>
    ${Store.account?.role==='admin'?'<a class="btn btn-secondary" href="#/live-manage">Manage live channels</a>':''}</main>`;
  wireNavbar();let start=Math.floor(Date.now()/1800000)*1800000,generation=0,programmes=new Map();
  const status=root.querySelector('#ioGuideStatus');
  async function load(){const request=++generation;try{
    const data=await API._fetch('/api/live/guide?'+ioLiveProfileQuery()+'&start='+start+'&hours=6');if(!status.isConnected||request!==generation)return;
    status.textContent='';root.querySelector('#ioGuideDate').textContent=new Date(data.startMs).toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
    root.querySelector('#ioGuideEarlier').disabled=start<data.serverTime-18*3600000;root.querySelector('#ioGuideLater').disabled=start>data.serverTime+6*86400000;
    root.querySelector('#ioOnNow').innerHTML=data.channels.length?data.channels.map(channel=>{
      const current=channel.current,next=channel.next;
      return `<article class="io-live-card">${current?`<img src="${escapeHtml(current.cover)}" alt=""/>`:''}<div><span class="io-live-label">◉ ${escapeHtml(channel.name)}</span><h3>${escapeHtml(current?.showTitle||'Starting soon')}</h3><p>${escapeHtml(current?.title||channel.description)}</p>
        ${current?`<progress max="${current.endMs-current.startMs}" value="${data.serverTime-current.startMs}"></progress><small>${ioLiveClock(current.startMs)} – ${ioLiveClock(current.endMs)}</small><a class="btn btn-primary" href="#/live/${encodeURIComponent(channel.id)}">▷ Watch live</a>`:''}
        ${next?`<small>Up next: ${escapeHtml(next.showTitle)} · ${ioLiveClock(next.startMs)}</small>`:''}</div></article>`;
    }).join(''):'<div class="empty-state"><h3>No live channels yet</h3><p>An administrator can create a channel from the local library.</p></div>';
    programmes=new Map();const span=data.endMs-data.startMs;
    let grid='<div class="io-tv-time-row"><div class="io-tv-name">Channels</div><div class="io-tv-track">';
    for(let i=0;i<12;i++)grid+=`<time style="left:${i/12*100}%">${ioLiveClock(data.startMs+i*1800000)}</time>`;grid+='</div></div>';
    for(const channel of data.channels){grid+=`<div class="io-tv-row"><a class="io-tv-name" href="#/live/${encodeURIComponent(channel.id)}">${escapeHtml(channel.name)}</a><div class="io-tv-track">`;
      for(const programme of channel.programmes){programmes.set(programme.key,{...programme,channelId:channel.id});const left=Math.max(0,(programme.startMs-data.startMs)/span*100),right=Math.min(100,(programme.endMs-data.startMs)/span*100);
        grid+=`<button class="io-tv-programme ${programme.startMs<=data.serverTime&&programme.endMs>data.serverTime?'current':''}" style="left:${left}%;width:${Math.max(.05,right-left)}%" data-programme="${escapeHtml(programme.key)}"><strong>${escapeHtml(programme.showTitle)}</strong><small>Ep ${programme.index} · ${escapeHtml(programme.title)}</small></button>`;}
      if(data.serverTime>=data.startMs&&data.serverTime<data.endMs)grid+=`<span class="io-tv-now-marker" style="left:${(data.serverTime-data.startMs)/span*100}%"></span>`;
      grid+='</div></div>';if(channel.truncated)status.textContent='Some very short programmes are omitted at the end of this window. Choose a later window to see more.';
    }root.querySelector('#ioTVGrid').innerHTML=grid;
  }catch(error){if(status.isConnected&&request===generation)status.textContent=error.message;}}
  root.querySelector('#ioGuideEarlier').onclick=()=>{start-=6*3600000;load();};root.querySelector('#ioGuideLater').onclick=()=>{start+=6*3600000;load();};root.querySelector('#ioGuideNow').onclick=()=>{start=Math.floor(Date.now()/1800000)*1800000;load();};
  root.querySelector('#ioTVGrid').onclick=e=>{const button=e.target.closest('[data-programme]');if(!button)return;const programme=programmes.get(button.dataset.programme);if(!programme)return;
    const dialog=document.createElement('dialog');dialog.className='io-report-dialog';dialog.innerHTML=`<h2>${escapeHtml(programme.showTitle)}</h2><p>Episode ${programme.index} · ${escapeHtml(programme.title)}</p><p>${ioLiveClock(programme.startMs)} – ${ioLiveClock(programme.endMs)}</p><div class="io-dialog-actions"><button class="btn btn-secondary">Close</button><a class="btn btn-secondary" href="#/watch/${encodeURIComponent(programme.showId)}/${encodeURIComponent(programme.relPath)}">Watch on demand</a><a class="btn btn-primary" href="#/live/${encodeURIComponent(programme.channelId)}">Watch live</a></div>`;root.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();};
  const timer=setInterval(load,30000);window.addEventListener('hashchange',()=>{generation++;clearInterval(timer);},{once:true});await load();
}

async function ioWatchLive(root,id){
  const route=location.hash;let stopped=false,timer;
  window.addEventListener('hashchange',()=>{stopped=true;clearInterval(timer);},{once:true});
  const endpoint='/api/live/channels/'+encodeURIComponent(id)+'/now?'+ioLiveProfileQuery();
  let state=await API._fetch(endpoint),stamp=performance.now(),checking=false;
  if(stopped||location.hash!==route)return;
  if(!state.current){root.innerHTML=renderNavbar('live')+'<main class="page-wrap"><h1>Channel starts soon</h1><p>'+escapeHtml(state.channel.description)+'</p><a href="#/live">Back to TV guide</a></main>';wireNavbar();return;}
  const key=state.current.key;
  await pagePlayer(root,state.current.showId,encodeURIComponent(state.current.relPath),{live:true,startAt:state.offsetSeconds,
    onEnded:()=>check(true),onReady:controller=>{
      if(stopped||location.hash!==route)return;
      if(!root.querySelector('#playerContainer'))return;
      root.querySelector('.player-page').classList.add('io-live-player');root.querySelector('#backBtn').onclick=()=>{location.hash='#/live';};
      root.querySelector('#playerTop').insertAdjacentHTML('beforeend','<button class="io-live-jump" id="ioJumpLive">◉ LIVE</button>');
      const target=()=>Math.max(0,(state.serverTime+(performance.now()-stamp)-state.current.startMs)/1000);
      root.querySelector('#ioJumpLive').onclick=()=>{controller.seekTo(target());controller.video.play().catch(()=>{});};
      controller.video.addEventListener('play',()=>{if(Math.abs(controller.absoluteTime()-target())>3)controller.seekTo(target());});
      timer=setInterval(()=>check(false,controller),10000);
    }});
  async function check(force=false,controller){
    if(checking||stopped)return;checking=true;try{
      const next=await API._fetch(endpoint);if(stopped)return;
      if(!next.current||next.current.key!==key){location.hash='#/live/'+encodeURIComponent(id)+'/'+(next.current?.startMs||Date.now());return;}
      state=next;stamp=performance.now();if(controller&&!controller.video.paused&&Math.abs(controller.absoluteTime()-state.offsetSeconds)>5)controller.seekTo(state.offsetSeconds);
      if(force)setTimeout(()=>check(true),Math.max(100,Math.min(1000,next.current.endMs-next.serverTime+50)));
    }catch(error){if(root.isConnected)showToast(error.message);}finally{checking=false;}
  }
}

async function ioPageLiveAdmin(root){
  if(Store.account?.role!=='admin'){root.innerHTML=renderNavbar('')+'<main class="page-wrap"><h1>Administrator access required</h1></main>';wireNavbar();return;}
  const [channels,catalog]=await Promise.all([API._fetch('/api/admin/live/channels'),API._fetch('/api/admin/live/catalog')]);
  root.innerHTML=renderNavbar('live')+`<main class="page-wrap io-live-admin"><a href="#/live">‹ TV guide</a><h1>Live channels</h1><p>Build continuous channels from your own media. Programme durations are measured with FFprobe.</p>
    <div id="ioChannelList">${channels.map(channel=>`<button class="btn btn-secondary" data-channel="${escapeHtml(channel.id)}">${escapeHtml(channel.name)} ${channel.enabled?'':'(off)'}</button>`).join('')}<button class="btn btn-primary" id="ioNewChannel">New channel</button></div><div id="ioChannelEditor"></div></main>`;wireNavbar();
  const episodes=catalog.flatMap(show=>show.episodes.map(ep=>({...ep,showId:show.id,showTitle:show.title})));let current=null;
  function edit(channel){current=channel||null;const selected=new Map((channel?.playlist||[]).map((entry,index)=>[entry.showId+'\n'+entry.relPath,index]));
    root.querySelector('#ioChannelEditor').innerHTML=`<form id="ioChannelForm" class="io-settings-card"><h2>${channel?'Edit channel':'New channel'}</h2><div class="field"><label for="ioChannelName">Channel name</label><input id="ioChannelName" maxlength="60" value="${escapeHtml(channel?.name||'')}" required/></div><div class="field"><label for="ioChannelDescription">Description</label><input id="ioChannelDescription" maxlength="300" value="${escapeHtml(channel?.description||'')}"/></div>
      <label><input id="ioChannelEnabled" type="checkbox" ${channel?.enabled===false?'':'checked'}/> Channel enabled</label><h3>Programme order</h3><p>Select episodes, then change their order. The channel repeats this playlist continuously.</p><div id="ioProgrammePicker" class="io-programme-picker">${episodes.map((ep,index)=>`<label><input type="checkbox" data-episode="${index}" ${selected.has(ep.showId+'\n'+ep.relPath)?'checked':''}/> ${escapeHtml(ep.showTitle)} · ${escapeHtml(ep.season)} · ${escapeHtml(ep.title)}</label>`).join('')||'<p>No episodes found. Add media to your library first.</p>'}</div><ol id="ioProgrammeOrder"></ol>
      ${channel?'<label><input id="ioRestartChannel" type="checkbox"/> Restart the schedule from the first programme</label>':''}<p id="ioChannelStatus" role="status"></p><div class="io-dialog-actions">${channel?'<button type="button" class="btn btn-secondary" id="ioDeleteChannel">Delete channel</button>':''}<button class="btn btn-primary" type="submit">Save channel</button></div></form>`;
    let order=episodes.map((ep,index)=>({ep,index,position:selected.get(ep.showId+'\n'+ep.relPath)})).filter(entry=>entry.position!==undefined).sort((a,b)=>a.position-b.position).map(entry=>entry.index);
    function paint(){root.querySelector('#ioProgrammeOrder').innerHTML=order.map((index,position)=>`<li>${escapeHtml(episodes[index].showTitle)} · ${escapeHtml(episodes[index].title)} <button type="button" data-move="${position}" data-step="-1" aria-label="Move programme ${position+1} up" ${position===0?'disabled':''}>↑</button><button type="button" data-move="${position}" data-step="1" aria-label="Move programme ${position+1} down" ${position===order.length-1?'disabled':''}>↓</button></li>`).join('');}
    root.querySelector('#ioProgrammePicker').onchange=e=>{const index=Number(e.target.dataset.episode);if(!Number.isInteger(index))return;if(e.target.checked)order.push(index);else order=order.filter(i=>i!==index);paint();};
    root.querySelector('#ioProgrammeOrder').onclick=e=>{const button=e.target.closest('[data-move]');if(!button)return;const index=Number(button.dataset.move),next=index+Number(button.dataset.step);if(next<0||next>=order.length)return;[order[index],order[next]]=[order[next],order[index]];paint();};paint();
    root.querySelector('#ioChannelForm').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('[type="submit"]'),status=root.querySelector('#ioChannelStatus');button.disabled=true;status.textContent='Inspecting programme durations and saving the schedule…';try{
      await API._fetch('/api/admin/live/channels'+(current?'/'+encodeURIComponent(current.id):''),{method:current?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:root.querySelector('#ioChannelName').value,description:root.querySelector('#ioChannelDescription').value,enabled:root.querySelector('#ioChannelEnabled').checked,restart:!!root.querySelector('#ioRestartChannel')?.checked,playlist:order.map(index=>({showId:episodes[index].showId,relPath:episodes[index].relPath}))})});await ioPageLiveAdmin(root);
    }catch(error){status.textContent=error.message;button.disabled=false;}};
    const remove=root.querySelector('#ioDeleteChannel');if(remove)remove.onclick=async()=>{if(!confirm('Delete this live channel? The media files will remain in your library.'))return;try{await API._fetch('/api/admin/live/channels/'+encodeURIComponent(current.id),{method:'DELETE'});await ioPageLiveAdmin(root);}catch(error){root.querySelector('#ioChannelStatus').textContent=error.message;}};
  }
  root.querySelector('#ioNewChannel').onclick=()=>edit(null);root.querySelectorAll('[data-channel]').forEach(button=>button.onclick=()=>edit(channels.find(channel=>channel.id===button.dataset.channel)));edit(channels[0]||null);
}
