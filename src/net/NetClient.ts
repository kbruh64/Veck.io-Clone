export interface RemotePlayer {
  id: number; name: string;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  hp: number; score: number; alive: boolean;
  level: number; weapon: string;
  prevX: number; prevY: number; prevZ: number;
  prevYaw: number; prevPitch: number;
  lerpStart: number; lerpEnd: number;
}

export type NetEvent =
  | { t: 'welcome'; id: number }
  | { t: 'damaged'; by: number; dmg: number; hp: number }
  | { t: 'respawn'; x: number; y: number; z: number }
  | { t: 'killed'; by: number; victim: number; byName: string; victimName: string }
  | { t: 'shoot'; by: number; from: [number, number, number]; to: [number, number, number] }
  | { t: 'leave'; id: number };

export class NetClient {
  private ws?: WebSocket;
  selfId = 0;
  players = new Map<number, RemotePlayer>();
  events: NetEvent[] = [];
  connected = false;
  error: string | null = null;
  chain: string[] = [];
  progressionName = 'classic';
  respawnMs = 5000;
  remainingMs = 0;
  durationMs = 5 * 60 * 1000;
  private lastStateSent = 0;

  connect(url: string, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try { this.ws = new WebSocket(url); }
      catch (e: any) { reject(e); return; }

      const t = setTimeout(() => reject(new Error('Connection timed out')), 5000);

      this.ws.onopen = () => {
        clearTimeout(t);
        this.connected = true;
        this.send({ t: 'name', name });
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(t);
        this.error = 'WebSocket error';
        reject(new Error(this.error));
      };
      this.ws.onclose = () => {
        this.connected = false;
        this.error = this.error ?? 'Disconnected';
      };
      this.ws.onmessage = (e) => this.onMessage(e.data);
    });
  }

  disconnect() { this.ws?.close(); }

  private send(obj: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendState(x: number, y: number, z: number, yaw: number, pitch: number) {
    const now = performance.now();
    if (now - this.lastStateSent < 40) return; // ~25Hz cap
    this.lastStateSent = now;
    this.send({ t: 'state', x, y, z, yaw, pitch });
  }

  sendShoot(from: [number, number, number], to: [number, number, number]) {
    this.send({ t: 'shoot', from, to });
  }

  sendHit(target: number, dmg: number) {
    this.send({ t: 'hit', target, dmg });
  }

  sendProgression(name: string) {
    this.send({ t: 'progression', name });
  }

  private onMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.t) {
      case 'welcome':
        this.selfId = msg.id;
        if (Array.isArray(msg.chain)) this.chain = msg.chain;
        if (msg.progression) this.progressionName = msg.progression;
        if (msg.respawnMs) this.respawnMs = msg.respawnMs;
        if (msg.durationMs) this.durationMs = msg.durationMs;
        this.applySnap(msg.snap);
        this.events.push({ t: 'welcome', id: msg.id });
        break;
      case 'snap':
        if (Array.isArray(msg.chain)) this.chain = msg.chain;
        if (msg.progression) this.progressionName = msg.progression;
        if (typeof msg.remainingMs === 'number') this.remainingMs = msg.remainingMs;
        if (typeof msg.durationMs === 'number') this.durationMs = msg.durationMs;
        this.applySnap(msg);
        break;
      case 'progression':
        if (Array.isArray(msg.chain)) this.chain = msg.chain;
        if (msg.name) this.progressionName = msg.name;
        this.events.push(msg);
        break;
      case 'damaged':
      case 'respawn':
      case 'killed':
      case 'shoot':
      case 'leave':
        this.events.push(msg);
        break;
    }
  }

  private applySnap(snap: { players: any[] }) {
    const now = performance.now();
    const seen = new Set<number>();
    for (const sp of snap.players) {
      seen.add(sp.id);
      let rp = this.players.get(sp.id);
      if (!rp) {
        rp = {
          id: sp.id, name: sp.name,
          x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: sp.pitch,
          hp: sp.hp, score: sp.score, alive: sp.alive,
          level: sp.level ?? 0, weapon: sp.weapon ?? 'pistol',
          prevX: sp.x, prevY: sp.y, prevZ: sp.z, prevYaw: sp.yaw, prevPitch: sp.pitch,
          lerpStart: now, lerpEnd: now,
        };
        this.players.set(sp.id, rp);
      } else {
        rp.prevX = rp.x; rp.prevY = rp.y; rp.prevZ = rp.z;
        rp.prevYaw = rp.yaw; rp.prevPitch = rp.pitch;
        rp.x = sp.x; rp.y = sp.y; rp.z = sp.z;
        rp.yaw = sp.yaw; rp.pitch = sp.pitch;
        rp.hp = sp.hp; rp.score = sp.score; rp.alive = sp.alive;
        rp.level = sp.level ?? rp.level;
        rp.weapon = sp.weapon ?? rp.weapon;
        rp.name = sp.name;
        rp.lerpStart = now;
        rp.lerpEnd = now + 100;
      }
    }
    // Drop disappeared players.
    for (const id of [...this.players.keys()]) {
      if (!seen.has(id)) this.players.delete(id);
    }
  }

  /** Returns interpolated position for a remote player at current time. */
  interpolated(id: number, now: number): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
    const rp = this.players.get(id);
    if (!rp) return null;
    const span = Math.max(1, rp.lerpEnd - rp.lerpStart);
    let t = (now - rp.lerpStart) / span;
    if (t < 0) t = 0; if (t > 1.2) t = 1.2;
    const lerp = (a: number, b: number) => a + (b - a) * t;
    // Yaw shortest-arc.
    let dy = rp.yaw - rp.prevYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    return {
      x: lerp(rp.prevX, rp.x),
      y: lerp(rp.prevY, rp.y),
      z: lerp(rp.prevZ, rp.z),
      yaw: rp.prevYaw + dy * t,
      pitch: lerp(rp.prevPitch, rp.pitch),
    };
  }

  popEvents(): NetEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
