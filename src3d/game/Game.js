// A single match: local player vs bot or vs remote peer.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WEAPONS, RESPAWN_TIME, PICKUP_HEAL, PICKUP_RESPAWN } from './data.js';
import { buildMap } from './maps.js';
import { Player } from './Player.js';
import { Bot } from './Bot.js';
import { CharacterModel } from './models.js';
import { Effects } from './effects.js';
import { getEnvMap } from './envmap.js';
import { sfx } from '../audio.js';

const SEND_HZ = 30;
const INTERP_DELAY = 100;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

// Remote opponent (online): state is driven by network snapshots.
class RemotePlayer {
  constructor(char) {
    this.char = char;
    this.r = char.radius; this.h = char.height;
    this.pos = { x: 0, y: -100, z: 0 }; this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0; this.hp = char.health; this.dead = false;
    this.grounded = true; this.weapon = 0; this.shield = false; this.protect = false; this.reload = -1; this.ads = false;
    this.kills = 0; this.deaths = 0;
    this.snaps = []; this.offset = null; this.hasState = false;
  }
  get invulnerable() { return this.shield || this.protect; }
  push(m) {
    const now = performance.now();
    const off = now - m.t;
    if (this.offset === null || off < this.offset) this.offset = off; else this.offset += (off - this.offset) * 0.02;
    const wasDead = this.snaps.length ? this.snaps[this.snaps.length - 1].dead : this.dead;
    const s = { t: m.t, p: m.p, v: m.v, yaw: m.y, pitch: m.pi, dead: !!(m.f & 2) };
    if (wasDead && !s.dead) this.snaps.length = 0; // respawn: no interpolation across the map
    this.snaps.push(s);
    if (this.snaps.length > 30) this.snaps.shift();
    this.hp = m.hp; this.weapon = m.w; this.grounded = !!(m.f & 1); this.shield = !!(m.f & 4); this.protect = !!(m.f & 8); this.ads = !!(m.f & 16);
    this.reload = m.rl;
    this.hasState = true;
  }
  update() {
    if (!this.snaps.length) return;
    const rt = performance.now() - this.offset - INTERP_DELAY;
    const S = this.snaps;
    let a = S[0], b = null;
    for (let i = S.length - 1; i >= 0; i--) { if (S[i].t <= rt) { a = S[i]; b = S[i + 1] || null; break; } }
    let p, yaw, pitch;
    if (b) {
      const k = (rt - a.t) / Math.max(1, b.t - a.t);
      p = [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k];
      let dy = b.yaw - a.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      yaw = a.yaw + dy * k; pitch = a.pitch + (b.pitch - a.pitch) * k;
      this.dead = a.dead && b.dead ? true : (k < 0.5 ? a.dead : b.dead);
    } else {
      const ex = Math.min(0.15, Math.max(0, (rt - a.t) / 1000));
      p = [a.p[0] + a.v[0] * ex, a.p[1] + a.v[1] * ex, a.p[2] + a.v[2] * ex];
      yaw = a.yaw; pitch = a.pitch; this.dead = a.dead;
    }
    this.pos.x = p[0]; this.pos.y = p[1]; this.pos.z = p[2];
    this.vel.x = a.v[0]; this.vel.y = a.v[1]; this.vel.z = a.v[2];
    this.yaw = yaw; this.pitch = pitch;
  }
}

export class Game {
  /**
   * opts: { renderer, hud, settings, mapIndex, myChar, enemyChar, mode:'bot'|'online', net, isHost,
   *         difficulty, killLimit, myName, enemyName, onEnd, onPauseRequest }
   */
  constructor(opts) {
    Object.assign(this, opts);
    const R = this.renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 1000);
    this.map = buildMap(this.mapIndex, this.scene, this.settings.quality);
    this.world = this.map.world;
    R.toneMappingExposure = this.map.env.exposure;
    this.scene.environment = getEnvMap(R);
    this.scene.environmentIntensity = this.map.env.envI ?? 0.45;
    this.fx = new Effects(this.scene);

    // Players
    this.me = new Player(this.myChar, this.world);
    this.meModel = new CharacterModel(this.myChar);
    this.scene.add(this.meModel.root);
    if (this.mode === 'bot') {
      this.enemy = new Player(this.enemyChar, this.world);
    } else {
      this.enemy = new RemotePlayer(this.enemyChar);
    }
    this.enemyModel = new CharacterModel(this.enemyChar);
    this.scene.add(this.enemyModel.root);

    // Spawns: host/solo spawns west, guest east
    const west = this.map.spawns.filter(s => s[0] < 0), east = this.map.spawns.filter(s => s[0] > 0);
    const mySide = this.mode === 'online' && !this.isHost ? east : west;
    this.me.reset(mySide[0]);
    this.me.yaw = mySide[0][0] < 0 ? -Math.PI / 2 : Math.PI / 2;
    this.yaw = this.me.yaw; this.pitch = 0;
    if (this.mode === 'bot') {
      this.enemy.reset(east[0]);
      this.enemy.yaw = Math.PI / 2;
      this.bot = new Bot(this.enemy, this.me, this.world, this.difficulty, null);
    }

    // Pickups
    this.pickups = this.map.pickups.map((p, i) => this._makePickup(p, i));
    if (this.bot) this.bot.pickups = this.pickups;

    // Post processing
    this.composer = new EffectComposer(R);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.settings.quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.45, 0.88);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());

    // Input
    this.keys = {}; this.mouse = { left: false, right: false };
    this.pressed = {};
    this.weaponSel = 0;
    this._bind();

    // State
    this.time = 0; this.sendAcc = 0; this.over = false; this.paused = false;
    this.respawnT = 0; this.enemyRespawnT = 0;
    this.adsT = 0; this.shake = 0; this.stepAcc = 0; this.enemyStepAcc = 0;
    this.camBack = 3; this.dmgAngle = 0; this.plateLos = true; this.losT = 0;
    this.hudData = {};

    this.hud.setup({ myName: this.myName, enemyName: this.enemyName, myColor: this.myChar.color, enemyColor: this.enemyChar.color, limit: this.killLimit, mapName: this.map.name, char: this.myChar });

    if (this.net) this._bindNet();
    this.hud.banner(this.map.name.toUpperCase(), `First to ${this.killLimit} eliminations`, '#' + this.myChar.accent.toString(16).padStart(6, '0'), 2.5);
  }

  // ------------------------------------------------------------ setup helpers
  _makePickup(p, i) {
    const g = new THREE.Group();
    g.position.set(p[0], p[1], p[2]);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.08, 24), new THREE.MeshStandardMaterial({ color: 0x1b2026, metalness: 0.7, roughness: 0.3 }));
    pad.position.y = 0.04; pad.receiveShadow = true; g.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 8, 32), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x39ff8a, emissiveIntensity: 3 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.09; g.add(ring);
    const item = new THREE.Group(); item.position.y = 0.8; g.add(item);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), new THREE.MeshStandardMaterial({ color: 0xf2f4f5, metalness: 0.1, roughness: 0.35 }));
    box.castShadow = true; item.add(box);
    const cm = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x39ff8a, emissiveIntensity: 2.8 });
    for (const [w, h] of [[0.3, 0.1], [0.1, 0.3]]) {
      for (const s of [1, -1]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), cm); c.position.z = 0.215 * s; item.add(c);
        const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, h, w), cm); c2.position.x = 0.215 * s; item.add(c2);
      }
    }
    const light = new THREE.PointLight(0x39ff8a, 6, 4, 2); light.position.y = 0.8; g.add(light);
    this.scene.add(g);
    return { i, pos: p, group: g, item, light, active: true, timer: 0 };
  }

  _bind() {
    const canvas = this.renderer.domElement;
    this.h = {
      kd: e => {
        if (e.repeat) return;
        this.keys[e.code] = true; this.pressed[e.code] = true;
        if (e.code.startsWith('Digit')) { const n = +e.code.slice(5) - 1; if (n >= 0 && n < WEAPONS.length) this.weaponSel = n; }
        if (e.code === 'KeyQ') this.weaponSel = (this.weaponSel + WEAPONS.length - 1) % WEAPONS.length;
        if (e.code === 'KeyE') this.weaponSel = (this.weaponSel + 1) % WEAPONS.length;
        if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
      },
      ku: e => { this.keys[e.code] = false; },
      md: e => {
        if (!this.locked) { if (!this.over) canvas.requestPointerLock?.(); return; }
        if (e.button === 0) this.mouse.left = true;
        if (e.button === 2) this.mouse.right = true;
      },
      mu: e => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; },
      mm: e => {
        if (!this.locked) return;
        const zoom = 1 + (WEAPONS[this.me.weapon].zoom - 1) * this.adsT;
        const s = this.settings.sensitivity * 0.0022 / zoom;
        this.yaw -= e.movementX * s;
        this.pitch -= e.movementY * s * (this.settings.invertY ? -1 : 1);
        this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
      },
      wheel: e => { if (!this.locked) return; this.weaponSel = (this.weaponSel + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length; },
      lock: () => {
        this.locked = document.pointerLockElement === canvas;
        if (!this.locked) { this.mouse.left = this.mouse.right = false; this.keys = {}; if (!this.over) this.onPauseRequest?.(); }
      },
      ctx: e => e.preventDefault(),
      blur: () => { this.keys = {}; this.mouse.left = this.mouse.right = false; }
    };
    addEventListener('keydown', this.h.kd);
    addEventListener('keyup', this.h.ku);
    canvas.addEventListener('mousedown', this.h.md);
    addEventListener('mouseup', this.h.mu);
    addEventListener('mousemove', this.h.mm);
    addEventListener('wheel', this.h.wheel, { passive: true });
    document.addEventListener('pointerlockchange', this.h.lock);
    canvas.addEventListener('contextmenu', this.h.ctx);
    addEventListener('blur', this.h.blur);
  }

  lockPointer() { this.renderer.domElement.requestPointerLock?.(); }

  _bindNet() {
    const n = this.net;
    n.on('s', m => this.enemy.push(m));
    n.on('hit', m => this._receiveHit(m));
    n.on('die', m => this._remoteDied(m));
    n.on('shot', m => this._remoteShot(m));
    n.on('ev', m => this._remoteEvent(m));
    n.on('pk', m => { const p = this.pickups[m.i]; if (p) { p.active = false; p.timer = PICKUP_RESPAWN; } });
  }

  // ------------------------------------------------------------ main loop
  update(dt) {
    if (this.over && this.endT !== undefined) { this.endT -= dt; if (this.endT <= 0 && !this.ended) { this.ended = true; this._finish(); } }
    const simDt = this.paused && this.mode === 'bot' ? 0 : dt;
    this.time += simDt;

    // Local input
    const K = this.keys, P = this.pressed;
    const active = this.locked && !this.over;
    const ads = active && this.mouse.right && !this.me.dead;
    const input = {
      mx: active ? (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0) : 0,
      mz: active ? (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0) : 0,
      jump: active && !!K.Space,
      yaw: this.yaw, pitch: this.pitch,
      fire: active && this.mouse.left,
      ads, reload: active && !!P.KeyR,
      weapon: this.weaponSel,
      ability: active && !!(P.ShiftLeft || P.ShiftRight)
    };
    this.pressed = {};

    if (simDt > 0) {
      this.me.update(simDt, input, (p, a) => this._fire(p, a, true));
      if (!this.me.dead && this.me.pos.y < this.map.killY) this._localDied('fall');

      if (this.bot) {
        const bi = this.bot.think(simDt);
        this.enemy.update(simDt, bi, (p, a) => this._fire(p, a, false));
        if (!this.enemy.dead && this.enemy.pos.y < this.map.killY) this._botDied('fall');
      } else {
        this.enemy.update();
      }

      this._events(this.me, true);
      if (this.bot) this._events(this.enemy, false);
      this._pickups(simDt);
      this._respawns(simDt);
    }

    // Network send
    if (this.net) {
      this.sendAcc += dt;
      if (this.sendAcc >= 1 / SEND_HZ) {
        this.sendAcc = 0;
        const m = this.me;
        const f = (m.grounded ? 1 : 0) | (m.dead ? 2 : 0) | (m.shieldT > 0 ? 4 : 0) | (m.protectT > 0 ? 8 : 0) | (ads ? 16 : 0);
        this.net.send({ type: 's', t: performance.now(), p: [r3(m.pos.x), r3(m.pos.y), r3(m.pos.z)], v: [r3(m.vel.x), r3(m.vel.y), r3(m.vel.z)], y: r3(m.yaw), pi: r3(m.pitch), w: m.weapon, f, rl: r3(m.reloadProgress), hp: Math.ceil(m.hp) });
      }
    }

    // Models
    const e = this.enemy;
    this.adsT += ((ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
    this._syncModel(this.meModel, this.me, dt, { shield: this.me.shieldT > 0, protect: this.me.protectT > 0, reload: this.me.reloadProgress });
    this._syncModel(this.enemyModel, e, dt, this.bot
      ? { shield: e.shieldT > 0, protect: e.protectT > 0, reload: e.reloadProgress }
      : { shield: e.shield, protect: e.protect, reload: e.reload });
    this.enemyModel.root.visible = this.bot ? true : e.hasState;

    // Footsteps
    this.stepAcc += this.me.grounded && !this.me.dead ? Math.hypot(this.me.vel.x, this.me.vel.z) * dt : 0;
    if (this.stepAcc > 2.3) { this.stepAcc = 0; sfx.step(); }

    this._camera(dt);
    this.fx.update(dt);
    this._animatePickups(dt);
    this._hud(dt);
    this.scene.updateMatrixWorld();
    this.composer.render();
  }

  _syncModel(model, p, dt, extra) {
    model.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    model.setWeapon(p.weapon);
    model.update(dt, { vx: p.vel.x, vz: p.vel.z, yaw: p.yaw, pitch: p.pitch, grounded: p.grounded, dead: p.dead, reload: extra.reload, shield: extra.shield, ghostAlpha: extra.protect ? 0 : 1 });
  }

  // ------------------------------------------------------------ camera
  _camera(dt) {
    const m = this.me, cam = this.camera;
    const w = WEAPONS[m.weapon];
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = _v1.set(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const a = this.adsT;
    const scoped = m.weapon === 3;
    const baseSide = 0.3 + m.r * (m.char.id === 'tank' ? 1.2 : 0.9);
    const side = baseSide - a * (scoped ? baseSide : 0.08), up = 0.32 - a * (scoped ? 0.2 : 0.04);
    let back = 3.1 - a * (scoped ? 3.0 : 1.3);
    const eyeY = m.pos.y + m.h * 0.86;
    if (m.dead) back = 5;
    const pivot = _v2.set(m.pos.x + rx * side, eyeY + up + (m.dead ? 1.5 : 0), m.pos.z + rz * side);
    // Don't clip the pivot into walls
    const sideHit = this.world.raycast(m.pos.x, eyeY, m.pos.z, rx, 0, rz, side + 0.25);
    if (sideHit) pivot.set(m.pos.x + rx * Math.max(0, sideHit.t - 0.25), pivot.y, m.pos.z + rz * Math.max(0, sideHit.t - 0.25));
    const hit = this.world.raycast(pivot.x, pivot.y, pivot.z, -dir.x, -dir.y, -dir.z, back + 0.3);
    if (hit) back = Math.max(0.2, hit.t - 0.3);
    this.camBack += (back - this.camBack) * Math.min(1, dt * (back < this.camBack ? 30 : 6));
    cam.position.copy(pivot).addScaledVector(dir, -this.camBack);
    this.shake = Math.max(0, this.shake - dt * 4);
    if (this.shake > 0) cam.position.add(_v3.set((Math.random() - 0.5) * this.shake * 0.15, (Math.random() - 0.5) * this.shake * 0.15, 0));
    cam.lookAt(pivot.x + dir.x * 50, pivot.y + dir.y * 50, pivot.z + dir.z * 50);
    const zoom = 1 + (w.zoom - 1) * a;
    const fov = this.settings.fov / zoom;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    // Hide own model when scoped or camera is inside it
    this.meModel.root.visible = !(scoped && a > 0.6) && this.camBack > 0.7;
  }

  // ------------------------------------------------------------ shooting
  _hitboxes(p) {
    const s = p.char.id === 'tank' ? 1.12 : 1;
    const hy = p.pos.y + p.h * 0.9;
    return {
      head: { x: p.pos.x, y: hy, z: p.pos.z, r: 0.2 * s },
      body: { min: { x: p.pos.x - 0.33 * s, y: p.pos.y, z: p.pos.z - 0.33 * s }, max: { x: p.pos.x + 0.33 * s, y: p.pos.y + p.h * 0.8, z: p.pos.z + 0.33 * s } }
    };
  }

  _rayTarget(o, d, p, maxT) {
    if (p.dead) return null;
    const hb = this._hitboxes(p);
    let best = null;
    // Sphere (head)
    const ox = o.x - hb.head.x, oy = o.y - hb.head.y, oz = o.z - hb.head.z;
    const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - hb.head.r ** 2;
    const disc = b * b - c;
    if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < maxT) best = { t, head: true }; }
    // Box (body)
    const bb = hb.body;
    let tmin = 0, tmax = maxT;
    for (const ax of ['x', 'y', 'z']) {
      const inv = 1 / (d[ax] || 1e-9);
      let t1 = (bb.min[ax] - o[ax]) * inv, t2 = (bb.max[ax] - o[ax]) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    }
    if (tmin <= tmax && tmin > 0 && (!best || tmin < best.t)) best = { t: tmin, head: false };
    return best;
  }

  _fire(shooter, ads, isLocal) {
    const w = WEAPONS[shooter.weapon];
    const target = isLocal ? this.enemy : this.me;
    const model = isLocal ? this.meModel : this.enemyModel;
    const eye = { x: shooter.pos.x, y: shooter.pos.y + shooter.h * 0.86, z: shooter.pos.z };

    // Aim ray: camera for the local player, eye for the bot
    let origin, baseDir;
    if (isLocal) {
      this.camera.updateMatrixWorld();
      origin = this.camera.position.clone();
      baseDir = new THREE.Vector3(); this.camera.getWorldDirection(baseDir);
      const skip = Math.max(0, _v1.set(eye.x, eye.y, eye.z).sub(origin).dot(baseDir));
      origin.addScaledVector(baseDir, skip);
    } else {
      origin = new THREE.Vector3(eye.x, eye.y, eye.z);
      const cp = Math.cos(shooter.pitch);
      baseDir = new THREE.Vector3(-Math.sin(shooter.yaw) * cp, Math.sin(shooter.pitch), -Math.cos(shooter.yaw) * cp);
    }
    model.root.updateMatrixWorld(true);
    const muzzle = model.getMuzzle(new THREE.Vector3());
    const spread = shooter.spread(ads);

    let total = 0, anyHead = false, hitCount = 0;
    const ends = [];
    for (let i = 0; i < w.pellets; i++) {
      const d = baseDir.clone();
      if (spread > 0) {
        const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * spread;
        const u = _v2.set(0, 1, 0).cross(d).normalize();
        const v = _v3.crossVectors(d, u).normalize();
        d.addScaledVector(u, Math.cos(ang) * rad).addScaledVector(v, Math.sin(ang) * rad).normalize();
      }
      const wh = this.world.raycast(origin.x, origin.y, origin.z, d.x, d.y, d.z, 250);
      let t = wh ? wh.t : 250;
      const th = this._rayTarget(origin, d, target, t);
      let end = origin.clone().addScaledVector(d, th ? th.t : t);
      // Make sure the shooter actually has line of fire from their eye
      const ex = end.x - eye.x, ey = end.y - eye.y, ez = end.z - eye.z, el = Math.hypot(ex, ey, ez);
      const block = el > 0.01 ? this.world.raycast(eye.x, eye.y, eye.z, ex / el, ey / el, ez / el, el - 0.02) : null;
      let normal = wh ? new THREE.Vector3(wh.nx, wh.ny, wh.nz) : null;
      let hitPlayer = th && !block;
      if (block) { end.set(eye.x + ex / el * block.t, eye.y + ey / el * block.t, eye.z + ez / el * block.t); normal = new THREE.Vector3(block.nx, block.ny, block.nz); }

      if (hitPlayer) {
        const dist = Math.hypot(end.x - eye.x, end.z - eye.z);
        const [f0, f1, fm] = w.falloff;
        const fall = dist <= f0 ? 1 : dist >= f1 ? fm : 1 - (1 - fm) * (dist - f0) / (f1 - f0);
        total += w.dmg * fall * (th.head ? w.head : 1);
        anyHead = anyHead || th.head;
        hitCount++;
        this.fx.burst(end, target.invulnerable ? target.char.accent : target.char.color, 10, 4, 0.35, 8, 0.8, d.clone().multiplyScalar(-1));
      } else if (normal && t < 250) {
        this.fx.impact(end, normal);
      }
      ends.push(end);
      this.fx.tracer(muzzle, end, isLocal ? 0xfff0c0 : 0xffc0a0, w.pellets > 1 ? 0.018 : 0.028);
    }

    this.fx.muzzle(muzzle, baseDir, w.pellets > 1 ? 0.8 : w.id === 'rifle' ? 0.9 : 0.55);
    model.kick(w.recoil * 6);
    if (isLocal) {
      this.pitch = Math.min(1.35, this.pitch + w.recoil * (ads ? 0.5 : 1));
      this.yaw += (Math.random() - 0.5) * w.recoil * 0.4;
      sfx.gun(shooter.weapon, 0, 0);
      if (this.net) this.net.send({ type: 'shot', w: shooter.weapon, e: ends.map(v => [r3(v.x), r3(v.y), r3(v.z)]) });
    } else {
      this._spatialGun(shooter);
    }
    if (hitCount) {
      shooter.hits++;
      if (anyHead) shooter.headshots++;
      this._applyHit(isLocal, total, anyHead, shooter.pos);
    }
  }

  _spatialGun(p, weapon = p.weapon) {
    const dx = p.pos.x - this.me.pos.x, dz = p.pos.z - this.me.pos.z;
    const dist = Math.hypot(dx, dz);
    const rel = Math.atan2(-dx, -dz) - this.yaw;
    sfx.gun(weapon, dist, -Math.sin(rel) * 0.8);
  }

  _applyHit(byLocal, dmg, head, fromPos) {
    if (byLocal) {
      const e = this.enemy;
      if (e.invulnerable) { this.hud.hitmarker(false, false); return; }
      const hb = this._hitboxes(e);
      const scr = this._project(hb.head.x, hb.head.y + 0.3, hb.head.z);
      if (scr) this.hud.damageNumber(scr.x, scr.y, dmg, head);
      if (this.bot) {
        e.takeDamage(dmg);
        this.enemyModel.hit();
        const kill = e.hp <= 0;
        this.hud.hitmarker(head, kill);
        sfx.hit(head);
        if (kill) this._botDied('enemy', head);
      } else {
        const kill = e.hp - dmg <= 0;
        this.hud.hitmarker(head, kill);
        sfx.hit(head);
        this.enemyModel.hit();
        this.net.send({ type: 'hit', dmg: Math.round(dmg * 10) / 10, head, from: [r3(fromPos.x), r3(fromPos.y), r3(fromPos.z)] });
      }
    } else {
      this._takeDamage(dmg, head, fromPos);
    }
  }

  _takeDamage(dmg, head, from) {
    const m = this.me;
    if (m.dead || this.over) return;
    if (!m.takeDamage(dmg)) return;
    this.meModel.hit();
    sfx.hurt();
    this.shake = Math.min(1, this.shake + 0.4);
    const ang = Math.atan2(-(from.x - m.pos.x), -(from.z - m.pos.z)) - this.yaw;
    this.dmgAngle = -ang;
    this.hud.hurt();
    if (m.hp <= 0) this._localDied('enemy', head);
  }

  _receiveHit(m) {
    if (this.over) return;
    this._takeDamage(m.dmg, m.head, { x: m.from[0], y: m.from[1], z: m.from[2] });
  }

  _remoteShot(m) {
    const e = this.enemy;
    this.enemyModel.root.updateMatrixWorld(true);
    const muzzle = this.enemyModel.getMuzzle(new THREE.Vector3());
    for (const p of m.e) {
      const end = new THREE.Vector3(p[0], p[1], p[2]);
      this.fx.tracer(muzzle, end, 0xffc0a0, m.w === 2 ? 0.018 : 0.028);
      this.fx.burst(end, 0xffc070, 4, 3, 0.25, 12);
    }
    const dir = new THREE.Vector3(m.e[0][0], m.e[0][1], m.e[0][2]).sub(muzzle).normalize();
    this.fx.muzzle(muzzle, dir, m.w === 2 ? 0.8 : 0.55);
    this.enemyModel.kick(WEAPONS[m.w].recoil * 6);
    this._spatialGun(e, m.w);
  }

  _remoteEvent(m) {
    const e = this.enemy;
    if (m.k === 'blink') { this.fx.blink(m.from, m.to, e.char.accent); sfx.ability('blink'); }
    else if (m.k === 'dash') { this.fx.burst(new THREE.Vector3(e.pos.x, e.pos.y + 1, e.pos.z), e.char.accent, 25, 3, 0.4, 0); sfx.ability('dash'); }
    else if (m.k === 'shield' || m.k === 'overclock') { this.fx.ring(new THREE.Vector3(e.pos.x, e.pos.y + 0.05, e.pos.z), e.char.accent); sfx.ability(m.k); }
  }

  // ------------------------------------------------------------ events, deaths, respawns
  _events(p, isLocal) {
    const model = isLocal ? this.meModel : this.enemyModel;
    const color = p.char.accent;
    for (const ev of p.events) {
      const at = new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z);
      const near = isLocal || Math.hypot(p.pos.x - this.me.pos.x, p.pos.z - this.me.pos.z) < 30;
      switch (ev.type) {
        case 'jump': if (isLocal) sfx.jump(); break;
        case 'land': if (isLocal) sfx.land(); break;
        case 'reload': if (isLocal) sfx.reload(); break;
        case 'reloaded': if (isLocal) sfx.reloaded(); break;
        case 'dash':
          this.fx.burst(at, color, 25, 3, 0.4, 0);
          this.fx.ring(new THREE.Vector3(p.pos.x, p.pos.y + 0.05, p.pos.z), color, 1.5);
          if (near) sfx.ability('dash');
          break;
        case 'blink':
          this.fx.blink(ev.from, ev.to, color);
          if (isLocal) { this.camBack = 0.5; }
          if (near) sfx.ability('blink');
          break;
        case 'shield': case 'overclock':
          this.fx.ring(new THREE.Vector3(p.pos.x, p.pos.y + 0.05, p.pos.z), color);
          this.fx.burst(at, color, 30, 3, 0.5, -2);
          if (near) sfx.ability(ev.type);
          break;
      }
      if (isLocal && this.net && ['dash', 'blink', 'shield', 'overclock'].includes(ev.type)) {
        this.net.send({ type: 'ev', k: ev.type, from: ev.from, to: ev.to });
      }
    }
    p.events.length = 0;
    void model;
  }

  _enemyColorHex() { return '#' + this.enemyChar.color.toString(16).padStart(6, '0'); }
  _myColorHex() { return '#' + this.myChar.color.toString(16).padStart(6, '0'); }

  _localDied(cause, head = false) {
    const m = this.me;
    if (m.dead) return;
    m.dead = true; m.hp = 0; m.deaths++;
    this.enemy.kills++;
    this.respawnT = RESPAWN_TIME;
    this.killedBy = cause;
    sfx.death();
    this.fx.burst(new THREE.Vector3(m.pos.x, m.pos.y + 1, m.pos.z), m.char.color, 40, 5, 0.7, 6);
    const en = `<b style="color:${this._enemyColorHex()}">${esc(this.enemyName)}</b>`, me = `<b style="color:${this._myColorHex()}">${esc(this.myName)}</b>`;
    this.hud.feed(cause === 'fall' ? `${me} <span class="fk">fell to their doom</span>` : `${en} <span class="fk">${head ? '◎ headshot' : '▸'}</span> ${me}`);
    this.hud.banner(cause === 'fall' ? 'YOU FELL' : 'ELIMINATED', cause === 'fall' ? `+1 to ${this.enemyName}` : `by ${this.enemyName}`, '#ff4a4a', 1.8);
    if (this.net) this.net.send({ type: 'die', cause, head });
    this._checkWin();
  }

  _remoteDied(msg) {
    const e = this.enemy;
    e.deaths++;
    this.me.kills++;
    this._enemyDownFx(msg.cause, msg.head);
    this._checkWin();
  }

  _botDied(cause, head = false) {
    const e = this.enemy;
    if (e.dead) return;
    e.dead = true; e.hp = 0; e.deaths++;
    this.me.kills++;
    this.enemyRespawnT = RESPAWN_TIME;
    this._enemyDownFx(cause, head);
    this._checkWin();
  }

  _enemyDownFx(cause, head) {
    const e = this.enemy;
    sfx.kill();
    this.fx.burst(new THREE.Vector3(e.pos.x, e.pos.y + 1, e.pos.z), e.char.color, 40, 5, 0.7, 6);
    const en = `<b style="color:${this._enemyColorHex()}">${esc(this.enemyName)}</b>`, me = `<b style="color:${this._myColorHex()}">${esc(this.myName)}</b>`;
    this.hud.feed(cause === 'fall' ? `${en} <span class="fk">fell to their doom</span>` : `${me} <span class="fk">${head ? '◎ headshot' : '▸'}</span> ${en}`);
    this.hud.banner(head ? 'HEADSHOT' : 'ELIMINATED', cause === 'fall' ? `${this.enemyName} fell` : this.enemyName, '#' + this.myChar.accent.toString(16).padStart(6, '0'), 1.6);
  }

  _checkWin() {
    if (this.over) return;
    if (this.me.kills >= this.killLimit || this.enemy.kills >= this.killLimit) {
      this.over = true;
      this.endT = 2.2;
      const win = this.me.kills >= this.killLimit;
      this.hud.banner(win ? 'VICTORY' : 'DEFEAT', `${this.me.kills} — ${this.enemy.kills}`, win ? '#3dff9a' : '#ff4a4a', 3);
      (win ? sfx.win : sfx.lose)();
    }
  }

  _finish() {
    document.exitPointerLock?.();
    this.onEnd?.({
      win: this.me.kills >= this.killLimit,
      myKills: this.me.kills, enemyKills: this.enemy.kills, deaths: this.me.deaths,
      accuracy: this.me.shots ? Math.round(this.me.hits / this.me.shots * 100) : 0,
      headshots: this.me.headshots
    });
  }

  _spawnFarFrom(p) {
    let best = null, bd = -1;
    for (const s of this.map.spawns) {
      const d = Math.hypot(s[0] - p.pos.x, s[2] - p.pos.z) + Math.random() * 6;
      if (d > bd) { bd = d; best = s; }
    }
    return best;
  }

  _respawns(dt) {
    if (this.over) return;
    if (this.me.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        const s = this._spawnFarFrom(this.enemy);
        const w = this.me.weapon;
        this.me.reset(s);
        this.me.weapon = w;
        this.yaw = Math.atan2(s[0], s[2]); this.pitch = 0; // face the map center
        this.fx.ring(new THREE.Vector3(s[0], s[1] + 0.05, s[2]), this.myChar.accent);
      }
    }
    if (this.bot && this.enemy.dead) {
      this.enemyRespawnT -= dt;
      if (this.enemyRespawnT <= 0) {
        const s = this._spawnFarFrom(this.me);
        this.enemy.reset(s);
        this.bot.yaw = Math.atan2(s[0], s[2]);
        this.bot.path = null;
        this.fx.ring(new THREE.Vector3(s[0], s[1] + 0.05, s[2]), this.enemyChar.accent);
      }
    }
  }

  _pickups(dt) {
    for (const pk of this.pickups) {
      if (!pk.active) {
        pk.timer -= dt;
        if (pk.timer <= 0) pk.active = true;
        continue;
      }
      const test = (p) => !p.dead && p.hp < p.char.health && Math.hypot(p.pos.x - pk.pos[0], p.pos.z - pk.pos[2]) < 0.9 && Math.abs(p.pos.y - pk.pos[1]) < 1.2;
      let taker = null;
      if (test(this.me)) taker = this.me;
      else if (this.bot && test(this.enemy)) taker = this.enemy;
      if (!taker) continue;
      taker.hp = Math.min(taker.char.health, taker.hp + PICKUP_HEAL);
      pk.active = false; pk.timer = PICKUP_RESPAWN;
      this.fx.burst(new THREE.Vector3(pk.pos[0], pk.pos[1] + 0.8, pk.pos[2]), 0x39ff8a, 30, 3, 0.6, -2);
      this.fx.ring(new THREE.Vector3(pk.pos[0], pk.pos[1] + 0.05, pk.pos[2]), 0x39ff8a, 2);
      if (taker === this.me) { sfx.pickup(); if (this.net) this.net.send({ type: 'pk', i: pk.i }); }
    }
  }

  _animatePickups(dt) {
    for (const pk of this.pickups) {
      pk.item.visible = pk.active;
      pk.light.intensity = pk.active ? 6 : 0;
      pk.item.rotation.y += dt * 1.5;
      pk.item.position.y = 0.8 + Math.sin(this.time * 2.5 + pk.i) * 0.08;
    }
  }

  // ------------------------------------------------------------ HUD
  _project(x, y, z) {
    const v = _v3.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }

  _hud(dt) {
    const m = this.me, e = this.enemy;
    const w = WEAPONS[m.weapon];
    const fovR = this.camera.fov * Math.PI / 180;
    const spreadPx = Math.tan(m.spread(this.adsT > 0.5)) / Math.tan(fovR / 2) * (innerHeight / 2);

    // Enemy nameplate only when visible
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.1;
      const c = this.camera.position;
      this.plateLos = !e.dead && this.world.clear(c.x, c.y, c.z, e.pos.x, e.pos.y + e.h * 0.9, e.pos.z);
    }
    let plate = null;
    if (this.plateLos && this.enemyModel.root.visible && !e.dead) {
      const pp = this._project(e.pos.x, e.pos.y + e.h + 0.45, e.pos.z);
      if (pp) {
        const dist = this.camera.position.distanceTo(_v1.set(e.pos.x, e.pos.y, e.pos.z));
        plate = { x: pp.x, y: pp.y, hp: Math.max(0, e.hp / e.char.health), scale: Math.max(0.55, Math.min(1, 12 / dist)) };
      }
    }

    this.hud.update(dt, {
      myKills: m.kills, enemyKills: e.kills,
      hp: m.hp, maxHp: m.char.health,
      weapon: m.weapon, ammo: m.ammo[m.weapon], reload: m.reloadProgress,
      abilityCd: m.abilityCd, abilityCdMax: m.char.abilityCd, abilityActive: m.shieldT > 0 || m.overclockT > 0 || m.dashT > 0,
      spreadPx, showCross: !m.dead && !(m.weapon === 3 && this.adsT > 0.6),
      scope: m.weapon === 3 && this.adsT > 0.6 && !m.dead,
      dead: m.dead, dmgAngle: this.dmgAngle,
      respawnText: m.dead && !this.over ? `RESPAWNING IN ${Math.max(0, this.respawnT).toFixed(1)}` : '',
      ping: this.net ? Math.round(this.net.ping) : null,
      plate
    });
    void w;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }

  dispose() {
    const canvas = this.renderer.domElement;
    removeEventListener('keydown', this.h.kd);
    removeEventListener('keyup', this.h.ku);
    canvas.removeEventListener('mousedown', this.h.md);
    removeEventListener('mouseup', this.h.mu);
    removeEventListener('mousemove', this.h.mm);
    removeEventListener('wheel', this.h.wheel);
    document.removeEventListener('pointerlockchange', this.h.lock);
    canvas.removeEventListener('contextmenu', this.h.ctx);
    removeEventListener('blur', this.h.blur);
    if (this.net) for (const t of ['s', 'hit', 'die', 'shot', 'ev', 'pk']) this.net.off(t);
    this.scene.traverse(o => { o.geometry?.dispose?.(); });
    this.composer.dispose?.();
  }
}

const r3 = v => Math.round(v * 1000) / 1000;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
