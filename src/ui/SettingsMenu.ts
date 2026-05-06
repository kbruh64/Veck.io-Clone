import {
  Settings, ActionName, ACTION_LABELS, keyLabel, saveSettings, DEFAULT_SETTINGS
} from '../game/Settings';

export class SettingsMenu {
  private root: HTMLDivElement;
  private rebinding: ActionName | null = null;
  private onChange: () => void;

  constructor(private settings: Settings, onChange: () => void) {
    this.onChange = onChange;
    this.root = document.createElement('div');
    this.root.id = 'settings';
    Object.assign(this.root.style, {
      position: 'absolute', inset: '0', display: 'none',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)', zIndex: '10', pointerEvents: 'auto'
    } as CSSStyleDeclaration);
    document.body.appendChild(this.root);

    document.addEventListener('keydown', (e) => {
      if (this.rebinding) {
        e.preventDefault();
        if (e.code === 'Escape') { this.rebinding = null; this.render(); return; }
        this.settings.binds[this.rebinding] = e.code;
        this.rebinding = null;
        saveSettings(this.settings);
        this.onChange();
        this.render();
      }
    }, true);
  }

  isOpen() { return this.root.style.display !== 'none'; }

  open() {
    this.root.style.display = 'flex';
    this.render();
  }
  close() {
    this.rebinding = null;
    this.root.style.display = 'none';
  }

  private render() {
    const s = this.settings;
    const bindRow = (a: ActionName) => `
      <div class="row">
        <span>${ACTION_LABELS[a]}</span>
        <button data-bind="${a}" class="${this.rebinding === a ? 'rebind' : ''}">
          ${this.rebinding === a ? 'press a key…' : keyLabel(s.binds[a])}
        </button>
      </div>`;

    this.root.innerHTML = `
      <style>
        #settings .panel { background:#161a22; padding:24px 28px; border-radius:12px;
          min-width:380px; max-width:520px; color:#e8ecf1; font-family:system-ui,sans-serif;
          box-shadow:0 10px 40px rgba(0,0,0,0.6); }
        #settings h2 { color:#7fd1ff; margin:0 0 14px; }
        #settings h3 { color:#ffd470; margin:18px 0 8px; font-size:14px; text-transform:uppercase; letter-spacing:0.05em; }
        #settings .row { display:flex; justify-content:space-between; align-items:center;
          padding:6px 0; gap:12px; font-size:14px; }
        #settings button { background:#252b38; color:#e8ecf1; border:1px solid #38404f;
          padding:6px 12px; border-radius:6px; cursor:pointer; min-width:90px; font-family:inherit; }
        #settings button:hover { background:#2f3645; }
        #settings button.rebind { background:#7fd1ff; color:#0b0d12; }
        #settings input[type=range] { width:170px; }
        #settings input[type=checkbox] { transform:scale(1.2); }
        #settings .actions { display:flex; gap:10px; margin-top:18px; justify-content:flex-end; }
        #settings .primary { background:#7fd1ff; color:#0b0d12; border-color:#7fd1ff; font-weight:600; }
      </style>
      <div class="panel">
        <h2>Settings</h2>

        <h3>Mouse</h3>
        <div class="row"><span>Sensitivity</span>
          <span><input type="range" id="sens" min="0.2" max="3" step="0.05" value="${s.sensitivity}"> <span id="sensVal">${s.sensitivity.toFixed(2)}</span></span>
        </div>
        <div class="row"><span>Invert Y</span>
          <input type="checkbox" id="invertY" ${s.invertY ? 'checked' : ''}>
        </div>

        <h3>Camera</h3>
        <div class="row"><span>FOV (hipfire)</span>
          <span><input type="range" id="fov" min="50" max="110" step="1" value="${s.fov}"> <span id="fovVal">${s.fov}°</span></span>
        </div>
        <div class="row"><span>FOV (scoped)</span>
          <span><input type="range" id="adsFov" min="20" max="80" step="1" value="${s.adsFov}"> <span id="adsFovVal">${s.adsFov}°</span></span>
        </div>

        <h3>Keybinds</h3>
        ${(Object.keys(ACTION_LABELS) as ActionName[]).map(bindRow).join('')}

        <div class="actions">
          <button id="resetBtn">Reset Defaults</button>
          <button id="closeBtn" class="primary">Resume</button>
        </div>
      </div>
    `;

    this.root.querySelectorAll<HTMLButtonElement>('button[data-bind]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.rebinding = btn.dataset.bind as ActionName;
        this.render();
      });
    });

    const slider = (id: string, valId: string, fmt: (n: number) => string, set: (n: number) => void) => {
      const el = this.root.querySelector<HTMLInputElement>('#' + id)!;
      const out = this.root.querySelector<HTMLSpanElement>('#' + valId)!;
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        set(v); out.textContent = fmt(v);
        saveSettings(this.settings); this.onChange();
      });
    };
    slider('sens', 'sensVal', n => n.toFixed(2), n => this.settings.sensitivity = n);
    slider('fov', 'fovVal', n => n + '°', n => this.settings.fov = n);
    slider('adsFov', 'adsFovVal', n => n + '°', n => this.settings.adsFov = n);

    this.root.querySelector<HTMLInputElement>('#invertY')!
      .addEventListener('change', (e) => {
        this.settings.invertY = (e.target as HTMLInputElement).checked;
        saveSettings(this.settings); this.onChange();
      });

    this.root.querySelector('#resetBtn')!.addEventListener('click', () => {
      Object.assign(this.settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
      saveSettings(this.settings); this.onChange(); this.render();
    });

    this.root.querySelector('#closeBtn')!.addEventListener('click', () => {
      this.close();
      const canvas = document.querySelector('canvas');
      if (canvas && (canvas as HTMLCanvasElement).requestPointerLock) {
        (canvas as HTMLCanvasElement).requestPointerLock();
      }
    });
  }
}
