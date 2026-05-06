export type WeaponId = 'pistol' | 'smg' | 'shotgun' | 'sniper';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;        // per pellet
  pellets: number;       // 1 for non-shotguns
  fireCooldown: number;  // seconds between shots
  magSize: number;
  reserveMax: number;
  reloadTime: number;    // seconds
  spreadHip: number;     // radians
  spreadAds: number;     // radians
  adsFov: number;        // degrees
  range: number;
  auto: boolean;         // hold-to-fire
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol', name: 'Pistol',
    damage: 25, pellets: 1, fireCooldown: 0.18,
    magSize: 12, reserveMax: 96, reloadTime: 3.0,
    spreadHip: 0.012, spreadAds: 0.0, adsFov: 50,
    range: 80, auto: false,
  },
  smg: {
    id: 'smg', name: 'SMG',
    damage: 14, pellets: 1, fireCooldown: 0.06,
    magSize: 30, reserveMax: 150, reloadTime: 3.0,
    spreadHip: 0.045, spreadAds: 0.012, adsFov: 55,
    range: 60, auto: true,
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun',
    damage: 12, pellets: 8, fireCooldown: 0.75,
    magSize: 6, reserveMax: 36, reloadTime: 3.0,
    spreadHip: 0.13, spreadAds: 0.07, adsFov: 60,
    range: 30, auto: false,
  },
  sniper: {
    id: 'sniper', name: 'Sniper',
    damage: 90, pellets: 1, fireCooldown: 1.1,
    magSize: 5, reserveMax: 25, reloadTime: 3.0,
    spreadHip: 0.06, spreadAds: 0.0, adsFov: 18,
    range: 200, auto: false,
  },
};

export const WEAPON_ORDER: WeaponId[] = ['pistol', 'smg', 'shotgun', 'sniper'];

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
