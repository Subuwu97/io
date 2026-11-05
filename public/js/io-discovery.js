(function(global) {
  const themes = [
    {title:'Cozy vibes only',description:'Comfort watching at its finest.',genres:['slice of life','comedy','iyashikei']},
    {title:'Love is in the air',description:'From first love to forever after.',genres:['romance']},
    {title:'Mind games & plot twists',description:'Mysteries that keep you guessing.',genres:['mystery','psychological','suspense','thriller']},
    {title:'Where magic feels real',description:'Stories that transport you somewhere extraordinary.',genres:['fantasy','isekai','supernatural','mahou shoujo']},
    {title:'Fights that break the internet',description:'Action from your own collection.',genres:['action','adventure','martial arts']},
    {title:'Game on',description:'Victory tastes sweeter in anime form.',genres:['sports','racing','strategy game']},
    {title:'Turn it up to eleven',description:'Shows that sound as good as they look.',genres:['music','idols','performing arts']},
  ];
  function seededRandom(seed) {
    let value=seed>>>0;
    return ()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};
  }
  function shuffle(items,random) {
    const result=[...items];
    for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
    return result;
  }
  function buildCollections(items,seed) {
    const random=seededRandom(seed),unique=[...new Map(items.map(item=>[item.id,item])).values()];
    const normalize=value=>String(value).toLowerCase().replace(/[-_]/g,' ').replace(/\s+/g,' ').trim();
    return shuffle(themes,random).map(theme=>({...theme,items:shuffle(unique.filter(item=>Array.isArray(item.genres)&&item.genres.some(genre=>theme.genres.includes(normalize(genre)))),random).slice(0,12)})).filter(theme=>theme.items.length).slice(0,4);
  }
  const api={buildCollections,shuffle,seededRandom};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(!global.document)return;
  global.IOBrowseCollections=api;

  const originalHome=global.pageHome;
  global.pageHome=async function(root) {
    await originalHome(root);
    const rows=root.querySelector('#rows');if(!rows)return;
    const pool=Store.filterForActiveProfile([...Store.anime,...Store.movies]);
    if(!pool.length)return;
    rows.insertAdjacentHTML('afterend',`<div id="ioCollections" class="rows-wrap"></div><section class="io-browse-end"><div aria-hidden="true">✦</div><h2>You've reached the end</h2><p>Find another side of your collection. Refresh to explore different shows and themes.</p><button class="btn btn-primary" id="ioRefreshBrowse" ${pool.length<2?'disabled':''}>Show me different stuff</button><p id="ioBrowseStatus" role="status" aria-live="polite"></p></section>`);
    let previous=new Map(),seed=Date.now()>>>0,heroFirst=null;
    function refresh(changeHero) {
      seed=(seed+1)>>>0;
      const collections=buildCollections(pool,seed);
      for(const collection of collections) {
        const signature=collection.items.map(item=>item.id).join(',');
        if(collection.items.length>1 && previous.get(collection.title)===signature)collection.items.push(collection.items.shift());
        previous.set(collection.title,collection.items.map(item=>item.id).join(','));
      }
      const target=root.querySelector('#ioCollections');
      target.innerHTML=collections.map(collection=>`<section class="io-collection"><p class="io-collection-description">${escapeHtml(collection.description)}</p>${rowSectionHTML(collection.title,collection.items.map(item=>animeCardHTML(item,{tall:true})).join(''))}</section>`).join('');
      wireCardNav(target);wireRowArrows(target);
      if(changeHero) {
        const hero=shuffle(pool,seededRandom(seed^0x12345)).slice(0,5);
        if(hero.length>1&&hero[0].id===heroFirst)hero.push(hero.shift());
        heroFirst=hero[0]?.id;renderHero(hero);
        root.querySelector('#ioBrowseStatus').textContent=collections.length ? 'Fresh picks and collections are ready above.' : 'The featured picks have been refreshed.';
      }
    }
    root.querySelector('#ioRefreshBrowse').onclick=()=>refresh(true);refresh(false);
  };

  const originalAuth=global.pageAuthGate;
  global.pageAuthGate=async function(root) {
    await originalAuth(root);
    const login=root.querySelector('.io-login');if(!login)return;
    const header=login.querySelector('.io-login-header');
    header.insertAdjacentHTML('beforeend','<div class="io-login-themes" role="group" aria-label="Login theme"><button type="button" data-login-theme="light">Light</button><button type="button" data-login-theme="indigo">Indigo</button><button type="button" data-login-theme="black">Black</button></div>');
    let theme='black';try{theme=localStorage.getItem('ioLoginTheme')||theme;}catch{}
    function apply(value) {
      theme=['light','indigo','black'].includes(value)?value:'black';login.dataset.loginTheme=theme;
      header.querySelectorAll('[data-login-theme]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.loginTheme===theme)));
    }
    header.querySelectorAll('[data-login-theme]').forEach(button=>button.onclick=()=>{apply(button.dataset.loginTheme);try{localStorage.setItem('ioLoginTheme',theme);}catch{}});
    apply(theme);
  };
})(typeof window==='undefined'?globalThis:window);
