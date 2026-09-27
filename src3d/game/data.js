// Characters and weapons. Distances are meters, times are seconds.

export const CHARACTERS = [
  {
    id: 'blaze', name: 'Blaze', role: 'Assault',
    color: 0xff5a1f, accent: 0xffb13d,
    speed: 7.6, health: 90, jump: 9.0, radius: 0.36, height: 1.8,
    ability: 'dash', abilityCd: 4, abilityLabel: 'Dash',
    desc: 'Fastest runner. Blasts forward in whatever direction you move.',
    stats: { spd: 5, hp: 2, abl: 4 }
  },
  {
    id: 'tank', name: 'Tank', role: 'Heavy',
    color: 0x3f8cff, accent: 0x8fe3ff,
    speed: 5.4, health: 160, jump: 7.8, radius: 0.46, height: 1.95,
    ability: 'shield', abilityCd: 9, abilityLabel: 'Barrier',
    desc: 'Heavy armor. Barrier blocks all damage for 2.5 seconds.',
    stats: { spd: 1, hp: 5, abl: 3 }
  },
  {
    id: 'ghost', name: 'Ghost', role: 'Infiltrator',
    color: 0xb877ff, accent: 0xe6ccff,
    speed: 6.9, health: 100, jump: 8.6, radius: 0.34, height: 1.8,
    ability: 'blink', abilityCd: 6, abilityLabel: 'Blink',
    desc: 'Teleports 9m in the direction you are looking.',
    stats: { spd: 3, hp: 3, abl: 4 }
  },
  {
    id: 'volt', name: 'Volt', role: 'Gunner',
    color: 0xffd21f, accent: 0x5ff2ff,
    speed: 6.6, health: 100, jump: 8.4, radius: 0.36, height: 1.8,
    ability: 'overclock', abilityCd: 10, abilityLabel: 'Overclock',
    desc: 'Double fire rate and instant reloads for 4 seconds.',
    stats: { spd: 3, hp: 3, abl: 5 }
  }
];

export const charById = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];

// spread = radians of cone half-angle. falloff = [startDist, endDist, minMultiplier]
export const WEAPONS = [
  { id: 'pistol',  name: 'Pistol',   dmg: 24, head: 2.0, rate: 0.26,  mag: 12, reload: 1.1, pellets: 1,
    spread: 0.004, moveSpread: 0.018, recoil: 0.018, falloff: [30, 70, 0.6], zoom: 1.3, adsSpread: 0.4 },
  { id: 'smg',     name: 'SMG',      dmg: 11, head: 1.5, rate: 0.075, mag: 32, reload: 1.7, pellets: 1,
    spread: 0.016, moveSpread: 0.022, recoil: 0.007, falloff: [14, 40, 0.5], zoom: 1.3, adsSpread: 0.6 },
  { id: 'shotgun', name: 'Shotgun',  dmg: 10, head: 1.5, rate: 0.85,  mag: 6,  reload: 2.0, pellets: 9,
    spread: 0.065, moveSpread: 0.01, recoil: 0.05, falloff: [7, 24, 0.2], zoom: 1.2, adsSpread: 0.75 },
  { id: 'rifle',   name: 'Marksman', dmg: 48, head: 2.0, rate: 0.9,   mag: 5,  reload: 2.3, pellets: 1,
    spread: 0.035, moveSpread: 0.03, recoil: 0.06, falloff: [60, 120, 0.8], zoom: 3.2, adsSpread: 0.02 }
];

export const GRAVITY = 24;
export const RESPAWN_TIME = 2.5;
export const SPAWN_PROTECT = 1.5;
export const PICKUP_HEAL = 50;
export const PICKUP_RESPAWN = 20;
