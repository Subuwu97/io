const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeStreams } = require('../server/ffmpeg');
test('embedded chapter metadata retains seek times and rejects invalid intervals', () => {
  const info=analyzeStreams({streams:[],chapters:[
    {start_time:'0',end_time:'90',tags:{title:'Opening'}},
    {start_time:'90',end_time:'1200'},
    {start_time:'invalid',end_time:'10'},
    {start_time:'9',end_time:'2'},
    {start_time:'-1',end_time:'2'}
  ]},'episode.mkv');
  assert.deepEqual(info.chapters,[{start:0,end:90,title:'Opening'},{start:90,end:1200,title:'Chapter 2'}]);
  assert.deepEqual(analyzeStreams({streams:[]},'episode.mp4').chapters,[]);
});
