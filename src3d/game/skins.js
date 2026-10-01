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
  // Fire Flame bundle: charred black dragon scales, molten light in the gaps between them
  fireScales: () => tex((x, S) => {
    x.fillStyle = '#1a0604'; x.fillRect(0, 0, S, S);
    const s = 18;
    for (let j = 0; j < S / (s * 0.7) + 2; j++) for (let i = 0; i < S / s + 2; i++) {
      const cx = i * s + (j % 2) * s / 2, cy = j * s * 0.7;
      const g = x.createRadialGradient(cx, cy - 5, 1, cx, cy, s * 0.62);
      g.addColorStop(0, '#4a1a12'); g.addColorStop(0.6, '#2a0c08'); g.addColorStop(1, '#120403');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, s * 0.56, 0, Math.PI); x.fill();
      x.strokeStyle = 'rgba(200,110,40,0.35)'; x.lineWidth = 1; x.stroke();
    }
  }),
  fireScalesGlow: () => tex((x, S) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    const s = 18;
    x.strokeStyle = '#ff6a10'; x.lineWidth = 2.2;
    for (let j = 0; j < S / (s * 0.7) + 2; j++) for (let i = 0; i < S / s + 2; i++) {
      const cx = i * s + (j % 2) * s / 2, cy = j * s * 0.7;
      x.globalAlpha = 0.35 + rnd() * 0.65; x.beginPath(); x.arc(cx, cy, s * 0.56, 0, Math.PI); x.stroke();
    }
    x.globalAlpha = 1;
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
  }),
  // ---- Valorant-inspired lines (original designs)
  // Revenant: blackened steel with silver filigree, a soul glow in the seams
  revenant: () => tex((x, S) => {
    const g = x.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#1d1e24'); g.addColorStop(0.5, '#121318'); g.addColorStop(1, '#1b1c22');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.strokeStyle = '#07080a'; x.lineWidth = 3;
    for (let y = 0; y <= S; y += 64) { x.beginPath(); x.moveTo(0, y); x.lineTo(S, y); x.stroke(); }
    x.strokeStyle = 'rgba(176,180,192,0.75)'; x.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const cx = i * 64 + 32, cy = j * 64 + 32, f = (i + j) % 2 ? 1 : -1;
      x.beginPath(); x.moveTo(cx - 26, cy + 10);
      x.bezierCurveTo(cx - 10, cy - 22 * f, cx + 8, cy + 18 * f, cx + 26, cy - 8);
      x.stroke();
      x.beginPath(); x.arc(cx - 26, cy + 10, 4, 0, Math.PI * 1.6); x.stroke();
      x.beginPath(); x.arc(cx + 26, cy - 8, 4, Math.PI, Math.PI * 2.6); x.stroke();
    }
    x.fillStyle = '#8a8d96';
    for (let i = 0; i < 4; i++) for (const y of [6, 58]) { x.beginPath(); x.arc(i * 64 + 32, y + Math.floor(i / 2) * 0, 2, 0, 7); x.fill(); }
  }),
  revenantGlow: () => tex((x, S) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    x.strokeStyle = '#ff1f5a'; x.lineWidth = 2;
    for (let y = 0; y <= S; y += 64) { x.beginPath(); x.moveTo(0, y + 2); x.lineTo(S, y + 2); x.stroke(); }
    x.fillStyle = '#c21cff';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.beginPath(); x.arc(i * 64 + 6, j * 64 + 42, 2.5, 0, 7); x.fill(); x.beginPath(); x.arc(i * 64 + 58, j * 64 + 24, 2.5, 0, 7); x.fill(); }
  }),
  // Paragon: ivory armor plates with gold pinstripes and cyan light strips
  paragon: () => tex((x, S) => {
    x.fillStyle = '#d6cfbd'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) { const v = 215 + rnd() * 25; x.fillStyle = `rgba(${v},${v - 6},${v - 18},0.5)`; x.fillRect(rnd() * S, rnd() * S, 2, 2); }
    x.strokeStyle = '#b9b2a2'; x.lineWidth = 2;
    for (let y = 0; y <= S; y += 64) { x.beginPath(); x.moveTo(0, y); x.lineTo(S, y); x.stroke(); }
    for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(i * 64 + 40, 0); x.lineTo(i * 64 + 40, 64); x.stroke(); x.beginPath(); x.moveTo(i * 64 + 12, 128); x.lineTo(i * 64 + 12, 192); x.stroke(); }
    x.strokeStyle = '#c9a54a'; x.lineWidth = 3;
    for (let y = 22; y < S; y += 64) { x.beginPath(); x.moveTo(0, y); x.lineTo(S, y); x.stroke(); }
    x.lineWidth = 2;
    for (let i = 0; i < S; i += 32) { x.beginPath(); x.moveTo(i, 40); x.lineTo(i + 16, 50); x.lineTo(i + 32, 40); x.stroke(); }
  }),
  paragonGlow: () => tex((x, S) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#4ff0ff';
    for (let y = 30; y < S; y += 64) x.fillRect(0, y, S, 3);
    for (let i = 0; i < S; i += 32) x.fillRect(i + 12, 92, 8, 8);
  }),
  // Hannya: red lacquer mended with gold seams
  hannya: () => tex((x, S) => {
    const g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#a3121a'); g.addColorStop(0.45, '#7a0b12'); g.addColorStop(0.55, '#c0242a'); g.addColorStop(1, '#5c070c');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgba(0,0,0,0.85)';
    for (let i = 0; i < 4; i++) { const cx = i * 64 + 32, cy = 200; x.beginPath(); x.arc(cx, cy, 18, Math.PI, 0); x.arc(cx + 9, cy, 9, 0, Math.PI); x.arc(cx - 9, cy, 9, 0, Math.PI, true); x.fill(); }
    x.strokeStyle = '#e8b84a'; x.lineWidth = 2.4;
    hannyaCracks(S).forEach(path => { x.beginPath(); path.forEach(([px, py], k) => (k ? x.lineTo(px, py) : x.moveTo(px, py))); x.stroke(); });
  }),
  hannyaGlow: () => tex((x, S) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    x.strokeStyle = '#ff9a2a'; x.lineWidth = 2;
    hannyaCracks(S).forEach(path => { x.beginPath(); path.forEach(([px, py], k) => (k ? x.lineTo(px, py) : x.moveTo(px, py))); x.stroke(); });
  }),
  // Ion Drive: white composite with angular blue energy circuits
  ion: () => tex((x, S) => {
    x.fillStyle = '#c9d0d9'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#b3bcc7';
    for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64 + 40, 0); x.lineTo(i * 64 + 64, 32); x.lineTo(i * 64 + 24, 32); x.fill(); }
    x.strokeStyle = '#b9c2cd'; x.lineWidth = 2;
    for (const [a, b, c, d] of ionCircuit(S)) { x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); }
    x.fillStyle = '#23262c'; x.fillRect(0, 120, S, 16);
  }),
  ionGlow: () => tex((x, S) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    x.strokeStyle = '#3aa8ff'; x.lineWidth = 2.5;
    for (const [a, b, c, d] of ionCircuit(S)) { x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); }
    x.fillStyle = '#7fe0ff'; x.fillRect(0, 126, S, 4);
  }),
  // Chroma: dark alloy with light strips the shader runs through the whole spectrum
  chroma: () => tex((x, S) => {
    x.fillStyle = '#16171c'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#1f2128';
    for (let i = -S; i < S * 2; i += 48) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 24, 0); x.lineTo(i + 24 + S * 0.5, S); x.lineTo(i + S * 0.5, S); x.fill(); }
    x.fillStyle = '#0c0d10';
    for (let y = 0; y < S; y += 64) x.fillRect(0, y, S, 6);
  }),
  chromaGlow: () => tex((x, S) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#fff';
    for (let y = 0; y < S; y += 64) x.fillRect(0, y + 2, S, 2);
    x.strokeStyle = '#fff'; x.lineWidth = 2;
    for (let i = 0; i < S; i += 64) { x.beginPath(); x.moveTo(i + 8, 40); x.lineTo(i + 32, 24); x.lineTo(i + 56, 40); x.stroke(); }
  }),
  // Event Horizon: near-black void with a few hard stars; the shader adds the spiral
  horizon: () => tex((x, S) => {
    const g = x.createRadialGradient(S * 0.5, S * 0.5, 4, S * 0.5, S * 0.5, S * 0.75);
    g.addColorStop(0, '#1a0a2e'); g.addColorStop(0.6, '#0a0614'); g.addColorStop(1, '#040208');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 4; i++) { const n = x.createRadialGradient(rnd() * S, rnd() * S, 0, rnd() * S, rnd() * S, 50 + rnd() * 50); n.addColorStop(0, 'rgba(120,40,200,0.25)'); n.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = n; x.fillRect(0, 0, S, S); }
  }),
  horizonStars: () => tex((x, S) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 140; i++) { const b = 170 + rnd() * 85; x.fillStyle = rnd() < 0.3 ? `rgb(${b},${b * 0.6},255)` : `rgb(${b},${b},${b})`; x.fillRect(rnd() * S, rnd() * S, rnd() < 0.12 ? 2 : 1, rnd() < 0.12 ? 2 : 1); }
  }),
  // Abyssal Tide: black lacquer with overlapping wave scales in deep blue
  tide: () => tex((x, S) => {
    x.fillStyle = '#0a0d14'; x.fillRect(0, 0, S, S);
    seigaiha(x, S, (k) => `rgba(${30 + k * 6},${50 + k * 10},${90 + k * 18},0.9)`, 1.6);
  }),
  tideGlow: () => tex((x, S) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    seigaiha(x, S, (k) => (k === 0 ? 'rgba(60,150,255,0.95)' : 'rgba(0,0,0,0)'), 2);
  }),
  // Arcade: pastel 8-bit pixels
  arcade: () => tex((x, S) => {
    const P = 16, cols = ['#4fb3a6', '#e8749a', '#e8b84f', '#8466e0', '#e3d6b4'];
    x.fillStyle = '#e3d6b4'; x.fillRect(0, 0, S, S);
    for (let j = 0; j < S / P; j++) for (let i = 0; i < S / P; i++) if (rnd() < 0.42) { x.fillStyle = cols[Math.floor(rnd() * 4)]; x.fillRect(i * P, j * P, P, P); }
    const heart = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
    for (const [ox, oy] of [[16, 16], [144, 112], [64, 192]]) heart.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'X') { x.fillStyle = '#e8336b'; x.fillRect(ox + c * 4, oy + r * 4, 4, 4); } }));
    x.strokeStyle = 'rgba(0,0,0,0.12)'; x.lineWidth = 1;
    for (let i = 0; i <= S; i += P) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, S); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(S, i); x.stroke(); }
  }, 256, 1)
};
// Gold kintsugi seams for Hannya (same paths in the color map and the glow map)
let crackCache = null;
function hannyaCracks(S) {
  if (crackCache) return crackCache;
  let cs = 777; const r = () => ((cs = (cs * 16807) % 2147483647) / 2147483647);
  const paths = [];
  for (let i = 0; i < 7; i++) {
    let px = r() * S, py = r() * S; const path = [[px, py]];
    let a = r() * Math.PI * 2;
    for (let k = 0; k < 9; k++) {
      a += (r() - 0.5) * 1.2; px += Math.cos(a) * (10 + r() * 16); py += Math.sin(a) * (10 + r() * 16); path.push([px, py]);
      if (r() < 0.25) { const b = a + (r() < 0.5 ? 1 : -1) * (0.8 + r() * 0.6); paths.push([[px, py], [px + Math.cos(b) * 18, py + Math.sin(b) * 18], [px + Math.cos(b) * 30 + 6, py + Math.sin(b) * 30]]); }
    }
    paths.push(path);
  }
  return (crackCache = paths);
}
// Angular circuit traces for Ion Drive
function ionCircuit(S) {
  const segs = [];
  for (let i = 0; i < 4; i++) {
    const x0 = i * 64 + 8;
    segs.push([x0, 48, x0 + 24, 48], [x0 + 24, 48, x0 + 40, 64], [x0 + 40, 64, x0 + 56, 64]);
    segs.push([x0, 176, x0 + 16, 160], [x0 + 16, 160, x0 + 48, 160], [x0 + 48, 160, x0 + 56, 168]);
    segs.push([x0 + 30, 200, x0 + 30, 240], [x0 + 30, 240, x0 + 50, 240]);
  }
  return segs;
}
// Overlapping wave scales (seigaiha); color(k) styles the k-th ring counting from the outside
function seigaiha(x, S, color, lw) {
  const R = 32;
  for (let j = 0; j <= S / (R / 2) + 1; j++) for (let i = -1; i <= S / R + 1; i++) {
    const cx = i * R + (j % 2) * R / 2, cy = j * R / 2;
    x.fillStyle = '#0a0d14'; x.beginPath(); x.arc(cx, cy, R / 2, Math.PI, 0); x.fill();
    for (let k = 0; k < 4; k++) { x.strokeStyle = color(k); x.lineWidth = lw; x.beginPath(); x.arc(cx, cy, R / 2 - k * 4 - 1, Math.PI, 0); x.stroke(); }
  }
}

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

// ---------------------------------------------------------------- animated skins
// One clock for every animated skin; tickSkins(dt) runs from the main loop. skinBurst() makes them flare
// (inspect, and the Inspect button in the store and locker).
const SKIN_TIME = { value: 0 }, SKIN_BURST = { value: 0 };
export function tickSkins(dt) { SKIN_TIME.value += dt; SKIN_BURST.value = Math.max(0, SKIN_BURST.value - dt * 0.7); }
export function skinBurst(v = 1) { SKIN_BURST.value = Math.max(SKIN_BURST.value, v); }
const ANIM_GLSL = {
  // Pink and cyan scan bands sweep along the gun while blocks of the surface glitch in and out
  glitch: `
    vec3 q = vAPos * 22.0;
    float ax = dot(vAPos, vec3(0.35, 0.55, 1.0)) * 14.0;
    float band = pow(0.5 + 0.5 * sin(ax - uTime * 5.0), 18.0);
    float band2 = pow(0.5 + 0.5 * sin(ax * 0.37 + uTime * 2.3), 30.0);
    vec3 cell = floor(q * vec3(0.9, 2.2, 0.6));
    float h = fract(sin(dot(cell + floor(uTime * 7.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float blk = step(0.955 - 0.08 * uBurst, h);
    vec3 pink = vec3(1.0, 0.18, 0.62), cyan = vec3(0.15, 0.95, 1.0);
    vec3 gc = mix(pink, cyan, step(0.5, fract(h * 7.0)));
    float lines = step(0.92, fract(q.y * 1.6 + uTime * 0.8)) * 0.35;
    totalEmissiveRadiance += (mix(pink, cyan, 0.5 + 0.5 * sin(ax * 0.2 + uTime)) * (band * 1.4 + band2 * 1.1 + lines) + gc * blk * 1.8) * (1.0 + uBurst * 2.5);`,
  // Liquid energy flowing down the body
  plasma: `
    vec3 q = vAPos * 11.0;
    float f = sin(q.z * 2.1 + uTime * 2.6 + sin(q.y * 4.3 - uTime * 1.7) * 1.6) * sin(q.x * 3.3 - uTime * 1.9 + q.z * 1.2 + sin(q.y * 2.0 + uTime) );
    float vein = smoothstep(0.72, 1.0, abs(f));
    float pulse = 0.5 + 0.5 * sin(uTime * 3.0 - q.z * 0.8);
    vec3 c = mix(vec3(0.35, 0.1, 1.0), vec3(0.1, 0.85, 1.0), pulse);
    totalEmissiveRadiance += c * (vein * 2.6 + 0.12) * (1.0 + uBurst * 3.0);`,
  // Fire Flame: embers breathing in the gaps between the scales, a slow wave of heat running along the body
  ember: `
    float w = 0.5 + 0.5 * sin(vAPos.z * 38.0 - uTime * 3.2 + sin(vAPos.y * 55.0 + uTime * 1.7) * 1.4);
    totalEmissiveRadiance *= (0.25 + 1.6 * w) * (1.0 + uBurst * 3.0);
    totalEmissiveRadiance += vec3(1.0, 0.32, 0.03) * pow(max(0.0, sin(vAPos.z * 18.0 - uTime * 5.0)), 16.0) * (0.6 + uBurst * 2.0);`,
  // Revenant: a slow soul pulse runs down the seams, with a faint flicker
  soul: `
    float w = pow(0.5 + 0.5 * sin(vAPos.z * 14.0 - uTime * 2.2), 4.0);
    float flick = 0.85 + 0.15 * sin(uTime * 17.0 + vAPos.y * 40.0);
    totalEmissiveRadiance *= (0.3 + 1.8 * w) * flick * (1.0 + uBurst * 2.5);
    totalEmissiveRadiance += vec3(0.5, 0.02, 0.2) * w * 0.12 * (1.0 + uBurst * 4.0);`,
  // Paragon: a bright scan travels along the light strips
  scan: `
    float b = pow(0.5 + 0.5 * sin(dot(vAPos, vec3(0.15, 0.35, 1.0)) * 9.0 - uTime * 3.5), 14.0);
    totalEmissiveRadiance *= 0.55 + 2.4 * b + uBurst * 2.0;`,
  // Ion Drive: fast energy pulses through the circuits, with sparks jumping off them
  ion: `
    float lit = step(0.04, dot(totalEmissiveRadiance, vec3(0.333)));
    float b = pow(0.5 + 0.5 * sin(dot(vAPos, vec3(0.2, 0.3, 1.0)) * 12.0 - uTime * 6.0), 10.0);
    vec3 cell = floor(vAPos * 60.0);
    float h = fract(sin(dot(cell + floor(uTime * 12.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    totalEmissiveRadiance *= 0.6 + 2.6 * b + uBurst * 2.0;
    totalEmissiveRadiance += vec3(0.35, 0.75, 1.0) * step(0.97 - 0.05 * uBurst, h) * lit * 2.0;`,
  // Chroma: light strips cycle through every color, flowing along the gun
  chroma: `
    float hue = vAPos.z * 3.0 + vAPos.y * 2.0 - uTime * 0.35;
    vec3 hc = 0.5 + 0.5 * cos(6.28318 * (hue + vec3(0.0, 0.33, 0.67)));
    totalEmissiveRadiance = hc * dot(totalEmissiveRadiance, vec3(0.3333)) * (1.5 + uBurst * 3.0);`,
  // Event Horizon: a spiral of violet light winds into the middle of the gun while the stars twinkle
  vortex: `
    vec2 d = vAPos.zy - vec2(-0.05, 0.0);
    float r = length(d), a = atan(d.y, d.x);
    float arms = pow(0.5 + 0.5 * sin(a * 3.0 - log(r + 0.02) * 6.0 + uTime * 2.5), 6.0);
    float fade = smoothstep(0.02, 0.07, r) * (1.0 - smoothstep(0.25, 0.6, r));
    totalEmissiveRadiance *= 0.6 + 0.5 * sin(uTime * 3.0 + vAPos.z * 90.0);
    totalEmissiveRadiance += mix(vec3(0.4, 0.08, 1.0), vec3(1.0, 0.35, 0.85), arms) * arms * fade * (0.9 + uBurst * 3.0);`,
  // Abyssal Tide: wave crests shimmer across the scales
  tide: `
    float w = sin(vAPos.z * 30.0 + sin(vAPos.y * 26.0 + uTime * 1.3) * 1.8 - uTime * 2.2);
    float crest = smoothstep(0.55, 1.0, w);
    totalEmissiveRadiance *= 0.35 + 1.5 * crest + uBurst * 2.0;
    totalEmissiveRadiance += vec3(0.05, 0.3, 0.85) * crest * 0.12 * (1.0 + uBurst * 3.0);`,
  // Flames licking up the sides
  inferno: `
    vec3 q = vAPos * 16.0;
    float n = sin(q.x * 3.1 + sin(q.y * 2.0 - uTime * 5.0) * 1.3) + sin(q.z * 2.3 - uTime * 3.7 + q.y * 1.5) + 0.6 * sin(q.y * 5.0 - uTime * 9.0 + q.z);
    float fl = smoothstep(0.2, 1.7, n + (1.0 - fract(q.y * 0.25 - uTime * 0.9)) * 0.8);
    vec3 c = mix(vec3(1.0, 0.16, 0.0), vec3(1.0, 0.78, 0.22), fl * fl);
    totalEmissiveRadiance += c * (fl * 3.4 + 0.08) * (1.0 + uBurst * 2.5);`,
};
function animate(mat, kind) {
  mat.userData.animated = kind;
  mat.customProgramCacheKey = () => 'rl-anim-' + kind;
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = SKIN_TIME; sh.uniforms.uBurst = SKIN_BURST;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vAPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAPos = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vAPos;\nuniform float uTime;\nuniform float uBurst;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + ANIM_GLSL[kind]);
  };
  return mat;
}

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
    case 'fireflame': {
      m = { body: animate(M({ map: T('fireScales'), metalness: 0.35, roughness: 0.42, emissiveMap: T('fireScalesGlow'), emissive: 0xffffff, emissiveIntensity: 1.5 }), 'ember'),
        metal: M({ color: 0x8a5a1c, metalness: 1, roughness: 0.28 }), polymer: M({ map: T('fireScales'), metalness: 0.2, roughness: 0.6 }),
        accent: M({ color: 0xc8902a, metalness: 1, roughness: 0.22 }), glow: glow(0xff5a0a) };
      // Wing membranes: thin, lit from behind, both sides visible
      m.wing = animate(M({ map: T('fireScales'), color: 0x9a4a30, metalness: 0.1, roughness: 0.6, emissiveMap: T('fireScalesGlow'), emissive: 0xff7a30, emissiveIntensity: 0.9, side: THREE.DoubleSide }), 'ember');
      m.horn = M({ color: 0x2a1a12, metalness: 0.3, roughness: 0.35 });
      m.bone = M({ color: 0xe8dcc0, metalness: 0.05, roughness: 0.45 });
      break;
    }
    case 'glitch':
      m = { body: animate(M({ color: 0x1a1426, metalness: 0.55, roughness: 0.28 }), 'glitch'), metal: M({ color: 0xc9c2d8, metalness: 1, roughness: 0.18 }), polymer: animate(M({ color: 0x0d0a14, metalness: 0.3, roughness: 0.4 }), 'glitch'), accent: M({ color: 0x111111, emissive: 0xff2f9a, emissiveIntensity: 2.2 }), glow: glow(0x2ff0ff) };
      break;
    case 'plasma':
      m = { body: animate(M({ color: 0x0b0e2a, metalness: 0.6, roughness: 0.22 }), 'plasma'), metal: M({ color: 0x8fa0ff, metalness: 1, roughness: 0.15 }), polymer: M({ color: 0x07081a, metalness: 0.3, roughness: 0.4 }), accent: animate(M({ color: 0x14163a, metalness: 0.7, roughness: 0.2 }), 'plasma'), glow: glow(0x6a5cff) };
      break;
    case 'inferno':
      m = { body: animate(M({ color: 0x1c0d08, metalness: 0.45, roughness: 0.4 }), 'inferno'), metal: M({ color: 0x3a2a22, metalness: 0.9, roughness: 0.3 }), polymer: M({ color: 0x120806, metalness: 0.2, roughness: 0.55 }), accent: animate(M({ color: 0x2a1208, metalness: 0.8, roughness: 0.25 }), 'inferno'), glow: glow(0xff6a10) };
      break;
    case 'revenant':
      m = { body: animate(M({ map: T('revenant'), metalness: 0.75, roughness: 0.3, emissiveMap: T('revenantGlow'), emissive: 0xffffff, emissiveIntensity: 1.6 }), 'soul'), metal: M({ color: 0xb4b8c4, metalness: 1, roughness: 0.18 }), polymer: M({ color: 0x0d0e12, metalness: 0.3, roughness: 0.5 }), accent: M({ color: 0x111111, emissive: 0xff1f5a, emissiveIntensity: 2 }), glow: glow(0xc21cff) };
      break;
    case 'paragon':
      m = { body: animate(M({ map: T('paragon'), metalness: 0.2, roughness: 0.45, emissiveMap: T('paragonGlow'), emissive: 0xffffff, emissiveIntensity: 1.4 }), 'scan'), metal: M({ color: 0xd9b45a, metalness: 1, roughness: 0.16 }), polymer: M({ color: 0x2a2620, metalness: 0.2, roughness: 0.5 }), accent: M({ color: 0xe7c46a, metalness: 1, roughness: 0.14 }), glow: glow(0x4ff0ff) };
      break;
    case 'hannya':
      m = { body: M({ map: T('hannya'), metalness: 0.15, roughness: 0.16, emissiveMap: T('hannyaGlow'), emissive: 0xffffff, emissiveIntensity: 0.45 }), metal: M({ color: 0x1a1214, metalness: 0.8, roughness: 0.25 }), polymer: M({ color: 0x0c0809, metalness: 0.15, roughness: 0.2 }), accent: M({ color: 0xe8b84a, metalness: 1, roughness: 0.18 }), glow: glow(0xff3a2a) };
      break;
    case 'ion':
      m = { body: animate(M({ map: T('ion'), metalness: 0.15, roughness: 0.5, emissiveMap: T('ionGlow'), emissive: 0xffffff, emissiveIntensity: 1.5 }), 'ion'), metal: M({ color: 0x2a2f38, metalness: 0.9, roughness: 0.25 }), polymer: M({ color: 0xaeb7c2, metalness: 0.1, roughness: 0.55 }), accent: M({ color: 0x111111, emissive: 0x3aa8ff, emissiveIntensity: 2.4 }), glow: glow(0x7fe0ff) };
      break;
    case 'chroma':
      m = { body: animate(M({ map: T('chroma'), metalness: 0.7, roughness: 0.26, emissiveMap: T('chromaGlow'), emissive: 0xffffff, emissiveIntensity: 1 }), 'chroma'), metal: M({ color: 0x2c2f36, metalness: 1, roughness: 0.2 }), polymer: M({ color: 0x0f1013, metalness: 0.3, roughness: 0.45 }), accent: animate(M({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 1 }), 'chroma'), glow: animate(M({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 1.2 }), 'chroma') };
      break;
    case 'horizon':
      m = { body: animate(M({ map: T('horizon'), metalness: 0.5, roughness: 0.22, emissiveMap: T('horizonStars'), emissive: 0xffffff, emissiveIntensity: 1.6 }), 'vortex'), metal: M({ color: 0x2a1f3a, metalness: 1, roughness: 0.15 }), polymer: M({ map: T('horizon'), metalness: 0.2, roughness: 0.4, emissiveMap: T('horizonStars'), emissive: 0xffffff, emissiveIntensity: 1.1 }), accent: M({ color: 0x111111, emissive: 0x9a3cff, emissiveIntensity: 2.2 }), glow: glow(0xff5ad8) };
      break;
    case 'tide':
      m = { body: animate(M({ map: T('tide'), metalness: 0.4, roughness: 0.2, emissiveMap: T('tideGlow'), emissive: 0xffffff, emissiveIntensity: 1.3 }), 'tide'), metal: M({ color: 0x1c2434, metalness: 1, roughness: 0.2 }), polymer: M({ color: 0x080a10, metalness: 0.2, roughness: 0.3 }), accent: M({ color: 0x9fb4d8, metalness: 1, roughness: 0.15 }), glow: glow(0x2a8cff) };
      break;
    case 'arcade':
      m = { body: M({ map: T('arcade'), metalness: 0.05, roughness: 0.65 }), metal: M({ color: 0xcfc3a2, metalness: 0.1, roughness: 0.6 }), polymer: M({ color: 0x4fb3a6, metalness: 0.05, roughness: 0.65 }), accent: M({ color: 0xe8749a, metalness: 0.05, roughness: 0.5 }), glow: glow(0xff5aa0) };
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
