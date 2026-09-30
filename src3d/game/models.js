// Procedural character + weapon models with IK arms and procedural animation.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { skinMats } from './skins.js';

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
    muzzle = new THREE.Vector3(0, 0.035, 0.8);
    fore = new THREE.Vector3(0, -0.04, 0.34);
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
    const tank = c.id === 'tank', ghost = c.id === 'ghost';
    if (tank) B.scale.set(1.16, 1.07, 1.12);
    if (ghost) B.scale.set(0.95, 1.0, 0.95);
    // Small-part helpers: cheaper rounded boxes, and glow strips
    const glowBar = (w, h, d, x, y, z, parent) => mesh(rbs(w, h, d, Math.min(w, h, d) * 0.4), M.glow, x, y, z, parent);
    const bolt = (x, y, z, parent, r = 0.011) => { const k = mesh(cyl(r, r, 0.008, 8), M.trim, x, y, z, parent); k.rotation.x = Math.PI / 2; return k; };

    // ---------------- Hips
    const hips = this.hips = new THREE.Group(); hips.position.y = 0.98; B.add(hips);
    mesh(rbs(0.34, 0.18, 0.22, 0.05), M.suit, 0, 0, 0, hips);
    mesh(rbs(0.37, 0.065, 0.25, 0.02), M.trim, 0, 0.055, 0, hips);
    mesh(rbs(0.075, 0.05, 0.028, 0.012), M.armor, 0, 0.055, 0.132, hips);           // belt buckle
    glowBar(0.045, 0.02, 0.012, 0, 0.055, 0.15, hips);
    for (const s of [1, -1]) {
      mesh(rbs(0.09, 0.11, 0.06, 0.015), M.armorDark, 0.2 * s, -0.02, 0.02, hips);   // side pouches
      mesh(rbs(0.094, 0.025, 0.064, 0.008), M.trim, 0.2 * s, 0.03, 0.02, hips);     // pouch flap
      mesh(rbs(0.03, 0.03, 0.012, 0.006), M.trim, 0.2 * s, -0.01, 0.055, hips);     // pouch clasp
      mesh(rbs(0.05, 0.1, 0.12, 0.02), M.armor, 0.165 * s, -0.03, -0.03, hips);      // hip guard
      mesh(rbs(0.075, 0.13, 0.03, 0.015), M.armor, 0.06 * s, -0.06, 0.125, hips);    // front tassets
      mesh(rbs(0.07, 0.03, 0.03, 0.01), M.trim, 0.06 * s, -0.115, 0.13, hips);
    }
    mesh(rbs(0.16, 0.12, 0.05, 0.02), M.armor, 0, -0.04, 0.11, hips);                // codpiece plate
    mesh(rbs(0.22, 0.09, 0.05, 0.02), M.armorDark, 0, -0.03, -0.12, hips);           // rear plate

    // ---------------- Legs
    this.legs = [];
    for (const s of [1, -1]) {
      const leg = new THREE.Group(); leg.position.set(0.11 * s, -0.03, 0); hips.add(leg);
      mesh(sph(0.075, 14, 10), M.trim, 0, 0.0, 0, leg);                                  // hip joint
      mesh(caps(0.085, 0.26), M.suit, 0, -0.21, 0, leg);
      mesh(rbs(0.17, 0.22, 0.12, 0.04), M.armor, 0.01 * s, -0.2, 0.045, leg);           // thigh plate
      mesh(rbs(0.15, 0.06, 0.13, 0.02), M.armorDark, 0.01 * s, -0.08, 0.04, leg);      // upper thigh band
      mesh(rbs(0.05, 0.16, 0.03, 0.01), M.trim, 0.09 * s, -0.2, 0.0, leg);
      glowBar(0.012, 0.13, 0.012, 0.03 * s, -0.2, 0.108, leg);                          // glowing thigh stripe
      mesh(rbs(0.14, 0.06, 0.1, 0.02), M.armorDark, 0.0, -0.33, 0.04, leg);            // lower thigh guard
      mesh(rbs(0.11, 0.11, 0.07, 0.02), M.armorDark, 0.0, -0.21, -0.075, leg);         // hamstring pad
      const knee = new THREE.Group(); knee.position.y = -0.44; leg.add(knee);
      mesh(sph(0.06, 12, 8), M.trim, 0, 0, 0, knee);                                     // knee joint
      mesh(rbs(0.13, 0.12, 0.09, 0.035), M.armorDark, 0, 0, 0.07, knee);                // knee cap
      mesh(rbs(0.09, 0.075, 0.03, 0.015), M.armor, 0, 0, 0.12, knee);                   // knee plate
      glowBar(0.05, 0.012, 0.012, 0, 0.005, 0.138, knee);
      mesh(caps(0.075, 0.26), M.suit, 0, -0.2, 0, knee);
      const greave = mesh(cyl(0.075, 0.058, 0.3, 10), M.armor, 0, -0.22, 0.04, knee);   // tapered shin greave
      greave.scale.set(1.0, 1, 0.72);
      mesh(rbs(0.05, 0.22, 0.03, 0.01), M.armorDark, 0, -0.2, 0.108, knee);            // shin ridge
      mesh(rbs(0.11, 0.2, 0.06, 0.02), M.armorDark, 0, -0.22, -0.065, knee);           // calf guard
      mesh(rbs(0.15, 0.04, 0.12, 0.015), M.trim, 0, -0.39, 0.01, knee);                // ankle cuff
      bolt(0.075 * s, -0.16, 0.0, knee).rotation.set(0, 0, Math.PI / 2);
      // Boot
      const foot = mesh(rbs(0.15, 0.1, 0.29, 0.035), M.trim, 0, -0.475, 0.05, knee);
      mesh(rbs(0.155, 0.035, 0.3, 0.012), M.rubber, 0, -0.51, 0.05, knee);              // sole
      mesh(rbs(0.145, 0.06, 0.09, 0.03), M.armor, 0, -0.475, 0.16, knee);               // toe cap
      mesh(rbs(0.14, 0.05, 0.08, 0.02), M.armorDark, 0, -0.5, -0.09, knee);             // heel
      glowBar(0.008, 0.02, 0.15, 0.078 * s, -0.47, 0.05, knee);                          // boot side light
      for (let i = 0; i < 3; i++) mesh(rbs(0.157, 0.006, 0.012, 0.002), M.rubber, 0, -0.518, 0.0 + i * 0.09, knee); // tread
      this.legs.push({ leg, knee, foot, side: s });
    }

    // ---------------- Spine / abdomen
    const spine = this.spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine);
    mesh(rbs(0.3, 0.2, 0.2, 0.06), M.suit, 0, 0.1, 0, spine);
    for (let i = 0; i < 3; i++) mesh(rbs(0.26, 0.045, 0.05, 0.015), M.armorDark, 0, 0.04 + i * 0.055, 0.1, spine);
    for (let i = 0; i < 3; i++) glowBar(0.2, 0.006, 0.006, 0, 0.065 + i * 0.055, 0.128, spine);
    for (const s of [1, -1]) mesh(rbs(0.05, 0.16, 0.16, 0.02), M.armorDark, 0.15 * s, 0.1, 0, spine); // oblique plates
    mesh(rbs(0.16, 0.16, 0.04, 0.02), M.armorDark, 0, 0.1, -0.11, spine);                            // lower back plate

    // ---------------- Chest
    const chest = this.chest = new THREE.Group(); chest.position.y = 0.2; spine.add(chest);
    mesh(rbs(0.42, 0.34, 0.26, 0.08), M.suit, 0, 0.17, 0, chest);
    for (const s of [1, -1]) mesh(rbs(0.215, 0.27, 0.13, 0.05), M.armor, 0.11 * s, 0.2, 0.09, chest);    // split pec plates
    mesh(rbs(0.05, 0.27, 0.13, 0.02), M.armorDark, 0, 0.2, 0.095, chest);                            // sternum ridge
    mesh(rbs(0.36, 0.1, 0.03, 0.015), M.armorDark, 0, 0.1, 0.155, chest);
    for (const s of [1, -1]) glowBar(0.006, 0.2, 0.006, 0.026 * s, 0.22, 0.164, chest);
    glowBar(0.18, 0.022, 0.012, 0, 0.26, 0.16, chest);
    for (let i = 0; i < 3; i++) mesh(rbs(0.09, 0.008, 0.01, 0.003), M.rubber, 0.11, 0.12 + i * 0.02, 0.163, chest); // vents
    for (let i = 0; i < 3; i++) mesh(rbs(0.09, 0.008, 0.01, 0.003), M.rubber, -0.11, 0.12 + i * 0.02, 0.163, chest);
    mesh(rbs(0.25, 0.07, 0.21, 0.03), M.trim, 0, 0.36, -0.01, chest);                                    // collar
    mesh(rbs(0.3, 0.04, 0.26, 0.015), M.armorDark, 0, 0.335, 0.0, chest);                              // gorget
    for (const s of [1, -1]) {
      mesh(rbs(0.05, 0.3, 0.03, 0.01), M.rubber, 0.1 * s, 0.2, 0.152, chest);                          // harness straps
      mesh(rbs(0.06, 0.06, 0.03, 0.01), M.trim, 0.1 * s, 0.14, 0.16, chest);
      bolt(0.19 * s, 0.24, 0.15, chest, 0.009);
    }
    // Back pack
    const pack = new THREE.Group(); pack.position.set(0, 0.17, -0.19); chest.add(pack);
    mesh(rbs(0.32, 0.34, 0.13, 0.04), M.trim, 0, 0, 0, pack);
    mesh(rbs(0.26, 0.2, 0.04, 0.02), M.armorDark, 0, 0.02, -0.07, pack);
    glowBar(0.2, 0.02, 0.01, 0, -0.1, -0.09, pack);
    for (let i = 0; i < 4; i++) mesh(rbs(0.2, 0.008, 0.01, 0.003), M.rubber, 0, 0.06 + i * 0.022, -0.093, pack);
    for (const s of [1, -1]) { mesh(rbs(0.03, 0.03, 0.05, 0.01), M.rubber, 0.13 * s, 0.14, -0.09, pack); bolt(0.15 * s, 0.0, 0.0, pack).rotation.set(0, 0, Math.PI / 2); }

    // ---------------- Head
    const neck = this.neck = new THREE.Group(); neck.position.y = 0.38; chest.add(neck);
    mesh(cyl(0.065, 0.075, 0.08), M.suit, 0, 0.02, 0, neck);
    for (let i = 0; i < 2; i++) mesh(tor(0.068, 0.008), M.rubber, 0, 0.0 + i * 0.03, 0, neck).rotation.x = Math.PI / 2; // neck rings
    const head = this.head = new THREE.Group(); head.position.y = 0.13; neck.add(head);

    // ---------------- Arms (pauldrons fixed on chest, arms driven by IK)
    this.arms = [];
    for (const s of [1, -1]) {
      const pw = tank ? 0.22 : 0.16;
      const px = (0.29 + (tank ? 0.02 : 0)) * s;
      const pad = mesh(rbs(pw, 0.13, tank ? 0.24 : 0.19, 0.05), M.armor, px, 0.33, 0, chest);
      pad.rotation.z = -0.25 * s;
      const cap = mesh(rbs(pw * 0.8, 0.05, tank ? 0.22 : 0.17, 0.02), M.armorDark, px + 0.012 * s, 0.4 - 0.005, 0, chest); // upper layered plate
      cap.rotation.z = -0.25 * s;
      const rimG = glowBar(0.008, 0.012, tank ? 0.2 : 0.15, px + 0.07 * s * (pw / 0.16), 0.315, 0, chest);
      rimG.rotation.z = -0.25 * s;
      const shoulder = new THREE.Group(); shoulder.position.set(0.25 * s, 0.28, 0); chest.add(shoulder);
      mesh(sph(0.07, 12, 8), M.trim, 0, 0, 0, shoulder);
      mesh(caps(0.065, 0.16), M.suit, 0, -0.14, 0, shoulder);
      mesh(rbs(0.13, 0.12, 0.13, 0.04), M.armorDark, 0, -0.13, 0, shoulder);            // bicep guard
      mesh(rbs(0.06, 0.07, 0.02, 0.01), M.armor, 0, -0.13, 0.072, shoulder);
      const elbow = new THREE.Group(); elbow.position.y = -0.28; shoulder.add(elbow);
      mesh(sph(0.062), M.trim, 0, 0, 0, elbow);
      mesh(rbs(0.09, 0.07, 0.04, 0.02), M.armorDark, 0, 0.0, -0.06, elbow);            // elbow guard
      mesh(caps(0.058, 0.15), M.suit, 0, -0.12, 0, elbow);
      mesh(rbs(0.12, 0.16, 0.12, 0.035), M.armor, 0, -0.12, 0, elbow);                  // bracer
      glowBar(0.012, 0.1, 0.008, 0.0, -0.12, 0.062, elbow);
      for (let i = 0; i < 3; i++) mesh(rbs(0.09, 0.006, 0.01, 0.002), M.rubber, 0, -0.07 - i * 0.03, -0.062, elbow);
      mesh(rbs(0.095, 0.03, 0.095, 0.012), M.trim, 0, -0.215, 0, elbow);              // wrist cuff
      // Gloved hand: palm, four fingers, thumb, knuckle plate
      const palm = mesh(rbs(0.075, 0.05, 0.085, 0.015), M.rubber, 0, -0.275, 0.005, elbow);
      for (let i = 0; i < 4; i++) mesh(rbs(0.016, 0.055, 0.02, 0.008), M.rubber, (-0.027 + i * 0.018), -0.32, 0.02, elbow);
      mesh(rbs(0.02, 0.05, 0.022, 0.008), M.rubber, 0.045 * -s, -0.28, 0.02, elbow).rotation.z = 0.5 * s;   // thumb
      mesh(rbs(0.07, 0.014, 0.05, 0.006), M.trim, 0, -0.29, 0.05, elbow);              // knuckle plate
      void palm;
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

    this.orb = mesh(sph(0.07, 14, 10), this.mats.glow, 0, 0, 0, this.chest);
    this.orb.castShadow = false;
    this.orb.visible = false;
    this.baseScale = this.body.scale.clone();
    this.allMats = Object.values(this.mats);
    for (const mat of this.allMats) { mat.userData.baseEmissive = mat.emissiveIntensity ?? 0; if (mat.emissive) mat.userData.baseColor = mat.emissive.clone(); }
  }

  // Parts every agent's helmet shares: jaw guard, ear pods, top vents. Ghost wears a hood instead.
  _headBase(head) {
    const M = this.mats, id = this.char.id;
    if (id !== 'ghost') {
      mesh(rbs(0.19, 0.07, 0.15, 0.03), M.armorDark, 0, -0.1, 0.045, head);                 // jaw guard
      mesh(rbs(0.1, 0.05, 0.04, 0.02), M.trim, 0, -0.12, 0.125, head);                       // chin
      for (let i = 0; i < 3; i++) mesh(rbs(0.012, 0.03, 0.008, 0.003), M.rubber, -0.03 + i * 0.03, -0.1, 0.132, head); // mouth vents
      for (const s of [1, -1]) {
        mesh(cyl(0.05, 0.05, 0.05, 14), M.trim, 0.148 * s, -0.01, -0.005, head).rotation.z = Math.PI / 2;          // ear pods
        mesh(cyl(0.036, 0.036, 0.054, 14), M.armorDark, 0.15 * s, -0.01, -0.005, head).rotation.z = Math.PI / 2;
        mesh(rbs(0.012, 0.05, 0.05, 0.004), M.glow, 0.176 * s, -0.01, -0.005, head);
      }
    }
  }

  _buildHead(head, neck, chest, pack) {
    const M = this.mats, id = this.char.id;
    const glowBar = (w, h, d, x, y, z, parent) => mesh(rbs(w, h, d, Math.min(w, h, d) * 0.4), M.glow, x, y, z, parent);
    this._headBase(head);
    if (id === 'blaze') {
      mesh(sph(0.15), M.armor, 0, 0.02, 0, head).scale.set(1, 1.05, 1.12);
      mesh(rbs(0.24, 0.075, 0.1, 0.035), M.visor, 0, 0.01, 0.11, head);
      mesh(rbs(0.26, 0.012, 0.11, 0.005), M.armorDark, 0, 0.056, 0.115, head);              // visor brow
      mesh(rbs(0.012, 0.075, 0.09, 0.004), M.armorDark, 0.122, 0.01, 0.112, head);           // visor side frame
      mesh(rbs(0.012, 0.075, 0.09, 0.004), M.armorDark, -0.122, 0.01, 0.112, head);
      mesh(rbs(0.22, 0.012, 0.02, 0.005), M.glow, 0, 0.01, 0.16, head);
      const fin = mesh(rbs(0.03, 0.09, 0.26, 0.012), M.armorDark, 0, 0.15, -0.04, head);
      fin.rotation.x = -0.35;
      mesh(rbs(0.035, 0.02, 0.22, 0.008), M.glow, 0, 0.19, -0.06, head).rotation.x = -0.35;
      for (const s of [1, -1]) mesh(rbs(0.03, 0.08, 0.14, 0.012), M.trim, 0.15 * s, -0.01, -0.01, head);
      for (const s of [1, -1]) { const h2 = mesh(rbs(0.02, 0.05, 0.12, 0.006), M.armorDark, 0.05 * s, 0.155, -0.02, head); h2.rotation.set(-0.3, 0, 0.3 * s); } // secondary crest
      // Twin thrusters
      for (const s of [1, -1]) {
        const j = mesh(cyl(0.045, 0.06, 0.2), M.trim, 0.1 * s, -0.08, -0.08, pack);
        mesh(cyl(0.042, 0.042, 0.01), M.glow, 0.1 * s, -0.185, -0.08, pack);
        mesh(tor(0.052, 0.008), M.armor, 0.1 * s, -0.16, -0.08, pack).rotation.x = Math.PI / 2 + 0.15;
        mesh(cyl(0.05, 0.05, 0.03), M.armorDark, 0.1 * s, 0.03, -0.08, pack);
        j.rotation.x = 0.15;
      }
    } else if (id === 'tank') {
      mesh(rbs(0.3, 0.29, 0.31, 0.08), M.armor, 0, 0.02, 0.0, head);
      mesh(rbs(0.32, 0.12, 0.2, 0.04), M.armorDark, 0, -0.08, 0.04, head);
      mesh(rbs(0.24, 0.035, 0.03, 0.012), M.glow, 0, 0.04, 0.155, head);
      mesh(rbs(0.26, 0.07, 0.03, 0.012), M.armorDark, 0, 0.04, 0.16, head);                  // visor slit frame
      mesh(rbs(0.2, 0.05, 0.25, 0.02), M.trim, 0, 0.17, -0.02, head);
      for (let i = 0; i < 3; i++) mesh(rbs(0.03, 0.04, 0.02, 0.008), M.trim, -0.06 + i * 0.06, -0.09, 0.15, head);
      for (const s of [1, -1]) mesh(rbs(0.04, 0.16, 0.2, 0.012), M.armorDark, 0.16 * s, 0.02, 0.0, head);   // cheek plates
      mesh(rbs(0.05, 0.03, 0.25, 0.01), M.armorDark, 0, 0.2, -0.02, head);                   // crest
      // Generator on the back
      mesh(cyl(0.09, 0.09, 0.3), M.armorDark, 0, 0.05, -0.1, pack);
      mesh(tor(0.095, 0.014), M.glow, 0, 0.1, -0.1, pack).rotation.x = Math.PI / 2;
      mesh(tor(0.095, 0.014), M.glow, 0, 0.0, -0.1, pack).rotation.x = Math.PI / 2;
      for (const y of [0.2, -0.1]) mesh(cyl(0.1, 0.1, 0.03), M.trim, 0, y, -0.1, pack);          // generator caps
      for (const s of [1, -1]) mesh(cyl(0.012, 0.012, 0.2), M.rubber, 0.06 * s, 0.05, -0.19, pack); // coolant lines
    } else if (id === 'ghost') {
      mesh(sph(0.14), M.suit, 0, 0.0, 0, head);
      const hood = mesh(sph(0.18, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), M.armorDark, 0, 0.02, -0.02, head);
      hood.rotation.x = -0.35; hood.material = M.armorDark;
      mesh(rbs(0.2, 0.1, 0.06, 0.03), M.visor, 0, 0.0, 0.11, head);
      mesh(rbs(0.22, 0.014, 0.07, 0.006), M.armorDark, 0, 0.055, 0.112, head);              // mask brow
      mesh(rbs(0.13, 0.08, 0.05, 0.03), M.armorDark, 0, -0.08, 0.1, head);                  // face wrap
      for (let i = 0; i < 3; i++) mesh(rbs(0.012, 0.03, 0.008, 0.003), M.rubber, -0.03 + i * 0.03, -0.08, 0.13, head);
      for (const s of [1, -1]) mesh(sph(0.018, 10, 8), M.glow, 0.05 * s, 0.01, 0.145, head);
      mesh(rbs(0.14, 0.012, 0.01, 0.004), M.glow, 0, -0.05, 0.14, head);
      for (const s of [1, -1]) mesh(rbs(0.02, 0.09, 0.06, 0.008), M.trim, 0.14 * s, -0.02, 0.0, head).rotation.z = 0.15 * s; // hood clasps
      // Cape
      const capeGeo = new THREE.PlaneGeometry(0.5, 0.95, 4, 8);
      capeGeo.translate(0, -0.475, 0);
      this.cape = new THREE.Mesh(capeGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(this.char.color).multiplyScalar(0.3), roughness: 0.8, side: THREE.DoubleSide }));
      this.cape.castShadow = true;
      this.cape.position.set(0, 0.34, -0.27);
      chest.add(this.cape);
      this.mats.cape = this.cape.material;
      mesh(rbs(0.4, 0.03, 0.05, 0.012), M.trim, 0, 0.35, -0.24, chest);                       // cape collar clasp
    } else if (id === 'frost') {
      mesh(sph(0.15), M.armor, 0, 0.02, 0, head).scale.set(1, 1.08, 1.05);
      mesh(rbs(0.23, 0.07, 0.09, 0.03), M.visor, 0, 0.0, 0.115, head);
      mesh(rbs(0.25, 0.012, 0.1, 0.005), M.armorDark, 0, 0.05, 0.12, head);
      mesh(rbs(0.2, 0.014, 0.02, 0.006), M.glow, 0, 0.0, 0.16, head);
      const ice = new THREE.MeshStandardMaterial({ color: 0xbff0ff, emissive: 0x6fd3ff, emissiveIntensity: 0.6, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 });
      this.mats.ice = ice;
      const shard = (x, y, z, s2, rz, parent) => { const k = mesh(new THREE.OctahedronGeometry(s2, 0), ice, x, y, z, parent); k.scale.set(0.6, 1.6, 0.6); k.rotation.z = rz; return k; };
      shard(0, 0.19, -0.02, 0.06, 0, head);
      shard(0.08, 0.16, -0.02, 0.045, -0.5, head);
      shard(-0.08, 0.16, -0.02, 0.045, 0.5, head);
      shard(0.04, 0.17, -0.06, 0.035, -0.2, head);
      shard(-0.04, 0.17, -0.06, 0.035, 0.2, head);
      for (const s2 of [1, -1]) { shard(0.3 * s2, 0.45, -0.02, 0.06, -0.4 * s2, chest); shard(0.24 * s2, 0.48, -0.06, 0.045, -0.2 * s2, chest); shard(0.35 * s2, 0.42, 0.04, 0.035, -0.6 * s2, chest); }
      mesh(cyl(0.07, 0.07, 0.3, 8), ice, 0, 0.02, -0.1, pack);
      for (const y of [0.18, -0.14]) mesh(cyl(0.078, 0.078, 0.03, 8), M.trim, 0, y, -0.1, pack);  // tank clamps
      for (const s2 of [1, -1]) shard(0.06 * s2, 0.25, -0.1, 0.04, 0.3 * s2, pack);
    } else if (id === 'nova') {
      mesh(sph(0.145), M.armor, 0, 0.01, 0, head).scale.set(1, 1.02, 1.08);
      mesh(rbs(0.22, 0.08, 0.09, 0.035), M.visor, 0, 0.0, 0.105, head);
      mesh(rbs(0.24, 0.012, 0.1, 0.005), M.armorDark, 0, 0.052, 0.11, head);
      // Medical cross on forehead and pack
      mesh(rbs(0.07, 0.02, 0.01, 0.004), M.glow, 0, 0.1, 0.14, head);
      mesh(rbs(0.02, 0.07, 0.01, 0.004), M.glow, 0, 0.1, 0.14, head);
      const halo = mesh(tor(0.17, 0.01), M.glow, 0, 0.24, -0.02, head); halo.rotation.x = Math.PI / 2 - 0.25;
      for (const s of [1, -1]) mesh(rbs(0.012, 0.05, 0.012, 0.004), M.trim, 0.1 * s, 0.2, -0.02, head);   // halo struts
      mesh(rbs(0.14, 0.04, 0.02, 0.008), M.glow, 0, 0.02, -0.075, pack);
      mesh(rbs(0.04, 0.14, 0.02, 0.008), M.glow, 0, 0.02, -0.075, pack);
      for (const s2 of [1, -1]) {
        mesh(cyl(0.035, 0.035, 0.26, 10), M.armorDark, 0.13 * s2, 0.0, -0.02, pack);
        for (const y of [0.11, -0.11]) mesh(cyl(0.04, 0.04, 0.025, 10), M.trim, 0.13 * s2, y, -0.02, pack);  // canister caps
        mesh(rbs(0.012, 0.16, 0.012, 0.004), M.glow, 0.13 * s2, 0.0, 0.017, pack);
      }
    } else if (id === 'echo') {
      mesh(sph(0.148), M.armorDark, 0, 0.01, 0, head).scale.set(1, 1.05, 1.1);
      mesh(rbs(0.22, 0.1, 0.06, 0.04), M.armor, 0, 0.0, 0.1, head);
      mesh(sph(0.035, 14, 10), M.glow, 0, 0.0, 0.14, head);
      mesh(tor(0.05, 0.008), M.trim, 0, 0.0, 0.135, head);
      mesh(tor(0.065, 0.005), M.trim, 0, 0.0, 0.132, head);
      for (const s of [1, -1]) glowBar(0.05, 0.008, 0.008, 0.075 * s, 0.0, 0.132, head);           // sensor slits
      mesh(cyl(0.006, 0.006, 0.26), M.trim, -0.1, 0.2, -0.04, head).rotation.z = 0.3;
      mesh(sph(0.018, 10, 8), M.glow, -0.14, 0.33, -0.04, head);
      mesh(cyl(0.004, 0.004, 0.18), M.trim, 0.08, 0.17, -0.04, head).rotation.z = -0.25;             // second antenna
      // Radar dish on the back
      const dish = mesh(sph(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.35), M.trim, 0, 0.18, -0.1, pack);
      dish.rotation.x = -Math.PI / 2 - 0.4; dish.material = M.trim;
      mesh(sph(0.02, 10, 8), M.glow, 0, 0.2, -0.16, pack);
      mesh(cyl(0.012, 0.012, 0.12), M.trim, 0, 0.12, -0.09, pack);                                  // dish mast
      mesh(rbs(0.05, 0.05, 0.05, 0.01), M.armorDark, 0, 0.06, -0.09, pack);
    } else { // volt
      mesh(sph(0.145), M.armor, 0, 0.01, 0, head).scale.set(1, 1, 1.08);
      mesh(rbs(0.22, 0.09, 0.1, 0.04), M.visor, 0, 0.0, 0.1, head);
      mesh(rbs(0.24, 0.012, 0.11, 0.005), M.armorDark, 0, 0.054, 0.105, head);
      mesh(rbs(0.035, 0.035, 0.01, 0.008), M.glow, 0.06, 0.0, 0.152, head);
      mesh(rbs(0.035, 0.035, 0.01, 0.008), M.glow, -0.06, 0.0, 0.152, head);
      for (const s of [1, -1]) {
        mesh(cyl(0.06, 0.06, 0.05), M.trim, 0.15 * s, 0.0, 0, head).rotation.z = Math.PI / 2;
        mesh(cyl(0.045, 0.045, 0.052), M.glow, 0.155 * s, 0.0, 0, head).rotation.z = Math.PI / 2;
      }
      mesh(tor(0.16, 0.012, Math.PI), M.trim, 0, 0.0, 0, head);
      mesh(cyl(0.006, 0.006, 0.22), M.trim, 0.14, 0.18, -0.02, head);
      mesh(sph(0.022, 10, 8), M.glow, 0.14, 0.3, -0.02, head);
      for (const s of [1, -1]) glowBar(0.01, 0.01, 0.16, 0.05 * s, 0.155, 0.0, head);              // head-top light strips
      // Tesla coils on the back
      for (const s of [1, -1]) {
        mesh(cyl(0.03, 0.03, 0.34), M.trim, 0.1 * s, 0.1, -0.08, pack);
        for (let i = 0; i < 3; i++) mesh(tor(0.045, 0.01), M.glow, 0.1 * s, 0.0 + i * 0.09, -0.08, pack).rotation.x = Math.PI / 2;
        mesh(sph(0.032, 10, 8), M.armorDark, 0.1 * s, 0.28, -0.08, pack);                          // coil tips
        mesh(cyl(0.04, 0.04, 0.03), M.armorDark, 0.1 * s, -0.06, -0.08, pack);
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

  /**
   * s: { vx, vz, yaw, pitch, grounded, dead, reload (0..1 or -1), shield, ghostAlpha }
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
    const target = s.grounded ? Math.min(1, speed / 5) : 0;
    this.moveAmt += (target - this.moveAmt) * Math.min(1, dt * 10);
    this.airAmt += ((s.grounded ? 0 : 1) - this.airAmt) * Math.min(1, dt * 8);
    this.phase += speed * dt * 1.9;

    const ph = this.phase, amt = this.moveAmt;
    const fdir = speed > 0.1 ? fwd / speed : 1, sdir = speed > 0.1 ? side / speed : 0;
    const swing = Math.sin(ph) * 0.7 * amt;
    for (const L of this.legs) {
      const sgn = L.side === 1 ? 1 : -1;
      const sw = swing * sgn;
      L.leg.rotation.x = -sw * fdir - this.airAmt * (L.side === 1 ? 0.7 : 0.25);
      L.leg.rotation.z = sw * sdir * 0.45 * -1 + 0.04 * L.side;
      const kb = Math.max(0, Math.sin(ph * 1 + (L.side === 1 ? Math.PI / 2 : -Math.PI / 2))) * 1.1 * amt;
      L.knee.rotation.x = kb + 0.08 + this.airAmt * (L.side === 1 ? 1.1 : 0.5);
    }
    const bob = Math.abs(Math.cos(ph)) * 0.05 * amt;
    const breathe = Math.sin(this.time * 2.2) * 0.008;
    this.hips.position.y = 0.98 - bob + breathe - amt * 0.03;
    this.hips.rotation.y = Math.sin(ph) * 0.12 * amt * fdir;
    this.hips.rotation.x = amt * 0.12 * fdir;
    this.spine.rotation.y = -this.hips.rotation.y;

    // Aim pitch spread across spine/chest; head keeps a little
    const p = THREE.MathUtils.clamp(s.pitch, -1.3, 1.3);
    this.spine.rotation.x = -p * 0.35 - this.hips.rotation.x;
    this.chest.rotation.x = -p * 0.5;
    this.neck.rotation.x = -p * 0.15;
    // One-shot animations add to these below, so start from neutral every frame
    this.neck.rotation.y = 0; this.neck.rotation.z = 0;
    this.chest.rotation.y = 0;
    this.chest.rotation.z = Math.sin(ph) * 0.04 * amt;

    // ---- One-shot actions (abilities / gestures)
    let act = null, k = 0, env = 0;
    if (this.act) {
      this.act.t += dt;
      k = Math.min(1, this.act.t / this.act.dur);
      env = Math.sin(k * Math.PI);
      act = this.act.kind;
      if (this.act.t >= this.act.dur) this.act = null;
    }
    // Kneel while planting / defusing
    this.kneelAmt = (this.kneelAmt || 0) + ((s.kneel ? 1 : 0) - (this.kneelAmt || 0)) * Math.min(1, dt * 8);
    const kn = this.kneelAmt;
    if (kn > 0.01) {
      this.hips.position.y -= 0.4 * kn;
      const [L0, L1] = this.legs;
      L0.leg.rotation.x += (-1.25 - L0.leg.rotation.x) * kn; L0.knee.rotation.x += (1.5 - L0.knee.rotation.x) * kn;
      L1.leg.rotation.x += (0.15 - L1.leg.rotation.x) * kn; L1.knee.rotation.x += (2.1 - L1.knee.rotation.x) * kn;
      this.spine.rotation.x += 0.35 * kn;
    }
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
    let rl = 0;
    if (s.reload >= 0) {
      rl = Math.sin(Math.min(1, s.reload) * Math.PI);
      g.rotation.z = rl * 0.7;
      g.rotation.x += rl * 0.5;
      g.position.y -= rl * 0.06;
    }
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
    _p.copy(ud.fore).applyMatrix4(g.matrix);
    if (rl > 0) _p.lerp(new THREE.Vector3(-0.05, 0.02, 0.22), rl);
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
