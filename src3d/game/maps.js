// 3D arenas built from textured boxes. Every collider is an axis-aligned box.
import * as THREE from 'three';
import { tex } from './textures.js';
import { World } from './physics.js';

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

// ---------------------------------------------------------------- Maps
function foundry() {
  const B = new Builder(1.45);
  B.box(-31, -1, -21, 31, 0, 21, 'floorTiles');
  B.box(-31, 0, -21, 31, 10, -20, 'wall'); B.box(-31, 0, 20, 31, 10, 21, 'wall');
  B.box(-31, 0, -20, -30, 10, 20, 'wall'); B.box(30, 0, -20, 31, 10, 20, 'wall');
  B.box(-31, 10, -21, 31, 10.4, -18, 'metal', { deco: true }); B.box(-31, 10, 18, 31, 10.4, 21, 'metal', { deco: true });

  B.sym(-18, 3.3, 13, 18, 3.6, 17, 'grate');
  B.sym(-18, 3.6, 12.85, -4, 4.6, 13, 'metal');
  B.sym(4, 3.6, 12.85, 18, 4.6, 13, 'metal');
  for (const x of [-12, 0, 12]) B.sym(x - 0.25, 0, 14.75, x + 0.25, 3.3, 15.25, 'metal');
  B.stairs(18, 13, 24, 17, 0, 3.6, '-x', 'metal', true);
  B.sym(-23.6, 0, 14, -22.4, 1.2, 15.2, 'crate');
  B.sym(-21.8, 0, 13.8, -18.2, 2.4, 16.2, 'crate');

  B.box(-5, 0, -5, 5, 1.2, 5, 'concrete');
  B.sym(-6.2, 0, -2, -5, 0.6, 2, 'metal');
  B.sym(-4, 1.2, 3.6, 4, 2.1, 4, 'metal');
  B.box(-0.6, 1.2, -0.6, 0.6, 2.4, 0.6, 'crate');

  B.sym(-15, 0, -9.5, -9, 2.6, -7, 'container', { tint: 0xc0402c });
  B.sym(-17, 0, 3, -14.5, 2.6, 9, 'container', { tint: 0x2e64c4 });
  B.sym(-9, 0, -9.5, -7.8, 1.2, -8.3, 'crate');
  B.sym(-8, 0, 6.5, -5.5, 2.6, 12.4, 'container', { tint: 0x2f8a4a });

  B.sym(-22.6, 0, -6.6, -21.4, 1.2, -5.4, 'crate');
  B.sym(-11, 0, 0.4, -9.8, 1.2, 1.6, 'crate');
  B.sym(-10.4, 1.2, 0.8, -9.4, 2.2, 1.8, 'crate');
  B.sym(-24.6, 0, 1.8, -24, 1.4, 5, 'metal');
  B.sym(-22, 0, 5, -20.8, 1.2, 6.2, 'crate');
  B.sym(-3, 0, -13, -1.8, 1.2, -11.8, 'crate');
  // Extra cover for the bigger floor
  B.sym(-19, 0, -16, -17.8, 1.2, -14.8, 'crate');
  B.sym(-26, 0, -14, -23.5, 2.6, -8, 'container', { tint: 0xd97a1f });
  B.sym(-5, 0, 15, -3.8, 1.2, 16.2, 'crate');

  for (let x = -27; x <= 27; x += 9) B.box(x - 0.2, 9.6, -20, x + 0.2, 10, 20, 'metal', { deco: true, shadow: false });
  for (const z of [-19.6, 19.6]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 60 * B.S, 12), new THREE.MeshStandardMaterial({ color: 0x8a5a2a, metalness: 0.7, roughness: 0.4 }));
    pipe.rotation.z = Math.PI / 2; pipe.position.set(0, 7.5, B.p(z)); B.deco(pipe);
  }
  for (const x of [-18, 0, 18]) for (const z of [-8, 8]) lamp(B, x, 9.4, z, 0xffd9a0, true, 45);

  return {
    name: 'Foundry', B,
    bounds: { minX: -29.5, maxX: 29.5, minZ: -19.5, maxZ: 19.5, maxY: 8 },
    killY: -10,
    spawns: [[-27, 0, 0], [-27, 0, -10], [-26, 0, 10], [-12, 3.6, -15]],
    pickups: [[0, 1.2, 0], [-15, 3.6, -15], [-27, 0, 16]],
    sites: [{ name: 'A', x: [14, 24], z: [2, 12] }, { name: 'B', x: [14, 24], z: [-14, -4] }],
    env: { top: 0x2d4f86, bottom: 0xe9a36b, fog: [0x6b5b52, 55, 180], sun: [-0.5, 0.8, 0.3], sunColor: 0xffc58a, sunI: 2.6, hemi: [0xa8c4ff, 0x6a5040, 1.25], exposure: 1.05, sunAmt: 1 }
  };
}

function skyline() {
  const B = new Builder(1.45);
  B.box(-28, -2, -18, 28, 0, 18, 'tar');
  B.box(-28, -40, -18, 28, -2, 18, 'facade', { deco: true, shadow: false });
  B.box(-28.4, 0, -18.4, 28.4, 1, -17.6, 'concrete'); B.box(-28.4, 0, 17.6, 28.4, 1, 18.4, 'concrete');
  B.box(-28.4, 0, -17.6, -27.6, 1, 17.6, 'concrete'); B.box(27.6, 0, -17.6, 28.4, 1, 17.6, 'concrete');

  B.box(-3, 0, -3, 3, 4, 3, 'wall');
  B.stairs(3, -3, 9, -1, 0, 4, '-x', 'concrete', true);
  B.sym(2.8, 4, -1, 3, 4.8, 3, 'metal');
  B.sym(-3, 4, 2.8, 3, 4.8, 3, 'metal');
  B.box(-1.4, 4, -1.4, 1.4, 4.2, 1.4, 'pad', { deco: true, shadow: false });

  B.sym(-24, 2.8, -16, -18, 3.1, -10, 'grate');
  B.sym(-24, 0, -10, -22, 2.0, -8.5, 'metal');
  B.sym(-24, 0, -8.5, -22, 1.0, -7, 'metal');
  B.sym(-24, 3.1, -16.2, -18, 7, -15.9, 'metal');
  for (const x of [-23.7, -18.3]) for (const z of [-15.7, -10.3]) B.sym(x - 0.15, 0, z - 0.15, x + 0.15, 2.8, z + 0.15, 'metal');

  B.sym(-18, 0, -8, -15.5, 1.5, -6, 'metal');
  B.sym(-20, 0, 6, -18, 1.4, 9, 'metal');
  B.sym(-10, 0, 10, -9, 2.2, 11, 'metal');
  B.sym(-12, 0, -1, -11.4, 3.2, 5, 'metal');
  B.sym(-14, 0, -6, -10, 0.8, -2, 'metal');
  B.sym(-7, 0, -12, -4, 1.3, -10.5, 'concrete');
  B.sym(-25, 0, 3, -24, 1.8, 7, 'concrete');
  B.sym(-16, 0, 13, -14.8, 1.6, 15, 'metal');
  B.sym(-5, 0, 5, -3.8, 1.3, 7, 'metal');

  const neon = (x, y, z, w, h, color, ry = 0, raw = false) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x050505, emissive: color, emissiveIntensity: 3.5, side: THREE.DoubleSide }));
    m.position.set(raw ? x : B.p(x), y, raw ? z : B.p(z)); m.rotation.y = ry; B.deco(m);
    return m;
  };
  neon(-21, 5.2, -15.8, 5, 2.4, 0xff2fa8);
  neon(21, 5.2, 15.8, 5, 2.4, 0x2ff5ff);
  neon(-11.7, 2.2, 2, 5.6, 0.5, 0x2ff5ff, Math.PI / 2);
  neon(11.7, 2.2, -2, 5.6, 0.5, 0xff2fa8, Math.PI / 2);
  for (const [x, z, c] of [[-21, -12, 0xff2fa8], [21, 12, 0x2ff5ff]]) { const l = new THREE.PointLight(c, 55, 30, 1.5); l.position.set(B.p(x), 5, B.p(z)); B.deco(l); }
  const l2 = new THREE.PointLight(0x8fa8ff, 30, 24, 1.5); l2.position.set(0, 7, 0); B.deco(l2);

  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, dist = 55 + r() * 150;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
    const w = 10 + r() * 18, d = 10 + r() * 18, h = -10 + r() * 70;
    B.box(x - w / 2, -80, z - d / 2, x + w / 2, h, z + d / 2, 'facade', { deco: true, shadow: false });
    if (r() < 0.25) neon(x, h + 3, z, w * 0.7, 3, r() < 0.5 ? 0xff2fa8 : 0x2ff5ff, Math.atan2(-x, -z));
  }

  return {
    name: 'Skyline', B,
    bounds: { minX: -27.5, maxX: 27.5, minZ: -17.5, maxZ: 17.5, maxY: 8 },
    killY: -15,
    spawns: [[-25, 0, 0], [-24, 0, 13], [-21, 3.1, -13], [-14, 0, -14]],
    pickups: [[0, 4, 0], [-22, 0, 15], [-8, 0, 3]],
    sites: [{ name: 'A', x: [12, 22], z: [5, 15] }, { name: 'B', x: [12, 22], z: [-16, -6] }],
    env: { top: 0x04050d, bottom: 0x2a2150, fog: [0x120f2a, 45, 230], sun: [0.4, 1, -0.3], sunColor: 0xa8bcff, sunI: 1.3, hemi: [0x6070b8, 0x201830, 1.4], exposure: 1.15, stars: true, sunAmt: 0.3, envI: 0.25 }
  };
}

function canyon() {
  const B = new Builder(1.45);
  B.sym(-31, -30, -19, -4, -0.4, 19, 'rock');
  B.sym(-31, -0.4, -19, -4, 0, 19, 'sand');
  B.box(-4, -32, -19, 4, -30, 19, 'sand', { deco: true });
  B.box(-4, -0.35, -1.5, 4, 0, 1.5, 'planks');
  B.sym(-4, -0.35, 10, 4, 0, 12.2, 'planks');
  const post = new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 0.9 });
  const rope = new THREE.MeshStandardMaterial({ color: 0xa88a5a, roughness: 1 });
  for (const [z0, z1] of [[-1.5, 1.5], [10, 12.2], [-12.2, -10]]) {
    const zc = B.p((z0 + z1) / 2), hw = Math.abs(z1 - z0) / 2;
    for (const z of [zc - hw, zc + hw]) {
      for (const x of [-4, 4]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.3, 8), post); p.position.set(B.p(x), 0.6, z); p.castShadow = true; B.deco(p); }
      const rr = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 8 * B.S, 6), rope); rr.rotation.z = Math.PI / 2; rr.position.set(0, 1.0, z); B.deco(rr);
    }
  }
  B.sym(-32, -30, 18, 32, 14, 21, 'rock');
  B.sym(-33, -30, -19, -30, 14, 19, 'rock');
  B.sym(-31, 14, 17, 31, 16, 21, 'rock', { deco: true });

  B.sym(-12, 0, -5, -9.5, 1.8, -2.5, 'rock');
  B.sym(-8, 0, 4, -6.2, 1.1, 6, 'rock');
  B.sym(-20, 0, 2, -17, 2.4, 5, 'rock');
  B.sym(-6.6, 0, -4, -5.9, 1.1, -1, 'sand');
  B.sym(-14, 0, 8, -12.5, 3.2, 9.5, 'rock');
  B.sym(-29.9, 0, 8, -20, 2.4, 17.9, 'rock');
  B.stairs(-20, 8, -16, 10, 0, 2.4, '-x', 'rock', true);
  B.sym(-24, 0, -12.5, -19, 3, -12, 'wall');
  B.sym(-24, 0, -12, -23.5, 3, -5.5, 'wall');
  B.sym(-17.5, 0, -12.5, -16, 3, -12, 'wall');
  B.sym(-16.5, 0, -12, -16, 3, -9, 'wall');
  B.sym(-24, 3, -12.5, -20.5, 3.3, -8.5, 'planks');
  B.sym(-10, 0, 13, -8.6, 1.5, 14.4, 'rock');
  B.sym(-18, 0, -1, -16.8, 1.2, 0.2, 'rock');

  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, dist = 80 + r() * 140;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist, w = 20 + r() * 40, h = 10 + r() * 45;
    B.box(x - w / 2, -30, z - w / 2, x + w / 2, h, z + w / 2, 'rock', { deco: true, shadow: false });
  }

  return {
    name: 'Canyon', B,
    bounds: { minX: -29.5, maxX: 29.5, minZ: -17.5, maxZ: 17.5, maxY: 8 },
    killY: -12,
    spawns: [[-27, 0, 0], [-26, 0, -15], [-24, 2.4, 13], [-14, 0, 15]],
    pickups: [[0, 0, 0], [-25, 2.4, 16], [-20, 0, -9]],
    sites: [{ name: 'A', x: [11, 20], z: [3, 12] }, { name: 'B', x: [11, 20], z: [-15, -6] }],
    env: { top: 0x3f86d8, bottom: 0xf5d3a8, fog: [0xe5c49c, 70, 300], sun: [0.6, 0.9, 0.25], sunColor: 0xfff0d8, sunI: 3.0, hemi: [0xc8dcff, 0x9a6a40, 1.2], exposure: 1.0, sunAmt: 1 }
  };
}

function harbor() {
  const B = new Builder(1.25);
  B.box(-46, -3, -27, 46, 0, 27, 'concrete');
  B.sym(-46, 0, 26.6, 46, 0.4, 27, 'metal');
  const water = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ color: 0x1b4a66, roughness: 0.12, metalness: 0.35 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -1.4; water.receiveShadow = true; B.deco(water);

  B.sym(-46, 0, -12.5, -45, 8, 12.5, 'wall');
  B.sym(-46, 0, -12.5, -34, 8, -12, 'wall');
  B.sym(-46, 0, 12, -34, 8, 12.5, 'wall');
  B.sym(-34.5, 0, -12, -34, 8, -9, 'wall');
  B.sym(-34.5, 0, -5, -34, 8, 5, 'wall');
  B.sym(-34.5, 0, 9, -34, 8, 12, 'wall');
  B.sym(-34.5, 3.6, -9, -34, 8, -5, 'wall');
  B.sym(-34.5, 3.6, 5, -34, 8, 9, 'wall');
  B.sym(-46, 8, -12.5, -34, 8.4, 12.5, 'metal');
  B.sym(-44, 0, -11, -42.8, 1.2, -9.8, 'crate');
  B.sym(-44, 0, 9.8, -42.8, 1.2, 11, 'crate');
  B.sym(-37.5, 0, -1.5, -36.3, 1.2, 1.5, 'crate');
  lamp(B, -40, 7.6, 0, 0xffe0b0, true, 35);
  lamp(B, 40, 7.6, 0, 0xffe0b0, true, 35);

  B.sym(-28, 0, -20, -22, 2.6, -17.5, 'container', { tint: 0xc0402c });
  B.sym(-28, 0, -17.5, -22, 2.6, -15, 'container', { tint: 0x2e64c4 });
  B.sym(-24, 0, 4, -21.5, 2.6, 10, 'container', { tint: 0x2f8a4a });
  B.sym(-16, 0, -10, -13.5, 2.6, -4, 'container', { tint: 0xd97a1f });
  B.sym(-14, 0, 14, -8, 2.6, 16.5, 'container', { tint: 0x2e64c4 });
  B.sym(-14, 2.6, 14, -8, 5.2, 16.5, 'container', { tint: 0xc0402c });
  B.stairs(-8, 14, -2, 16.5, 0, 5.2, '-x', 'metal', true);
  B.box(-3, 0, -1.3, 3, 2.6, 1.3, 'container', { tint: 0xe0b42a });
  B.sym(-4.4, 0, -2.6, -3.2, 1.2, -1.4, 'crate');
  B.sym(-10.5, 0, 2, -9.5, 1.3, 6, 'metal');
  B.sym(-30.5, 0, -4, -29.3, 1.2, -2.8, 'crate');
  B.sym(-19.2, 0, 19, -18, 1.2, 20.2, 'crate');
  B.sym(-19, 1.2, 19.2, -18, 2.2, 20.2, 'crate');
  B.sym(-12.2, 0, -21, -11, 1.2, -19.8, 'crate');
  B.sym(-30, 0, 16, -27.5, 2.6, 22, 'container', { tint: 0x7a3fb0 });
  B.sym(-22, 0, -2, -20.8, 1.2, -0.8, 'crate');

  for (const z of [-24, -18]) B.sym(-6.5, 0, z - 0.5, -5.5, 12, z + 0.5, 'metal');
  B.sym(-6.5, 12, -25, -5.5, 13, -17, 'metal', { deco: true });
  B.box(-6.5, 12.5, -22, 6.5, 13.2, -20, 'metal', { deco: true });
  B.box(-6.5, 12.5, 20, 6.5, 13.2, 22, 'metal', { deco: true });

  B.box(-40, -4, 36, 20, 6, 50, 'metal', { deco: true, tint: 0x8a2a2a, shadow: false });
  B.box(-10, 6, 38, 10, 14, 48, 'wall', { deco: true, shadow: false });
  B.box(-20, -4, -50, 40, 5, -36, 'metal', { deco: true, tint: 0x2a4a8a, shadow: false });
  for (const x of [-24, 0, 24]) for (const z of [-25.5, 25.5]) lamp(B, x, 6, z, 0xffe0b0, false);

  return {
    name: 'Harbor', B,
    bounds: { minX: -45.5, maxX: 45.5, minZ: -26.5, maxZ: 26.5, maxY: 8 },
    killY: -5,
    spawns: [[-40, 0, -7], [-40, 0, 7], [-42, 0, -4], [-42, 0, 4]],
    pickups: [[-18, 0, 0], [0, 0, -21]],
    sites: [{ name: 'A', x: [18, 30], z: [6, 18] }, { name: 'B', x: [18, 30], z: [-18, -6] }],
    env: { top: 0x5a7fa8, bottom: 0xf2c38a, fog: [0xa9a39a, 70, 280], sun: [-0.3, 0.55, 0.6], sunColor: 0xffd6a0, sunI: 2.7, hemi: [0xb8ccff, 0x6a5a48, 1.25], exposure: 1.0, sunAmt: 1 }
  };
}

function citadel() {
  const B = new Builder(1.25);
  const stone = 0xdcc29a, dark = 0xb89a78;
  B.box(-44, -1, -30, 44, 0, 30, 'floorTiles', { tint: stone });
  B.sym(-44, 0, 28, 44, 10, 30, 'wall', { tint: dark });
  B.sym(-44, 0, -28, -42, 10, 28, 'wall', { tint: dark });

  B.sym(-32.5, 0, -28, -32, 6, -16, 'wall', { tint: dark });
  B.sym(-32.5, 0, -12, -32, 6, -2, 'wall', { tint: dark });
  B.sym(-32.5, 0, 2, -32, 6, 12, 'wall', { tint: dark });
  B.sym(-32.5, 0, 16, -32, 6, 28, 'wall', { tint: dark });

  B.box(-10, 0, -10, 10, 2.4, 10, 'concrete', { tint: stone });
  B.stairs(-14, -3, -10, 3, 0, 2.4, '+x', 'concrete', true);
  B.stairs(-3, 10, 3, 14, 0, 2.4, '-z', 'concrete', true);
  B.box(-1.3, 2.4, -1.3, 1.3, 6.5, 1.3, 'wall', { tint: dark });
  B.sym(-8, 2.4, -8, -7, 6.5, -7, 'wall', { tint: dark });
  B.sym(-8, 2.4, 7, -7, 6.5, 8, 'wall', { tint: dark });
  B.sym(-10, 2.4, -10, -4, 3.3, -9.6, 'concrete', { tint: dark });
  B.sym(4, 2.4, -10, 10, 3.3, -9.6, 'concrete', { tint: dark });
  B.sym(-10, 2.4, -9.6, -9.6, 3.3, -4, 'concrete', { tint: dark });
  B.sym(-10, 2.4, 4, -9.6, 3.3, 9.6, 'concrete', { tint: dark });

  for (let x = -26; x <= 26; x += 6.5) B.sym(x - 0.5, 0, 20.5, x + 0.5, 3.3, 21.5, 'wall', { tint: stone });
  B.sym(-26, 3.3, 20.5, 26, 3.6, 28, 'concrete', { tint: stone });
  B.stairs(-30, 23, -26, 28, 0, 3.6, '+x', 'concrete', true);
  B.sym(-26, 3.6, 20.4, -8, 4.5, 20.8, 'concrete', { tint: dark });
  B.sym(8, 3.6, 20.4, 26, 4.5, 20.8, 'concrete', { tint: dark });

  B.sym(-22, 0, -14, -21, 2.2, -8, 'wall', { tint: dark });
  B.sym(-18, 0, 6, -12, 2.2, 7, 'wall', { tint: dark });
  B.sym(-26, 0, -4, -24.5, 3, -2.5, 'wall', { tint: stone });
  B.sym(-20, 0, 0, -18.8, 1.2, 1.2, 'crate');
  B.sym(-16, 0, -20, -14.8, 1.2, -18.8, 'crate');
  B.sym(-28, 0, 8, -26.8, 1.2, 9.2, 'crate');
  B.sym(-36, 0, -1.5, -35, 1.4, 1.5, 'wall', { tint: stone });

  const fire = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff7a2a, emissiveIntensity: 3 });
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, metalness: 0.6, roughness: 0.5 });
  for (const [x0, z0] of [[-9, -9], [9, 9], [-9, 9], [9, -9]]) {
    const x = B.p(x0), z = B.p(z0);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.25, 0.4, 12), bowlMat);
    bowl.position.set(x, 3.6, z); B.deco(bowl);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 8), fire); f.position.set(x, 4.05, z); B.deco(f);
    const l = new THREE.PointLight(0xff8a3a, 30, 16, 1.6); l.position.set(x, 4.6, z); B.deco(l);
  }
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 24; i++) {
    const a = r() * Math.PI * 2, dist = 110 + r() * 120, w = 30 + r() * 40, h = 20 + r() * 50;
    const cx = Math.cos(a) * dist, cz = Math.sin(a) * dist;
    B.box(cx - w / 2, -20, cz - w / 2, cx + w / 2, h, cz + w / 2, 'rock', { deco: true, shadow: false });
  }

  return {
    name: 'Citadel', B,
    bounds: { minX: -41.5, maxX: 41.5, minZ: -27.5, maxZ: 27.5, maxY: 8 },
    killY: -10,
    spawns: [[-38, 0, -5], [-38, 0, 5], [-40, 0, -12], [-40, 0, 12]],
    pickups: [[0, 2.4, 5], [-20, 3.6, 25]],
    sites: [{ name: 'A', x: [14, 26], z: [8, 18] }, { name: 'B', x: [14, 26], z: [-18, -8] }],
    env: { top: 0x2b2f5a, bottom: 0xf08a5a, fog: [0x6a4a4a, 65, 280], sun: [0.7, 0.35, -0.3], sunColor: 0xffa070, sunI: 2.5, hemi: [0x8a90d0, 0x5a3a2a, 1.25], exposure: 1.05, sunAmt: 1 }
  };
}

// A Valorant-style attack/defend map: three lanes (A long, Mid, B long) feeding two bomb sites
// on the defenders' (east) side.
function bastion() {
  const B = new Builder(1);
  const floor = 0xd9d0c1, plaster = 0xeadfcc, trim = 0xb9a68a;
  B.box(-58, -1, -42, 58, 0, 42, 'floorTiles', { tint: floor });
  B.box(-58, 0, -42, 58, 9, -40, 'wall', { tint: trim }); B.box(-58, 0, 40, 58, 9, 42, 'wall', { tint: trim });
  B.box(-58, 0, -40, -56, 9, 40, 'wall', { tint: trim }); B.box(56, 0, -40, 58, 9, 40, 'wall', { tint: trim });
  const bld = (x0, z0, x1, z1, h = 7) => {
    B.box(x0, 0, z0, x1, h, z1, 'concrete', { tint: plaster });
    B.box(x0 - 0.1, h, z0 - 0.1, x1 + 0.1, h + 0.35, z1 + 0.1, 'wall', { tint: trim, deco: true });
  };

  // Blocks between the lanes (with "short" gaps connecting mid to each long)
  bld(-42, 8, -22, 26); bld(-17, 8, 10, 26);
  bld(-42, -26, -22, -8); bld(-17, -26, 10, -8);
  // Central defender block separating the sites
  bld(16, -16, 40, 16, 8);
  // Mid: door choke and cover
  B.box(-6, 0, -8, -3, 5, -2, 'concrete', { tint: plaster });
  B.box(-6, 0, 2, -3, 5, 8, 'concrete', { tint: plaster });
  B.box(-30, 0, -1.25, -24, 2.6, 1.25, 'container', { tint: 0x2e64c4 });
  B.box(4, 0, -2, 6.4, 1.3, 0.4, 'crate');
  B.box(8, 0, 4, 9.2, 1.2, 5.2, 'crate');
  // A long: zig-zag cover
  B.box(-5, 0, 26, -2, 3, 32, 'concrete', { tint: plaster });
  B.box(6, 0, 34, 9, 3, 40, 'concrete', { tint: plaster });
  B.box(-32, 0, 30, -30.8, 1.2, 31.2, 'crate');
  B.box(-31.8, 1.2, 30.2, -30.9, 2.1, 31.1, 'crate');
  // B long: different shapes
  B.box(-8, 0, -34, -2, 2.6, -31.5, 'container', { tint: 0xc0402c });
  B.box(4, 0, -40, 7, 3, -34, 'concrete', { tint: plaster });
  B.box(-28, 0, -33, -26.8, 1.2, -31.8, 'crate');

  // A site: boxes + "heaven" platform with stairs
  B.box(24, 0, 23, 26.4, 1.8, 25.4, 'crate');
  B.box(24, 1.8, 23.3, 25.2, 3.0, 24.5, 'crate');
  B.box(31, 0, 29, 33.4, 1.2, 31.4, 'crate');
  B.box(19, 0, 32, 21.5, 2.6, 38, 'container', { tint: 0x2f8a4a });
  B.box(44, 3.2, 30, 55.9, 3.5, 39.9, 'grate');
  B.box(44, 3.5, 29.8, 49.8, 4.4, 30, 'metal');
  B.stairs(50, 18, 55.9, 30, 0, 3.2, '+z', 'metal');
  for (const x of [44.3, 49.5]) B.box(x - 0.2, 0, 30.2, x + 0.2, 3.2, 30.6, 'metal');
  // B site: stack + tower
  B.box(26, 0, -28, 29, 2.6, -24, 'container', { tint: 0xd97a1f });
  B.box(26.5, 2.6, -27, 28.5, 3.8, -25, 'crate');
  B.box(33, 0, -35, 34.2, 1.2, -33.8, 'crate');
  B.box(20, 0, -22, 21.2, 1.2, -20.8, 'crate');
  B.box(44, 0, -40, 48, 5, -34, 'concrete', { tint: plaster });
  B.box(44, 0, -24, 46.4, 1.2, -21.6, 'crate');
  // Defender spawn cover
  B.box(46, 0, -2, 47.2, 1.2, 2, 'metal');

  // Deco: plants, banners, lamps
  for (const [x, z] of [[-45, 30], [-45, -30], [12, 30], [12, -30], [52, 12], [52, -12], [-14, 3]]) plant(B, x, z);
  const banner = (x, z, ry, color) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4), new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide }));
    m.position.set(x, 4.2, z); m.rotation.y = ry; B.deco(m);
  };
  banner(-22.2, 17, Math.PI / 2, 0xff3d5a); banner(-16.8, 17, Math.PI / 2, 0xff3d5a);
  banner(-22.2, -17, Math.PI / 2, 0x3d8dff); banner(-16.8, -17, Math.PI / 2, 0x3d8dff);
  banner(28, 16.1, 0, 0xff3d5a); banner(28, -16.1, 0, 0x3d8dff);
  for (const [x, z] of [[-35, 0], [0, 33], [0, -33], [28, 0.1]]) lamp(B, x, 6.2, z, 0xfff0d0, false);

  return {
    name: 'Bastion', B,
    bounds: { minX: -55.5, maxX: 55.5, minZ: -39.5, maxZ: 39.5, maxY: 6 },
    killY: -10,
    spawns: [[-50, 0, -4], [-50, 0, 4], [-48, 0, -8], [-48, 0, 8]],
    pickups: [[-20, 0, 34], [0, 0, 0]],
    sites: [{ name: 'A', x: [20, 38], z: [20, 36] }, { name: 'B', x: [20, 38], z: [-36, -20] }],
    env: { top: 0x5f9be0, bottom: 0xf6e4c8, fog: [0xd8cdb8, 90, 320], sun: [0.45, 0.85, 0.35], sunColor: 0xfff1d6, sunI: 3.0, hemi: [0xcfe0ff, 0x9a8a70, 1.2], exposure: 1.0, sunAmt: 1 }
  };
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
  { id: 0, name: 'Bastion', size: 'Large', desc: 'Attack/defend map: A long, Mid and B long into two sites.', build: bastion },
  { id: 1, name: 'Foundry', size: 'Medium', desc: 'Warehouse at sunset. Catwalks, containers, close quarters.', build: foundry },
  { id: 2, name: 'Skyline', size: 'Medium', desc: "Rooftop at night. Neon, long sightlines. Don't fall.", build: skyline },
  { id: 3, name: 'Canyon', size: 'Medium', desc: 'Desert canyon split by a chasm. Cross the bridges.', build: canyon },
  { id: 4, name: 'Harbor', size: 'Large', desc: 'Container yard between two warehouses.', build: harbor },
  { id: 5, name: 'Citadel', size: 'Large', desc: 'Temple at dusk. Fight for the raised plaza.', build: citadel }
];
export const RANGE_MAP = { id: 99, name: 'Range', size: 'Practice', desc: 'Practice range', build: range };
export const mapById = id => (id === 99 ? RANGE_MAP : MAPS.find(m => m.id === id) || MAPS[0]);

// Build a full map: scene objects + collision world + nav graph.
export function buildMap(index, scene, quality) {
  const def = mapById(index).build();
  const { B, env } = def;
  const S = B.S;
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
  const base = def.spawns.map(sp3).map(fixSpawn);
  // Team 0 spawns west (x<0), team 1 gets the point-mirrored spots east.
  const teamSpawns = [base, base.map(p => fixSpawn([-p[0], p[1], -p[2]]))];
  const spawns = [...teamSpawns[0], ...teamSpawns[1]];
  const pickups = [];
  for (const p0 of def.pickups) {
    const p = sp3(p0);
    pickups.push(p);
    if (p[0] !== 0 || p[2] !== 0) pickups.push([-p[0], p[1], -p[2]]);
  }

  // Spawn zone for the buy-phase barrier: the box around the first two spawns, padded.
  const sp = base.slice(0, 2), pad = 3;
  const z0 = {
    minX: Math.max(bounds.minX - 1, Math.min(...sp.map(p => p[0])) - pad), maxX: Math.max(...sp.map(p => p[0])) + pad,
    minZ: Math.max(bounds.minZ - 1, Math.min(...sp.map(p => p[2])) - pad), maxZ: Math.min(bounds.maxZ + 1, Math.max(...sp.map(p => p[2])) + pad),
    y: Math.min(...sp.map(p => p[1]))
  };
  const spawnZones = [z0, { minX: -z0.maxX, maxX: -z0.minX, minZ: -z0.maxZ, maxZ: -z0.minZ, y: z0.y }];

  // Bomb sites (defenders' side is east / x > 0)
  const sites = (def.sites || []).map(s => ({
    name: s.name, minX: s.x[0] * S, maxX: s.x[1] * S, minZ: s.z[0] * S, maxZ: s.z[1] * S, y: s.y ?? 0,
    cx: (s.x[0] + s.x[1]) / 2 * S, cz: (s.z[0] + s.z[1]) / 2 * S
  }));
  const dummies = (def.dummies || []).map(d => ({ pos: [d[0], d[1], d[2]], kind: d[3] }));

  return { name: def.name, group: B.group, sky, world, spawns, teamSpawns, spawnZones, sites, dummies, pickups, killY: def.killY, bounds, env, lights: [hemi, sun] };
}
