const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {DatabaseSync}=require('node:sqlite');
const register=require('../server/episode-discussions');

async function fixture(t) {
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE accounts(id TEXT PRIMARY KEY,username TEXT);
    INSERT INTO accounts VALUES ('a','Alice'),('b','Bob'),('mod','Moderator');
    CREATE TABLE episode_discussions(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      show_id TEXT NOT NULL,episode_path TEXT NOT NULL,text TEXT NOT NULL,created_at TEXT NOT NULL);
    INSERT INTO episode_discussions VALUES('legacy','a','show','01.mp4','Existing discussion','2020-01-01T00:00:00.000Z');`);
  const app=express();app.use(express.json());
  const options={db,requireAuth(req,res){const id=req.headers['x-test-user'];if(!['a','b','mod'].includes(id)){res.status(401).end();return null;}return{id,username:id,role:id==='mod'?'admin':'user'};},getShow:id=>id==='show'?{title:'Example',groups:[{episodes:[{relPath:'01.mp4'},{relPath:'02.mp4'}]}]}:null};
  register(app,options);
  // Running the migration again must preserve old discussions and the new schema.
  register(express(),options);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  async function request(user,url,method='GET',body) {
    return fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{'x-test-user':user,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  const comment=(user,body)=>request(user,'/api/discussions/show','POST',{episode:'01.mp4',...body});
  return{db,request,comment};
}

test('emoji reactions and private notifications respect ownership, deduplication and preferences',async t=>{
  const {request,comment}=await fixture(t);
  const parent=await(await comment('a',{text:'Secret spoiler',spoiler:true})).json();
  const react=(user,emoji,reacted)=>request(user,`/api/discussions/show/${parent.id}/reaction`,'PUT',{emoji,active:reacted});
  assert.equal((await react('b','bad',true)).status,400);
  assert.equal((await react('b','🔥',true)).status,200);await react('b','🔥',true);
  let inbox=await(await request('a','/api/community/notifications')).json();assert.equal(inbox.items.length,1);assert.equal(inbox.unreadCount,1);assert.equal(JSON.stringify(inbox).includes('Secret spoiler'),false);
  assert.equal((await(await request('b','/api/community/notifications')).json()).items.length,0);
  assert.equal((await request('b','/api/community/notifications/read','POST',{id:inbox.items[0].id})).status,404);
  await request('a','/api/community/notifications/read','POST',{all:true});assert.equal((await(await request('a','/api/community/notifications')).json()).unreadCount,0);
  await request('a','/api/community/preferences','PUT',{enabled:false});await comment('mod',{text:'Reply',parentId:parent.id});
  inbox=await(await request('a','/api/community/notifications')).json();assert.equal(inbox.items.length,1);
});

test('replies stay in their episode, likes are idempotent and deleting a parent preserves its replies',async t=>{
  const {db,request,comment}=await fixture(t);
  const parent=await(await comment('a',{text:'A spoiler',spoiler:true})).json();
  assert.equal(parent.spoiler,true);
  assert.equal((await comment('b',{text:'Invalid target',episode:'02.mp4',parentId:parent.id})).status,400);
  const reply=await(await comment('b',{text:'Reply',parentId:parent.id})).json();assert.equal(reply.parentId,parent.id);
  assert.equal((await comment('mod',{text:'Nested',parentId:reply.id})).status,400);
  assert.equal((await comment('mod',{text:'Bad flag',spoiler:'false'})).status,400);
  const like=liked=>request('b',`/api/discussions/show/${parent.id}/like`,'PUT',{liked});
  assert.deepEqual(await(await like(true)).json(),{liked:true,likes:1});
  assert.deepEqual(await(await like(true)).json(),{liked:true,likes:1});
  assert.equal((await request('b',`/api/discussions/show/${parent.id}/like`,'PUT',{liked:'true'})).status,400);
  assert.equal((await request('b',`/api/discussions/show/${parent.id}`,'DELETE')).status,403);
  let page=await(await request('b','/api/discussions/show?threads=1&episode=01.mp4')).json();
  assert.equal(page.threads.find(c=>c.id===parent.id).replies[0].id,reply.id);
  assert.equal(page.threads.find(c=>c.id===parent.id).liked,true);
  assert.equal((await request('a',`/api/discussions/show/${parent.id}`,'DELETE')).status,200);
  page=await(await request('b','/api/discussions/show?threads=1&episode=01.mp4')).json();
  const deleted=page.threads.find(c=>c.id===parent.id);assert.equal(deleted.text,'');assert.equal(deleted.accountId,null);assert.equal(deleted.replies[0].text,'Reply');
  assert.equal((await like(true)).status,404);
  assert.equal((await comment('mod',{text:'Cannot reply',parentId:parent.id})).status,400);
  // Account deletion must not fail because another account replied to its comment.
  db.prepare('DELETE FROM accounts WHERE id=?').run('a');
  assert.equal(db.prepare('SELECT parent_id FROM episode_discussions WHERE id=?').get(reply.id).parent_id,null);
});

test('reports are private, duplicate-resistant and support audited dismissal/removal',async t=>{
  const {db,request,comment}=await fixture(t);
  const parent=await(await comment('a',{text:'Reported content'})).json();
  const report=(user,id=parent.id)=>request(user,`/api/discussions/show/${id}/report`,'POST',{reason:'Harassment in this comment'});
  assert.equal((await report('b')).status,201);assert.equal((await report('b')).status,409);
  assert.equal((await report('mod')).status,201);
  assert.equal((await request('b','/api/admin/discussion-reports')).status,403);
  let queue=await(await request('mod','/api/admin/discussion-reports')).json();assert.equal(queue.total,2);assert.equal(queue.reports[0].commentBody,'Reported content');
  const id=queue.reports[0].id;
  assert.equal((await request('b',`/api/admin/discussion-reports/${id}/resolve`,'POST',{action:'remove'})).status,403);
  assert.equal((await request('mod',`/api/admin/discussion-reports/${id}/resolve`,'POST',{action:'invalid'})).status,400);
  assert.equal((await request('mod',`/api/admin/discussion-reports/${id}/resolve`,'POST',{action:'remove'})).status,200);
  queue=await(await request('mod','/api/admin/discussion-reports?status=removed')).json();assert.equal(queue.total,2);
  assert.equal(db.prepare('SELECT text FROM episode_discussions WHERE id=?').get(parent.id).text,'');
  assert.equal(db.prepare('SELECT reviewed_by FROM discussion_reports WHERE id=?').get(id).reviewed_by,'mod');
  assert.equal((await request('mod',`/api/admin/discussion-reports/${id}/resolve`,'POST',{action:'dismiss'})).status,409);
  assert.equal((await report('b',parent.id)).status,404);
  assert.equal((await report('b','legacy')).status,201);
  queue=await(await request('mod','/api/admin/discussion-reports')).json();
  assert.equal((await request('mod',`/api/admin/discussion-reports/${queue.reports[0].id}/resolve`,'POST',{action:'dismiss'})).status,200);
  assert.equal(db.prepare('SELECT text FROM episode_discussions WHERE id=?').get('legacy').text,'Existing discussion');
  assert.equal((await request('mod','/api/admin/discussion-reports?status=invalid')).status,400);
  // Removing the reviewing account leaves the report's resolution intact.
  db.prepare('DELETE FROM accounts WHERE id=?').run('mod');
});

test('thread and reply pagination has no gaps when creation timestamps tie',async t=>{
  const {db,request}=await fixture(t);
  const insert=db.prepare('INSERT INTO episode_discussions(id,account_id,show_id,episode_path,text,created_at,parent_id) VALUES (?,?,?,?,?,?,?)');
  for(let i=0;i<60;i++)insert.run('root'+String(i).padStart(2,'0'),'a','show','01.mp4','Root','2026-01-01',null);
  for(let i=0;i<55;i++)insert.run('reply'+String(i).padStart(2,'0'),'b','show','01.mp4','Reply','2026-01-01','root59');
  const initial=await(await request('a','/api/discussions/show?threads=1&episode=01.mp4')).json();assert.equal(initial.threads[0].replies.length,5);
  assert.equal((await request('a','/api/discussions/show?threads=1&episode=01.mp4&before=a&before=b')).status,400);
  let cursor=null,ids=[];
  do {const page=await(await request('a','/api/discussions/show?threads=1&episode=01.mp4'+(cursor?'&before='+cursor:''))).json();ids.push(...page.threads.map(c=>c.id));cursor=page.nextCursor;}while(cursor);
  assert.equal(ids.length,61);assert.equal(new Set(ids).size,61);
  const first=await(await request('a','/api/discussions/show/root59/replies')).json();assert.equal(first.replies.length,50);assert.ok(first.nextCursor);
  const last=await(await request('a','/api/discussions/show/root59/replies?after='+first.nextCursor)).json();assert.equal(last.replies.length,5);assert.equal(last.nextCursor,null);
  assert.equal(new Set([...first.replies,...last.replies].map(c=>c.id)).size,55);
  assert.equal((await request('a','/api/discussions/show?threads=1&episode=02.mp4&before=root59')).status,400);
});
