const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const register = require('../server/episode-discussions');

test('episode discussions authenticate, validate episode identity, persist text and enforce delete ownership', async t => {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE accounts(id TEXT PRIMARY KEY, username TEXT); INSERT INTO accounts VALUES ('a','Alice'),('b','Bob');");
  const app=express(); app.use(express.json());
  register(app,{db,requireAuth(req,res){const id=req.headers['x-test-user'];if(!['a','b'].includes(id)){res.status(401).end();return null;}return {id,username:id,role:'user'};},getShow:id=>id==='show'?{groups:[{episodes:[{relPath:'season/01.mp4'}]}]}:null});
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
  const url=`http://127.0.0.1:${server.address().port}/api/discussions/show`;
  const post=(user,body)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-test-user':user},body:JSON.stringify(body)});
  assert.equal((await fetch(url+'?episode=season%2F01.mp4')).status,401);
  assert.equal((await post('a',{episode:'foreign.mp4',text:'hello'})).status,404);
  assert.equal((await post('a',{episode:'season/01.mp4',text:' '})).status,400);
  const response=await post('a',{episode:'season/01.mp4',text:'<script>example</script>'}); assert.equal(response.status,201);const comment=await response.json();
  assert.equal((await post('a',{episode:'season/01.mp4',text:'Too soon'})).status,429);
  const rows=await (await fetch(url+'?episode=season%2F01.mp4',{headers:{'x-test-user':'b'}})).json();
  assert.equal(rows.length,1); assert.equal(rows[0].text,'<script>example</script>'); assert.equal(rows[0].username,'Alice');
  assert.equal((await fetch(url+'/'+comment.id,{method:'DELETE',headers:{'x-test-user':'b'}})).status,403);
  assert.equal((await fetch(url+'/'+comment.id,{method:'DELETE',headers:{'x-test-user':'a'}})).status,200);
});
