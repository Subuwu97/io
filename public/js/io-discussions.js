function ioCommentHTML(comment, rootId) {
  const own = Store.account && comment.accountId === Store.account.id;
  const canDelete = Store.account && (own || Store.account.role === 'admin');
  const id = escapeHtml(comment.id);
  const body = comment.deletedAt ? '<p class="io-muted">This comment was deleted. Replies remain below.</p>'
    : comment.spoiler ? `<details class="io-spoiler" data-spoiler="${id}"><summary>Spoiler — reveal comment</summary><p>${escapeHtml(comment.text)}</p></details>`
    : `<p>${escapeHtml(comment.text)}</p>`;
  return `<article class="io-discussion ${comment.parentId ? 'io-reply' : ''}" data-comment-id="${id}">
    <header><strong>${escapeHtml(comment.username)}</strong><time datetime="${escapeHtml(comment.createdAt)}">${escapeHtml(new Date(comment.createdAt).toLocaleString())}</time></header>
    ${body}${comment.deletedAt ? '' : `<div class="io-comment-actions">
      <button data-like="${id}" aria-pressed="${comment.liked}" aria-label="${comment.liked ? 'Unlike' : 'Like'} comment by ${escapeHtml(comment.username)}">♡ <span>${comment.likes}</span></button>
      <button data-reply="${escapeHtml(rootId)}">Reply</button>
      ${!own ? `<button data-report="${id}">Report</button>` : ''}
      ${canDelete ? `<button data-delete="${id}">Delete</button>` : ''}
    </div>${ioReactionHTML(comment)}`}</article>`;
}

function ioMountDiscussions(root, show, episode) {
  const form=root.querySelector('#ioDiscussionForm'), list=root.querySelector('#ioDiscussionList');
  form.innerHTML=`<div class="io-reply-target" id="ioReplyTarget" hidden><span></span><button type="button" id="ioCancelReply">Cancel reply</button></div>
    <label for="ioDiscussionText" class="io-sr-only">Your comment</label><textarea id="ioDiscussionText" placeholder="Start the discussion…" maxlength="2000" required></textarea>
    <label class="io-spoiler-check"><input type="checkbox" id="ioCommentSpoiler"/> Contains spoilers</label>
    <button type="submit" class="btn btn-primary">Post</button><p id="ioDiscussionError" class="io-discussion-status" role="status" aria-live="polite"></p>`;
  form.insertAdjacentHTML('afterend','<button type="button" class="btn btn-secondary io-more-discussions" id="ioMoreDiscussions" hidden>Load more discussions</button>');
  const more=root.querySelector('#ioMoreDiscussions'); list.after(more);
  const status=root.querySelector('#ioDiscussionError'), input=root.querySelector('#ioDiscussionText');
  const endpoint='/api/discussions/'+encodeURIComponent(show.id);
  let threads=[], nextCursor=null, replyTarget=null;
  const revealed=new Set();
  const allComments=()=>threads.flatMap(thread=>[thread,...thread.replies]);
  const send=(url,method,body)=>API._fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  function resetReply() {
    replyTarget=null;root.querySelector('#ioReplyTarget').hidden=true;input.placeholder='Start the discussion…';
  }
  root.querySelector('#ioCancelReply').onclick=resetReply;
  function paint() {
    if (!list.isConnected) return;
    list.innerHTML=threads.length ? threads.map(thread=>`<section class="io-thread">${ioCommentHTML(thread,thread.id)}
      <div class="io-thread-replies">${thread.replies.map(reply=>ioCommentHTML(reply,thread.id)).join('')}</div>
      ${!thread.repliesDone && thread.replyCount > thread.replies.length ? `<button class="io-load-replies" data-more-replies="${escapeHtml(thread.id)}">Load more replies</button>` : ''}</section>`).join('')
      : '<p class="io-muted">No comments yet. Be the first to start the discussion!</p>';
    more.hidden=!nextCursor;
    for (const details of list.querySelectorAll('[data-spoiler]')) {
      details.open=revealed.has(details.dataset.spoiler);
      details.ontoggle=()=>details.open ? revealed.add(details.dataset.spoiler) : revealed.delete(details.dataset.spoiler);
    }
  }
  async function load(append=false) {
    const data=await API._fetch(endpoint+'?threads=1&episode='+encodeURIComponent(episode.relPath)+(append && nextCursor ? '&before='+encodeURIComponent(nextCursor):''));
    if (!list.isConnected) return;
    const incoming=data.threads.map(t=>({...t,replyCursor:t.replies.at(-1)?.id,repliesDone:t.replyCount <= t.replies.length}));
    threads=append ? [...threads,...incoming.filter(t=>!threads.some(old=>old.id===t.id))] : incoming;
    nextCursor=data.nextCursor;paint();
  }
  more.onclick=async()=>{more.disabled=true;try{await load(true);}catch(e){status.textContent=e.message;}finally{more.disabled=false;}};
  form.onsubmit=async e=>{
    e.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;status.textContent='';
    try {
      const comment=await send(endpoint,'POST',{episode:episode.relPath,text:input.value,spoiler:root.querySelector('#ioCommentSpoiler').checked,parentId:replyTarget});
      if (!list.isConnected) return;
      if (replyTarget) {const parent=threads.find(t=>t.id===replyTarget);parent.replies.push(comment);parent.replyCount++;}
      else threads.unshift({...comment,replies:[],repliesDone:true});
      form.reset();resetReply();paint();status.textContent='Comment posted.';
    } catch(error) {status.textContent=error.message;} finally {submit.disabled=false;}
  };
  list.onclick=async e=>{
    const button=e.target.closest('button');if(!button || !list.contains(button))return;
    const comments=allComments();
    if (button.dataset.reply) {
      const target=threads.find(t=>t.id===button.dataset.reply);
      if (!target || target.deletedAt) {status.textContent='This discussion no longer accepts replies.';return;}
      replyTarget=target.id;const notice=root.querySelector('#ioReplyTarget');notice.hidden=false;
      notice.querySelector('span').textContent='Replying to '+target.username;input.placeholder='Write your reply…';input.scrollIntoView({block:'center',behavior:'smooth'});input.focus();return;
    }
    button.disabled=true;status.textContent='';
    try {
      if (button.dataset.reaction) {
        const comment=comments.find(c=>c.id===button.dataset.reactionComment),emoji=button.dataset.reaction;
        const active=!(comment.reactions||[]).find(r=>r.emoji===emoji)?.reacted;
        Object.assign(comment,await send(endpoint+'/'+encodeURIComponent(comment.id)+'/reaction','PUT',{emoji,active}));paint();
      } else if (button.dataset.like) {
        const comment=comments.find(c=>c.id===button.dataset.like);
        Object.assign(comment,await send(endpoint+'/'+encodeURIComponent(comment.id)+'/like','PUT',{liked:!comment.liked}));paint();
      } else if (button.dataset.delete) {
        if (!confirm('Delete this comment? Its replies will stay in the discussion.'))return;
        await API._fetch(endpoint+'/'+encodeURIComponent(button.dataset.delete),{method:'DELETE'});
        const comment=comments.find(c=>c.id===button.dataset.delete);Object.assign(comment,{deletedAt:new Date().toISOString(),text:'',username:'Deleted comment',accountId:null});
        if(replyTarget===comment.id)resetReply();paint();
      } else if (button.dataset.report) {
        ioReportDialog(root,endpoint,button.dataset.report,status);
      } else if (button.dataset.moreReplies) {
        const thread=threads.find(t=>t.id===button.dataset.moreReplies);
        const data=await API._fetch(endpoint+'/'+encodeURIComponent(thread.id)+'/replies'+(thread.replyCursor?'?after='+encodeURIComponent(thread.replyCursor):''));
        thread.replies.push(...data.replies.filter(c=>!thread.replies.some(old=>old.id===c.id)));
        thread.replies.sort((a,b)=>a.createdAt<b.createdAt?-1:a.createdAt>b.createdAt?1:a.id<b.id?-1:a.id>b.id?1:0);
        thread.replyCursor=data.nextCursor;thread.repliesDone=!data.nextCursor;paint();
      }
    } catch(error) {status.textContent=error.message;} finally {button.disabled=false;}
  };
  load().then(async()=>{
    let focus;try{focus=JSON.parse(sessionStorage.getItem('ioDiscussionFocus')||'null');}catch{}
    if(!focus||focus.showId!==show.id)return;try{sessionStorage.removeItem('ioDiscussionFocus');}catch{}
    let target=allComments().find(c=>c.id===focus.commentId);
    if(!target){try{const thread=await API._fetch(endpoint+'/'+encodeURIComponent(focus.commentId)+'/thread');if(!threads.some(t=>t.id===thread.id))threads.unshift({...thread,replyCursor:thread.replies.at(-1)?.id,repliesDone:thread.replyCount<=thread.replies.length});paint();target=thread;}catch{return;}}
    const article=Array.from(list.querySelectorAll('[data-comment-id]')).find(el=>el.dataset.commentId===(target.id||focus.commentId));if(article){article.tabIndex=-1;article.scrollIntoView({block:'center'});article.focus({preventScroll:true});}
  }).catch(error=>{if(status.isConnected)status.textContent=error.message;});
}

function ioReportDialog(root,endpoint,commentId,status) {
  const dialog=document.createElement('dialog');dialog.className='io-report-dialog';
  dialog.innerHTML=`<form><h2>Report comment</h2><p>Tell the server administrators what needs their attention.</p>
    <label for="ioReportReason">Reason</label><textarea id="ioReportReason" minlength="3" maxlength="500" required></textarea>
    <p role="status"></p><div class="io-dialog-actions"><button type="button" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">Send report</button></div></form>`;
  root.appendChild(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.querySelector('[type="button"]').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const button=dialog.querySelector('[type="submit"]');button.disabled=true;
    try {await API._fetch(endpoint+'/'+encodeURIComponent(commentId)+'/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:dialog.querySelector('textarea').value})});status.textContent='Report sent to the server administrators.';dialog.close();}
    catch(error){dialog.querySelector('[role="status"]').textContent=error.message;button.disabled=false;}
  };
  dialog.showModal();
}

async function ioPageModeration(root) {
  if (Store.account?.role !== 'admin') {root.innerHTML=renderNavbar('')+'<div class="page-wrap"><h1>Administrator access required</h1></div>';wireNavbar();return;}
  root.innerHTML=renderNavbar('')+`<main class="page-wrap io-moderation"><h1>Discussion reports</h1><p>Review reports from your community.</p>
    <label for="ioReportFilter">Status</label> <select id="ioReportFilter"><option value="open">Open</option><option value="dismissed">Dismissed</option><option value="removed">Removed</option></select>
    <button id="ioReportRefresh" class="btn btn-secondary">Refresh</button><p id="ioModerationStatus" role="status"></p><div id="ioReportQueue"></div></main>`;
  wireNavbar();const filter=root.querySelector('#ioReportFilter'),queue=root.querySelector('#ioReportQueue'),status=root.querySelector('#ioModerationStatus');
  let generation=0;
  async function load() {
    const current=++generation;status.textContent='Loading reports…';
    try {
      const data=await API._fetch('/api/admin/discussion-reports?status='+encodeURIComponent(filter.value));
      if(!queue.isConnected || current!==generation)return;
      status.textContent=`${data.total} ${filter.value} report${data.total===1?'':'s'}.`+(data.total>100?' Showing the oldest 100.':'');
      queue.innerHTML=data.reports.length ? data.reports.map(report=>`<article class="io-report-card"><header><strong>${escapeHtml(report.author)}</strong><span>${escapeHtml(report.showTitle)}</span></header>
        <details ${report.spoiler ? '' : 'open'}><summary>${report.spoiler ? 'Reported spoiler — reveal' : 'Reported comment'}</summary><p class="io-report-body">${escapeHtml(report.commentBody)}</p></details>
        <p><strong>Reason:</strong> ${escapeHtml(report.reason)}</p><p class="io-muted">Reported by ${escapeHtml(report.reporter)} · ${escapeHtml(new Date(report.createdAt).toLocaleString())}</p>
        <a href="${escapeHtml(ioDiscussionLink(report.showId,report.episode))}">Open discussion ↗</a>
        ${report.status==='open' ? `<div class="io-dialog-actions"><button class="btn btn-secondary" data-resolve="${escapeHtml(report.id)}" data-action="dismiss">Dismiss report</button><button class="btn btn-primary" data-resolve="${escapeHtml(report.id)}" data-action="remove">Remove comment</button></div>` : `<p>Status: ${escapeHtml(report.status)}</p>`}</article>`).join('') : '<div class="empty-state"><h2>No reports here</h2></div>';
    } catch(error){if(status.isConnected && current===generation)status.textContent=error.message;}
  }
  filter.onchange=load;root.querySelector('#ioReportRefresh').onclick=load;
  queue.onclick=async e=>{
    const button=e.target.closest('[data-resolve]');if(!button)return;
    if(button.dataset.action==='remove'&&!confirm('Remove this comment? Replies remain, and open reports about this comment will be marked removed.'))return;
    const buttons=button.closest('article').querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
    try {await API._fetch('/api/admin/discussion-reports/'+encodeURIComponent(button.dataset.resolve)+'/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:button.dataset.action})});await load();}
    catch(error){status.textContent=error.message;buttons.forEach(b=>b.disabled=false);}
  };
  await load();
}
