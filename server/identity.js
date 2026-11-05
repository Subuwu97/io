const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const {email}=require('./services');
const {createQueue}=require('./resource-queue');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

function registerIdentity(app,{db,accounts,services,requireAuth,setSessionCookie,getConfig,fetchImpl=fetch,now=Date.now}){
  const passwordQueue=createQueue({software:2,maxQueue:12,timeoutMs:15000});
  db.exec(`CREATE TABLE IF NOT EXISTS account_email(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,email TEXT NOT NULL UNIQUE,verified_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_external(account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,provider TEXT NOT NULL,subject TEXT NOT NULL,display_name TEXT NOT NULL,PRIMARY KEY(provider,subject),UNIQUE(account_id,provider));
    CREATE TABLE IF NOT EXISTS identity_tokens(hash TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,kind TEXT NOT NULL,payload TEXT NOT NULL,credential_hash TEXT,expires_at INTEGER NOT NULL,used_at INTEGER);
    CREATE INDEX IF NOT EXISTS identity_expiry ON identity_tokens(expires_at);`);
  const limits=new Map();
  function limit(key,max=5){const clock=now(),old=limits.get(key);if(!old||clock-old.at>900000)limits.set(key,{at:clock,n:1});else if(++old.n>max){const error=new Error('Please wait before trying again');error.status=429;throw error;}if(limits.size>5000){for(const [k,v]of limits)if(clock-v.at>900000)limits.delete(k);if(limits.size>5000)limits.delete(limits.keys().next().value);}}
  function issue(kind,accountId,payload={},ttl=1800000){
    const token=crypto.randomBytes(32).toString('hex'),account=accountId&&db.prepare('SELECT password_hash FROM accounts WHERE id=?').get(accountId);
    db.prepare('DELETE FROM identity_tokens WHERE expires_at<? OR (account_id=? AND kind=? AND kind IN (\'reset\',\'verify\'))').run(now()-86400000,accountId,kind);
    db.prepare('INSERT INTO identity_tokens VALUES (?,?,?,?,?,?,NULL)').run(digest(token),accountId,kind,JSON.stringify(payload),account?.password_hash||null,now()+ttl);return token;
  }
  function read(token,kind){
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;
    const row=db.prepare('SELECT * FROM identity_tokens WHERE hash=? AND kind=? AND used_at IS NULL AND expires_at>?').get(digest(token),kind,now());
    return row?{...row,payload:JSON.parse(row.payload)}:null;
  }
  function consume(row){if(!db.prepare('UPDATE identity_tokens SET used_at=? WHERE hash=? AND used_at IS NULL AND expires_at>?').run(now(),row.hash,now()).changes)throw new Error('This link has expired or has already been used');}
  function cookie(req,name){return(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';}
  function putCookie(res,name,value,seconds){res.append('Set-Cookie',`${name}=${value}; HttpOnly; Path=/; Max-Age=${seconds}; SameSite=Lax${services.get().publicUrl.startsWith('https:')?'; Secure':''}`);}
  function same(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&crypto.timingSafeEqual(left,right);}
  async function reauth(req,account){
    try{const proof=await accounts.verifyPassword({username:account.username,password:req.body?.password,totpCode:req.body?.totpCode});if(proof?.id===account.id)return;}
    catch(error){if(!error.requiresTotp&&!error.pendingApproval)throw error;}
    const error=new Error('Confirm your current password and two-factor code, if enabled');error.status=403;throw error;
  }
  const admin=(req,res)=>{const account=requireAuth(req,res);if(account&&account.role!=='admin'){res.status(403).json({error:'Administrator access required'});return null;}return account;};
  const safe=handler=>(req,res,next)=>Promise.resolve().then(()=>handler(req,res)).catch(error=>{if(res.headersSent)return next(error);res.status(error.status||400).json({error:error.message||'Request failed'});});
  app.use(['/api/identity','/api/admin/services','/api/auth/email','/api/auth/recover','/api/auth/reset','/api/auth/discord/complete'],(req,res,next)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin){const origins=[`${req.protocol}://${req.get('host')}`,services.get().publicUrl];if(!origins.includes(req.headers.origin))return res.status(403).json({error:'Request origin is not allowed'});}next();
  });
  app.get('/api/identity/options',(req,res)=>res.json(services.status()));
  app.get('/api/admin/services',(req,res)=>{if(admin(req,res))res.json(services.view());});
  app.put('/api/admin/services',safe(async(req,res)=>{const account=admin(req,res);if(!account)return;await reauth(req,account);res.json(services.save(req.body));}));
  app.post('/api/admin/services/test-mail',safe(async(req,res)=>{const account=admin(req,res);if(!account)return;await reauth(req,account);limit('test-mail:'+account.id,3);try{await services.send(email(req.body.to),'I/O email test','Email delivery for your I/O server is working.');}catch{const e=new Error('Email could not be sent. Check the SMTP settings, sender and server connection.');e.status=502;throw e;}res.json({ok:true});}));
  app.get('/api/identity/account',(req,res)=>{
    const account=requireAuth(req,res);if(!account)return;
    res.json({email:db.prepare('SELECT email,verified_at AS verifiedAt FROM account_email WHERE account_id=?').get(account.id)||null,
      discord:db.prepare("SELECT display_name AS displayName FROM account_external WHERE account_id=? AND provider='discord'").get(account.id)||null,availability:services.status()});
  });
  app.post('/api/identity/email',safe(async(req,res)=>{
    const account=requireAuth(req,res);if(!account)return;await reauth(req,account);
    if(!services.status().email)return res.status(503).json({error:'The administrator must configure email delivery first'});
    const address=email(req.body.email);limit('verify:'+account.id,3);
    const existing=db.prepare('SELECT account_id FROM account_email WHERE email=?').get(address);
    if(existing&&existing.account_id!==account.id)return res.status(400).json({error:'This address is already linked to another account'});
    const token=issue('verify',account.id,{email:address});
    try{await services.send(address,'Verify your I/O email',`Confirm this email address for your I/O account:\n\n${services.get().publicUrl}/#/verify-email/${token}\n\nThis link expires in 30 minutes. If you did not request this, ignore this message.`);}
    catch{db.prepare('DELETE FROM identity_tokens WHERE hash=?').run(digest(token));return res.status(502).json({error:'Verification email could not be sent. Ask the administrator to check email delivery.'});}
    res.status(202).json({message:'Check your email for a verification link.'});
  }));
  app.post('/api/identity/verify-email',safe(async(req,res)=>{
    const row=read(req.body?.token,'verify');if(!row)return res.status(400).json({error:'This link has expired or has already been used'});
    const account=db.prepare('SELECT * FROM accounts WHERE id=?').get(row.account_id);
    if(!account||account.password_hash!==row.credential_hash)return res.status(400).json({error:'Request a new verification link'});
    const owner=db.prepare('SELECT account_id FROM account_email WHERE email=?').get(row.payload.email);
    if(owner&&owner.account_id!==account.id)return res.status(400).json({error:'This address is already linked to another account'});
    db.exec('BEGIN IMMEDIATE');try{consume(row);db.prepare('INSERT INTO account_email VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at').run(account.id,row.payload.email,new Date(now()).toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    res.json({message:'Email verified. You can now sign in with this email address.'});
  }));
  app.post('/api/auth/email/login',safe(async(req,res)=>{
    const identifier=typeof req.body?.username==='string'?req.body.username.trim().toLowerCase():'';
    if(identifier.length>254||typeof req.body?.password!=='string'||req.body.password.length>1024)return res.status(401).json({error:'Incorrect email or password'});
    limit('login-ip:'+req.ip,30);
    const match=db.prepare('SELECT a.username FROM account_email e JOIN accounts a ON a.id=e.account_id WHERE e.email=?').get(identifier),key=match?.username||identifier;
    accounts.checkLoginAllowed(key);let account;
    try{if(match)account=await accounts.verifyPassword({username:match.username,password:req.body.password,totpCode:req.body.totpCode});
      else{const release=await passwordQueue.acquireSlot();try{await scrypt(req.body.password,'io-email-dummy',64);}finally{release();}}}
    catch(error){if(error.requiresTotp)return res.json({requiresTotp:true});if(error.pendingApproval)return res.status(403).json({error:error.message});throw error;}
    if(!account){accounts.recordLoginFailure(key);return res.status(401).json({error:'Incorrect email or password'});}
    accounts.recordLoginSuccess(key);setSessionCookie(res,accounts.createSession(account.id,req.headers['user-agent']));res.json({account});
  }));
  app.post('/api/auth/recover',safe(async(req,res)=>{
    if(!services.status().email)return res.status(503).json({error:'Email recovery is not configured. Ask an administrator to reset your password.'});
    limit('recover-ip:'+req.ip,10);let address;try{address=email(req.body?.email);}catch{return res.status(202).json({message:'If this verified address is registered, a reset link will be sent.'});}
    limit('recover-address:'+digest(address),3);
    const match=db.prepare('SELECT account_id FROM account_email WHERE email=?').get(address);
    if(match){const token=issue('reset',match.account_id);
      try{await services.send(address,'Reset your I/O password',`Reset your I/O password:\n\n${services.get().publicUrl}/#/reset-password/${token}\n\nThis link expires in 30 minutes. Two-factor authentication remains enabled. If you did not request this, ignore this message.`);}
      catch{db.prepare('DELETE FROM identity_tokens WHERE hash=?').run(digest(token));/* The public response never identifies a registered address. */}}
    res.status(202).json({message:'If this verified address is registered, a reset link will be sent.'});
  }));
  app.post('/api/auth/reset',safe(async(req,res)=>{
    limit('reset-ip:'+req.ip,15);const row=read(req.body?.token,'reset');
    if(!row)return res.status(400).json({error:'This link has expired or has already been used'});
    limit('reset-token:'+row.hash,5);
    const password=req.body?.newPassword;if(typeof password!=='string'||password.length<8||password.length>1024)return res.status(400).json({error:'Use a password between 8 and 1,024 characters'});
    const account=db.prepare('SELECT * FROM accounts WHERE id=?').get(row.account_id);
    if(!account||account.password_hash!==row.credential_hash)return res.status(400).json({error:'Request a new reset link'});
    if(account.totp_enabled&&!accounts.verifyTotpOrBackupCode(account.id,req.body?.totpCode))return res.status(400).json({error:'Enter your authenticator code or a backup code'});
    const release=await passwordQueue.acquireSlot();let salt,hash;try{salt=crypto.randomBytes(16).toString('hex');hash=(await scrypt(password,salt,64)).toString('hex');}finally{release();}
    db.exec('BEGIN IMMEDIATE');try{
      consume(row);if(!db.prepare('UPDATE accounts SET salt=?,password_hash=? WHERE id=? AND password_hash=?').run(salt,hash,account.id,row.credential_hash).changes)throw new Error('Request a new reset link');
      db.prepare('DELETE FROM sessions WHERE account_id=?').run(account.id);db.prepare('DELETE FROM identity_tokens WHERE account_id=? AND kind IN (\'reset\',\'verify\')').run(account.id);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    res.json({message:'Password reset. Sign in again with your new password.'});
  }));

  function discordStart(req,res,account,link){
    const config=services.get(),redirect=config.publicUrl+'/api/auth/discord/callback';
    const state=issue('oauth',account?.id||null,{link,redirect,clientId:config.discordClientId},600000);putCookie(res,'io_discord_state',state,600);
    return 'https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:config.discordClientId,redirect_uri:redirect,response_type:'code',scope:'identify email',state});
  }
  app.get('/api/auth/discord/start',safe(async(req,res)=>{
    if(!services.status().discord)return res.status(503).send('Discord sign-in is not configured.');
    if(req.query.link)return res.status(400).send('Connect Discord from your account settings.');
    res.redirect(discordStart(req,res,null,false));
  }));
  app.post('/api/identity/discord/connect',safe(async(req,res)=>{
    const account=requireAuth(req,res);if(!account)return;await reauth(req,account);
    if(!services.status().discord)return res.status(503).json({error:'Discord sign-in is not configured'});
    res.json({url:discordStart(req,res,account,true)});
  }));
  app.post('/api/identity/discord/disconnect',safe(async(req,res)=>{
    const account=requireAuth(req,res);if(!account)return;await reauth(req,account);
    db.prepare("DELETE FROM account_external WHERE account_id=? AND provider='discord'").run(account.id);
    db.prepare("DELETE FROM identity_tokens WHERE account_id=? AND kind IN ('oauth','oauth-2fa')").run(account.id);res.json({ok:true});
  }));
  app.get('/api/auth/discord/callback',safe(async(req,res)=>{
    function fail(message){putCookie(res,'io_discord_state','',0);res.redirect('/#/auth-error/'+encodeURIComponent(message));}
    const row=read(req.query.state,'oauth'),config=services.get();
    if(!row||!same(req.query.state,cookie(req,'io_discord_state')))return fail('Discord sign-in expired. Please try again.');
    consume(row);
    if(!services.status().discord||row.payload.clientId!==config.discordClientId||row.payload.redirect!==config.publicUrl+'/api/auth/discord/callback'||req.query.error||typeof req.query.code!=='string'||req.query.code.length>2048)return fail('Discord sign-in was cancelled or is no longer configured.');
    try{
      if(row.payload.link){const actor=requireAuth(req,res);if(!actor||actor.id!==row.account_id)return res.headersSent?undefined:fail('Sign in again before connecting Discord.');}
      const response=await fetchImpl('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.discordClientId,client_secret:config.discordClientSecret,grant_type:'authorization_code',code:req.query.code,redirect_uri:row.payload.redirect}),signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Token exchange failed');const token=await response.json();
      if(typeof token.access_token!=='string')throw new Error('Missing access token');
      let user;try{const response=await fetchImpl('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('User lookup failed');user=await response.json();}
      finally{/* Access tokens are used in memory only; no Discord token is stored. */}
      if(!/^\d{5,30}$/.test(user.id))throw new Error('Invalid Discord account');
      const external=db.prepare("SELECT * FROM account_external WHERE provider='discord' AND subject=?").get(user.id);
      let accountId=external?.account_id;
      if(row.payload.link){
        const local=db.prepare('SELECT password_hash FROM accounts WHERE id=?').get(row.account_id);
        if(!local||local.password_hash!==row.credential_hash)return fail('Your password changed. Confirm the connection again in Settings.');
        if(external&&external.account_id!==row.account_id)return fail('This Discord account is already connected to another I/O account.');
        if(db.prepare("SELECT 1 FROM account_external WHERE account_id=? AND provider='discord'").get(row.account_id)&&!external)return fail('This I/O account already has a Discord connection.');
        db.prepare("INSERT INTO account_external VALUES (?,'discord',?,?) ON CONFLICT(provider,subject) DO UPDATE SET display_name=excluded.display_name").run(row.account_id,user.id,String(user.global_name||user.username||'Discord').slice(0,100));
        putCookie(res,'io_discord_state','',0);return res.redirect('/#/account-security');
      }
      if(!accountId){
        if(!accounts.accountCount())return fail('Create the first administrator account locally before using Discord.');
        const policy=getConfig();if(!policy.allowSelfRegistration)return fail('Ask an administrator to create your I/O account, then connect Discord in Settings.');
        const account=await accounts.createAccount({username:'discord_'+user.id,password:crypto.randomBytes(48).toString('hex'),role:'user',adultContentAllowed:false,registrationPolicy:{admin:false,allow:!!policy.allowSelfRegistration,approval:!!policy.requireApprovalForSelfRegistration}});accountId=account.id;
        db.prepare("INSERT INTO account_external VALUES (?,'discord',?,?)").run(accountId,user.id,String(user.global_name||user.username||'Discord').slice(0,100));
        if(user.verified&&user.email){try{const address=email(user.email);if(!db.prepare('SELECT 1 FROM account_email WHERE email=?').get(address))db.prepare('INSERT INTO account_email VALUES (?,?,?)').run(accountId,address,new Date(now()).toISOString());}catch{}}
      }
      const account=db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId);if(!account?.approved)return fail('Your I/O account is waiting for administrator approval.');
      if(account.totp_enabled){const challenge=issue('oauth-2fa',account.id,{},300000);putCookie(res,'io_discord_state','',0);putCookie(res,'io_discord_challenge',challenge,300);return res.redirect('/#/discord-2fa/'+challenge);}
      setSessionCookie(res,accounts.createSession(accountId,req.headers['user-agent']));putCookie(res,'io_discord_state','',0);res.redirect('/#/');
    }catch{return fail('Discord sign-in could not be completed. Please try again.');}
  }));
  app.post('/api/auth/discord/complete',safe(async(req,res)=>{
    limit('oauth-complete:'+req.ip,15);const row=read(req.body?.token,'oauth-2fa');
    if(!row||!same(req.body.token,cookie(req,'io_discord_challenge')))return res.status(400).json({error:'Discord sign-in expired. Start again.'});
    limit('oauth-challenge:'+row.hash,5);
    const account=db.prepare('SELECT * FROM accounts WHERE id=?').get(row.account_id);
    if(!account?.approved||account.password_hash!==row.credential_hash||!accounts.verifyTotpOrBackupCode(account.id,req.body.totpCode))return res.status(400).json({error:'Incorrect two-factor code'});
    consume(row);setSessionCookie(res,accounts.createSession(account.id,req.headers['user-agent']));putCookie(res,'io_discord_challenge','',0);res.json({account:accounts.getAccount(account.id)});
  }));
  return{issue,read};
}
module.exports={registerIdentity,digest};
