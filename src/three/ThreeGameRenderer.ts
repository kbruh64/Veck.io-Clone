import * as THREE from 'three';
import { BoardState, Enemy } from '../game/BoardState';
import { WeaponId } from '../game/Weapons';

interface Tracer { line: THREE.Line; life: number; }
interface MuzzleFlash { mesh: THREE.Mesh; life: number; }

export class ThreeGameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private enemyMeshes = new Map<number, THREE.Group>();
  private remoteMeshes = new Map<number, THREE.Group>();
  private tracers: Tracer[] = [];
  private flashes: MuzzleFlash[] = [];
  private gunGroup: THREE.Group;
  private gunBaseY = -0.18;
  private bobTime = 0;
  private targetFov = 75;
  private aiming = false;
  private gunHipPos = new THREE.Vector3(0.22, -0.18, -0.35);
  private gunAdsPos = new THREE.Vector3(0.0, -0.06, -0.25);

  constructor(canvas: HTMLCanvasElement, private board: BoardState) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x0b0d12);
    this.scene.fog = new THREE.Fog(0x0b0d12, 25, 80);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
    this.targetFov = 75;

    this.buildLights();
    this.buildArena();
    this.gunGroup = this.buildViewmodel('smg');
    this.camera.add(this.gunGroup);
    this.scene.add(this.camera);
  }

  setWeapon(id: WeaponId) {
    if (this.currentWeapon === id) return;
    this.currentWeapon = id;
    this.camera.remove(this.gunGroup);
    this.gunGroup = this.buildViewmodel(id);
    this.camera.add(this.gunGroup);
  }
  private currentWeapon: WeaponId = 'smg';

  private buildLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(20, 40, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 35;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;   sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1;  sun.shadow.camera.far = 100;
    this.scene.add(sun);
  }

  private buildArena() {
    const half = 30;
    // Floor.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2, half * 2, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Grid lines for orientation.
    const grid = new THREE.GridHelper(half * 2, 30, 0x556070, 0x333a48);
    (grid.material as THREE.Material).opacity = 0.55;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.01;
    this.scene.add(grid);

    // Walls.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x39414f, roughness: 0.9 });
    const wallH = 4;
    const wallT = 0.5;
    const make = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      m.position.set(x, wallH / 2, z); m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    };
    make(half * 2 + wallT, wallT,  0,  half);
    make(half * 2 + wallT, wallT,  0, -half);
    make(wallT, half * 2 + wallT,  half, 0);
    make(wallT, half * 2 + wallT, -half, 0);

    // Obstacles from BoardState.
    const obsMat = new THREE.MeshStandardMaterial({ color: 0x4b556b, roughness: 0.85 });
    for (const o of this.board.obstacles) {
      const w = o.max.x - o.min.x, h = o.max.y - o.min.y, d = o.max.z - o.min.z;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), obsMat);
      m.position.set((o.min.x + o.max.x) / 2, h / 2, (o.min.z + o.max.z) / 2);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  private buildViewmodel(id: WeaponId): THREE.Group {
    const g = new THREE.Group();
    const accentColor: Record<WeaponId, number> = {
      pistol: 0x7fd1ff, smg: 0xffd470, shotgun: 0xff8a5b, sniper: 0x9bff7f,
    };
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c1f26, metalness: 0.5, roughness: 0.4 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColor[id], emissive: accentColor[id], emissiveIntensity: 0.15,
      metalness: 0.6, roughness: 0.3
    });

    // Different proportions per weapon.
    const profile: Record<WeaponId, { body: [number, number, number]; barrelLen: number; barrelRad: number; sightSize: number }> = {
      pistol:  { body: [0.12, 0.16, 0.32], barrelLen: 0.22, barrelRad: 0.028, sightSize: 0.035 },
      smg:     { body: [0.14, 0.16, 0.50], barrelLen: 0.34, barrelRad: 0.030, sightSize: 0.040 },
      shotgun: { body: [0.18, 0.18, 0.78], barrelLen: 0.55, barrelRad: 0.055, sightSize: 0.040 },
      sniper:  { body: [0.14, 0.20, 1.05], barrelLen: 0.85, barrelRad: 0.034, sightSize: 0.060 },
    };
    const pr = profile[id];
    const body = new THREE.Mesh(new THREE.BoxGeometry(pr.body[0], pr.body[1], pr.body[2]), bodyMat);
    body.position.set(0, 0, -pr.body[2] / 2 - 0.05);
    g.add(body);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(pr.barrelRad, pr.barrelRad, pr.barrelLen, 16), bodyMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -pr.body[2] - pr.barrelLen / 2 - 0.05);
    g.add(barrel);

    const sight = new THREE.Mesh(new THREE.BoxGeometry(pr.sightSize, pr.sightSize, pr.sightSize * 1.6), accentMat);
    sight.position.set(0, pr.body[1] / 2 + pr.sightSize / 2, -pr.body[2] / 2 - 0.05);
    g.add(sight);

    if (id === 'sniper') {
      // Scope tube on top.
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.28, 16), bodyMat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, pr.body[1] / 2 + 0.06, -0.45);
      g.add(scope);
    }

    g.position.set(0.22, this.gunBaseY, -0.35);
    return g;
  }

  // ---- Public API -------------------------------------------------
  setFovTarget(fov: number) { this.targetFov = fov; }
  setAiming(a: boolean) { this.aiming = a; }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  syncEnemies() {
    const live = new Set<number>();
    for (const e of this.board.enemies) {
      live.add(e.id);
      if (!this.enemyMeshes.has(e.id)) {
        this.enemyMeshes.set(e.id, this.makeEnemyMesh(e));
        this.scene.add(this.enemyMeshes.get(e.id)!);
      }
    }
    for (const [id, mesh] of [...this.enemyMeshes]) {
      if (!live.has(id)) {
        this.scene.remove(mesh);
        this.enemyMeshes.delete(id);
      }
    }
  }

  private makeRemoteMesh(name: string): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x7fd1ff, emissive: 0x103040, roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.85, 4, 12), mat);
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xddeeff, roughness: 0.5 }));
    head.position.y = 0.85;
    g.add(head);
    // Name sprite.
    const tag = makeNameTag(name);
    tag.position.y = 1.5;
    g.add(tag);
    g.userData.tag = tag;
    g.userData.name = name;
    return g;
  }

  syncRemotePlayers(activeIds: { id: number; name: string }[]) {
    const live = new Set<number>();
    for (const { id, name } of activeIds) {
      live.add(id);
      let m = this.remoteMeshes.get(id);
      if (!m) {
        m = this.makeRemoteMesh(name);
        this.remoteMeshes.set(id, m);
        this.scene.add(m);
      } else if (m.userData.name !== name) {
        m.remove(m.userData.tag);
        const tag = makeNameTag(name);
        tag.position.y = 1.5;
        m.add(tag);
        m.userData.tag = tag;
        m.userData.name = name;
      }
    }
    for (const [id, m] of [...this.remoteMeshes]) {
      if (!live.has(id)) { this.scene.remove(m); this.remoteMeshes.delete(id); }
    }
  }

  setRemoteTransform(id: number, x: number, y: number, z: number, yaw: number, alive: boolean) {
    const m = this.remoteMeshes.get(id);
    if (!m) return;
    m.visible = alive;
    m.position.set(x, y - 0.85, z); // capsule center to feet-ish offset
    m.rotation.y = yaw;
  }

  private makeEnemyMesh(_e: Enemy): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xff5060, emissive: 0x3a0a10, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.7, 4, 12), mat);
    body.castShadow = true;
    g.add(body);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe070 }));
    eye.position.set(0, 0.45, 0.4);
    g.add(eye);
    return g;
  }

  spawnTracer(from: THREE.Vector3, to: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.06 });
  }

  spawnMuzzleFlash() {
    const geo = new THREE.SphereGeometry(0.06, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 1 });
    const m = new THREE.Mesh(geo, mat);
    // Position at barrel tip in camera space.
    m.position.set(0.22, this.gunBaseY + 0.02, -0.95);
    this.camera.add(m);
    this.flashes.push({ mesh: m, life: 0.05 });
    // Recoil kick.
    this.gunGroup.position.z = -0.27;
  }

  applyCameraFromPlayer() {
    const p = this.board.player;
    this.camera.position.set(p.position.x, p.position.y, p.position.z);
    // Yaw around Y, then pitch.
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = p.yaw;
    this.camera.rotation.x = p.pitch;
  }

  update(dt: number, moving: boolean) {
    // Sync enemy mesh positions.
    for (const e of this.board.enemies) {
      const mesh = this.enemyMeshes.get(e.id);
      if (mesh) {
        mesh.position.copy(e.position);
        mesh.position.y = 0.85;
        const dx = this.board.player.position.x - e.position.x;
        const dz = this.board.player.position.z - e.position.z;
        mesh.rotation.y = Math.atan2(dx, dz);
      }
    }

    // Tracers fade.
    for (const t of this.tracers) {
      t.life -= dt;
      const m = t.line.material as THREE.LineBasicMaterial;
      m.opacity = Math.max(0, t.life / 0.06);
    }
    this.tracers = this.tracers.filter(t => {
      if (t.life <= 0) { this.scene.remove(t.line); return false; }
      return true;
    });

    for (const f of this.flashes) {
      f.life -= dt;
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f.life / 0.05);
    }
    this.flashes = this.flashes.filter(f => {
      if (f.life <= 0) { this.camera.remove(f.mesh); return false; }
      return true;
    });

    // Viewmodel bob + recoil recovery + ADS lerp.
    if (moving) this.bobTime += dt * (this.aiming ? 5 : 9);
    const target = this.aiming ? this.gunAdsPos : this.gunHipPos;
    const k = Math.min(1, 14 * dt);
    this.gunGroup.position.x += (target.x - this.gunGroup.position.x) * k;
    this.gunGroup.position.y += (target.y - this.gunGroup.position.y) * k;
    this.gunGroup.position.z += (target.z - this.gunGroup.position.z) * k;
    const bobAmt = this.aiming ? 0.0015 : 0.005;
    this.gunGroup.position.x += Math.sin(this.bobTime) * bobAmt;
    this.gunGroup.position.y += Math.abs(Math.cos(this.bobTime)) * bobAmt;

    // Smooth FOV toward target (for ADS zoom).
    if (Math.abs(this.camera.fov - this.targetFov) > 0.05) {
      this.camera.fov += (this.targetFov - this.camera.fov) * Math.min(1, 12 * dt);
      this.camera.updateProjectionMatrix();
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }
}

function makeNameTag(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

