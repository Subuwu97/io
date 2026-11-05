const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const WebSocket = require('ws');
const party = require('../server/watch-party');
test('watch parties require sessions, reject foreign origins and ignore spoofed host identities', { timeout: 10000 }, async t => {
  const server = http.createServer();
  const wss = party.attach(server, { authenticate: req => req.headers.cookie === 'valid' ? { id: 'owner', username: 'Real owner' } : req.headers.cookie === 'guest' ? { id: 'guest', username: 'Real guest' } : null });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/api/watch-party/ws`;
  const sockets = [];
  t.after(() => { sockets.forEach(socket => socket.terminate()); wss.close(); server.close(); });
  async function denied(headers, status) {
    const socket = new WebSocket(url, { headers }); sockets.push(socket);
    socket.on('error', () => {});
    const [, response] = await once(socket, 'unexpected-response'); assert.equal(response.statusCode, status); socket.terminate();
  }
  await denied({}, 401); await denied({ Cookie: 'valid', Origin: 'https://other.example' }, 403);
  const code = party.createRoom('show', 'episode.mp4', 'owner');
  const guest = new WebSocket(url, { headers: { Cookie: 'guest' } }); sockets.push(guest); await once(guest, 'open');
  guest.send('null'); guest.send(JSON.stringify({ type: 'join', roomCode: code, profileName: 'Spoofed admin' }));
  const joined = JSON.parse((await once(guest, 'message'))[0]); assert.equal(joined.isHost, false);
  const owner = new WebSocket(url, { headers: { Cookie: 'valid' } }); sockets.push(owner); await once(owner, 'open');
  owner.send(JSON.stringify({ type: 'join', roomCode: code }));
  const host = JSON.parse((await once(owner, 'message'))[0]); assert.equal(host.isHost, true);
});
