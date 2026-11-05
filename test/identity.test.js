const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {scryptSync,randomBytes}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const express=require('express');
const {createServices}=require('../server/services');
const {registerIdentity}=require('../server/identity');

async function fixture(t){
  const directory=fs.mkdtempSync(path.join(process.env.IO_TEST_ROOT||os.tmpdir(),'io-identity-'));
  const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT,salt TEXT,role TEXT,approved INTEGER,totp_enabled INTEGER DEFAULT 0);CREATE TABLE sessions(token TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE);`);
  let clock=Date.now(),providerUser={id:'123456789',username:'DiscordUser',email:'alice@io.invalid',verified:true};const sent=[],calls=[];
  function add(id,username,role='user',approved=true,password='Original-password-123'){const salt=randomBytes(16).toString('hex');db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?,0)').run(id,username,scryptSync(password,salt,64).toString('hex'),salt,role,approved?1:0);return get(id);}
  function get(id){const row=db.prepare('SELECT * FROM accounts WHERE id=?').get(id);return row?{id:row.id,username:row.username,role:row.role,approved:!!row.approved}:null;}
  const accounts={getAccount:get,accountCount:()=>db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,
    async verifyPassword({username,password,totpCode}){const row=db.prepare('SELECT * FROM accounts WHERE username=?').get(username);if(!row||typeof password!=='string'||scryptSync(password,row.salt,64).toString('hex')!==row.password_hash)return null;if(!row.approved){const error=new Error('Pending approval');error.pendingApproval=true;throw error;}if(row.totp_enabled&&!totpCode){const error=new Error('Two-factor required');error.requiresTotp=true;throw error;}if(row.totp_enabled&&totpCode!=='123456')return null;return get(row.id);},
    verifyTotpOrBackupCode:(id,code)=>code==='123456',checkLoginAllowed(){},recordLoginFailure(){},recordLoginSuccess(){},
    createSession(id){const token=randomBytes(16).toString('hex');db.prepare('INSERT INTO sessions VALUES (?,?)').run(token,id);return token;},
    async createAccount(input){return add('new_'+input.username,input.username,'user',!input.registrationPolicy.approval,input.password);}};
  add('a','Alice','admin');add('b','Bob');
  const services=createServices(directory,{transportFactory:()=>({async sendMail(mail){sent.push(mail);},close(){}})});
  const serviceInput={publicUrl:'http://localhost',emailEnabled:true,smtpHost:'smtp.io.invalid',smtpPort:587,smtpSecure:false,smtpUser:'test-user',smtpPassword:'SMTP-test-secret',smtpFrom:'sender@io.invalid',discordEnabled:true,discordClientId:'12345678',discordClientSecret:'Discord-test-secret'};services.save(serviceInput);
  const app=express();app.use(express.json());const requireAuth=(req,res)=>{const id=req.headers['x-test-account']||(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('io_session=')).map(s=>db.prepare('SELECT account_id FROM sessions WHERE token=?').get(s.slice(11))?.account_id)[0];const account=get(id||'');if(!account){res.status(401).json({error:'Not signed in'});return null;}return account;};
  const config={allowSelfRegistration:true,requireApprovalForSelfRegistration:true};
  registerIdentity(app,{db,accounts,services,requireAuth,setSessionCookie:(res,token)=>res.append('Set-Cookie','io_session='+token+'; HttpOnly; Path=/; SameSite=Lax'),getConfig:()=>config,now:()=>clock,
    async fetchImpl(url,options){calls.push({url,options});if(url.endsWith('/token'))return new Response(JSON.stringify({access_token:'temporary-test-token'}));if(url.endsWith('/users/@me'))return new Response(JSON.stringify(providerUser));throw new Error('Unexpected provider request');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  async function request(url,{actor,method='GET',body,cookie,origin}={}){return fetch(`http://127.0.0.1:${server.address().port}${url}`,{redirect:'manual',method,headers:{'Content-Type':'application/json',...(actor?{'x-test-account':actor}:{}),...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  const tokenFromMail=kind=>sent.findLast(mail=>mail.text.includes('/#/'+kind+'/')).text.match(new RegExp('/#/'+kind+'/([a-f0-9]{64})'))[1];
  async function oauth(actor){const r=actor?await request('/api/identity/discord/connect',{actor,method:'POST',body:{password:'Original-password-123'}}):await request('/api/auth/discord/start');const url=actor?(await r.json()).url:r.headers.get('location');return{state:new URL(url).searchParams.get('state'),cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};}
  return{db,accounts,services,serviceInput,sent,calls,request,tokenFromMail,oauth,config,advance:ms=>clock+=ms,user:value=>providerUser=value};
}

test('verified email login and reset enforce token expiry, single use, 2FA and session revocation',async t=>{
  const f=await fixture(t),proof={password:'Original-password-123'};
  assert.equal((await f.request('/api/identity/email',{actor:'a',method:'POST',body:{email:'Alice@io.invalid',...proof}})).status,202);
  assert.equal((await f.request('/api/auth/email/login',{method:'POST',body:{username:'alice@io.invalid',password:proof.password}})).status,401);
  const verify=f.tokenFromMail('verify-email');assert.equal((await f.request('/api/identity/verify-email',{method:'POST',body:{token:verify}})).status,200);
  assert.equal((await f.request('/api/identity/verify-email',{method:'POST',body:{token:verify}})).status,400);
  assert.equal((await f.request('/api/auth/email/login',{method:'POST',body:{username:'ALICE@io.invalid',password:proof.password}})).status,200);
  f.accounts.createSession('a');f.accounts.createSession('b');f.db.prepare('UPDATE accounts SET totp_enabled=1 WHERE id=?').run('a');
  const unknown=await f.request('/api/auth/recover',{method:'POST',body:{email:'unknown@io.invalid'}}),known=await f.request('/api/auth/recover',{method:'POST',body:{email:'alice@io.invalid'}});assert.equal(known.status,unknown.status);assert.deepEqual(await known.json(),await unknown.json());
  const token=f.tokenFromMail('reset-password');
  assert.equal((await f.request('/api/auth/reset',{method:'POST',body:{token,newPassword:'Updated-password-123'}})).status,400);
  assert.equal((await f.request('/api/auth/reset',{method:'POST',body:{token,newPassword:'Updated-password-123',totpCode:'123456'}})).status,200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE account_id=?').get('a').n,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE account_id=?').get('b').n,1);
  assert.equal(f.db.prepare('SELECT totp_enabled FROM accounts WHERE id=?').get('a').totp_enabled,1);
  assert.equal((await f.request('/api/auth/reset',{method:'POST',body:{token,newPassword:'Other-password-123',totpCode:'123456'}})).status,400);
  assert.ok(await f.accounts.verifyPassword({username:'Alice',password:'Updated-password-123',totpCode:'123456'}));
  await f.request('/api/auth/recover',{method:'POST',body:{email:'alice@io.invalid'}});const expired=f.tokenFromMail('reset-password');f.advance(31*60000);
  assert.equal((await f.request('/api/auth/reset',{method:'POST',body:{token:expired,newPassword:'Should-not-change',totpCode:'123456'}})).status,400);
});

test('service settings redact credentials, reject hostile origins and require administrator reauthentication',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/api/admin/services',{actor:'b'})).status,403);
  const view=await(await f.request('/api/admin/services',{actor:'a'})).json();assert.equal(view.smtpPassword,undefined);assert.equal(view.discordClientSecret,undefined);assert.equal(view.smtpPasswordConfigured,true);
  assert.equal((await f.request('/api/admin/services',{actor:'a',method:'PUT',body:{...f.serviceInput,password:'wrong'}})).status,403);
  assert.equal((await f.request('/api/admin/services',{actor:'a',method:'PUT',origin:'https://evil.invalid',body:{...f.serviceInput,password:'Original-password-123'}})).status,403);
  assert.equal((await f.request('/api/admin/services',{actor:'a',method:'PUT',body:{...f.serviceInput,publicUrl:'http://public.io.invalid',password:'Original-password-123'}})).status,400);
  const saved=await f.request('/api/admin/services',{actor:'a',method:'PUT',body:{...f.serviceInput,smtpPassword:'',discordClientSecret:'',password:'Original-password-123'}});assert.equal(saved.status,200);assert.equal(f.services.get().smtpPassword,'SMTP-test-secret');
});

test('Discord state is browser bound and replay resistant; matching email never links a local account',async t=>{
  const f=await fixture(t);f.db.prepare('INSERT INTO account_email VALUES (?,?,?)').run('a','alice@io.invalid','2026-01-01');
  const first=await f.oauth();
  const invalid=await f.request('/api/auth/discord/callback?state='+first.state+'&code=test');assert.match(invalid.headers.get('location'),/auth-error/);assert.equal(f.calls.length,0);
  const result=await f.request('/api/auth/discord/callback?state='+first.state+'&code=test',{cookie:first.cookie});assert.match(result.headers.get('location'),/approval/);
  const linked=f.db.prepare("SELECT account_id FROM account_external WHERE subject='123456789'").get();assert.notEqual(linked.account_id,'a');assert.equal(f.db.prepare('SELECT role FROM accounts WHERE id=?').get(linked.account_id).role,'user');
  const replay=await f.request('/api/auth/discord/callback?state='+first.state+'&code=test',{cookie:first.cookie});assert.match(replay.headers.get('location'),/auth-error/);assert.equal(f.calls.length,2);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM account_email WHERE email=?').get('alice@io.invalid').n,1);
});

test('Discord preserves local two-factor checks and connecting accounts requires password proof',async t=>{
  const f=await fixture(t);f.db.prepare("INSERT INTO account_external VALUES ('a','discord','123456789','Alice')").run();f.db.prepare("UPDATE accounts SET totp_enabled=1 WHERE id='a'").run();
  const start=await f.oauth(),callback=await f.request('/api/auth/discord/callback?state='+start.state+'&code=test',{cookie:start.cookie});
  const location=callback.headers.get('location');assert.match(location,/discord-2fa/);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  const token=location.split('/').at(-1),cookie=callback.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  assert.equal((await f.request('/api/auth/discord/complete',{method:'POST',cookie,body:{token,totpCode:'wrong'}})).status,400);
  assert.equal((await f.request('/api/auth/discord/complete',{method:'POST',body:{token,totpCode:'123456'}})).status,400);
  assert.equal((await f.request('/api/auth/discord/complete',{method:'POST',cookie,body:{token,totpCode:'123456'}})).status,200);
  assert.equal((await f.request('/api/auth/discord/complete',{method:'POST',cookie,body:{token,totpCode:'123456'}})).status,400);
  assert.equal((await f.request('/api/auth/discord/start?link=1',{actor:'b'})).status,400);
  assert.equal((await f.request('/api/identity/discord/connect',{actor:'b',method:'POST',body:{password:'wrong'}})).status,403);
  const linked=await f.oauth('b');const denied=await f.request('/api/auth/discord/callback?state='+linked.state+'&code=test',{cookie:linked.cookie,actor:'b'});assert.match(denied.headers.get('location'),/already/);
});
