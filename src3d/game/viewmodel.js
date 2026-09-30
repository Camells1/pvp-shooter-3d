// First-person viewmodel: hands + gun rendered in their own pass so they never clip into walls.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { disposeMerged, buildGun, SIDEARMS, getArmorDetail, loft, pod, band, grow, keyed, INSPECT_GUN, INSPECT_KNIFE, SLASH, STAB, animateDragon } from './models.js';
import { weaponById } from './data.js';
import { reloadAnim, makePropMesh } from './reload.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
const WRIST = 0.07;
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q2 = new THREE.Quaternion(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
// Knife grip, in hand space: the handle runs across the curled fingers (hand X), the blade leaves the thumb side,
// the spine faces the palm. HANDLE is the point on the handle axis the fingers close round (hand space).
const HANDLE = new THREE.Vector3(0.0, -0.032, -0.04), KNIFE_HANDLE = new THREE.Vector3(0, -0.072, 0.022);

// Hip positions in camera space (x right, y up, -z forward). ADS is computed per gun from its sight.
const HIP = { primary: [0.23, -0.24, -0.66], sidearm: [0.2, -0.2, -0.52], knife: [0.19, -0.115, -0.42] };
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
    const detail = getArmorDetail();
    const sleeve = new THREE.MeshPhysicalMaterial({ color: char.color, metalness: 0.35, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25, bumpMap: detail, bumpScale: 1.4, roughnessMap: detail });
    const sleeveDark = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(char.color).multiplyScalar(0.45), metalness: 0.4, roughness: 0.45, clearcoat: 0.3, bumpMap: detail, bumpScale: 1.4, roughnessMap: detail });
    const suit = new THREE.MeshStandardMaterial({ color: 0x3b414c, metalness: 0.15, roughness: 0.62 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.85, roughness: 0.32, bumpMap: detail, bumpScale: 0.8 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x1b1e23, metalness: 0.25, roughness: 0.7 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: char.accent, emissiveIntensity: 1.6 });
    const box = (w, h, d, r, mat, x, y, z, parent) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005, d / 2 - 0.0005)), mat); m.position.set(x, y, z); parent.add(m); return m; };
    this.arms = new THREE.Group();
    this.rig.add(this.arms);
    this.limbs = [];
    for (let i = 0; i < 2; i++) {
      // Local +Z points back toward the elbow; the hand sits at the origin, fingers reach toward -Z
      const fore = new THREE.Group();
      const th = i === 0 ? -1 : 1; // thumb side (toward the middle of the gun)
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.3, 4, 12), suit);
      arm.rotation.x = Math.PI / 2; arm.position.z = 0.17; fore.add(arm);
      // Bracer: a tapered shell (same build as the third-person agents), top plate, glow strip, vents.
      // Lofts run along their local Y, so each is turned to lie along the forearm (+Z); their local -Z ends up on top.
      const L = (rings, mat, o) => { const m = new THREE.Mesh(loft(rings, o), mat); m.rotation.x = Math.PI / 2; fore.add(m); return m; };
      const brc = [[0.118, 0.036, 0.035], [0.15, 0.042, 0.041], [0.24, 0.047, 0.046], [0.3, 0.046, 0.045], [0.318, 0.043, 0.042]];
      L(brc, sleeve, { n: 2.5, seg: 22 });
      L(grow(band(brc, 0.16, 0.29), 0.004, 0.006, -0.002), sleeveDark, { n: 2.5, seg: 16, arc: [0.64, 0.86], t: 0.008 });
      box(0.009, 0.009, 0.11, 0.0045, glow, 0, 0.056, 0.225, fore);
      for (let k = 0; k < 3; k++) box(0.05, 0.005, 0.008, 0.0025, glove, 0, -0.047, 0.19 + k * 0.03, fore);
      L([[0.098, 0.04, 0.04], [0.122, 0.038, 0.038]], trim, { n: 2.4, seg: 20, b: 0.004 });                       // wrist cuff
      L([[0.312, 0.049, 0.048], [0.33, 0.047, 0.046]], sleeveDark, { n: 2.5, seg: 20, b: 0.004 });               // elbow-side cuff
      // Gloved hand on its own wrist joint (so it can turn to hold a knife while the forearm points at the elbow).
      // The hand group sits at the wrist; its contents are shifted so the palm centre stays at the forearm origin.
      const wrist = new THREE.Group(); wrist.position.z = WRIST; fore.add(wrist);
      const hand = new THREE.Group(); hand.position.z = -WRIST; wrist.add(hand);
      const palm = new THREE.Mesh(pod(0.036, 0.026, 0.04, { n: 3, nv: 3, seg: 20 }), glove); hand.add(palm);
      box(0.06, 0.012, 0.05, 0.005, trim, 0, 0.03, 0.006, hand);               // knuckle plate
      // Fingers: knuckle and middle joints so they can curl round a handle and open while a knife spins
      const fingers = [];
      for (let f = 0; f < 4; f++) {
        const x = -0.027 + f * 0.018, len = f === 0 || f === 3 ? 0.03 : 0.036;
        const kn = new THREE.Group(); kn.position.set(x, 0, -0.036); hand.add(kn);
        box(0.016, 0.018, len, 0.006, glove, 0, 0, -len / 2, kn);
        const mid = new THREE.Group(); mid.position.z = -len; kn.add(mid);
        box(0.015, 0.016, 0.028, 0.006, glove, 0, -0.002, -0.012, mid);
        fingers.push({ kn, mid });
      }
      const thumbJ = new THREE.Group(); thumbJ.position.set(0.03 * th, 0.004, -0.012); hand.add(thumbJ);
      box(0.02, 0.02, 0.05, 0.007, glove, 0.01 * th, 0.002, -0.018, thumbJ);
      fore.userData = { wrist, fingers, thumbJ, th };
      this._curl(fore, 0);
      this.arms.add(fore);
      this.limbs.push(fore);
    }
    // Glowing orb held in the off hand while casting
    if (this.orb) this.rig.remove(this.orb);
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: char.accent, toneMapped: false }));
    this.orb.visible = false;
    this.rig.add(this.orb);
    // Magazine / shell shown in the off hand while reloading
    if (this.prop) this.rig.remove(this.prop);
    this.prop = makePropMesh(glove, glow);
    this.rig.add(this.prop);
  }

  // One-shot first-person animations: 'throw' | 'cast' | 'slam' | 'dash' | 'blink' | 'brace' | 'rocket' | 'inspect'
  play(kind) {
    const DUR = { throw: 0.55, cast: 0.7, slam: 0.8, dash: 0.3, blink: 0.35, brace: 0.6, rocket: 0.6, inspect: 2.4, slash: 0.42, stab: 0.75 };
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

    const knife = this.weaponId === 'knife';
    const hip = HIP[knife ? 'knife' : SIDEARMS.has(this.weaponId) ? 'sidearm' : 'primary'];
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

    // Reload pose comes from reload.js (gun tilt + where the off hand is); null when not reloading
    const R = s.reload >= 0 && this.gun ? reloadAnim(this.weaponId, s.reload, this.gun.userData.fore) : null;
    const lift = R ? R.pose.lift : 0;
    animateDragon(this.gun, dt, act === 'inspect' ? k : -1, s.reload >= 0 ? s.reload : -1);
    const hx = hip[0] + (ads[0] - hip[0]) * a - lift * 0.07;
    const hy = hip[1] + (ads[1] - hip[1]) * a + lift * 0.17;
    const hz = hip[2] + (ads[2] - hip[2]) * a;
    const breathe = Math.sin(this.t * 1.6) * 0.003 * (1 - a);
    // Keyframed inspect (per weapon kind) and knife attacks
    const K = act === 'inspect' ? keyed(knife ? INSPECT_KNIFE : INSPECT_GUN, k) : act === 'slash' ? keyed(SLASH, k) : act === 'stab' ? keyed(STAB, k) : null;
    this.gunHolder.position.set(
      hx + Math.sin(this.t * bobF) * 0.012 * bob - this.sway.x + (K ? K[0] : 0) + (act === 'dash' ? 0.03 * env : 0),
      hy + Math.abs(Math.cos(this.t * bobF)) * 0.012 * bob + this.sway.y + (R ? R.pose.dy * 1.6 : 0) - this.switchT * 0.25 - this.landT * 0.03 + breathe - lower * 0.22 + (K ? K[1] : 0) - this.hitT * 0.02,
      hz + this.recoil * 0.05 + (K ? K[2] : 0) + this.hitT * 0.03
    );
    // Angle the muzzle toward the crosshair at the hip so you see the side of the gun
    this.gunHolder.rotation.set(
      this.recoil * 0.12 + (R ? R.pose.up * 1.2 : 0) - this.switchT * 0.6 - lower * 0.5 + this.hitT * 0.08 + (K ? K[3] : 0) + (knife ? 0.12 : 0),
      this.sway.x * 2 + 0.07 * (1 - a) + (K ? K[4] : 0) + (knife ? 0.25 : 0),
      (R ? R.pose.roll : 0) - 0.04 * (1 - a) + Math.sin(this.t * bobF * 0.5) * 0.01 * bob + (K ? K[5] : 0) + (act === 'dash' || act === 'blink' ? 0.35 * env : 0));
    this.gunHolder.updateMatrix();

    // Scoped sniper: hide the viewmodel while looking through the scope
    const w = weaponById(this.weaponId);
    this.rig.visible = this.visible && !(w.scope && a > 0.7);

    // Hands on the grip and foregrip, forearms trailing back to the bottom corners of the screen
    if (this.gun && this.limbs) {
      this.gun.updateMatrix();
      const ud = this.gun.userData;
      const grip = _a.copy(ud.grip).applyMatrix4(this.gun.matrix).applyMatrix4(this.gunHolder.matrix);
      const fore = _b.copy(R ? R.hand : ud.fore).applyMatrix4(this.gun.matrix).applyMatrix4(this.gunHolder.matrix);
      // Off hand leaves the gun for abilities / planting
      let off = null, w = 0;
      if (act === 'cast') { off = new THREE.Vector3(-0.14, -0.1 + Math.sin(this.t * 9) * 0.01, -0.42); w = Math.min(1, env * 1.8); }
      if (act === 'throw') { off = k < 0.4 ? new THREE.Vector3(-0.28, 0.02, -0.12) : new THREE.Vector3(-0.04, 0.05, -0.75); w = Math.min(1, env * 1.8); }
      if (act === 'slam') { off = new THREE.Vector3(-0.12, -0.38, -0.5); w = Math.min(1, env * 1.8); }
      if (this.kneel > 0.05 && !off) { off = new THREE.Vector3(-0.08, -0.34, -0.48); w = this.kneel; }
      if (knife && !off) { off = new THREE.Vector3(-0.2, -0.24 + Math.sin(this.t * 1.6) * 0.004, -0.46); w = 1; }   // off hand up in a guard
      if (off) fore.lerp(off, w);
      if (knife) {
        // K[6] is the twirl angle; the fingers open while the knife is turning
        const spin = K && K.length > 6 ? K[6] : 0, open = Math.abs(Math.sin(spin / 2)) ** 0.6;
        this._knifeHand(this.limbs[0], _a.set(0.4, -0.62, 0.14), spin, open);
      } else this._place(this.limbs[0], grip, new THREE.Vector3(0.5, -0.6, 0.1));
      this._place(this.limbs[1], fore, new THREE.Vector3(-0.25, -0.65, 0.0));
      const pr = this.prop;
      pr.visible = !!(R && R.prop);
      if (pr.visible) {
        pr.position.copy(R.propPos).applyMatrix4(this.gun.matrix).applyMatrix4(this.gunHolder.matrix);
        pr.quaternion.copy(this.gunHolder.quaternion).multiply(this.gun.quaternion);
        pr.scale.set(R.propSize[0], R.propSize[1], R.propSize[2]);
      }
      this.orb.visible = (act === 'cast' && env > 0.15) || this.kneel > 0.3;
      if (this.orb.visible) { this.orb.position.copy(fore).add(new THREE.Vector3(0, 0.04, -0.04)); this.orb.scale.setScalar(0.7 + Math.sin(this.t * 18) * 0.15 + env * 0.5); }
    }
  }

  // Finger pose: 0 = relaxed gun grip, 1 = fist closed round a knife handle; open (0..1) loosens it mid-twirl
  _curl(limb, grip, open = 0) {
    const u = limb.userData;
    u.fingers.forEach(({ kn, mid }, i) => {
      const g = grip * (1 - open * (0.75 + i * 0.05));
      kn.rotation.x = -(0.1 + 1.05 * g);
      mid.rotation.x = -(0.85 + 0.55 * g);
    });
    const tg = grip * (1 - open * 0.6);
    u.thumbJ.rotation.set(-0.15 - 0.55 * tg, (-0.45 + 0.1 * tg) * u.th, 0.5 * tg * u.th);
  }

  // Knife hand: the holder pose says where the knife is and where the blade points. The fist closes round the
  // handle (handle across the fingers, blade out of the thumb side), the hand turns at the wrist toward the forearm,
  // and the forearm aims at the elbow. 'spin' twirls the knife in the fingers about its side axis; 'open' loosens them.
  _knifeHand(limb, elbowOff, spin, open) {
    const gun = this.gun;
    gun.position.set(0, 0, 0); gun.quaternion.setFromAxisAngle(_up, Math.PI); gun.updateMatrix();
    _m1.multiplyMatrices(this.gunHolder.matrix, gun.matrix);                     // the knife, rig space
    const hc = _c.copy(KNIFE_HANDLE).applyMatrix4(_m1);                          // where the fist closes on the handle
    _X.set(0, 0, -1).transformDirection(_m1);                                     // hand X runs back along the handle (blade leaves the thumb side)
    _Z.copy(elbowOff).normalize(); _Z.addScaledVector(_X, -_Z.dot(_X)).normalize(); // hand Z (toward the wrist) as close to the forearm as the grip allows
    _Y.crossVectors(_Z, _X);
    _m2.makeBasis(_X, _Y, _Z);
    _q.setFromRotationMatrix(_m2);
    const palm = hc.sub(_d.copy(HANDLE).applyQuaternion(_q));
    const wristPt = _e.set(0, 0, WRIST).applyQuaternion(_q).add(palm);
    const fdir = _d.copy(palm).add(elbowOff).sub(wristPt).normalize();
    _q2.setFromUnitVectors(_Z.set(0, 0, 1), fdir);
    limb.quaternion.copy(_q2);
    limb.position.copy(wristPt).sub(_Z.set(0, 0, WRIST).applyQuaternion(_q2));
    limb.userData.wrist.quaternion.copy(_q2).invert().multiply(_q);
    this._curl(limb, 1, open);
    // Twirl: spin the knife about its side axis through the handle point in the fist
    if (spin) {
      const p = KNIFE_HANDLE;
      _m2.makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationX(spin)).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
      _m2.premultiply(gun.matrix);
      _m2.decompose(gun.position, gun.quaternion, gun.scale);
    }
  }

  _place(limb, hand, elbow) {
    if (limb.userData.wrist) { limb.userData.wrist.quaternion.identity(); this._curl(limb, 0); }
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
