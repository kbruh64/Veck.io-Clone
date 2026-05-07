// Gun-Game multiplayer server for Veck.io Clone.
// - Each player advances through a weapon progression on every kill.
// - First to finish the chain wins; match resets after 8s.
// - 5-second respawn on death.
// - Hits arrive from clients ({t:'hit'}); server validates plausibility and applies damage.

import { WebSocketServer } from 'ws';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const TICK_HZ = 20;
const RESPAWN_MS = 5000;
const MATCH_DURATION_MS = 5 * 60 * 1000;
let matchStartedAt = Date.now();

const PROGRESSIONS = {
  classic:  ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'knife'],
  brawler:  ['smg', 'shotgun', 'rifle', 'knife'],
  marksman: ['pistol', 'rifle', 'sniper', 'knife'],
};
let activeProgressionName = 'classic';
let chain = PROGRESSIONS[activeProgressionName];

const SPAWN_POINTS = [
  [ 8, 1.7,  8], [-8, 1.7,  8], [ 8, 1.7, -8], [-8, 1.7, -8],
  [ 0, 1.7, 12], [ 0, 1.7,-12], [12, 1.7,  0], [-12, 1.7, 0],
];

let nextId = 1;
const players = new Map();
let matchOver = false;

function pickSpawn() { return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)]; }
function send(ws, msg) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); }
function broadcast(msg, exceptId) {
  const json = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(json);
  }
}

function snapshot() {
  const remainingMs = matchOver ? 0 : Math.max(0, MATCH_DURATION_MS - (Date.now() - matchStartedAt));
  return {
    t: 'snap', ts: Date.now(),
    chain, progression: activeProgressionName,
    remainingMs, durationMs: MATCH_DURATION_MS,
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name,
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      hp: p.hp, score: p.score, alive: p.alive,
      level: p.level, weapon: chain[Math.min(p.level, chain.length - 1)],
    })),
  };
}

function startNewMatch() {
  matchOver = false;
  matchStartedAt = Date.now();
  for (const q of players.values()) {
    q.score = 0; q.level = 0; q.hp = 100; q.alive = true;
    const [sx, sy, sz] = pickSpawn();
    q.x = sx; q.y = sy; q.z = sz;
    send(q.ws, { t: 'respawn', x: sx, y: sy, z: sz, level: 0 });
  }
  broadcast({ t: 'match_start', chain, progression: activeProgressionName, durationMs: MATCH_DURATION_MS });
}

function endMatchByTime() {
  if (matchOver || players.size === 0) return;
  matchOver = true;
  const ranked = [...players.values()]
    .map(q => ({ id: q.id, name: q.name, score: q.score, level: q.level }))
    .sort((a, b) => b.level - a.level || b.score - a.score);
  const winner = ranked[0] ? { id: ranked[0].id, name: ranked[0].name, score: ranked[0].score } : null;
  for (const q of players.values()) {
    send(q.ws, { t: 'match_over', winner, scores: ranked, resetIn: 8, reason: 'time' });
  }
  setTimeout(startNewMatch, 8000);
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[veckio] Gun-Game server on ws://0.0.0.0:${PORT}`);
console.log(`[veckio] Default progression: ${activeProgressionName} → ${chain.join(' → ')}`);

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const [sx, sy, sz] = pickSpawn();
  const player = {
    id, name: `Player${id}`, ws,
    x: sx, y: sy, z: sz, yaw: 0, pitch: 0,
    hp: 100, score: 0, alive: true, respawnAt: 0,
    level: 0,
  };
  players.set(id, player);
  console.log(`[veckio] +join id=${id} (${players.size} online) ip=${req.socket.remoteAddress}`);

  send(ws, { t: 'welcome', id, snap: snapshot(), chain, progression: activeProgressionName, respawnMs: RESPAWN_MS, durationMs: MATCH_DURATION_MS });
  broadcast({ t: 'join', player: { id, name: player.name } }, id);

  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    const p = players.get(id);
    if (!p) return;

    switch (msg.t) {
      case 'name':
        if (typeof msg.name === 'string' && msg.name.length > 0 && msg.name.length < 24) {
          p.name = msg.name.replace(/[^\w \-_.]/g, '').slice(0, 24) || p.name;
        }
        break;

      case 'progression':
        // Any client can change progression between matches (for prototyping).
        if (typeof msg.name === 'string' && PROGRESSIONS[msg.name]) {
          activeProgressionName = msg.name;
          chain = PROGRESSIONS[activeProgressionName];
          broadcast({ t: 'progression', name: activeProgressionName, chain });
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
        broadcast({ t: 'shoot', by: id, from: msg.from, to: msg.to, weapon: chain[Math.min(p.level, chain.length - 1)] }, id);
        break;

      case 'hit': {
        if (!p.alive || matchOver) break;
        const target = players.get(msg.target);
        if (!target || !target.alive || target.id === id) break;
        const dx = target.x - p.x, dy = target.y - p.y, dz = target.z - p.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist > 80) break;
        const dmg = Math.max(0, Math.min(120, msg.dmg ?? 30));
        target.hp -= dmg;
        send(target.ws, { t: 'damaged', by: id, dmg, hp: Math.max(0, target.hp) });
        if (target.hp <= 0) {
          target.alive = false; target.hp = 0;
          target.respawnAt = Date.now() + RESPAWN_MS;
          // Knife "humiliation": victim drops one level (not below 0).
          const attackerWeapon = chain[Math.min(p.level, chain.length - 1)];
          if (attackerWeapon === 'knife' && target.level > 0) target.level -= 1;
          // Advance attacker.
          p.score += 1;
          p.level += 1;
          broadcast({ t: 'killed',
            by: id, victim: target.id,
            byName: p.name, victimName: target.name,
            byLevel: p.level, victimLevel: target.level,
            weapon: attackerWeapon,
            chainLen: chain.length,
          });
          if (p.level >= chain.length) {
            matchOver = true;
            const finalScores = [...players.values()]
              .map(q => ({ id: q.id, name: q.name, score: q.score, level: q.level }))
              .sort((a, b) => b.level - a.level || b.score - a.score);
            const winner = { id: p.id, name: p.name, score: p.score };
            for (const q of players.values()) {
              send(q.ws, { t: 'match_over', winner, scores: finalScores, resetIn: 8 });
            }
            setTimeout(startNewMatch, 8000);
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

setInterval(() => {
  const now = Date.now();
  if (!matchOver && now - matchStartedAt >= MATCH_DURATION_MS) endMatchByTime();
  for (const p of players.values()) {
    if (!p.alive && now >= p.respawnAt && !matchOver) {
      const [sx, sy, sz] = pickSpawn();
      p.x = sx; p.y = sy; p.z = sz;
      p.hp = 100; p.alive = true;
      send(p.ws, { t: 'respawn', x: sx, y: sy, z: sz, level: p.level });
    }
  }
  const snap = snapshot();
  const json = JSON.stringify(snap);
  for (const p of players.values()) {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(json);
  }
}, 1000 / TICK_HZ);
