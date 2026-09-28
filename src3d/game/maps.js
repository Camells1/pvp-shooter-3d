// 3D arenas built from textured boxes. Every collider is an axis-aligned box.
import * as THREE from 'three';
import { tex } from './textures.js';
import { World } from './physics.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Grid, LAYOUTS } from './layouts.js';

const MAT_DEFS = {
  concrete: { rough: 0.92, metal: 0.0 },
  floorTiles: { rough: 0.8, metal: 0.05 },
  metal: { rough: 0.45, metal: 0.6 },
  grate: { rough: 0.55, metal: 0.55 },
  crate: { rough: 0.85, metal: 0.0 },
  container: { rough: 0.55, metal: 0.35 },
  wall: { rough: 0.9, metal: 0.0 },
  tar: { rough: 0.95, metal: 0.0 },
  rock: { rough: 0.95, metal: 0.0 },
  sand: { rough: 1.0, metal: 0.0 },
  planks: { rough: 0.85, metal: 0.0 },
  facade: { rough: 0.6, metal: 0.2, emissive: true },
  pad: { rough: 0.6, metal: 0.2, emissive: true }
};

const matCache = new Map();
function material(name, tint) {
  const key = name + ':' + (tint ?? '');
  if (matCache.has(key)) return matCache.get(key);
  const def = MAT_DEFS[name];
  const t = tex(name);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: def.rough, metalness: def.metal, color: tint ?? 0xffffff });
  if (def.emissive) { m.emissiveMap = t; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 1.1; }
  matCache.set(key, m);
  return m;
}

// Box geometry with world-space UVs so textures line up across neighbours and never stretch.
function boxGeo(w, h, d, cx, cy, cz, scale) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (!scale) return g;
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, y = pos.getY(i) + cy, z = pos.getZ(i) + cz;
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    let u, v;
    if (nx > 0.5) { u = z; v = y; } else if (ny > 0.5) { u = x; v = z; } else { u = x; v = y; }
    uv.setXY(i, u * scale, v * scale);
  }
  return g;
}

// Builds a map. `S` spreads the layout out horizontally: positions scale by S, and so do
// structures longer than 3.5m (floors, walls, catwalks), while props (crates, pillars) keep their size.
class Builder {
  constructor(S = 1) {
    this.S = S;
    this.group = new THREE.Group();
    this.boxes = [];
  }
  span(a, b) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const c = (lo + hi) / 2 * this.S;
    const w = (hi - lo) >= 3.5 ? (hi - lo) * this.S : hi - lo;
    return [c - w / 2, c + w / 2];
  }
  p(v) { return v * this.S; }
  box(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    let ax, bx, az, bz;
    if (o.raw) { [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)]; [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)]; }
    else { [ax, bx] = this.span(x0, x1); [az, bz] = this.span(z0, z1); }
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const w = bx - ax, h = by - ay, d = bz - az;
    const cx = (ax + bx) / 2, cy = (ay + by) / 2, cz = (az + bz) / 2;
    if (mat) {
      const m = material(mat, o.tint);
      const mesh = new THREE.Mesh(boxGeo(w, h, d, cx, cy, cz, tex(mat).userData.scale), m);
      mesh.position.set(cx, cy, cz);
      mesh.castShadow = o.shadow !== false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    if (!o.deco) this.boxes.push({ min: { x: ax, y: ay, z: az }, max: { x: bx, y: by, z: bz }, noWalk: !!o.noWalk });
  }
  // Adds a box and its point-mirror around the origin (fair for both spawns).
  sym(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    this.box(x0, y0, z0, x1, y1, z1, mat, o);
    this.box(-x0, y0, -z0, -x1, y1, -z1, mat, o);
  }
  // Solid staircase. Rises toward `dir` ('+x','-x','+z','-z') across the footprint.
  stairs(x0, z0, x1, z1, y0, y1, dir, mat, mirror = false) {
    const [ax, bx] = this.span(x0, x1), [az, bz] = this.span(z0, z1);
    const n = Math.ceil((y1 - y0) / 0.3), rise = (y1 - y0) / n;
    const along = dir[1] === 'x' ? bx - ax : bz - az, run = along / n;
    for (let i = 0; i < n; i++) {
      const top = y0 + rise * (i + 1);
      let sx0 = ax, sx1 = bx, sz0 = az, sz1 = bz;
      if (dir === '+x') sx0 = ax + run * i;
      if (dir === '-x') sx1 = bx - run * i;
      if (dir === '+z') sz0 = az + run * i;
      if (dir === '-z') sz1 = bz - run * i;
      (mirror ? this.sym : this.box).call(this, sx0, y0, sz0, sx1, top, sz1, mat, { raw: true });
    }
  }
  deco(obj) { this.group.add(obj); return obj; }
  // Merge static meshes that share a material into one draw call each
  finish() {
    const buckets = new Map();
    for (const m of [...this.group.children]) {
      if (!m.isMesh || m.userData.keep || !m.geometry.attributes.uv || !m.geometry.attributes.normal) continue;
      const key = m.material.uuid + '|' + m.castShadow + '|' + (m.geometry.index ? 1 : 0);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(m);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = list.map(m => {
        m.updateMatrix();
        const g = m.geometry.clone().applyMatrix4(m.matrix);
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        g.clearGroups();
        return g;
      });
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list[0].castShadow; mesh.receiveShadow = true;
      for (const m of list) { this.group.remove(m); m.geometry.dispose(); }
      this.group.add(mesh);
    }
  }
}

// ---------------------------------------------------------------- Sky
function skyDome(top, bottom, opts = {}) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) }, sunDir: { value: new THREE.Vector3(...(opts.sun || [0, 1, 0])).normalize() }, sunCol: { value: new THREE.Color(opts.sunColor ?? 0xffffff) }, sunAmt: { value: opts.sunAmt ?? 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunAmt; varying vec3 vD;
      void main(){ float h = clamp(vD.y*1.4+0.25, 0.0, 1.0); vec3 c = mix(bottom, top, pow(h, 0.8));
        float s = max(dot(vD, sunDir), 0.0); c += sunCol * (pow(s, 600.0)*4.0 + pow(s, 12.0)*0.35) * sunAmt;
        gl_FragColor = vec4(c, 1.0); }`,
    side: THREE.BackSide, depthWrite: false, fog: false
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), mat);
  dome.renderOrder = -10;
  g.add(dome);
  if (opts.stars) {
    const n = 1500, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.random() * 0.9 + 0.08;
      const r = 430;
      p[i * 3] = Math.cos(u) * Math.cos(v * Math.PI / 2) * r; p[i * 3 + 1] = Math.sin(v * Math.PI / 2) * r; p[i * 3 + 2] = Math.sin(u) * Math.cos(v * Math.PI / 2) * r;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
  }
  return g;
}

function lamp(B, x, y, z, color, light = true, intensity = 30) {
  x = B.p(x); z = B.p(z);
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 4 }));
  m.position.set(x, y, z); B.deco(m);
  const hous = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.7), new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.7, roughness: 0.4 }));
  hous.position.set(x, y + 0.15, z); B.deco(hous);
  if (light) { const l = new THREE.PointLight(color, intensity, 26, 1.6); l.position.set(x, y - 0.4, z); B.deco(l); }
}

function plant(B, x, z) {
  // Potted shrub (deco + small collider)
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.7, 12), new THREE.MeshStandardMaterial({ color: 0xb0643a, roughness: 0.9 }));
  pot.position.set(x, 0.35, z); pot.castShadow = true; B.deco(pot);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.8, flatShading: true }));
  leaves.position.set(x, 1.25, z); leaves.castShadow = true; B.deco(leaves);
  B.box(x - 0.45, 0, z - 0.45, x + 0.45, 1.6, z + 0.45, null, { raw: true });
}

// ---------------------------------------------------------------- Layout maps
// Every competitive map is carved from a 30x22 grid of 4m cells (see layouts.js): 120m x 88m,
// attackers west, defenders east, A site north, B site south.
const CELL = 4, COLS = 30, ROWS = 22, PLAT = 2.4;
const X0 = c => (c - COLS / 2) * CELL;         // west edge of column c
const Z1 = r => (ROWS / 2 - r) * CELL;         // north edge of row r (rows run north -> south, z decreases)
const center = (c, r) => [X0(c) + CELL / 2, Z1(r) - CELL / 2];
const rectXZ = ([c0, r0, c1, r1]) => [X0(c0), Z1(r1 + 1), X0(c1 + 1), Z1(r0)];

const hash = (c, r, k = 0) => {
  let h = (c * 374761393 + r * 668265263 + k * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const seeded = seed => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

// Greedy rectangle cover of all cells matching `pred` (fewer, bigger boxes).
function rects(G, pred, maxW = 99, maxH = 99) {
  const used = new Set(), out = [];
  const ok = (c, r) => c >= 0 && r >= 0 && c < G.cols && r < G.rows && !used.has(c + ',' + r) && pred(c, r);
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
    if (!ok(c, r)) continue;
    let c1 = c;
    while (c1 + 1 - c < maxW && ok(c1 + 1, r)) c1++;
    let r1 = r;
    grow: while (r1 + 1 - r < maxH) { for (let i = c; i <= c1; i++) if (!ok(i, r1 + 1)) break grow; r1++; }
    for (let j = r; j <= r1; j++) for (let i = c; i <= c1; i++) used.add(i + ',' + j);
    out.push([c, r, c1, r1]);
  }
  return out;
}

const stdCache = new Map();
function std(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (!stdCache.has(key)) stdCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0.1, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1, flatShading: !!o.flat, side: o.side ?? THREE.FrontSide }));
  return stdCache.get(key);
}
function meshAt(B, geo, mat, x, y, z, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true;
  B.deco(m); return m;
}

// ---- Themed props ('o' cells). (B, [x0,z0,x1,z1], y)
const PROPS = {
  // Market stall: counter, striped awning, fruit
  stall(B, [x0, z0, x1, z1], y) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    B.box(cx - 1.6, y, cz - 0.7, cx + 1.6, y + 1.1, cz + 0.7, 'planks', { raw: true, tint: 0xb08050 });
    for (const sx of [-1.5, 1.5]) for (const sz of [-0.6, 0.6]) B.box(cx + sx - 0.07, y + 1.1, cz + sz - 0.07, cx + sx + 0.07, y + 2.6, cz + sz + 0.07, 'planks', { raw: true, deco: true, tint: 0x6a4a2a });
    for (let i = 0; i < 6; i++) meshAt(B, new THREE.BoxGeometry(0.6, 0.08, 2.3), std(i % 2 ? 0xf2efe6 : 0xd6453a, { rough: 0.9 }), cx - 1.5 + i * 0.6, y + 2.66, cz);
    const fruit = [0xff7a1a, 0xe8d43a, 0x6fbf3a, 0xc2283a];
    for (let i = 0; i < 14; i++) meshAt(B, new THREE.SphereGeometry(0.11, 8, 6), std(fruit[i % 4], { rough: 0.5 }), cx - 1.3 + (i % 7) * 0.42, y + 1.2, cz - 0.3 + Math.floor(i / 7) * 0.5, false);
  },
  // Smelting furnace with a glowing mouth and chimney (big), or a generator (small)
  furnace(B, [x0, z0, x1, z1], y) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0;
    if (w < 6) {
      B.box(cx - 1.2, y, cz - 1.2, cx + 1.2, y + 2, cz + 1.2, 'metal', { raw: true, tint: 0x5a6068 });
      for (const s of [-1, 1]) meshAt(B, new THREE.PlaneGeometry(1.6, 0.8), std(0x111111, { emissive: 0x39c0ff, ei: 2 }), cx + s * 1.21, y + 1.3, cz, false).rotation.y = s * Math.PI / 2;
      return;
    }
    B.box(cx - 2.6, y, cz - 2.6, cx + 2.6, y + 5, cz + 2.6, 'metal', { raw: true, tint: 0x3a3230 });
    B.box(cx - 2.9, y + 5, cz - 2.9, cx + 2.9, y + 5.5, cz + 2.9, 'metal', { raw: true, tint: 0x2a2624 });
    const glow = std(0x221008, { emissive: 0xff6a1a, ei: 4 });
    for (const [dx, dz, ry] of [[0, 2.61, 0], [0, -2.61, Math.PI], [2.61, 0, Math.PI / 2], [-2.61, 0, -Math.PI / 2]]) meshAt(B, new THREE.PlaneGeometry(2.2, 1.4), glow, cx + dx, y + 1.3, cz + dz, false).rotation.y = ry;
    const ch = meshAt(B, new THREE.CylinderGeometry(0.9, 1.1, 12, 16), std(0x3a3230, { metal: 0.6, rough: 0.5 }), cx, y + 11.5, cz);
    ch.castShadow = true;
    const l = new THREE.PointLight(0xff7a2a, 60, 22, 1.6); l.position.set(cx, y + 1.6, cz); B.deco(l);
  },
  // Rooftop AC unit with a spinning-looking fan grille
  acUnit(B, [x0, z0, x1, z1], y) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    B.box(cx - 1.4, y, cz - 1.4, cx + 1.4, y + 1.7, cz + 1.4, 'metal', { raw: true, tint: 0x9aa3ad });
    meshAt(B, new THREE.CylinderGeometry(0.95, 0.95, 0.06, 20), std(0x111111, { emissive: 0x2ff5ff, ei: 1.2 }), cx, y + 1.73, cz, false);
  },
  // Rooftop-garden tree in a planter
  tree(B, [x0, z0, x1, z1], y) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    B.box(cx - 1.3, y, cz - 1.3, cx + 1.3, y + 0.8, cz + 1.3, 'concrete', { raw: true, tint: 0x8a8f96 });
    B.box(cx - 0.3, y + 0.8, cz - 0.3, cx + 0.3, y + 3.2, cz + 0.3, null, { raw: true });
    meshAt(B, new THREE.CylinderGeometry(0.16, 0.24, 2.6, 8), std(0x5a3a22, { rough: 0.9 }), cx, y + 2, cz);
    for (const [dx, dy, dz, r] of [[0, 3.8, 0, 1.5], [0.7, 3.3, 0.4, 1.0], [-0.6, 3.4, -0.5, 1.1]]) meshAt(B, new THREE.IcosahedronGeometry(r, 1), std(0x3f8a4a, { rough: 0.8, flat: true }), cx + dx, y + dy, cz + dz);
  },
  // Temple obelisk with a glowing rune
  obelisk(B, [x0, z0, x1, z1], y) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    B.box(cx - 1.4, y, cz - 1.4, cx + 1.4, y + 0.6, cz + 1.4, 'wall', { raw: true, tint: 0xd9b98a });
    B.box(cx - 0.7, y + 0.6, cz - 0.7, cx + 0.7, y + 6.5, cz + 0.7, 'wall', { raw: true, tint: 0xcaa878 });
    meshAt(B, new THREE.ConeGeometry(0.99, 1.2, 4), std(0xcaa878, { rough: 0.9 }), cx, y + 7.1, cz).rotation.y = Math.PI / 4;
    for (const [dx, dz, ry] of [[0, 0.71, 0], [0, -0.71, Math.PI]]) meshAt(B, new THREE.PlaneGeometry(0.7, 1.4), std(0x111111, { emissive: 0x3ad6ff, ei: 3 }), cx + dx, y + 3.4, cz + dz, false).rotation.y = ry;
  },
  // Mine cart on rails
  cart(B, [x0, z0, x1, z1], y) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (const s of [-0.6, 0.6]) B.box(cx - 2, y, cz + s - 0.06, cx + 2, y + 0.1, cz + s + 0.06, 'metal', { raw: true, deco: true });
    B.box(cx - 1.1, y + 0.3, cz - 0.8, cx + 1.1, y + 1.4, cz + 0.8, 'metal', { raw: true, tint: 0x6a4a36 });
    for (const sx of [-0.7, 0.7]) for (const sz of [-0.8, 0.8]) meshAt(B, new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12), std(0x2a2a2a, { metal: 0.7 }), cx + sx, y + 0.3, cz + sz).rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) meshAt(B, new THREE.DodecahedronGeometry(0.3, 0), std(0xf0c040, { metal: 0.8, rough: 0.35, emissive: 0x3a2a00, ei: 1 }), cx - 0.6 + i * 0.3, y + 1.5, cz + (i % 2 ? 0.2 : -0.2));
  },
  // Fountain with a basin, statue and water
  fountain(B, [x0, z0, x1, z1], y) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, R = Math.min(x1 - x0, z1 - z0) / 2 - 0.4;
    const stone = std(0xdcc29a, { rough: 0.9 });
    meshAt(B, new THREE.CylinderGeometry(R, R + 0.2, 0.9, 24), stone, cx, y + 0.45, cz);
    meshAt(B, new THREE.CylinderGeometry(R - 0.3, R - 0.3, 0.1, 24), std(0x2a7fb0, { rough: 0.1, metal: 0.3, emissive: 0x0a3050, ei: 1 }), cx, y + 0.8, cz, false);
    meshAt(B, new THREE.CylinderGeometry(0.5, 0.7, 2.4, 12), stone, cx, y + 2, cz);
    meshAt(B, new THREE.CylinderGeometry(1.4, 0.4, 0.4, 16), stone, cx, y + 3.3, cz);
    meshAt(B, new THREE.IcosahedronGeometry(0.6, 1), std(0xc8a040, { metal: 0.9, rough: 0.3 }), cx, y + 4.1, cz);
    const k = R * 0.72;
    B.box(cx - k, y, cz - k, cx + k, y + 0.9, cz + k, null, { raw: true });
    B.box(cx - 0.6, y, cz - 0.6, cx + 0.6, y + 4.5, cz + 0.6, null, { raw: true });
  }
};

// ---- Map themes: materials, heights, props, lighting and the details that make each map its own place
const THEMES = {
  bastion: {
    name: 'Bastion', floor: ['floorTiles', 0xd9d0c1], bld: ['concrete', 0xeadfcc], bh: [7, 11], cap: ['wall', 0xb4583a],
    plat: ['concrete', 0xd8c6a8], stairs: ['concrete', 0xcdb898], low: ['concrete', 0xd8c6a8], pillar: ['wall', 0xb9a68a],
    big: { mat: 'container', tints: [0x2e64c4, 0xc0402c, 0x2f8a4a, 0xd97a1f] }, crate: 'crate', roof: ['planks', 0x9a5a34],
    props: ['stall'], windows: 0x3a4a5a, wallLamp: 0xffe2b0, killY: -10,
    lights: [],
    env: { top: 0x5f9be0, bottom: 0xf6e4c8, fog: [0xd8cdb8, 90, 320], sun: [0.45, 0.85, 0.35], sunColor: 0xfff1d6, sunI: 3.0, hemi: [0xcfe0ff, 0x9a8a70, 1.2], exposure: 1.0, sunAmt: 1 },
    extra(B, G, T) {
      // Awnings across a few streets, potted plants, team banners at the sites
      const aw = [0xd6453a, 0x2e7fd6, 0xe8b23a, 0x3aa86a];
      let i = 0;
      for (const [c, r] of [[6, 3], [11, 10], [4, 17], [21, 10], [14, 3]]) {
        if (G.at(c, r) === '#') continue;
        const [x, z] = center(c, r);
        meshAt(B, new THREE.BoxGeometry(CELL - 0.4, 0.06, 1.6), std(aw[i++ % 4], { rough: 0.9, side: THREE.DoubleSide }), x, 3.4, z + 1.2).rotation.x = -0.25;
      }
      for (const [c, r] of [[5, 2], [12, 4], [26, 3], [26, 18], [5, 18], [15, 9]]) if ('.'.includes(G.at(c, r))) { const [x, z] = center(c, r); plant(B, x + 1.2, z + 1.2); }
    },
    backdrop: 'hills'
  },
  foundry: {
    name: 'Foundry', floor: ['floorTiles', 0x9a9690], bld: ['wall', 0x8a7f74], bh: [9, 13], cap: ['metal', 0x4a4540],
    plat: ['grate', 0xb0b0b0], stairs: ['metal', 0x8a8a8a], low: ['metal', 0x7a7a7a], pillar: ['metal', 0x5a5550],
    big: { mat: 'container', tints: [0xc0402c, 0x2e64c4, 0x2f8a4a, 0xd97a1f, 0x7a3fb0] }, crate: 'crate', roof: ['metal', 0x5a5550],
    props: ['furnace'], windows: 0x262a30, wallLamp: 0xffc070, killY: -10,
    lights: [],
    env: { top: 0x2d4f86, bottom: 0xe9a36b, fog: [0x6b5b52, 70, 260], sun: [-0.5, 0.8, 0.3], sunColor: 0xffc58a, sunI: 2.6, hemi: [0xa8c4ff, 0x6a5040, 1.25], exposure: 1.05, sunAmt: 1 },
    extra(B, G, T) {
      // Overhead pipes along the long corridors and hazard stripes at the site entrances
      const pipe = std(0x8a5a2a, { metal: 0.7, rough: 0.4 });
      for (const [c0, c1, r, y] of [[1, 17, 2, 6.2], [1, 14, 19, 6.2], [8, 16, 8, 7]]) {
        const [xa] = center(c0, r), [xb, z] = center(c1, r);
        const m = meshAt(B, new THREE.CylinderGeometry(0.25, 0.25, xb - xa + CELL, 12), pipe, (xa + xb) / 2, y, z + 1.6, false);
        m.rotation.z = Math.PI / 2;
      }
      const stripe = std(0x111111, { emissive: 0xffb020, ei: 1.3 });
      for (const [c, r] of [[17, 3], [17, 4], [15, 15], [16, 16], [14, 6]]) { if (G.at(c, r) === '#') continue; const [x, z] = center(c, r); meshAt(B, new THREE.BoxGeometry(0.4, 0.02, CELL - 0.4), stripe, x + 1.8, 0.01, z, false); }
    },
    backdrop: 'industry'
  },
  skyline: {
    name: 'Skyline', floor: ['tar', 0xffffff], bridge: ['grate', 0xffffff], under: ['facade', 0xffffff, -44], bld: ['facade', 0xffffff], bh: [10, 26], cap: ['concrete', 0x3a3f48],
    plat: ['concrete', 0x4a4f58], stairs: ['metal', 0x8a8f99], low: ['metal', 0x6a7079], pillar: ['concrete', 0x5a606a],
    big: { mat: 'metal', tints: [0x4a5260, 0x5a4a6a] }, crate: 'metal', roof: ['metal', 0x3a3f48],
    props: ['acUnit', 'tree'], windows: null, wallLamp: 0xff2fa8, neon: true, killY: -14,
    lights: [[21, 4, 6, 0x2ff5ff, 45, 30], [20, 17, 6, 0xff2fa8, 45, 30]],
    env: { top: 0x04050d, bottom: 0x2a2150, fog: [0x120f2a, 60, 300], sun: [0.4, 1, -0.3], sunColor: 0xa8bcff, sunI: 1.4, hemi: [0x6070b8, 0x201830, 1.5], exposure: 1.15, stars: true, sunAmt: 0.3, envI: 0.25 },
    extra(B, G, T) {
      // Street far below the gaps, with glowing lane lines
      meshAt(B, new THREE.PlaneGeometry(400, 400), std(0x0a0a12, { rough: 0.9 }), 0, -44, 0, false).rotation.x = -Math.PI / 2;
      for (let i = -3; i <= 3; i++) meshAt(B, new THREE.PlaneGeometry(300, 0.4), std(0x111111, { emissive: i % 2 ? 0xffc040 : 0xff3040, ei: 2 }), 0, -43.9, i * 12, false).rotation.x = -Math.PI / 2;
      // Railings along every drop
      const rail = std(0x9aa3ad, { metal: 0.8, rough: 0.3 });
      for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
        const ch = G.at(c, r);
        if (ch === 'x' || ch === '#' || ch === 'p') continue;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (G.at(c + dc, r + dr) !== 'x' || G.at(c - dc, r - dr) === 'x') continue;
          const [x, z] = center(c, r), ex = x + dc * 1.95, ez = z - dr * 1.95;
          const g = new THREE.BoxGeometry(dc ? 0.06 : CELL, 0.06, dc ? CELL : 0.06);
          meshAt(B, g, rail, ex, 1.05, ez, false);
        }
      }
      // Helipad "H"
      const [hx, hz] = center(21, 5);
      for (const [w, d, ox] of [[0.5, 3.2, -1], [0.5, 3.2, 1], [2, 0.5, 0]]) meshAt(B, new THREE.BoxGeometry(w, 0.02, d), std(0x111111, { emissive: 0xffffff, ei: 1.5 }), hx + ox, PLAT + 0.01, hz, false);
    },
    backdrop: 'city'
  },
  canyon: {
    name: 'Canyon', floor: ['sand', 0xffffff], bridge: ['planks', 0xffffff], under: ['rock', 0xffffff, -30], bld: ['rock', 0xffffff], bh: [8, 17], jagged: true,
    plat: ['rock', 0xd8b890], stairs: ['rock', 0xc8a880], low: ['wall', 0xd9b98a], pillar: ['wall', 0xd9b98a], brokenPillars: true,
    big: { mat: 'rock', tints: [0xc8a070, 0xb89060], boulder: true }, crate: 'crate', roof: ['rock', 0xffffff],
    props: ['obelisk', 'cart'], windows: null, wallLamp: 0xffa040, killY: -12,
    lights: [[20, 4, 8, 0x3ad6ff, 40, 24]],
    env: { top: 0x3f86d8, bottom: 0xf5d3a8, fog: [0xe5c49c, 90, 340], sun: [0.6, 0.9, 0.25], sunColor: 0xfff0d8, sunI: 3.0, hemi: [0xc8dcff, 0x9a6a40, 1.2], exposure: 1.0, sunAmt: 1 },
    extra(B, G, T) {
      meshAt(B, new THREE.PlaneGeometry(400, 400), std(0xc8a070, { rough: 1 }), 0, -30, 0, false).rotation.x = -Math.PI / 2;
      // Rope rails and posts on the bridges
      const post = std(0x5a3a1c, { rough: 0.9 }), rope = std(0xa88a5a, { rough: 1 });
      for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
        if (G.at(c, r) !== '.' || G.at(c, r - 1) !== 'x' || G.at(c, r + 1) !== 'x') continue;
        const [x, z] = center(c, r);
        for (const s of [-1, 1]) {
          meshAt(B, new THREE.CylinderGeometry(0.08, 0.1, 1.3, 8), post, x - 1.9, 0.6, z + s * 1.9);
          meshAt(B, new THREE.BoxGeometry(CELL, 0.05, 0.05), rope, x, 1.0, z + s * 1.9, false);
        }
      }
      // Cave entrance lanterns
      for (const [c, r] of [[6, 14], [14, 15]]) { const [x, z] = center(c, r); meshAt(B, new THREE.SphereGeometry(0.18, 10, 8), std(0x111111, { emissive: 0xffa040, ei: 4 }), x, 2.6, z, false); }
    },
    backdrop: 'mesas'
  },
  harbor: {
    name: 'Harbor', floor: ['concrete', 0xb8b4ac], under: ['concrete', 0x8a8680, -3], bld: ['wall', 0x9a8f84], bh: [8, 12], cap: ['metal', 0x4a4f58],
    plat: ['metal', 0x8a2a2a, -3], platTop: ['planks', 0xb08a60], stairs: ['metal', 0x6a7079], low: ['concrete', 0xa8a49c], pillar: ['metal', 0x3a4a5a],
    big: { mat: 'container', tints: [0xc0402c, 0x2e64c4, 0x2f8a4a, 0xd97a1f, 0x7a3fb0, 0xe0b42a] }, crate: 'crate', roof: ['metal', 0x5a6068],
    props: [], windows: 0x2a3a4a, wallLamp: 0xffe0b0, killY: -4,
    lights: [],
    env: { top: 0x5a7fa8, bottom: 0xf2c38a, fog: [0xa9a39a, 90, 320], sun: [-0.3, 0.55, 0.6], sunColor: 0xffd6a0, sunI: 2.7, hemi: [0xb8ccff, 0x6a5a48, 1.25], exposure: 1.0, sunAmt: 1 },
    extra(B, G, T) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ color: 0x1b4a66, roughness: 0.12, metalness: 0.35 }));
      water.rotation.x = -Math.PI / 2; water.position.y = -1.4; water.receiveShadow = true; B.deco(water);
      // Ship bow, mast and a harbour crane over the dock
      const [sx, sz] = center(22, 3);
      meshAt(B, new THREE.CylinderGeometry(0.2, 0.25, 12, 10), std(0xdadada, { metal: 0.5 }), sx + 6, PLAT + 6, sz);
      // Deck railing along the open water
      const rail = std(0xdadada, { metal: 0.6, rough: 0.4 });
      meshAt(B, new THREE.BoxGeometry(X0(26) - X0(19), 0.08, 0.08), rail, (X0(19) + X0(26)) / 2, PLAT + 1, Z1(1) - 0.1, false);
      for (let x = X0(19); x <= X0(26); x += 2) meshAt(B, new THREE.BoxGeometry(0.08, 1, 0.08), rail, x, PLAT + 0.5, Z1(1) - 0.1, false);
      const steel = std(0xe0b42a, { metal: 0.6, rough: 0.4 });
      const [cx, cz] = center(10, 3);
      for (const dx of [-3, 3]) { meshAt(B, new THREE.BoxGeometry(0.6, 16, 0.6), steel, cx + dx, 8, cz + 1.5); B.box(cx + dx - 0.3, 0, cz + 1.2, cx + dx + 0.3, 16, cz + 1.8, null, { raw: true }); }
      meshAt(B, new THREE.BoxGeometry(7, 0.8, 0.8), steel, cx, 16, cz + 1.5);
      meshAt(B, new THREE.BoxGeometry(0.8, 0.8, 26), steel, cx, 16.8, cz - 8);
      for (let i = 0; i < 5; i++) meshAt(B, new THREE.CylinderGeometry(0.35, 0.35, 0.9, 10), std(0x333a40, { metal: 0.6 }), X0(3 + i * 3) + 2, 0.45, Z1(3) - 0.5);
    },
    backdrop: 'harbor'
  },
  citadel: {
    name: 'Citadel', floor: ['floorTiles', 0xdcc29a], bld: ['wall', 0xb89a78], bh: [8, 12], merlons: true,
    plat: ['concrete', 0xdcc29a], stairs: ['concrete', 0xcdb28a], low: ['concrete', 0xb89a78], pillar: ['wall', 0xdcc29a],
    big: { mat: 'concrete', tints: [0xc8ae88], block: true }, crate: 'crate', roof: ['concrete', 0x9a7a5a],
    props: ['fountain'], windows: 0x2a2030, wallLamp: 0xff8a3a, killY: -10,
    lights: [[13, 10, 5, 0xff8a3a, 35, 20], [21, 5, 5, 0xff8a3a, 35, 20]],
    env: { top: 0x2b2f5a, bottom: 0xf08a5a, fog: [0x6a4a4a, 80, 320], sun: [0.7, 0.35, -0.3], sunColor: 0xffa070, sunI: 2.5, hemi: [0x8a90d0, 0x5a3a2a, 1.25], exposure: 1.05, sunAmt: 1 },
    extra(B, G, T) {
      // Braziers on the plaza and in the throne hall
      const fire = std(0x111111, { emissive: 0xff7a2a, ei: 3 }), bowl = std(0x3a2a1a, { metal: 0.6, rough: 0.5 });
      for (const [c, r, y] of [[12, 9, PLAT], [14, 12, PLAT], [19, 5, 0], [23, 7, 0]]) {
        const [x, z] = center(c, r);
        meshAt(B, new THREE.CylinderGeometry(0.1, 0.12, 1.1, 8), bowl, x, y + 0.55, z);
        meshAt(B, new THREE.CylinderGeometry(0.45, 0.25, 0.4, 12), bowl, x, y + 1.2, z);
        meshAt(B, new THREE.ConeGeometry(0.3, 0.6, 8), fire, x, y + 1.65, z, false);
        B.box(x - 0.4, y, z - 0.4, x + 0.4, y + 1.4, z + 0.4, null, { raw: true });
      }
      // Banners hanging in the throne hall
      for (const [c, r, col] of [[19, 2, 0xff3d5a], [22, 2, 0xff3d5a], [19, 8, 0x3d8dff]]) {
        const [x, z] = center(c, r);
        meshAt(B, new THREE.PlaneGeometry(1.8, 3.6), std(col, { rough: 0.8, side: THREE.DoubleSide }), x, 4, z + (r < 5 ? 1.9 : -1.9), false);
      }
    },
    backdrop: 'mountains'
  }
};

function backdrop(B, kind) {
  const r = seeded(kind.length * 7 + 3);
  if (kind === 'city') {
    for (let i = 0; i < 90; i++) {
      const a = r() * Math.PI * 2, dist = 90 + r() * 170;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist, w = 12 + r() * 20, d = 12 + r() * 20, h = -10 + r() * 80;
      B.box(x - w / 2, -80, z - d / 2, x + w / 2, h, z + d / 2, 'facade', { deco: true, shadow: false, raw: true });
      if (r() < 0.3) {
        const m = meshAt(B, new THREE.PlaneGeometry(w * 0.7, 3), std(0x050505, { emissive: r() < 0.5 ? 0xff2fa8 : 0x2ff5ff, ei: 3.5, side: THREE.DoubleSide }), x, h + 3, z, false);
        m.rotation.y = Math.atan2(-x, -z);
      }
    }
  } else if (kind === 'mesas' || kind === 'mountains') {
    for (let i = 0; i < 30; i++) {
      const a = r() * Math.PI * 2, dist = 120 + r() * 140, w = 25 + r() * 45, h = 12 + r() * 50;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      B.box(x - w / 2, -30, z - w / 2, x + w / 2, h, z + w / 2, 'rock', { deco: true, shadow: false, raw: true, tint: kind === 'mountains' ? 0x8a7a8a : 0xffffff });
    }
  } else if (kind === 'hills') {
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, dist = 140 + r() * 120, s = 25 + r() * 35;
      meshAt(B, new THREE.IcosahedronGeometry(s, 1), std(r() < 0.5 ? 0x7a9a5a : 0x8aa86a, { rough: 1, flat: true }), Math.cos(a) * dist, -s * 0.55, Math.sin(a) * dist, false);
    }
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2, dist = 75 + r() * 40, h = 6 + r() * 12, w = 8 + r() * 10;
      B.box(Math.cos(a) * dist - w / 2, 0, Math.sin(a) * dist - w / 2, Math.cos(a) * dist + w / 2, h, Math.sin(a) * dist + w / 2, 'concrete', { deco: true, shadow: false, raw: true, tint: 0xeadfcc });
    }
  } else if (kind === 'industry') {
    for (let i = 0; i < 30; i++) {
      const a = r() * Math.PI * 2, dist = 85 + r() * 120, w = 14 + r() * 24, h = 8 + r() * 26;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      B.box(x - w / 2, -5, z - w / 2, x + w / 2, h, z + w / 2, 'wall', { deco: true, shadow: false, raw: true, tint: 0x7a6f64 });
      if (r() < 0.4) meshAt(B, new THREE.CylinderGeometry(1.5, 2, 30, 12), std(0x5a5048, { metal: 0.4 }), x, h + 15, z, false);
    }
  } else if (kind === 'harbor') {
    B.box(-40, -4, 60, 30, 7, 76, 'metal', { deco: true, tint: 0x2a4a8a, shadow: false, raw: true });
    B.box(-20, 7, 62, 0, 15, 74, 'wall', { deco: true, shadow: false, raw: true });
    for (let i = 0; i < 16; i++) {
      const x = -140 + i * 18, h = 10 + r() * 16;
      B.box(x, -2, -120, x + 14, h, -100, 'wall', { deco: true, shadow: false, raw: true, tint: 0x8a8278 });
    }
  }
}

// Build a map from its grid layout + theme.
function fromLayout(key) {
  const T = THEMES[key];
  const G = new Grid(COLS, ROWS);
  LAYOUTS[key](G);
  const B = new Builder(1);
  const at = (c, r) => G.at(c, r);
  const raised = (c, r) => at(c, r) === 'p' || G.raised?.has(c + ',' + r);
  const baseY = (c, r) => (raised(c, r) ? PLAT : 0);
  const O = (m, extra = {}) => ({ raw: true, tint: m[1], ...extra });

  // Floors (void cells stay open). Bridges get their own material.
  const bridge = (c, r) => (at(c, r - 1) === 'x' && at(c, r + 1) === 'x') || (at(c - 1, r) === 'x' && at(c + 1, r) === 'x');
  const floorOf = (c, r) => (at(c, r) === 'x' ? null : T.bridge && bridge(c, r) ? 'bridge' : 'floor');
  for (const kind of ['floor', 'bridge']) {
    const m = T[kind];
    if (!m) continue;
    for (const R of rects(G, (c, r) => floorOf(c, r) === kind)) {
      const [x0, z0, x1, z1] = rectXZ(R);
      B.box(x0, kind === 'bridge' ? -0.35 : -0.5, z0, x1, 0, z1, m[0], O(m));
      if (T.under && kind === 'floor') B.box(x0, T.under[2], z0, x1, -0.5, z1, T.under[0], O(T.under, { deco: true, shadow: false }));
    }
  }

  // Buildings: capped at 4x4 cells so the skyline varies
  for (const R of rects(G, (c, r) => at(c, r) === '#', 4, 4)) {
    const [x0, z0, x1, z1] = rectXZ(R);
    const h = T.bh[0] + hash(R[0], R[1], 1) * (T.bh[1] - T.bh[0]);
    const y0 = T.under ? T.under[2] : -0.5;
    B.box(x0, y0, z0, x1, h, z1, T.bld[0], O(T.bld));
    if (T.jagged) {
      // Irregular rock: a second, offset chunk on top
      const k = hash(R[0], R[1], 2);
      B.box(x0 + (x1 - x0) * 0.15 * k, h, z0 + (z1 - z0) * 0.2, x1 - (x1 - x0) * 0.25, h + 2 + k * 5, z1 - (z1 - z0) * 0.15 * k, T.bld[0], O(T.bld, { deco: true }));
    }
    if (T.cap) B.box(x0 - 0.15, h, z0 - 0.15, x1 + 0.15, h + 0.4, z1 + 0.15, T.cap[0], O(T.cap, { deco: true }));
    if (T.merlons) {
      for (let x = x0 + 0.4; x < x1 - 0.4; x += 1.8) for (const z of [z0, z1 - 0.8]) B.box(x, h, z, x + 0.9, h + 0.9, z + 0.8, T.bld[0], O(T.bld, { deco: true }));
      for (let z = z0 + 0.4; z < z1 - 0.4; z += 1.8) for (const x of [x0, x1 - 0.8]) B.box(x, h, z, x + 0.8, h + 0.9, z + 0.9, T.bld[0], O(T.bld, { deco: true }));
    }
    if (T.neon && hash(R[0], R[1], 3) < 0.35) {
      const col = hash(R[0], R[1], 4) < 0.5 ? 0xff2fa8 : 0x2ff5ff;
      const m = meshAt(B, new THREE.PlaneGeometry(Math.min(8, x1 - x0 - 1), 1.6), std(0x050505, { emissive: col, ei: 3.5, side: THREE.DoubleSide }), (x0 + x1) / 2, h + 1.4, (z0 + z1) / 2, false);
      m.rotation.y = hash(R[0], R[1], 5) < 0.5 ? 0 : Math.PI / 2;
    }
  }

  // Raised platforms (site heavens, helipads, ship decks, mesas)
  for (const R of rects(G, raised)) {
    const [x0, z0, x1, z1] = rectXZ(R);
    const y0 = T.plat[2] ?? 0;
    if (T.platTop) {
      B.box(x0, y0, z0, x1, PLAT - 0.2, z1, T.plat[0], O(T.plat));
      B.box(x0, PLAT - 0.2, z0, x1, PLAT, z1, T.platTop[0], O(T.platTop));
    } else B.box(x0, y0, z0, x1, PLAT, z1, T.plat[0], O(T.plat));
  }

  // Stairs: rise toward the neighbouring platform, from the side that is on the ground
  const DIRS = [[1, 0, '+x'], [-1, 0, '-x'], [0, -1, '+z'], [0, 1, '-z']];
  const ground = ch => '.12cw'.includes(ch);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (at(c, r) !== 's') continue;
    const dir = DIRS.find(([dc, dr]) => raised(c + dc, r + dr) && ground(at(c - dc, r - dr))) || DIRS.find(([dc, dr]) => raised(c + dc, r + dr)) || DIRS[0];
    const [x0, z0, x1, z1] = rectXZ([c, r, c, r]);
    B.stairs(x0, z0, x1, z1, 0, PLAT, dir[2], T.stairs[0]);
  }

  // Cover and props
  const pickTint = (list, c, r) => list[Math.floor(hash(c, r, 7) * list.length)];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ch = at(c, r), [x, z] = center(c, r), y = baseY(c, r), hv = hash(c, r, 9);
    if (ch === 'c') {
      // Crate cluster on one side of the cell, leaving room to walk past
      const ox = (hv < 0.5 ? -1 : 1) * 0.9, oz = (hash(c, r, 10) < 0.5 ? -1 : 1) * 0.9;
      B.box(x + ox - 0.6, y, z + oz - 0.6, x + ox + 0.6, y + 1.2, z + oz + 0.6, T.crate, { raw: true });
      if (hv < 0.35) B.box(x + ox - 0.5, y + 1.2, z + oz - 0.5, x + ox + 0.5, y + 2.2, z + oz + 0.5, T.crate, { raw: true });
      else { const sx = x + ox - Math.sign(ox) * 1.25; B.box(sx - 0.6, y, z + oz - 0.6, sx + 0.6, y + 1.2, z + oz + 0.6, T.crate, { raw: true }); }
    } else if (ch === 'C') {
      const along = hash(c, r, 11) < 0.5, bg = T.big;
      if (bg.boulder) {
        B.box(x - 1.5, y, z - 1.4, x + 1.5, y + 2.4, z + 1.4, bg.mat, { raw: true, tint: pickTint(bg.tints, c, r) });
        B.box(x - 1.0, y + 2.4, z - 0.9, x + 1.1, y + 3.1, z + 0.8, bg.mat, { raw: true, tint: pickTint(bg.tints, c + 1, r), deco: true });
      } else if (bg.block) {
        B.box(x - 1.6, y, z - 1.6, x + 1.6, y + 2.2, z + 1.6, bg.mat, { raw: true, tint: bg.tints[0] });
        B.box(x - 1.8, y + 2.2, z - 1.8, x + 1.8, y + 2.5, z + 1.8, bg.mat, { raw: true, tint: bg.tints[0], deco: true });
      } else {
        const [hw, hd] = along ? [1.8, 1.2] : [1.2, 1.8];
        B.box(x - hw, y, z - hd, x + hw, y + 2.6, z + hd, bg.mat, { raw: true, tint: pickTint(bg.tints, c, r) });
      }
    } else if (ch === 'w') {
      const along = hash(c, r, 12) < 0.5, [hw, hd] = along ? [1.7, 0.3] : [0.3, 1.7];
      B.box(x - hw, y, z - hd, x + hw, y + 1.1, z + hd, T.low[0], O(T.low));
    } else if (ch === 'W') {
      const top = T.brokenPillars ? 2.5 + hv * 4 : 6.5;
      B.box(x - 0.7, y, z - 0.7, x + 0.7, y + top, z + 0.7, T.pillar[0], O(T.pillar));
      B.box(x - 0.85, y, z - 0.85, x + 0.85, y + 0.35, z + 0.85, T.pillar[0], O(T.pillar, { deco: true }));
    }
  }
  const oRects = rects(G, (c, r) => at(c, r) === 'o');
  oRects.forEach((R, i) => {
    const name = T.props[Math.min(i, T.props.length - 1)];
    if (name) PROPS[name](B, rectXZ(R), baseY(R[0], R[1]));
  });

  // Roofs (covered corridors / halls): a slab plus beams, not walkable
  for (const [c0, r0, c1, r1, y] of G.roofs) {
    const [x0, z0, x1, z1] = rectXZ([c0, r0, c1, r1]);
    B.box(x0, y, z0, x1, y + 0.4, z1, T.roof[0], O(T.roof, { noWalk: true }));
    for (let x = x0 + 2; x < x1; x += 4) B.box(x - 0.15, y - 0.3, z0, x + 0.15, y, z1, 'metal', { raw: true, deco: true, tint: 0x4a4f58, shadow: false });
    lampAt(B, (x0 + x1) / 2, y - 0.1, (z0 + z1) / 2, T.wallLamp);
  }

  // Wall details: windows and wall lamps on building faces that border walkable cells
  for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
    const ch = at(c, r);
    if (ch === '#' || ch === 'x') continue;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (at(c + dc, r + dr) !== '#') continue;
      const [x, z] = center(c, r), ex = x + dc * 1.97, ez = z - dr * 1.97, ry = Math.atan2(-dc, dr);
      const k = hash(c * 3 + dc, r * 3 + dr, 13);
      if (T.windows && k < 0.35) {
        const m = meshAt(B, new THREE.PlaneGeometry(1.2, 1.6), std(T.windows, { rough: 0.2, metal: 0.6 }), ex, 4.6, ez, false);
        m.rotation.y = ry;
        const f = meshAt(B, new THREE.PlaneGeometry(1.5, 1.9), std(0x2a2520, { rough: 0.9 }), ex - Math.sin(ry) * 0.005, 4.6, ez - Math.cos(ry) * 0.005, false);
        f.rotation.y = ry;
      } else if (k > 0.9) {
        const m = meshAt(B, new THREE.BoxGeometry(0.5, 0.25, 0.12), std(0x111111, { emissive: T.wallLamp, ei: 3 }), ex, 3.6 + baseY(c, r), ez, false);
        m.rotation.y = ry;
      } else if (T.neon && k > 0.8) {
        const m = meshAt(B, new THREE.PlaneGeometry(2.6, 0.35), std(0x050505, { emissive: k > 0.85 ? 0xff2fa8 : 0x2ff5ff, ei: 3 }), ex, 3.2, ez, false);
        m.rotation.y = ry;
      }
    }
  }

  for (const [c, r, y, color, I, dist] of T.lights) {
    const [x, z] = center(c, r);
    const l = new THREE.PointLight(color, I, dist, 1.6); l.position.set(x, y, z); B.deco(l);
  }
  T.extra?.(B, G, T);
  backdrop(B, T.backdrop);

  // Spawns, zones, sites, pickups straight from the grid
  const cellsOf = ch => { const out = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (at(c, r) === ch) out.push([c, r]); return out; };
  const spawnList = ch => cellsOf(ch).map(([c, r]) => { const [x, z] = center(c, r); return [x, 0, z]; });
  const zoneOf = ch => {
    const cells = cellsOf(ch);
    const c0 = Math.max(1, Math.min(...cells.map(p => p[0])) - 1), c1 = Math.min(COLS - 2, Math.max(...cells.map(p => p[0])) + 1);
    const r0 = Math.max(1, Math.min(...cells.map(p => p[1])) - 1), r1 = Math.min(ROWS - 2, Math.max(...cells.map(p => p[1])) + 1);
    const [minX, minZ, maxX, maxZ] = rectXZ([c0, r0, c1, r1]);
    return { minX, maxX, minZ, maxZ, y: 0 };
  };
  const sites = Object.entries(G.sites).map(([name, R]) => {
    const [x0, z0, x1, z1] = rectXZ(R);
    let hi = 0, n = 0;
    for (let r = R[1]; r <= R[3]; r++) for (let c = R[0]; c <= R[2]; c++) { n++; if (raised(c, r)) hi++; }
    return { name, x: [x0, x1], z: [z0, z1], y: hi > n / 2 ? PLAT : 0 };
  });
  B.finish();
  return {
    name: T.name, B,
    bounds: { minX: X0(1), maxX: X0(COLS - 1), minZ: Z1(ROWS - 1), maxZ: Z1(1), maxY: 6 },
    killY: T.killY,
    teamSpawns: [spawnList('1'), spawnList('2')],
    zones: [zoneOf('1'), zoneOf('2')],
    pickups: (G.pickups || []).map(([c, r]) => { const [x, z] = center(c, r); return [x, baseY(c, r), z]; }),
    sites,
    layout: { cols: COLS, rows: ROWS, cell: CELL, x0: X0(0), z0: Z1(0), cells: G.g.map(row => row.join('')), sites: G.sites },
    env: T.env
  };
}

// Ceiling lamp without a real light (emissive only, keeps the light count and shader cost fixed)
function lampAt(B, x, y, z, color) {
  meshAt(B, new THREE.BoxGeometry(1.4, 0.12, 0.5), std(0x111111, { emissive: color, ei: 4 }), x, y, z, false);
}

// Practice range: firing line facing target lanes at 10/20/30/50m, plus a close-quarters room.
function range() {
  const B = new Builder(1);
  const floor = 0x7f858c;
  B.box(-42, -1, -32, 42, 0, 32, 'floorTiles', { tint: floor });
  B.box(-42, 0, -32, 42, 8, -30, 'wall'); B.box(-42, 0, 30, 42, 8, 32, 'wall');
  B.box(-42, 0, -30, -40, 8, 30, 'wall'); B.box(40, 0, -30, 42, 12, 30, 'rock');
  // Firing line
  for (const [z0, z1] of [[-22, -9], [-7, 7], [9, 22]]) B.box(-28.4, 0, z0, -28, 1.1, z1, 'metal');
  // Lane dividers and distance markers
  for (const z of [-22, 22]) B.box(-28, 0, z - 0.2, 38, 1.4, z + 0.2, 'concrete');
  const sign = (x, label) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d'); g.fillStyle = '#10141a'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#ffd166'; g.font = 'bold 72px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 128, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    for (const z of [-22.3, 22.3]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
      m.position.set(x, 2.2, z); m.rotation.y = 0; B.deco(m);
    }
  };
  sign(-18, '10m'); sign(-8, '20m'); sign(2, '30m'); sign(22, '50m');
  // Close-quarters room (north side)
  B.box(-26, 0, 23, -25.6, 3, 30, 'wall');
  B.box(-10, 0, 23, -9.6, 3, 27, 'wall');
  B.box(-20, 0, 25.5, -18.8, 1.2, 26.7, 'crate');
  B.box(-15, 0, 27, -13.8, 1.8, 28.2, 'crate');
  // A few cover pieces out in the lanes for moving targets
  B.box(-4, 0, -14, -2.8, 1.2, -12.8, 'crate');
  B.box(12, 0, 10, 14.4, 1.4, 11.2, 'metal');
  for (const [x, z] of [[-34, -12], [-34, 12], [0, 0], [20, -12], [20, 12]]) lamp(B, x, 7.6, z, 0xffffff, false);

  return {
    name: 'Range', B,
    bounds: { minX: -39.5, maxX: 39.5, minZ: -29.5, maxZ: 29.5, maxY: 8 },
    killY: -10,
    spawns: [[-34, 0, 0], [-34, 0, 4]],
    pickups: [],
    sites: [],
    // [x, y, z, behaviour]
    dummies: [
      [-18, 0, -14, 'static'], [-18, 0, -4, 'static'], [-18, 0, 4, 'static'], [-18, 0, 14, 'static'],
      [-8, 0, -10, 'strafe'], [-8, 0, 10, 'strafe'],
      [2, 0, -15, 'strafe'], [2, 0, 0, 'static'], [2, 0, 15, 'strafe'],
      [22, 0, -8, 'static'], [22, 0, 8, 'static'],
      [-18, 0, 26, 'static'], [-12, 0, 28.5, 'strafe']
    ],
    env: { top: 0x6f94c0, bottom: 0xd6dde4, fog: [0xc9d0d6, 80, 260], sun: [0.3, 0.9, 0.4], sunColor: 0xffffff, sunI: 2.6, hemi: [0xdfe8ff, 0x7a7a7a, 1.3], exposure: 1.0, sunAmt: 0.6 }
  };
}

export const MAPS = [
  { id: 0, name: 'Bastion', size: 'Large', desc: 'Sunny hill town. Long A street, a pillared courtyard mid and a covered market to B.', build: () => fromLayout('bastion') },
  { id: 1, name: 'Foundry', size: 'Large', desc: 'Steel plant. A is a roofed smelter hall with a vent flank, B an open container yard.', build: () => fromLayout('foundry') },
  { id: 2, name: 'Skyline', size: 'Large', desc: 'Neon rooftops at night. Bridges over the drop, a raised helipad A, a garden B.', build: () => fromLayout('skyline') },
  { id: 3, name: 'Canyon', size: 'Large', desc: 'Desert temple on a mesa, a chasm with two bridges, a cave into the mining camp.', build: () => fromLayout('canyon') },
  { id: 4, name: 'Harbor', size: 'Large', desc: 'Docks. A is on the deck of a cargo ship, mid a container maze, B a warehouse.', build: () => fromLayout('harbor') },
  { id: 5, name: 'Citadel', size: 'Large', desc: 'Dusk temple. Colonnade to the throne hall A, a grand stair mid, a fountain garden B.', build: () => fromLayout('citadel') }
];
export const RANGE_MAP = { id: 99, name: 'Range', size: 'Practice', desc: 'Practice range', build: range };
export const mapById = id => (id === 99 ? RANGE_MAP : MAPS.find(m => m.id === id) || MAPS[0]);

// Build a full map: scene objects + collision world + nav graph.
export function buildMap(index, scene, quality) {
  const def = mapById(index).build();
  const { B, env } = def;
  const S = B.S;
  B.finish();
  scene.add(B.group);

  // Scale the layout data to match the scaled geometry
  const sp3 = p => [p[0] * S, p[1], p[2] * S];
  const bounds = { minX: def.bounds.minX * S, maxX: def.bounds.maxX * S, minZ: def.bounds.minZ * S, maxZ: def.bounds.maxZ * S, maxY: def.bounds.maxY };

  const sky = skyDome(env.top, env.bottom, { stars: env.stars, sun: env.sun, sunColor: env.sunColor, sunAmt: env.sunAmt });
  scene.add(sky);
  scene.fog = new THREE.Fog(env.fog[0], env.fog[1], env.fog[2]);

  const hemi = new THREE.HemisphereLight(env.hemi[0], env.hemi[1], env.hemi[2]);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(env.sunColor, env.sunI);
  const ext = Math.max(bounds.maxX, bounds.maxZ) + 8;
  const sd = new THREE.Vector3(...env.sun).normalize();
  sun.position.copy(sd).multiplyScalar(ext * 1.3);
  sun.castShadow = quality !== 'low';
  const sm = quality === 'high' ? 4096 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const c = sun.shadow.camera;
  c.left = -ext; c.right = ext; c.top = ext; c.bottom = -ext; c.near = 1; c.far = ext * 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const world = new World(B.boxes);
  world.buildNav(bounds);

  // Make sure every spawn is standing in open space (scaling can nudge props next to them)
  const fixSpawn = p => {
    if (world.fits(p[0], p[1], p[2], 0.5, 2)) return p;
    for (let r = 0.5; r < 6; r += 0.5) for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const x = p[0] + Math.cos(a) * r, z = p[2] + Math.sin(a) * r;
      if (world.fits(x, p[1], z, 0.5, 2)) return [x, p[1], z];
    }
    return p;
  };
  // Layout maps give each side its own spawns; the range mirrors its spawn list.
  const base = (def.teamSpawns ? def.teamSpawns[0] : def.spawns).map(sp3).map(fixSpawn);
  const teamSpawns = [base, def.teamSpawns ? def.teamSpawns[1].map(sp3).map(fixSpawn) : base.map(p => fixSpawn([-p[0], p[1], -p[2]]))];
  const spawns = [...teamSpawns[0], ...teamSpawns[1]];
  const pickups = [];
  for (const p0 of def.pickups) pickups.push(sp3(p0));

  // Spawn zone for the buy-phase barrier: the box around the first two spawns, padded.
  const sp = base.slice(0, 2), pad = 3;
  const z0 = {
    minX: Math.max(bounds.minX - 1, Math.min(...sp.map(p => p[0])) - pad), maxX: Math.max(...sp.map(p => p[0])) + pad,
    minZ: Math.max(bounds.minZ - 1, Math.min(...sp.map(p => p[2])) - pad), maxZ: Math.min(bounds.maxZ + 1, Math.max(...sp.map(p => p[2])) + pad),
    y: Math.min(...sp.map(p => p[1]))
  };
  const spawnZones = def.zones || [z0, { minX: -z0.maxX, maxX: -z0.minX, minZ: -z0.maxZ, maxZ: -z0.minZ, y: z0.y }];

  // Bomb sites (defenders' side is east / x > 0)
  const sites = (def.sites || []).map(s => ({
    name: s.name, minX: s.x[0] * S, maxX: s.x[1] * S, minZ: s.z[0] * S, maxZ: s.z[1] * S, y: s.y ?? 0,
    cx: (s.x[0] + s.x[1]) / 2 * S, cz: (s.z[0] + s.z[1]) / 2 * S
  }));
  const dummies = (def.dummies || []).map(d => ({ pos: [d[0], d[1], d[2]], kind: d[3] }));

  return { name: def.name, group: B.group, sky, world, spawns, teamSpawns, spawnZones, sites, dummies, pickups, killY: def.killY, bounds, env, lights: [hemi, sun], layout: def.layout || null };
}
