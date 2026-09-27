// 3D backdrop for menus: character lineup and character-select turntable.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CHARACTERS, charById } from './data.js';
import { CharacterModel } from './models.js';
import { getEnvMap } from './envmap.js';

function gridTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#07090d'; x.fillRect(0, 0, 512, 512);
  x.strokeStyle = 'rgba(80,170,255,0.25)'; x.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(512, i); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(16, 16); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MenuStage {
  constructor(renderer, quality) {
    this.renderer = renderer;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x05070b);
    s.fog = new THREE.Fog(0x05070b, 12, 40);
    s.environment = getEnvMap(renderer);
    s.environmentIntensity = 0.35;
    this.camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.55, metalness: 0.35, emissive: 0x1a3a66, emissiveMap: gridTexture(), emissiveIntensity: 0.5 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);

    s.add(new THREE.HemisphereLight(0x8aa4d6, 0x1a1a22, 1.1));
    const key = new THREE.DirectionalLight(0xfff2e0, 3.2);
    key.position.set(4, 7, 8); key.castShadow = quality !== 'low';
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
    key.shadow.bias = -0.0004;
    s.add(key);
    const fill = new THREE.DirectionalLight(0x9ec4ff, 1.1);
    fill.position.set(-6, 3, 5); s.add(fill);
    // Rim lights behind and above the fighters (colored edge highlights)
    this.rimA = new THREE.SpotLight(0x3fa0ff, 120, 25, 0.6, 0.6, 1.2); this.rimA.position.set(-4, 6, -5); this.rimA.target.position.set(0, 1, 1); s.add(this.rimA, this.rimA.target);
    this.rimB = new THREE.SpotLight(0xff4fa0, 120, 25, 0.6, 0.6, 1.2); this.rimB.position.set(5, 6, -5); this.rimB.target.position.set(1, 1, 1); s.add(this.rimB, this.rimB.target);

    // Pedestals
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x1a1e25, metalness: 0.8, roughness: 0.25 });
    this.models = {};
    this.pedestals = {};
    CHARACTERS.forEach(c => {
      const g = new THREE.Group();
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.25, 48), pedMat);
      ped.position.y = 0.125; ped.receiveShadow = ped.castShadow = true; g.add(ped);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.02, 8, 64), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c.color, emissiveIntensity: 1.8 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.25; g.add(ring);
      const m = new CharacterModel(c);
      m.setWeapon({ blaze: 1, tank: 2, ghost: 3, volt: 1 }[c.id]);
      m.root.position.y = 0.25;
      m.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.add(m.root);
      s.add(g);
      this.models[c.id] = m;
      this.pedestals[c.id] = g;
    });

    // Floating dust
    const n = 300, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { p[i * 3] = (Math.random() - 0.5) * 20; p[i * 3 + 1] = Math.random() * 6; p[i * 3 + 2] = (Math.random() - 0.5) * 14 - 2; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x88bbff, size: 0.035, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.add(this.dust);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(s, this.camera));
    if (quality !== 'low') this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.4, 0.9));
    this.composer.addPass(new OutputPass());

    this.t = 0;
    this.mode = 'lineup';
    this.sel = { me: 'blaze', enemy: null };
    this.spin = 0;
    this.camPos = new THREE.Vector3(0.6, 1.8, 8.4);
    this.camLook = new THREE.Vector3(0.8, 1.15, 0);
    this.camera.position.copy(this.camPos);
  }

  setMode(mode, me, enemy) {
    this.mode = mode;
    if (me) this.sel.me = me;
    this.sel.enemy = enemy ?? null;
  }

  update(dt) {
    this.t += dt;
    const ids = CHARACTERS.map(c => c.id);
    const targets = {};
    if (this.mode === 'lineup') {
      ids.forEach((id, i) => {
        const a = (i - 1.5) * 0.3;
        targets[id] = { x: Math.sin(a) * 6 + 2.9, z: -Math.cos(a) * 6 + 5.5, rot: -a * 0.9 + Math.sin(this.t * 0.4 + i) * 0.15, show: true };
      });
      this.camPos.set(0.6 + Math.sin(this.t * 0.12) * 0.6, 1.8, 8.4);
      this.camLook.set(0.8, 1.15, 0);
    } else {
      this.spin += dt * 0.5;
      ids.forEach(id => {
        if (id === this.sel.me) targets[id] = { x: this.sel.enemy ? -1.2 : 1.4, z: 1.5, rot: Math.sin(this.spin) * 0.6 + 0.3, show: true };
        else if (id === this.sel.enemy) targets[id] = { x: 3.6, z: 0.5, rot: -0.5 + Math.sin(this.spin + 1) * 0.3, show: true };
        else targets[id] = { x: 0, z: -12, rot: 0, show: false };
      });
      if (this.sel.enemy && this.sel.enemy === this.sel.me) {
        // Same character on both sides: use the lineup model for "me" and just show it centered
        targets[this.sel.me] = { x: 1.2, z: 1.5, rot: Math.sin(this.spin) * 0.6, show: true };
      }
      this.camPos.set(0.6, 1.8, 7.2);
      this.camLook.set(1.2, 1.15, 0);
    }
    if (this.debugCam) { this.camPos.copy(this.debugCam.pos); this.camLook.copy(this.debugCam.look); }
    for (const id of ids) {
      const g = this.pedestals[id], t = targets[id];
      const k = Math.min(1, dt * 5);
      g.position.x += (t.x - g.position.x) * k;
      g.position.z += (t.z - g.position.z) * k;
      g.rotation.y += (t.rot - g.rotation.y) * k;
      g.visible = t.show || g.position.z > -10;
      const m = this.models[id];
      m.update(dt, { vx: 0, vz: 0, yaw: Math.PI, pitch: Math.sin(this.t * 0.7 + id.length) * 0.08, grounded: true, dead: false, reload: -1, shield: false });
      m.root.rotation.y = 0; // pedestal handles facing
    }
    this.dust.rotation.y += dt * 0.02;
    this.rimA.intensity = 90 + Math.sin(this.t * 1.3) * 15;
    this.rimB.intensity = 70 + Math.cos(this.t * 1.1) * 12;

    const cam = this.camera;
    cam.position.lerp(this.camPos, Math.min(1, dt * 3));
    this._look = this._look || this.camLook.clone();
    this._look.lerp(this.camLook, Math.min(1, dt * 3));
    cam.lookAt(this._look);
    this.composer.render();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }
}

export { charById };
