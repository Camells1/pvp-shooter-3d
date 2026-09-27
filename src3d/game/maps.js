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

class Builder {
  constructor() {
    this.group = new THREE.Group();
    this.boxes = [];
  }
  box(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)];
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
  sym(x0, y0, z0, x1, y1, z1, mat, o) {
    this.box(x0, y0, z0, x1, y1, z1, mat, o);
    this.box(-x0, y0, -z0, -x1, y1, -z1, mat, o);
  }
  // Solid staircase. Rises toward `dir` ('+x','-x','+z','-z') across the footprint.
  stairs(x0, z0, x1, z1, y0, y1, dir, mat, mirror = false) {
    const n = Math.ceil((y1 - y0) / 0.3), rise = (y1 - y0) / n;
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
    const along = dir[1] === 'x' ? bx - ax : bz - az, run = along / n;
    for (let i = 0; i < n; i++) {
      const top = y0 + rise * (i + 1);
      let sx0 = ax, sx1 = bx, sz0 = az, sz1 = bz;
      if (dir === '+x') sx0 = ax + run * i;
      if (dir === '-x') sx1 = bx - run * i;
      if (dir === '+z') sz0 = az + run * i;
      if (dir === '-z') sz1 = bz - run * i;
      (mirror ? this.sym : this.box).call(this, sx0, y0, sz0, sx1, top, sz1, mat);
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
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 4 }));
  m.position.set(x, y, z); B.deco(m);
  const hous = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.7), new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.7, roughness: 0.4 }));
  hous.position.set(x, y + 0.15, z); B.deco(hous);
  if (light) { const l = new THREE.PointLight(color, intensity, 22, 1.6); l.position.set(x, y - 0.4, z); B.deco(l); }
}

// ---------------------------------------------------------------- Maps
function foundry() {
  const B = new Builder();
  B.box(-31, -1, -21, 31, 0, 21, 'floorTiles');
  B.box(-31, 0, -21, 31, 10, -20, 'wall'); B.box(-31, 0, 20, 31, 10, 21, 'wall');
  B.box(-31, 0, -20, -30, 10, 20, 'wall'); B.box(30, 0, -20, 31, 10, 20, 'wall');
  B.box(-31, 10, -21, 31, 10.4, -18, 'metal', { deco: true }); B.box(-31, 10, 18, 31, 10.4, 21, 'metal', { deco: true });

  // Catwalks with stairs (N east end / S west end) and railings
  B.sym(-18, 3.3, 13, 18, 3.6, 17, 'grate');
  B.sym(-18, 3.6, 12.85, -4, 4.6, 13, 'metal');
  B.sym(4, 3.6, 12.85, 18, 4.6, 13, 'metal');
  for (const x of [-12, 0, 12]) B.sym(x - 0.25, 0, 14.75, x + 0.25, 3.3, 15.25, 'metal');
  B.stairs(18, 13, 24, 17, 0, 3.6, '-x', 'metal', true);
  // Crate parkour to the other end of each catwalk
  B.sym(-23.6, 0, 14, -22.4, 1.2, 15.2, 'crate');
  B.sym(-21.8, 0, 13.8, -18.2, 2.4, 16.2, 'crate');

  // Center platform
  B.box(-5, 0, -5, 5, 1.2, 5, 'concrete');
  B.sym(-6.2, 0, -2, -5, 0.6, 2, 'metal');
  B.sym(-4, 1.2, 3.6, 4, 2.1, 4, 'metal');
  B.box(-0.6, 1.2, -0.6, 0.6, 2.4, 0.6, 'crate');

  // Containers
  B.sym(-15, 0, -9.5, -9, 2.6, -7, 'container', { tint: 0xc0402c });
  B.sym(-17, 0, 3, -14.5, 2.6, 9, 'container', { tint: 0x2e64c4 });
  B.sym(-9, 0, -9.5, -7.8, 1.2, -8.3, 'crate');
  B.sym(-8, 0, 6.5, -5.5, 2.6, 12.4, 'container', { tint: 0x2f8a4a });

  // Crates
  B.sym(-22.6, 0, -6.6, -21.4, 1.2, -5.4, 'crate');
  B.sym(-11, 0, 0.4, -9.8, 1.2, 1.6, 'crate');
  B.sym(-10.4, 1.2, 0.8, -9.4, 2.2, 1.8, 'crate');
  B.sym(-24.6, 0, 1.8, -24, 1.4, 5, 'metal');
  B.sym(-22, 0, 5, -20.8, 1.2, 6.2, 'crate');
  B.sym(-3, 0, -13, -1.8, 1.2, -11.8, 'crate');

  // Deco: roof trusses, pipes, lamps
  for (let x = -27; x <= 27; x += 9) {
    B.box(x - 0.2, 9.6, -20, x + 0.2, 10, 20, 'metal', { deco: true, shadow: false });
  }
  for (const z of [-19.6, 19.6]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 60, 12), new THREE.MeshStandardMaterial({ color: 0x8a5a2a, metalness: 0.7, roughness: 0.4 }));
    pipe.rotation.z = Math.PI / 2; pipe.position.set(0, 7.5, z); B.deco(pipe);
  }
  for (const x of [-18, 0, 18]) for (const z of [-8, 8]) lamp(B, x, 9.4, z, 0xffd9a0, true, 40);

  return {
    name: 'Foundry', B,
    bounds: { minX: -29.5, maxX: 29.5, minZ: -19.5, maxZ: 19.5, maxY: 8 },
    killY: -10,
    spawns: [[-27, 0, 0], [-27, 0, -10], [-26, 0, 10], [-12, 3.6, -15]],
    pickups: [[0, 1.2, 0], [-15, 3.6, -15], [-27, 0, 16]],
    env: { top: 0x2d4f86, bottom: 0xe9a36b, fog: [0x6b5b52, 45, 140], sun: [-0.5, 0.8, 0.3], sunColor: 0xffc58a, sunI: 2.6, hemi: [0xa8c4ff, 0x6a5040, 1.25], exposure: 1.05, sunAmt: 1 }
  };
}

function skyline() {
  const B = new Builder();
  B.box(-28, -2, -18, 28, 0, 18, 'tar');
  B.box(-28, -40, -18, 28, -2, 18, 'facade', { deco: true, shadow: false });
  B.box(-28.4, 0, -18.4, 28.4, 1, -17.6, 'concrete'); B.box(-28.4, 0, 17.6, 28.4, 1, 18.4, 'concrete');
  B.box(-28.4, 0, -17.6, -27.6, 1, 17.6, 'concrete'); B.box(27.6, 0, -17.6, 28.4, 1, 17.6, 'concrete');

  // Center tower + stairs + parapets
  B.box(-3, 0, -3, 3, 4, 3, 'wall');
  B.stairs(3, -3, 9, -1, 0, 4, '-x', 'concrete', true);
  B.sym(2.8, 4, -1, 3, 4.8, 3, 'metal');
  B.sym(-3, 4, 2.8, 3, 4.8, 3, 'metal');
  B.box(-1.4, 4, -1.4, 1.4, 4.2, 1.4, 'pad', { deco: true, shadow: false });

  // Billboard platform with block steps
  B.sym(-24, 2.8, -16, -18, 3.1, -10, 'grate');
  B.sym(-24, 0, -10, -22, 2.0, -8.5, 'metal');
  B.sym(-24, 0, -8.5, -22, 1.0, -7, 'metal');
  B.sym(-24, 3.1, -16.2, -18, 7, -15.9, 'metal');
  for (const x of [-23.7, -18.3]) for (const z of [-15.7, -10.3]) B.sym(x - 0.15, 0, z - 0.15, x + 0.15, 2.8, z + 0.15, 'metal');

  // Cover
  B.sym(-18, 0, -8, -15.5, 1.5, -6, 'metal');
  B.sym(-20, 0, 6, -18, 1.4, 9, 'metal');
  B.sym(-10, 0, 10, -9, 2.2, 11, 'metal');
  B.sym(-12, 0, -1, -11.4, 3.2, 5, 'metal');
  B.sym(-14, 0, -6, -10, 0.8, -2, 'metal');
  B.sym(-7, 0, -12, -4, 1.3, -10.5, 'concrete');
  B.sym(-25, 0, 3, -24, 1.8, 7, 'concrete');

  // Neon signs (deco)
  const neon = (x, y, z, w, h, color, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x050505, emissive: color, emissiveIntensity: 3.5, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry; B.deco(m);
    return m;
  };
  neon(-21, 5.2, -15.8, 5, 2.4, 0xff2fa8);
  neon(21, 5.2, 15.8, 5, 2.4, 0x2ff5ff);
  neon(-11.7, 2.2, 2, 5.6, 0.5, 0x2ff5ff, Math.PI / 2);
  neon(11.7, 2.2, -2, 5.6, 0.5, 0xff2fa8, Math.PI / 2);
  for (const [x, z, c] of [[-21, -12, 0xff2fa8], [21, 12, 0x2ff5ff]]) { const l = new THREE.PointLight(c, 45, 25, 1.5); l.position.set(x, 5, z); B.deco(l); }
  const l2 = new THREE.PointLight(0x8fa8ff, 25, 20, 1.5); l2.position.set(0, 7, 0); B.deco(l2);

  // Surrounding city
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
    env: { top: 0x04050d, bottom: 0x2a2150, fog: [0x120f2a, 35, 190], sun: [0.4, 1, -0.3], sunColor: 0xa8bcff, sunI: 1.3, hemi: [0x6070b8, 0x201830, 1.4], exposure: 1.15, stars: true, sunAmt: 0.3, envI: 0.25 }
  };
}

function canyon() {
  const B = new Builder();
  // Plateaus
  B.sym(-31, -30, -19, -4, -0.4, 19, 'rock');
  B.sym(-31, -0.4, -19, -4, 0, 19, 'sand');
  B.box(-4, -32, -19, 4, -30, 19, 'sand', { deco: true });
  // Bridges
  B.box(-4, -0.35, -1.5, 4, 0, 1.5, 'planks');
  B.sym(-4, -0.35, 10, 4, 0, 12.2, 'planks');
  const post = new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 0.9 });
  const rope = new THREE.MeshStandardMaterial({ color: 0xa88a5a, roughness: 1 });
  for (const [z0, z1] of [[-1.5, 1.5], [10, 12.2], [-12.2, -10]]) {
    for (const z of [z0, z1]) {
      for (const x of [-4, 4]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.3, 8), post); p.position.set(x, 0.6, z); p.castShadow = true; B.deco(p); }
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 8, 6), rope); r.rotation.z = Math.PI / 2; r.position.set(0, 1.0, z); B.deco(r);
    }
  }
  // Cliffs
  B.sym(-32, -30, 18, 32, 14, 21, 'rock');
  B.sym(-33, -30, -19, -30, 14, 19, 'rock');
  B.sym(-31, 14, 17, 31, 16, 21, 'rock', { deco: true });

  // Rock cover
  B.sym(-12, 0, -5, -9.5, 1.8, -2.5, 'rock');
  B.sym(-8, 0, 4, -6.2, 1.1, 6, 'rock');
  B.sym(-20, 0, 2, -17, 2.4, 5, 'rock');
  B.sym(-6.6, 0, -4, -5.9, 1.1, -1, 'sand');
  B.sym(-14, 0, 8, -12.5, 3.2, 9.5, 'rock');
  // Mesa ledge with rock stairs
  B.sym(-29.9, 0, 8, -20, 2.4, 17.9, 'rock');
  B.stairs(-20, 8, -16, 10, 0, 2.4, '-x', 'rock', true);
  // Ruin
  B.sym(-24, 0, -12.5, -19, 3, -12, 'wall');
  B.sym(-24, 0, -12, -23.5, 3, -5.5, 'wall');
  B.sym(-17.5, 0, -12.5, -16, 3, -12, 'wall');
  B.sym(-16.5, 0, -12, -16, 3, -9, 'wall');
  B.sym(-24, 3, -12.5, -20.5, 3.3, -8.5, 'planks');

  // Distant mesas (deco)
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
    env: { top: 0x3f86d8, bottom: 0xf5d3a8, fog: [0xe5c49c, 60, 260], sun: [0.6, 0.9, 0.25], sunColor: 0xfff0d8, sunI: 3.0, hemi: [0xc8dcff, 0x9a6a40, 1.2], exposure: 1.0, sunAmt: 1 }
  };
}

export const MAPS = [
  { id: 0, name: 'Foundry', desc: 'Warehouse at sunset. Catwalks, containers, close quarters.', build: foundry },
  { id: 1, name: 'Skyline', desc: 'Rooftop at night. Neon, long sightlines. Don\'t fall.', build: skyline },
  { id: 2, name: 'Canyon', desc: 'Desert canyon split by a chasm. Cross the bridges.', build: canyon }
];

// Build a full map: scene objects + collision world + nav graph.
export function buildMap(index, scene, quality) {
  const def = MAPS[index].build();
  const { B, env } = def;
  scene.add(B.group);

  const sky = skyDome(env.top, env.bottom, { stars: env.stars, sun: env.sun, sunColor: env.sunColor, sunAmt: env.sunAmt });
  scene.add(sky);
  scene.fog = new THREE.Fog(env.fog[0], env.fog[1], env.fog[2]);

  const hemi = new THREE.HemisphereLight(env.hemi[0], env.hemi[1], env.hemi[2]);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(env.sunColor, env.sunI);
  const sd = new THREE.Vector3(...env.sun).normalize();
  sun.position.copy(sd).multiplyScalar(60);
  sun.castShadow = quality !== 'low';
  const sm = quality === 'high' ? 4096 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const c = sun.shadow.camera;
  c.left = -40; c.right = 40; c.top = 40; c.bottom = -40; c.near = 1; c.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const world = new World(B.boxes);
  world.buildNav(def.bounds);

  // Mirror spawns / pickups for the other side
  const spawns = [];
  for (const p of def.spawns) spawns.push(p, [-p[0], p[1], -p[2]]);
  const pickups = [];
  for (const p of def.pickups) {
    pickups.push(p);
    if (p[0] !== 0 || p[2] !== 0) pickups.push([-p[0], p[1], -p[2]]);
  }

  return { name: def.name, group: B.group, sky, world, spawns, pickups, killY: def.killY, bounds: def.bounds, env, lights: [hemi, sun] };
}
