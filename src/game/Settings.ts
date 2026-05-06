export type ActionName =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'sprint' | 'slide' | 'reload' | 'settings'
  | 'weapon1' | 'weapon2' | 'weapon3' | 'weapon4' | 'scoreboard';

export interface Settings {
  binds: Record<ActionName, string>; // KeyboardEvent.code
  sensitivity: number; // multiplier (1.0 = default)
  fov: number;         // degrees
  adsFov: number;      // degrees when scoped
  invertY: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  binds: {
    forward: 'KeyW',
    back: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    jump: 'Space',
    sprint: 'ShiftLeft',
    slide: 'ControlLeft',
    reload: 'KeyR',
    settings: 'Escape',
    weapon1: 'Digit1',
    weapon2: 'Digit2',
    weapon3: 'Digit3',
    weapon4: 'Digit4',
    scoreboard: 'Tab',
  },
  sensitivity: 1.0,
  fov: 75,
  adsFov: 45,
  invertY: false,
};

const STORAGE_KEY = 'veckio.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, binds: { ...DEFAULT_SETTINGS.binds } };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      binds: { ...DEFAULT_SETTINGS.binds, ...(parsed.binds ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, binds: { ...DEFAULT_SETTINGS.binds } };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'ShiftLeft') return 'L Shift';
  if (code === 'ShiftRight') return 'R Shift';
  if (code === 'ControlLeft') return 'L Ctrl';
  if (code === 'ControlRight') return 'R Ctrl';
  if (code === 'AltLeft') return 'L Alt';
  if (code === 'AltRight') return 'R Alt';
  if (code === 'Space') return 'Space';
  if (code === 'Escape') return 'Esc';
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  return code;
}

export const ACTION_LABELS: Record<ActionName, string> = {
  forward: 'Move Forward',
  back: 'Move Back',
  left: 'Strafe Left',
  right: 'Strafe Right',
  jump: 'Jump / Double Jump',
  sprint: 'Sprint',
  slide: 'Slide',
  reload: 'Reload',
  settings: 'Open Menu',
  weapon1: 'Weapon 1 (Pistol)',
  weapon2: 'Weapon 2 (SMG)',
  weapon3: 'Weapon 3 (Shotgun)',
  weapon4: 'Weapon 4 (Sniper)',
  scoreboard: 'Hold for Scoreboard',
};
