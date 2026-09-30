// Reload animations. Both the first-person view and the 3D characters ask reloadAnim(weaponId, p, fore)
// (p = reload progress 0..1) and get back:
//   pose  how far to tilt / roll / lower the gun ({ up: nose up, roll, dy, lift: 0..1 raise-into-view for first person })
//   hand  where the off hand is, in gun space (+Z forward, +Y up)
//   prop  a magazine, shell or cartridge to show in that hand or falling away ({ pos, size, fall }) or null
// Each weapon type is a list of keyframes: [time, handPoint, pose, prop]. Hand points are named spots on the gun.
import * as THREE from 'three';

// Named spots per gun, in gun space: mag = where the magazine slides in, rack = charging handle / slide,
// bolt / pump / port / cyl = the other things a hand touches.
const PTS = {
  classic: { mag: [0, -0.11, -0.02], rack: [0, 0.066, -0.04] },
  mpistol: { mag: [0, -0.2, -0.02], rack: [0, 0.078, -0.03] },
  cannon: { cyl: [0.03, 0.025, 0.08], cylOpen: [0.075, 0.0, 0.08], below: [0.09, -0.24, 0.05] },
  shorty: { breech: [0, 0.03, 0.06], below: [0.08, -0.22, 0.05] },
  stinger: { mag: [0, -0.21, 0.12], rack: [0, 0.07, -0.02] },
  smg: { mag: [0, -0.18, 0.12], rack: [0, 0.056, 0.2] },
  carbine: { mag: [0, -0.12, -0.1], rack: [0, 0.078, -0.12] },
  marksman: { mag: [0, -0.15, 0.135], rack: [0, 0.07, -0.08] },
  ar: { mag: [0, -0.2, 0.15], rack: [0, 0.068, -0.08] },
  lmg: { mag: [0.02, -0.14, 0.1], rack: [0, 0.1, -0.05] },
  shotgun: { port: [0, -0.03, 0.12], pump: [0, 0.005, 0.38], below: [0.08, -0.24, 0.1] },
  scout: { bolt: [-0.075, 0.045, 0.08], port: [0, 0.03, 0.1], below: [0.08, -0.24, 0.1] },
  sniper: { bolt: [0.09, 0.015, 0.02], port: [0, 0.03, 0.12], below: [0.08, -0.24, 0.1] }
};
const KIND = { classic: 'mag', mpistol: 'mag', cannon: 'revolver', shorty: 'break', stinger: 'mag', smg: 'mag', carbine: 'mag', marksman: 'mag', ar: 'mag', lmg: 'lmg', shotgun: 'pump', scout: 'bolt', sniper: 'bolt' };
// Prop sizes (w, h, d): a pistol mag, a rifle mag, an LMG ammo box, a shell, a rifle round
const SIZE = { pistol: [0.03, 0.07, 0.04], mag: [0.034, 0.11, 0.055], box: [0.1, 0.1, 0.1], shell: [0.018, 0.05, 0.018], round: [0.012, 0.06, 0.012] };

// Keyframe helpers. pose: [noseUp, roll, dy]. prop: null | 'held' | 'fall' (applies from this key to the next)
const K = (t, hand, pose = [0, 0, 0], prop = null) => ({ t, hand, pose, prop });

const TIMELINES = {
  // Pull the old mag, fetch a new one from the belt, seat it, rack the slide
  mag: [
    K(0.0, 'fore'),
    K(0.11, 'mag', [0.12, 0.4, -0.02]),
    K(0.15, 'mag', [0.12, 0.4, -0.02], 'held'),
    K(0.26, 'magOut', [0.12, 0.4, -0.02], 'held'),
    K(0.3, 'magOut', [0.12, 0.42, -0.02], 'fall'),
    K(0.42, 'below', [0.1, 0.35, -0.03]),
    K(0.5, 'below', [0.1, 0.35, -0.03], 'held'),
    K(0.64, 'mag', [0.12, 0.4, -0.02], 'held'),
    K(0.69, 'mag', [0.06, 0.4, -0.05]),
    K(0.75, 'rack', [0.06, 0.2, -0.03]),
    K(0.82, 'rackBack', [0.08, 0.2, -0.03]),
    K(0.88, 'rack', [0.04, 0.12, -0.02]),
    K(1.0, 'fore')
  ],
  // Heavy box magazine: big motions, slam it home, haul back the cover
  lmg: [
    K(0.0, 'fore'),
    K(0.1, 'mag', [0.2, 0.55, -0.04]),
    K(0.16, 'mag', [0.2, 0.55, -0.04], 'held'),
    K(0.3, 'magOut', [0.2, 0.55, -0.05], 'held'),
    K(0.35, 'magOut', [0.2, 0.55, -0.05], 'fall'),
    K(0.5, 'below', [0.16, 0.45, -0.06]),
    K(0.58, 'below', [0.16, 0.45, -0.06], 'held'),
    K(0.7, 'mag', [0.2, 0.55, -0.04], 'held'),
    K(0.75, 'mag', [0.1, 0.5, -0.1]),
    K(0.8, 'rack', [0.1, 0.3, -0.05]),
    K(0.88, 'rackBack', [0.12, 0.3, -0.05]),
    K(0.94, 'rack', [0.05, 0.15, -0.03]),
    K(1.0, 'fore')
  ],
  // Shotgun: roll the gun, thumb three shells into the port, then pump it
  pump: [
    K(0.0, 'fore'),
    K(0.08, 'port', [0.1, 0.5, -0.03]),
    K(0.14, 'below', [0.1, 0.5, -0.03]),
    K(0.18, 'below', [0.1, 0.5, -0.03], 'held'),
    K(0.26, 'port', [0.1, 0.5, -0.03], 'held'),
    K(0.32, 'below', [0.1, 0.5, -0.03]),
    K(0.36, 'below', [0.1, 0.5, -0.03], 'held'),
    K(0.44, 'port', [0.1, 0.5, -0.03], 'held'),
    K(0.5, 'below', [0.1, 0.5, -0.03]),
    K(0.54, 'below', [0.1, 0.5, -0.03], 'held'),
    K(0.62, 'port', [0.1, 0.5, -0.03], 'held'),
    K(0.7, 'pump', [0.08, 0.15, -0.02]),
    K(0.8, 'pumpBack', [0.12, 0.1, -0.02]),
    K(0.9, 'pump', [0.05, 0.05, -0.01]),
    K(1.0, 'fore')
  ],
  // Bolt action: lift the bolt, pull it back, feed a round, push it home
  bolt: [
    K(0.0, 'fore'),
    K(0.1, 'bolt', [0.05, 0.3, -0.02]),
    K(0.2, 'boltUp', [0.05, 0.3, -0.02]),
    K(0.32, 'boltBack', [0.08, 0.3, -0.02]),
    K(0.42, 'below', [0.08, 0.35, -0.03]),
    K(0.5, 'below', [0.08, 0.35, -0.03], 'held'),
    K(0.62, 'port', [0.08, 0.35, -0.03], 'held'),
    K(0.66, 'port', [0.08, 0.35, -0.03]),
    K(0.72, 'boltBack', [0.08, 0.3, -0.02]),
    K(0.82, 'boltFwd', [0.04, 0.25, -0.03]),
    K(0.88, 'bolt', [0.03, 0.15, -0.01]),
    K(1.0, 'fore')
  ],
  // Revolver: swing the cylinder out, feed a speed loader, flick it shut
  revolver: [
    K(0.0, 'fore'),
    K(0.12, 'cyl', [0.05, 0.6, -0.02]),
    K(0.22, 'cylOpen', [0.05, 0.7, -0.02]),
    K(0.34, 'below', [0.05, 0.7, -0.03]),
    K(0.42, 'below', [0.05, 0.7, -0.03], 'held'),
    K(0.58, 'cylOpen', [0.05, 0.7, -0.02], 'held'),
    K(0.64, 'cylOpen', [0.05, 0.7, -0.02]),
    K(0.74, 'cyl', [0.12, 0.4, -0.04]),
    K(0.8, 'cyl', [0.0, 0.2, -0.01]),
    K(1.0, 'fore')
  ],
  // Double barrel: break it open, drop two shells in, snap it shut
  break: [
    K(0.0, 'fore'),
    K(0.14, 'breech', [-0.35, 0.3, -0.02]),
    K(0.26, 'below', [-0.4, 0.3, -0.03]),
    K(0.34, 'below', [-0.4, 0.3, -0.03], 'held'),
    K(0.5, 'breech', [-0.4, 0.3, -0.03], 'held'),
    K(0.56, 'breech', [-0.4, 0.3, -0.03]),
    K(0.7, 'breech', [0.05, 0.1, -0.03]),
    K(0.82, 'fore', [0.0, 0.0, 0.0]),
    K(1.0, 'fore')
  ]
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const out = { pose: { up: 0, roll: 0, dy: 0, lift: 0 }, hand: new THREE.Vector3(), prop: null, propPos: new THREE.Vector3(), propSize: SIZE.mag };
const s = x => x * x * (3 - 2 * x);

// Resolve a named hand spot to a point in gun space
function spot(name, pts, fore, o) {
  switch (name) {
    case 'fore': return o.copy(fore);
    case 'magOut': return o.fromArray(pts.mag).add(_a.set(0, -0.13, 0));
    case 'below': return pts.below ? o.fromArray(pts.below) : o.fromArray(pts.mag).add(_a.set(0.1, -0.28, 0.05));
    case 'rackBack': return o.fromArray(pts.rack).add(_a.set(0, 0.008, -0.07));
    case 'boltUp': return o.fromArray(pts.bolt).add(_a.set(0, 0.04, 0));
    case 'boltBack': return o.fromArray(pts.bolt).add(_a.set(0, 0.03, -0.09));
    case 'boltFwd': return o.fromArray(pts.bolt).add(_a.set(0, 0.02, 0.01));
    case 'pumpBack': return o.fromArray(pts.pump).add(_a.set(0, 0, -0.12));
    default: return o.fromArray(pts[name]);
  }
}

// Returns a shared result object (valid until the next call). p in 0..1.
export function reloadAnim(weaponId, p, fore) {
  const pts = PTS[weaponId] || PTS.classic;
  const kind = KIND[weaponId] || 'mag';
  const tl = TIMELINES[kind];
  p = Math.min(1, Math.max(0, p));
  let i = 0;
  while (i < tl.length - 2 && p > tl[i + 1].t) i++;
  const k0 = tl[i], k1 = tl[i + 1];
  const u = s(Math.min(1, Math.max(0, (p - k0.t) / (k1.t - k0.t))));
  out.pose.up = k0.pose[0] + (k1.pose[0] - k0.pose[0]) * u;
  out.pose.roll = k0.pose[1] + (k1.pose[1] - k0.pose[1]) * u;
  out.pose.dy = k0.pose[2] + (k1.pose[2] - k0.pose[2]) * u;
  // First person raises the gun toward the middle of the screen so the magazine well is in view
  out.pose.lift = s(Math.min(1, p / 0.1)) * s(Math.min(1, (1 - p) / 0.12));
  spot(k0.hand, pts, fore, _b);
  spot(k1.hand, pts, fore, out.hand);
  out.hand.lerp(_b, 1 - u);
  out.prop = k0.prop;
  if (k0.prop) {
    out.propSize = kind === 'lmg' ? SIZE.box
      : kind === 'pump' || kind === 'break' ? SIZE.shell
      : kind === 'bolt' ? SIZE.round
      : kind === 'revolver' ? SIZE.round
      : weaponId === 'classic' || weaponId === 'mpistol' ? SIZE.pistol : SIZE.mag;
    if (k0.prop === 'fall') {
      // Dropped mag: starts at the release point and falls away
      const t = (p - k0.t);
      spot(k0.hand, pts, fore, out.propPos);
      out.propPos.y -= 22 * t * t;
      out.propPos.x += 0.4 * t;
      if (t > 0.1) out.prop = null;
    } else {
      out.propPos.copy(out.hand);
      // Held prop rides in the palm, and drops in from below when seating a mag
      out.propPos.y += out.propSize[1] * 0.1;
    }
  }
  return out;
}

// One small prop mesh (mag / shell / round) shared by both users; sized per call
export function makePropMesh(material, stripMaterial) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.12, 0.6), stripMaterial);
  strip.position.set(0, -0.38, 0.22);
  m.add(strip);
  m.visible = false;
  m.castShadow = false;
  return m;
}
