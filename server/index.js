// Multi-mode multiplayer server: gungame, deathmatch (FFA, first to 20), tdm (5v5 teams to 20).
// Match flow: WARMUP (30s, players pick loadout) → LIVE (5 min or kill cap) → OVER (8s) → next.

import { WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import selfsigned from 'selfsigned';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const TLS_PORT = process.env.TLS_PORT ? Number(process.env.TLS_PORT) : 8443;
const TICK_HZ = 20;
const RESPAWN_MS = 5000;
const MATCH_DURATION_MS = 5 * 60 * 1000;
const WARMUP_MS = 30 * 1000;
const KILL_LIMIT = 20;

const VALID_WEAPONS = new Set([
  'pistol','magnum','smg','rifle','ar','shotgun','sniper','knife','bat','grenade'
]);
const PROGRESSIONS = {
  classic:  ['pistol','smg','rifle','ar','shotgun','magnum','sniper','bat','knife'],
  brawler:  ['smg','shotgun','ar','bat','knife'],
  marksman: ['pistol','rifle','sniper','magnum','knife'],
};

let activeProgressionName = 'classic';
let chain = PROGRESSIONS[activeProgressionName];
let mode = 'gungame'; // 'gungame' | 'dm' | 'tdm'
let phase = 'warmup'; // 'warmup' | 'live' | 'over'
let phaseStartedAt = Date.now();
let phaseEndsAt = phaseStartedAt + WARMUP_MS;
let teamScore = [0, 0];
let matchOver = false;

const SPAWN_POINTS = [
  [ 8, 1.7,  8], [-8, 1.7,  8], [ 8, 1.7, -8], [-8, 1.7, -8],
  [ 0, 1.7, 12], [ 0, 1.7,-12], [12, 1.7,  0], [-12, 1.7, 0],
];

let nextId = 1;
const players = new Map();

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
  'Finn','Logan','Ember','Wren','Nico','Theo','Eli','Remy',
];
function pickBotName() {
  const taken = new Set([...players.values()].map(p => p.name));
  const shuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  for (const n of shuffled) if (!taken.has(n)) return n;
  for (let i = 2; i < 99; i++) if (!taken.has(`${shuffled[0]}${i}`)) return `${shuffled[0]}${i}`;
  return shuffled[0];
}
function assignTeam() {
  if (mode !== 'tdm') return -1;
  let t0 = 0, t1 = 0;
  for (const p of players.values()) { if (p.team === 0) t0++; else if (p.team === 1) t1++; }
  return t0 <= t1 ? 0 : 1;
}
function defaultLoadout() {
  return { main: 'smg', backup: 'pistol', melee: 'knife', accessory: 'grenade' };
}
function randomLoadout() {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  return {
    main: pick(['smg','rifle','ar','shotgun','sniper']),
    backup: pick(['pistol','magnum']),
    melee: pick(['knife','bat']),
    accessory: 'grenade',
  };
}

function addBot() {
  const id = nextId++;
  const [sx, sy, sz] = pickSpawn();
  const bot = {
    id, name: pickBotName(), ws: null, isBot: true,
    x: sx, y: sy, z: sz, yaw: Math.random() * Math.PI * 2, pitch: 0,
    hp: 100, score: 0, alive: true, respawnAt: 0, level: 0,
    team: assignTeam(), loadout: randomLoadout(),
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
  target = Math.max(0, Math.min(9, target | 0));
  while (botCount() < target) addBot();
  while (botCount() > target) removeBot();
}

function botCurrentWeapon(b) {
  if (mode === 'gungame') return chain[Math.min(b.level, chain.length - 1)];
  // DM/TDM: bots cycle their loadout based on time alive (so they use varied gear).
  const t = (Date.now() - phaseStartedAt) / 1000;
  const cycle = [b.loadout.main, b.loadout.backup, b.loadout.melee];
  return cycle[Math.floor(t / 6 + b.id) % cycle.length];
}

function snapshot() {
  const remainingMs = phase === 'live'
    ? Math.max(0, MATCH_DURATION_MS - (Date.now() - phaseStartedAt))
    : phase === 'warmup'
      ? Math.max(0, phaseEndsAt - Date.now())
      : 0;
  return {
    t: 'snap', ts: Date.now(),
    mode, phase, remainingMs, durationMs: MATCH_DURATION_MS,
    chain, progression: activeProgressionName,
    killLimit: KILL_LIMIT,
    teamScore: mode === 'tdm' ? teamScore : null,
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name,
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      hp: p.hp, score: p.score, alive: p.alive,
      level: p.level, team: p.team,
      weapon: mode === 'gungame'
        ? chain[Math.min(p.level, chain.length - 1)]
        : (p.isBot ? botCurrentWeapon(p) : (p.loadout?.main ?? 'smg')),
    })),
  };
}

function startWarmup() {
  phase = 'warmup';
  phaseStartedAt = Date.now();
  phaseEndsAt = phaseStartedAt + WARMUP_MS;
  matchOver = false;
  teamScore = [0, 0];
  // Reset everyone.
  for (const q of players.values()) {
    q.score = 0; q.level = 0; q.hp = 100; q.alive = true;
    if (mode === 'tdm') q.team = assignTeam();
    else q.team = -1;
    const [sx, sy, sz] = pickSpawn();
    q.x = sx; q.y = sy; q.z = sz;
    if (q.ws) send(q.ws, { t: 'phase', phase, endsAt: phaseEndsAt, mode, killLimit: KILL_LIMIT });
  }
  broadcast({ t: 'phase', phase, endsAt: phaseEndsAt, mode, killLimit: KILL_LIMIT });
  console.log(`[veckio] warmup begin (mode=${mode}, ${players.size} players, ${botCount()} bots)`);
}
function startLive() {
  phase = 'live';
  phaseStartedAt = Date.now();
  matchOver = false;
  for (const q of players.values()) {
    q.hp = 100; q.alive = true; q.level = 0; q.score = 0;
    const [sx, sy, sz] = pickSpawn();
    q.x = sx; q.y = sy; q.z = sz;
    if (q.ws) send(q.ws, { t: 'respawn', x: sx, y: sy, z: sz, level: 0 });
  }
  teamScore = [0, 0];
  broadcast({ t: 'phase', phase, mode, durationMs: MATCH_DURATION_MS, killLimit: KILL_LIMIT });
  console.log(`[veckio] match LIVE (mode=${mode})`);
}

function endMatch(winnerInfo, reason) {
  if (matchOver) return;
  matchOver = true;
  phase = 'over';
  const ranked = [...players.values()]
    .map(q => ({ id: q.id, name: q.name, score: q.score, level: q.level, team: q.team }))
    .sort((a, b) => (b.level - a.level) || (b.score - a.score));
  const payload = { t: 'match_over', winner: winnerInfo, scores: ranked, resetIn: 8, reason, teamScore };
  for (const q of players.values()) send(q.ws, payload);
  setTimeout(() => { startWarmup(); }, 8000);
}

function applyKill(attacker, victim, weapon) {
  if (!victim.alive) return;
  victim.alive = false; victim.hp = 0;
  victim.respawnAt = Date.now() + RESPAWN_MS;
  if (weapon === 'knife' && victim.level > 0) victim.level -= 1;
  // No friendly fire counted.
  if (mode === 'tdm' && attacker.team === victim.team) {
    broadcast({ t: 'killed', by: attacker.id, victim: victim.id,
      byName: attacker.name, victimName: victim.name, weapon, friendly: true });
    return;
  }
  attacker.score += 1;
  attacker.level += 1;
  if (mode === 'tdm' && attacker.team >= 0) teamScore[attacker.team] += 1;
  broadcast({ t: 'killed',
    by: attacker.id, victim: victim.id,
    byName: attacker.name, victimName: victim.name,
    byLevel: attacker.level, victimLevel: victim.level,
    byTeam: attacker.team, victimTeam: victim.team,
    weapon, chainLen: chain.length, teamScore,
  });

  if (mode === 'gungame' && attacker.level >= chain.length) {
    endMatch({ id: attacker.id, name: attacker.name, score: attacker.score }, 'chain');
  } else if (mode === 'dm' && attacker.score >= KILL_LIMIT) {
    endMatch({ id: attacker.id, name: attacker.name, score: attacker.score }, 'killcap');
  } else if (mode === 'tdm' && Math.max(...teamScore) >= KILL_LIMIT) {
    const wt = teamScore[0] >= teamScore[1] ? 0 : 1;
    endMatch({ team: wt, score: teamScore[wt], name: wt === 0 ? 'Blue Team' : 'Red Team' }, 'killcap');
  }
}

const BOT_WEAPON_DPS = {
  pistol:  { dmg: 25, cd: 0.32, range: 50, prefer: 14 },
  magnum:  { dmg: 55, cd: 0.55, range: 60, prefer: 16 },
  smg:     { dmg: 14, cd: 0.12, range: 35, prefer: 10 },
  rifle:   { dmg: 22, cd: 0.20, range: 60, prefer: 16 },
  ar:      { dmg: 18, cd: 0.15, range: 55, prefer: 14 },
  shotgun: { dmg: 50, cd: 0.90, range: 14, prefer: 6  },
  sniper:  { dmg: 70, cd: 1.50, range: 90, prefer: 28 },
  knife:   { dmg: 100,cd: 0.70, range: 2.5,prefer: 1.5},
  bat:     { dmg: 70, cd: 0.55, range: 3.0,prefer: 1.8},
  grenade: { dmg: 80, cd: 4.0,  range: 25, prefer: 12 },
};

function tickBot(b, dt) {
  if (phase !== 'live' || matchOver) return;
  if (!b.alive) return;
  let target = null, bestD = Infinity;
  for (const p of players.values()) {
    if (p.id === b.id || !p.alive) continue;
    if (mode === 'tdm' && p.team === b.team) continue;
    const dx = p.x - b.x, dz = p.z - b.z;
    const d = Math.sqrt(dx*dx + dz*dz);
    if (d < bestD) { bestD = d; target = p; }
  }
  if (!target) return;

  const dx = target.x - b.x, dz = target.z - b.z;
  const dist = Math.max(0.001, Math.sqrt(dx*dx + dz*dz));

  b.reactionIn = Math.max(0, b.reactionIn - dt);
  const desiredYaw = Math.atan2(dx, dz);
  let dyaw = desiredYaw - b.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  b.yaw += Math.max(-6 * dt, Math.min(6 * dt, dyaw));
  b.pitch = -Math.atan2((target.y - 0.2) - b.y, dist);

  const weapon = botCurrentWeapon(b);
  const w = BOT_WEAPON_DPS[weapon] ?? BOT_WEAPON_DPS.pistol;

  const speed = 4.8;
  if (weapon !== 'knife' && weapon !== 'bat' && dist < w.prefer * 0.6) {
    b.x -= (dx / dist) * speed * dt;
    b.z -= (dz / dist) * speed * dt;
  } else if (dist > w.prefer) {
    b.x += (dx / dist) * speed * dt;
    b.z += (dz / dist) * speed * dt;
  }
  b.rethinkIn -= dt;
  if (b.rethinkIn <= 0) {
    b.rethinkIn = 0.8 + Math.random() * 1.4;
    const sd = (Math.random() < 0.5 ? 1 : -1) * (1.5 + Math.random() * 1.5);
    b.wanderX = -(dz / dist) * sd;
    b.wanderZ =  (dx / dist) * sd;
  }
  b.x += b.wanderX * dt; b.z += b.wanderZ * dt;

  b.jumpCd -= dt;
  if (b.jumpVel === 0 && b.jumpCd <= 0 && Math.random() < 0.5 * dt) {
    b.jumpVel = 7; b.jumpCd = 2 + Math.random() * 3;
  }
  if (b.jumpVel !== 0) {
    b.y += b.jumpVel * dt;
    b.jumpVel -= 22 * dt;
    if (b.y <= 1.7) { b.y = 1.7; b.jumpVel = 0; }
  }
  const HALF = 30;
  if (b.x < -HALF + 1) b.x = -HALF + 1;
  if (b.x >  HALF - 1) b.x =  HALF - 1;
  if (b.z < -HALF + 1) b.z = -HALF + 1;
  if (b.z >  HALF - 1) b.z =  HALF - 1;

  b.aimDriftIn -= dt;
  if (b.aimDriftIn <= 0) {
    b.aimDriftIn = 0.4 + Math.random() * 0.7;
    const errMag = weapon === 'sniper' ? 0.4 : (weapon === 'knife' || weapon === 'bat') ? 0 : 0.9;
    b.aimErrX = (Math.random() - 0.5) * errMag;
    b.aimErrZ = (Math.random() - 0.5) * errMag;
  }

  b.fireCooldown -= dt;
  if (b.fireCooldown <= 0 && dist < w.range && dist > 0.4 && Math.abs(dyaw) < 0.35) {
    const aimX = target.x + b.aimErrX;
    const aimY = target.y - 0.1;
    const aimZ = target.z + b.aimErrZ;
    const missChance = (weapon === 'knife' || weapon === 'bat') ? 0
      : weapon === 'sniper' ? Math.min(0.35, dist / 200)
      : Math.min(0.45, 0.1 + dist / 80);
    const hit = Math.random() > missChance;
    broadcast({ t: 'shoot', by: b.id, from: [b.x, b.y, b.z], to: [aimX, aimY, aimZ], weapon });
    if (hit) {
      target.hp -= w.dmg;
      send(target.ws, { t: 'damaged', by: b.id, dmg: w.dmg, hp: Math.max(0, target.hp) });
      if (target.hp <= 0) applyKill(b, target, weapon);
    }
    b.fireCooldown = w.cd * (0.85 + Math.random() * 0.5);
    if (Math.random() < 0.15) b.fireCooldown += 0.4 + Math.random() * 0.6;
  }
}

const httpServer = createHttpServer((_req, res) => res.end('veckio'));
httpServer.listen(PORT, '0.0.0.0');
const wss = new WebSocketServer({ server: httpServer });
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

console.log(`[veckio] server: ws://0.0.0.0:${PORT} + wss://0.0.0.0:${TLS_PORT}`);
console.log(`[veckio] mode=${mode}  progression=${activeProgressionName}`);

setBotCount(3);
console.log(`[veckio] pre-spawned ${botCount()} bots`);
startWarmup();

function onConnection(ws, req) {
  const id = nextId++;
  const [sx, sy, sz] = pickSpawn();
  const player = {
    id, name: `Player${id}`, ws, isBot: false,
    x: sx, y: sy, z: sz, yaw: 0, pitch: 0,
    hp: 100, score: 0, alive: true, respawnAt: 0,
    level: 0, team: assignTeam(), loadout: defaultLoadout(),
  };
  players.set(id, player);
  console.log(`[veckio] +join id=${id} (${players.size} online) ip=${req.socket.remoteAddress}`);
  send(ws, {
    t: 'welcome', id, snap: snapshot(),
    chain, progression: activeProgressionName, mode,
    respawnMs: RESPAWN_MS, durationMs: MATCH_DURATION_MS,
    warmupMs: WARMUP_MS, killLimit: KILL_LIMIT,
    phase, phaseEndsAt,
  });
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
      case 'mode':
        if (msg.name === 'gungame' || msg.name === 'dm' || msg.name === 'tdm') {
          mode = msg.name;
          broadcast({ t: 'modeChanged', mode });
          startWarmup(); // restart with new mode
        }
        break;
      case 'setBots':
        setBotCount(msg.count ?? 0);
        broadcast({ t: 'botCount', count: botCount() });
        break;
      case 'loadout':
        if (msg.loadout && typeof msg.loadout === 'object') {
          const lo = msg.loadout;
          const safe = (id, fb) => VALID_WEAPONS.has(id) ? id : fb;
          p.loadout = {
            main: safe(lo.main, 'smg'),
            backup: safe(lo.backup, 'pistol'),
            melee: safe(lo.melee, 'knife'),
            accessory: safe(lo.accessory, 'grenade'),
          };
        }
        break;
      case 'state':
        if (!p.alive || phase !== 'live') break;
        if (typeof msg.x === 'number') {
          p.x = msg.x; p.y = msg.y; p.z = msg.z;
          p.yaw = msg.yaw ?? p.yaw; p.pitch = msg.pitch ?? p.pitch;
        }
        break;
      case 'shoot':
        broadcast({ t: 'shoot', by: id, from: msg.from, to: msg.to, weapon: msg.weapon }, id);
        break;
      case 'hit': {
        if (!p.alive || matchOver || phase !== 'live') break;
        const target = players.get(msg.target);
        if (!target || !target.alive || target.id === id) break;
        if (mode === 'tdm' && target.team === p.team) break; // no friendly fire
        const dx = target.x - p.x, dy = target.y - p.y, dz = target.z - p.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist > 80) break;
        const dmg = Math.max(0, Math.min(150, msg.dmg ?? 30));
        target.hp -= dmg;
        send(target.ws, { t: 'damaged', by: id, dmg, hp: Math.max(0, target.hp) });
        if (target.hp <= 0) applyKill(p, target, msg.weapon || 'smg');
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
  const dt = (now - lastTick) / 1000; lastTick = now;
  if (phase === 'warmup' && now >= phaseEndsAt) startLive();
  if (phase === 'live' && !matchOver && now - phaseStartedAt >= MATCH_DURATION_MS) {
    if (mode === 'tdm') {
      const wt = teamScore[0] >= teamScore[1] ? 0 : 1;
      endMatch({ team: wt, score: teamScore[wt], name: wt === 0 ? 'Blue Team' : 'Red Team' }, 'time');
    } else {
      const ranked = [...players.values()].sort((a, b) => b.score - a.score);
      const w = ranked[0];
      endMatch(w ? { id: w.id, name: w.name, score: w.score } : null, 'time');
    }
  }
  if (phase === 'live') for (const b of players.values()) if (b.isBot) tickBot(b, dt);
  for (const p of players.values()) {
    if (!p.alive && now >= p.respawnAt && !matchOver) {
      const [sx, sy, sz] = pickSpawn();
      p.x = sx; p.y = sy; p.z = sz; p.hp = 100; p.alive = true;
      if (p.ws) send(p.ws, { t: 'respawn', x: sx, y: sy, z: sz, level: p.level });
    }
  }
  const json = JSON.stringify(snapshot());
  for (const p of players.values()) {
    if (p.ws && p.ws.readyState === p.ws.OPEN) p.ws.send(json);
  }
}, 1000 / TICK_HZ);
