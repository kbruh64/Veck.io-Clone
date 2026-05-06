// World/match state for the FPS prototype — separate from rendering.
import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER, WeaponId, WeaponState, makeWeaponState } from './Weapons';

export interface Enemy {
  id: number;
  position: THREE.Vector3;
  hp: number;
  alive: boolean;
  velocity: THREE.Vector3;
  retargetIn: number;
}

export interface Player {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  onGround: boolean;
  jumpsRemaining: number;
  sliding: number;       // seconds remaining in slide
  slideCooldown: number; // seconds until next slide
  weapons: Record<WeaponId, WeaponState>;
  current: WeaponId;
  switchCooldown: number;
}

export const ARENA_HALF = 32;
export const PLAYER_HEIGHT = 1.7;
export const PLAYER_RADIUS = 0.4;
export const ENEMY_RADIUS = 0.55;
export const ENEMY_HEIGHT = 1.7;
export const SLIDE_HEIGHT = 1.0;

export interface ShotResult {
  origin: THREE.Vector3;
  rays: { dir: THREE.Vector3; end: THREE.Vector3; enemyId?: number; killed?: boolean }[];
}

export class BoardState {
  player: Player;
  enemies: Enemy[] = [];
  obstacles: { min: THREE.Vector3; max: THREE.Vector3 }[] = [];
  score = 0;
  killstreak = 0;
  bestStreak = 0;
  private nextId = 1;
  private spawnTimer = 0;
  maxEnemies = 6;

  constructor() {
    this.player = this.makePlayer();
    this.buildArena();
  }

  reset() {
    this.player = this.makePlayer();
    this.enemies = [];
    this.score = 0;
    this.killstreak = 0;
    this.bestStreak = 0;
    this.spawnTimer = 0;
    this.nextId = 1;
    // Obstacles are static, leave as-is.
  }

  private makePlayer(): Player {
    return {
      position: new THREE.Vector3(0, PLAYER_HEIGHT, 12),
      velocity: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      hp: 100, onGround: true,
      jumpsRemaining: 2,
      sliding: 0, slideCooldown: 0,
      weapons: {
        pistol: makeWeaponState('pistol'),
        smg: makeWeaponState('smg'),
        shotgun: makeWeaponState('shotgun'),
        sniper: makeWeaponState('sniper'),
      },
      current: 'smg',
      switchCooldown: 0,
    };
  }

  private buildArena() {
    const O = (x: number, z: number, w: number, h: number, d: number) => {
      this.obstacles.push({
        min: new THREE.Vector3(x - w / 2, 0, z - d / 2),
        max: new THREE.Vector3(x + w / 2, h, z + d / 2),
      });
    };
    // Central raised platform.
    O(0, 0, 8, 1.2, 8);
    // Ramps to platform (low boxes stair-stepped).
    O( 0,  6, 4, 0.4, 1);
    O( 0,  7, 4, 0.8, 1);
    O( 0, -6, 4, 0.4, 1);
    O( 0, -7, 4, 0.8, 1);
    // Pillars near center.
    O( 5,  5, 1.2, 3, 1.2);
    O(-5, -5, 1.2, 3, 1.2);
    O( 5, -5, 1.2, 3, 1.2);
    O(-5,  5, 1.2, 3, 1.2);
    // Perimeter cover.
    O( 14,  0, 2, 1.2, 6);
    O(-14,  0, 2, 1.2, 6);
    O(  0, 14, 6, 1.2, 2);
    O(  0,-14, 6, 1.2, 2);
    // Tall corner walls (with gaps to walk around).
    O( 22,  22, 4, 4, 1);
    O( 22,  22, 1, 4, 4);
    O(-22,  22, 4, 4, 1);
    O(-22,  22, 1, 4, 4);
    O( 22, -22, 4, 4, 1);
    O( 22, -22, 1, 4, 4);
    O(-22, -22, 4, 4, 1);
    O(-22, -22, 1, 4, 4);
    // Low scattered crates.
    O( 10,  -3, 1.5, 1, 1.5);
    O(-10,   3, 1.5, 1, 1.5);
    O(  3,  10, 1.5, 1, 1.5);
    O( -3, -10, 1.5, 1, 1.5);
  }

  spawnEnemy() {
    if (this.enemies.filter(e => e.alive).length >= this.maxEnemies) return;
    const side = Math.floor(Math.random() * 4);
    const t = (Math.random() * 2 - 1) * (ARENA_HALF - 2);
    const e = ARENA_HALF - 2;
    const pos = new THREE.Vector3(
      side === 0 ? -e : side === 1 ? e : t,
      ENEMY_HEIGHT / 2,
      side === 2 ? -e : side === 3 ? e : t
    );
    if (this.collidesObstacle(pos, ENEMY_RADIUS)) return;
    this.enemies.push({
      id: this.nextId++, position: pos, hp: 60, alive: true,
      velocity: new THREE.Vector3(), retargetIn: 0
    });
  }

  switchWeapon(id: WeaponId) {
    if (this.player.current === id) return;
    if (this.player.switchCooldown > 0) return;
    if (this.player.weapons[id].reloading > 0) {
      this.player.weapons[id].reloading = 0; // cancel reload on swap
    }
    this.player.current = id;
    this.player.switchCooldown = 0.35;
  }

  cycleWeapon(dir: 1 | -1) {
    const i = WEAPON_ORDER.indexOf(this.player.current);
    const ni = (i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length;
    this.switchWeapon(WEAPON_ORDER[ni]);
  }

  step(dt: number, input: {
    forward: number; strafe: number; jump: boolean; sprint: boolean;
    shoot: boolean; reload: boolean; aiming?: boolean; slide?: boolean;
    jumpEdge?: boolean; // true on the frame jump was first pressed
  }) {
    const p = this.player;
    const w = p.weapons[p.current];
    const def = WEAPONS[p.current];

    // Cooldowns.
    if (p.switchCooldown > 0) p.switchCooldown -= dt;
    if (p.slideCooldown > 0) p.slideCooldown -= dt;
    if (w.fireCooldown > 0) w.fireCooldown -= dt;

    // Reload.
    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) {
        const need = def.magSize - w.ammoMag;
        const take = Math.min(need, w.ammoReserve);
        w.ammoMag += take; w.ammoReserve -= take;
        w.reloading = 0;
      }
    } else if ((input.reload || w.ammoMag === 0) && w.ammoMag < def.magSize && w.ammoReserve > 0) {
      w.reloading = def.reloadTime;
    }

    // Slide trigger.
    const aiming = !!input.aiming;
    if (input.slide && p.onGround && p.slideCooldown <= 0 && p.sliding <= 0
        && (input.forward !== 0 || input.strafe !== 0)) {
      p.sliding = 0.55;
      p.slideCooldown = 1.2;
      // Boost in current move direction.
      const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
      const wishX = (input.strafe * cos) + (input.forward * sin);
      const wishZ = (input.strafe * -sin) + (input.forward * cos);
      const wlen = Math.hypot(wishX, wishZ) || 1;
      const boost = 11;
      p.velocity.x = (wishX / wlen) * boost;
      p.velocity.z = (wishZ / wlen) * boost;
    }
    if (p.sliding > 0) p.sliding -= dt;
    const sliding = p.sliding > 0;

    // Movement.
    const speed = sliding ? 0 : (aiming ? 3.2 : (input.sprint ? 7.5 : 5.0));
    const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
    const wishX = (input.strafe * cos) + (input.forward * sin);
    const wishZ = (input.strafe * -sin) + (input.forward * cos);
    let wx = wishX, wz = wishZ;
    const wlen = Math.hypot(wx, wz);
    if (wlen > 0) { wx /= wlen; wz /= wlen; }

    if (!sliding) {
      const accel = p.onGround ? 28 : 8;
      p.velocity.x += (wx * speed - p.velocity.x) * Math.min(1, accel * dt / Math.max(0.0001, speed));
      p.velocity.z += (wz * speed - p.velocity.z) * Math.min(1, accel * dt / Math.max(0.0001, speed));
      if (wlen === 0 && p.onGround) {
        const drag = Math.max(0, 1 - 12 * dt);
        p.velocity.x *= drag; p.velocity.z *= drag;
      }
    } else {
      // Slide friction.
      const drag = Math.max(0, 1 - 2.2 * dt);
      p.velocity.x *= drag; p.velocity.z *= drag;
    }

    // Gravity / jump (with double jump).
    p.velocity.y -= 22 * dt;
    if (input.jumpEdge && p.jumpsRemaining > 0 && !sliding) {
      p.velocity.y = 8;
      p.onGround = false;
      p.jumpsRemaining -= 1;
    }

    // Integrate.
    this.moveAxis(p.position, new THREE.Vector3(p.velocity.x * dt, 0, 0), PLAYER_RADIUS);
    this.moveAxis(p.position, new THREE.Vector3(0, 0, p.velocity.z * dt), PLAYER_RADIUS);
    this.moveAxis(p.position, new THREE.Vector3(0, p.velocity.y * dt, 0), PLAYER_RADIUS);

    // Ground / landing.
    const eyeBase = sliding ? SLIDE_HEIGHT : PLAYER_HEIGHT;
    if (p.position.y <= eyeBase) {
      p.position.y = eyeBase;
      if (p.velocity.y < 0) p.velocity.y = 0;
      if (!p.onGround) p.jumpsRemaining = 2;
      p.onGround = true;
    } else {
      const feet = p.position.y - eyeBase;
      let landed = false;
      for (const o of this.obstacles) {
        if (p.position.x > o.min.x - PLAYER_RADIUS && p.position.x < o.max.x + PLAYER_RADIUS &&
            p.position.z > o.min.z - PLAYER_RADIUS && p.position.z < o.max.z + PLAYER_RADIUS) {
          if (feet <= o.max.y + 0.01 && feet >= o.max.y - 0.05 && p.velocity.y <= 0) {
            p.position.y = o.max.y + eyeBase;
            p.velocity.y = 0; landed = true;
            if (!p.onGround) p.jumpsRemaining = 2;
            break;
          }
        }
      }
      p.onGround = landed;
    }

    // Enemies AI (singleplayer mode only spawns these).
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.retargetIn -= dt;
      const toPlayer = new THREE.Vector3().subVectors(p.position, e.position).setY(0);
      const dist = toPlayer.length();
      if (e.retargetIn <= 0) {
        e.retargetIn = 0.4 + Math.random() * 0.5;
        if (dist > 0.001) toPlayer.normalize();
        const espeed = 2.6;
        e.velocity.set(toPlayer.x * espeed, 0, toPlayer.z * espeed);
      }
      const step = e.velocity.clone().multiplyScalar(dt);
      this.moveAxis(e.position, new THREE.Vector3(step.x, 0, 0), ENEMY_RADIUS);
      this.moveAxis(e.position, new THREE.Vector3(0, 0, step.z), ENEMY_RADIUS);
      e.position.y = ENEMY_HEIGHT / 2;
      if (dist < 1.2) p.hp -= 18 * dt;
    }

    if (p.hp < 0) p.hp = 0;
    this.enemies = this.enemies.filter(e => e.alive);

    if (this.maxEnemies > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) { this.spawnEnemy(); this.spawnTimer = 1.6; }
    }
  }

  /** Fire the current weapon. Returns multiple rays for shotgun. */
  shootBurst(origin: THREE.Vector3, baseDir: THREE.Vector3, aiming: boolean): ShotResult | null {
    const p = this.player;
    const w = p.weapons[p.current];
    const def = WEAPONS[p.current];
    if (w.reloading > 0 || w.fireCooldown > 0 || w.ammoMag <= 0) return null;
    w.ammoMag -= 1;
    w.fireCooldown = def.fireCooldown;

    const spread = aiming ? def.spreadAds : def.spreadHip;
    const rays: ShotResult['rays'] = [];
    for (let i = 0; i < def.pellets; i++) {
      const dir = baseDir.clone();
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
      const hit = this.castRay(origin, dir, def.range);
      const end = hit ? hit.point : origin.clone().add(dir.clone().multiplyScalar(def.range));
      let killed = false; let enemyId: number | undefined;
      if (hit?.enemy) {
        hit.enemy.hp -= def.damage;
        enemyId = hit.enemy.id;
        if (hit.enemy.hp <= 0) {
          hit.enemy.alive = false;
          this.score += 100;
          this.killstreak += 1;
          if (this.killstreak > this.bestStreak) this.bestStreak = this.killstreak;
          killed = true;
        }
      }
      rays.push({ dir, end, enemyId, killed });
    }
    return { origin: origin.clone(), rays };
  }

  private castRay(origin: THREE.Vector3, dir: THREE.Vector3, range: number)
    : { point: THREE.Vector3; enemy?: Enemy } | null {
    const ray = new THREE.Ray(origin, dir.clone().normalize());
    let bestT = range;
    let pt = new THREE.Vector3();
    let hitEnemy: Enemy | undefined;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const centers = [
        new THREE.Vector3(e.position.x, e.position.y, e.position.z),
        new THREE.Vector3(e.position.x, e.position.y + 0.55, e.position.z),
      ];
      for (const c of centers) {
        const t = raySphere(ray, c, ENEMY_RADIUS);
        if (t != null && t < bestT) { bestT = t; pt = ray.at(t, new THREE.Vector3()); hitEnemy = e; }
      }
    }
    for (const o of this.obstacles) {
      const t = rayAABB(ray, o.min, o.max);
      if (t != null && t < bestT) { bestT = t; pt = ray.at(t, new THREE.Vector3()); hitEnemy = undefined; }
    }
    if (Math.abs(ray.direction.y) > 1e-6) {
      const t = -ray.origin.y / ray.direction.y;
      if (t > 0 && t < bestT) { bestT = t; pt = ray.at(t, new THREE.Vector3()); hitEnemy = undefined; }
    }
    if (bestT >= range && !hitEnemy) {
      // Cap at range.
      pt = ray.at(range, new THREE.Vector3());
      return { point: pt };
    }
    return { point: pt, enemy: hitEnemy };
  }

  notifyDeath() { this.killstreak = 0; }

  private collidesObstacle(pos: THREE.Vector3, radius: number): boolean {
    for (const o of this.obstacles) {
      if (pos.x + radius > o.min.x && pos.x - radius < o.max.x &&
          pos.z + radius > o.min.z && pos.z - radius < o.max.z &&
          pos.y < o.max.y && pos.y > o.min.y - 0.1) return true;
    }
    return false;
  }

  private moveAxis(pos: THREE.Vector3, delta: THREE.Vector3, radius: number) {
    pos.add(delta);
    if (pos.x < -ARENA_HALF + radius) pos.x = -ARENA_HALF + radius;
    if (pos.x >  ARENA_HALF - radius) pos.x =  ARENA_HALF - radius;
    if (pos.z < -ARENA_HALF + radius) pos.z = -ARENA_HALF + radius;
    if (pos.z >  ARENA_HALF - radius) pos.z =  ARENA_HALF - radius;

    const eyeBase = this.player.sliding > 0 ? SLIDE_HEIGHT : PLAYER_HEIGHT;
    for (const o of this.obstacles) {
      const intersects =
        pos.x + radius > o.min.x && pos.x - radius < o.max.x &&
        pos.z + radius > o.min.z && pos.z - radius < o.max.z &&
        pos.y > o.min.y - 0.05 && pos.y - eyeBase < o.max.y - 0.05;
      if (!intersects) continue;
      if (delta.x > 0) pos.x = o.min.x - radius;
      else if (delta.x < 0) pos.x = o.max.x + radius;
      if (delta.z > 0) pos.z = o.min.z - radius;
      else if (delta.z < 0) pos.z = o.max.z + radius;
    }
  }
}

function raySphere(ray: THREE.Ray, center: THREE.Vector3, radius: number): number | null {
  const oc = new THREE.Vector3().subVectors(ray.origin, center);
  const b = oc.dot(ray.direction);
  const c = oc.dot(oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t = -b - sq;
  if (t > 0) return t;
  const t2 = -b + sq;
  return t2 > 0 ? t2 : null;
}

function rayAABB(ray: THREE.Ray, min: THREE.Vector3, max: THREE.Vector3): number | null {
  const inv = new THREE.Vector3(1 / ray.direction.x, 1 / ray.direction.y, 1 / ray.direction.z);
  let tmin = (min.x - ray.origin.x) * inv.x;
  let tmax = (max.x - ray.origin.x) * inv.x;
  if (tmin > tmax) [tmin, tmax] = [tmax, tmin];
  let tymin = (min.y - ray.origin.y) * inv.y;
  let tymax = (max.y - ray.origin.y) * inv.y;
  if (tymin > tymax) [tymin, tymax] = [tymax, tymin];
  if (tmin > tymax || tymin > tmax) return null;
  if (tymin > tmin) tmin = tymin;
  if (tymax < tmax) tmax = tymax;
  let tzmin = (min.z - ray.origin.z) * inv.z;
  let tzmax = (max.z - ray.origin.z) * inv.z;
  if (tzmin > tzmax) [tzmin, tzmax] = [tzmax, tzmin];
  if (tmin > tzmax || tzmin > tmax) return null;
  if (tzmin > tmin) tmin = tzmin;
  if (tzmax < tmax) tmax = tzmax;
  return tmin > 0 ? tmin : (tmax > 0 ? tmax : null);
}
