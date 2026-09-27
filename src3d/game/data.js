// Characters, weapons, armor and economy. Distances are meters, times are seconds.

export const CHARACTERS = [
  {
    id: 'blaze', name: 'Blaze', role: 'Assault',
    color: 0xff5a1f, accent: 0xffb13d,
    speed: 7.4, health: 90, jump: 9.0, radius: 0.36, height: 1.8,
    ability: 'dash', abilityCd: 5, abilityLabel: 'Dash',
    desc: 'Fastest runner. Blasts forward in whatever direction you move.',
    stats: { spd: 5, hp: 2, abl: 4 }
  },
  {
    id: 'tank', name: 'Tank', role: 'Heavy',
    color: 0x3f8cff, accent: 0x8fe3ff,
    speed: 5.4, health: 140, jump: 7.8, radius: 0.46, height: 1.95,
    ability: 'shield', abilityCd: 14, abilityLabel: 'Barrier',
    desc: 'Heavy armor. Barrier blocks all damage for 2.5 seconds.',
    stats: { spd: 1, hp: 5, abl: 3 }
  },
  {
    id: 'ghost', name: 'Ghost', role: 'Infiltrator',
    color: 0xb877ff, accent: 0xe6ccff,
    speed: 6.9, health: 100, jump: 8.6, radius: 0.34, height: 1.8,
    ability: 'blink', abilityCd: 8, abilityLabel: 'Blink',
    desc: 'Teleports 9m in the direction you are looking.',
    stats: { spd: 3, hp: 3, abl: 4 }
  },
  {
    id: 'volt', name: 'Volt', role: 'Gunner',
    color: 0xffd21f, accent: 0x5ff2ff,
    speed: 6.6, health: 100, jump: 8.4, radius: 0.36, height: 1.8,
    ability: 'overclock', abilityCd: 14, abilityLabel: 'Overclock',
    desc: 'Double fire rate and instant reloads for 4 seconds.',
    stats: { spd: 3, hp: 3, abl: 5 }
  },
  {
    id: 'frost', name: 'Frost', role: 'Controller',
    color: 0x6fd3ff, accent: 0xe0fbff,
    speed: 6.5, health: 100, jump: 8.4, radius: 0.37, height: 1.82,
    ability: 'wall', abilityCd: 16, abilityLabel: 'Ice Wall',
    desc: 'Raises a wall of ice that blocks movement and bullets for 8 seconds.',
    stats: { spd: 3, hp: 3, abl: 4 }
  },
  {
    id: 'nova', name: 'Nova', role: 'Medic',
    color: 0x39e07a, accent: 0xc8ffd8,
    speed: 6.8, health: 100, jump: 8.5, radius: 0.35, height: 1.78,
    ability: 'heal', abilityCd: 18, abilityLabel: 'Mend',
    desc: 'Instantly heals you and allies within 8m for 50 HP.',
    stats: { spd: 3, hp: 3, abl: 4 }
  },
  {
    id: 'echo', name: 'Echo', role: 'Recon',
    color: 0xff3b5c, accent: 0xffc2cc,
    speed: 7.0, health: 95, jump: 8.6, radius: 0.35, height: 1.8,
    ability: 'pulse', abilityCd: 18, abilityLabel: 'Pulse',
    desc: 'Reveals every enemy through walls to your whole team for 4 seconds.',
    stats: { spd: 4, hp: 2, abl: 5 }
  }
];

export const charById = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];

// spread = radians of cone half-angle. falloff = [startDist, endDist, minMultiplier]
// moveMul = movement speed multiplier while holding it.
export const WEAPONS = [
  // ---- Sidearms
  { id: 'classic', name: 'Pistol', slot: 'sidearm', cat: 'Sidearms', price: 0, dmg: 24, head: 2.0, rate: 0.26, mag: 12, reload: 1.1, pellets: 1,
    spread: 0.004, moveSpread: 0.018, recoil: 0.018, falloff: [30, 70, 0.6], zoom: 1.3, adsSpread: 0.4, moveMul: 1 },
  { id: 'mpistol', name: 'Machine Pistol', slot: 'sidearm', cat: 'Sidearms', price: 500, dmg: 15, head: 1.6, rate: 0.085, mag: 18, reload: 1.4, pellets: 1,
    spread: 0.018, moveSpread: 0.018, recoil: 0.008, falloff: [10, 30, 0.55], zoom: 1.2, adsSpread: 0.6, moveMul: 1 },
  { id: 'cannon', name: 'Hand Cannon', slot: 'sidearm', cat: 'Sidearms', price: 900, dmg: 52, head: 2.0, rate: 0.55, mag: 7, reload: 1.7, pellets: 1,
    spread: 0.005, moveSpread: 0.05, recoil: 0.06, falloff: [25, 60, 0.7], zoom: 1.4, adsSpread: 0.35, moveMul: 1 },
  // ---- Primaries
  { id: 'smg', name: 'SMG', slot: 'primary', cat: 'SMGs', price: 1500, dmg: 13, head: 1.6, rate: 0.072, mag: 30, reload: 1.7, pellets: 1,
    spread: 0.014, moveSpread: 0.016, recoil: 0.007, falloff: [14, 40, 0.55], zoom: 1.3, adsSpread: 0.6, moveMul: 1 },
  { id: 'shotgun', name: 'Shotgun', slot: 'primary', cat: 'Shotguns', price: 1800, dmg: 11, head: 1.5, rate: 0.85, mag: 6, reload: 2.0, pellets: 9,
    spread: 0.065, moveSpread: 0.01, recoil: 0.05, falloff: [7, 24, 0.2], zoom: 1.2, adsSpread: 0.75, moveMul: 0.97 },
  { id: 'ar', name: 'Assault Rifle', slot: 'primary', cat: 'Rifles', price: 2900, dmg: 29, head: 2.6, rate: 0.1, mag: 25, reload: 2.2, pellets: 1,
    spread: 0.006, moveSpread: 0.045, recoil: 0.012, falloff: [35, 80, 0.8], zoom: 1.6, adsSpread: 0.35, moveMul: 0.95 },
  { id: 'scout', name: 'Scout', slot: 'primary', cat: 'Rifles', price: 1100, dmg: 46, head: 2.2, rate: 0.7, mag: 8, reload: 1.9, pellets: 1,
    spread: 0.03, moveSpread: 0.04, recoil: 0.04, falloff: [60, 120, 0.85], zoom: 2.2, adsSpread: 0.06, moveMul: 0.98 },
  { id: 'sniper', name: 'Sniper', slot: 'primary', cat: 'Snipers', price: 4200, dmg: 110, head: 1.6, rate: 1.4, mag: 5, reload: 2.6, pellets: 1,
    spread: 0.05, moveSpread: 0.05, recoil: 0.08, falloff: [80, 150, 0.9], zoom: 3.6, adsSpread: 0.01, moveMul: 0.9, scope: true },
  { id: 'lmg', name: 'LMG', slot: 'primary', cat: 'Heavy', price: 3200, dmg: 23, head: 2.0, rate: 0.085, mag: 60, reload: 3.4, pellets: 1,
    spread: 0.016, moveSpread: 0.05, recoil: 0.01, falloff: [30, 70, 0.75], zoom: 1.4, adsSpread: 0.5, moveMul: 0.85 }
];
export const weaponById = id => WEAPONS.find(w => w.id === id) || WEAPONS[0];

// Shields sit on top of health and soak damage first.
export const SHIELDS = [
  { id: 'light', name: 'Light Shield', amount: 25, price: 400 },
  { id: 'heavy', name: 'Heavy Shield', amount: 50, price: 1000 }
];

export const ECON = {
  start: 800, win: 3000, loss: 1900, lossStep: 500, lossMax: 2900, kill: 200, max: 9000
};

export const ROUND = { buy: 15, firstBuy: 20, live: 100, end: 5 };

export const GRAVITY = 24;
export const PICKUP_HEAL = 50;
