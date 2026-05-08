import Phaser from 'phaser';
import * as THREE from 'three';
import { BoardState, ENEMY_RADIUS } from '../game/BoardState';
import { ThreeGameRenderer } from '../three/ThreeGameRenderer';
import { loadSettings, Settings } from '../game/Settings';
import { SettingsMenu } from '../ui/SettingsMenu';
import { NetClient } from '../net/NetClient';
import { WEAPONS, WEAPON_ORDER, WeaponId } from '../game/Weapons';
import { TouchControls } from '../ui/TouchControls';
import { LoadoutPicker, loadSavedLoadout } from '../ui/LoadoutPicker';
import { Loadout } from '../game/Weapons';

type Mode = 'sp' | 'mp';

export class MainGameScene extends Phaser.Scene {
  private board!: BoardState;
  private three!: ThreeGameRenderer;
  private threeCanvas!: HTMLCanvasElement;
  private settings!: Settings;
  private menu!: SettingsMenu;
  private mode: Mode = 'sp';
  private net: NetClient | null = null;
  private touch!: TouchControls;
  private loadoutUI!: LoadoutPicker;
  private loadout: Loadout = loadSavedLoadout();
  private lastPhase: string = '';
  private xp = 0;
  private level = 1;

  private input$ = {
    forward: 0, strafe: 0, jump: false, jumpEdge: false,
    sprint: false, slide: false, shoot: false, reload: false, aiming: false,
  };
  private keys: Record<string, boolean> = {};
  private locked = false;
  private showScoreboard = false;

  constructor() { super('MainGame'); }

  create() {
    this.settings = loadSettings();
    this.xp = parseInt(localStorage.getItem('veckio.xp') || '0', 10);
    this.level = 1 + Math.floor(this.xp / 500);
    this.board = new BoardState();

    const parent = this.game.canvas.parentElement as HTMLElement;
    this.threeCanvas = document.createElement('canvas');
    Object.assign(this.threeCanvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '0', display: 'block'
    } as Partial<CSSStyleDeclaration>);
    parent.style.position = 'relative';
    parent.insertBefore(this.threeCanvas, this.game.canvas);
    (this.game.canvas as HTMLCanvasElement).style.pointerEvents = 'none';
    (this.game.canvas as HTMLCanvasElement).style.display = 'none';

    this.three = new ThreeGameRenderer(this.threeCanvas, this.board);
    this.three.resize(this.scale.width, this.scale.height);
    this.three.setFovTarget(this.settings.fov);
    this.three.setWeapon(this.board.player.current);
    this.scale.on('resize', (gs: Phaser.Structs.Size) => this.three.resize(gs.width, gs.height));

    this.menu = new SettingsMenu(this.settings, () => {
      if (!this.input$.aiming) this.three.setFovTarget(this.settings.fov);
    });

    this.touch = new TouchControls();

    this.loadoutUI = new LoadoutPicker(
      (l) => { this.loadout = l; this.net?.sendLoadout(l); },
      (l) => { this.loadout = l; this.net?.sendLoadout(l); this.engagePlay(); }
    );

    this.attachOverlay();
    this.attachDomInput();
  }

  private isTouch(): boolean { return this.touch?.enabled ?? false; }

  private attachOverlay() {
    const overlay = document.getElementById('overlay')!;
    const mpForm = document.getElementById('mpForm')!;
    const modeBtns = document.getElementById('modeBtns')!;
    const status = document.getElementById('mpStatus')!;
    const nameInput = document.getElementById('mpName') as HTMLInputElement;
    const urlInput = document.getElementById('mpUrl') as HTMLInputElement;

    nameInput.value = localStorage.getItem('veckio.name') || `Player${Math.floor(Math.random() * 999)}`;
    const lastUrl = localStorage.getItem('veckio.url'); if (lastUrl) urlInput.value = lastUrl;

    document.getElementById('openSettings')!.addEventListener('click', e => { e.stopPropagation(); this.menu.open(); });
    document.getElementById('playSP')!.addEventListener('click', e => { e.stopPropagation(); this.startSingleplayer(); });
    document.getElementById('playMP')!.addEventListener('click', e => {
      e.stopPropagation(); modeBtns.style.display = 'none'; mpForm.style.display = 'block';
    });
    document.getElementById('mpCancel')!.addEventListener('click', e => {
      e.stopPropagation(); mpForm.style.display = 'none'; modeBtns.style.display = 'flex'; status.textContent = '';
    });
    document.getElementById('mpConnect')!.addEventListener('click', async e => {
      e.stopPropagation();
      // Default: connect to the WS server directly. Use TLS port (8443) when the page is https,
      // plain ws on 8080 otherwise, so mobile https pages still work.
      const isHttps = location.protocol === 'https:';
      const host = location.hostname || 'localhost';
      const defaultUrl = isHttps ? `wss://${host}:8443` : `ws://${host}:8080`;
      const url = urlInput.value.trim() || defaultUrl;
      const name = nameInput.value.trim() || 'Player';
      const prog = (document.getElementById('mpProg') as HTMLSelectElement | null)?.value || 'classic';
      const modeSel = ((document.getElementById('mpMode') as HTMLSelectElement | null)?.value || 'gungame') as 'gungame' | 'dm' | 'tdm';
      const bots = parseInt((document.getElementById('mpBots') as HTMLSelectElement | null)?.value || '0', 10);
      localStorage.setItem('veckio.name', name);
      localStorage.setItem('veckio.url', url);
      localStorage.setItem('veckio.prog', prog);
      localStorage.setItem('veckio.bots', String(bots));
      localStorage.setItem('veckio.mode', modeSel);
      status.textContent = 'Connecting…';
      try {
        await this.startMultiplayer(url, name);
        this.net?.sendMode(modeSel);
        this.net?.sendProgression(prog);
        this.net?.sendBots(bots);
        this.net?.sendLoadout(this.loadout);
        status.textContent = '';
      } catch (err: any) { status.textContent = `Failed: ${err?.message ?? err}`; }
    });
    const savedMode = localStorage.getItem('veckio.mode');
    if (savedMode) (document.getElementById('mpMode') as HTMLSelectElement).value = savedMode;
    const savedProg = localStorage.getItem('veckio.prog');
    if (savedProg) (document.getElementById('mpProg') as HTMLSelectElement).value = savedProg;
    const savedBots = localStorage.getItem('veckio.bots');
    if (savedBots) (document.getElementById('mpBots') as HTMLSelectElement).value = savedBots;

    overlay.addEventListener('click', e => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'LABEL' || tag === 'SELECT' || tag === 'OPTION') return;
      if (this.menu.isOpen()) return;
      if ((this.board.player.hp > 0 || this.net?.connected)) {
        this.engagePlay();
      }
    });

    document.querySelectorAll<HTMLDivElement>('#weaponBar .wslot').forEach(el => {
      el.addEventListener('click', () => {
        if (this.mode === 'mp') return;
        this.board.switchWeapon(el.dataset.w as WeaponId);
      });
    });
  }

  private resetWorld(spawnEnemies: boolean) {
    this.board.reset();
    this.board.maxEnemies = spawnEnemies ? 6 : 0;
    this.three.setFovTarget(this.settings.fov);
    this.three.setWeapon(this.board.player.current);
    if (spawnEnemies) for (let i = 0; i < 3; i++) this.board.spawnEnemy();
    this.three.syncEnemies();
  }

  private startSingleplayer() {
    this.mode = 'sp';
    this.net?.disconnect(); this.net = null;
    this.resetWorld(true);
    const cls = (document.getElementById('spClass') as HTMLSelectElement)?.value as WeaponId | undefined;
    if (cls && this.board.player.weapons[cls]) this.board.player.current = cls;
    document.getElementById('scoreboard')!.style.display = 'none';
    this.engagePlay();
  }

  private async startMultiplayer(url: string, name: string) {
    this.mode = 'mp';
    this.resetWorld(false);
    this.net = new NetClient();
    await this.net.connect(url, name);
    document.getElementById('scoreboard')!.style.display = 'block';
    // Don't engage play yet — wait for phase event. If we land mid-warmup, picker shows; if mid-live, engage.
    document.getElementById('overlay')!.classList.add('hidden');
    if (this.net.phase === 'warmup') {
      const endsAt = (this.net as any).phaseEndsAt ?? (Date.now() + 30000);
      this.loadoutUI.show(endsAt);
    } else {
      this.engagePlay();
    }
  }

  /** Hide the lobby and start playing. Mobile uses touch UI; desktop uses pointer-lock. */
  private engagePlay() {
    if (this.isTouch()) {
      document.getElementById('overlay')!.classList.add('hidden');
      this.locked = true;
      this.touch.show(true);
    } else {
      this.threeCanvas.requestPointerLock();
    }
  }

  private attachDomInput() {
    const overlay = document.getElementById('overlay')!;
    const canvas = this.threeCanvas;

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) overlay.classList.add('hidden');
      else if (!this.menu.isOpen()) overlay.classList.remove('hidden');
      if (!this.locked) {
        this.input$.shoot = false; this.input$.aiming = false;
        this.three.setAiming(false); this.three.setFovTarget(this.settings.fov);
      }
    });

    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      const sens = 0.0022 * this.settings.sensitivity * (this.input$.aiming ? 0.5 : 1);
      this.board.player.yaw -= e.movementX * sens;
      const dy = e.movementY * sens * (this.settings.invertY ? -1 : 1);
      this.board.player.pitch -= dy;
      const lim = Math.PI / 2 - 0.05;
      if (this.board.player.pitch > lim) this.board.player.pitch = lim;
      if (this.board.player.pitch < -lim) this.board.player.pitch = -lim;
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('mousedown', e => {
      if (!this.locked) return;
      if (e.button === 0) this.input$.shoot = true;
      if (e.button === 2) {
        this.input$.aiming = true;
        this.three.setAiming(true);
        this.three.setFovTarget(WEAPONS[this.board.player.current].adsFov);
      }
    });
    document.addEventListener('mouseup', e => {
      if (e.button === 0) this.input$.shoot = false;
      if (e.button === 2) {
        this.input$.aiming = false;
        this.three.setAiming(false);
        this.three.setFovTarget(this.settings.fov);
      }
    });

    // Scroll wheel cycles weapons (singleplayer only).
    document.addEventListener('wheel', e => {
      if (!this.locked || this.mode === 'mp') return;
      this.board.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });

    document.addEventListener('keydown', e => {
      // Avoid scroll on space, tab.
      if (this.locked && (e.code === 'Space' || e.code === 'Tab')) e.preventDefault();
      if (this.keys[e.code]) return; // ignore auto-repeat
      this.keys[e.code] = true;
      const b = this.settings.binds;
      if (e.code === b.reload) this.input$.reload = true;
      if (e.code === b.jump) { this.input$.jump = true; this.input$.jumpEdge = true; }
      if (e.code === b.sprint) this.input$.sprint = true;
      if (e.code === b.slide) this.input$.slide = true;
      if (e.code === b.scoreboard) this.showScoreboard = true;
      // Weapon switching: SP free; MP gungame forced; MP dm/tdm uses loadout slots.
      if (this.mode !== 'mp') {
        if (e.code === b.weapon1) this.board.switchWeapon('pistol');
        if (e.code === b.weapon2) this.board.switchWeapon('smg');
        if (e.code === b.weapon3) this.board.switchWeapon('shotgun');
        if (e.code === b.weapon4) this.board.switchWeapon('sniper');
      } else if (this.net?.mode !== 'gungame') {
        if (e.code === b.weapon1) this.board.switchWeapon(this.loadout.main);
        if (e.code === b.weapon2) this.board.switchWeapon(this.loadout.backup);
        if (e.code === b.weapon3) this.board.switchWeapon(this.loadout.melee);
        if (e.code === b.weapon4) this.board.switchWeapon(this.loadout.accessory);
      }
      if (e.code === b.settings) {
        if (this.locked || !this.menu.isOpen()) setTimeout(() => this.menu.open(), 30);
        else this.menu.close();
      }
    });
    document.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      const b = this.settings.binds;
      if (e.code === b.reload) this.input$.reload = false;
      if (e.code === b.jump) this.input$.jump = false;
      if (e.code === b.sprint) this.input$.sprint = false;
      if (e.code === b.slide) this.input$.slide = false;
      if (e.code === b.scoreboard) this.showScoreboard = false;
    });
  }

  private raycastRemote(origin: THREE.Vector3, dir: THREE.Vector3): { id: number; point: THREE.Vector3; dist: number } | null {
    if (!this.net) return null;
    const now = performance.now();
    let best: { id: number; point: THREE.Vector3; dist: number } | null = null;
    const ray = new THREE.Ray(origin, dir.clone().normalize());
    for (const rp of this.net.players.values()) {
      if (rp.id === this.net.selfId || !rp.alive) continue;
      const interp = this.net.interpolated(rp.id, now);
      if (!interp) continue;
      const centers = [
        new THREE.Vector3(interp.x, interp.y - 0.4, interp.z),
        new THREE.Vector3(interp.x, interp.y + 0.2, interp.z),
      ];
      for (const c of centers) {
        const t = raySphereT(ray, c, ENEMY_RADIUS);
        if (t != null && (!best || t < best.dist)) {
          best = { id: rp.id, point: ray.at(t, new THREE.Vector3()), dist: t };
        }
      }
    }
    return best;
  }

  private updateHud() {
    const p = this.board.player;
    const w = p.weapons[p.current];
    const set = (id: string, v: string) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('hp', String(Math.ceil(p.hp)));
    if (this.mode === 'mp' && this.net) {
      const me = this.net.players.get(this.net.selfId);
      const lvl = me?.level ?? 0;
      const total = this.net.chain.length || 6;
      set('weapon', `${WEAPONS[p.current].name}  ·  Lv ${Math.min(lvl, total - 1) + 1}/${total}`);
    } else {
      set('weapon', WEAPONS[p.current].name);
    }
    if (WEAPONS[p.current].melee) {
      set('ammo', '∞');
    } else {
      set('ammo', `${w.ammoMag} / ${w.ammoReserve}` + (w.reloading > 0 ? ' (reloading)' : ''));
    }
    set('streak', `${this.board.killstreak} (best ${this.board.bestStreak})  ·  Lv ${this.level} · ${this.xp} XP`);

    const timerEl = document.getElementById('timer');
    if (timerEl) {
      if (this.mode === 'mp' && this.net?.connected) {
        const ms = Math.max(0, this.net.remainingMs);
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const prefix = this.net.phase === 'warmup' ? 'WARMUP ' : '';
        timerEl.textContent = `${prefix}${m}:${s.toString().padStart(2, '0')}`;
        timerEl.style.color = ms < 30000 ? '#ff8080' : '#fff';
        timerEl.style.display = 'block';
      } else {
        timerEl.style.display = 'none';
      }
    }
    const tsEl = document.getElementById('teamScore');
    if (tsEl) {
      if (this.mode === 'mp' && this.net?.mode === 'tdm' && this.net.teamScore) {
        tsEl.style.display = 'block';
        const tb = document.getElementById('tsBlue'); if (tb) tb.textContent = String(this.net.teamScore[0]);
        const tr = document.getElementById('tsRed');  if (tr) tr.textContent = String(this.net.teamScore[1]);
      } else {
        tsEl.style.display = 'none';
      }
    }
    set('enemies', String(this.mode === 'mp' ? Math.max(0, (this.net?.players.size ?? 1) - 1) : this.board.enemies.filter(e => e.alive).length));
    set('scoreVal', String(this.board.score));

    document.querySelectorAll<HTMLDivElement>('#weaponBar .wslot').forEach(el => {
      el.classList.toggle('active', el.dataset.w === p.current);
    });
    const wbar = document.getElementById('weaponBar');
    if (wbar) wbar.style.display = (this.mode === 'mp') ? 'none' : 'flex';

    const sb = document.getElementById('scoreboard')!;
    if (this.mode === 'mp' && this.net && (this.showScoreboard || true)) {
      sb.style.display = this.showScoreboard ? 'block' : 'block';
      const body = document.getElementById('sbBody')!;
      const rows = [...this.net.players.values()]
        .sort((a, b) => b.score - a.score)
        .map(p2 => `<tr><td>${escapeHtml(p2.name)}${p2.id === this.net!.selfId ? ' <span style="color:#7fd1ff">(you)</span>' : ''}</td><td>${p2.score}</td><td>${p2.alive ? Math.ceil(p2.hp) : '💀'}</td></tr>`)
        .join('');
      body.innerHTML = rows;
    } else if (this.mode === 'sp') {
      sb.style.display = 'none';
    }

    if (this.mode === 'sp' && p.hp <= 0) {
      const overlay = document.getElementById('overlay')!;
      overlay.classList.remove('hidden');
      if (this.isTouch()) { this.touch.show(false); this.locked = false; }
      overlay.querySelector('h1')!.textContent = 'You died';
      const ps = overlay.querySelector('.panel')!.querySelectorAll('p');
      ps[ps.length - 1].innerHTML = `<b>Score ${this.board.score} · best streak ${this.board.bestStreak}</b>`;
      if (this.locked) document.exitPointerLock();
      document.getElementById('modeBtns')!.style.display = 'flex';
      document.getElementById('mpForm')!.style.display = 'none';
      this.board.notifyDeath();
    }
  }

  private addKillfeed(text: string) {
    const kf = document.getElementById('killfeed')!;
    const div = document.createElement('div');
    div.textContent = text;
    kf.appendChild(div);
    setTimeout(() => div.remove(), 5000);
  }

  private gainXp(amt: number) {
    this.xp += amt;
    const newLevel = 1 + Math.floor(this.xp / 500);
    if (newLevel > this.level) {
      this.level = newLevel;
      this.addKillfeed(`Level up! → ${this.level}`);
    }
    localStorage.setItem('veckio.xp', String(this.xp));
  }

  private handleNetEvents() {
    if (!this.net) return;
    for (const ev of this.net.popEvents() as any[]) {
      switch (ev.t) {
        case 'damaged': {
          this.board.player.hp = ev.hp;
          const dmg = document.getElementById('damage');
          if (dmg) { dmg.classList.add('show'); setTimeout(() => dmg.classList.remove('show'), 200); }
          break;
        }
        case 'respawn':
          this.board.player.position.set(ev.x, ev.y, ev.z);
          this.board.player.velocity.set(0, 0, 0);
          this.board.player.hp = 100;
          for (const id of WEAPON_ORDER) {
            const w = this.board.player.weapons[id];
            w.ammoMag = WEAPONS[id].magSize;
            w.ammoReserve = Math.min(WEAPONS[id].reserveMax, WEAPONS[id].magSize * 4);
            w.reloading = 0; w.fireCooldown = 0;
          }
          this.board.notifyDeath();
          break;
        case 'killed': {
          const wpn = (ev as any).weapon ? ` [${(ev as any).weapon}]` : '';
          this.addKillfeed(`${ev.byName} ▸ ${ev.victimName}${wpn}`);
          if (ev.by === this.net.selfId) {
            this.board.killstreak += 1;
            if (this.board.killstreak > this.board.bestStreak) this.board.bestStreak = this.board.killstreak;
            this.gainXp(100);
          }
          if (ev.victim === this.net.selfId) this.board.notifyDeath();
          break;
        }
        case 'shoot':
          if (ev.by !== this.net.selfId) {
            this.three.spawnBullet(
              new THREE.Vector3(...ev.from),
              new THREE.Vector3(...ev.to),
              0xffb060, 180
            );
          }
          break;
        case 'match_over': {
          const overlay = document.getElementById('overlay')!;
          overlay.classList.remove('hidden');
          overlay.querySelector('h1')!.textContent = `${ev.winner.name} wins!`;
          const ps = overlay.querySelector('.panel')!.querySelectorAll('p');
          const list = ev.scores.map((s: any, i: number) => `${i + 1}. ${s.name} — ${s.score}`).join('<br>');
          ps[ps.length - 1].innerHTML = `<b>Final scores</b><br>${list}<br><br>Next match in ${ev.resetIn}s`;
          if (this.locked) document.exitPointerLock();
          break;
        }
        case 'match_start': {
          const overlay = document.getElementById('overlay')!;
          overlay.classList.add('hidden');
          this.threeCanvas.requestPointerLock();
          break;
        }
      }
    }
  }

  update(_t: number, dtMs: number) {
    const dt = Math.min(0.05, dtMs / 1000);

    const b = this.settings.binds;
    const f = (this.keys[b.forward] ? 1 : 0) - (this.keys[b.back] ? 1 : 0);
    const s = (this.keys[b.right] ? 1 : 0) - (this.keys[b.left] ? 1 : 0);
    this.input$.forward = -f; this.input$.strafe = s;

    if (this.isTouch()) {
      // Override movement / actions from the on-screen controls when active.
      this.input$.forward = this.touch.forward;
      this.input$.strafe = this.touch.strafe;
      this.input$.shoot = this.touch.shoot;
      this.input$.aiming = this.touch.aiming;
      this.three.setAiming(this.touch.aiming);
      this.three.setFovTarget(this.touch.aiming
        ? WEAPONS[this.board.player.current].adsFov
        : this.settings.fov);
      if (this.touch.consumeJumpEdge()) { this.input$.jumpEdge = true; this.input$.jump = true; }
      else this.input$.jump = this.touch.jump;
      if (this.touch.consumeReloadEdge()) this.input$.reload = true;
      else this.input$.reload = false;
      if (this.touch.consumeMenuEdge()) {
        if (this.menu.isOpen()) this.menu.close();
        else this.menu.open();
      }
      // Apply look drag to camera yaw/pitch.
      const look = this.touch.consumeLook();
      const sens = 0.0045 * this.settings.sensitivity * (this.touch.aiming ? 0.55 : 1);
      this.board.player.yaw -= look.dx * sens;
      const dy = look.dy * sens * (this.settings.invertY ? -1 : 1);
      this.board.player.pitch -= dy;
      const lim = Math.PI / 2 - 0.05;
      if (this.board.player.pitch > lim) this.board.player.pitch = lim;
      if (this.board.player.pitch < -lim) this.board.player.pitch = -lim;
    }

    const playing = this.locked && !this.menu.isOpen();
    if (playing && this.board.player.hp > 0) {
      this.board.step(dt, this.input$);
    }
    this.input$.jumpEdge = false; // consume edge

    // Sync renderer to current weapon (after possible switch).
    this.three.setWeapon(this.board.player.current);
    if (this.input$.aiming) this.three.setFovTarget(WEAPONS[this.board.player.current].adsFov);

    // Sniper scope overlay.
    const scope = document.getElementById('scope');
    if (scope) {
      scope.style.display = (this.input$.aiming && this.board.player.current === 'sniper') ? 'block' : 'none';
    }

    if (playing && this.input$.shoot && this.board.player.hp > 0) {
      const def = WEAPONS[this.board.player.current];
      // Auto vs semi: if not auto, only fire on first frame; consume immediately.
      const shouldFire = def.auto || !this.lastShotHeld;
      if (shouldFire) {
        const p = this.board.player;
        const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'));
        const origin = p.position.clone();
        const result = this.board.shootBurst(origin, dir, this.input$.aiming);
        if (result) {
          this.three.spawnMuzzleFlash();
          let anyHitRemote = false;
          for (const r of result.rays) {
            let end = r.end;
            let remoteHitId: number | null = null;
            if (this.mode === 'mp' && this.net) {
              const rem = this.raycastRemote(origin, r.dir);
              const distWorld = origin.distanceTo(end);
              if (rem && rem.dist < distWorld) {
                end = rem.point;
                remoteHitId = rem.id;
              }
            }
            const barrel = origin.clone().add(r.dir.clone().multiplyScalar(0.6));
            const bulletColor = this.board.player.current === 'sniper' ? 0xaaffcc
              : this.board.player.current === 'shotgun' ? 0xffc080
              : this.board.player.current === 'pistol' ? 0xaaddff : 0xfff2a8;
            const bulletSpeed = this.board.player.current === 'sniper' ? 260
              : this.board.player.current === 'shotgun' ? 110 : 180;
            this.three.spawnBullet(barrel, end, bulletColor, bulletSpeed);
            if (this.mode === 'mp' && this.net) {
              this.net.sendShoot([barrel.x, barrel.y, barrel.z], [end.x, end.y, end.z], this.board.player.current);
              if (remoteHitId != null) {
                this.net.sendHit(remoteHitId, def.damage, this.board.player.current);
                anyHitRemote = true;
              }
              // Grenade AOE: damage everyone within radius of impact.
              if (def.aoeRadius && def.aoeRadius > 0) {
                const radSq = def.aoeRadius * def.aoeRadius;
                for (const rp of this.net.players.values()) {
                  if (rp.id === this.net.selfId || !rp.alive) continue;
                  const dx = rp.x - end.x, dy = rp.y - end.y, dz = rp.z - end.z;
                  if (dx*dx + dy*dy + dz*dz <= radSq) {
                    this.net.sendHit(rp.id, def.damage, this.board.player.current);
                    anyHitRemote = true;
                  }
                }
              }
            }
            if (r.killed) this.gainXp(100);
          }
          if (result.rays.some(r => r.enemyId != null) || anyHitRemote) {
            const hm = document.getElementById('hitmarker');
            if (hm) { hm.classList.add('show'); setTimeout(() => hm.classList.remove('show'), 60); }
          }
        }
      }
    }
    this.lastShotHeld = this.input$.shoot;

    if (this.mode === 'mp' && this.net?.connected) {
      // Phase change handling.
      if (this.net.phase !== this.lastPhase) {
        this.lastPhase = this.net.phase;
        if (this.net.phase === 'warmup') {
          this.loadoutUI.show(Date.now() + this.net.remainingMs);
          if (document.pointerLockElement) document.exitPointerLock();
        } else if (this.net.phase === 'live') {
          if (this.loadoutUI.isOpen()) this.loadoutUI.hide();
          // In dm/tdm, spawn with loadout main; gungame is forced by chain below.
          if (this.net.mode !== 'gungame') {
            const main = this.loadout.main;
            if (this.board.player.weapons[main]) this.board.player.current = main;
          }
        }
      }
      // Server-authoritative weapon in gun-game.
      if (this.net.mode === 'gungame') {
        const me = this.net.players.get(this.net.selfId);
        if (me && this.net.chain.length > 0) {
          const idx = Math.min(me.level, this.net.chain.length - 1);
          const forced = this.net.chain[idx] as WeaponId;
          if (this.board.player.weapons[forced] && this.board.player.current !== forced) {
            this.board.player.current = forced;
            this.board.player.switchCooldown = 0;
          }
        }
      }
      const p = this.board.player;
      this.net.sendState(p.position.x, p.position.y, p.position.z, p.yaw, p.pitch);
      this.handleNetEvents();
      const others = [...this.net.players.values()].filter(rp => rp.id !== this.net!.selfId);
      this.three.syncRemotePlayers(others.map(o => ({ id: o.id, name: o.name })));
      const now = performance.now();
      for (const rp of others) {
        const interp = this.net.interpolated(rp.id, now);
        if (!interp) continue;
        this.three.setRemoteTransform(rp.id, interp.x, interp.y, interp.z, interp.yaw, rp.alive, rp.team);
      }
    } else {
      this.three.syncRemotePlayers([]);
    }

    if (this.mode === 'sp') this.three.syncEnemies();

    const moving = (this.input$.forward !== 0 || this.input$.strafe !== 0) && this.board.player.onGround;
    this.three.update(dt, moving);
    this.three.applyCameraFromPlayer();

    if (this.mode === 'sp') {
      const dmg = document.getElementById('damage');
      if (dmg && this.board.player.hp < 100 &&
          this.board.enemies.some(e => e.alive &&
            e.position.distanceTo(this.board.player.position) < 1.4)) {
        dmg.classList.add('show');
        setTimeout(() => dmg.classList.remove('show'), 120);
      }
    }

    this.three.render();
    this.updateHud();
  }
  private lastShotHeld = false;
}

function raySphereT(ray: THREE.Ray, center: THREE.Vector3, radius: number): number | null {
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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
