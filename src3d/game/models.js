// Procedural character + weapon models with IK arms and procedural animation.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const geoCache = new Map();
function rb(w, h, d, r = 0.02) {
  const k = `rb${w},${h},${d},${r}`;
  if (!geoCache.has(k)) geoCache.set(k, new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
  return geoCache.get(k);
}
function caps(r, len) {
  const k = `c${r},${len}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CapsuleGeometry(r, len, 6, 12));
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

function makeMaterials(char) {
  const armor = new THREE.MeshPhysicalMaterial({ color: char.color, metalness: 0.35, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const armorDark = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(char.color).multiplyScalar(0.45), metalness: 0.4, roughness: 0.45, clearcoat: 0.3 });
  const suit = new THREE.MeshStandardMaterial({ color: 0x3b414c, metalness: 0.15, roughness: 0.62 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.85, roughness: 0.32 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: char.accent, emissiveIntensity: 1.6, roughness: 0.3 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x06080c, metalness: 0.9, roughness: 0.08, clearcoat: 1, emissive: char.accent, emissiveIntensity: 0.18 });
  return { armor, armorDark, suit, trim, glow, visor };
}

// ---------------------------------------------------------------- Guns
const gunMatCache = {};
function gunMats(accent) {
  if (!gunMatCache[accent]) {
    gunMatCache[accent] = {
      body: new THREE.MeshStandardMaterial({ color: 0x1d2025, metalness: 0.75, roughness: 0.35 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x5c636c, metalness: 0.95, roughness: 0.22 }),
      polymer: new THREE.MeshStandardMaterial({ color: 0x2e3238, metalness: 0.1, roughness: 0.7 }),
      accent: new THREE.MeshStandardMaterial({ color: accent, metalness: 0.4, roughness: 0.35 }),
      glow: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: accent, emissiveIntensity: 1.8 })
    };
  }
  return gunMatCache[accent];
}

// Returns group (+Z forward), with userData.muzzle, grip, fore (Vector3 local points).
export function buildGun(index, accent = 0xff8800) {
  const m = gunMats(accent);
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0) => { const k = mesh(geo, mat, x, y, z, g); k.rotation.x = rx; return k; };
  let muzzle, grip = new THREE.Vector3(0, -0.07, 0), fore;
  if (index === 0) { // Pistol
    add(rb(0.05, 0.055, 0.22, 0.012), m.body, 0, 0.035, 0.07);
    add(rb(0.052, 0.012, 0.16, 0.004), m.accent, 0, 0.066, 0.06);
    add(rb(0.044, 0.04, 0.17, 0.01), m.polymer, 0, -0.005, 0.06);
    add(rb(0.042, 0.11, 0.055, 0.012), m.polymer, 0, -0.055, -0.005, 0.25);
    add(cyl(0.012, 0.012, 0.04), m.metal, 0, 0.035, 0.19, Math.PI / 2);
    add(rb(0.01, 0.012, 0.01, 0.003), m.glow, 0, 0.075, 0.15);
    add(rb(0.02, 0.02, 0.02, 0.004), m.glow, 0, 0.075, -0.02);
    muzzle = new THREE.Vector3(0, 0.035, 0.22);
    fore = new THREE.Vector3(0.02, -0.075, 0.02);
  } else if (index === 1) { // SMG
    add(rb(0.065, 0.09, 0.34, 0.015), m.body, 0, 0.02, 0.1);
    add(rb(0.067, 0.02, 0.2, 0.006), m.accent, 0, 0.07, 0.08);
    add(cyl(0.017, 0.017, 0.12), m.metal, 0, 0.03, 0.32, Math.PI / 2);
    add(cyl(0.024, 0.024, 0.05), m.body, 0, 0.03, 0.37, Math.PI / 2);
    add(rb(0.04, 0.16, 0.05, 0.01), m.polymer, 0, -0.1, 0.12, 0.12);
    add(rb(0.042, 0.1, 0.05, 0.012), m.polymer, 0, -0.07, -0.01, 0.3);
    add(rb(0.04, 0.05, 0.18, 0.01), m.polymer, 0, 0.0, -0.12);
    add(rb(0.05, 0.045, 0.06, 0.01), m.body, 0, 0.1, 0.05);
    add(rb(0.035, 0.028, 0.004, 0.002), m.glow, 0, 0.105, 0.08);
    muzzle = new THREE.Vector3(0, 0.03, 0.4);
    fore = new THREE.Vector3(0, -0.04, 0.22);
  } else if (index === 2) { // Shotgun
    add(rb(0.07, 0.09, 0.26, 0.015), m.body, 0, 0.02, 0.05);
    add(cyl(0.022, 0.022, 0.5), m.metal, 0, 0.045, 0.42, Math.PI / 2);
    add(cyl(0.018, 0.018, 0.42), m.body, 0, 0.005, 0.38, Math.PI / 2);
    add(rb(0.068, 0.06, 0.16, 0.02), m.accent, 0, 0.012, 0.36);
    add(rb(0.045, 0.11, 0.055, 0.012), m.polymer, 0, -0.06, -0.03, 0.3);
    add(rb(0.05, 0.08, 0.26, 0.02), m.polymer, 0, -0.03, -0.2, -0.12);
    add(rb(0.012, 0.018, 0.012, 0.003), m.glow, 0, 0.075, 0.64);
    for (let i = 0; i < 4; i++) add(rb(0.074, 0.012, 0.012, 0.003), m.glow, 0, 0.0, -0.02 + i * 0.03);
    muzzle = new THREE.Vector3(0, 0.045, 0.68);
    fore = new THREE.Vector3(0, -0.02, 0.36);
  } else { // Marksman rifle
    add(rb(0.065, 0.095, 0.4, 0.015), m.body, 0, 0.02, 0.1);
    add(rb(0.067, 0.025, 0.28, 0.008), m.accent, 0, -0.02, 0.18);
    add(cyl(0.016, 0.016, 0.46), m.metal, 0, 0.035, 0.52, Math.PI / 2);
    add(rb(0.05, 0.05, 0.08, 0.01), m.body, 0, 0.035, 0.76);
    add(cyl(0.032, 0.032, 0.28), m.body, 0, 0.12, 0.1, Math.PI / 2);
    add(cyl(0.038, 0.032, 0.05), m.body, 0, 0.12, 0.25, Math.PI / 2);
    add(cyl(0.031, 0.031, 0.005), m.glow, 0, 0.12, 0.276, Math.PI / 2);
    add(rb(0.02, 0.04, 0.03, 0.005), m.metal, 0, 0.08, 0.05);
    add(rb(0.04, 0.12, 0.06, 0.012), m.polymer, 0, -0.07, 0.02, 0.28);
    add(rb(0.045, 0.1, 0.06, 0.01), m.polymer, 0, -0.07, 0.12);
    add(rb(0.055, 0.1, 0.28, 0.025), m.polymer, 0, -0.01, -0.22, -0.08);
    muzzle = new THREE.Vector3(0, 0.035, 0.8);
    fore = new THREE.Vector3(0, -0.04, 0.34);
  }
  g.userData = { muzzle, grip, fore };
  return g;
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
    this.weaponIndex = -1;
    this._build();
    this.setWeapon(0);
  }

  _build() {
    const M = this.mats, c = this.char, B = this.body;
    const tank = c.id === 'tank', ghost = c.id === 'ghost';
    if (tank) B.scale.set(1.16, 1.07, 1.12);
    if (ghost) B.scale.set(0.95, 1.0, 0.95);

    const hips = this.hips = new THREE.Group(); hips.position.y = 0.98; B.add(hips);
    mesh(rb(0.34, 0.18, 0.22, 0.05), M.suit, 0, 0, 0, hips);
    mesh(rb(0.37, 0.065, 0.25, 0.02), M.trim, 0, 0.055, 0, hips);
    mesh(rb(0.07, 0.045, 0.02, 0.01), M.glow, 0, 0.055, 0.128, hips);
    mesh(rb(0.09, 0.11, 0.06, 0.015), M.armorDark, 0.2, -0.02, 0.02, hips);   // side pouches
    mesh(rb(0.09, 0.11, 0.06, 0.015), M.armorDark, -0.2, -0.02, 0.02, hips);
    mesh(rb(0.16, 0.12, 0.05, 0.02), M.armor, 0, -0.04, 0.11, hips);           // codpiece plate

    this.legs = [];
    for (const s of [1, -1]) {
      const leg = new THREE.Group(); leg.position.set(0.11 * s, -0.03, 0); hips.add(leg);
      mesh(caps(0.085, 0.26), M.suit, 0, -0.21, 0, leg);
      mesh(rb(0.17, 0.22, 0.12, 0.04), M.armor, 0.01 * s, -0.2, 0.045, leg);
      mesh(rb(0.05, 0.14, 0.03, 0.01), M.trim, 0.09 * s, -0.2, 0.0, leg);
      const knee = new THREE.Group(); knee.position.y = -0.44; leg.add(knee);
      mesh(rb(0.13, 0.12, 0.09, 0.035), M.armorDark, 0, 0, 0.07, knee);
      mesh(caps(0.075, 0.26), M.suit, 0, -0.2, 0, knee);
      mesh(rb(0.14, 0.26, 0.1, 0.035), M.armor, 0, -0.2, 0.045, knee);
      const foot = mesh(rb(0.15, 0.1, 0.29, 0.035), M.trim, 0, -0.475, 0.05, knee);
      mesh(rb(0.155, 0.035, 0.3, 0.012), M.suit, 0, -0.51, 0.05, knee);
      this.legs.push({ leg, knee, foot, side: s });
    }

    const spine = this.spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine);
    mesh(rb(0.3, 0.2, 0.2, 0.06), M.suit, 0, 0.1, 0, spine);
    for (let i = 0; i < 3; i++) mesh(rb(0.26, 0.045, 0.05, 0.015), M.armorDark, 0, 0.04 + i * 0.055, 0.1, spine);

    const chest = this.chest = new THREE.Group(); chest.position.y = 0.2; spine.add(chest);
    mesh(rb(0.42, 0.34, 0.26, 0.08), M.suit, 0, 0.17, 0, chest);
    mesh(rb(0.44, 0.27, 0.13, 0.05), M.armor, 0, 0.2, 0.09, chest);
    mesh(rb(0.36, 0.1, 0.03, 0.015), M.armorDark, 0, 0.1, 0.155, chest);
    mesh(rb(0.18, 0.022, 0.012, 0.005), M.glow, 0, 0.26, 0.16, chest);
    mesh(rb(0.25, 0.07, 0.21, 0.03), M.trim, 0, 0.36, -0.01, chest);
    // Back pack
    const pack = new THREE.Group(); pack.position.set(0, 0.17, -0.19); chest.add(pack);
    mesh(rb(0.32, 0.34, 0.13, 0.04), M.trim, 0, 0, 0, pack);
    mesh(rb(0.26, 0.2, 0.04, 0.02), M.armorDark, 0, 0.02, -0.07, pack);
    mesh(rb(0.2, 0.02, 0.01, 0.005), M.glow, 0, -0.1, -0.09, pack);

    // Head
    const neck = this.neck = new THREE.Group(); neck.position.y = 0.38; chest.add(neck);
    mesh(cyl(0.065, 0.075, 0.08), M.suit, 0, 0.02, 0, neck);
    const head = this.head = new THREE.Group(); head.position.y = 0.13; neck.add(head);

    // Shoulders (pauldrons fixed on chest), arms driven by IK.
    this.arms = [];
    for (const s of [1, -1]) {
      const pw = tank ? 0.22 : 0.16;
      const pad = mesh(rb(pw, 0.13, tank ? 0.24 : 0.19, 0.05), M.armor, (0.29 + (tank ? 0.02 : 0)) * s, 0.33, 0, chest);
      pad.rotation.z = -0.25 * s;
      const shoulder = new THREE.Group(); shoulder.position.set(0.25 * s, 0.28, 0); chest.add(shoulder);
      mesh(caps(0.065, 0.16), M.suit, 0, -0.14, 0, shoulder);
      mesh(rb(0.13, 0.12, 0.13, 0.04), M.armorDark, 0, -0.13, 0, shoulder);
      const elbow = new THREE.Group(); elbow.position.y = -0.28; shoulder.add(elbow);
      mesh(sph(0.062), M.trim, 0, 0, 0, elbow);
      mesh(caps(0.058, 0.15), M.suit, 0, -0.12, 0, elbow);
      mesh(rb(0.12, 0.16, 0.12, 0.035), M.armor, 0, -0.12, 0, elbow);
      mesh(rb(0.08, 0.09, 0.09, 0.025), M.trim, 0, -0.26, 0.0, elbow);
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

    this.allMats = Object.values(this.mats);
    for (const mat of this.allMats) mat.userData.baseEmissive = mat.emissiveIntensity ?? 0;
  }

  _buildHead(head, neck, chest, pack) {
    const M = this.mats, id = this.char.id;
    if (id === 'blaze') {
      mesh(sph(0.15), M.armor, 0, 0.02, 0, head).scale.set(1, 1.05, 1.12);
      mesh(rb(0.24, 0.075, 0.1, 0.035), M.visor, 0, 0.01, 0.11, head);
      mesh(rb(0.22, 0.012, 0.02, 0.005), M.glow, 0, 0.01, 0.16, head);
      const fin = mesh(rb(0.03, 0.09, 0.26, 0.012), M.armorDark, 0, 0.15, -0.04, head);
      fin.rotation.x = -0.35;
      mesh(rb(0.035, 0.02, 0.22, 0.008), M.glow, 0, 0.19, -0.06, head).rotation.x = -0.35;
      for (const s of [1, -1]) mesh(rb(0.03, 0.08, 0.14, 0.012), M.trim, 0.15 * s, -0.01, -0.01, head);
      // Twin thrusters
      for (const s of [1, -1]) {
        const j = mesh(cyl(0.045, 0.06, 0.2), M.trim, 0.1 * s, -0.08, -0.08, pack);
        mesh(cyl(0.042, 0.042, 0.01), M.glow, 0.1 * s, -0.185, -0.08, pack);
        j.rotation.x = 0.15;
      }
    } else if (id === 'tank') {
      mesh(rb(0.3, 0.29, 0.31, 0.08), M.armor, 0, 0.02, 0.0, head);
      mesh(rb(0.32, 0.12, 0.2, 0.04), M.armorDark, 0, -0.08, 0.04, head);
      mesh(rb(0.24, 0.035, 0.03, 0.012), M.glow, 0, 0.04, 0.155, head);
      mesh(rb(0.2, 0.05, 0.25, 0.02), M.trim, 0, 0.17, -0.02, head);
      for (let i = 0; i < 3; i++) mesh(rb(0.03, 0.04, 0.02, 0.008), M.trim, -0.06 + i * 0.06, -0.09, 0.15, head);
      // Generator on the back
      mesh(cyl(0.09, 0.09, 0.3), M.armorDark, 0, 0.05, -0.1, pack);
      mesh(tor(0.095, 0.014), M.glow, 0, 0.1, -0.1, pack).rotation.x = Math.PI / 2;
      mesh(tor(0.095, 0.014), M.glow, 0, 0.0, -0.1, pack).rotation.x = Math.PI / 2;
    } else if (id === 'ghost') {
      mesh(sph(0.14), M.suit, 0, 0.0, 0, head);
      const hood = mesh(sph(0.18, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), M.armorDark, 0, 0.02, -0.02, head);
      hood.rotation.x = -0.35; hood.material = M.armorDark;
      mesh(rb(0.2, 0.1, 0.06, 0.03), M.visor, 0, 0.0, 0.11, head);
      for (const s of [1, -1]) mesh(sph(0.018, 10, 8), M.glow, 0.05 * s, 0.01, 0.145, head);
      mesh(rb(0.14, 0.012, 0.01, 0.004), M.glow, 0, -0.05, 0.14, head);
      // Cape
      const capeGeo = new THREE.PlaneGeometry(0.5, 0.95, 4, 8);
      capeGeo.translate(0, -0.475, 0);
      this.cape = new THREE.Mesh(capeGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(this.char.color).multiplyScalar(0.3), roughness: 0.8, side: THREE.DoubleSide }));
      this.cape.castShadow = true;
      this.cape.position.set(0, 0.34, -0.27);
      chest.add(this.cape);
      this.mats.cape = this.cape.material;
    } else { // volt
      mesh(sph(0.145), M.armor, 0, 0.01, 0, head).scale.set(1, 1, 1.08);
      mesh(rb(0.22, 0.09, 0.1, 0.04), M.visor, 0, 0.0, 0.1, head);
      mesh(rb(0.035, 0.035, 0.01, 0.008), M.glow, 0.06, 0.0, 0.152, head);
      mesh(rb(0.035, 0.035, 0.01, 0.008), M.glow, -0.06, 0.0, 0.152, head);
      for (const s of [1, -1]) {
        mesh(cyl(0.06, 0.06, 0.05), M.trim, 0.15 * s, 0.0, 0, head).rotation.z = Math.PI / 2;
        mesh(cyl(0.045, 0.045, 0.052), M.glow, 0.155 * s, 0.0, 0, head).rotation.z = Math.PI / 2;
      }
      mesh(tor(0.16, 0.012, Math.PI), M.trim, 0, 0.0, 0, head);
      mesh(cyl(0.006, 0.006, 0.22), M.trim, 0.14, 0.18, -0.02, head);
      mesh(sph(0.022, 10, 8), M.glow, 0.14, 0.3, -0.02, head);
      // Tesla coils on the back
      for (const s of [1, -1]) {
        mesh(cyl(0.03, 0.03, 0.34), M.trim, 0.1 * s, 0.1, -0.08, pack);
        for (let i = 0; i < 3; i++) mesh(tor(0.045, 0.01), M.glow, 0.1 * s, 0.0 + i * 0.09, -0.08, pack).rotation.x = Math.PI / 2;
      }
    }
  }

  setWeapon(i) {
    if (i === this.weaponIndex) return;
    this.weaponIndex = i;
    if (this.gun) this.gunMount.remove(this.gun);
    this.gun = buildGun(i, this.char.accent);
    this.gunMount.add(this.gun);
    // Pistol held closer to center
    this.gunBase.set(i === 0 ? -0.07 : -0.13, i === 0 ? 0.16 : 0.13, i === 0 ? 0.36 : 0.28);
  }

  // Muzzle world position (after updateMatrixWorld)
  getMuzzle(out) {
    return out.copy(this.gun.userData.muzzle).applyMatrix4(this.gun.matrixWorld);
  }

  kick(amount) { this.recoil = Math.min(1, this.recoil + amount); }
  hit() { this.flash = 1; }

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
    this.chest.rotation.z = Math.sin(ph) * 0.04 * amt;

    // Gun: recoil + reload motion
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
    g.updateMatrix();

    // Hands to the gun
    const ud = this.gun.userData;
    const right = this.arms.find(a => a.side === -1), left = this.arms.find(a => a.side === 1);
    _p.copy(ud.grip).applyMatrix4(g.matrix);
    this._solveArm(right, _p.clone(), new THREE.Vector3(-0.8, -0.6, -0.4).normalize());
    _p.copy(ud.fore).applyMatrix4(g.matrix);
    if (rl > 0) _p.lerp(new THREE.Vector3(-0.05, 0.02, 0.22), rl);
    this._solveArm(left, _p.clone(), new THREE.Vector3(0.8, -0.7, -0.2).normalize());

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
      else if (mat.userData.flashing) { mat.userData.flashing = false; mat.emissiveIntensity = mat.userData.baseEmissive; if (mat !== this.mats.glow) mat.emissive.set(mat === this.mats.visor ? this.char.accent : 0x000000); }
    }

    // Death: topple backwards and sink
    if (s.dead) {
      this.deathT = Math.min(1.6, this.deathT + dt);
      const k = Math.min(1, this.deathT / 0.45);
      const e = k * k * (3 - 2 * k);
      this.body.rotation.x = -e * Math.PI / 2;
      this.body.position.y = e * 0.15 - Math.max(0, this.deathT - 1.0) * 0.8;
      this.body.position.z = -e * 0.2;
    } else if (this.deathT) {
      this.deathT = 0;
      this.body.rotation.x = 0;
      this.body.position.set(0, 0, 0);
    }

    // Blink / spawn flicker
    const vis = s.ghostAlpha === undefined ? true : s.ghostAlpha > 0.5 || Math.sin(this.time * 40) > 0;
    this.body.visible = vis;
  }

  dispose() {
    this.root.traverse(o => { if (o.material && !Object.values(gunMatCache).some(m => Object.values(m).includes(o.material))) o.material.dispose?.(); });
  }
}
