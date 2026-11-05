const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanSubtitleLine: clean } = require('../server/subtitle-text');
test('generated karaoke comments and orphaned ASS commands never become dialogue', () => {
  assert.equal(clean('{Kara Effector 3.5 {\\an5\\move(1,2,3,4)}\\p1}m 0 0'), 'm 0 0');
  assert.equal(clean('{Kara Effector 3.5 {\\an5}broken'), '');
  assert.equal(clean('\\an5\\move(1410,72,1430,-40)\\fscx15\\p1 m 0 0'), '');
  assert.equal(clean('{\\an8}{\\kf20}Keep {\\i1}these lyrics{\\i0}'), 'Keep these lyrics');
  assert.equal(clean('Normal dialogue, 123 and C:\\Users'), 'Normal dialogue, 123 and C:\\Users');
});
