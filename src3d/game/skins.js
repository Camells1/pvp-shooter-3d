// Gun skin materials. Every skin is generated in code (canvas textures), no image files.
import * as THREE from 'three';

function tex(draw, size = 256, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  draw(x, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let seed = 99;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function blobs(x, S, colors, n, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = colors[i % colors.length];
    const cx = rnd() * S, cy = rnd() * S, r = rMin + rnd() * (rMax - rMin);
    x.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 6) {
      const rr = r * (0.6 + rnd() * 0.6);
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      a === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
    }
    x.fill();
  }
}

const TEX = {
  carbon: () => tex((x, S) => {
    x.fillStyle = '#16181b'; x.fillRect(0, 0, S, S);
    const s = S / 16;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
      const g = x.createLinearGradient(i * s, j * s, (i + 1) * s, (j + 1) * s);
      const flip = (i + j) % 2;
      g.addColorStop(0, flip ? '#2c3036' : '#101214'); g.addColorStop(1, flip ? '#101214' : '#2c3036');
      x.fillStyle = g; x.fillRect(i * s, j * s, s, s);
    }
  }, 128, 2),
  arctic: () => tex((x, S) => {
    x.fillStyle = '#e9eef2'; x.fillRect(0, 0, S, S);
    blobs(x, S, ['#b9c5cf', '#8b9aa8', '#d4dde4', '#5f6f7d'], 60, 10, 34);
  }),
  tiger: () => tex((x, S) => {
    x.fillStyle = '#e8841c'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#141008';
    for (let i = 0; i < 14; i++) {
      const y = rnd() * S, w = 6 + rnd() * 10;
      x.beginPath(); x.moveTo(0, y);
      for (let px = 0; px <= S; px += 16) x.lineTo(px, y + Math.sin(px * 0.05 + i) * 14 + (rnd() - 0.5) * 6);
      for (let px = S; px >= 0; px -= 16) x.lineTo(px, y + w + Math.sin(px * 0.05 + i) * 12);
      x.fill();
    }
  }),
  toxic: () => tex((x, S) => {
    x.fillStyle = '#1c2a12'; x.fillRect(0, 0, S, S);
    blobs(x, S, ['#3f6a1c', '#253d12', '#5c8f22'], 40, 8, 26);
    x.fillStyle = 'rgba(160,255,40,0.8)';
    for (let i = 0; i < 30; i++) { x.beginPath(); x.arc(rnd() * S, rnd() * S, 2 + rnd() * 5, 0, 7); x.fill(); }
  }),
  ocean: () => tex((x, S) => {
    const g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#0b3d66'); g.addColorStop(1, '#06203a');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.strokeStyle = 'rgba(80,220,255,0.45)'; x.lineWidth = 3;
    for (let i = 0; i < 12; i++) { const y = i * S / 12 + 8; x.beginPath(); for (let px = 0; px <= S; px += 8) x.lineTo(px, y + Math.sin(px * 0.06 + i) * 6); x.stroke(); }
  }),
  neonGlow: () => tex((x, S) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    x.strokeStyle = '#ff2fa8'; x.lineWidth = 4;
    for (let i = -S; i < S * 2; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + S, S); x.stroke(); }
    x.strokeStyle = '#2ff5ff'; x.lineWidth = 2;
    for (let i = -S; i < S * 2; i += 32) { x.beginPath(); x.moveTo(i + 16, 0); x.lineTo(i + 16 + S, S); x.stroke(); }
  }),
  dragon: () => tex((x, S) => {
    x.fillStyle = '#6a0c0c'; x.fillRect(0, 0, S, S);
    const s = 22;
    for (let j = 0; j < S / s + 2; j++) for (let i = 0; i < S / s + 2; i++) {
      const cx = i * s + (j % 2) * s / 2, cy = j * s * 0.7;
      const g = x.createRadialGradient(cx, cy - 4, 1, cx, cy, s * 0.6);
      g.addColorStop(0, '#d8321e'); g.addColorStop(0.7, '#8e1410'); g.addColorStop(1, '#3a0404');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, s * 0.55, 0, Math.PI); x.fill();
      x.strokeStyle = 'rgba(255,190,60,0.5)'; x.lineWidth = 1.5; x.stroke();
    }
  }),
  dragonGlow: () => tex((x, S) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    x.strokeStyle = '#ff7a1a'; x.lineWidth = 2;
    for (let i = 0; i < 18; i++) { x.beginPath(); let px = rnd() * S, py = rnd() * S; x.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (rnd() - 0.5) * 40; py += (rnd() - 0.5) * 40; x.lineTo(px, py); } x.stroke(); }
  }),
  galaxy: () => tex((x, S) => {
    const g = x.createRadialGradient(S * 0.4, S * 0.5, 10, S * 0.5, S * 0.5, S * 0.8);
    g.addColorStop(0, '#5b2a9a'); g.addColorStop(0.5, '#23104a'); g.addColorStop(1, '#070312');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 6; i++) { const n = x.createRadialGradient(rnd() * S, rnd() * S, 0, rnd() * S, rnd() * S, 60 + rnd() * 60); n.addColorStop(0, `rgba(${120 + rnd() * 135},${40 + rnd() * 80},255,0.35)`); n.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = n; x.fillRect(0, 0, S, S); }
  }),
  galaxyStars: () => tex((x, S) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) { const b = 150 + rnd() * 105; x.fillStyle = `rgb(${b},${b},255)`; x.fillRect(rnd() * S, rnd() * S, rnd() < 0.1 ? 2 : 1, rnd() < 0.1 ? 2 : 1); }
  })
};
// Surface detail shared by every skin (bump maps only, so skin colors and patterns are untouched):
//   panel   engraved panel border, rivets and scratches (receivers, bodies)
//   grain   fine brushed-metal grain (metal parts, accents)
//   stipple grip stippling (polymer)
// Separate random stream so adding surface detail never changes the existing skin patterns
let dseed = 4242;
const drnd = () => ((dseed = (dseed * 16807) % 2147483647) / 2147483647);
const DETAIL = {
  panel: () => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#b4b4b4'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2200; i++) { const v = 150 + drnd() * 60; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(drnd() * 256, drnd() * 256, 1.5, 1.5); }
    x.strokeStyle = '#3a3a3a'; x.lineWidth = 5; x.strokeRect(14, 14, 228, 228);
    x.strokeStyle = '#e4e4e4'; x.lineWidth = 2; x.strokeRect(22, 22, 212, 212);
    for (const [px, py] of [[34, 34], [222, 34], [34, 222], [222, 222]]) { x.fillStyle = '#fff'; x.beginPath(); x.arc(px, py, 5, 0, 7); x.fill(); x.fillStyle = '#555'; x.beginPath(); x.arc(px, py, 2, 0, 7); x.fill(); }
    x.lineWidth = 1;
    for (let i = 0; i < 24; i++) { x.strokeStyle = drnd() < 0.5 ? '#d8d8d8' : '#6a6a6a'; const sx = 30 + drnd() * 196, sy = 30 + drnd() * 196, a = drnd() * 3.14, l = 8 + drnd() * 26; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); x.stroke(); }
    return c;
  },
  grain: () => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#b0b0b0'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) { const v = 120 + drnd() * 100; x.strokeStyle = `rgb(${v},${v},${v})`; x.lineWidth = 1; const y = drnd() * 128, l = 10 + drnd() * 50, px = drnd() * 128; x.beginPath(); x.moveTo(px, y); x.lineTo(px + l, y + (drnd() - 0.5) * 2); x.stroke(); }
    return c;
  },
  stipple: () => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#c0c0c0'; x.fillRect(0, 0, 128, 128);
    for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) { x.fillStyle = '#4a4a4a'; x.beginPath(); x.arc(i * 4 + (j % 2) * 2 + 2, j * 4 + 2, 1.25, 0, 7); x.fill(); }
    return c;
  }
};
const detailCache = {};
const detail = kind => {
  if (!detailCache[kind]) { const t = new THREE.CanvasTexture(DETAIL[kind]()); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; detailCache[kind] = t; }
  return detailCache[kind];
};

const texCache = {};
const T = k => (texCache[k] ||= TEX[k]());

const cache = new Map();
// Returns { body, metal, polymer, accent, glow } materials for a skin.
export function skinMats(skin = 'default', accent = 0xff8800) {
  const key = skin + ':' + (skin === 'default' ? accent : '');
  if (cache.has(key)) return cache.get(key);
  const M = (o) => new THREE.MeshStandardMaterial(o);
  const glow = c => M({ color: 0x111111, emissive: c, emissiveIntensity: 1.8 });
  let m;
  switch (skin) {
    case 'carbon':
      m = { body: M({ map: T('carbon'), metalness: 0.4, roughness: 0.3 }), metal: M({ color: 0x3a3e44, metalness: 0.9, roughness: 0.3 }), polymer: M({ map: T('carbon'), metalness: 0.3, roughness: 0.4 }), accent: M({ color: 0x9aa3ad, metalness: 0.8, roughness: 0.25 }), glow: glow(0xffffff) };
      break;
    case 'arctic':
      m = { body: M({ map: T('arctic'), metalness: 0.1, roughness: 0.6 }), metal: M({ color: 0x9aa8b4, metalness: 0.9, roughness: 0.3 }), polymer: M({ map: T('arctic'), metalness: 0.05, roughness: 0.7 }), accent: M({ color: 0x8fd8ff, metalness: 0.3, roughness: 0.4 }), glow: glow(0x6fd3ff) };
      break;
    case 'tiger':
      m = { body: M({ map: T('tiger'), metalness: 0.2, roughness: 0.45 }), metal: M({ color: 0x2a2520, metalness: 0.9, roughness: 0.3 }), polymer: M({ color: 0x141008, metalness: 0.1, roughness: 0.6 }), accent: M({ map: T('tiger'), metalness: 0.2, roughness: 0.4 }), glow: glow(0xff8a1a) };
      break;
    case 'toxic':
      m = { body: M({ map: T('toxic'), metalness: 0.2, roughness: 0.5 }), metal: M({ color: 0x2b3322, metalness: 0.85, roughness: 0.35 }), polymer: M({ color: 0x10140c, metalness: 0.1, roughness: 0.6 }), accent: M({ color: 0x8aff2a, emissive: 0x4aff1a, emissiveIntensity: 0.6, roughness: 0.3 }), glow: glow(0x8aff2a) };
      break;
    case 'ocean':
      m = { body: M({ map: T('ocean'), metalness: 0.5, roughness: 0.25 }), metal: M({ color: 0x9fdcf0, metalness: 1, roughness: 0.2 }), polymer: M({ color: 0x0a2438, metalness: 0.3, roughness: 0.4 }), accent: M({ color: 0x2ff5ff, emissive: 0x16a0c0, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.3 }), glow: glow(0x2ff5ff) };
      break;
    case 'neon':
      m = { body: M({ color: 0x0b0b10, metalness: 0.6, roughness: 0.3, emissiveMap: T('neonGlow'), emissive: 0xffffff, emissiveIntensity: 1.3 }), metal: M({ color: 0x1a1a22, metalness: 0.9, roughness: 0.2 }), polymer: M({ color: 0x08080c, metalness: 0.4, roughness: 0.4 }), accent: M({ color: 0x111111, emissive: 0xff2fa8, emissiveIntensity: 2.2 }), glow: glow(0x2ff5ff) };
      break;
    case 'gold':
      m = { body: M({ color: 0xe0b44a, metalness: 1, roughness: 0.22 }), metal: M({ color: 0xf2d27a, metalness: 1, roughness: 0.15 }), polymer: M({ color: 0x17130c, metalness: 0.3, roughness: 0.5 }), accent: M({ color: 0xfff0b0, metalness: 1, roughness: 0.1 }), glow: glow(0xffc24a) };
      break;
    case 'dragon':
      m = { body: M({ map: T('dragon'), metalness: 0.4, roughness: 0.35, emissiveMap: T('dragonGlow'), emissive: 0xffffff, emissiveIntensity: 1.2 }), metal: M({ color: 0xd8a640, metalness: 1, roughness: 0.2 }), polymer: M({ color: 0x220404, metalness: 0.2, roughness: 0.5 }), accent: M({ color: 0xd8a640, metalness: 1, roughness: 0.2 }), glow: glow(0xff5a1a) };
      break;
    case 'galaxy':
      m = { body: M({ map: T('galaxy'), metalness: 0.3, roughness: 0.25, emissiveMap: T('galaxyStars'), emissive: 0xffffff, emissiveIntensity: 1.6 }), metal: M({ color: 0x3a2a5a, metalness: 0.9, roughness: 0.2 }), polymer: M({ map: T('galaxy'), metalness: 0.2, roughness: 0.4, emissiveMap: T('galaxyStars'), emissive: 0xffffff, emissiveIntensity: 1.2 }), accent: M({ color: 0x111111, emissive: 0xb86bff, emissiveIntensity: 2 }), glow: glow(0xff4ad8) };
      break;
    default:
      m = { body: M({ color: 0x474e58, metalness: 0.7, roughness: 0.34 }), metal: M({ color: 0x9aa2ac, metalness: 0.95, roughness: 0.2 }), polymer: M({ color: 0x24282e, metalness: 0.08, roughness: 0.72 }), accent: M({ color: accent, metalness: 0.35, roughness: 0.32 }), glow: glow(accent) };
  }
  // Surface detail on top of whichever skin: engraved panels on the body, grain on metal, stippling on polymer
  m.body.bumpMap = detail('panel'); m.body.bumpScale = 1.2;
  m.metal.bumpMap = detail('grain'); m.metal.bumpScale = 0.5;
  m.polymer.bumpMap = detail('stipple'); m.polymer.bumpScale = 0.6;
  m.accent.bumpMap = detail('grain'); m.accent.bumpScale = 0.4;
  for (const mat of Object.values(m)) mat.userData.shared = true;
  cache.set(key, m);
  return m;
}
