// First-person viewmodel: hands + gun rendered in their own pass so they never clip into walls.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildGun, SIDEARMS } from './models.js';
import { weaponById } from './data.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();

// Hip and aim-down-sights positions in camera space (x right, y up, -z forward)
const POSE = {
  primary: { hip: [0.23, -0.24, -0.66], ads: [0, -0.128, -0.5] },
  sidearm: { hip: [0.2, -0.2, -0.52], ads: [0, -0.115, -0.46] }
};

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
  }

  setWeapon(id, skin = 'default') {
    if (id === this.weaponId && skin === this.skin) return;
    if (this.weaponId && id !== this.weaponId) this.switchT = 1;
    this.weaponId = id; this.skin = skin;
    if (this.gun) this.gunHolder.remove(this.gun);
    this.gun = buildGun(id, this.char?.accent ?? 0xff8800, skin);
    this.gun.rotation.y = Math.PI; // gun is modelled facing +Z; the camera looks down -Z
    this.gun.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    this.gunHolder.add(this.gun);
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

    const side = SIDEARMS.has(this.weaponId) ? 'sidearm' : 'primary';
    const P = POSE[side];
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

    const rl = s.reload >= 0 ? Math.sin(Math.min(1, s.reload) * Math.PI) : 0;
    const hx = P.hip[0] + (P.ads[0] - P.hip[0]) * a;
    const hy = P.hip[1] + (P.ads[1] - P.hip[1]) * a;
    const hz = P.hip[2] + (P.ads[2] - P.hip[2]) * a;
    this.gunHolder.position.set(
      hx + Math.sin(this.t * bobF) * 0.012 * bob - this.sway.x,
      hy + Math.abs(Math.cos(this.t * bobF)) * 0.012 * bob + this.sway.y - rl * 0.08 - this.switchT * 0.25 - this.landT * 0.03,
      hz + this.recoil * 0.05
    );
    // Angle the muzzle toward the crosshair at the hip so you see the side of the gun
    this.gunHolder.rotation.set(this.recoil * 0.12 + rl * 0.35 - this.switchT * 0.6, this.sway.x * 2 + 0.07 * (1 - a), rl * 0.6 - 0.04 * (1 - a) + Math.sin(this.t * bobF * 0.5) * 0.01 * bob);
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
      this._place(this.limbs[0], grip, new THREE.Vector3(0.5, -0.6, 0.1));
      this._place(this.limbs[1], fore, new THREE.Vector3(-0.25, -0.65, 0.0));
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
