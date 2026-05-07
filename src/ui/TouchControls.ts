// Mobile touch controls: virtual joystick + action buttons + look-drag.
// On non-touch devices the controls are not built and `enabled` is false.

export class TouchControls {
  enabled = false;
  forward = 0;
  strafe = 0;
  jump = false;
  jumpEdge = false;
  shoot = false;
  aiming = false;
  reloadEdge = false;
  menuEdge = false;

  // Accumulated look delta in screen pixels since last consumed.
  private lookDX = 0;
  private lookDY = 0;

  private root!: HTMLDivElement;
  private joyBase!: HTMLDivElement;
  private joyKnob!: HTMLDivElement;
  private joyTouchId: number | null = null;
  private joyCenterX = 0;
  private joyCenterY = 0;

  private lookTouchId: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;

  private btnAttach: { el: HTMLDivElement; setter: (down: boolean) => void; touchId: number | null }[] = [];

  constructor() {
    // Only enable on real mobile/touch-primary devices.
    // Coarse pointer + no hover is the standard signal for phones/tablets;
    // PCs (even with a touchscreen) report a fine pointer and hover capability.
    this.enabled =
      typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse) and (hover: none)').matches;
    if (!this.enabled) return;
    this.buildDom();
    this.attach();
    this.show(false);
  }

  show(on: boolean) {
    if (!this.enabled) return;
    this.root.style.display = on ? 'block' : 'none';
    if (!on) {
      this.forward = this.strafe = 0;
      this.jump = this.shoot = this.aiming = false;
      this.joyTouchId = null;
      this.lookTouchId = null;
    }
  }

  /** Returns and resets accumulated look delta (px). */
  consumeLook() {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return r;
  }

  consumeJumpEdge() { const r = this.jumpEdge; this.jumpEdge = false; return r; }
  consumeReloadEdge() { const r = this.reloadEdge; this.reloadEdge = false; return r; }
  consumeMenuEdge() { const r = this.menuEdge; this.menuEdge = false; return r; }

  private buildDom() {
    const root = document.createElement('div');
    root.id = 'touchUi';
    Object.assign(root.style, {
      position: 'fixed', inset: '0', zIndex: '5',
      pointerEvents: 'none', userSelect: 'none',
      WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
      touchAction: 'none',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(root);
    this.root = root;

    // Joystick (bottom-left).
    const joyBase = document.createElement('div');
    Object.assign(joyBase.style, {
      position: 'absolute', left: '24px', bottom: '24px',
      width: '140px', height: '140px', borderRadius: '50%',
      background: 'rgba(255,255,255,0.10)',
      border: '2px solid rgba(255,255,255,0.25)',
      pointerEvents: 'auto',
    } as Partial<CSSStyleDeclaration>);
    root.appendChild(joyBase);
    this.joyBase = joyBase;

    const joyKnob = document.createElement('div');
    Object.assign(joyKnob.style, {
      position: 'absolute', left: '50%', top: '50%',
      width: '56px', height: '56px', borderRadius: '50%',
      background: 'rgba(127,209,255,0.55)',
      border: '2px solid rgba(255,255,255,0.6)',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    joyBase.appendChild(joyKnob);
    this.joyKnob = joyKnob;

    // Right-side action buttons.
    const btn = (label: string, right: number, bottom: number, w = 70, h = 70, color = 'rgba(255,255,255,0.18)'): HTMLDivElement => {
      const b = document.createElement('div');
      Object.assign(b.style, {
        position: 'absolute', right: right + 'px', bottom: bottom + 'px',
        width: w + 'px', height: h + 'px', borderRadius: '50%',
        background: color, border: '2px solid rgba(255,255,255,0.35)',
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif', fontWeight: '600', fontSize: '13px',
        pointerEvents: 'auto', textAlign: 'center', lineHeight: '1.1',
      } as Partial<CSSStyleDeclaration>);
      b.textContent = label;
      root.appendChild(b);
      return b;
    };

    const fire = btn('FIRE', 32, 32, 96, 96, 'rgba(255,80,80,0.35)');
    const ads  = btn('ADS', 140, 70, 70, 70, 'rgba(127,209,255,0.30)');
    const jump = btn('JUMP', 32, 140, 70, 70, 'rgba(155,255,127,0.30)');
    const reload = btn('R', 110, 160, 56, 56);
    const menu = btn('☰', 24, 24, 44, 44);
    menu.style.left = ''; menu.style.right = '';
    Object.assign(menu.style, { left: '24px', top: '24px', bottom: 'auto' } as Partial<CSSStyleDeclaration>);

    this.btnAttach.push({ el: fire,  setter: d => { this.shoot = d; },  touchId: null });
    this.btnAttach.push({ el: ads,   setter: d => { this.aiming = d; }, touchId: null });
    this.btnAttach.push({ el: jump,  setter: d => { if (d && !this.jump) this.jumpEdge = true; this.jump = d; }, touchId: null });
    this.btnAttach.push({ el: reload,setter: d => { if (d) this.reloadEdge = true; },  touchId: null });
    this.btnAttach.push({ el: menu,  setter: d => { if (d) this.menuEdge = true; },    touchId: null });
  }

  private attach() {
    const root = this.root;

    const onJoyStart = (t: Touch) => {
      if (this.joyTouchId !== null) return;
      this.joyTouchId = t.identifier;
      const r = this.joyBase.getBoundingClientRect();
      this.joyCenterX = r.left + r.width / 2;
      this.joyCenterY = r.top + r.height / 2;
      this.updateJoy(t.clientX, t.clientY);
    };

    const onLookStart = (t: Touch) => {
      if (this.lookTouchId !== null) return;
      // Only if not on a button or joystick.
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el === this.joyBase || (el && this.btnAttach.some(b => b.el === el || b.el.contains(el!)))) return;
      this.lookTouchId = t.identifier;
      this.lookLastX = t.clientX;
      this.lookLastY = t.clientY;
    };

    root.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        const target = document.elementFromPoint(t.clientX, t.clientY);
        if (target === this.joyBase || this.joyBase.contains(target as Node)) {
          onJoyStart(t);
          continue;
        }
        const btnHit = this.btnAttach.find(b => b.el === target || b.el.contains(target as Node));
        if (btnHit && btnHit.touchId === null) {
          btnHit.touchId = t.identifier;
          btnHit.setter(true);
          continue;
        }
        onLookStart(t);
      }
      // Also handle initial joystick presses anywhere in the bottom-left quadrant for forgiveness.
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joyTouchId) {
          this.updateJoy(t.clientX, t.clientY);
        } else if (t.identifier === this.lookTouchId) {
          const dx = t.clientX - this.lookLastX;
          const dy = t.clientY - this.lookLastY;
          this.lookLastX = t.clientX; this.lookLastY = t.clientY;
          this.lookDX += dx;
          this.lookDY += dy;
        }
      }
    }, { passive: false });

    const onEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joyTouchId) {
          this.joyTouchId = null;
          this.forward = 0; this.strafe = 0;
          this.joyKnob.style.transform = 'translate(-50%, -50%)';
        } else if (t.identifier === this.lookTouchId) {
          this.lookTouchId = null;
        } else {
          for (const b of this.btnAttach) {
            if (b.touchId === t.identifier) { b.touchId = null; b.setter(false); }
          }
        }
      }
    };
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });

    // Block right-click context menu and double-tap zoom on the game canvas.
    document.addEventListener('contextmenu', e => {
      if (this.enabled) e.preventDefault();
    });
  }

  private updateJoy(clientX: number, clientY: number) {
    const dx = clientX - this.joyCenterX;
    const dy = clientY - this.joyCenterY;
    const max = 56;
    const len = Math.hypot(dx, dy);
    const cx = len > max ? dx * max / len : dx;
    const cy = len > max ? dy * max / len : dy;
    this.joyKnob.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;
    // Forward = -y (screen up), Strafe = +x.
    const norm = (v: number) => Math.max(-1, Math.min(1, v / max));
    this.strafe = norm(cx);
    this.forward = -norm(cy);
  }
}
