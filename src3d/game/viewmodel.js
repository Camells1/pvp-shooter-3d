// First-person viewmodel: hands + gun rendered in their own pass so they never clip into walls.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { disposeMerged, buildGun, SIDEARMS } from './models.js';
import { weaponById } from './data.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();

// Hip positions in camera space (x right, y up, -z forward). ADS is computed per gun from its sight.
const HIP = { primary: [0.23, -0.24, -0.66], sidearm: [0.2, -0.2, -0.52] };
// Farther from the eye = the sight takes up less of the screen
const EYE_RELIEF = { holo: 0.5, iron: 0.46, scope: 0.4 };

export class ViewModel {
  constructor(envMap) {
    this.scene = new THREE.Scene();
    this.scene.environment = envMap;
    this.scene.environmentIntensity = 0.5;
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 20);
    this.scene.add(this.camera);
    // Bright, readable lighting so skins show off in first person
    this.camera.add(new THREE.HemisphereLight(0xe8eeff, 0x4a4238, 1.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(1.5, 2, 1.2); this.camera.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 1.1); fill.position.set(-2, 0.5, 0.5); this.camera.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.4); rim.position.set(0.5, 1, -2); this.camera.add(rim);
    this.rig = new THREE.Group();
    this.camera.add(this.rig);
    this.gunHolder = new THREE.Group();
    this.rig.add(this.gunHolder);
    this.t = 0; this.bobAmt = 0; this.recoil = 0; this.switchT = 0; this.landT = 0;
    this.sway = new THREE.Vector2(); this.adsT = 0;
    this.gun = null; this.weaponId = null; this.skin = null;
    this.visible = true;
  }

  setChar(char) {
    if (this.arms) this.rig.remove(this.arms);
    this.char = char;
    const sleeve = new THREE.MeshStandardMaterial({ color: char.color, metalness: 0.35, roughness: 0.4 });
    const suit = new THREE.MeshStandardMaterial({ color: 0x3b414c, metalness: 0.15, roughness: 0.62 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.5, roughness: 0.45 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: char.accent, emissiveIntensity: 1.6 });
    this.arms = new THREE.Group();
    this.rig.add(this.arms);
    this.limbs = [];
    for (let i = 0; i < 2; i++) {
      const fore = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.3, 4, 10), suit);
      arm.rotation.x = Math.PI / 2; arm.position.z = 0.17; fore.add(arm);
      const brace = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.075, 0.16, 2, 0.025), sleeve);
      brace.position.z = 0.22; fore.add(brace);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.16), glow);
      strip.position.set(0, 0.04, 0.22); fore.add(strip);
      const hand = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.085, 0.1, 2, 0.025), glove);
      fore.add(hand);
      this.arms.add(fore);
      this.limbs.push(fore);
    }
    // Glowing orb held in the off hand while casting
    if (this.orb) this.rig.remove(this.orb);
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: char.accent, toneMapped: false }));
    this.orb.visible = false;
    this.rig.add(this.orb);
  }

  // One-shot first-person animations: 'throw' | 'cast' | 'slam' | 'dash' | 'blink' | 'brace' | 'rocket' | 'inspect'
  play(kind) {
    const DUR = { throw: 0.55, cast: 0.7, slam: 0.8, dash: 0.3, blink: 0.35, brace: 0.6, rocket: 0.6, inspect: 2.4 };
    if (DUR[kind]) this.act = { kind, t: 0, dur: DUR[kind] };
  }
  cancelInspect() { if (this.act?.kind === 'inspect') this.act = null; }
  flinch() { this.hitT = 1; }

  setWeapon(id, skin = 'default') {
    if (id === this.weaponId && skin === this.skin) return;
    if (this.weaponId && id !== this.weaponId) this.switchT = 1;
    this.weaponId = id; this.skin = skin;
    if (this.gun) { this.gunHolder.remove(this.gun); disposeMerged(this.gun); }
    this.gun = buildGun(id, this.char?.accent ?? 0xff8800, skin);
    this.gun.rotation.y = Math.PI; // gun is modelled facing +Z; the camera looks down -Z
    this.gun.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    this.gunHolder.add(this.gun);
    // Aim-down-sights: put the sight exactly on the screen centre (where hitscan shots go).
    // The gun is turned 180 degrees, so a local point (x, y, z) sits at (-x, y, -z) in the holder.
    const sg = this.gun.userData.sight, D = EYE_RELIEF[this.gun.userData.sightType] ?? 0.4;
    this.adsPos = [sg.x, -sg.y, -D + sg.z];
  }

  kick(a) { this.recoil = Math.min(1, this.recoil + a); }
  land() { this.landT = 1; }
  look(dx, dy) { this.sway.x += dx * 0.00012; this.sway.y += dy * 0.00012; }

  // s: { speed, grounded, ads (0..1), reload (-1 or 0..1), walk }
  update(dt, s, mainCamera) {
    this.t += dt;
    this.camera.position.copy(mainCamera.position);
    this.camera.quaternion.copy(mainCamera.quaternion);
    this.camera.aspect = mainCamera.aspect;
    this.camera.updateProjectionMatrix();
    this.adsT += ((s.ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 14);

    const hip = HIP[SIDEARMS.has(this.weaponId) ? 'sidearm' : 'primary'];
    const ads = this.adsPos || hip;
    const a = this.adsT;
    const target = this.bobAmt;
    const moving = s.grounded ? Math.min(1, s.speed / 6) : 0;
    this.bobAmt += (moving - target) * Math.min(1, dt * 8);
    const bobF = s.walk ? 6 : 9;
    const bob = this.bobAmt * (1 - a * 0.85);
    this.sway.multiplyScalar(Math.max(0, 1 - dt * 10));
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.switchT = Math.max(0, this.switchT - dt * 3.5);
    this.landT = Math.max(0, this.landT - dt * 5);
    this.hitT = Math.max(0, (this.hitT || 0) - dt * 7);
    let act = null, k = 0, env = 0;
    if (this.act) {
      this.act.t += dt; k = Math.min(1, this.act.t / this.act.dur); env = Math.sin(k * Math.PI); act = this.act.kind;
      if (this.act.t >= this.act.dur) this.act = null;
    }
    this.kneel = (this.kneel || 0) + ((s.channel ? 1 : 0) - (this.kneel || 0)) * Math.min(1, dt * 8);
    const lower = Math.max(act === 'throw' || act === 'cast' || act === 'slam' ? env : 0, this.kneel);

    const rl = s.reload >= 0 ? Math.sin(Math.min(1, s.reload) * Math.PI) : 0;
    const hx = hip[0] + (ads[0] - hip[0]) * a;
    const hy = hip[1] + (ads[1] - hip[1]) * a;
    const hz = hip[2] + (ads[2] - hip[2]) * a;
    const breathe = Math.sin(this.t * 1.6) * 0.003 * (1 - a);
    const insp = act === 'inspect' ? env : 0;
    this.gunHolder.position.set(
      hx + Math.sin(this.t * bobF) * 0.012 * bob - this.sway.x - insp * 0.16 + (act === 'dash' ? 0.03 * env : 0),
      hy + Math.abs(Math.cos(this.t * bobF)) * 0.012 * bob + this.sway.y - rl * 0.08 - this.switchT * 0.25 - this.landT * 0.03 + breathe - lower * 0.22 + insp * 0.06 - this.hitT * 0.02,
      hz + this.recoil * 0.05 + insp * 0.12 + this.hitT * 0.03
    );
    // Angle the muzzle toward the crosshair at the hip so you see the side of the gun
    this.gunHolder.rotation.set(
      this.recoil * 0.12 + rl * 0.35 - this.switchT * 0.6 - lower * 0.5 + this.hitT * 0.08,
      this.sway.x * 2 + 0.07 * (1 - a) + insp * 1.3,
      rl * 0.6 - 0.04 * (1 - a) + Math.sin(this.t * bobF * 0.5) * 0.01 * bob - insp * 0.55 + (act === 'dash' || act === 'blink' ? 0.35 * env : 0));
    this.gunHolder.updateMatrix();

    // Scoped sniper: hide the viewmodel while looking through the scope
    const w = weaponById(this.weaponId);
    this.rig.visible = this.visible && !(w.scope && a > 0.7);

    // Hands on the grip and foregrip, forearms trailing back to the bottom corners of the screen
    if (this.gun && this.limbs) {
      this.gun.updateMatrix();
      const ud = this.gun.userData;
      const grip = _a.copy(ud.grip).applyMatrix4(this.gun.matrix).applyMatrix4(this.gunHolder.matrix);
      const fore = _b.copy(ud.fore).applyMatrix4(this.gun.matrix).applyMatrix4(this.gunHolder.matrix);
      if (rl > 0) fore.lerp(new THREE.Vector3(hx - 0.05, hy - 0.12, hz + 0.05), rl);
      // Off hand leaves the gun for abilities / planting
      let off = null, w = 0;
      if (act === 'cast') { off = new THREE.Vector3(-0.14, -0.1 + Math.sin(this.t * 9) * 0.01, -0.42); w = Math.min(1, env * 1.8); }
      if (act === 'throw') { off = k < 0.4 ? new THREE.Vector3(-0.28, 0.02, -0.12) : new THREE.Vector3(-0.04, 0.05, -0.75); w = Math.min(1, env * 1.8); }
      if (act === 'slam') { off = new THREE.Vector3(-0.12, -0.38, -0.5); w = Math.min(1, env * 1.8); }
      if (this.kneel > 0.05 && !off) { off = new THREE.Vector3(-0.08, -0.34, -0.48); w = this.kneel; }
      if (off) fore.lerp(off, w);
      this._place(this.limbs[0], grip, new THREE.Vector3(0.5, -0.6, 0.1));
      this._place(this.limbs[1], fore, new THREE.Vector3(-0.25, -0.65, 0.0));
      this.orb.visible = (act === 'cast' && env > 0.15) || this.kneel > 0.3;
      if (this.orb.visible) { this.orb.position.copy(fore).add(new THREE.Vector3(0, 0.04, -0.04)); this.orb.scale.setScalar(0.7 + Math.sin(this.t * 18) * 0.15 + env * 0.5); }
    }
  }

  _place(limb, hand, elbow) {
    limb.position.copy(hand);
    const dir = elbow.clone().sub(hand).normalize();
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    limb.quaternion.copy(_q);
  }

  // World-space muzzle (for tracers and flashes)
  muzzleWorld(out) {
    if (!this.gun) return out.copy(this.camera.position);
    this.camera.updateMatrixWorld(true);
    return out.copy(this.gun.userData.muzzle).applyMatrix4(this.gun.matrixWorld);
  }
}
void _up;
