// Procedural canvas textures (no image files needed).
import * as THREE from 'three';

let seed = 1337;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

// Tileable value noise layer drawn onto a context.
function noise(ctx, size, cell, alpha, light = true) {
  const n = Math.max(1, Math.round(size / cell));
  const g = [];
  for (let i = 0; i < n * n; i++) g.push(rand());
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * n, fy = (y / size) * n;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[(y0 % n) * n + (x0 % n)], b = g[(y0 % n) * n + ((x0 + 1) % n)];
      const c = g[((y0 + 1) % n) * n + (x0 % n)], e = g[((y0 + 1) % n) * n + ((x0 + 1) % n)];
      const v = (a + (b - a) * sx) + ((c + (e - c) * sx) - (a + (b - a) * sx)) * sy;
      const k = (v - 0.5) * 255 * alpha * (light ? 1 : -1);
      const i = (y * size + x) * 4;
      d[i] += k; d[i + 1] += k; d[i + 2] += k;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function grain(ctx, size, amt) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = (rand() - 0.5) * amt;
    d[i] += k; d[i + 1] += k; d[i + 2] += k;
  }
  ctx.putImageData(img, 0, 0);
}

function stains(ctx, size, count, color, maxR) {
  for (let i = 0; i < count; i++) {
    const x = rand() * size, y = rand() * size, r = maxR * (0.3 + rand());
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
    }
  }
}

function finish(c, repeatPerMeter = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.scale = repeatPerMeter; // texture repeats per meter
  return t;
}

const makers = {
  concrete() {
    const S = 512, [c, x] = canvas(S);
    x.fillStyle = '#8a8a86'; x.fillRect(0, 0, S, S);
    noise(x, S, 128, 0.18); noise(x, S, 32, 0.1); grain(x, S, 22);
    stains(x, S, 10, 'rgba(40,36,30,0.18)', 90);
    x.strokeStyle = 'rgba(30,30,30,0.35)'; x.lineWidth = 2;
    x.strokeRect(0, 0, S, S);
    return finish(c, 1 / 4);
  },
  floorTiles() {
    const S = 512, [c, x] = canvas(S);
    x.fillStyle = '#5d5f60'; x.fillRect(0, 0, S, S);
    noise(x, S, 64, 0.12); grain(x, S, 18);
    stains(x, S, 14, 'rgba(20,18,15,0.22)', 70);
    x.strokeStyle = 'rgba(15,15,15,0.55)'; x.lineWidth = 3;
    for (let i = 0; i <= 2; i++) { x.beginPath(); x.moveTo(i * S / 2, 0); x.lineTo(i * S / 2, S); x.stroke(); x.beginPath(); x.moveTo(0, i * S / 2); x.lineTo(S, i * S / 2); x.stroke(); }
    x.fillStyle = 'rgba(230,180,30,0.55)';
    x.fillRect(0, S / 2 - 10, S, 6);
    return finish(c, 1 / 4);
  },
  metal() {
    const S = 256, [c, x] = canvas(S);
    x.fillStyle = '#6f757b'; x.fillRect(0, 0, S, S);
    noise(x, S, 64, 0.1); grain(x, S, 14);
    for (let yy = 0; yy < S; yy += 16) for (let xx = 0; xx < S; xx += 16) {
      x.save(); x.translate(xx + 8 + ((yy / 16) % 2) * 8, yy + 8); x.rotate(Math.PI / 4);
      x.fillStyle = 'rgba(255,255,255,0.13)'; x.fillRect(-5, -1.5, 10, 3);
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(-5, 1.5, 10, 1.5); x.restore();
    }
    stains(x, S, 5, 'rgba(90,50,20,0.2)', 50);
    return finish(c, 1 / 2);
  },
  grate() {
    const S = 256, [c, x] = canvas(S);
    x.fillStyle = '#2b2e31'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#7c8288';
    for (let i = 0; i < S; i += 16) { x.fillRect(i, 0, 4, S); x.fillRect(0, i, S, 3); }
    grain(x, S, 20); stains(x, S, 6, 'rgba(80,40,10,0.25)', 40);
    return finish(c, 1 / 1.5);
  },
  crate() {
    const S = 256, [c, x] = canvas(S);
    x.fillStyle = '#9b6b3a'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 6; i++) {
      x.fillStyle = `hsl(28, ${40 + rand() * 15}%, ${32 + rand() * 10}%)`;
      x.fillRect(0, i * S / 6, S, S / 6 - 3);
    }
    noise(x, S, 8, 0.08); grain(x, S, 25);
    x.fillStyle = '#5b3a1c';
    x.fillRect(0, 0, S, 22); x.fillRect(0, S - 22, S, 22); x.fillRect(0, 0, 22, S); x.fillRect(S - 22, 0, 22, S);
    x.save(); x.translate(S / 2, S / 2); x.rotate(Math.atan2(S, S)); x.fillRect(-S * 0.7, -11, S * 1.4, 22); x.restore();
    x.fillStyle = 'rgba(20,20,20,0.6)'; x.font = 'bold 28px sans-serif'; x.textAlign = 'center';
    x.fillText('FRAGILE', S / 2, S / 2 + 60);
    return finish(c, 0); // 0 = stretch once per face
  },
  container() {
    const S = 256, [c, x] = canvas(S);
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 16) {
      const g = x.createLinearGradient(i, 0, i + 16, 0);
      g.addColorStop(0, '#8a8a8a'); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, '#9a9a9a');
      x.fillStyle = g; x.fillRect(i, 0, 16, S);
    }
    grain(x, S, 16);
    stains(x, S, 8, 'rgba(90,45,15,0.35)', 45);
    return finish(c, 1 / 2.5);
  },
  wall() {
    const S = 512, [c, x] = canvas(S);
    x.fillStyle = '#6b6158'; x.fillRect(0, 0, S, S);
    const bh = 32, bw = 64;
    for (let r = 0; r < S / bh; r++) for (let k = -1; k < S / bw + 1; k++) {
      const ox = (r % 2) * bw / 2;
      x.fillStyle = `hsl(${14 + rand() * 12}, ${20 + rand() * 18}%, ${30 + rand() * 12}%)`;
      x.fillRect(k * bw + ox + 2, r * bh + 2, bw - 4, bh - 4);
    }
    noise(x, S, 64, 0.12); grain(x, S, 22);
    stains(x, S, 8, 'rgba(10,10,10,0.25)', 110);
    return finish(c, 1 / 3);
  },
  tar() {
    const S = 512, [c, x] = canvas(S);
    x.fillStyle = '#34363a'; x.fillRect(0, 0, S, S);
    noise(x, S, 128, 0.12); grain(x, S, 40);
    for (let i = 0; i < 1800; i++) { x.fillStyle = `rgba(${150 + rand() * 60},${150 + rand() * 60},${150 + rand() * 60},${0.2 + rand() * 0.3})`; x.fillRect(rand() * S, rand() * S, 2, 2); }
    stains(x, S, 10, 'rgba(0,0,0,0.3)', 90);
    return finish(c, 1 / 5);
  },
  rock() {
    const S = 512, [c, x] = canvas(S);
    x.fillStyle = '#a0643e'; x.fillRect(0, 0, S, S);
    for (let yy = 0; yy < S; yy += 4) {
      const band = Math.sin(yy * 0.05) * 0.5 + Math.sin(yy * 0.013 + 1) * 0.5;
      x.fillStyle = `rgba(${band > 0 ? 255 : 40},${band > 0 ? 200 : 20},${band > 0 ? 150 : 10},${Math.abs(band) * 0.16})`;
      x.fillRect(0, yy, S, 4);
    }
    noise(x, S, 128, 0.18); noise(x, S, 24, 0.12); grain(x, S, 30);
    x.strokeStyle = 'rgba(40,20,10,0.4)'; x.lineWidth = 2;
    for (let i = 0; i < 16; i++) { x.beginPath(); let px = rand() * S, py = rand() * S; x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (rand() - 0.5) * 60; py += rand() * 30; x.lineTo(px, py); } x.stroke(); }
    return finish(c, 1 / 5);
  },
  sand() {
    const S = 512, [c, x] = canvas(S);
    x.fillStyle = '#cf9a62'; x.fillRect(0, 0, S, S);
    noise(x, S, 128, 0.14); noise(x, S, 16, 0.07); grain(x, S, 30);
    x.strokeStyle = 'rgba(120,70,30,0.12)'; x.lineWidth = 3;
    for (let i = 0; i < 30; i++) { const yy = rand() * S; x.beginPath(); x.moveTo(0, yy); for (let xx = 0; xx <= S; xx += 16) x.lineTo(xx, yy + Math.sin(xx * 0.03 + i) * 6); x.stroke(); }
    return finish(c, 1 / 6);
  },
  planks() {
    const S = 256, [c, x] = canvas(S);
    for (let i = 0; i < 8; i++) {
      x.fillStyle = `hsl(${25 + rand() * 10}, ${35 + rand() * 20}%, ${24 + rand() * 12}%)`;
      x.fillRect(i * S / 8, 0, S / 8 - 2, S);
    }
    x.fillStyle = '#1a1008';
    for (let i = 0; i < 8; i++) x.fillRect(i * S / 8 - 2, 0, 2, S);
    noise(x, S, 8, 0.1); grain(x, S, 26);
    return finish(c, 1 / 2);
  },
  facade() {
    const S = 256, [c, x] = canvas(S);
    x.fillStyle = '#15171d'; x.fillRect(0, 0, S, S);
    for (let r = 0; r < 8; r++) for (let k = 0; k < 8; k++) {
      const lit = rand() < 0.45;
      x.fillStyle = lit ? `hsl(${35 + rand() * 25}, 80%, ${55 + rand() * 25}%)` : '#0b0d12';
      x.fillRect(k * 32 + 6, r * 32 + 8, 20, 18);
    }
    return finish(c, 1 / 12);
  },
  pad() {
    const S = 128, [c, x] = canvas(S);
    x.fillStyle = '#20252b'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#39ff8a';
    x.fillRect(S / 2 - 12, 20, 24, S - 40); x.fillRect(20, S / 2 - 12, S - 40, 24);
    return finish(c, 0);
  }
};

const cache = {};
export function tex(name) {
  if (!cache[name]) cache[name] = makers[name]();
  return cache[name];
}

// Rounded-rect helper for canvas UI sprites.
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
