const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildCollections}=require('../public/js/io-discovery');
test('browse collections use real genre matches, deduplicate cards and vary reproducibly by seed',()=>{
  const titles=Array.from({length:20},(_,i)=>({id:String(i),genres:[i%2?'Romance':'Slice-of-Life']}));
  const input=[...titles,titles[0],{id:'no-genre'},{id:'different',genres:['History']}];
  const first=buildCollections(input,10);
  assert.deepEqual(first,buildCollections(input,10));assert.notDeepEqual(first,buildCollections(input,11));
  for(const row of first){assert.ok(row.items.length<=12);assert.equal(new Set(row.items.map(t=>t.id)).size,row.items.length);assert.ok(!row.items.some(t=>['no-genre','different'].includes(t.id)));}
  assert.ok(first.some(r=>r.title==='Cozy vibes only'));assert.ok(first.some(r=>r.title==='Love is in the air'));
  assert.deepEqual(buildCollections([],1),[]);assert.equal(input.length,23);
});
