// Minimal authoritative-ish multiplayer server for Veck.io Clone.
// - Clients send their position/orientation each tick (client-authoritative movement).
// - Server owns hp, score, deaths, respawns, and broadcasts snapshots @ 20Hz.
// - Hit detection happens client-side; clients send {t:'hit', target, dmg}.
//   Server validates plausibility (target alive, attacker alive, distance sane) and applies damage.

import { WebSocketServer } from 'ws';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const TICK_HZ = 20;
const KILL_LIMIT = 25;
let matchOver = false;
let matchWinner = null;
const SPAWN_POINTS = [
  [ 8, 1.7,  8], [-8, 1.7,  8], [ 8, 1.7, -8], [-8, 1.7, -8],
  [ 0, 1.7, 12], [ 0, 1.7,-12], [12, 1.7,  0], [-12, 1.7, 0],
];

let nextId = 1;
const players = new Map(); // id -> { id, name, ws, x, y, z, yaw, pitch, hp, score, alive, respawnAt }

function pickSpawn() {
  return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId) {
  const json = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(json);
  }
}

function snapshot() {
  return {
    t: 'snap',
    ts: Date.now(),
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name,
      x: p.x, y: p.y, z: p.z,
      yaw: p.yaw, pitch: p.pitch,
      hp: p.hp, score: p.score, alive: p.alive
    })),
  };
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[veckio] WS server listening on ws://0.0.0.0:${PORT}`);
console.log(`[veckio] LAN clients: connect to ws://<your-LAN-IP>:${PORT}`);

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const [sx, sy, sz] = pickSpawn();
  const player = {
    id, name: `Player${id}`, ws,
    x: sx, y: sy, z: sz, yaw: 0, pitch: 0,
    hp: 100, score: 0, alive: true, respawnAt: 0,
  };
  players.set(id, player);
  console.log(`[veckio] +join id=${id} (${players.size} online) ip=${req.socket.remoteAddress}`);

  send(ws, { t: 'welcome', id, snap: snapshot(), killLimit: KILL_LIMIT });
  broadcast({ t: 'join', player: { id, name: player.name, x: sx, y: sy, z: sz } }, id);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const p = players.get(id);
    if (!p) return;

    switch (msg.t) {
      case 'name':
        if (typeof msg.name === 'string' && msg.name.length > 0 && msg.name.length < 24) {
          p.name = msg.name.replace(/[^\w \-_.]/g, '').slice(0, 24) || p.name;
        }
        break;

      case 'state':
        if (!p.alive) break;
        if (typeof msg.x === 'number' && typeof msg.y === 'number' && typeof msg.z === 'number') {
          p.x = msg.x; p.y = msg.y; p.z = msg.z;
          p.yaw = msg.yaw ?? p.yaw; p.pitch = msg.pitch ?? p.pitch;
        }
        break;

      case 'shoot':
        // Pure visual relay so others can see the tracer.
        broadcast({ t: 'shoot', by: id,
          from: msg.from, to: msg.to }, id);
        break;

      case 'hit': {
        if (!p.alive) break;
        const target = players.get(msg.target);
        if (!target || !target.alive || target.id === id) break;
        // Plausibility: must be reasonably close to claimed hit (anti-griefing).
        const dx = target.x - p.x, dy = target.y - p.y, dz = target.z - p.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist > 80) break;
        const dmg = Math.max(0, Math.min(50, msg.dmg ?? 30));
        target.hp -= dmg;
        send(target.ws, { t: 'damaged', by: id, dmg, hp: Math.max(0, target.hp) });
        if (target.hp <= 0) {
          target.alive = false;
          target.hp = 0;
          target.respawnAt = Date.now() + 3000;
          p.score += 1;
          broadcast({ t: 'killed', by: id, victim: target.id, byName: p.name, victimName: target.name });
          if (!matchOver && p.score >= KILL_LIMIT) {
            matchOver = true;
            matchWinner = { id: p.id, name: p.name, score: p.score };
            const finalScores = [...players.values()]
              .map(q => ({ id: q.id, name: q.name, score: q.score }))
              .sort((a, b) => b.score - a.score);
            for (const q of players.values()) {
              send(q.ws, { t: 'match_over', winner: matchWinner, scores: finalScores, resetIn: 8 });
            }
            setTimeout(() => {
              for (const q of players.values()) q.score = 0;
              matchOver = false;
              matchWinner = null;
              for (const q of players.values()) {
                const [sx, sy, sz] = pickSpawn();
                q.x = sx; q.y = sy; q.z = sz;
                q.hp = 100; q.alive = true;
                send(q.ws, { t: 'respawn', x: sx, y: sy, z: sz });
              }
              broadcast({ t: 'match_start', killLimit: KILL_LIMIT });
            }, 8000);
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ t: 'leave', id });
    console.log(`[veckio] -leave id=${id} (${players.size} online)`);
  });

  ws.on('error', () => {});
});

// Tick: handle respawns + broadcast snapshot.
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (!p.alive && now >= p.respawnAt) {
      const [sx, sy, sz] = pickSpawn();
      p.x = sx; p.y = sy; p.z = sz;
      p.hp = 100; p.alive = true;
      send(p.ws, { t: 'respawn', x: sx, y: sy, z: sz });
    }
  }
  const snap = snapshot();
  const json = JSON.stringify(snap);
  for (const p of players.values()) {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(json);
  }
}, 1000 / TICK_HZ);
