// Gun-Game multiplayer server for Veck.io Clone.
// - Each player advances through a weapon progression on every kill.
// - First to finish the chain wins; match resets after 8s.
// - 5-second respawn on death.
// - Hits arrive from clients ({t:'hit'}); server validates plausibility and applies damage.

import { WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import selfsigned from 'selfsigned';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const TLS_PORT = process.env.TLS_PORT ? Number(process.env.TLS_PORT) : 8443;
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
function send(ws, msg) { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); }
function broadcast(msg, exceptId) {
  const json = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id === exceptId || !p.ws) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(json);
  }
}

const BOT_NAMES = [
  'Alex','Sam','Jordan','Casey','Riley','Morgan','Quinn','Kai',
  'Ash','Jules','Reed','Sage','Skyler','Drew','Avery','Rowan',
  'Finn','Logan','Ember','Wren','Nico','Theo','Eli','Remy'
];
function pickBotName() {
  const taken = new Set([...players.values()].map(p => p.name));
  const shuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  for (const n of shuffled) if (!taken.has(n)) return n;
  // All taken — append a small number.
  const base = shuffled[0];
  for (let i = 2; i < 99; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  return base;
}
function addBot() {
  const id = nextId++;
  const [sx, sy, sz] = pickSpawn();
  const bot = {
    id, name: pickBotName(), ws: null, isBot: true,
    x: sx, y: sy, z: sz, yaw: Math.random() * Math.PI * 2, pitch: 0,
    hp: 100, score: 0, alive: true, respawnAt: 0, level: 0,
    fireCooldown: 0.5 + Math.random() * 1.0,
    rethinkIn: 0, wanderX: 0, wanderZ: 0,
    aimErrX: 0, aimErrZ: 0, aimDriftIn: 0,
    reactionIn: 0, jumpVel: 0, jumpCd: 0,
  };
  players.set(id, bot);
  broadcast({ t: 'join', player: { id, name: bot.name } });
}
function removeBot() {
  for (const p of [...players.values()].reverse()) {
    if (p.isBot) { players.delete(p.id); broadcast({ t: 'leave', id: p.id }); return; }
  }
}
function botCount() { return [...players.values()].filter(p => p.isBot).length; }
function setBotCount(target) {
  target = Math.max(0, Math.min(7, target | 0));
  while (botCount() < target) addBot();
  while (botCount() > target) removeBot();
}

function applyKill(attacker, victim, weapon) {
  if (!victim.alive) return;
  victim.alive = false; victim.hp = 0;
  victim.respawnAt = Date.now() + RESPAWN_MS;
  if (weapon === 'knife' && victim.level > 0) victim.level -= 1;
  attacker.score += 1;
  attacker.level += 1;
  broadcast({ t: 'killed',
    by: attacker.id, victim: victim.id,
    byName: attacker.name, victimName: victim.name,
    byLevel: attacker.level, victimLevel: victim.level,
    weapon, chainLen: chain.length,
  });
  if (attacker.level >= chain.length && !matchOver) {
    matchOver = true;
    const ranked = [...players.values()]
      .map(q => ({ id: q.id, name: q.name, score: q.score, level: q.level }))
      .sort((a, b) => b.level - a.level || b.score - a.score);
    const winner = { id: attacker.id, name: attacker.name, score: attacker.score };
    for (const q of players.values()) {
      send(q.ws, { t: 'match_over', winner, scores: ranked, resetIn: 8 });
    }
    setTimeout(startNewMatch, 8000);
  }
}

const BOT_WEAPON_DPS = {
  pistol:  { dmg: 25, cd: 0.32, range: 50, prefer: 14 },
  smg:     { dmg: 14, cd: 0.12, range: 35, prefer: 10 },
  rifle:   { dmg: 22, cd: 0.20, range: 60, prefer: 16 },
  shotgun: { dmg: 50, cd: 0.90, range: 14, prefer: 6  },
  sniper:  { dmg: 70, cd: 1.50, range: 90, prefer: 28 },
  knife:   { dmg: 100,cd: 0.70, range: 2.5,prefer: 1.5},
};

function tickBot(b, dt) {
  if (matchOver) return;
  if (!b.alive) return;
  let target = null, bestD = Infinity;
  for (const p of players.values()) {
    if (p.id === b.id || !p.alive) continue;
    const dx = p.x - b.x, dz = p.z - b.z;
    const d = Math.sqrt(dx*dx + dz*dz);
    if (d < bestD) { bestD = d; target = p; }
  }
  if (!target) return;

  const dx = target.x - b.x, dz = target.z - b.z;
  const dist = Math.max(0.001, Math.sqrt(dx*dx + dz*dz));

  // Reaction delay so they don't snap-turn instantly.
  b.reactionIn -= dt;
  if (b.reactionIn <= 0) b.reactionIn = 0;
  // Smoothly turn toward target (human-like turn rate).
  const desiredYaw = Math.atan2(dx, dz);
  let dyaw = desiredYaw - b.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const turnRate = 6.0; // rad/s
  b.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, dyaw));
  // Pitch toward target's torso.
  const dy = (target.y - 0.2) - b.y;
  b.pitch = -Math.atan2(dy, dist);

  const weapon = chain[Math.min(b.level, chain.length - 1)];
  const w = BOT_WEAPON_DPS[weapon] ?? BOT_WEAPON_DPS.pistol;

  // Movement: maintain preferred range, with strafe.
  const speed = 4.8;
  if (weapon !== 'knife' && dist < w.prefer * 0.6) {
    b.x -= (dx / dist) * speed * dt;
    b.z -= (dz / dist) * speed * dt;
  } else if (dist > w.prefer) {
    b.x += (dx / dist) * speed * dt;
    b.z += (dz / dist) * speed * dt;
  }
  b.rethinkIn -= dt;
  if (b.rethinkIn <= 0) {
    b.rethinkIn = 0.8 + Math.random() * 1.4;
    // Strafe perpendicular to target direction so it looks human.
    const sd = (Math.random() < 0.5 ? 1 : -1) * (1.5 + Math.random() * 1.5);
    b.wanderX = -(dz / dist) * sd;
    b.wanderZ =  (dx / dist) * sd;
  }
  b.x += b.wanderX * dt; b.z += b.wanderZ * dt;

  // Occasional jumps so they don't read as glued to the floor.
  b.jumpCd -= dt;
  if (b.jumpVel === 0 && b.jumpCd <= 0 && Math.random() < 0.6 * dt) {
    b.jumpVel = 7;
    b.jumpCd = 2 + Math.random() * 3;
  }
  if (b.jumpVel !== 0) {
    b.y += b.jumpVel * dt;
    b.jumpVel -= 22 * dt;
    if (b.y <= 1.7) { b.y = 1.7; b.jumpVel = 0; }
  }

  // Arena clamp.
  const HALF = 30;
  if (b.x < -HALF + 1) b.x = -HALF + 1;
  if (b.x >  HALF - 1) b.x =  HALF - 1;
  if (b.z < -HALF + 1) b.z = -HALF + 1;
  if (b.z >  HALF - 1) b.z =  HALF - 1;

  // Slowly drifting aim error (mimics imperfect human tracking).
  b.aimDriftIn -= dt;
  if (b.aimDriftIn <= 0) {
    b.aimDriftIn = 0.4 + Math.random() * 0.7;
    const errMag = weapon === 'sniper' ? 0.4 : weapon === 'knife' ? 0 : 0.9;
    b.aimErrX = (Math.random() - 0.5) * errMag;
    b.aimErrZ = (Math.random() - 0.5) * errMag;
  }

  b.fireCooldown -= dt;
  // Don't shoot during reaction delay or facing far-off direction.
  const facingErr = Math.abs(dyaw);
  if (b.fireCooldown <= 0 && dist < w.range && dist > 0.4 && facingErr < 0.35) {
    const aimX = target.x + b.aimErrX;
    const aimY = target.y - 0.1;
    const aimZ = target.z + b.aimErrZ;
    // Bot misses sometimes proportional to error magnitude vs distance.
    const missChance = weapon === 'knife' ? 0
      : weapon === 'sniper' ? Math.min(0.35, dist / 200)
      : Math.min(0.45, 0.1 + dist / 80);
    const hit = Math.random() > missChance;
    broadcast({ t: 'shoot', by: b.id,
      from: [b.x, b.y, b.z], to: [aimX, aimY, aimZ], weapon });
    if (hit) {
      target.hp -= w.dmg;
      send(target.ws, { t: 'damaged', by: b.id, dmg: w.dmg, hp: Math.max(0, target.hp) });
      if (target.hp <= 0) applyKill(b, target, weapon);
    }
    b.fireCooldown = w.cd * (0.85 + Math.random() * 0.5);
    // Brief reaction pause after burst (reload-ish feel).
    if (Math.random() < 0.15) b.fireCooldown += 0.4 + Math.random() * 0.6;
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

// Plain ws on PORT (LAN, http pages).
const httpServer = createHttpServer((_req, res) => res.end('veckio'));
httpServer.listen(PORT, '0.0.0.0');
const wss = new WebSocketServer({ server: httpServer });

// Secure wss on TLS_PORT using a self-signed cert (for https mobile pages).
const pems = selfsigned.generate(
  [{ name: 'commonName', value: 'veckio.local' }],
  {
    days: 365, keySize: 2048, algorithm: 'sha256',
    extensions: [{
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 2, value: 'veckio.local' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: '192.168.2.209' },
      ],
    }],
  }
);
const httpsServer = createHttpsServer({ key: pems.private, cert: pems.cert }, (_req, res) => res.end('veckio'));
httpsServer.listen(TLS_PORT, '0.0.0.0');
const wssSecure = new WebSocketServer({ server: httpsServer });

console.log(`[veckio] Gun-Game server: ws://0.0.0.0:${PORT}  +  wss://0.0.0.0:${TLS_PORT}`);
console.log(`[veckio] Default progression: ${activeProgressionName} → ${chain.join(' → ')}`);

// Spawn 3 bots on startup so any new client immediately has something to fight.
setBotCount(3);
console.log(`[veckio] Pre-spawned ${botCount()} bots`);

function onConnection(ws, req) {
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
        if (typeof msg.name === 'string' && PROGRESSIONS[msg.name]) {
          activeProgressionName = msg.name;
          chain = PROGRESSIONS[activeProgressionName];
          broadcast({ t: 'progression', name: activeProgressionName, chain });
        }
        break;

      case 'setBots':
        console.log(`[veckio] setBots from id=${id}: count=${msg.count}`);
        setBotCount(msg.count ?? 0);
        broadcast({ t: 'botCount', count: botCount() });
        console.log(`[veckio] bot count now=${botCount()} total players=${players.size}`);
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
        if (target.hp <= 0) applyKill(p, target, chain[Math.min(p.level, chain.length - 1)]);
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
}
wss.on('connection', onConnection);
wssSecure.on('connection', onConnection);

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  if (!matchOver && now - matchStartedAt >= MATCH_DURATION_MS) endMatchByTime();
  for (const b of players.values()) if (b.isBot) tickBot(b, dt);
  for (const p of players.values()) {
    if (!p.alive && now >= p.respawnAt && !matchOver) {
      const [sx, sy, sz] = pickSpawn();
      p.x = sx; p.y = sy; p.z = sz;
      p.hp = 100; p.alive = true;
      if (p.ws) send(p.ws, { t: 'respawn', x: sx, y: sy, z: sz, level: p.level });
    }
  }
  const snap = snapshot();
  const json = JSON.stringify(snap);
  for (const p of players.values()) {
    if (p.ws && p.ws.readyState === p.ws.OPEN) p.ws.send(json);
  }
}, 1000 / TICK_HZ);
