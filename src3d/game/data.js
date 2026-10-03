// Characters, abilities, weapons, shields, skins, economy. Distances are meters, times are seconds.

export const VERSION = '2.7.2';

// Developer accounts (Riftline IDs, name#TAG) own every skin for free while signed in
export const DEV_IDS = ['CAT#CAT'];

// Each fighter has Q and E abilities (cooldowns) and an X ultimate (charged by points).
export const CHARACTERS = [
  {
    id: 'blaze', name: 'Blaze', role: 'Assault',
    color: 0xff5a1f, accent: 0xffb13d,
    speed: 7.0, health: 100, jump: 9.0, radius: 0.36, height: 1.8,
    desc: 'Aggressive entry fighter who burns through defenses.',
    abilities: [
      { key: 'Q', id: 'dash', name: 'Dash', cd: 8, desc: 'Blast forward in the direction you move.' },
      { key: 'E', id: 'firebomb', name: 'Firebomb', cd: 20, desc: 'Throw a firebomb that burns an area for 4s.' },
      { key: 'X', id: 'rocket', name: 'Rocket', ult: 6, desc: 'Fire a rocket that explodes for massive damage.' }
    ],
    stats: { spd: 5, hp: 3, abl: 4 }
  },
  {
    id: 'tank', name: 'Tank', role: 'Heavy',
    color: 0x3f8cff, accent: 0x8fe3ff,
    speed: 5.8, health: 140, jump: 7.8, radius: 0.46, height: 1.95, hitScale: 1.12,
    desc: 'Walking fortress. Soaks damage and shakes the ground.',
    abilities: [
      { key: 'Q', id: 'shield', name: 'Barrier', cd: 20, desc: 'Become immune to all damage for 2.5s.' },
      { key: 'E', id: 'fortify', name: 'Fortify', cd: 30, desc: 'Instantly gain a full +50 shield.' },
      { key: 'X', id: 'quake', name: 'Earthquake', ult: 6, desc: 'Slam the ground: damage and slow enemies within 9m.' }
    ],
    stats: { spd: 1, hp: 5, abl: 3 }
  },
  {
    id: 'ghost', name: 'Ghost', role: 'Infiltrator',
    color: 0xb877ff, accent: 0xe6ccff,
    speed: 6.9, health: 100, jump: 8.6, radius: 0.34, height: 1.8,
    desc: 'Slips past lines unseen and blinds sightlines.',
    abilities: [
      { key: 'Q', id: 'blink', name: 'Blink', cd: 10, desc: 'Teleport 9m in the direction you look.' },
      { key: 'E', id: 'smoke', name: 'Shadow Smoke', cd: 25, desc: 'Drop a smoke cloud where you aim (10s).' },
      { key: 'X', id: 'cloak', name: 'Phantom', ult: 6, desc: 'Turn invisible for 6 seconds.' }
    ],
    stats: { spd: 4, hp: 3, abl: 4 }
  },
  {
    id: 'volt', name: 'Volt', role: 'Gunner',
    color: 0xffd21f, accent: 0x5ff2ff,
    speed: 6.6, health: 100, jump: 8.4, radius: 0.36, height: 1.8,
    desc: 'Electric damage dealer who chains lightning between foes.',
    abilities: [
      { key: 'Q', id: 'overclock', name: 'Overclock', cd: 20, desc: 'Double fire rate and instant reloads for 4s.' },
      { key: 'E', id: 'chain', name: 'Chain Lightning', cd: 14, desc: 'Zap the enemy you aim at; it arcs to a second enemy.' },
      { key: 'X', id: 'storm', name: 'Thunderstorm', ult: 7, desc: 'Call a storm where you aim that shocks and slows.' }
    ],
    stats: { spd: 3, hp: 3, abl: 5 }
  },
  {
    id: 'frost', name: 'Frost', role: 'Controller',
    color: 0x6fd3ff, accent: 0xe0fbff,
    speed: 6.5, health: 100, jump: 8.4, radius: 0.37, height: 1.82,
    desc: 'Controls space with ice walls and freezing blasts.',
    abilities: [
      { key: 'Q', id: 'wall', name: 'Ice Wall', cd: 20, desc: 'Raise a wall that blocks movement and bullets (8s).' },
      { key: 'E', id: 'nova', name: 'Frost Nova', cd: 16, desc: 'Chill enemies within 7m: damage and slow.' },
      { key: 'X', id: 'freeze', name: 'Deep Freeze', ult: 6, desc: 'Freeze every enemy within 15m.' }
    ],
    stats: { spd: 3, hp: 3, abl: 4 }
  },
  {
    id: 'nova', name: 'Nova', role: 'Medic',
    color: 0x39e07a, accent: 0xc8ffd8,
    speed: 6.8, health: 100, jump: 8.5, radius: 0.35, height: 1.78,
    desc: 'Keeps the team alive, and can bring them back.',
    abilities: [
      { key: 'Q', id: 'heal', name: 'Mend', cd: 25, desc: 'Heal yourself and allies within 8m for 50.' },
      { key: 'E', id: 'field', name: 'Healing Field', cd: 30, desc: 'Place a field that heals allies inside it.' },
      { key: 'X', id: 'revive', name: 'Revive', ult: 7, desc: 'Bring your last fallen teammate back to life.' }
    ],
    stats: { spd: 3, hp: 3, abl: 5 }
  },
  {
    id: 'echo', name: 'Echo', role: 'Recon',
    color: 0xff3b5c, accent: 0xffc2cc,
    speed: 7.0, health: 95, jump: 8.6, radius: 0.35, height: 1.8,
    desc: 'Information fighter who hunts through walls.',
    abilities: [
      { key: 'Q', id: 'pulse', name: 'Pulse', cd: 25, desc: 'Reveal all enemies to your team for 4s.' },
      { key: 'E', id: 'mine', name: 'Trip Mine', cd: 20, desc: 'Plant a mine that explodes on enemies.' },
      { key: 'X', id: 'overwatch', name: 'Overwatch', ult: 6, desc: 'Reveal all enemies to your team for 10s.' }
    ],
    stats: { spd: 4, hp: 2, abl: 5 }
  },
  {
    id: 'rift', name: 'Rift', role: 'Skirmisher',
    color: 0xff4fd8, accent: 0x7af0ff,
    speed: 7.2, health: 95, jump: 9.0, radius: 0.34, height: 1.78,
    desc: 'Fast flanker who tears through the line, mines the retreat and vanishes.',
    abilities: [
      { key: 'Q', id: 'dash', name: 'Dash', cd: 8, desc: 'Blast forward in the direction you move.' },
      { key: 'E', id: 'mine', name: 'Trip Mine', cd: 18, desc: 'Plant a mine that explodes on enemies.' },
      { key: 'X', id: 'cloak', name: 'Phantom', ult: 6, desc: 'Turn invisible for 6 seconds.' }
    ],
    stats: { spd: 5, hp: 2, abl: 4 }
  },
  {
    id: 'rook', name: 'Rook', role: 'Sentinel',
    color: 0xc4cddd, accent: 0xff9f43,
    speed: 6.1, health: 120, jump: 8.0, radius: 0.41, height: 1.88, hitScale: 1.06,
    desc: 'Holds a site: walls off lanes, shields up and calls a storm on anyone who pushes.',
    abilities: [
      { key: 'Q', id: 'wall', name: 'Ice Wall', cd: 22, desc: 'Raise a wall that blocks movement and bullets (8s).' },
      { key: 'E', id: 'fortify', name: 'Fortify', cd: 28, desc: 'Instantly gain a full +50 shield.' },
      { key: 'X', id: 'storm', name: 'Thunderstorm', ult: 7, desc: 'Call a storm where you aim that shocks and slows.' }
    ],
    stats: { spd: 2, hp: 4, abl: 4 }
  }
];

export const charById = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
export const ABILITY_NAMES = Object.fromEntries(CHARACTERS.flatMap(c => c.abilities.map(a => [a.id, a.name])));

// spread = radians of cone half-angle. falloff = [startDist, endDist, minMultiplier]
export const WEAPONS = [
  { id: 'classic', name: 'Pistol', slot: 'sidearm', cat: 'Sidearms', price: 0, dmg: 26, head: 2.0, rate: 0.26, mag: 12, reload: 1.1, pellets: 1,
    spread: 0.004, moveSpread: 0.018, recoil: 0.018, falloff: [30, 70, 0.6], zoom: 1.3, adsSpread: 0.4, moveMul: 1 },
  { id: 'mpistol', name: 'Machine Pistol', slot: 'sidearm', cat: 'Sidearms', price: 500, dmg: 15, head: 1.6, rate: 0.085, mag: 18, reload: 1.4, pellets: 1,
    spread: 0.018, moveSpread: 0.018, recoil: 0.008, falloff: [10, 30, 0.55], zoom: 1.2, adsSpread: 0.6, moveMul: 1 },
  { id: 'cannon', name: 'Hand Cannon', slot: 'sidearm', cat: 'Sidearms', price: 900, dmg: 52, head: 2.0, rate: 0.55, mag: 7, reload: 1.7, pellets: 1,
    spread: 0.005, moveSpread: 0.05, recoil: 0.06, falloff: [25, 60, 0.7], zoom: 1.4, adsSpread: 0.35, moveMul: 1 },
  { id: 'shorty', name: 'Shorty', slot: 'sidearm', cat: 'Sidearms', price: 300, dmg: 12, head: 1.5, rate: 0.45, mag: 2, reload: 1.6, pellets: 12,
    spread: 0.09, moveSpread: 0.01, recoil: 0.06, falloff: [5, 16, 0.15], zoom: 1.1, adsSpread: 0.85, moveMul: 1 },
  { id: 'stinger', name: 'Stinger', slot: 'primary', cat: 'SMGs', price: 1100, dmg: 11, head: 1.5, rate: 0.058, mag: 20, reload: 1.8, pellets: 1,
    spread: 0.02, moveSpread: 0.015, recoil: 0.006, falloff: [10, 30, 0.5], zoom: 1.25, adsSpread: 0.6, moveMul: 1 },
  { id: 'smg', name: 'SMG', slot: 'primary', cat: 'SMGs', price: 1500, dmg: 14, head: 1.6, rate: 0.072, mag: 30, reload: 1.7, pellets: 1,
    spread: 0.014, moveSpread: 0.016, recoil: 0.007, falloff: [14, 40, 0.55], zoom: 1.3, adsSpread: 0.6, moveMul: 1 },
  { id: 'shotgun', name: 'Shotgun', slot: 'primary', cat: 'Shotguns', price: 1800, dmg: 11, head: 1.5, rate: 0.85, mag: 6, reload: 2.0, pellets: 9,
    spread: 0.065, moveSpread: 0.01, recoil: 0.05, falloff: [7, 24, 0.2], zoom: 1.2, adsSpread: 0.75, moveMul: 0.97 },
  { id: 'ar', name: 'Assault Rifle', slot: 'primary', cat: 'Rifles', price: 2900, dmg: 30, head: 2.6, rate: 0.1, mag: 25, reload: 2.2, pellets: 1,
    spread: 0.005, moveSpread: 0.045, recoil: 0.012, falloff: [40, 90, 0.8], zoom: 1.6, adsSpread: 0.35, moveMul: 0.95 },
  { id: 'carbine', name: 'Carbine', slot: 'primary', cat: 'Rifles', price: 2100, dmg: 27, head: 2.4, rate: 0.115, mag: 24, reload: 2.1, pellets: 1,
    spread: 0.006, moveSpread: 0.04, recoil: 0.011, falloff: [35, 80, 0.75], zoom: 1.5, adsSpread: 0.4, moveMul: 0.96 },
  { id: 'marksman', name: 'Marksman', slot: 'primary', cat: 'Rifles', price: 2500, dmg: 42, head: 2.3, rate: 0.3, mag: 12, reload: 2.3, pellets: 1,
    spread: 0.004, moveSpread: 0.05, recoil: 0.03, falloff: [60, 130, 0.85], zoom: 1.9, adsSpread: 0.15, moveMul: 0.95 },
  { id: 'scout', name: 'Scout', slot: 'primary', cat: 'Rifles', price: 1100, dmg: 48, head: 2.2, rate: 0.7, mag: 8, reload: 1.9, pellets: 1,
    spread: 0.03, moveSpread: 0.04, recoil: 0.04, falloff: [60, 120, 0.85], zoom: 2.2, adsSpread: 0.06, moveMul: 0.98 },
  { id: 'sniper', name: 'Sniper', slot: 'primary', cat: 'Snipers', price: 4200, dmg: 110, head: 1.6, rate: 1.4, mag: 5, reload: 2.6, pellets: 1,
    spread: 0.05, moveSpread: 0.05, recoil: 0.08, falloff: [80, 160, 0.9], zoom: 3.6, adsSpread: 0.01, moveMul: 0.9, scope: true },
  { id: 'lmg', name: 'LMG', slot: 'primary', cat: 'Heavy', price: 3200, dmg: 24, head: 2.0, rate: 0.085, mag: 60, reload: 3.4, pellets: 1,
    spread: 0.016, moveSpread: 0.05, recoil: 0.01, falloff: [30, 70, 0.75], zoom: 1.4, adsSpread: 0.5, moveMul: 0.85 },
  // Always carried in slot 3, never bought or dropped. Left click slashes, right click is a slower heavy stab.
  { id: 'knife', name: 'Knife', slot: 'melee', cat: 'Melee', price: 0, dmg: 50, head: 1, rate: 0.45, mag: 1, reload: 0, pellets: 1,
    spread: 0, moveSpread: 0, recoil: 0, falloff: [99, 99, 1], zoom: 1, adsSpread: 1, moveMul: 1.1, melee: true, range: 2.3, heavy: 75, heavyRate: 1.0 },
];
export const weaponById = id => WEAPONS.find(w => w.id === id) || WEAPONS[0];

// Shields sit on top of health and soak damage first.
export const SHIELDS = [
  { id: 'light', name: 'Light Shield', amount: 25, price: 400 },
  { id: 'heavy', name: 'Heavy Shield', amount: 50, price: 1000 }
];

// Gun skins (bought with coins earned by playing, equipped per weapon)
export const SKINS = [
  { id: 'default', name: 'Standard', price: 0, tier: 'Base' },
  { id: 'carbon', name: 'Carbon', price: 250, tier: 'Select' },
  { id: 'arctic', name: 'Arctic Camo', price: 350, tier: 'Select' },
  { id: 'tiger', name: 'Tiger', price: 450, tier: 'Deluxe' },
  { id: 'toxic', name: 'Toxic', price: 500, tier: 'Deluxe' },
  { id: 'ocean', name: 'Oceanic', price: 550, tier: 'Deluxe' },
  { id: 'neon', name: 'Neon Pulse', price: 800, tier: 'Premium' },
  { id: 'gold', name: 'Solid Gold', price: 1100, tier: 'Premium' },
  { id: 'dragon', name: 'Dragonfire', price: 1400, tier: 'Exclusive' },
  { id: 'galaxy', name: 'Galaxy', price: 1800, tier: 'Ultra' },
  // Animated: the surface moves (see ANIM_GLSL in skins.js) and flares when you inspect
  { id: 'glitch', name: 'Glitchwave', price: 2400, tier: 'Mythic', animated: true },
  { id: 'plasma', name: 'Plasma Flow', price: 2200, tier: 'Mythic', animated: true },
  { id: 'inferno', name: 'Inferno', price: 2200, tier: 'Mythic', animated: true },
  // Bundle skin: every gun becomes a dragon (head at the muzzle, horns, spine, wings) and the knife becomes a talon
  { id: 'fireflame', name: 'Fire Flame', price: 3200, tier: 'Mythic', animated: true, bundle: 'fireflame' },
  // Inspired by Valorant's skin lines, original designs
  { id: 'arcade', name: 'Arcade', price: 650, tier: 'Deluxe' },
  { id: 'hannya', name: 'Hannya', price: 1200, tier: 'Premium' },
  { id: 'revenant', name: 'Revenant', price: 1900, tier: 'Exclusive', animated: true },
  { id: 'paragon', name: 'Paragon', price: 1900, tier: 'Exclusive', animated: true },
  { id: 'tide', name: 'Abyssal Tide', price: 2000, tier: 'Ultra', animated: true },
  { id: 'ion', name: 'Ion Drive', price: 2100, tier: 'Ultra', animated: true },
  { id: 'chroma', name: 'Chroma', price: 2400, tier: 'Mythic', animated: true },
  { id: 'horizon', name: 'Event Horizon', price: 2400, tier: 'Mythic', animated: true }
];
export const BUNDLES = [{ id: 'fireflame', name: 'FIRE FLAME', skin: 'fireflame', price: 9900, blurb: 'Every gun becomes a dragon. The knife is one of its talons.' }];
export const COINS = { start: 500, match: 50, win: 100, kill: 10, round: 5 };

export const ECON = { start: 800, win: 3000, loss: 1900, lossStep: 500, lossMax: 2900, kill: 200, plant: 300, max: 9000 };
export const ROUND = { buy: 10, firstBuy: 15, live: 100, end: 5 };
export const SPIKE = { plant: 4, defuse: 7, fuse: 40, radius: 14 };

export const GRAVITY = 24;
export const PICKUP_HEAL = 50;
