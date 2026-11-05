const {randomUUID}=require('node:crypto');

function schedule(channel,start,end,limit=2000) {
  const items=channel.playlist;
  if(!Array.isArray(items)||!Number.isFinite(channel.anchorMs)||!Number.isFinite(start)||!Number.isFinite(end)||items.some(item=>!Number.isFinite(item.durationMs)||item.durationMs<=0))return{programmes:[],truncated:false};
  const total=items.reduce((sum,item)=>sum+item.durationMs,0);
  if(!items.length||!Number.isFinite(total)||total<=0)return{programmes:[],truncated:false};
  let time=channel.anchorMs+Math.max(0,Math.floor((start-channel.anchorMs)/total))*total,index=0;
  const programmes=[];
  while(time<end&&programmes.length<limit){
    const item=items[index],finish=time+item.durationMs;
    if(finish>start)programmes.push({...item,startMs:time,endMs:finish,key:channel.id+':'+time});
    time=finish;index=(index+1)%items.length;
  }
  return{programmes,truncated:time<end};
}

function registerLive(app,{db,requireAuth,getLibrary,getStreamInfo,now=Date.now}) {
  db.exec(`CREATE TABLE IF NOT EXISTS live_channels(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,
    enabled INTEGER NOT NULL,anchor_ms INTEGER NOT NULL,playlist_json TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  const decode=row=>({id:row.id,name:row.name,description:row.description,enabled:!!row.enabled,anchorMs:row.anchor_ms,playlist:JSON.parse(row.playlist_json),updatedAt:row.updated_at});
  const all=()=>db.prepare('SELECT * FROM live_channels ORDER BY name,id').all().map(decode);
  function admin(req,res){const account=requireAuth(req,res);if(!account)return null;if(account.role!=='admin'){res.status(403).json({error:'Administrator access required'});return null;}return account;}
  function filter(req,res,account){
    let kids=account.adultContentAllowed===false;
    if(req.query.profileId){
      if(typeof req.query.profileId!=='string'){res.status(400).json({error:'Invalid profile'});return null;}
      const profile=db.prepare('SELECT is_kids FROM profiles WHERE id=? AND account_id=?').get(req.query.profileId,account.id);
      if(!profile){res.status(403).json({error:'Profile not available'});return null;}kids=kids||!!profile.is_kids;
    }
    const library=getLibrary();
    return channel=>channel.enabled&&channel.playlist.length&&channel.playlist.every(item=>{
      const show=library.getShow(item.showId);
      return !!show&&!!library.resolveEpisodeFile(item.showId,item.relPath)&&(!kids||!/(hentai|x-rated|^r\+|rx|^r -|^r$|nc-17|18\+)/i.test(show.rating||''));
    });
  }
  app.get('/api/live/guide',(req,res)=>{
    const account=requireAuth(req,res);if(!account)return;const allowed=filter(req,res,account);if(!allowed)return;
    const clock=now(),start=req.query.start===undefined?Math.floor(clock/1800000)*1800000:Number(req.query.start),hours=req.query.hours===undefined?6:Number(req.query.hours);
    if(!Number.isFinite(start)||start<clock-86400000||start>clock+7*86400000||!Number.isFinite(hours)||hours<1||hours>24)return res.status(400).json({error:'Choose a guide window within the next week, up to 24 hours'});
    res.json({serverTime:clock,startMs:start,endMs:start+hours*3600000,channels:all().filter(allowed).map(channel=>{
      const current=schedule(channel,clock,clock+86400000,2).programmes;
      return{id:channel.id,name:channel.name,description:channel.description,current:current[0]?.startMs<=clock?current[0]:null,next:current[0]?.startMs>clock?current[0]:current[1]||null,...schedule(channel,start,start+hours*3600000)};
    })});
  });
  app.get('/api/live/channels/:id/now',(req,res)=>{
    const account=requireAuth(req,res);if(!account)return;const allowed=filter(req,res,account);if(!allowed)return;
    const row=db.prepare('SELECT * FROM live_channels WHERE id=?').get(req.params.id),channel=row&&decode(row);
    if(!channel||!allowed(channel))return res.status(404).json({error:'This channel is not available to this profile'});
    const clock=now(),programmes=schedule(channel,clock,clock+86400000,2).programmes;
    const current=programmes[0]?.startMs<=clock?programmes[0]:null;
    res.json({serverTime:clock,channel:{id:channel.id,name:channel.name,description:channel.description},current,next:current?programmes[1]||null:programmes[0]||null,offsetSeconds:current?(clock-current.startMs)/1000:0});
  });
  app.get('/api/admin/live/channels',(req,res)=>{if(admin(req,res))res.json(all());});
  app.get('/api/admin/live/catalog',(req,res)=>{
    if(!admin(req,res))return;
    const library=getLibrary();res.json([...library.cache.anime,...library.cache.movies].map(show=>({id:show.id,title:show.title,episodes:(show.groups||[]).flatMap(group=>group.episodes.map(ep=>({relPath:ep.relPath,title:ep.title,index:ep.index,season:group.name})))})));
  });
  async function save(req,res){
    if(!admin(req,res))return;const input=req.body||{},old=req.params.id&&db.prepare('SELECT * FROM live_channels WHERE id=?').get(req.params.id);
    if(req.params.id&&!old)return res.status(404).json({error:'Channel not found'});
    const name=typeof input.name==='string'?input.name.trim():'',description=typeof input.description==='string'?input.description.trim():'';
    if(!name||name.length>60||description.length>300||typeof input.enabled!=='boolean'||!Array.isArray(input.playlist)||!input.playlist.length||input.playlist.length>200)return res.status(400).json({error:'Provide a name, an enabled state and 1–200 episodes'});
    if(!old&&all().length>=25)return res.status(400).json({error:'A server can have up to 25 live channels'});
    const playlist=[],library=getLibrary();
    for(const entry of input.playlist){
      if(typeof entry?.showId!=='string'||typeof entry?.relPath!=='string')return res.status(400).json({error:'Invalid programme'});
      const show=library.getShow(entry.showId),ep=show?.groups?.flatMap(g=>g.episodes).find(e=>e.relPath===entry.relPath),file=ep&&library.resolveEpisodeFile(show.id,ep.relPath);
      if(!file)return res.status(400).json({error:'A selected episode is no longer in the library'});
      let info;try{info=await getStreamInfo(file);}catch{return res.status(400).json({error:'Cannot inspect '+show.title+'. Check file access and FFprobe.'});}
      if(!info||!Number.isFinite(info.duration)||info.duration<1||info.duration>86400)return res.status(400).json({error:'FFprobe must provide a valid duration for every programme'});
      playlist.push({showId:show.id,relPath:ep.relPath,showTitle:show.title,title:ep.title,index:ep.index,cover:show.cover||'/img/placeholder-poster.svg',durationMs:Math.round(info.duration*1000)});
    }
    if(old){const latest=db.prepare('SELECT * FROM live_channels WHERE id=?').get(old.id);if(!latest||JSON.stringify(latest)!==JSON.stringify(old))return res.status(409).json({error:'This channel changed. Reload before saving.'});}
    else if(all().length>=25)return res.status(400).json({error:'A server can have up to 25 live channels'});
    const id=old?.id||randomUUID(),same=old&&JSON.stringify(decode(old).playlist)===JSON.stringify(playlist),anchorMs=same&&!input.restart?old.anchor_ms:now();
    db.prepare('INSERT INTO live_channels VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,enabled=excluded.enabled,anchor_ms=excluded.anchor_ms,playlist_json=excluded.playlist_json,updated_at=excluded.updated_at').run(id,name,description,input.enabled?1:0,anchorMs,JSON.stringify(playlist),new Date(now()).toISOString());
    res.status(old?200:201).json(decode(db.prepare('SELECT * FROM live_channels WHERE id=?').get(id)));
  }
  app.post('/api/admin/live/channels',save);app.put('/api/admin/live/channels/:id',save);
  app.delete('/api/admin/live/channels/:id',(req,res)=>{if(!admin(req,res))return;db.prepare('DELETE FROM live_channels WHERE id=?').run(req.params.id);res.json({ok:true});});
}
module.exports={registerLive,schedule};
