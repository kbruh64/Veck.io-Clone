import { LOADOUT_CHOICES, WEAPONS, WeaponClass, WeaponId, Loadout, DEFAULT_LOADOUT } from '../game/Weapons';

const STORAGE_KEY = 'veckio.loadout';

export function loadSavedLoadout(): Loadout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LOADOUT };
    const parsed = JSON.parse(raw);
    return {
      main: parsed.main && WEAPONS[parsed.main as WeaponId] ? parsed.main : DEFAULT_LOADOUT.main,
      backup: parsed.backup && WEAPONS[parsed.backup as WeaponId] ? parsed.backup : DEFAULT_LOADOUT.backup,
      melee: parsed.melee && WEAPONS[parsed.melee as WeaponId] ? parsed.melee : DEFAULT_LOADOUT.melee,
      accessory: parsed.accessory && WEAPONS[parsed.accessory as WeaponId] ? parsed.accessory : DEFAULT_LOADOUT.accessory,
    };
  } catch { return { ...DEFAULT_LOADOUT }; }
}

function saveLoadout(l: Loadout) { localStorage.setItem(STORAGE_KEY, JSON.stringify(l)); }

export class LoadoutPicker {
  private root: HTMLDivElement;
  private current: Loadout;
  private timerEl!: HTMLDivElement;
  private endsAt = 0;
  private rafId: number | null = null;
  private onChange: (l: Loadout) => void;
  private onLockIn: (l: Loadout) => void;

  constructor(onChange: (l: Loadout) => void, onLockIn: (l: Loadout) => void) {
    this.current = loadSavedLoadout();
    this.onChange = onChange;
    this.onLockIn = onLockIn;
    this.root = document.createElement('div');
    this.root.id = 'loadoutPicker';
    Object.assign(this.root.style, {
      position: 'absolute', inset: '0', display: 'none',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.78)', zIndex: '9', pointerEvents: 'auto',
      color: '#e8ecf1', fontFamily: 'system-ui, sans-serif',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.root);
  }

  getLoadout(): Loadout { return { ...this.current }; }

  show(endsAt: number) {
    this.endsAt = endsAt;
    this.root.style.display = 'flex';
    this.render();
    this.tick();
  }

  hide() {
    this.root.style.display = 'none';
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.onLockIn(this.current);
  }

  isOpen() { return this.root.style.display !== 'none'; }

  private tick = () => {
    if (this.timerEl) {
      const ms = Math.max(0, this.endsAt - Date.now());
      const s = Math.ceil(ms / 1000);
      this.timerEl.textContent = `${s}s`;
      this.timerEl.style.color = s <= 5 ? '#ff8080' : '#ffd470';
      if (ms <= 0) { this.hide(); return; }
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private render() {
    const klassRow = (klass: WeaponClass, label: string) => {
      const opts = LOADOUT_CHOICES[klass];
      return `
        <div class="row">
          <div class="label">${label}</div>
          <div class="opts">
            ${opts.map(id => {
              const w = WEAPONS[id];
              const sel = (this.current as any)[klass] === id;
              return `<button data-klass="${klass}" data-id="${id}" class="${sel ? 'sel' : ''}">
                <div class="wn">${w.name}</div>
                <div class="ws">DMG ${w.damage} · ${w.auto ? 'AUTO' : 'SEMI'} · ${w.magSize === 9999 ? '∞' : w.magSize + ' mag'}</div>
              </button>`;
            }).join('')}
          </div>
        </div>`;
    };

    this.root.innerHTML = `
      <style>
        #loadoutPicker .panel { background:#161a22; padding:24px 28px; border-radius:14px;
          width: min(720px, 92vw); max-height: 92vh; overflow:auto;
          box-shadow:0 10px 40px rgba(0,0,0,0.6); }
        #loadoutPicker h2 { margin:0 0 4px; color:#7fd1ff; }
        #loadoutPicker .sub { color:#aab; font-size:13px; margin-bottom:14px; display:flex; justify-content:space-between; }
        #loadoutPicker .timer { font-size:24px; font-weight:700; }
        #loadoutPicker .row { margin: 14px 0; }
        #loadoutPicker .label { font-size:12px; text-transform:uppercase; letter-spacing:0.06em; color:#ffd470; margin-bottom:6px; }
        #loadoutPicker .opts { display:flex; flex-wrap:wrap; gap:8px; }
        #loadoutPicker button { background:#252b38; color:#e8ecf1; border:2px solid #38404f;
          padding:8px 12px; border-radius:8px; cursor:pointer; min-width:130px; text-align:left;
          font-family:inherit; }
        #loadoutPicker button:hover { background:#2f3645; }
        #loadoutPicker button.sel { border-color:#7fd1ff; background:#1a2a3a; }
        #loadoutPicker .wn { font-weight:600; }
        #loadoutPicker .ws { font-size:11px; color:#9aa; margin-top:2px; }
        #loadoutPicker .lockin { display:block; width:100%; margin-top:14px; padding:12px;
          background:#7fd1ff; color:#0b0d12; border:0; font-weight:700; font-size:15px;
          border-radius:8px; cursor:pointer; }
      </style>
      <div class="panel">
        <h2>Choose your loadout</h2>
        <div class="sub">
          <span>Match starts when timer hits zero — pick one weapon per class.</span>
          <span class="timer" id="lpTimer">30s</span>
        </div>
        ${klassRow('main', 'Main')}
        ${klassRow('backup', 'Backup')}
        ${klassRow('melee', 'Melee')}
        ${klassRow('accessory', 'Accessory')}
        <button class="lockin" id="lpLock">Lock in & wait for match</button>
      </div>
    `;
    this.timerEl = this.root.querySelector('#lpTimer') as HTMLDivElement;
    this.root.querySelectorAll<HTMLButtonElement>('button[data-klass]').forEach(b => {
      b.addEventListener('click', () => {
        const k = b.dataset.klass as WeaponClass;
        const id = b.dataset.id as WeaponId;
        (this.current as any)[k] = id;
        saveLoadout(this.current);
        this.onChange(this.current);
        this.render();
      });
    });
    this.root.querySelector('#lpLock')!.addEventListener('click', () => this.hide());
  }
}
