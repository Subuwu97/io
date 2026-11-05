(function(){
  const navbar=window.renderNavbar;
  window.renderNavbar=function(active){let html=navbar(active);
    html=html.replace(/<li><a href="#\/genres"[\s\S]*?<\/a><\/li>/,'').replace(/<li><a href="#\/calendar"[\s\S]*?<\/a><\/li>/,'');
    html=html.replace('</ul>',`<li><a href="#/live" class="${active==='live'?'active':''}">TV guide</a></li></ul>`);
    return html.replace('<li class="divider">',`<li><a href="#/live">TV guide</a></li><li><a href="#/account-security">Email & connections</a></li><li><a href="#/community-notifications">Replies & reactions</a></li><li><a href="#/calendar">Release calendar</a></li>${Store.account?.role==='admin'?'<li><a href="#/services">Email & sign-in setup</a></li><li><a href="#/live-manage">Live channels</a></li>':''}<li class="divider">`);
  };
  const footer=window.ioFooterHTML;window.ioFooterHTML=function(){return footer().replace('<a href="#/genres">','<a href="#/live">TV guide</a><a href="#/genres">');};
  const detail=window.pageDetail;
  window.pageDetail=async function(root,id){await detail(root,id);const hero=root.querySelector('.detail-hero');if(!hero)return;hero.classList.add('io-detail-ref');
    const info=hero.querySelector('.detail-info'),actions=hero.querySelector('.detail-actions'),genres=hero.querySelector('.detail-genres');
    if(genres)info.appendChild(genres);
    const progress=Store.activeProfile?.progress?.[id];if(progress?.duration){const bar=document.createElement('progress');bar.className='io-detail-progress';bar.max=progress.duration;bar.value=Math.min(progress.duration,Math.max(0,progress.seconds||0));bar.setAttribute('aria-label','Watch progress');actions.after(bar);}
    const review=root.querySelector('#reviewBtn');if(review)review.textContent='♧ Rate & review';
    const extra=[root.querySelector('#topPickBtn'),root.querySelector('#malImportBtn')].filter(Boolean);if(extra.length){const menu=document.createElement('details');menu.className='io-detail-more';menu.innerHTML='<summary>More</summary>';for(const button of extra)menu.appendChild(button);actions.appendChild(menu);}
  };
  const account=window.pageAccount;
  window.pageAccount=async function(root,id){await account(root,id);const page=root.querySelector('.account-page');if(!page)return;page.classList.add('io-account-ref');
    const h2=page.querySelector('.account-header .info h2');if(h2){const h1=document.createElement('h1');h1.append(...h2.childNodes);h2.replaceWith(h1);}
    const tabs=page.querySelector('.account-tabs'),buttons=Array.from(tabs.querySelectorAll('button'));
    tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Profile sections');
    const labels={activity:'Activity',reviews:'Reviews',comments:'Comments',toppicks:'Top Picks',mylist:'My List'};
    function sync(){for(const button of buttons){const selected=button.classList.contains('active');button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}}
    for(const button of buttons){button.textContent=labels[button.dataset.tab]||button.textContent;button.setAttribute('role','tab');button.setAttribute('aria-controls','tabContent');button.addEventListener('click',sync);}
    tabs.onkeydown=e=>{const at=buttons.indexOf(document.activeElement);if(at<0)return;let next;if(e.key==='ArrowRight')next=(at+1)%buttons.length;else if(e.key==='ArrowLeft')next=(at+buttons.length-1)%buttons.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=buttons.length-1;else return;e.preventDefault();buttons[next].click();buttons[next].focus();};sync();
  };
  const settings=window.pageSettings;
  window.pageSettings=async function(root){await settings(root);const old=root.querySelector('.page-wrap');if(!old)return;
    const shell=document.createElement('main');shell.className='io-settings-page';shell.innerHTML='<a href="#/" class="io-back-browse">‹ Back to Browse</a><h1>Settings</h1><p class="io-muted-left">Manage your account, security, and preferences</p><div class="io-settings-columns">'+ioSettingsNav('settings')+'<div class="io-settings-content"></div></div>';
    const content=shell.querySelector('.io-settings-content');old.querySelector('.page-header')?.remove();content.append(...old.childNodes);old.replaceWith(shell);
    content.querySelectorAll(':scope > form,:scope > div').forEach(section=>section.classList.add('io-settings-card'));
    const nav=shell.querySelector('.io-settings-nav');
    for(const [label,target]of [['Security','#passwordForm'],['Child Safety','#adultContentToggle'],['Signed-in devices','#sessionsList']]){const element=shell.querySelector(target);if(!element)continue;const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>element.scrollIntoView({block:'center',behavior:'smooth'});nav.insertBefore(button,nav.children[1]);}
    if(Store.activeProfile){const profile=document.createElement('a');profile.href='#/account/'+encodeURIComponent(Store.activeProfile.id);profile.textContent='Public Profile';nav.insertBefore(profile,nav.children[1]);}
  };
})();
