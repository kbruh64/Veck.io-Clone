export type WeaponId =
  | 'pistol' | 'magnum'
  | 'smg' | 'rifle' | 'ar' | 'shotgun' | 'sniper'
  | 'knife' | 'bat'
  | 'grenade';

export type WeaponClass = 'main' | 'backup' | 'melee' | 'accessory';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  klass: WeaponClass;
  damage: number;
  pellets: number;
  fireCooldown: number;
  magSize: number;
  reserveMax: number;
  reloadTime: number;
  spreadHip: number;
  spreadAds: number;
  adsFov: number;
  range: number;
  auto: boolean;
  melee?: boolean;
  aoeRadius?: number; // grenade
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // ---- Main ----
  smg: {
    id: 'smg', name: 'SMG', klass: 'main',
    damage: 14, pellets: 1, fireCooldown: 0.06,
    magSize: 30, reserveMax: 150, reloadTime: 3.0,
    spreadHip: 0.045, spreadAds: 0.012, adsFov: 55,
    range: 60, auto: true,
  },
  rifle: {
    id: 'rifle', name: 'Rifle', klass: 'main',
    damage: 22, pellets: 1, fireCooldown: 0.11,
    magSize: 24, reserveMax: 120, reloadTime: 3.0,
    spreadHip: 0.022, spreadAds: 0.004, adsFov: 50,
    range: 100, auto: true,
  },
  ar: {
    id: 'ar', name: 'AR', klass: 'main',
    damage: 18, pellets: 1, fireCooldown: 0.085,
    magSize: 32, reserveMax: 160, reloadTime: 3.0,
    spreadHip: 0.030, spreadAds: 0.006, adsFov: 50,
    range: 90, auto: true,
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', klass: 'main',
    damage: 12, pellets: 8, fireCooldown: 0.75,
    magSize: 6, reserveMax: 36, reloadTime: 3.0,
    spreadHip: 0.13, spreadAds: 0.07, adsFov: 60,
    range: 30, auto: false,
  },
  sniper: {
    id: 'sniper', name: 'Sniper', klass: 'main',
    damage: 90, pellets: 1, fireCooldown: 1.1,
    magSize: 5, reserveMax: 25, reloadTime: 3.0,
    spreadHip: 0.06, spreadAds: 0.0, adsFov: 18,
    range: 200, auto: false,
  },

  // ---- Backup ----
  pistol: {
    id: 'pistol', name: 'Pistol', klass: 'backup',
    damage: 25, pellets: 1, fireCooldown: 0.18,
    magSize: 12, reserveMax: 96, reloadTime: 3.0,
    spreadHip: 0.012, spreadAds: 0.0, adsFov: 50,
    range: 80, auto: false,
  },
  magnum: {
    id: 'magnum', name: 'Magnum', klass: 'backup',
    damage: 55, pellets: 1, fireCooldown: 0.55,
    magSize: 6, reserveMax: 48, reloadTime: 3.0,
    spreadHip: 0.018, spreadAds: 0.0, adsFov: 45,
    range: 90, auto: false,
  },

  // ---- Melee ----
  knife: {
    id: 'knife', name: 'Knife', klass: 'melee',
    damage: 100, pellets: 1, fireCooldown: 0.45,
    magSize: 9999, reserveMax: 0, reloadTime: 0,
    spreadHip: 0, spreadAds: 0, adsFov: 75,
    range: 2.6, auto: false, melee: true,
  },
  bat: {
    id: 'bat', name: 'Bat', klass: 'melee',
    damage: 70, pellets: 1, fireCooldown: 0.55,
    magSize: 9999, reserveMax: 0, reloadTime: 0,
    spreadHip: 0, spreadAds: 0, adsFov: 75,
    range: 3.2, auto: false, melee: true,
  },

  // ---- Accessory ----
  grenade: {
    id: 'grenade', name: 'Grenade', klass: 'accessory',
    damage: 90, pellets: 1, fireCooldown: 4.0,
    magSize: 2, reserveMax: 0, reloadTime: 0,
    spreadHip: 0.01, spreadAds: 0.0, adsFov: 70,
    range: 35, auto: false, aoeRadius: 5,
  },
};

export const WEAPON_ORDER: WeaponId[] = [
  'pistol','magnum','smg','rifle','ar','shotgun','sniper','knife','bat','grenade'
];

/** Loadout class buckets — used for the loadout picker screen. */
export const LOADOUT_CHOICES: Record<WeaponClass, WeaponId[]> = {
  main:      ['smg','rifle','ar','shotgun','sniper'],
  backup:    ['pistol','magnum'],
  melee:     ['knife','bat'],
  accessory: ['grenade'],
};

export interface Loadout {
  main: WeaponId; backup: WeaponId; melee: WeaponId; accessory: WeaponId;
}

export const DEFAULT_LOADOUT: Loadout = {
  main: 'smg', backup: 'pistol', melee: 'knife', accessory: 'grenade',
};

/** Built-in gun-game progressions. */
export const PROGRESSIONS: Record<string, WeaponId[]> = {
  classic:  ['pistol','smg','rifle','ar','shotgun','magnum','sniper','bat','knife'],
  brawler:  ['smg','shotgun','ar','bat','knife'],
  marksman: ['pistol','rifle','sniper','magnum','knife'],
};

export interface WeaponState {
  id: WeaponId;
  ammoMag: number;
  ammoReserve: number;
  reloading: number;
  fireCooldown: number;
}

export function makeWeaponState(id: WeaponId): WeaponState {
  const def = WEAPONS[id];
  return {
    id,
    ammoMag: def.magSize,
    ammoReserve: Math.min(def.reserveMax, def.magSize * 4),
    reloading: 0,
    fireCooldown: 0,
  };
}
