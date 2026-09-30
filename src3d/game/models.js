// Procedural character + weapon models with IK arms and procedural animation.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { skinMats } from './skins.js';
import { reloadAnim, makePropMesh } from './reload.js';

// Merge the rigid mesh children of every node that share a material into one mesh per material.
// Guns and characters are built from dozens of small parts; this cuts their draw calls several times over.
// Meshes in `keep` (animated or toggled parts), transparent or ordered meshes, and meshes with children stay as they are.
export function mergeStatic(root, keep = new Set()) {
  const nodes = [];
  root.traverse(o => { if (!o.isMesh) nodes.push(o); });
  for (const node of nodes) {
    const buckets = new Map();
    for (const m of node.children) {
      if (!m.isMesh || m.children.length || keep.has(m) || m.renderOrder || m.material.transparent || !m.visible) continue;
      const g = m.geometry;
      if (!g.attributes.normal || !g.attributes.uv || g.morphAttributes?.position) continue;
      const key = m.material.uuid + '|' + (g.index ? 1 : 0) + '|' + Object.keys(g.attributes).sort().join();
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(m);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = list.map(m => { m.updateMatrix(); const c = m.geometry.clone().applyMatrix4(m.matrix); c.clearGroups(); return c; });
      const merged = mergeGeometries(geos, false);
      for (const c of geos) c.dispose();
      if (!merged) continue;
      merged.userData.merged = true;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list.some(m => m.castShadow); mesh.receiveShadow = true;
      for (const m of list) node.remove(m);
      node.add(mesh);
    }
  }
  return root;
}
// Free geometries created by mergeStatic (the small part geometries are shared and cached)
export function disposeMerged(root) { root?.traverse(o => { if (o.geometry?.userData.merged) o.geometry.dispose(); }); }

const geoCache = new Map();
function rb(w, h, d, r = 0.02) {
  const k = `rb${w},${h},${d},${r}`;
  if (!geoCache.has(k)) geoCache.set(k, new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
  return geoCache.get(k);
}
// Cheaper rounded box (2 segments) for small details on characters
function rbs(w, h, d, r = 0.01) {
  const k = `rbs${w},${h},${d},${r}`;
  if (!geoCache.has(k)) geoCache.set(k, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
  return geoCache.get(k);
}
function caps(r, len) {
  const k = `c${r},${len}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CapsuleGeometry(r, len, 6, 12));
  return geoCache.get(k);
}
// Open-ended tube (you can see through it, e.g. down a scope)
function tube(rt, rb_, h, seg = 16) {
  const k = `tu${rt},${rb_},${h},${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb_, h, seg, 1, true));
  return geoCache.get(k);
}
function cyl(rt, rb_, h, seg = 16) {
  const k = `cy${rt},${rb_},${h},${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb_, h, seg));
  return geoCache.get(k);
}
function sph(r, ws = 20, hs = 14, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) {
  const k = `s${r},${ws},${hs},${ps},${pl},${ts},${tl}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r, ws, hs, ps, pl, ts, tl));
  return geoCache.get(k);
}
function tor(r, t, arc = Math.PI * 2) {
  const k = `t${r},${t},${arc}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.TorusGeometry(r, t, 8, 24, arc));
  return geoCache.get(k);
}

function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

// Sculpted building blocks for the agents. A loft sweeps a superellipse cross-section (n = 2 is round, higher is
// squarer) through rings of [y, halfWidth, halfDepth, zOffset], so torsos, limbs and helmets taper and curve like
// machined shells instead of boxes. With o.arc = [from, to] (fractions of a turn, 0.25 = front, 0 = +X side) it
// builds a curved armor plate of thickness o.t that sits on top of the limb. Closed ends get a small bevel.
const TILE = 0.2; // world size of one armor-detail tile
export function loft(rings, o = {}) {
  const key = 'lo' + JSON.stringify(rings) + JSON.stringify(o);
  if (geoCache.has(key)) return geoCache.get(key);
  const n = o.n ?? 2.6, seg = o.seg ?? 18, e = 2 / n, arc = o.arc;
  const a0 = arc ? arc[0] * Math.PI * 2 : 0, a1 = arc ? arc[1] * Math.PI * 2 : Math.PI * 2;
  const full = a1 - a0 > Math.PI * 2 - 1e-6;
  const pw = v => Math.sign(v) * Math.pow(Math.abs(v), e);
  let rs = rings.map(r => [r[0], r[1], r[2], r[3] || 0]);
  if (rs[rs.length - 1][0] < rs[0][0]) rs.reverse();
  if (!arc && o.cap !== false) {
    const b = o.b ?? 0.006, f = rs[0], l = rs[rs.length - 1];
    if (f[1] > 0.002) rs.splice(0, 1, [f[0], 0, 0, f[3]], [f[0], f[1] - b, f[2] - b, f[3]], [f[0] + b, f[1], f[2], f[3]]);
    if (l[1] > 0.002) rs.splice(rs.length - 1, 1, [l[0] - b, l[1], l[2], l[3]], [l[0], l[1] - b, l[2] - b, l[3]], [l[0], 0, 0, l[3]]);
  }
  const hMax = Math.max(...rs.map(r => r[1] + r[2]));
  const U = Math.max(1, Math.round(Math.PI * hMax * (a1 - a0) / (Math.PI * 2) / TILE));
  const V = Math.max(1, Math.round((rs[rs.length - 1][0] - rs[0][0]) / TILE));
  const P = (r, t, d = 0) => [Math.max(0, r[1] - d) * pw(Math.cos(t)), r[0], Math.max(0, r[2] - d) * pw(Math.sin(t)) + r[3]];
  const build = (pos, uv, idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  // Surface grid over the rings; `inset` shrinks it (inner face of a plate), `flip` turns it inside out
  const grid = (inset, flip) => {
    const pos = [], uv = [], idx = [], R = rs.length;
    rs.forEach((r, i) => { for (let j = 0; j <= seg; j++) { pos.push(...P(r, a0 + (a1 - a0) * j / seg, inset)); uv.push(j / seg * U, i / (R - 1) * V); } });
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 2, d = a + seg + 1;
      if (flip) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c);
    }
    const g = build(pos, uv, idx);
    if (full) { // weld the seam normals
      const nr = g.attributes.normal;
      for (let i = 0; i < R; i++) {
        const p = i * (seg + 1), q = p + seg;
        _sv.set(nr.getX(p) + nr.getX(q), nr.getY(p) + nr.getY(q), nr.getZ(p) + nr.getZ(q)).normalize();
        nr.setXYZ(p, _sv.x, _sv.y, _sv.z); nr.setXYZ(q, _sv.x, _sv.y, _sv.z);
      }
    }
    return g;
  };
  // Edge strip between two point lists, turned to face `dir`
  const strip = (A, B, dir) => {
    const pos = [...A.flat(), ...B.flat()], uv = [], idx = [], m = A.length;
    for (let j = 0; j < m; j++) uv.push(j / (m - 1), 0);
    for (let j = 0; j < m; j++) uv.push(j / (m - 1), 0.05);
    for (let j = 0; j < m - 1; j++) idx.push(j, j + 1, m + j, j + 1, m + j + 1, m + j);
    let sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < idx.length; k += 3) {
      const [p, q, r] = [idx[k], idx[k + 1], idx[k + 2]].map(v => pos.slice(v * 3, v * 3 + 3));
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
      sx += uy * vz - uz * vy; sy += uz * vx - ux * vz; sz += ux * vy - uy * vx;
    }
    if (sx * dir[0] + sy * dir[1] + sz * dir[2] < 0) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    return build(pos, uv, idx);
  };
  let geo;
  if (!arc || !o.t) geo = grid(0, false);
  else {
    const parts = [grid(0, false), grid(o.t, true)], R = rs.length;
    const ring = (i, d) => { const out = []; for (let j = 0; j <= seg; j++) out.push(P(rs[i], a0 + (a1 - a0) * j / seg, d)); return out; };
    parts.push(strip(ring(0, 0), ring(0, o.t), [0, -1, 0]), strip(ring(R - 1, 0), ring(R - 1, o.t), [0, 1, 0]));
    if (!full) {
      const col = (t, d) => rs.map(r => P(r, t, d));
      parts.push(strip(col(a0, 0), col(a0, o.t), [Math.sin(a0), 0, -Math.cos(a0)]), strip(col(a1, 0), col(a1, o.t), [-Math.sin(a1), 0, Math.cos(a1)]));
    }
    geo = mergeGeometries(parts, false);
    parts.forEach(p => p.dispose());
  }
  geoCache.set(key, geo);
  return geo;
}
const _sv = new THREE.Vector3();
// Rounded pebble/block: a closed loft whose rings follow a superellipse vertically too (nv higher = flatter top and bottom)
export function pod(hw, hh, hd, o = {}) {
  const nv = o.nv ?? 2.6, ev = 2 / nv, R = o.rings ?? 10, rings = [];
  for (let i = 0; i <= R; i++) {
    const f = -Math.PI / 2 + Math.PI * i / R, c = Math.cos(f), s = Math.sin(f);
    const k = Math.sign(c) * Math.pow(Math.abs(c), ev);
    rings.push([+(hh * Math.sign(s) * Math.pow(Math.abs(s), ev)).toFixed(5), +(hw * k).toFixed(5), +(hd * k).toFixed(5)]);
  }
  return loft(rings, { n: o.n ?? 2.6, seg: o.seg ?? 16, cap: false });
}
// Plates that hug a core shape: take the core's rings between y0 and y1 and grow them outward
export function band(rs, y0, y1) {
  const at = y => { for (let i = 0; i < rs.length - 1; i++) { const [a, b] = [rs[i], rs[i + 1]]; if (y >= Math.min(a[0], b[0]) && y <= Math.max(a[0], b[0])) { const f = (y - a[0]) / (b[0] - a[0] || 1); return a.map((v, k) => (v ?? 0) + ((b[k] ?? 0) - (v ?? 0)) * f); } } return rs[y < rs[0][0] ? 0 : rs.length - 1]; };
  return [at(y0), ...rs.filter(r => r[0] > y0 && r[0] < y1), at(y1)];
}
export const grow = (rs, dw, dd, dz = 0) => rs.map(([y, w, d, z = 0]) => [+y.toFixed(4), +(w + dw).toFixed(4), +(d + dd).toFixed(4), +(z + dz).toFixed(4)]);
// Mirror a plate's arc for the other side of the body (arcs are measured from +X, 0.25 = front)
const mirArc = (a, s) => s > 0 ? a : [0.5 - a[1], 0.5 - a[0]];
function ell(rx, ry, rz, mat, x = 0, y = 0, z = 0, parent) {
  if (!geoCache.has('ell')) geoCache.set('ell', new THREE.SphereGeometry(1, 18, 12));
  const m = mesh(geoCache.get('ell'), mat, x, y, z, parent);
  m.scale.set(rx, ry, rz);
  return m;
}

// Procedural armor detail: every face of every plate gets an engraved panel border, corner rivets and light scratches.
// Used as a bump + roughness map, so the plates catch light like machined metal instead of plain plastic.
let armorDetail = null;
export function getArmorDetail() {
  if (armorDetail) return armorDetail;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#b4b4b4'; x.fillRect(0, 0, S, S);
  // Grain
  for (let i = 0; i < 2600; i++) { const v = 150 + Math.random() * 60; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5); }
  // Engraved border and inner bevel line
  x.strokeStyle = '#3a3a3a'; x.lineWidth = 5; x.strokeRect(14, 14, S - 28, S - 28);
  x.strokeStyle = '#e4e4e4'; x.lineWidth = 2; x.strokeRect(22, 22, S - 44, S - 44);
  // Rivets
  for (const [px, py] of [[34, 34], [S - 34, 34], [34, S - 34], [S - 34, S - 34]]) {
    x.fillStyle = '#ffffff'; x.beginPath(); x.arc(px, py, 5, 0, 7); x.fill();
    x.fillStyle = '#5a5a5a'; x.beginPath(); x.arc(px, py, 2, 0, 7); x.fill();
  }
  // Scratches
  x.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    x.strokeStyle = Math.random() < 0.5 ? '#d8d8d8' : '#6a6a6a';
    const sx = 30 + Math.random() * (S - 60), sy = 30 + Math.random() * (S - 60), a = Math.random() * 3.14, l = 8 + Math.random() * 28;
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  armorDetail = t;
  return t;
}

function makeMaterials(char) {
  const detail = getArmorDetail();
  const armor = new THREE.MeshPhysicalMaterial({ color: char.color, metalness: 0.35, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25, bumpMap: detail, bumpScale: 1.4, roughnessMap: detail });
  const armorDark = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(char.color).multiplyScalar(0.45), metalness: 0.4, roughness: 0.45, clearcoat: 0.3, bumpMap: detail, bumpScale: 1.4, roughnessMap: detail });
  const suit = new THREE.MeshStandardMaterial({ color: 0x3b414c, metalness: 0.15, roughness: 0.62 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.85, roughness: 0.32, bumpMap: detail, bumpScale: 0.8 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.1, roughness: 0.88 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: char.accent, emissiveIntensity: 1.6, roughness: 0.3 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x06080c, metalness: 0.9, roughness: 0.08, clearcoat: 1, emissive: char.accent, emissiveIntensity: 0.18 });
  return { armor, armorDark, suit, trim, rubber, glow, visor };
}

// ---------------------------------------------------------------- Guns
// Returns group (+Z forward), with userData: muzzle, grip, fore (hand points), sight (eye-line point), sightType.
export const SIDEARMS = new Set(['classic', 'shorty', 'mpistol', 'cannon']);

let reticleTex = null;
function getReticle() {
  if (reticleTex) return reticleTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.shadowColor = '#ff2a4a'; x.shadowBlur = 8;
  x.strokeStyle = '#ff3d5a'; x.lineWidth = 3;
  x.beginPath(); x.arc(64, 64, 44, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#ff3d5a';
  x.beginPath(); x.arc(64, 64, 7, 0, Math.PI * 2); x.fill();
  reticleTex = new THREE.CanvasTexture(c);
  reticleTex.colorSpace = THREE.SRGBColorSpace;
  return reticleTex;
}
// Cut lines, slots and grooves (shared by every skin so details always read)
const INSET = new THREE.MeshStandardMaterial({ color: 0x0c0e11, metalness: 0.2, roughness: 0.85 });
INSET.userData.shared = true;
const holoGlass = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide });
let reticleMat = null;

// Barrel ends per gun: [x, y, z, bore radius]
const BORES = {
  classic: [[0, 0.035, 0.21, 0.0075]],
  mpistol: [[0, 0.035, 0.25, 0.0105]],
  cannon: [[0, 0.045, 0.36, 0.0125]],
  shorty: [[0.017, 0.035, 0.287, 0.0105], [-0.017, 0.035, 0.287, 0.0105]],
  stinger: [[0, 0.02, 0.4, 0.009]],
  carbine: [[0, 0.03, 0.43, 0.0085]],
  marksman: [[0, 0.03, 0.82, 0.0085]],
  smg: [[0, 0.03, 0.46, 0.0105]],
  shotgun: [[0, 0.045, 0.67, 0.016], [0, 0.005, 0.6, 0.011]],
  ar: [[0, 0.03, 0.68, 0.0085]],
  scout: [[0, 0.035, 0.835, 0.0115]],
  lmg: [[0, 0.03, 0.75, 0.0145]],
  sniper: [[0, 0.035, 0.8, 0.0115]]
};

export function buildGun(id, accent = 0xff8800, skin = 'default') {
  const m = skinMats(skin, accent);
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const k = mesh(geo, mat, x, y, z, g); k.rotation.set(rx, ry, rz); return k; };
  const barrel = (r, len, y, z, mat = m.metal) => add(cyl(r, r, len, 14), mat, 0, y, z, Math.PI / 2);
  // Picatinny rail: base + ridges
  const rail = (len, y, z) => {
    add(rb(0.026, 0.01, len, 0.003), m.metal, 0, y, z);
    for (let t = -len / 2 + 0.008; t < len / 2; t += 0.016) add(rb(0.03, 0.007, 0.008, 0.002), m.metal, 0, y + 0.008, z + t);
  };
  const triggerGuard = (y, z, w = 0.012) => {
    const tg = add(tor(0.028, 0.005, Math.PI), m.polymer, 0, y, z, 0, Math.PI / 2, Math.PI);
    tg.scale.set(1, 1, w / 0.012);
    add(rb(0.006, 0.02, 0.006, 0.002), m.metal, 0, y + 0.012, z - 0.004, 0.3);
  };
  const muzzleBrake = (r, y, z) => {
    add(cyl(r * 1.35, r * 1.35, 0.06, 12), m.body, 0, y, z, Math.PI / 2);
    for (const dz of [-0.015, 0.012]) add(rb(r * 3, 0.006, 0.01, 0.002), m.metal, 0, y, z + dz);
  };
  const port = (y, z, len) => add(rb(0.004, 0.018, len, 0.002), m.metal, -0.034, y, z);
  // ---- Detail helpers (both sides unless noted). hw = half width of the part they sit on.
  const seam = (hw, y, z, len) => { for (const s of [1, -1]) add(rb(0.002, 0.003, len, 0.001), INSET, s * hw, y, z); };
  const pins = (hw, y, zs) => { for (const z of zs) for (const s of [1, -1]) add(cyl(0.0045, 0.0045, 0.003, 10), m.metal, s * (hw + 0.001), y, z, 0, 0, Math.PI / 2); };
  const slots = (hw, y, z0, n, step, len = 0.024, h = 0.01) => { for (let i = 0; i < n; i++) for (const s of [1, -1]) add(rb(0.003, h, len, h / 2 - 0.0005), INSET, s * hw, y, z0 + i * step); };
  const panel = (hw, y, z, h, len, mat = m.polymer) => { for (const s of [1, -1]) add(rb(0.004, h, len, 0.0015), mat, s * hw, y, z); };
  const serrations = (hw, y, z0, n, step, h) => { for (let i = 0; i < n; i++) for (const s of [1, -1]) add(rb(0.002, h, 0.003, 0.0008), INSET, s * hw, y, z0 + i * step); };
  const gripTex = (y, z, rx, n = 4, w = 0.044) => { for (let i = 0; i < n; i++) add(rb(w, 0.004, 0.052, 0.0015), INSET, 0, y - i * 0.02, z - i * 0.02 * Math.tan(rx), rx); };
  const chargingHandle = (y, z, w = 0.03) => { add(rb(w, 0.01, 0.018, 0.003), m.metal, 0, y, z); for (const s of [1, -1]) add(rb(0.008, 0.012, 0.016, 0.003), m.metal, s * (w / 2 + 0.003), y, z); };
  const buttPad = (y, z, h, w, rx) => add(rb(w, h, 0.014, 0.005), INSET, 0, y, z, rx);
  // Magazine base plate, and a cartridge window on both sides showing a few rounds (tilted with the magazine)
  const magBase = (y, z, rx, w, d) => add(rb(w + 0.004, 0.012, d, 0.004), m.metal, 0, y, z, rx);
  const magWindow = (y, z, rx, w, h = 0.06, n = 3) => {
    const grp = new THREE.Group(); grp.position.set(0, y, z); grp.rotation.x = rx; g.add(grp);
    for (const s of [1, -1]) {
      mesh(rb(0.002, h, 0.022, 0.001), INSET, s * (w / 2 + 0.0005), 0, 0, grp);
      for (let i = 0; i < n; i++) mesh(rb(0.0016, h / (n + 1) * 0.55, 0.016, 0.0006), m.accent, s * (w / 2 + 0.0012), -h / 2 + (i + 1) * h / (n + 1), 0, grp);
    }
  };
  // Holographic sight: frame, tinted glass, glowing reticle. Returns the eye-line point.
  const holo = (y, z) => {
    // Slim frame: thin posts and top bar so the window is almost all glass
    add(rb(0.04, 0.012, 0.05, 0.004), m.body, 0, y, z);
    for (const s of [1, -1]) add(rb(0.004, 0.05, 0.022, 0.0015), m.body, 0.026 * s, y + 0.031, z + 0.012);
    add(rb(0.056, 0.004, 0.022, 0.0015), m.body, 0, y + 0.057, z + 0.012);
    add(rb(0.008, 0.008, 0.012, 0.002), m.accent, 0.018, y + 0.009, z - 0.012);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.048, 0.046), holoGlass);
    glass.position.set(0, y + 0.033, z + 0.02); g.add(glass);
    reticleMat ||= new THREE.MeshBasicMaterial({ map: getReticle(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    const ret = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.014), reticleMat);
    ret.position.set(0, y + 0.035, z + 0.021); ret.renderOrder = 10; g.add(ret);
    return new THREE.Vector3(0, y + 0.035, z);
  };
  // Scope tube with glass
  const scope = (y, z, len, r) => {
    // Open tubes so you look straight through the scope instead of at a solid cap
    add(tube(r, r, len, 20), m.body, 0, y, z, Math.PI / 2);
    add(tube(r * 1.25, r, 0.05, 20), m.body, 0, y, z + len / 2, Math.PI / 2);
    add(tube(r * 1.15, r * 1.15, 0.035, 20), m.body, 0, y, z - len / 2, Math.PI / 2);
    add(tor(r * 1.22, 0.002, Math.PI * 2), m.glow, 0, y, z + len / 2 + 0.026);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(r * 1.2, 20), holoGlass);
    lens.position.set(0, y, z + len / 2); g.add(lens);
    reticleMat ||= new THREE.MeshBasicMaterial({ map: getReticle(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    const ret = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.9, r * 0.9), reticleMat);
    ret.position.set(0, y, z + len / 2 + 0.001); ret.renderOrder = 10; g.add(ret);
    // Low-profile turrets so they don't poke into the sight picture
    add(cyl(0.009, 0.009, 0.012, 10), m.metal, 0, y + r + 0.004, z + len * 0.2);
    add(cyl(0.009, 0.009, 0.012, 10), m.metal, r + 0.004, y, z + len * 0.2, 0, 0, Math.PI / 2);
    for (const dz of [-len * 0.3, len * 0.3]) add(rb(0.02, 0.03, 0.02, 0.004), m.metal, 0, y - r - 0.012, z + dz);
    return new THREE.Vector3(0, y, z);
  };

  let muzzle, grip = new THREE.Vector3(0, -0.07, 0), fore, sight, sightType = 'iron';
  if (id === 'classic') {
    add(rb(0.05, 0.055, 0.22, 0.012), m.body, 0, 0.035, 0.07);
    for (let i = 0; i < 6; i++) add(rb(0.052, 0.04, 0.004, 0.001), m.polymer, 0, 0.04, -0.02 + i * 0.008);
    add(rb(0.052, 0.012, 0.16, 0.004), m.accent, 0, 0.066, 0.06);
    port(0.045, 0.08, 0.05);
    add(rb(0.044, 0.04, 0.17, 0.01), m.polymer, 0, -0.005, 0.06);
    add(rb(0.042, 0.11, 0.055, 0.012), m.polymer, 0, -0.055, -0.005, 0.25);
    for (let i = 0; i < 4; i++) add(rb(0.044, 0.006, 0.05, 0.002), m.body, 0, -0.035 - i * 0.02, -0.002 - i * 0.005, 0.25);
    triggerGuard(-0.02, 0.035);
    barrel(0.012, 0.04, 0.035, 0.19);
    add(rb(0.008, 0.014, 0.01, 0.003), m.glow, 0, 0.075, 0.16);
    add(rb(0.03, 0.014, 0.012, 0.003), m.body, 0, 0.074, -0.02);
    add(rb(0.008, 0.008, 0.008, 0.002), m.glow, -0.009, 0.08, -0.02); add(rb(0.008, 0.008, 0.008, 0.002), m.glow, 0.009, 0.08, -0.02);
    serrations(0.0255, 0.045, 0.13, 4, 0.008, 0.03);
    seam(0.0255, 0.01, 0.07, 0.2);
    pins(0.022, -0.005, [0.0, 0.06]);
    slots(0.0225, -0.012, 0.1, 2, 0.02, 0.012, 0.006);
    add(rb(0.02, 0.012, 0.012, 0.003), m.metal, 0, 0.012, -0.05, 0.4); // hammer
    magBase(-0.108, -0.019, 0.25, 0.042, 0.056); magWindow(-0.06, -0.007, 0.25, 0.042, 0.05, 2);
    add(rb(0.004, 0.008, 0.026, 0.002), m.metal, -0.0265, 0.02, 0.03); // slide stop
    muzzle = new THREE.Vector3(0, 0.035, 0.22);
    fore = new THREE.Vector3(0.02, -0.075, 0.02);
    sight = new THREE.Vector3(0, 0.08, -0.02);
  } else if (id === 'mpistol') {
    add(rb(0.052, 0.06, 0.2, 0.012), m.body, 0, 0.035, 0.06);
    add(rb(0.054, 0.014, 0.12, 0.004), m.accent, 0, 0.07, 0.05);
    port(0.045, 0.07, 0.04);
    add(rb(0.046, 0.045, 0.16, 0.01), m.polymer, 0, -0.01, 0.05);
    add(rb(0.042, 0.2, 0.05, 0.01), m.polymer, 0, -0.1, -0.005, 0.18);
    add(rb(0.03, 0.05, 0.03, 0.006), m.accent, 0, -0.21, -0.025, 0.18);
    triggerGuard(-0.025, 0.04);
    barrel(0.016, 0.07, 0.035, 0.19);
    add(cyl(0.022, 0.018, 0.03, 12), m.body, 0, 0.035, 0.235, Math.PI / 2);
    add(rb(0.03, 0.06, 0.03, 0.008), m.polymer, 0, -0.03, 0.12);
    add(rb(0.012, 0.012, 0.012, 0.003), m.glow, 0, 0.08, 0.1);
    add(rb(0.03, 0.014, 0.012, 0.003), m.body, 0, 0.074, -0.03);
    serrations(0.0265, 0.045, -0.03, 5, 0.008, 0.035);
    seam(0.0265, 0.008, 0.06, 0.18);
    pins(0.023, -0.01, [0.0, 0.09]);
    gripTex(-0.06, -0.01, 0.18, 5, 0.043);
    for (const s of [1, -1]) add(rb(0.004, 0.03, 0.02, 0.002), m.accent, s * 0.024, -0.2, -0.023, 0.18); // mag base grips
    add(rb(0.05, 0.012, 0.024, 0.004), m.polymer, 0, -0.005, -0.06); // folding brace
    magWindow(-0.12, -0.007, 0.18, 0.042, 0.09);
    muzzle = new THREE.Vector3(0, 0.035, 0.25);
    fore = new THREE.Vector3(0, -0.05, 0.12);
    sight = new THREE.Vector3(0, 0.082, -0.03);
  } else if (id === 'cannon') {
    add(rb(0.05, 0.07, 0.14, 0.014), m.body, 0, 0.03, 0.0);
    const cylD = add(cyl(0.038, 0.038, 0.07, 6), m.metal, 0, 0.025, 0.08, Math.PI / 2);
    cylD.rotation.y = Math.PI / 6;
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; add(cyl(0.007, 0.007, 0.072, 6), m.body, Math.cos(a) * 0.026, 0.025 + Math.sin(a) * 0.026, 0.08, Math.PI / 2); }
    add(cyl(0.02, 0.022, 0.24, 14), m.metal, 0, 0.045, 0.24, Math.PI / 2);
    add(rb(0.03, 0.02, 0.24, 0.005), m.accent, 0, 0.075, 0.22);
    add(rb(0.02, 0.012, 0.2, 0.003), m.body, 0, 0.012, 0.23);
    add(rb(0.048, 0.12, 0.06, 0.018), m.polymer, 0, -0.06, -0.04, 0.35);
    triggerGuard(-0.02, 0.03);
    add(rb(0.012, 0.018, 0.012, 0.003), m.glow, 0, 0.09, 0.33);
    add(rb(0.028, 0.016, 0.014, 0.003), m.body, 0, 0.09, -0.04);
    add(rb(0.014, 0.02, 0.02, 0.003), m.metal, 0, 0.06, -0.07, -0.4);
    for (const s of [1, -1]) add(rb(0.004, 0.09, 0.045, 0.004), m.accent, s * 0.025, -0.06, -0.04, 0.35); // grip panels
    gripTex(-0.04, -0.035, 0.35, 4, 0.05);
    pins(0.025, 0.03, [-0.03, 0.03]);
    add(tor(0.036, 0.004, Math.PI * 2), m.metal, 0, 0.025, 0.116); // cylinder face ring
    for (const s of [1, -1]) add(rb(0.003, 0.012, 0.2, 0.001), INSET, s * 0.0205, 0.045, 0.24); // barrel flutes
    muzzle = new THREE.Vector3(0, 0.045, 0.37);
    fore = new THREE.Vector3(0.02, -0.075, 0.0);
    sight = new THREE.Vector3(0, 0.096, -0.04);
  } else if (id === 'shorty') {
    // Sawed-off double barrel
    add(rb(0.062, 0.054, 0.12, 0.014), m.body, 0, 0.03, 0.02);
    for (const s of [1, -1]) {
      add(cyl(0.016, 0.016, 0.21, 16), m.metal, 0.017 * s, 0.035, 0.18, Math.PI / 2);
      add(tor(0.016, 0.0035), m.body, 0.017 * s, 0.035, 0.285);
      add(cyl(0.011, 0.011, 0.004, 12), INSET, 0.017 * s, 0.035, 0.287, Math.PI / 2);
    }
    add(rb(0.02, 0.01, 0.2, 0.003), m.accent, 0, 0.056, 0.18); // top rib
    add(rb(0.064, 0.024, 0.13, 0.008), m.polymer, 0, 0.004, 0.15); // forend
    slots(0.033, 0.004, 0.11, 3, 0.03, 0.018, 0.008);
    add(rb(0.046, 0.12, 0.056, 0.016), m.polymer, 0, -0.058, -0.04, 0.4);
    gripTex(-0.04, -0.045, 0.4, 4, 0.048);
    triggerGuard(-0.012, 0.02);
    add(rb(0.012, 0.024, 0.02, 0.004), m.metal, 0, 0.066, -0.028, -0.5); // opening lever
    add(sph(0.006, 8, 6), m.glow, 0, 0.066, 0.275); // front bead
    pins(0.031, 0.03, [-0.01, 0.05]);
    muzzle = new THREE.Vector3(0, 0.035, 0.29);
    fore = new THREE.Vector3(0.02, -0.01, 0.15);
    sight = new THREE.Vector3(0, 0.072, -0.02);
  } else if (id === 'stinger') {
    // Compact high-rate SMG: stubby receiver, long straight mag, vertical grip, wire stock
    add(rb(0.058, 0.082, 0.26, 0.016), m.body, 0, 0.02, 0.07);
    add(rb(0.06, 0.018, 0.15, 0.006), m.accent, 0, 0.066, 0.05);
    seam(0.0295, 0.02, 0.07, 0.24);
    pins(0.029, 0.0, [0.0, 0.14]);
    port(0.035, 0.06, 0.05);
    add(rb(0.062, 0.064, 0.12, 0.016), m.polymer, 0, 0.014, 0.25);
    slots(0.0315, 0.014, 0.21, 3, 0.035, 0.022, 0.01);
    barrel(0.012, 0.06, 0.02, 0.33);
    add(cyl(0.02, 0.02, 0.06, 14), m.body, 0, 0.02, 0.37, Math.PI / 2); // compensator
    for (let i = 0; i < 3; i++) add(rb(0.042, 0.004, 0.01, 0.001), INSET, 0, 0.039, 0.35 + i * 0.016);
    add(rb(0.034, 0.21, 0.046, 0.008), m.polymer, 0, -0.115, 0.12, 0.16); // magazine
    for (let i = 0; i < 4; i++) add(rb(0.036, 0.004, 0.048, 0.0015), INSET, 0, -0.05 - i * 0.045, 0.11 + i * 0.007, 0.16);
    add(rb(0.03, 0.085, 0.032, 0.01), m.polymer, 0, -0.04, 0.26); // vertical grip
    add(rb(0.042, 0.1, 0.05, 0.012), m.polymer, 0, -0.065, -0.02, 0.3);
    gripTex(-0.045, -0.03, 0.3, 3, 0.043);
    triggerGuard(-0.025, 0.03);
    for (const s of [1, -1]) {
      add(rb(0.006, 0.006, 0.18, 0.002), m.metal, 0.018 * s, 0.03, -0.15);
      add(rb(0.006, 0.006, 0.19, 0.002), m.metal, 0.018 * s, -0.025, -0.15, -0.28);
    }
    add(rb(0.048, 0.075, 0.014, 0.005), m.polymer, 0, 0.0, -0.245);
    chargingHandle(0.064, -0.02, 0.022);
    add(rb(0.022, 0.012, 0.012, 0.003), m.metal, 0, 0.068, -0.04); // rear aperture
    add(rb(0.004, 0.012, 0.006, 0.001), m.glow, 0, 0.068, 0.3);   // front post
    magBase(-0.22, 0.103, 0.16, 0.034, 0.05); magWindow(-0.115, 0.12, 0.16, 0.034, 0.12, 4);
    muzzle = new THREE.Vector3(0, 0.02, 0.4);
    fore = new THREE.Vector3(0, -0.075, 0.26);
    sight = new THREE.Vector3(0, 0.074, -0.04);
  } else if (id === 'carbine') {
    // Bullpup: magazine behind the grip, one-piece shell, holo on a short rail
    add(rb(0.07, 0.11, 0.5, 0.03), m.body, 0, 0.015, 0.02);
    add(rb(0.072, 0.028, 0.3, 0.01), m.polymer, 0, -0.03, 0.14);
    seam(0.0355, 0.032, 0.02, 0.48);
    panel(0.0355, 0.0, -0.13, 0.05, 0.15);
    add(rb(0.074, 0.012, 0.18, 0.005), m.accent, 0, 0.072, 0.13);
    slots(0.0365, 0.02, 0.17, 3, 0.04, 0.026, 0.01);
    port(0.03, -0.06, 0.06);
    pins(0.035, 0.0, [-0.18, -0.02, 0.2]);
    rail(0.18, 0.078, 0.02);
    barrel(0.015, 0.12, 0.03, 0.33);
    muzzleBrake(0.015, 0.03, 0.4);
    add(rb(0.04, 0.13, 0.07, 0.012), m.polymer, 0, -0.1, -0.1, 0.12); // magazine (behind the grip)
    for (let i = 0; i < 3; i++) add(rb(0.042, 0.005, 0.072, 0.002), INSET, 0, -0.07 - i * 0.035, -0.095 - i * 0.004, 0.12);
    add(rb(0.042, 0.11, 0.05, 0.012), m.polymer, 0, -0.085, 0.08, 0.3); // pistol grip up front
    gripTex(-0.065, 0.075, 0.3, 4, 0.043);
    triggerGuard(-0.045, 0.12);
    add(rb(0.05, 0.022, 0.13, 0.006), m.body, 0, 0.076, -0.15); // cheek rest
    buttPad(0.012, -0.235, 0.11, 0.072, 0);
    for (const s of [1, -1]) add(cyl(0.006, 0.006, 0.01, 8), m.metal, s * 0.037, 0.0, -0.2, 0, 0, Math.PI / 2);
    sight = holo(0.09, 0.02); sightType = 'holo';
    grip = new THREE.Vector3(0, -0.07, 0.08);
    magBase(-0.165, -0.108, 0.12, 0.04, 0.074); magWindow(-0.1, -0.1, 0.12, 0.04, 0.09);
    muzzle = new THREE.Vector3(0, 0.03, 0.44);
    fore = new THREE.Vector3(0, -0.03, 0.24);
  } else if (id === 'marksman') {
    // DMR: long free-float handguard, 12-round box mag, adjustable stock, low-power scope
    add(rb(0.064, 0.1, 0.36, 0.016), m.body, 0, 0.02, 0.07);
    seam(0.0325, 0.02, 0.07, 0.34);
    pins(0.0315, 0.0, [0.0, 0.18]);
    port(0.035, 0.1, 0.08);
    chargingHandle(0.066, -0.08);
    add(rb(0.066, 0.07, 0.32, 0.018), m.polymer, 0, 0.022, 0.4);
    slots(0.034, 0.022, 0.28, 5, 0.052, 0.03, 0.012);
    add(rb(0.068, 0.012, 0.26, 0.004), m.accent, 0, 0.058, 0.4);
    barrel(0.014, 0.22, 0.03, 0.66);
    add(rb(0.026, 0.03, 0.03, 0.006), m.metal, 0, 0.03, 0.575); // gas block
    muzzleBrake(0.014, 0.03, 0.79);
    add(rb(0.052, 0.03, 0.09, 0.008), m.body, 0, -0.04, 0.13); // mag well
    add(rb(0.04, 0.11, 0.075, 0.01), m.polymer, 0, -0.1, 0.135, 0.05);
    for (let i = 0; i < 3; i++) add(rb(0.042, 0.004, 0.077, 0.0015), INSET, 0, -0.07 - i * 0.03, 0.137, 0.05);
    add(rb(0.042, 0.1, 0.05, 0.012), m.polymer, 0, -0.07, -0.03, 0.3);
    gripTex(-0.045, -0.035, 0.3, 4, 0.043);
    triggerGuard(-0.03, 0.03);
    add(rb(0.05, 0.085, 0.22, 0.02), m.polymer, 0, -0.005, -0.2, -0.04);
    add(rb(0.04, 0.022, 0.12, 0.006), m.polymer, 0, 0.048, -0.2); // adjustable cheek riser
    for (const s of [1, -1]) add(cyl(0.004, 0.004, 0.03, 8), m.metal, s * 0.014, 0.034, -0.2);
    buttPad(-0.005, -0.315, 0.1, 0.056, -0.04);
    for (const s of [1, -1]) { const leg = add(rb(0.01, 0.01, 0.16, 0.003), m.metal, 0.02 * s, -0.022, 0.46); void leg; } // folded bipod
    rail(0.24, 0.074, 0.06);
    sight = scope(0.1, 0.05, 0.2, 0.02); sightType = 'scope';
    magBase(-0.156, 0.132, 0.05, 0.04, 0.08); magWindow(-0.1, 0.135, 0.05, 0.04, 0.08);
    muzzle = new THREE.Vector3(0, 0.03, 0.83);
    fore = new THREE.Vector3(0, -0.02, 0.4);
  } else if (id === 'smg') {
    add(rb(0.065, 0.09, 0.34, 0.015), m.body, 0, 0.02, 0.1);
    add(rb(0.067, 0.02, 0.2, 0.006), m.accent, 0, 0.07, 0.08);
    port(0.035, 0.06, 0.07);
    add(rb(0.068, 0.07, 0.08, 0.015), m.polymer, 0, 0.02, 0.29);
    for (let i = 0; i < 3; i++) add(rb(0.07, 0.008, 0.012, 0.002), m.body, 0, 0.01 - i * 0.018, 0.29);
    barrel(0.017, 0.1, 0.03, 0.37);
    muzzleBrake(0.017, 0.03, 0.43);
    add(rb(0.04, 0.16, 0.05, 0.01), m.polymer, 0, -0.1, 0.12, 0.12);
    add(rb(0.044, 0.02, 0.06, 0.005), m.metal, 0, -0.185, 0.13, 0.12);
    add(rb(0.042, 0.1, 0.05, 0.012), m.polymer, 0, -0.07, -0.01, 0.3);
    triggerGuard(-0.03, 0.04);
    // Folding stock
    for (const s of [1, -1]) add(rb(0.008, 0.012, 0.2, 0.003), m.metal, 0.022 * s, 0.0, -0.14);
    add(rb(0.05, 0.08, 0.02, 0.006), m.polymer, 0, -0.01, -0.24);
    rail(0.14, 0.074, 0.11);
    seam(0.0335, 0.02, 0.1, 0.32);
    pins(0.0325, 0.0, [0.02, 0.18]);
    slots(0.0345, 0.02, 0.27, 2, 0.035, 0.022, 0.01);
    chargingHandle(0.05, 0.2, 0.024);
    gripTex(-0.05, -0.012, 0.3, 3, 0.043);
    for (let i = 0; i < 3; i++) add(rb(0.042, 0.005, 0.052, 0.002), INSET, 0, -0.06 - i * 0.04, 0.12 + i * 0.005, 0.12); // mag ribs
    buttPad(-0.01, -0.252, 0.08, 0.05, 0);
    sight = holo(0.082, 0.06); sightType = 'holo';
    magWindow(-0.1, 0.12, 0.12, 0.04, 0.1);
    muzzle = new THREE.Vector3(0, 0.03, 0.47);
    fore = new THREE.Vector3(0, -0.04, 0.22);
  } else if (id === 'shotgun') {
    add(rb(0.07, 0.09, 0.26, 0.015), m.body, 0, 0.02, 0.05);
    port(0.04, 0.06, 0.08);
    barrel(0.022, 0.5, 0.045, 0.42);
    add(cyl(0.018, 0.018, 0.42, 12), m.body, 0, 0.005, 0.38, Math.PI / 2);
    add(cyl(0.02, 0.02, 0.02, 12), m.metal, 0, 0.005, 0.59, Math.PI / 2);
    const pump = add(rb(0.068, 0.06, 0.16, 0.02), m.accent, 0, 0.012, 0.36);
    for (let i = 0; i < 5; i++) add(rb(0.07, 0.062, 0.006, 0.002), m.polymer, 0, 0.012, 0.3 + i * 0.03);
    void pump;
    add(rb(0.045, 0.11, 0.055, 0.012), m.polymer, 0, -0.06, -0.03, 0.3);
    triggerGuard(-0.03, 0.02);
    add(rb(0.05, 0.08, 0.26, 0.02), m.polymer, 0, -0.03, -0.2, -0.12);
    add(rb(0.054, 0.1, 0.03, 0.01), m.body, 0, -0.06, -0.33, -0.12);
    for (let i = 0; i < 4; i++) add(cyl(0.008, 0.008, 0.04, 8), m.glow, 0.036, 0.0, -0.02 + i * 0.03, 0, 0, Math.PI / 2);
    rail(0.1, 0.074, 0.05);
    seam(0.0355, 0.02, 0.05, 0.24);
    pins(0.035, 0.0, [-0.03, 0.1]);
    // Heat shield over the barrel
    add(rb(0.05, 0.012, 0.22, 0.004), m.body, 0, 0.072, 0.48);
    for (let i = 0; i < 5; i++) add(rb(0.052, 0.004, 0.016, 0.0015), INSET, 0, 0.0785, 0.4 + i * 0.04);
    add(rb(0.03, 0.02, 0.02, 0.005), m.metal, 0, 0.03, 0.64); // barrel clamp
    gripTex(-0.05, -0.035, 0.3, 3, 0.046);
    buttPad(-0.06, -0.345, 0.1, 0.055, -0.12);
    add(rb(0.04, 0.016, 0.14, 0.005), m.body, 0, 0.018, -0.2, -0.12); // cheek rest
    sight = holo(0.082, 0.03); sightType = 'holo';
    muzzle = new THREE.Vector3(0, 0.045, 0.68);
    fore = new THREE.Vector3(0, -0.02, 0.36);
  } else if (id === 'ar') {
    add(rb(0.066, 0.1, 0.36, 0.015), m.body, 0, 0.02, 0.08);
    port(0.035, 0.1, 0.08);
    add(rb(0.014, 0.014, 0.03, 0.004), m.metal, -0.04, 0.04, 0.05);
    add(rb(0.07, 0.075, 0.26, 0.02), m.polymer, 0, 0.025, 0.36);
    for (let i = 0; i < 4; i++) add(rb(0.072, 0.012, 0.03, 0.004), m.accent, 0, 0.055, 0.27 + i * 0.06);
    for (let i = 0; i < 3; i++) add(rb(0.074, 0.02, 0.012, 0.003), m.body, 0, 0.0, 0.3 + i * 0.05);
    barrel(0.015, 0.16, 0.03, 0.56);
    muzzleBrake(0.015, 0.03, 0.65);
    add(cyl(0.006, 0.006, 0.12, 8), m.metal, 0, 0.055, 0.52, Math.PI / 2);
    // Curved magazine
    add(rb(0.04, 0.1, 0.07, 0.012), m.polymer, 0, -0.07, 0.13, 0.12);
    add(rb(0.04, 0.09, 0.07, 0.012), m.polymer, 0, -0.15, 0.15, 0.35);
    add(rb(0.046, 0.02, 0.08, 0.004), m.metal, 0, -0.035, 0.13);
    add(rb(0.042, 0.1, 0.05, 0.012), m.polymer, 0, -0.07, -0.03, 0.3);
    triggerGuard(-0.03, 0.03);
    add(rb(0.05, 0.09, 0.24, 0.02), m.polymer, 0, -0.01, -0.2, -0.06);
    add(rb(0.054, 0.11, 0.025, 0.008), m.body, 0, -0.02, -0.325, -0.06);
    add(rb(0.03, 0.01, 0.2, 0.003), m.accent, 0, 0.038, -0.19, -0.06);
    rail(0.2, 0.074, 0.1);
    seam(0.0335, 0.02, 0.08, 0.34);
    pins(0.0325, 0.0, [0.0, 0.2]);
    slots(0.0355, 0.02, 0.27, 4, 0.06, 0.03, 0.012);
    add(rb(0.052, 0.03, 0.09, 0.008), m.body, 0, -0.04, 0.13); // mag well flare
    for (let i = 0; i < 3; i++) add(rb(0.042, 0.005, 0.072, 0.002), INSET, 0, -0.08 - i * 0.035, 0.135 + i * 0.012, 0.12 + i * 0.1); // mag ribs
    add(rb(0.026, 0.032, 0.034, 0.006), m.metal, 0, 0.03, 0.5); // gas block
    chargingHandle(0.064, -0.08);
    add(rb(0.02, 0.02, 0.03, 0.005), m.metal, 0.036, 0.035, 0.0); // bolt release
    gripTex(-0.045, -0.035, 0.3, 4, 0.043);
    add(rb(0.04, 0.02, 0.12, 0.006), m.body, 0, 0.045, -0.2, -0.06); // cheek riser
    buttPad(-0.02, -0.34, 0.11, 0.056, -0.06);
    for (const s of [1, -1]) add(cyl(0.006, 0.006, 0.01, 8), m.metal, s * 0.026, -0.03, -0.3, 0, 0, Math.PI / 2); // sling mount
    sight = holo(0.082, 0.06); sightType = 'holo';
    magBase(-0.194, 0.135, 0.35, 0.04, 0.074); magWindow(-0.07, 0.13, 0.12, 0.04, 0.07);
    add(rb(0.014, 0.016, 0.02, 0.004), m.metal, -0.036, 0.055, 0.02); // forward assist
    muzzle = new THREE.Vector3(0, 0.03, 0.69);
    fore = new THREE.Vector3(0, -0.03, 0.34);
  } else if (id === 'scout') {
    add(rb(0.06, 0.09, 0.34, 0.015), m.body, 0, 0.02, 0.08);
    port(0.035, 0.1, 0.07);
    add(cyl(0.008, 0.008, 0.05, 8), m.metal, -0.04, 0.045, 0.08, 0, 0, Math.PI / 2);
    add(sph(0.012, 8, 6), m.metal, -0.066, 0.045, 0.08);
    add(rb(0.064, 0.05, 0.3, 0.015), m.accent, 0, -0.01, 0.34);
    barrel(0.014, 0.4, 0.035, 0.6);
    add(cyl(0.02, 0.02, 0.05, 12), m.body, 0, 0.035, 0.81, Math.PI / 2);
    add(rb(0.04, 0.1, 0.05, 0.012), m.polymer, 0, -0.065, -0.02, 0.3);
    triggerGuard(-0.03, 0.02);
    add(rb(0.05, 0.08, 0.26, 0.02), m.accent, 0, -0.01, -0.2, -0.08);
    add(rb(0.052, 0.09, 0.025, 0.008), m.body, 0, -0.02, -0.33, -0.08);
    add(rb(0.035, 0.08, 0.05, 0.01), m.polymer, 0, -0.06, 0.1);
    seam(0.0305, 0.02, 0.08, 0.32);
    pins(0.03, 0.0, [0.0, 0.18]);
    slots(0.0325, -0.01, 0.24, 4, 0.06, 0.03, 0.012);
    for (let i = 0; i < 3; i++) add(rb(0.004, 0.02, 0.1, 0.002), INSET, 0.0205 * (i % 2 ? 1 : -1), 0.035, 0.62); // barrel flutes
    gripTex(-0.045, -0.035, 0.3, 4, 0.041);
    add(rb(0.04, 0.02, 0.12, 0.006), m.body, 0, 0.04, -0.2, -0.08); // cheek riser
    buttPad(-0.02, -0.345, 0.09, 0.052, -0.08);
    sight = scope(0.1, 0.08, 0.2, 0.022); sightType = 'scope';
    magBase(-0.1, 0.1, 0, 0.035, 0.054); magWindow(-0.06, 0.1, 0, 0.035, 0.05, 2);
    muzzle = new THREE.Vector3(0, 0.035, 0.84);
    fore = new THREE.Vector3(0, -0.04, 0.34);
  } else if (id === 'lmg') {
    add(rb(0.09, 0.12, 0.42, 0.02), m.body, 0, 0.02, 0.08);
    add(rb(0.092, 0.03, 0.3, 0.01), m.accent, 0, 0.09, 0.1);
    port(0.03, 0.08, 0.1);
    // Box magazine + ammo belt
    add(rb(0.12, 0.12, 0.12, 0.02), m.polymer, 0.02, -0.08, 0.1);
    add(rb(0.124, 0.02, 0.124, 0.006), m.accent, 0.02, -0.1, 0.1);
    for (let i = 0; i < 5; i++) add(cyl(0.008, 0.008, 0.03, 8), m.glow, 0.05, -0.015 + i * 0.012, 0.05 + i * 0.012, 0, 0, Math.PI / 2);
    add(cyl(0.024, 0.024, 0.4, 14), m.metal, 0, 0.03, 0.48, Math.PI / 2);
    // Perforated barrel shroud
    add(cyl(0.034, 0.034, 0.24, 14, 1, true), m.body, 0, 0.03, 0.42, Math.PI / 2);
    for (let i = 0; i < 6; i++) add(rb(0.07, 0.01, 0.014, 0.003), m.body, 0, 0.066, 0.33 + i * 0.035);
    muzzleBrake(0.024, 0.03, 0.72);
    for (const s of [1, -1]) { const leg = add(rb(0.012, 0.18, 0.012, 0.004), m.metal, 0.03 * s, -0.05, 0.6); leg.rotation.set(-0.9, 0, 0.25 * s); }
    add(rb(0.045, 0.11, 0.055, 0.012), m.polymer, 0, -0.07, -0.05, 0.3);
    triggerGuard(-0.035, 0.0);
    add(rb(0.06, 0.1, 0.24, 0.025), m.polymer, 0, -0.01, -0.24, -0.06);
    add(rb(0.064, 0.12, 0.03, 0.008), m.body, 0, -0.02, -0.37, -0.06);
    for (let i = 0; i < 5; i++) add(rb(0.094, 0.01, 0.01, 0.003), m.glow, 0, 0.04, -0.05 + i * 0.05);
    rail(0.16, 0.107, 0.02);
    seam(0.0455, 0.02, 0.08, 0.4);
    pins(0.045, 0.0, [-0.08, 0.05, 0.22]);
    // Low heat shield instead of a carry handle, so nothing sits in the sight line
    add(rb(0.05, 0.008, 0.16, 0.003), m.body, 0, 0.104, 0.3);
    // Feed tray cover hinge
    add(cyl(0.008, 0.008, 0.094, 10), m.metal, 0, 0.095, -0.05, 0, 0, Math.PI / 2);
    gripTex(-0.05, -0.055, 0.3, 4, 0.046);
    buttPad(-0.02, -0.39, 0.12, 0.066, -0.06);
    add(rb(0.05, 0.024, 0.14, 0.008), m.body, 0, 0.05, -0.23, -0.06); // cheek rest
    sight = holo(0.115, -0.01); sightType = 'holo';
    muzzle = new THREE.Vector3(0, 0.03, 0.76);
    fore = new THREE.Vector3(0, -0.03, 0.34);
  } else { // sniper
    add(rb(0.065, 0.095, 0.4, 0.015), m.body, 0, 0.02, 0.1);
    port(0.035, 0.12, 0.08);
    add(cyl(0.009, 0.009, 0.06, 8), m.metal, -0.045, 0.045, 0.12, 0, 0, Math.PI / 2);
    add(sph(0.014, 8, 6), m.metal, -0.076, 0.045, 0.12);
    add(rb(0.067, 0.025, 0.28, 0.008), m.accent, 0, -0.02, 0.18);
    barrel(0.016, 0.46, 0.035, 0.52);
    add(rb(0.05, 0.05, 0.08, 0.01), m.body, 0, 0.035, 0.76);
    for (const s of [1, -1]) add(rb(0.004, 0.03, 0.05, 0.002), m.metal, 0.026 * s, 0.035, 0.76);
    add(rb(0.04, 0.12, 0.06, 0.012), m.polymer, 0, -0.07, 0.02, 0.28);
    add(rb(0.045, 0.1, 0.06, 0.01), m.polymer, 0, -0.07, 0.12);
    triggerGuard(-0.03, 0.02);
    add(rb(0.055, 0.1, 0.28, 0.025), m.polymer, 0, -0.01, -0.22, -0.08);
    add(rb(0.03, 0.03, 0.12, 0.01), m.accent, 0, 0.05, -0.2, -0.08);
    add(rb(0.058, 0.12, 0.025, 0.008), m.body, 0, -0.02, -0.365, -0.08);
    for (const s of [1, -1]) { const leg = add(rb(0.01, 0.16, 0.01, 0.003), m.metal, 0.02 * s, -0.03, 0.42); leg.rotation.set(-1.2, 0, 0.2 * s); }
    seam(0.0335, 0.02, 0.1, 0.38);
    pins(0.0325, 0.0, [0.0, 0.2]);
    for (let i = 0; i < 4; i++) add(rb(0.004, 0.02, 0.26, 0.002), INSET, i < 2 ? 0.0175 : -0.0175, 0.035 + (i % 2 ? 0.008 : -0.008), 0.5); // fluted barrel
    // Bolt handle with a ball knob, angled down
    const bolt = add(cyl(0.007, 0.007, 0.07, 8), m.metal, 0.05, 0.03, 0.02, 0, 0, Math.PI / 2 + 0.5);
    void bolt;
    add(sph(0.016, 10, 8), m.metal, 0.08, 0.012, 0.02);
    slots(0.034, -0.02, 0.1, 4, 0.05, 0.026, 0.01);
    add(rb(0.02, 0.02, 0.04, 0.006), m.metal, 0, -0.045, -0.3, -0.08); // monopod
    gripTex(-0.05, 0.0, 0.28, 4, 0.041);
    buttPad(-0.02, -0.385, 0.12, 0.058, -0.08);
    sight = scope(0.12, 0.1, 0.28, 0.032); sightType = 'scope';
    magBase(-0.122, 0.12, 0, 0.045, 0.064); magWindow(-0.07, 0.12, 0, 0.045, 0.06, 2);
    muzzle = new THREE.Vector3(0, 0.035, 0.8);
    fore = new THREE.Vector3(0, -0.04, 0.34);
  }
  // Dark bore and a crown ring at every barrel end, so the muzzle reads as a real opening (x, y, z of the barrel end, bore radius)
  for (const [bx, by, bz, br] of BORES[id] || BORES.sniper) {
    const hole = add(new THREE.CircleGeometry(br, 16), INSET, bx, by, bz + 0.0012);
    hole.castShadow = false;
    add(tor(br * 1.35, br * 0.28), m.metal, bx, by, bz + 0.0005);
  }
  g.userData = { muzzle, grip, fore, sight, sightType };
  return mergeStatic(g);
}

// ---------------------------------------------------------------- Shield bubble
function shieldMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uAlpha: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vP = position; vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uAlpha; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
        float hex = abs(sin(vP.x*24.0 + uTime*2.0) * sin(vP.y*24.0 - uTime) * sin(vP.z*24.0));
        float lines = smoothstep(0.92, 1.0, hex);
        float scan = 0.5 + 0.5*sin(vP.y*40.0 - uTime*6.0);
        float a = (0.12 + f*0.85 + lines*0.35 + scan*0.06) * uAlpha;
        gl_FragColor = vec4(uColor * (1.2 + f*2.0), a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
}

// ---------------------------------------------------------------- Character
const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _q = new THREE.Quaternion(), DOWN = new THREE.Vector3(0, -1, 0);
const _mi = new THREE.Matrix4(), _f = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _e = new THREE.Euler();

export class CharacterModel {
  constructor(char) {
    this.char = char;
    this.mats = makeMaterials(char);
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.phase = 0;
    this.moveAmt = 0;
    this.airAmt = 0;
    this.deathT = 0;
    this.recoil = 0;
    this.flash = 0;
    this.time = Math.random() * 10;
    this.weaponId = null;
    this._build();
    this.setWeapon('classic');
    // Merge rigid parts per bone; keep everything the animation code touches directly
    const keep = new Set();
    const collect = v => { if (v?.isMesh) keep.add(v); else if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === 'object' && !v.isObject3D && !v.isMaterial && Object.getPrototypeOf(v) === Object.prototype) Object.values(v).forEach(collect); };
    for (const v of Object.values(this)) collect(v);
    mergeStatic(this.body, keep);
  }

  _build() {
    const M = this.mats, c = this.char, B = this.body;
    const rook = c.id === 'rook', tank = c.id === 'tank' || rook, ghost = c.id === 'ghost' || c.id === 'rift';
    if (c.id === 'tank') B.scale.set(1.16, 1.07, 1.12);
    if (rook) B.scale.set(1.08, 1.04, 1.08);
    if (ghost) B.scale.set(0.95, 1.0, 0.95);
    const HP = Math.PI / 2;
    // Sculpted shells (see loft): a dark suit underneath, colored plates on top, glowing seams
    const L = (rings, mat, parent, o = {}, x = 0, y = 0, z = 0) => mesh(loft(rings, o), mat, x, y, z, parent);
    const P = (hw, hh, hd, mat, x, y, z, parent, o) => mesh(pod(hw, hh, hd, o), mat, x, y, z, parent);
    const glowCap = (r, len, x, y, z, parent, axis = 'y') => { const k = mesh(caps(r, len), M.glow, x, y, z, parent); if (axis === 'x') k.rotation.z = HP; else if (axis === 'z') k.rotation.x = HP; return k; };

    // ---------------- Hips
    const hips = this.hips = new THREE.Group(); hips.position.y = 0.98; B.add(hips);
    L([[-0.1, 0.1, 0.075], [-0.06, 0.15, 0.1], [0.02, 0.165, 0.11], [0.09, 0.15, 0.1]], M.suit, hips, { n: 3 });   // pelvis
    L([[0.03, 0.173, 0.118], [0.082, 0.169, 0.115]], M.trim, hips, { n: 3, b: 0.005 });                              // belt
    P(0.04, 0.026, 0.014, M.armor, 0, 0.056, 0.121, hips, { nv: 3, n: 3 });                                          // buckle
    P(0.022, 0.008, 0.005, M.glow, 0, 0.056, 0.135, hips);
    const skirt = [[0.03, 0.177, 0.122], [-0.03, 0.182, 0.13], [-0.13, 0.172, 0.14]];
    for (const s of [1, -1]) {
      L(skirt, M.armor, hips, { n: 3, arc: mirArc([0.125, 0.242], s), t: 0.012 });                                  // front tassets
      L([[0.03, 0.178, 0.122], [-0.06, 0.19, 0.13], [-0.13, 0.184, 0.126]], M.armor, hips, { n: 3, arc: mirArc([-0.07, 0.07], s), t: 0.012 }); // hip guards
      P(0.034, 0.042, 0.024, M.armorDark, 0.13 * s, -0.02, -0.11, hips, { nv: 3, n: 3 });                          // pouches
    }
    L([[0.03, 0.177, 0.122], [-0.09, 0.173, 0.13]], M.armorDark, hips, { n: 3, arc: [0.66, 0.84], t: 0.012 });     // rear plate

    // ---------------- Legs
    this.legs = [];
    for (const s of [1, -1]) {
      const leg = new THREE.Group(); leg.position.set(0.11 * s, -0.03, 0); hips.add(leg);
      mesh(sph(0.07, 14, 10), M.trim, 0, 0, 0, leg);                                                                 // hip joint
      L([[-0.02, 0.066, 0.066], [-0.1, 0.078, 0.076], [-0.3, 0.066, 0.064], [-0.42, 0.052, 0.052]], M.suit, leg, { n: 2.2, seg: 14 });
      L([[-0.07, 0.083, 0.08, 0.004], [-0.11, 0.092, 0.09, 0.006], [-0.22, 0.09, 0.088, 0.008], [-0.31, 0.078, 0.078, 0.006], [-0.36, 0.068, 0.068, 0.004]],
        M.armor, leg, { n: 2.4, arc: mirArc([-0.08, 0.4], s), t: 0.014 });                                           // thigh plate
      L([[-0.1, 0.086, 0.084], [-0.2, 0.087, 0.085], [-0.3, 0.074, 0.072]], M.armorDark, leg, { n: 2.4, arc: mirArc([0.55, 0.89], s), t: 0.01 }); // hamstring plate
      glowCap(0.005, 0.12, 0.042 * s, -0.21, 0.09, leg);                                                              // thigh light
      const knee = new THREE.Group(); knee.position.y = -0.44; leg.add(knee);
      mesh(sph(0.056, 12, 8), M.trim, 0, 0, 0, knee);                                                                // knee joint
      P(0.058, 0.06, 0.04, M.armorDark, 0, 0.005, 0.06, knee, { nv: 2.2, n: 2.4 });                                  // knee cap
      P(0.036, 0.034, 0.016, M.armor, 0, 0.01, 0.098, knee, { nv: 2.6, n: 2.6 });
      L([[-0.02, 0.058, 0.058], [-0.12, 0.066, 0.066], [-0.3, 0.052, 0.052], [-0.42, 0.046, 0.046]], M.suit, knee, { n: 2.2, seg: 14 });
      L([[-0.07, 0.068, 0.07, 0.006], [-0.13, 0.076, 0.078, 0.008], [-0.26, 0.068, 0.07, 0.008], [-0.36, 0.058, 0.06, 0.006], [-0.395, 0.056, 0.058, 0.004]],
        M.armor, knee, { n: 2.5, arc: [-0.05, 0.55], t: 0.013 });                                                     // greave
      L([[-0.08, 0.07, 0.074], [-0.16, 0.074, 0.08], [-0.3, 0.06, 0.062]], M.armorDark, knee, { n: 2.4, arc: [0.6, 0.9], t: 0.01 }); // calf plate
      glowCap(0.0045, 0.13, 0, -0.22, 0.083, knee);                                                                  // shin light
      L([[-0.395, 0.059, 0.061], [-0.42, 0.056, 0.058]], M.trim, knee, { n: 2.4, b: 0.004 });                          // ankle band
      // Boot on its own ankle joint so it can stay flat on the ground (lofted heel to toe: local Y runs backwards along the foot, local Z is up)
      const ankle = new THREE.Group(); ankle.position.y = -0.44; knee.add(ankle);
      const bootR = (zs) => zs.map(([z, w, h, y]) => [-z, w, h, y]);
      const foot = L(bootR([[-0.095, 0.05, 0.04, 0.005], [-0.08, 0.064, 0.05, 0.005], [0.0, 0.074, 0.056, 0.0], [0.09, 0.072, 0.046, -0.01], [0.16, 0.064, 0.036, -0.02], [0.2, 0.05, 0.026, -0.028]]),
        M.trim, ankle, { n: 2.6, b: 0.01 }, 0, -0.03, 0.05);
      foot.rotation.x = -HP;
      L(bootR([[-0.1, 0.056, 0.012, 0], [-0.085, 0.07, 0.013, 0], [0.1, 0.076, 0.013, 0], [0.19, 0.062, 0.012, 0], [0.215, 0.04, 0.01, 0]]),
        M.rubber, ankle, { n: 4, b: 0.005 }, 0, -0.075, 0.05).rotation.x = -HP;                                        // sole
      L(bootR([[0.07, 0.078, 0.054, -0.006], [0.14, 0.07, 0.044, -0.016], [0.19, 0.058, 0.034, -0.024], [0.205, 0.05, 0.028, -0.028]]),
        M.armor, ankle, { n: 2.6, arc: [0.02, 0.48], t: 0.01 }, 0, -0.03, 0.05).rotation.x = -HP;                     // toe cap
      P(0.054, 0.034, 0.03, M.armorDark, 0, -0.05, -0.035, ankle, { nv: 2.6, n: 2.6 });                             // heel
      glowCap(0.005, 0.08, 0.075 * s, -0.04, 0.06, ankle, 'z');                                                     // boot light
      leg.rotation.order = 'ZXY'; // swing in the leg's plane first, then tilt that plane sideways (see _legIK)
      this.legs.push({ leg, knee, ankle, foot, side: s, target: new THREE.Vector3(0.125 * s, 0.088, 0), pitch: 0, loose: 0 });
    }

    // ---------------- Spine / abdomen
    const spine = this.spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine);
    L([[-0.03, 0.125, 0.09], [0.05, 0.13, 0.092], [0.14, 0.14, 0.095], [0.22, 0.15, 0.1]], M.suit, spine, { n: 2.8 });
    for (let i = 0; i < 3; i++) {
      const y0 = 0.02 + i * 0.055, w = 0.134 + i * 0.004, d = 0.1 + i * 0.002;
      L([[y0, w, d, 0.004], [y0 + 0.045, w + 0.004, d + 0.003, 0.004]], M.armorDark, spine, { n: 2.8, arc: [0.07, 0.43], t: 0.012 }); // ab plates
      if (i < 2) L([[y0 + 0.048, w + 0.002, d + 0.003, 0.004], [y0 + 0.053, w + 0.003, d + 0.003, 0.004]], M.glow, spine, { n: 2.8, arc: [0.12, 0.38], t: 0.004 });
    }
    for (const s of [1, -1]) L([[0.03, 0.142, 0.1], [0.17, 0.15, 0.104]], M.armorDark, spine, { n: 2.8, arc: mirArc([-0.08, 0.055], s), t: 0.01 }); // obliques
    L([[0.02, 0.134, 0.098], [0.17, 0.146, 0.104]], M.armorDark, spine, { n: 2.8, arc: [0.63, 0.87], t: 0.012 });  // lower back

    // ---------------- Chest: tapered torso (broad shoulders, narrow waist) under a one-piece breastplate
    const chest = this.chest = new THREE.Group(); chest.position.y = 0.2; spine.add(chest);
    const torso = [[-0.02, 0.15, 0.1], [0.06, 0.17, 0.112], [0.16, 0.2, 0.125], [0.26, 0.212, 0.128], [0.32, 0.198, 0.12], [0.36, 0.15, 0.1], [0.385, 0.085, 0.075]];
    L(torso, M.suit, chest, { n: 3, seg: 22 });
    L(grow(band(torso, 0.075, 0.35), 0.006, 0.012, 0.008), M.armor, chest, { n: 3, seg: 22, arc: [0.0, 0.5], t: 0.018 });   // breastplate
    L(grow(band(torso, -0.01, 0.07), 0.005, 0.008, 0.004), M.armorDark, chest, { n: 3, arc: [0.06, 0.44], t: 0.012 });     // lower ribs
    L(grow(band(torso, 0.06, 0.33), 0.006, 0.01), M.armorDark, chest, { n: 3, arc: [0.55, 0.95], t: 0.014 });              // back plate
    P(0.018, 0.1, 0.014, M.armorDark, 0, 0.21, 0.146, chest, { nv: 3, n: 3 });                                    // sternum ridge
    glowCap(0.004, 0.13, 0, 0.21, 0.16, chest);
    L([[0.262, 0.219, 0.139, 0.014], [0.272, 0.218, 0.138, 0.014]], M.glow, chest, { n: 3, arc: [0.16, 0.34], t: 0.004 }); // chest light
    for (const s of [1, -1]) for (let i = 0; i < 3; i++) P(0.034, 0.004, 0.006, M.rubber, 0.105 * s, 0.13 + i * 0.022, 0.135 - i * 0.002, chest); // vents
    L([[0.34, 0.14, 0.105], [0.37, 0.125, 0.095], [0.395, 0.1, 0.08]], M.trim, chest, { n: 2.6, b: 0.005 });      // collar
    // Back pack
    const pack = new THREE.Group(); pack.position.set(0, 0.17, -0.19); chest.add(pack);
    L([[-0.17, 0.12, 0.05], [-0.14, 0.15, 0.064], [0.11, 0.155, 0.064], [0.16, 0.13, 0.056], [0.18, 0.09, 0.044]], M.trim, pack, { n: 4, b: 0.01 });
    P(0.11, 0.1, 0.018, M.armorDark, 0, 0.02, -0.058, pack, { nv: 4, n: 4 });
    glowCap(0.007, 0.15, 0, -0.11, -0.062, pack, 'x');
    for (let i = 0; i < 4; i++) glowCap(0.004, 0.14, 0, 0.0 + i * 0.024, -0.077, pack, 'x').material = M.rubber;
    for (const s of [1, -1]) mesh(caps(0.026, 0.05), M.rubber, 0.14 * s, 0.12, -0.03, pack);

    // ---------------- Head
    const neck = this.neck = new THREE.Group(); neck.position.y = 0.38; chest.add(neck);
    mesh(cyl(0.062, 0.072, 0.08), M.suit, 0, 0.02, 0, neck);
    for (let i = 0; i < 2; i++) mesh(tor(0.066, 0.008), M.rubber, 0, i * 0.03, 0, neck).rotation.x = HP;
    const head = this.head = new THREE.Group(); head.position.y = 0.13; neck.add(head);

    // ---------------- Arms (pauldrons fixed on chest, arms driven by IK)
    this.arms = [];
    for (const s of [1, -1]) {
      const padG = new THREE.Group(); padG.position.set((0.29 + (tank ? 0.02 : 0)) * s, 0.315, 0); padG.rotation.z = -0.22 * s; chest.add(padG);
      if (tank) padG.scale.set(1.3, 1.1, 1.2);
      L([[-0.075, 0.095, 0.105], [-0.03, 0.104, 0.114], [0.02, 0.098, 0.108], [0.055, 0.075, 0.084], [0.075, 0.04, 0.046], [0.082, 0, 0]], M.armor, padG, { n: 2.6, arc: [0, 1], t: 0.014 }); // pauldron
      L([[0.03, 0.1, 0.11], [0.058, 0.08, 0.088], [0.078, 0.045, 0.05], [0.086, 0, 0]], M.armorDark, padG, { n: 2.6, arc: [0, 1], t: 0.008 }, 0.008 * s, 0, 0);
      L([[-0.068, 0.1, 0.11], [-0.06, 0.101, 0.111]], M.glow, padG, { n: 2.6, b: 0.002 });                       // glowing rim
      const shoulder = new THREE.Group(); shoulder.position.set(0.25 * s, 0.28, 0); chest.add(shoulder);
      mesh(sph(0.068, 12, 8), M.trim, 0, 0, 0, shoulder);
      mesh(caps(0.058, 0.16), M.suit, 0, -0.14, 0, shoulder);
      L([[-0.05, 0.058, 0.06], [-0.09, 0.07, 0.072], [-0.17, 0.068, 0.07], [-0.21, 0.058, 0.06]], M.armorDark, shoulder, { n: 2.4, seg: 14 }); // bicep
      L([[-0.07, 0.075, 0.077], [-0.17, 0.074, 0.076], [-0.2, 0.066, 0.068]], M.armor, shoulder, { n: 2.4, arc: mirArc([-0.14, 0.14], s), t: 0.01 });
      const elbow = new THREE.Group(); elbow.position.y = -0.28; shoulder.add(elbow);
      mesh(sph(0.058, 12, 8), M.trim, 0, 0, 0, elbow);
      P(0.045, 0.04, 0.026, M.armorDark, 0, 0, -0.056, elbow, { nv: 2.6 });                                          // elbow guard
      mesh(caps(0.05, 0.15), M.suit, 0, -0.12, 0, elbow);
      L([[-0.035, 0.058, 0.058], [-0.06, 0.068, 0.068], [-0.13, 0.064, 0.062], [-0.195, 0.052, 0.05]], M.armor, elbow, { n: 2.5, seg: 14 }); // bracer
      glowCap(0.0045, 0.09, 0, -0.115, 0.064, elbow);
      L([[-0.198, 0.05, 0.05], [-0.222, 0.047, 0.047]], M.trim, elbow, { n: 2.4, b: 0.004 });                        // wrist ring
      // Gloved hand: rounded palm, capsule fingers and thumb, knuckle guard
      P(0.037, 0.03, 0.042, M.rubber, 0, -0.262, 0.005, elbow, { nv: 3, n: 3 });
      for (let i = 0; i < 4; i++) { const f = mesh(caps(0.009, 0.028), M.rubber, -0.027 + i * 0.018, -0.305, 0.022, elbow); f.rotation.x = -0.25; }
      const th = mesh(caps(0.011, 0.028), M.rubber, 0.04 * -s, -0.28, 0.022, elbow); th.rotation.set(-0.3, 0, 0.6 * s);
      P(0.035, 0.008, 0.024, M.trim, 0, -0.28, 0.042, elbow, { nv: 3, n: 3 });
      this.arms.push({ shoulder, elbow, side: s });
    }

    this._buildHead(head, neck, chest, pack);

    // Gun mount (right side = -X)
    this.gunMount = new THREE.Group();
    chest.add(this.gunMount);
    this.gunBase = new THREE.Vector3(-0.13, 0.13, 0.3);
    this.gunMount.position.copy(this.gunBase);

    // Shield bubble
    this.shield = new THREE.Mesh(sph(1.15, 32, 24), shieldMaterial(c.accent));
    this.shield.scale.set(0.9, 1.05, 0.9);
    this.shield.position.y = 1.0;
    this.shield.visible = false;
    this.shield.castShadow = false;
    this.root.add(this.shield);

    // Magazine / shell shown in the off hand while reloading
    this.magProp = makePropMesh(this.mats.rubber, this.mats.glow);
    this.gunMount.add(this.magProp);

    this.orb = mesh(sph(0.07, 14, 10), this.mats.glow, 0, 0, 0, this.chest);
    this.orb.castShadow = false;
    this.orb.visible = false;
    this.baseScale = this.body.scale.clone();
    this.allMats = Object.values(this.mats);
    for (const mat of this.allMats) { mat.userData.baseEmissive = mat.emissiveIntensity ?? 0; if (mat.emissive) mat.userData.baseColor = mat.emissive.clone(); }
  }

  // Helmet shell shared by most agents: a lofted dome (k scales it, n sets how square it is), a wraparound visor,
  // a brow plate, chin guard and ear pods. Returns nothing; agent-specific parts go on top.
  _helmet(head, { k = [1, 1, 1], n = 2.5, visor = true, brow = true, mat } = {}) {
    const M = this.mats, HP = Math.PI / 2, [kx, ky, kz] = k;
    const R = (rs) => rs.map(([y, w, d, z = 0]) => [+(y * ky).toFixed(4), +(w * kx).toFixed(4), +(d * kz).toFixed(4), +(z * kz).toFixed(4)]);
    mesh(loft(R([[-0.12, 0.085, 0.09], [-0.09, 0.118, 0.128, 0.004], [-0.02, 0.138, 0.15, 0.004], [0.06, 0.14, 0.152], [0.12, 0.122, 0.134, -0.006], [0.16, 0.085, 0.096, -0.01], [0.182, 0.035, 0.04, -0.012], [0.186, 0, 0, -0.012]]),
      { n, seg: 24 }), mat || M.armor, 0, 0, 0, head);
    if (visor) {
      mesh(loft(R([[-0.035, 0.143, 0.158, 0.004], [0.045, 0.145, 0.158, 0.002]]), { n, seg: 20, arc: [0.1, 0.4], t: 0.012 }), M.visor, 0, 0, 0, head);
      mesh(loft(R([[0.002, 0.147, 0.161, 0.004], [0.009, 0.147, 0.161, 0.004]]), { n, seg: 16, arc: [0.15, 0.35], t: 0.004 }), M.glow, 0, 0, 0, head);
    }
    if (brow) mesh(loft(R([[0.045, 0.147, 0.16, 0.002], [0.078, 0.143, 0.155, -0.001]]), { n, seg: 20, arc: [0.08, 0.42], t: 0.012 }), M.armorDark, 0, 0, 0, head);
    mesh(pod(0.062 * kx, 0.034, 0.034), M.armorDark, 0, -0.1 * ky, 0.104 * kz, head);                              // chin guard
    for (let i = 0; i < 3; i++) mesh(caps(0.005, 0.016), M.rubber, -0.026 + i * 0.026, -0.1 * ky, 0.139 * kz, head);
    for (const s of [1, -1]) {                                                                                     // ear pods
      const x = 0.14 * kx;
      mesh(cyl(0.048, 0.048, 0.04, 18), M.trim, (x + 0.01) * s, -0.01, -0.005, head).rotation.z = HP;
      mesh(cyl(0.034, 0.034, 0.046, 18), M.armorDark, (x + 0.012) * s, -0.01, -0.005, head).rotation.z = HP;
      mesh(cyl(0.024, 0.024, 0.01, 16), M.glow, (x + 0.034) * s, -0.01, -0.005, head).rotation.z = HP;
    }
  }

  _buildHead(head, neck, chest, pack) {
    const M = this.mats, id = this.char.id, HP = Math.PI / 2;
    const glowCap = (r, len, x, y, z, parent, axis = 'y') => { const k = mesh(caps(r, len), M.glow, x, y, z, parent); if (axis === 'x') k.rotation.z = HP; else if (axis === 'z') k.rotation.x = HP; return k; };
    const P = (hw, hh, hd, mat, x, y, z, parent, o) => mesh(pod(hw, hh, hd, o), mat, x, y, z, parent);
    if (id === 'blaze') {
      this._helmet(head);
      const fin = P(0.014, 0.07, 0.12, M.armorDark, 0, 0.17, -0.03, head, { nv: 2.4, n: 2.4 }); fin.rotation.x = -0.35; // crest
      const fe = glowCap(0.004, 0.2, 0, 0.214, -0.05, head); fe.rotation.x = HP - 0.35;
      for (const s of [1, -1]) { const h2 = P(0.01, 0.036, 0.065, M.armorDark, 0.052 * s, 0.16, -0.02, head, { nv: 2.4 }); h2.rotation.set(-0.3, 0, 0.3 * s); }
      // Twin thrusters
      for (const s of [1, -1]) {
        const j = mesh(cyl(0.045, 0.06, 0.2, 18), M.trim, 0.1 * s, -0.08, -0.08, pack); j.rotation.x = 0.15;
        mesh(cyl(0.042, 0.042, 0.01, 18), M.glow, 0.1 * s, -0.185, -0.064, pack).rotation.x = 0.15;
        mesh(tor(0.054, 0.008), M.armor, 0.1 * s, -0.155, -0.068, pack).rotation.x = HP + 0.15;
        mesh(cyl(0.05, 0.05, 0.03, 18), M.armorDark, 0.1 * s, 0.03, -0.096, pack).rotation.x = 0.15;
      }
    } else if (id === 'tank') {
      this._helmet(head, { k: [1.12, 1.0, 1.06], n: 3.2, visor: false, brow: false });
      mesh(loft([[-0.02, 0.162, 0.168, 0.004], [0.075, 0.16, 0.166, 0.0]], { n: 3.2, seg: 22, arc: [0.08, 0.42], t: 0.014 }), M.armorDark, 0, 0, 0, head); // visor frame
      mesh(loft([[0.02, 0.166, 0.172, 0.004], [0.036, 0.166, 0.172, 0.004]], { n: 3.2, seg: 18, arc: [0.14, 0.36], t: 0.006 }), M.glow, 0, 0, 0, head);    // visor slit
      P(0.12, 0.05, 0.08, M.armorDark, 0, -0.085, 0.05, head, { nv: 3, n: 3 });                                    // jaw block
      P(0.028, 0.03, 0.13, M.trim, 0, 0.19, -0.02, head, { nv: 2.6 });                                             // crest
      for (let i = 0; i < 3; i++) mesh(caps(0.009, 0.02), M.trim, -0.05 + i * 0.05, -0.09, 0.134, head);
      // Generator on the back
      mesh(cyl(0.09, 0.09, 0.3, 20), M.armorDark, 0, 0.05, -0.1, pack);
      for (const y of [0.1, 0.0]) mesh(tor(0.095, 0.014), M.glow, 0, y, -0.1, pack).rotation.x = HP;
      for (const y of [0.2, -0.1]) mesh(cyl(0.1, 0.1, 0.03, 20), M.trim, 0, y, -0.1, pack);
      for (const s of [1, -1]) mesh(cyl(0.012, 0.012, 0.2), M.rubber, 0.06 * s, 0.05, -0.19, pack);
    } else if (id === 'ghost') {
      mesh(sph(0.14), M.suit, 0, 0.0, 0, head);
      const hood = mesh(sph(0.18, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), M.armorDark, 0, 0.02, -0.02, head);
      hood.rotation.x = -0.35;
      mesh(loft([[-0.04, 0.12, 0.13, 0.0], [0.035, 0.122, 0.132, 0.0]], { n: 2.4, seg: 20, arc: [0.12, 0.38], t: 0.012 }), M.visor, 0, 0, 0, head); // mask
      P(0.07, 0.036, 0.03, M.armorDark, 0, -0.078, 0.1, head, { nv: 2.6 });                                        // face wrap
      for (let i = 0; i < 3; i++) mesh(caps(0.005, 0.02), M.rubber, -0.03 + i * 0.03, -0.078, 0.128, head);
      for (const s of [1, -1]) mesh(sph(0.016, 10, 8), M.glow, 0.048 * s, 0.005, 0.138, head);
      for (const s of [1, -1]) { const cl = P(0.014, 0.05, 0.032, M.trim, 0.14 * s, -0.02, 0.0, head); cl.rotation.z = 0.15 * s; } // hood clasps
      // Cape
      const capeGeo = new THREE.PlaneGeometry(0.5, 0.95, 4, 8);
      capeGeo.translate(0, -0.475, 0);
      this.cape = new THREE.Mesh(capeGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(this.char.color).multiplyScalar(0.3), roughness: 0.8, side: THREE.DoubleSide }));
      this.cape.castShadow = true;
      this.cape.position.set(0, 0.34, -0.27);
      chest.add(this.cape);
      this.mats.cape = this.cape.material;
      P(0.2, 0.016, 0.026, M.trim, 0, 0.35, -0.24, chest, { nv: 3, n: 3 });                                        // cape clasp bar
    } else if (id === 'frost') {
      this._helmet(head, { k: [1, 1.04, 1] });
      const ice = new THREE.MeshStandardMaterial({ color: 0xbff0ff, emissive: 0x6fd3ff, emissiveIntensity: 0.6, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 });
      this.mats.ice = ice;
      const shard = (x, y, z, s2, rz, parent) => { const k = mesh(new THREE.OctahedronGeometry(s2, 0), ice, x, y, z, parent); k.scale.set(0.6, 1.6, 0.6); k.rotation.z = rz; return k; };
      shard(0, 0.2, -0.02, 0.06, 0, head);
      shard(0.08, 0.17, -0.02, 0.045, -0.5, head);
      shard(-0.08, 0.17, -0.02, 0.045, 0.5, head);
      shard(0.04, 0.18, -0.06, 0.035, -0.2, head);
      shard(-0.04, 0.18, -0.06, 0.035, 0.2, head);
      for (const s2 of [1, -1]) { shard(0.3 * s2, 0.45, -0.02, 0.06, -0.4 * s2, chest); shard(0.24 * s2, 0.48, -0.06, 0.045, -0.2 * s2, chest); shard(0.35 * s2, 0.42, 0.04, 0.035, -0.6 * s2, chest); }
      mesh(cyl(0.07, 0.07, 0.3, 8), ice, 0, 0.02, -0.1, pack);
      for (const y of [0.18, -0.14]) mesh(cyl(0.078, 0.078, 0.03, 16), M.trim, 0, y, -0.1, pack);
      for (const s2 of [1, -1]) shard(0.06 * s2, 0.25, -0.1, 0.04, 0.3 * s2, pack);
    } else if (id === 'nova') {
      this._helmet(head, { k: [0.98, 0.98, 1] });
      glowCap(0.007, 0.036, 0, 0.1, 0.148, head, 'x');                                                             // medical cross
      glowCap(0.007, 0.036, 0, 0.1, 0.148, head);
      const halo = mesh(tor(0.17, 0.01), M.glow, 0, 0.25, -0.02, head); halo.rotation.x = HP - 0.25;
      for (const s of [1, -1]) mesh(caps(0.006, 0.05), M.trim, 0.1 * s, 0.2, -0.02, head);
      P(0.07, 0.02, 0.01, M.glow, 0, 0.02, -0.072, pack);
      P(0.02, 0.07, 0.01, M.glow, 0, 0.02, -0.072, pack);
      for (const s2 of [1, -1]) {
        mesh(cyl(0.035, 0.035, 0.26, 16), M.armorDark, 0.13 * s2, 0.0, -0.02, pack);
        for (const y of [0.11, -0.11]) mesh(cyl(0.04, 0.04, 0.025, 16), M.trim, 0.13 * s2, y, -0.02, pack);
        glowCap(0.006, 0.15, 0.13 * s2, 0.0, 0.017, pack);
      }
    } else if (id === 'echo') {
      this._helmet(head, { n: 2.1, visor: false, brow: false, mat: M.armorDark, k: [1, 1, 1.04] });
      mesh(loft([[-0.075, 0.135, 0.152, 0.006], [0.055, 0.137, 0.156, 0.004]], { n: 2.1, seg: 20, arc: [0.1, 0.4], t: 0.014 }), M.armor, 0, 0, 0, head); // faceplate
      mesh(sph(0.034, 16, 12), M.glow, 0, 0.0, 0.158, head);
      mesh(tor(0.048, 0.007), M.trim, 0, 0.0, 0.158, head);
      mesh(tor(0.064, 0.005), M.trim, 0, 0.0, 0.155, head);
      for (const s of [1, -1]) glowCap(0.004, 0.028, 0.082 * s, 0.0, 0.15, head, 'x');                           // sensor slits
      mesh(cyl(0.006, 0.006, 0.26), M.trim, -0.1, 0.2, -0.04, head).rotation.z = 0.3;
      mesh(sph(0.018, 10, 8), M.glow, -0.14, 0.33, -0.04, head);
      mesh(cyl(0.004, 0.004, 0.18), M.trim, 0.08, 0.17, -0.04, head).rotation.z = -0.25;
      // Radar dish on the back
      const dish = mesh(sph(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.35), M.trim, 0, 0.18, -0.1, pack);
      dish.rotation.x = -HP - 0.4;
      mesh(sph(0.02, 10, 8), M.glow, 0, 0.2, -0.16, pack);
      mesh(cyl(0.012, 0.012, 0.12), M.trim, 0, 0.12, -0.09, pack);
      P(0.03, 0.03, 0.03, M.armorDark, 0, 0.06, -0.09, pack);
    } else if (id === 'rift') {
      // Sleek phase runner: helmet swept back into a crest, blade fins, a glowing rift ring behind the back
      this._helmet(head, { k: [0.95, 1.04, 1.1] });
      for (const s2 of [1, -1]) {
        const crest = P(0.012, 0.03, 0.14, M.armorDark, 0.045 * s2, 0.15, -0.07, head, { nv: 2.4 }); crest.rotation.set(-0.5, -0.12 * s2, 0);
        const edge = mesh(caps(0.004, 0.22), M.glow, 0.045 * s2, 0.176, -0.07, head); edge.rotation.set(-0.5 + HP, 0, 0.12 * s2);
        const wing = P(0.007, 0.055, 0.09, M.armorDark, 0.17 * s2, 0.0, -0.06, head, { nv: 2.4 }); wing.rotation.set(0, 0.35 * s2, 0.2 * s2);
        const wedge = mesh(caps(0.004, 0.085), M.glow, 0.178 * s2, -0.005, 0.01, head); wedge.rotation.set(0, 0.35 * s2, 0.2 * s2);
      }
      mesh(tor(0.2, 0.016), M.glow, 0, 0.14, -0.12, pack);
      mesh(tor(0.14, 0.01), M.armorDark, 0, 0.14, -0.12, pack);
      mesh(sph(0.045, 14, 10), M.glow, 0, 0.14, -0.12, pack).scale.set(1, 1, 0.5);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; P(0.008, 0.026, 0.011, M.trim, Math.cos(a) * 0.2, 0.14 + Math.sin(a) * 0.2, -0.12, pack).rotation.z = a; }
      mesh(caps(0.03, 0.15), M.trim, 0, 0.0, -0.08, pack);
      for (const s2 of [1, -1]) P(0.02, 0.1, 0.007, M.armorDark, 0.07 * s2, -0.12, -0.14, this.hips).rotation.x = 0.15; // hip scarf
    } else if (id === 'rook') {
      // Fortress helm: tall and square-shouldered, a crown of crenellations, a slit visor, a tower shield on the back
      this._helmet(head, { k: [1.06, 1.08, 1.02], n: 3.8, visor: false, brow: false });
      mesh(loft([[-0.01, 0.154, 0.162, 0.004], [0.07, 0.154, 0.162, 0.002]], { n: 3.8, seg: 22, arc: [0.08, 0.42], t: 0.014 }), M.armorDark, 0, 0, 0, head); // visor frame
      mesh(loft([[0.024, 0.158, 0.166, 0.004], [0.04, 0.158, 0.166, 0.004]], { n: 3.8, seg: 18, arc: [0.15, 0.35], t: 0.006 }), M.glow, 0, 0, 0, head);    // slit
      mesh(loft([[0.14, 0.142, 0.15, -0.006], [0.16, 0.14, 0.148, -0.008]], { n: 3.8, seg: 24 }), M.trim, 0, 0, 0, head);                               // crown band
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; const b = P(0.026, 0.024, 0.016, M.armorDark, Math.cos(a) * 0.13, 0.19, Math.sin(a) * 0.138 - 0.008, head, { nv: 4, n: 4 }); b.rotation.y = -a + HP; }
      for (const s2 of [1, -1]) P(0.026, 0.085, 0.085, M.armorDark, 0.155 * s2, 0.02, 0.0, head, { nv: 3, n: 3 });  // cheek plates
      // Tower shield across the back
      const sh = [[-0.26, 0.12, 0.02], [-0.2, 0.19, 0.026], [0.22, 0.2, 0.026], [0.3, 0.13, 0.022]];
      mesh(loft(sh, { n: 4, b: 0.01 }), M.armor, 0, 0.06, -0.1, pack);
      mesh(loft(sh.map(([y, w, d]) => [y * 0.85, w * 0.82, d]), { n: 4, b: 0.008 }), M.armorDark, 0, 0.06, -0.116, pack);
      glowCap(0.006, 0.36, 0, 0.07, -0.142, pack);
      glowCap(0.006, 0.2, 0, 0.12, -0.142, pack, 'x');
      P(0.03, 0.03, 0.03, M.trim, 0, 0.06, -0.08, pack);
    } else { // volt
      this._helmet(head);
      for (const s of [1, -1]) P(0.022, 0.022, 0.008, M.glow, 0.058 * s, 0.006, 0.168, head);                    // eyes
      for (const s of [1, -1]) {                                                                                   // ear coils
        mesh(cyl(0.062, 0.062, 0.05, 18), M.trim, 0.156 * s, 0.0, 0, head).rotation.z = HP;
        mesh(cyl(0.046, 0.046, 0.054, 18), M.glow, 0.16 * s, 0.0, 0, head).rotation.z = HP;
      }
      mesh(tor(0.168, 0.012, Math.PI), M.trim, 0, 0.0, 0, head);
      mesh(cyl(0.006, 0.006, 0.22), M.trim, 0.14, 0.18, -0.02, head);
      mesh(sph(0.022, 10, 8), M.glow, 0.14, 0.3, -0.02, head);
      for (const s of [1, -1]) glowCap(0.005, 0.15, 0.05 * s, 0.17, -0.01, head, 'z');                           // head-top light strips
      // Tesla coils on the back
      for (const s of [1, -1]) {
        mesh(cyl(0.03, 0.03, 0.34, 16), M.trim, 0.1 * s, 0.1, -0.08, pack);
        for (let i = 0; i < 3; i++) mesh(tor(0.045, 0.01), M.glow, 0.1 * s, 0.0 + i * 0.09, -0.08, pack).rotation.x = HP;
        mesh(sph(0.032, 12, 8), M.armorDark, 0.1 * s, 0.28, -0.08, pack);
        mesh(cyl(0.04, 0.04, 0.03, 16), M.armorDark, 0.1 * s, -0.06, -0.08, pack);
      }
    }
  }

  // Far-away characters skip the shadow pass (they are tiny on screen anyway)
  setShadow(on) {
    if (on === this.shadowOn) return;
    this.shadowOn = on;
    this.shadowMeshes ||= (() => { const l = []; this.body.traverse(o => { if (o.isMesh && o.castShadow) l.push(o); }); return l; })();
    for (const m of this.shadowMeshes) m.castShadow = on;
    this.gun?.traverse(o => { if (o.isMesh) o.castShadow = on; });
  }

  setWeapon(id, skin = 'default') {
    if (id === this.weaponId && skin === this.skinId) return;
    this.weaponId = id; this.skinId = skin;
    if (this.gun) { this.gunMount.remove(this.gun); disposeMerged(this.gun); }
    this.gun = buildGun(id, this.char.accent, skin);
    this.gunMount.add(this.gun);
    if (this.shadowOn === false) this.gun.traverse(o => { if (o.isMesh) o.castShadow = false; });
    // Sidearms are held closer to the chest
    const side = SIDEARMS.has(id);
    this.gunBase.set(side ? -0.07 : -0.13, side ? 0.16 : 0.13, side ? 0.36 : 0.28);
  }

  // Muzzle world position (after updateMatrixWorld)
  getMuzzle(out) {
    return out.copy(this.gun.userData.muzzle).applyMatrix4(this.gun.matrixWorld);
  }

  kick(amount) { this.recoil = Math.min(1, this.recoil + amount); }
  hit() { this.flash = 1; this.flinch = 1; this.flinchDir = Math.random() < 0.5 ? -1 : 1; }

  // One-shot body animations for abilities and gestures
  play(kind) {
    const DUR = { throw: 0.55, cast: 0.7, slam: 0.8, dash: 0.3, blink: 0.35, brace: 0.6, rocket: 0.6, inspect: 2.2, wave: 1.6 };
    if (!DUR[kind]) return;
    this.act = { kind, t: 0, dur: DUR[kind] };
  }

  // Two-bone IK in chest space.
  _solveArm(arm, target, pole) {
    const a = 0.28, b = 0.26;
    _t.copy(target).sub(arm.shoulder.position);
    const d = Math.min(Math.max(_t.length(), 0.05), a + b - 0.002);
    _t.normalize();
    const alpha = Math.acos(THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    _n.crossVectors(_t, pole).normalize();
    // U = t cos a + (n x t) sin a
    _v.crossVectors(_n, _t).multiplyScalar(Math.sin(alpha)).addScaledVector(_t, Math.cos(alpha)).normalize();
    // Basis: local -Y -> U, local X -> n
    _y.copy(_v).negate();
    _x.copy(_n).addScaledVector(_y, -_n.dot(_y)).normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z);
    arm.shoulder.quaternion.setFromRotationMatrix(_m);
    // Forearm direction in upper-arm space
    _p.copy(_t).multiplyScalar(d).addScaledVector(_v, -a).normalize(); // elbow -> hand
    _q.copy(arm.shoulder.quaternion).invert();
    _p.applyQuaternion(_q);
    arm.elbow.quaternion.setFromUnitVectors(DOWN, _p);
  }

  // Two-bone leg IK: F is the ankle target relative to the hip joint, in hips space. The thigh swings in its own
  // plane (leg X), that plane tilts sideways (leg Z, order ZXY), and the ankle turns the boot to the wanted pitch.
  _legIK(L, F, pitch, loose = 0) {
    const L1 = 0.44, L2 = 0.44;
    const dd = Math.hypot(F.x, F.y), az = Math.atan2(F.x, -F.y);
    const D = THREE.MathUtils.clamp(Math.hypot(F.z, dd), 0.12, L1 + L2 - 0.001);
    const bend = Math.PI - Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
    const a = Math.atan2(F.z, dd), b = Math.acos(THREE.MathUtils.clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    L.leg.rotation.set(-(a + b), 0, az);
    L.knee.rotation.set(bend, 0, 0);
    // Boot flat to the body (yaw and roll undone), pitched by the gait: ankle = (hips * leg * knee)^-1 * pitch
    _qa.copy(this.hips.quaternion).multiply(L.leg.quaternion).multiply(L.knee.quaternion).invert();
    _qb.setFromEuler(_e.set(pitch, 0, 0));
    L.ankle.quaternion.copy(_qa).multiply(_qb);
    const w = 0.6 * loose * THREE.MathUtils.clamp((bend - 0.6) / 0.8, 0, 1);
    if (w > 0) L.ankle.quaternion.slerp(_qb.setFromEuler(_e.set(0.5, 0, 0)), w);
  }

  /**
   * s: { vx, vz, yaw, pitch, grounded, dead, reload (0..1 or -1), shield, kneel, crouch (0..1), ghostAlpha }
   */
  update(dt, s) {
    this.time += dt;
    const root = this.root;
    root.rotation.y = s.yaw + Math.PI;

    // Local velocity
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const fwd = -(s.vx * sin + s.vz * cos);        // along facing
    const side = s.vx * cos - s.vz * sin;           // along right
    const speed = Math.hypot(s.vx, s.vz);
    const cr = s.crouch || 0;
    const target = s.grounded ? Math.min(1, speed / 2.5) : 0;
    this.moveAmt += (target - this.moveAmt) * Math.min(1, dt * 10);
    this.airAmt += ((s.grounded ? 0 : 1) - this.airAmt) * Math.min(1, dt * 8);
    this.kneelAmt = (this.kneelAmt || 0) + ((s.kneel ? 1 : 0) - (this.kneelAmt || 0)) * Math.min(1, dt * 8);
    const amt = this.moveAmt, air = this.airAmt, kn = this.kneelAmt;
    const fdir = speed > 0.1 ? fwd / speed : 1, sdir = speed > 0.1 ? side / speed : 0;

    // Gait: the phase advances with distance, so a planted foot slides back exactly as fast as the body moves
    const run = THREE.MathUtils.clamp((speed - 3) / 3.5, 0, 1) * (1 - cr);
    const cyc = 0.9 + speed * 0.26;                                   // metres per full stride (two steps)
    this.phase = (this.phase + speed * dt / cyc) % 1;
    const Rs = 0.3 + 0.12 * run + 0.06 * cr;                          // half the foot's travel (longer when low)
    const duty = THREE.MathUtils.clamp(2 * Rs / cyc, 0.3, 0.65);       // share of the stride a foot is planted
    const lift = (0.08 + 0.16 * run) * (1 - cr * 0.4);
    const lat = Math.abs(sdir);
    const mx = -sdir * (1 - 0.35 * lat), mz = fdir;                   // shorter steps when strafing so the feet never cross
    const pitchK = (0.3 + 0.7 * Math.max(0, fdir)) * amt;             // heel-toe roll mostly when going forwards
    const tL = this.phase;
    for (const L of this.legs) {
      const sd = L.side, t = (tL + (sd > 0 ? 0 : 0.5)) % 1;
      let off, up = 0, pitch, loose = 0;
      if (t < duty) {                                                  // planted: heel strike, roll through, push off the toe
        const tt = t / duty;
        off = Rs * (1 - 2 * tt);
        pitch = -0.22 * Math.max(0, 1 - tt * 4) ** 2 + 0.45 * Math.max(0, (tt - 0.6) / 0.4) ** 2;
      } else {                                                         // swinging through
        const u = (t - duty) / (1 - duty), e = u * u * (3 - 2 * u);
        off = -Rs + 2 * Rs * e;
        up = lift * Math.sin(Math.PI * Math.pow(u, 0.75));
        pitch = 0.45 * (1 - u) ** 2 - 0.22 * u ** 3;
        loose = Math.sin(Math.PI * Math.min(1, u * 1.4));
      }
      pitch *= pitchK;
      // Idle stance (wider and staggered when crouched) blended into the stepping stance
      const ix = sd * (0.125 + 0.035 * cr), iz = (sd > 0 ? 0.04 : -0.04) + (sd > 0 ? 0.1 : -0.13) * cr;
      const gx = sd * (0.125 + 0.07 * lat) + mx * off, gz = mz * off;
      let fx = ix + (gx - ix) * amt, fz = iz + (gz - iz) * amt, fy = up * amt;
      pitch += (sd > 0 ? 0 : 0.35 * cr) * (1 - amt);                   // back heel up in a crouch
      // Keep the toe or heel on the floor as the foot rolls
      fy += pitch > 0 ? 0.24 * Math.sin(pitch) : 0.06 * Math.sin(-pitch);
      fz -= pitch > 0 ? 0.24 * (1 - Math.cos(pitch)) : 0;
      // Airborne: tuck one knee up
      fx += (sd * 0.13 - fx) * air; fz += ((sd > 0 ? 0.18 : -0.1) - fz) * air; fy += ((sd > 0 ? 0.34 : 0.22) - fy) * air;
      pitch += ((sd > 0 ? 0.25 : 0.5) - pitch) * air;
      // Kneel: left foot planted forward, right knee down with the toe tucked
      if (kn > 0.001) {
        const kx = sd > 0 ? 0.14 : -0.12, kz = sd > 0 ? 0.3 : -0.36, kp = sd > 0 ? 0 : 0.9;
        const ky = 0.24 * Math.sin(kp);
        fx += (kx - fx) * kn; fy += (ky - fy) * kn; fz += (kz - fz) * kn; pitch += (kp - pitch) * kn;
      }
      L.target.set(fx, fy + 0.088, fz); L.pitch = pitch;
      L.loose = Math.max(loose * amt, air * 0.7) * (1 - kn);             // a lifted foot hangs from the shin instead of staying level
    }

    // Pelvis: rises through a running stride's flight, shifts over the planted foot, turns with the stride,
    // and never sits higher than a slightly bent leg can reach the lower foot (that gives the walking dip)
    const c2 = Math.cos(4 * Math.PI * (tL - duty / 2)), c1 = Math.cos(2 * Math.PI * (tL - duty / 2));
    const breathe = Math.sin(this.time * 2.2) * 0.008;
    let hy = 0.98 + breathe + amt * run * 0.035 * (1 - c2) / 2 - 0.42 * cr * (1 - kn) - 0.4 * kn;
    for (const L of this.legs) {
      const dx = L.target.x - 0.11 * L.side, dz = L.target.z;
      hy = Math.min(hy, L.target.y + 0.03 + Math.sqrt(Math.max(0, 0.855 * 0.855 - dx * dx - dz * dz)));
    }
    const legL = this.legs.find(l => l.side === 1);
    const fwdL = THREE.MathUtils.clamp((legL.target.z * mz + legL.target.x * mx) / Math.max(Rs, 0.05), -1, 1) * amt * (1 - air);
    this.hips.position.x = c1 * 0.018 * amt * (1 - cr * 0.5);
    this.hips.position.y = hy;
    this.hips.rotation.set(amt * (0.06 + 0.1 * run) * fdir + 0.3 * cr, -0.16 * fwdL * fdir, c1 * 0.05 * amt);
    this.spine.rotation.y = -this.hips.rotation.y * 0.8;

    // Aim pitch spread across spine/chest; head keeps a little
    const p = THREE.MathUtils.clamp(s.pitch, -1.3, 1.3);
    this.spine.rotation.x = -p * 0.35 - this.hips.rotation.x + 0.12 * cr;
    this.spine.rotation.z = -this.hips.rotation.z * 0.7;
    this.chest.rotation.x = -p * 0.5 - 0.12 * cr;
    this.neck.rotation.x = -p * 0.15;
    // One-shot animations add to these below, so start from neutral every frame
    this.neck.rotation.y = 0; this.neck.rotation.z = 0;
    this.chest.rotation.y = -this.hips.rotation.y * 0.2;
    this.chest.rotation.z = -this.hips.rotation.z * 0.3;

    // ---- One-shot actions (abilities / gestures)
    let act = null, k = 0, env = 0;
    if (this.act) {
      this.act.t += dt;
      k = Math.min(1, this.act.t / this.act.dur);
      env = Math.sin(k * Math.PI);
      act = this.act.kind;
      if (this.act.t >= this.act.dur) this.act = null;
    }
    if (kn > 0.01) this.spine.rotation.x += 0.35 * kn;
    // Flinch when hit
    this.flinch = Math.max(0, (this.flinch || 0) - dt * 6);
    if (this.flinch > 0) {
      this.chest.rotation.x += this.flinch * 0.22;
      this.chest.rotation.z += this.flinch * 0.12 * this.flinchDir;
      this.neck.rotation.x += this.flinch * 0.15;
    }
    if (act === 'dash') { this.spine.rotation.x += 0.45 * env; this.hips.position.y -= 0.08 * env; }
    if (act === 'brace') this.hips.position.y -= 0.12 * env;
    if (act === 'slam') {
      if (k < 0.45) this.hips.position.y += 0.18 * Math.sin(k / 0.45 * Math.PI / 2);
      else { const d = Math.sin((k - 0.45) / 0.55 * Math.PI); this.hips.position.y += 0.18 - 0.55 * d; this.spine.rotation.x += 0.55 * d; }
    }
    if (act === 'throw') this.chest.rotation.y += (k < 0.4 ? 0.45 * k / 0.4 : 0.45 - 1.0 * (k - 0.4) / 0.6) * (k < 0.95 ? 1 : 0);
    if (act === 'inspect') { this.neck.rotation.y -= 0.35 * env; this.neck.rotation.x += 0.25 * env; }
    // Feet: solve both legs now that the pelvis has settled (targets are in body space, floor at y = 0)
    this.hips.updateMatrix();
    _mi.copy(this.hips.matrix).invert();
    for (const L of this.legs) this._legIK(L, _f.copy(L.target).applyMatrix4(_mi).sub(L.leg.position), L.pitch, L.loose);
    const bs = this.baseScale;
    if (act === 'blink') this.body.scale.set(bs.x * (1 - 0.3 * env), bs.y * (1 + 0.35 * env), bs.z * (1 - 0.3 * env));
    else this.body.scale.copy(bs);

    // Gun: recoil + reload motion + action poses
    this.recoil = Math.max(0, this.recoil - dt * 6);
    const g = this.gunMount;
    g.position.copy(this.gunBase);
    g.rotation.set(0, 0, 0);
    g.position.z -= this.recoil * 0.08;
    g.rotation.x = -this.recoil * 0.35;
    // Reload: tilt the gun, and the off hand fetches / seats the magazine (see reload.js)
    const R = s.reload >= 0 ? reloadAnim(this.weaponId, s.reload, this.gun.userData.fore) : null;
    if (R) {
      g.rotation.z += R.pose.roll;
      g.rotation.x -= R.pose.up;
      g.position.y += R.pose.dy;
    }
    const mp = this.magProp;
    mp.visible = !!(R && R.prop);
    if (mp.visible) { mp.position.copy(R.propPos); mp.scale.set(R.propSize[0], R.propSize[1], R.propSize[2]); }
    const lower = act === 'throw' || act === 'cast' || act === 'slam' ? env : 0;
    g.rotation.z += lower * 0.9; g.position.y -= lower * 0.12; g.position.x -= lower * 0.05;
    if (kn > 0.01) { g.rotation.x += 0.7 * kn; g.position.y -= 0.1 * kn; }
    if (act === 'brace') { g.position.y += 0.08 * env; g.rotation.x -= 0.35 * env; }
    if (act === 'rocket') { g.position.y += 0.1 * env; g.position.x += 0.04 * env; g.rotation.x -= 0.25 * env; }
    if (act === 'inspect') { g.rotation.y += 1.3 * env; g.rotation.z -= 0.5 * env; g.position.x += 0.1 * env; g.position.y += 0.12 * env; g.position.z -= 0.08 * env; }
    g.updateMatrix();

    // Hands to the gun (the off hand leaves it for throws, casts, slams and planting)
    const ud = this.gun.userData;
    const right = this.arms.find(a => a.side === -1), left = this.arms.find(a => a.side === 1);
    _p.copy(ud.grip).applyMatrix4(g.matrix);
    this._solveArm(right, _p.clone(), new THREE.Vector3(-0.8, -0.6, -0.4).normalize());
    _p.copy(R ? R.hand : ud.fore).applyMatrix4(g.matrix);
    let off = null, w = 0;
    if (act === 'throw') { off = k < 0.4 ? new THREE.Vector3(0.32, 0.55, -0.22) : new THREE.Vector3(0.12, 0.38, 0.62); w = Math.min(1, env * 1.6); }
    if (act === 'cast') { off = new THREE.Vector3(0.16, 0.5 + Math.sin(this.time * 10) * 0.02, 0.42); w = Math.min(1, env * 1.8); }
    if (act === 'slam') { off = k < 0.45 ? new THREE.Vector3(0.22, 0.75, 0.15) : new THREE.Vector3(0.2, -0.3, 0.45); w = Math.min(1, env * 1.8); }
    if (act === 'wave') { off = new THREE.Vector3(0.38, 0.72, 0.12 + Math.sin(this.time * 12) * 0.12); w = Math.min(1, env * 2); }
    if (kn > 0.01 && !off) { off = new THREE.Vector3(0.12, -0.42, 0.42); w = kn; }
    if (off) _p.lerp(off, w);
    this._solveArm(left, _p.clone(), new THREE.Vector3(0.8, -0.7, -0.2).normalize());
    // Glowing orb in the off hand while casting
    this.orb.visible = act === 'cast' && env > 0.15;
    if (this.orb.visible) { this.orb.position.copy(_p); this.orb.scale.setScalar(0.6 + env * 0.8 + Math.sin(this.time * 20) * 0.1); }

    // Cape
    if (this.cape) this.cape.rotation.x = 0.12 + amt * 0.5 * Math.max(0, fdir) + this.airAmt * 0.4 + Math.sin(this.time * 3) * 0.04;

    // Shield
    this.shield.visible = !!s.shield;
    if (s.shield) this.shield.material.uniforms.uTime.value = this.time;

    // Hit flash
    this.flash = Math.max(0, this.flash - dt * 9);
    for (const mat of this.allMats) {
      if (!mat.emissive) continue;
      if (mat.userData.baseEmissive === undefined) mat.userData.baseEmissive = mat.emissiveIntensity;
      if (this.flash > 0) { mat.userData.flashing = true; mat.emissiveIntensity = mat === this.mats.glow ? mat.userData.baseEmissive + this.flash : 0.35 * this.flash; if (mat !== this.mats.glow) mat.emissive.setRGB(1, 0.3, 0.25); }
      else if (mat.userData.flashing) { mat.userData.flashing = false; mat.emissiveIntensity = mat.userData.baseEmissive; mat.emissive.copy(mat.userData.baseColor); }
    }

    // Death: fall one of four ways, then sink
    if (s.dead) {
      if (!this.deathT) this.deathKind = Math.floor(Math.random() * 4);
      this.deathT = Math.min(1.6, this.deathT + dt);
      const dk = Math.min(1, this.deathT / 0.5);
      const e = dk < 1 ? dk * dk * (3 - 2 * dk) : 1;
      const bounce = this.deathT > 0.5 ? Math.sin(Math.min(1, (this.deathT - 0.5) / 0.25) * Math.PI) * 0.06 : 0;
      const sink = e * 0.15 + bounce - Math.max(0, this.deathT - 1.0) * 0.8;
      const kind = this.deathKind;
      this.body.rotation.set(kind === 0 ? -e * Math.PI / 2 : kind === 1 ? e * Math.PI / 2 : 0, 0, kind === 2 ? e * Math.PI / 2 : kind === 3 ? -e * Math.PI / 2 : 0);
      this.body.position.set(kind === 2 ? -e * 0.2 : kind === 3 ? e * 0.2 : 0, sink, kind === 0 ? -e * 0.2 : kind === 1 ? e * 0.25 : 0);
      this.orb.visible = false;
    } else if (this.deathT) {
      this.deathT = 0;
      this.body.rotation.set(0, 0, 0);
      this.body.position.set(0, 0, 0);
    }

    // Blink / spawn flicker
    const vis = s.ghostAlpha === undefined ? true : s.ghostAlpha > 0.5 || Math.sin(this.time * 40) > 0;
    this.body.visible = vis;
  }

  dispose() {
    this.root.traverse(o => { if (o.material && !o.material.userData?.shared) o.material.dispose?.(); });
  }
}

// The spike (bomb) for attack/defend mode.
export function buildSpike() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x22252b, metalness: 0.85, roughness: 0.3 });
  const plate = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.8, roughness: 0.35 });
  const red = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3d5a, emissiveIntensity: 2.4 });
  mesh(cyl(0.15, 0.2, 0.5, 8), dark, 0, 0.25, 0, g);
  for (const y of [0.12, 0.3, 0.44]) mesh(tor(0.175, 0.014), red, 0, y, 0, g).rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const fin = mesh(rb(0.04, 0.34, 0.14, 0.01), plate, Math.cos(i * Math.PI / 2) * 0.2, 0.22, Math.sin(i * Math.PI / 2) * 0.2, g);
    fin.rotation.y = -i * Math.PI / 2;
  }
  const core = mesh(sph(0.07, 12, 10), red, 0, 0.56, 0, g);
  const light = new THREE.PointLight(0xff3d5a, 0, 8, 2);
  light.position.y = 0.7; g.add(light);
  g.userData = { core, light, red };
  return g;
}
