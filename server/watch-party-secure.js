const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('node:crypto');
const rooms = new Map();
const MAX_ROOMS = 100;
function createRoom(showId, relPath, ownerId) {
  if (!ownerId) throw new Error('A signed-in owner is required');
  if (rooms.size >= MAX_ROOMS) throw Object.assign(new Error('Too many active watch parties'), { status: 429 });
  if ([...rooms.values()].filter(room => room.ownerId === ownerId).length >= 5) throw Object.assign(new Error('Too many watch parties for this account'), { status: 429 });
  let code;
  do { code = Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join(''); } while (rooms.has(code));
  rooms.set(code, { ownerId, showId, relPath, host: null, members: new Map(), expires: Date.now() + 30 * 60 * 1000, emptyTimer: null });
  return code;
}
function getRoomInfo(code) { const room = rooms.get(code); return room ? { showId: room.showId, relPath: room.relPath, participantCount: room.members.size } : null; }
function attach(server, { authenticate } = {}) {
  if (typeof authenticate !== 'function') throw new Error('Watch parties require session authentication');
  const wss = new WebSocketServer({ server, path: '/api/watch-party/ws', maxPayload: 16384,
    verifyClient(info, done) {
      try {
        if (info.origin && new URL(info.origin).host !== info.req.headers.host) return done(false, 403, 'Origin denied');
        const account = authenticate(info.req);
        if (!account) return done(false, 401, 'Sign in first');
        if (wss.clients.size >= 128 || [...wss.clients].filter(client => client.accountId === account.id).length >= 8) return done(false, 429, 'Too many connections');
        info.req.ioAccount = account; done(true);
      } catch { done(false, 401, 'Invalid session'); }
    } });
  const broadcast = room => {
    const data = JSON.stringify({ type: 'roster', participants: [...room.members.values()].map(member => member.name), hostConnId: room.host });
    for (const { ws } of room.members.values()) if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };
  wss.on('connection', (ws, req) => {
    ws.accountId = req.ioAccount.id;
    const id = crypto.randomUUID(); let joined = null, count = 0, windowStart = Date.now();
    ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); ws.on('error', () => {});
    ws.on('message', raw => {
      try {
        const account = authenticate(req);
        if (!account) { ws.close(1008, 'Session expired'); return; }
        if (Date.now() - windowStart > 5000) { count = 0; windowStart = Date.now(); }
        if (++count > 60) { ws.close(1008, 'Too many messages'); return; }
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
        if (msg.type === 'join') {
          if (joined) return;
          const code = typeof msg.roomCode === 'string' ? msg.roomCode.toUpperCase() : '';
          const room = rooms.get(code);
          if (!room || room.members.size >= 16) { ws.send(JSON.stringify({ type: 'error', message: 'Party unavailable or full' })); return; }
          joined = code; clearTimeout(room.emptyTimer);
          if (account.id === room.ownerId && !room.host) room.host = id;
          room.members.set(id, { ws, name: account.username.slice(0, 40) });
          ws.send(JSON.stringify({ type: 'joined', isHost: room.host === id, showId: room.showId, relPath: room.relPath })); broadcast(room);
        } else if (msg.type === 'sync') {
          const room = rooms.get(joined);
          if (!room || room.host !== id || !['play', 'pause', 'seek'].includes(msg.action) || !Number.isFinite(msg.time) || msg.time < 0) return;
          const data = JSON.stringify({ type: 'sync', action: msg.action, time: msg.time });
          for (const [other, { ws: target }] of room.members) if (other !== id && target.readyState === WebSocket.OPEN) target.send(data);
        }
      } catch { /* malformed messages cannot escape the event handler */ }
    });
    ws.on('close', () => {
      const room = rooms.get(joined); if (!room) return; room.members.delete(id);
      if (!room.members.size) { room.host = null; room.emptyTimer = setTimeout(() => rooms.delete(joined), 60000); room.emptyTimer.unref(); }
      else { if (room.host === id) room.host = room.members.keys().next().value; broadcast(room); }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.isAlive) ws.terminate(); else { ws.isAlive = false; ws.ping(); } }
    for (const [code, room] of rooms) if (!room.members.size && Date.now() > room.expires) rooms.delete(code);
  }, 30000); heartbeat.unref(); wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
module.exports = { attach, createRoom, getRoomInfo };
