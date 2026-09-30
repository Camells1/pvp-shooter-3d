// A match: Spike (attack/defend, Valorant-style), Elimination rounds, or the Practice Range.
//
// Authority model:
//  - Every machine simulates its own player (movement, shooting, health). The host also runs bots/dummies.
//  - Shooters decide hits ("favor the shooter") and tell the victim's owner, who applies damage.
//  - Area abilities are broadcast; each machine applies them to the players it owns.
//  - The host owns the round flow, credits, dropped guns, the spike and bot purchases.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { weaponById, charById, CHARACTERS, SHIELDS, ECON, ROUND, SPIKE, PICKUP_HEAL, ABILITY_NAMES } from './data.js';
import { buildMap } from './maps.js';
import { Player, CROUCH_H } from './Player.js';
import { Bot, Dummy, botShopping } from './Bot.js';
import { CharacterModel, buildGun, buildSpike, disposeMerged } from './models.js';
import { Effects } from './effects.js';
import { getEnvMap } from './envmap.js';
import { ViewModel } from './viewmodel.js';
import { sfx } from '../audio.js';

const SEND_HZ = 30;
const INTERP_DELAY = 100;
// Left Ctrl crouches only in the desktop app: in a browser tab, Ctrl+W would close the game
const CTRL_CROUCH = navigator.userAgent.includes('Electron');
const TEAM_COLORS = ['#3dd6ff', '#ff4a5a'];
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const r3 = v => Math.round(v * 1000) / 1000;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexs = c => '#' + c.toString(16).padStart(6, '0');
const V = p => new THREE.Vector3(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]);
// Body animation for each ability
const ABILITY_ANIM = { dash: 'dash', blink: 'blink', shield: 'brace', fortify: 'cast', cloak: 'cast', overclock: 'cast', firebomb: 'throw', smoke: 'throw', storm: 'throw', mine: 'slam', field: 'slam', rocket: 'rocket', quake: 'slam', nova: 'slam', freeze: 'cast', heal: 'cast', revive: 'cast', pulse: 'cast', overwatch: 'cast', chain: 'cast', wall: 'cast' };
const killName = w => w?.startsWith?.('ab:') ? (ABILITY_NAMES[w.slice(3)] || 'Ability') : w === 'spike' ? 'Spike' : w ? weaponById(w).name : '';

// A player simulated on another machine: interpolates network snapshots.
class RemotePlayer {
  constructor(char) {
    this.char = char;
    this.r = char.radius; this.h = char.height;
    this.pos = { x: 0, y: -100, z: 0 }; this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0; this.hp = char.health; this.shield = 0;
    this.dead = false; this.deadOverride = false;
    this.grounded = true; this.weaponId = 'classic'; this.skinId = 'default'; this.shieldOn = false; this.cloaked = false; this.reload = -1; this.ads = false;
    this.snaps = []; this.offset = null; this.hasState = false;
    this.crouch = false; this.crouchAmt = 0; this.lastUpd = 0;
  }
  get invulnerable() { return this.shieldOn; }
  get reloadProgress() { return this.reload; }
  push(m) {
    const now = performance.now();
    const off = now - m.t;
    if (this.offset === null || off < this.offset) this.offset = off; else this.offset += (off - this.offset) * 0.02;
    const dead = !!(m.f & 2);
    const prev = this.snaps[this.snaps.length - 1];
    if (prev && prev.dead && !dead) this.snaps.length = 0;
    if (prev && Math.hypot(prev.p[0] - m.p[0], prev.p[2] - m.p[2]) > 12) this.snaps.length = 0;
    this.snaps.push({ t: m.t, p: m.p, v: m.v, yaw: m.y, pitch: m.pi, dead });
    if (this.snaps.length > 30) this.snaps.shift();
    this.hp = m.hp; this.shield = m.sh || 0; this.weaponId = m.w; this.skinId = m.sk || 'default';
    this.grounded = !!(m.f & 1); this.shieldOn = !!(m.f & 4); this.ads = !!(m.f & 16); this.cloaked = !!(m.f & 32); this.channeling = !!(m.f & 64); this.crouch = !!(m.f & 128);
    this.reload = m.rl;
    this.hasState = true;
  }
  update() {
    // Crouch eases the same way it does on the owner's machine, and moves the hitboxes with it
    const now = performance.now(), dt = Math.min(0.1, (now - (this.lastUpd || now)) / 1000);
    this.lastUpd = now;
    this.crouchAmt += Math.sign((this.crouch ? 1 : 0) - this.crouchAmt) * Math.min(Math.abs((this.crouch ? 1 : 0) - this.crouchAmt), dt * 8);
    this.h = this.char.height * (1 - (1 - CROUCH_H) * this.crouchAmt);
    if (!this.snaps.length) return;
    const rt = performance.now() - this.offset - INTERP_DELAY;
    const S = this.snaps;
    let a = S[0], b = null;
    for (let i = S.length - 1; i >= 0; i--) { if (S[i].t <= rt) { a = S[i]; b = S[i + 1] || null; break; } }
    let p, yaw, pitch, dead;
    if (b) {
      const k = (rt - a.t) / Math.max(1, b.t - a.t);
      p = [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k];
      let dy = b.yaw - a.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      yaw = a.yaw + dy * k; pitch = a.pitch + (b.pitch - a.pitch) * k;
      dead = k < 0.5 ? a.dead : b.dead;
    } else {
      const ex = Math.min(0.15, Math.max(0, (rt - a.t) / 1000));
      p = [a.p[0] + a.v[0] * ex, a.p[1] + a.v[1] * ex, a.p[2] + a.v[2] * ex];
      yaw = a.yaw; pitch = a.pitch; dead = a.dead;
    }
    this.pos.x = p[0]; this.pos.y = p[1]; this.pos.z = p[2];
    this.vel.x = a.v[0]; this.vel.y = a.v[1]; this.vel.z = a.v[2];
    this.yaw = yaw; this.pitch = pitch;
    this.dead = dead || this.deadOverride;
  }
}

export class Game {
  /**
   * o: { renderer, hud, buy, pointer, settings, net, myId, isHost, roster:[{id,name,team,char,isBot,skins,dummy}],
   *      mapIndex, roundsToWin, difficulty, mode: 'spike'|'elim'|'range', onEnd, onPauseRequest }
   */
  constructor(o) {
    Object.assign(this, o);
    this.mode = this.mode || 'spike';
    this.isRange = this.mode === 'range';
    const R = this.renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 1200);
    this.map = buildMap(this.mapIndex, this.scene, this.settings.quality);
    this.world = this.map.world;
    this.useSpike = this.mode === 'spike' && this.map.sites.length >= 2;
    R.toneMappingExposure = this.map.env.exposure;
    this.scene.environment = getEnvMap(R);
    this.scene.environmentIntensity = this.map.env.envI ?? 0.45;
    this.fx = new Effects(this.scene);
    this.vm = new ViewModel(getEnvMap(R));

    this.rs = { n: 0, phase: 'wait', t: 0, score: [0, 0], winner: null, matchWinner: null };
    this.side = [0, 1];                 // team -> side (0 = attackers / west, 1 = defenders / east)
    this.credits = {};
    this.lossStreak = [0, 0];
    this.drops = new Map(); this.dropSeq = 1;
    this.walls = []; this.zones = []; this.mines = new Map(); this.mineSeq = 1;
    this.revealT = 0;
    this.deathOrder = [];
    this.loaded = new Set([this.myId]);
    this.waitT = 0;
    this.spike = { state: 'none', holder: null, pos: null, site: null, t: 0 };
    this.chan = new Map();              // entity id -> channel progress
    this.half = Math.max(1, (this.roundsToWin || 5) - 1);

    this.pickups = this.mode === 'elim' ? this.map.pickups.map((p, i) => this._makePickup(p, i)) : [];
    if (this.useSpike) this._buildSites();
    this.spikeMesh = buildSpike();
    this.spikeMesh.visible = false;
    this.scene.add(this.spikeMesh);

    this.ents = new Map();
    for (const r of this.roster) this._makeEnt(r);
    // Practice range targets come straight from the map definition
    if (this.isRange) this.map.dummies.forEach((d, i) => this._makeEnt({ id: 'd' + i, name: 'Target', char: CHARACTERS[i % CHARACTERS.length].id, team: 1, isBot: true, skins: {}, dummy: d }));
    this.me = this.ents.get(this.myId);
    this.myTeam = this.me.team;
    this.vm.setChar(this.me.char);
    for (const E of this.ents.values()) this.credits[E.id] = this.isRange ? 99999 : ECON.start;

    this.composer = new EffectComposer(R);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.vmPass = new RenderPass(this.vm.scene, this.vm.camera);
    this.vmPass.clear = false; this.vmPass.clearDepth = true;
    this.composer.addPass(this.vmPass);
    if (this.settings.quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.45, 0.88);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());

    this.keys = {}; this.mouse = { left: false, right: false }; this.pressed = {};
    this.wantSlot = 'sidearm';
    this.mdx = 0; this.mdy = 0; this.skipMouse = 0;
    this.yaw = 0; this.pitch = 0;
    this.adsT = 0; this.shake = 0; this.stepAcc = 0; this.camBack = 3; this.dmgAngle = 0;
    this.sendAcc = 0; this.rsAcc = 0; this.takeCd = 0; this.reqCd = 0; this.beepT = 0;
    this.specId = null; this.over = false; this.ended = false; this.paused = false; this.buyOpen = false;
    this.losCache = new Map(); this.losT = 0;
    this._bindInput();
    this._bindNet();

    const modeLabel = this.isRange ? 'PRACTICE' : this.useSpike ? 'SPIKE' : 'ELIMINATION';
    this.hud.setup({ roundsToWin: this.isRange ? 0 : this.roundsToWin, mapName: this.map.name, char: this.me.char, modeLabel });
    this.buy.onBuy = item => this._req('buy', { item });
    this.buy.onClose = () => { this.buyOpen = false; if (!this.over) this.pointer.request(); };

    this._placeAtSpawns();
    if (!this.isRange) this._setBarriers(true);
    if (this.isRange) {
      this.rs.phase = 'live'; this.rs.n = 1; this.rs.t = Infinity; this.seenPhase = 'live';
      for (const E of this.ents.values()) if (E.local) { E.sim.frozen = false; E.sim.holdFire = false; E.sim.ult = 99; }
      this.hud.banner('PRACTICE RANGE', 'B: any gun for free · Q/E/X abilities', '#ffd166', 3);
    }
    this._warmShaders();
    if (this.net && !this.isHost) this.net.sendTo('h', { type: 'loaded' });
  }

  // Compile every material an ability/effect can create now (during loading) instead of mid-fight.
  _warmShaders() {
    const warm = new THREE.Group();
    warm.position.set(0, -400, 0);
    const add = mat => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat); m.frustumCulled = false; warm.add(m); };
    add(new THREE.MeshStandardMaterial({ color: 0x4a3a66, roughness: 1, transparent: true, opacity: 0.5, depthWrite: false }));
    add(new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x3aa8e0, emissiveIntensity: 0.4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.82 }));
    add(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    add(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    add(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    add(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    add(new THREE.MeshStandardMaterial({ color: 0x22252b, metalness: 0.8, roughness: 0.3 }));
    add(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3b5c, emissiveIntensity: 3 }));
    for (const id of ['smg', 'ar', 'sniper']) warm.add(buildGun(id, 0xffd166));
    warm.traverse(o => { o.frustumCulled = false; });
    this.scene.add(warm);
    try { this.renderer.compile(this.scene, this.camera); this.renderer.compile(this.vm.scene, this.vm.camera); } catch (_) {}
    this.scene.remove(warm);
  }

  // ------------------------------------------------------------ entities
  _makeEnt(r) {
    const char = charById(r.char);
    const local = r.id === this.myId || (r.isBot && this.isHost);
    const E = { id: r.id, name: r.name, tag: r.tag || '', team: r.team, char, isBot: !!r.isBot, owner: r.isBot ? 'h' : r.id, local, alive: true, connected: true, kills: 0, deaths: 0, skins: r.skins || {}, dummy: r.dummy };
    if (local) { E.sim = new Player(char, this.world); E.sim.skins = E.skins; E.sim.inv.sidearm.skin = E.skins.classic || 'default'; }
    else E.remote = new RemotePlayer(char);
    E.st = E.sim || E.remote;
    E.model = new CharacterModel(char);
    this.scene.add(E.model.root);
    if (r.isBot && this.isHost) {
      if (r.dummy) {
        E.bot = new Dummy(E.sim, r.dummy.kind);
        E.post = r.dummy.pos;
      } else {
        E.bot = new Bot(E.sim, this.world, this.difficulty, {
          enemies: () => this._alive().filter(o => o.team !== E.team).map(o => o.st),
          pickups: this.pickups,
          drops: () => [...this.drops.values()],
          wantsDrop: id => this._req('take', { drop: id }, E.id),
          clear: (a, b) => this._clear(a, b),
          objective: () => this._objective(E),
          canRevive: () => this.deathOrder.some(id => { const D = this.ents.get(id); return D && D.team === E.team && !D.alive && D.connected; })
        });
      }
    }
    this.ents.set(E.id, E);
  }

  // Alive players, cached until someone dies/revives/leaves or a round starts (hot path: every pellet, bot, HUD frame)
  _alive() {
    if (!this.aliveCache) this.aliveCache = [...this.ents.values()].filter(E => E.alive && E.connected);
    return this.aliveCache;
  }
  _team(t) { return [...this.ents.values()].filter(E => E.team === t); }
  get attackTeam() { return this.side[0] === 0 ? 0 : 1; }
  _isAttacker(E) { return this.side[E.team] === 0; }

  _spawnFor(E) {
    if (E.post) return E.post;
    const mates = this._team(E.team).filter(x => !x.dummy);
    const i = Math.max(0, mates.indexOf(E));
    const list = this.map.teamSpawns[this.side[E.team]];
    return list[i % list.length];
  }

  _faceYaw(s) {
    // Face the middle of the map (dummies face the firing line)
    if (this.isRange) return s[0] > -30 ? Math.PI / 2 : -Math.PI / 2;
    return Math.atan2(s[0], s[2]);
  }

  _placeAtSpawns() {
    for (const E of this.ents.values()) {
      const s = this._spawnFor(E);
      const yaw = this._faceYaw(s);
      if (E.sim) { E.sim.reset(s, false); E.sim.yaw = yaw; this._buyLock(E); if (E.bot) { E.bot.yaw = yaw; E.bot.reset(); } }
      else { E.remote.pos.x = s[0]; E.remote.pos.y = s[1]; E.remote.pos.z = s[2]; E.remote.yaw = yaw; }
      if (E === this.me) { this.yaw = yaw; this.pitch = 0; }
    }
  }

  _buyLock(E) { E.sim.frozen = !!E.bot; E.sim.holdFire = true; }

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
    for (const [w, h] of [[0.3, 0.1], [0.1, 0.3]]) for (const s of [1, -1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), cm); c.position.z = 0.215 * s; item.add(c);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, h, w), cm); c2.position.x = 0.215 * s; item.add(c2);
    }
    const light = new THREE.PointLight(0x39ff8a, 6, 4, 2); light.position.y = 0.8; g.add(light);
    this.scene.add(g);
    return { i, pos: p, group: g, item, light, active: true };
  }

  _buildSites() {
    for (const s of this.map.sites) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3d5a, transparent: true, opacity: 0.55 });
      const w = s.maxX - s.minX, d = s.maxZ - s.minZ, y = s.y + 0.03;
      for (const [x, z, sx, sz] of [[s.cx, s.minZ, w, 0.15], [s.cx, s.maxZ, w, 0.15], [s.minX, s.cz, 0.15, d], [s.maxX, s.cz, 0.15, d]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.04, sz), mat); m.position.set(x, y, z); g.add(m);
      }
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d'); x.fillStyle = 'rgba(255,61,90,0.85)'; x.font = 'bold 200px Bahnschrift, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s.name, 128, 140);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const letter = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
      letter.rotation.x = -Math.PI / 2; letter.position.set(s.cx, y + 0.01, s.cz); g.add(letter);
      this.scene.add(g);
    }
  }

  // ------------------------------------------------------------ input
  _bindInput() {
    const canvas = this.renderer.domElement;
    this.h = {
      kd: e => {
        if (e.repeat) return;
        if (this.buyOpen && (e.code === 'KeyB' || e.code === 'Escape')) { e.preventDefault(); this.buy.close(); return; }
        this.keys[e.code] = true; this.pressed[e.code] = true;
        if (e.code === 'Digit1') this._selectSlot('primary');
        if (e.code === 'Digit2') this._selectSlot('sidearm');
        if (e.code === 'KeyB') this._toggleBuy();
        if (e.code === 'KeyY' && this.me.alive && !this.buyOpen) this._bcast({ type: 'anim', id: this.me.id, ab: 'inspect' });
        if (e.code === 'KeyV') { this.settings.camera = this.settings.camera === 'third' ? 'first' : 'third'; this.onSettingsChange?.(); }
        if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
      },
      ku: e => { this.keys[e.code] = false; },
      md: e => {
        if (!this.pointer.locked) { if (!this.over && !this.buyOpen) this.pointer.request(); return; }
        if (e.button === 0) { this.mouse.left = true; if (!this.me.alive) this._cycleSpectate(); }
        if (e.button === 2) this.mouse.right = true;
      },
      mu: e => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; },
      mm: e => {
        if (!this.pointer.locked) return;
        if (this.skipMouse > 0) { this.skipMouse--; return; }
        if (Math.abs(e.movementX) > 500 || Math.abs(e.movementY) > 500) return;
        this.mdx += e.movementX; this.mdy += e.movementY;
      },
      wheel: () => { if (this.pointer.locked) this._selectSlot(this.wantSlot === 'primary' ? 'sidearm' : 'primary'); },
      ctx: e => e.preventDefault(),
      blur: () => { this.keys = {}; this.mouse.left = this.mouse.right = false; }
    };
    this.unLock = this.pointer.onChange(locked => {
      this.skipMouse = 1;
      if (!locked) {
        this.mouse.left = this.mouse.right = false; this.keys = {};
        if (!this.over && !this.buyOpen) this.onPauseRequest?.();
      }
    });
    addEventListener('keydown', this.h.kd);
    addEventListener('keyup', this.h.ku);
    canvas.addEventListener('mousedown', this.h.md);
    addEventListener('mouseup', this.h.mu);
    addEventListener('mousemove', this.h.mm);
    addEventListener('wheel', this.h.wheel, { passive: true });
    canvas.addEventListener('contextmenu', this.h.ctx);
    addEventListener('blur', this.h.blur);
  }

  _selectSlot(s) { if (this.me.sim.inv[s] && s !== this.wantSlot) this.wantSlot = s; }

  _toggleBuy() {
    if (this.buyOpen) { this.buy.close(); return; }
    if (!this.isRange && (this.rs.phase !== 'buy' || !this.me.alive)) { if (this.rs.phase === 'live') this.hud.banner('', 'You can only buy during the buy phase', '#fff', 1.2); return; }
    this.buyOpen = true;
    this.buy.open();
    this.pointer.release();
  }

  lockPointer() { this.pointer.request(); }

  // ------------------------------------------------------------ messaging
  _bindNet() {
    this.H = {
      S: m => { for (const s of m.list) { const E = this.ents.get(s.id); if (E && E.remote) E.remote.push(s); } },
      rstart: m => this._onRoundStart(m),
      rs: m => this._onRoundState(m),
      die: m => this._onDie(m),
      hit: m => { const E = this.ents.get(m.target); if (E && E.local) this._applyDamage(E, m.dmg, m.head, m.by, m.w, m.src); },
      heal: m => { const E = this.ents.get(m.target); if (E && E.local && E.alive) { E.sim.heal(m.n); if (E === this.me) sfx.ability('heal'); } },
      shot: m => this._onRemoteShot(m),
      ev: m => this._onWall(m),
      fx: m => this._onFx(m),
      aoe: m => this._onAoe(m),
      zone: m => this._onZone(m),
      mine: m => this._onMine(m),
      mineGone: m => { const mi = this.mines.get(m.mid); if (mi) { this.scene.remove(mi.mesh); this.mines.delete(m.mid); } },
      revive: m => this._onRevive(m),
      anim: m => {
        const E = this.ents.get(m.id);
        if (!E) return;
        const kind = m.ab === 'inspect' ? 'inspect' : ABILITY_ANIM[m.ab];
        E.model.play(kind);
        if (E === this.me) { this.vm.play(kind); if (kind === 'dash' || kind === 'blink') this.fovKick = 1; }
      },
      sp: m => this._onSpike(m),
      pk: m => { const p = this.pickups[m.i]; if (p) p.active = false; },
      drop: m => this._onDrop(m),
      taken: m => this._onTaken(m),
      bought: m => this._onBought(m),
      left: m => this._onLeft(m.id),
      over: m => this._onOver(m),
      // requests the host decides
      buy: (m, from) => this.isHost && this._host('buy', m, from),
      take: (m, from) => this.isHost && this._host('take', m, from),
      dropReq: (m, from) => this.isHost && this._host('dropReq', m, from),
      spTake: (m, from) => this.isHost && this._host('spTake', m, from),
      plant: (m, from) => this.isHost && this._host('plant', m, from),
      defuse: (m, from) => this.isHost && this._host('defuse', m, from),
      reviveReq: (m, from) => this.isHost && this._host('reviveReq', m, from),
      loaded: (m, from) => this.isHost && this.loaded.add(from)
    };
    // A bad message from someone else must never take this game down
    if (this.net) for (const t of Object.keys(this.H)) this.net.on(t, (m, from) => { try { this.H[t](m, from); } catch (err) { console.error('net message failed', t, err); } });
  }

  _bcast(msg) { this.net?.send(msg); this.H[msg.type](msg, this.myId); }
  _sendToOwner(E, msg) {
    if (E.owner === this.myId) this.H[msg.type](msg, this.myId);
    else this.net?.sendTo(E.owner, msg);
  }
  _req(type, data, fromId = this.myId) {
    if (this.isHost) this._host(type, data, fromId);
    else this.net.sendTo('h', { type, ...data });
  }

  // ------------------------------------------------------------ host logic
  _host(type, m, from) {
    const E = this.ents.get(from);
    const sp = this.spike;
    if (type === 'buy') this._hostBuy(E, m.item);
    else if (type === 'take') {
      const d = this.drops.get(m.drop);
      if (d && E && E.alive && this.rs.phase !== 'end') this._bcast({ type: 'taken', drop: d.id, by: E.id });
    } else if (type === 'dropReq') this._hostDrop(m.wid, m.ammo, m.pos, m.skin);
    else if (type === 'spTake') {
      if (sp.state === 'dropped' && E && E.alive && this._isAttacker(E)) this._bcast({ type: 'sp', state: 'carried', holder: E.id });
    } else if (type === 'plant') {
      if (sp.state === 'carried' && sp.holder === from && E && E.alive && this.rs.phase === 'live' && this._siteAt(m.pos)) {
        this._bcast({ type: 'sp', state: 'planted', pos: m.pos.map(r3), site: this._siteAt(m.pos).name, t: SPIKE.fuse, by: from });
        for (const A of this.ents.values()) if (this._isAttacker(A)) this.credits[A.id] = Math.min(ECON.max, this.credits[A.id] + ECON.plant);
        this._bcastRS();
      }
    } else if (type === 'defuse') {
      if (sp.state === 'planted' && E && E.alive && !this._isAttacker(E) && this.rs.phase === 'live') {
        this._bcast({ type: 'sp', state: 'defused', by: from });
        this._hostEndRound(E.team);
      }
    } else if (type === 'reviveReq') {
      if (!E || !E.alive) return;
      const id = [...this.deathOrder].reverse().find(i => { const D = this.ents.get(i); return D && D.team === E.team && !D.alive && D.connected; });
      if (id) this._bcast({ type: 'revive', target: id, pos: [r3(E.st.pos.x), r3(E.st.pos.y), r3(E.st.pos.z)], by: E.id });
    }
  }

  _hostBuy(E, item) {
    if (!E || !E.alive || (!this.isRange && this.rs.phase !== 'buy')) return;
    const w = weaponById(item), sh = SHIELDS.find(s => s.id === item);
    if (!sh && w.id !== item) return;
    const price = this.isRange ? 0 : sh ? sh.price : w.price;
    if (this.credits[E.id] < price) return;
    this.credits[E.id] -= price;
    this._sendToOwner(E, { type: 'bought', id: E.id, item });
    this._bcastRS();
  }

  _hostDrop(wid, ammo, pos, skin) {
    const g = this.world.groundBelow(pos[0], pos[2], 0.1, pos[1] + 1, 30);
    this._bcast({ type: 'drop', id: this.dropSeq++, wid, ammo, skin: skin || 'default', pos: [r3(pos[0]), r3(g > -Infinity ? g : pos[1]), r3(pos[2])] });
  }

  _bcastRS() {
    const rs = this.rs;
    this._bcast({ type: 'rs', phase: rs.phase, t: rs.t, n: rs.n, score: rs.score, winner: rs.winner, credits: this.credits, kd: this._kd(), spT: this.spike.t });
  }
  _kd() { const o = {}; for (const E of this.ents.values()) o[E.id] = [E.kills, E.deaths]; return o; }

  _hostTick(dt) {
    const rs = this.rs;
    if (this.isRange) { this._rangeTick(dt); return; }
    if (rs.phase === 'wait') {
      this.waitT += dt;
      const need = this.net ? this.net.guestIds.length + 1 : 1;
      if (this.loaded.size >= need || this.waitT > 12) this._hostStartRound();
      return;
    }
    if (rs.phase === 'over') return;
    this.rsAcc += dt;
    if (rs.phase === 'buy') {
      if (!this.botsBought && rs.t < (rs.n === 1 ? ROUND.firstBuy : ROUND.buy) - 1.5) { this.botsBought = true; this._botsShop(); }
      if (rs.t <= 0) { rs.phase = 'live'; rs.t = ROUND.live; this._bcastRS(); }
    } else if (rs.phase === 'live') {
      if (this.spike.state === 'planted') {
        if (this.spike.t <= 0) { this._bcast({ type: 'sp', state: 'exploded' }); this._hostEndRound(this.attackTeam); }
      } else if (rs.t <= 0) this._hostEndRound(this.useSpike ? 1 - this.attackTeam : this._timeoutWinner());
    } else if (rs.phase === 'end') {
      if (rs.t <= 0) {
        if (rs.matchWinner !== null) { rs.phase = 'over'; this._bcast({ type: 'over', winner: rs.matchWinner, score: rs.score }); }
        else this._hostStartRound();
      }
    }
    if (this.rsAcc > 1) { this.rsAcc = 0; this._bcastRS(); }
  }

  _rangeTick(dt) {
    for (const E of this.ents.values()) {
      if (E.alive || !E.connected) continue;
      E.respawnT = (E.respawnT ?? 1.5) - dt;
      if (E.respawnT > 0) continue;
      E.respawnT = undefined;
      const s = this._spawnFor(E);
      this._bcast({ type: 'revive', target: E.id, pos: s, keep: true });
    }
  }

  _botsShop() {
    for (const E of this.ents.values()) {
      if (!E.bot || E.dummy || !E.alive) continue;
      for (const item of botShopping(this.credits[E.id], E.sim)) this._hostBuy(E, item);
    }
  }

  _hostStartRound() {
    const rs = this.rs;
    rs.n++;
    let swap = false;
    if (this.useSpike && rs.n === this.half + 1) {
      swap = true;
      this.side = [this.side[1], this.side[0]];
      for (const E of this.ents.values()) this.credits[E.id] = ECON.start;
      this.lossStreak = [0, 0];
    }
    rs.phase = 'buy';
    rs.t = rs.n === 1 || swap ? ROUND.firstBuy : ROUND.buy;
    rs.winner = null;
    const spawns = {}, keep = {};
    for (const E of this.ents.values()) { spawns[E.id] = this._spawnFor(E); keep[E.id] = !swap && rs.n > 1 && E.alive && E.connected; }
    let holder = null;
    if (this.useSpike) {
      const atk = [...this.ents.values()].filter(E => E.connected && this.side[E.team] === 0);
      if (atk.length) holder = atk[Math.floor(Math.random() * atk.length)].id;
    }
    this.targetSite = Math.random() < 0.5 ? 0 : 1;
    this.botsBought = false;
    this._bcast({ type: 'rstart', n: rs.n, t: rs.t, spawns, keep, score: rs.score, credits: this.credits, sides: this.side, holder, swap, target: this.targetSite });
  }

  _timeoutWinner() {
    const alive = [0, 0], hp = [0, 0];
    for (const E of this._alive()) { alive[E.team]++; hp[E.team] += E.st.hp + (E.st.shield || 0); }
    if (alive[0] !== alive[1]) return alive[0] > alive[1] ? 0 : 1;
    if (Math.abs(hp[0] - hp[1]) > 0.5) return hp[0] > hp[1] ? 0 : 1;
    return -1;
  }

  _hostCheckElimination() {
    if (this.rs.phase !== 'live' || this.isRange) return;
    const alive = [0, 0];
    for (const E of this._alive()) alive[E.team]++;
    if (this.useSpike) {
      const atk = this.attackTeam, def = 1 - atk;
      if (this.spike.state === 'planted') { if (alive[def] === 0) this._hostEndRound(atk); }
      else if (alive[atk] === 0) this._hostEndRound(def);
      else if (alive[def] === 0) this._hostEndRound(atk);
      return;
    }
    if (alive[0] === 0 && alive[1] === 0) this._hostEndRound(-1);
    else if (alive[0] === 0) this._hostEndRound(1);
    else if (alive[1] === 0) this._hostEndRound(0);
  }

  _hostEndRound(winner) {
    const rs = this.rs;
    if (rs.phase !== 'live') return;
    rs.phase = 'end'; rs.t = ROUND.end; rs.winner = winner;
    if (winner >= 0) rs.score[winner]++;
    const lossPay = [0, 1].map(t => Math.min(ECON.lossMax, ECON.loss + ECON.lossStep * this.lossStreak[t]));
    for (const E of this.ents.values()) {
      const pay = winner < 0 ? ECON.loss : E.team === winner ? ECON.win : lossPay[E.team];
      this.credits[E.id] = Math.min(ECON.max, this.credits[E.id] + pay);
    }
    if (winner >= 0) { this.lossStreak[winner] = 0; this.lossStreak[1 - winner]++; }
    if (winner >= 0 && rs.score[winner] >= this.roundsToWin) rs.matchWinner = winner;
    this._bcastRS();
  }

  // ------------------------------------------------------------ round events
  _onRoundStart(m) {
    this.rs.n = m.n; this.rs.phase = 'buy'; this.seenPhase = 'buy'; this.rs.t = m.t; this.rs.score = m.score; this.rs.winner = null;
    Object.assign(this.credits, m.credits);
    if (m.sides) this.side = m.sides;
    this.targetSite = m.target;
    for (const d of this.drops.values()) { this.scene.remove(d.group); disposeMerged(d.group); }
    this.drops.clear();
    for (const w of this.walls) this._removeWall(w);
    this.walls = [];
    for (const z of this.zones) this._removeZone(z);
    this.zones = [];
    for (const mi of this.mines.values()) this.scene.remove(mi.mesh);
    this.mines.clear();
    for (const p of this.pickups) p.active = true;
    this.revealT = 0; this.deathOrder = []; this.chan.clear();
    this.spike = { state: m.holder ? 'carried' : 'none', holder: m.holder, pos: null, site: null, t: 0 };
    this.aliveCache = null;
    for (const E of this.ents.values()) {
      if (!E.connected) { E.alive = false; continue; }
      E.alive = true;
      this.aliveCache = null;
      const s = m.spawns[E.id];
      const yaw = this._faceYaw(s);
      if (E.local) {
        E.sim.reset(s, !!m.keep[E.id]);
        E.sim.yaw = yaw; this._buyLock(E);
        E.sim.ult = Math.min(E.sim.ultCost, E.sim.ult + (m.n > 1 ? 1 : 0));
        if (E.bot) { E.bot.reset(); E.bot.yaw = yaw; }
      } else {
        E.remote.deadOverride = false;
        E.remote.snaps.length = 0;
        E.remote.pos.x = s[0]; E.remote.pos.y = s[1]; E.remote.pos.z = s[2]; E.remote.yaw = yaw; E.remote.dead = false;
      }
      if (E === this.me) { this.yaw = yaw; this.pitch = 0; this.specId = null; this.wantSlot = E.sim.slot; }
    }
    this._setBarriers(false);
    this._setBarriers(true);
    if (m.swap) this.hud.banner('SWITCHING SIDES', 'Halftime · credits reset', '#ffd166', 3);
    else {
      const role = this.useSpike ? (this._isAttacker(this.me) ? 'ATTACK · plant the spike' : 'DEFEND · stop the plant') : 'Buy phase · press B to buy';
      this.hud.banner(`ROUND ${m.n}`, role, '#ffd166', 2.5);
    }
  }

  _onRoundState(m) {
    const rs = this.rs;
    const prev = this.seenPhase;
    this.seenPhase = m.phase;
    rs.phase = m.phase; rs.t = m.t; rs.n = m.n; rs.score = m.score; rs.winner = m.winner;
    if (this.spike.state === 'planted' && m.spT !== undefined) this.spike.t = m.spT;
    Object.assign(this.credits, m.credits);
    if (m.kd) for (const id in m.kd) { const E = this.ents.get(id); if (E) { E.kills = m.kd[id][0]; E.deaths = m.kd[id][1]; } }
    if (prev === 'buy' && m.phase === 'live') {
      for (const E of this.ents.values()) if (E.local) { E.sim.frozen = false; E.sim.holdFire = false; }
      this._setBarriers(false);
      if (this.buyOpen) this.buy.close();
      this.hud.banner('FIGHT', '', '#ffffff', 1.2);
      sfx.ability('dash');
    }
    if (prev === 'live' && m.phase === 'end') {
      const won = m.winner === this.myTeam, draw = m.winner === -1;
      this.hud.banner(draw ? 'DRAW' : won ? 'ROUND WON' : 'ROUND LOST', `${m.score[this.myTeam]} — ${m.score[1 - this.myTeam]}`, draw ? '#ffffff' : won ? '#3dff9a' : '#ff4a4a', 3);
      (won ? sfx.win : sfx.lose)();
      this.roundsWon = m.score[this.myTeam];
    }
  }

  _onOver(m) {
    if (this.over) return;
    this.over = true;
    this.rs.phase = 'over';
    const win = m.winner === this.myTeam;
    this.hud.banner(win ? 'VICTORY' : 'DEFEAT', `${m.score[this.myTeam]} — ${m.score[1 - this.myTeam]}`, win ? '#3dff9a' : '#ff4a4a', 4);
    if (this.buyOpen) this.buy.close();
    setTimeout(() => this._finish(win, m.score), 3500);
  }

  _finish(win, score) {
    if (this.ended) return;
    this.ended = true;
    this.pointer.release();
    const s = this.me.sim;
    this.onEnd?.({
      win, myScore: score[this.myTeam], enemyScore: score[1 - this.myTeam],
      kills: this.me.kills, deaths: this.me.deaths,
      accuracy: s.shots ? Math.round(s.hits / s.shots * 100) : 0, headshots: s.headshots,
      players: [...this.ents.values()].map(E => ({ name: E.name, team: E.team, kills: E.kills, deaths: E.deaths, char: E.char.id, me: E === this.me }))
    });
  }

  _onLeft(id) {
    const E = this.ents.get(id);
    if (!E) return;
    E.connected = false;
    E.alive = false; this.aliveCache = null;
    E.model.root.visible = false;
    this.hud.feed(`<b style="color:${TEAM_COLORS[E.team === this.myTeam ? 0 : 1]}">${esc(E.name)}</b> <span class="fk">left the match</span>`);
    if (this.isHost) {
      if (this.spike.holder === id && this.spike.state === 'carried') this._bcast({ type: 'sp', state: 'dropped', pos: [r3(E.st.pos.x), r3(E.st.pos.y), r3(E.st.pos.z)] });
      this._hostCheckElimination();
    }
  }

  playerLeft(id) { if (this.ents.has(id)) this._bcast({ type: 'left', id }); }

  // ------------------------------------------------------------ spike
  _siteAt(p) {
    const x = p[0] ?? p.x, y = p[1] ?? p.y, z = p[2] ?? p.z;
    return this.map.sites.find(s => x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && y >= s.y - 0.5 && y <= s.y + 4.5) || null;
  }

  _onSpike(m) {
    const sp = this.spike;
    const prevState = sp.state;
    sp.state = m.state;
    if (m.state === 'carried') { sp.holder = m.holder; sp.pos = null; if (this.ents.get(m.holder) === this.me) this.hud.banner('', 'You picked up the spike', '#ff3d5a', 1.5); }
    if (m.state === 'dropped') { sp.holder = null; sp.pos = m.pos; if (this._isAttacker(this.me)) this.hud.feed('<span class="fk">◆ Spike dropped</span>'); }
    if (m.state === 'planted') {
      sp.holder = null; sp.pos = m.pos; sp.site = m.site; sp.t = m.t;
      sfx.planted();
      this.hud.banner('SPIKE PLANTED', `Site ${m.site}`, '#ff3d5a', 2.5);
      const E = this.ents.get(m.by);
      if (E && E.local) E.sim.ult = Math.min(E.sim.ultCost, E.sim.ult + 1);
    }
    if (m.state === 'defused') {
      sfx.defused();
      this.hud.banner('SPIKE DEFUSED', '', '#3dd6ff', 2.5);
      const E = this.ents.get(m.by);
      if (E && E.local) E.sim.ult = Math.min(E.sim.ultCost, E.sim.ult + 1);
    }
    if (m.state === 'exploded' && prevState === 'planted') {
      const at = V(sp.pos);
      this.fx.explosion(at.clone().setY(at.y + 1), 0xff5a3a, SPIKE.radius);
      this.shake = 1;
      sfx.explode(this.camera.position.distanceTo(at));
      for (const E of this.ents.values()) {
        if (!E.local || !E.alive) continue;
        if (Math.hypot(E.sim.pos.x - at.x, E.sim.pos.z - at.z) <= SPIKE.radius) { E.sim.hp = 0; this._announceDeath(E, null, false, 'spike', 'spike'); }
      }
    }
  }

  // Plant / defuse channel for a local player. `use` = holding F (or the bot's use flag).
  _channel(E, use, dt) {
    const sp = this.spike, s = E.sim;
    let kind = null;
    if (use && E.alive && this.rs.phase === 'live' && s.grounded) {
      if (sp.state === 'carried' && sp.holder === E.id && this._siteAt([s.pos.x, s.pos.y, s.pos.z])) kind = 'plant';
      else if (sp.state === 'planted' && !this._isAttacker(E) && Math.hypot(sp.pos[0] - s.pos.x, sp.pos[2] - s.pos.z) < 2.2 && Math.abs(sp.pos[1] - s.pos.y) < 1.5) kind = 'defuse';
    }
    const c = this.chan.get(E.id);
    if (!kind) { if (c) this.chan.delete(E.id); s.channeling = false; return null; }
    const cur = c && c.kind === kind ? c : { kind, t: 0, sent: false };
    if (!c && E === this.me) sfx.channel();
    cur.t += dt;
    this.chan.set(E.id, cur);
    s.channeling = true;
    const need = kind === 'plant' ? SPIKE.plant : SPIKE.defuse;
    if (cur.t >= need && !cur.sent) {
      cur.sent = true;
      if (kind === 'plant') this._req('plant', { pos: [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)] }, E.id);
      else this._req('defuse', {}, E.id);
    }
    return { label: kind === 'plant' ? 'PLANTING SPIKE' : 'DEFUSING', frac: Math.min(1, cur.t / need) };
  }

  _objective(E) {
    if (!this.useSpike || this.rs.phase !== 'live') return null;
    const sp = this.spike, sites = this.map.sites;
    if (this._isAttacker(E)) {
      if (sp.state === 'carried' && sp.holder === E.id) {
        const s = sites[this.targetSite ?? 0];
        const inside = this._siteAt([E.sim.pos.x, E.sim.pos.y, E.sim.pos.z]);
        return { x: s.cx, y: s.y, z: s.cz, use: !!inside, radius: 99 };
      }
      if (sp.state === 'dropped') return { x: sp.pos[0], y: sp.pos[1], z: sp.pos[2] };
      if (sp.state === 'planted') return { x: sp.pos[0] + 4, y: sp.pos[1], z: sp.pos[2] + 4 };
      const s = sites[this.targetSite ?? 0];
      return { x: s.cx, y: s.y, z: s.cz };
    }
    if (sp.state === 'planted') return { x: sp.pos[0], y: sp.pos[1], z: sp.pos[2], use: true, radius: 1.6 };
    const defs = [...this.ents.values()].filter(x => !this._isAttacker(x));
    const s = sites[Math.max(0, defs.indexOf(E)) % sites.length];
    return { x: s.cx, y: s.y, z: s.cz };
  }

  // ------------------------------------------------------------ death & damage
  _announceDeath(E, byId, head, wid, cause) {
    const s = E.sim;
    if (s.dead) return;
    const drop = this.isRange ? null : s.inv.primary || (s.inv.sidearm && s.inv.sidearm.id !== 'classic' ? s.inv.sidearm : null);
    s.dead = true; s.hp = 0; s.channeling = false;
    this._bcast({ type: 'die', id: E.id, by: byId, head, w: wid, cause, drop: drop ? { wid: drop.id, ammo: drop.ammo, skin: drop.skin } : null, pos: [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)] });
  }

  _onDie(m) {
    const E = this.ents.get(m.id);
    if (!E || !E.alive) return;
    E.alive = false; this.aliveCache = null;
    E.deaths++;
    this.deathOrder.push(E.id);
    if (E.sim) E.sim.dead = true;
    if (E.remote) E.remote.deadOverride = true;
    const K = this.ents.get(m.by);
    const enemyKill = K && K.team !== E.team;
    if (enemyKill) {
      K.kills++;
      if (this.isHost && !this.isRange) this.credits[K.id] = Math.min(ECON.max, this.credits[K.id] + ECON.kill);
      if (K.local) K.sim.ult = Math.min(K.sim.ultCost, K.sim.ult + 1);
    }
    this.fx.burst(new THREE.Vector3(m.pos[0], m.pos[1] + 1, m.pos[2]), E.char.color, 40, 5, 0.7, 6);
    const col = X => TEAM_COLORS[X.team === this.myTeam ? 0 : 1];
    const name = X => `<b style="color:${col(X)}">${esc(X.name)}</b>`;
    if (m.cause === 'fall') this.hud.feed(`${name(E)} <span class="fk">fell to their doom</span>`);
    else if (m.cause === 'spike') this.hud.feed(`<span class="fk">◆ Spike</span> ${name(E)}`);
    else if (K) this.hud.feed(`${name(K)} <span class="fk">${esc(killName(m.w))}${m.head ? ' ◎' : ''}</span> ${name(E)}`);

    if (E === this.me) {
      sfx.death();
      if (!this.isRange) this.hud.banner('ELIMINATED', m.cause === 'fall' ? 'You fell' : K ? `by ${K.name}` : '', '#ff4a4a', 2);
      if (this.buyOpen) this.buy.close();
      this.specT = 2.5;
    } else if (K === this.me && enemyKill) {
      sfx.kill();
      this.hud.hitmarker(m.head, true);
      if (!this.isRange) this.hud.banner(m.head ? 'HEADSHOT' : 'ELIMINATED', `${E.name} · +¤${ECON.kill}`, hexs(this.me.char.accent), 1.6);
    }
    if (this.isHost) {
      if (m.drop) this._hostDrop(m.drop.wid, m.drop.ammo, m.pos, m.drop.skin);
      if (this.spike.state === 'carried' && this.spike.holder === E.id) this._bcast({ type: 'sp', state: 'dropped', pos: m.pos });
      this._hostCheckElimination();
      if (!this.isRange) this._bcastRS();
    }
  }

  _onRevive(m) {
    const E = this.ents.get(m.target);
    if (!E || !E.connected) return;
    E.alive = true; this.aliveCache = null;
    this.deathOrder = this.deathOrder.filter(i => i !== E.id);
    if (E.local) {
      E.sim.reset(m.pos, !!m.keep);
      E.sim.dead = false;
      E.sim.frozen = false; E.sim.holdFire = false;
      if (E.dummy) E.sim.yaw = this._faceYaw(m.pos);
      if (E === this.me) { this.specId = null; this.wantSlot = E.sim.slot; }
    } else {
      E.remote.deadOverride = false; E.remote.snaps.length = 0; E.remote.dead = false;
      E.remote.pos.x = m.pos[0]; E.remote.pos.y = m.pos[1]; E.remote.pos.z = m.pos[2];
    }
    if (!this.isRange) {
      this.fx.ring(V(m.pos), 0x39ff8a, 3);
      this.fx.burst(V(m.pos).setY(m.pos[1] + 1), 0x39ff8a, 50, 3, 0.8, -3);
      this.hud.feed(`<b style="color:${TEAM_COLORS[E.team === this.myTeam ? 0 : 1]}">${esc(E.name)}</b> <span class="fk">was revived</span>`);
      sfx.ability('heal');
    }
  }

  _applyDamage(E, dmg, head, byId, wid, from) {
    if (!E.alive || this.rs.phase !== 'live') return;
    const s = E.sim;
    if (!s.takeDamage(dmg)) return;
    E.model.hit();
    if (E === this.me) {
      sfx.hurt();
      this.vm.flinch();
      this.shake = Math.min(1, this.shake + 0.4);
      const ang = Array.isArray(from) ? Math.atan2(-(from[0] - s.pos.x), -(from[2] - s.pos.z)) - this.yaw : 0;
      this.dmgAngle = -ang;
      this.hud.hurt();
    }
    if (s.hp <= 0) this._announceDeath(E, byId, head, wid, 'kill');
  }

  // Deal damage to T on behalf of shooter id `by` (routes to T's owner)
  _dealDamage(T, dmg, head, by, wid, from) {
    if (T.local) this._applyDamage(T, dmg, head, by, wid, from);
    else this._sendToOwner(T, { type: 'hit', target: T.id, dmg: Math.round(dmg * 10) / 10, head, by, w: wid, src: from });
  }

  // ------------------------------------------------------------ shooting
  _hitboxes(p) {
    const s = p.char.hitScale || 1;
    return {
      head: { x: p.pos.x, y: p.pos.y + p.h * 0.9, z: p.pos.z, r: 0.2 * s },
      body: { min: { x: p.pos.x - 0.33 * s, y: p.pos.y, z: p.pos.z - 0.33 * s }, max: { x: p.pos.x + 0.33 * s, y: p.pos.y + p.h * 0.8, z: p.pos.z + 0.33 * s } }
    };
  }

  _rayTarget(o, d, p, maxT) {
    const hb = this._hitboxes(p);
    let best = null;
    const ox = o.x - hb.head.x, oy = o.y - hb.head.y, oz = o.z - hb.head.z;
    const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - hb.head.r ** 2;
    const disc = b * b - c;
    if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < maxT) best = { t, head: true }; }
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

  // First thing an aim ray hits: { point, T (entity or null), head, normal }
  _trace(E, origin, d, maxD = 250) {
    const wh = this.world.raycast(origin.x, origin.y, origin.z, d.x, d.y, d.z, maxD);
    const t = wh ? wh.t : maxD;
    let hit = null;
    for (const T of this._alive()) {
      if (T === E || T.team === E.team) continue;
      const th = this._rayTarget(origin, d, T.st, hit ? hit.t : t);
      if (th) hit = { ...th, T };
    }
    const point = origin.clone().addScaledVector(d, hit ? hit.t : t);
    return { point, T: hit?.T || null, head: !!hit?.head, normal: wh ? new THREE.Vector3(wh.nx, wh.ny, wh.nz) : null, wall: !hit && !!wh };
  }

  _fire(E, ads) {
    const s = E.sim, w = s.w;
    const isMe = E === this.me;
    const fp = isMe && this._firstPerson();
    const eye = { x: s.pos.x, y: s.pos.y + s.h * 0.86, z: s.pos.z };
    let origin, baseDir;
    if (isMe) {
      this.camera.updateMatrixWorld();
      origin = this.camera.position.clone();
      baseDir = new THREE.Vector3(); this.camera.getWorldDirection(baseDir);
      const skip = Math.max(0, _v1.set(eye.x, eye.y, eye.z).sub(origin).dot(baseDir));
      origin.addScaledVector(baseDir, skip);
    } else {
      origin = new THREE.Vector3(eye.x, eye.y, eye.z);
      const a = s.aimDir(); baseDir = new THREE.Vector3(a.x, a.y, a.z);
    }
    E.model.root.updateMatrixWorld(true);
    const muzzle = fp ? this.vm.muzzleWorld(new THREE.Vector3()) : E.model.getMuzzle(new THREE.Vector3());
    const spread = s.spread(ads);
    const dmgBy = new Map();
    const ends = [];
    for (let i = 0; i < w.pellets; i++) {
      const d = baseDir.clone();
      if (spread > 0) {
        const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * spread;
        const u = _v2.set(0, 1, 0).cross(d).normalize();
        const v = _v3.crossVectors(d, u).normalize();
        d.addScaledVector(u, Math.cos(ang) * rad).addScaledVector(v, Math.sin(ang) * rad).normalize();
      }
      const tr = this._trace(E, origin, d);
      const end = tr.point;
      const ex = end.x - eye.x, ey = end.y - eye.y, ez = end.z - eye.z, el = Math.hypot(ex, ey, ez);
      const block = el > 0.01 ? this.world.raycast(eye.x, eye.y, eye.z, ex / el, ey / el, ez / el, el - 0.02) : null;
      let normal = tr.normal, T = tr.T;
      if (block) { end.set(eye.x + ex / el * block.t, eye.y + ey / el * block.t, eye.z + ez / el * block.t); normal = new THREE.Vector3(block.nx, block.ny, block.nz); T = null; }
      if (T) {
        const dist = Math.hypot(end.x - eye.x, end.z - eye.z);
        const [f0, f1, fm] = w.falloff;
        const fall = dist <= f0 ? 1 : dist >= f1 ? fm : 1 - (1 - fm) * (dist - f0) / (f1 - f0);
        const prev = dmgBy.get(T) || { dmg: 0, head: false };
        prev.dmg += w.dmg * fall * (tr.head ? w.head : 1);
        prev.head = prev.head || tr.head;
        dmgBy.set(T, prev);
        this.fx.burst(end, T.st.invulnerable ? T.char.accent : T.char.color, 10, 4, 0.35, 8, 0.8, d.clone().multiplyScalar(-1));
      } else if (normal) this.fx.impact(end, normal);
      ends.push(end);
      this.fx.tracer(muzzle, end, isMe ? 0xfff0c0 : 0xffc0a0, w.pellets > 1 ? 0.018 : 0.028);
    }
    this.fx.muzzle(muzzle, baseDir, (w.pellets > 1 ? 0.8 : w.scope ? 0.9 : 0.55) * (fp ? 0.45 : 1));
    E.model.kick(w.recoil * 6);
    if (isMe) {
      this.pitch = Math.min(1.35, this.pitch + w.recoil * (ads ? 0.5 : 1));
      this.yaw += (Math.random() - 0.5) * w.recoil * 0.4;
      this.vm.kick(w.recoil * 8);
      sfx.gun(w.id);
    } else this._spatialGun(s.pos, w.id);
    this.net?.send({ type: 'shot', id: E.id, w: w.id, e: ends.map(v => [r3(v.x), r3(v.y), r3(v.z)]) });

    for (const [T, h] of dmgBy) {
      s.hits++;
      if (h.head) s.headshots++;
      if (isMe) this._hitFeedback(T, h.dmg, h.head);
      T.model.hit();
      this._dealDamage(T, h.dmg, h.head, E.id, w.id, [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)]);
    }
  }

  _hitFeedback(T, dmg, head) {
    const blocked = T.st.invulnerable;
    const hb = this._hitboxes(T.st);
    const scr = this._project(hb.head.x, hb.head.y + 0.3, hb.head.z);
    if (scr && !blocked) this.hud.damageNumber(scr.x, scr.y, dmg, head);
    this.hud.hitmarker(head, !blocked && T.st.hp + (T.st.shield || 0) - dmg <= 0);
    sfx.hit(head);
  }

  _spatialGun(pos, wid) {
    const c = this.camera.position;
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const rel = Math.atan2(-dx, -dz) - this.yaw;
    sfx.gun(wid, Math.hypot(dx, dz), -Math.sin(rel) * 0.8);
  }

  _onRemoteShot(m) {
    const E = this.ents.get(m.id);
    if (!E || E.local) return;
    if (E.remote) E.remote.cloaked = false;
    E.model.root.updateMatrixWorld(true);
    const muzzle = E.model.getMuzzle(new THREE.Vector3());
    for (const p of m.e) {
      const end = new THREE.Vector3(p[0], p[1], p[2]);
      this.fx.tracer(muzzle, end, 0xffc0a0, m.w === 'shotgun' ? 0.018 : 0.028);
      this.fx.burst(end, 0xffc070, 4, 3, 0.25, 12);
    }
    const dir = new THREE.Vector3(m.e[0][0], m.e[0][1], m.e[0][2]).sub(muzzle).normalize();
    this.fx.muzzle(muzzle, dir, m.w === 'shotgun' ? 0.8 : 0.55);
    E.model.kick(weaponById(m.w).recoil * 6);
    this._spatialGun(E.st.pos, m.w);
  }

  // ------------------------------------------------------------ abilities
  _localEvents(E) {
    const s = E.sim;
    const isMe = E === this.me;
    const events = s.events.splice(0);
    for (const ev of events) {
      switch (ev.type) {
        case 'jump': if (isMe) sfx.jump(); break;
        case 'land': if (isMe) { sfx.land(); this.vm.land(); } break;
        case 'reload': if (isMe) sfx.reload(); break;
        case 'reloaded': if (isMe) sfx.reloaded(); break;
        case 'ab':
          try { this._resolveAbility(E, ev); } catch (err) { console.error('ability failed', ev.id, err); }
          break;
      }
    }
  }

  _aimPoint(ev, maxD) {
    const o = V(ev.eye), d = V(ev.aim).normalize();
    const hit = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, maxD);
    const p = o.clone().addScaledVector(d, hit ? Math.max(0, hit.t - 0.3) : maxD);
    const g = this.world.groundBelow(p.x, p.z, 0.1, p.y + 0.5, 40);
    if (g > -Infinity) p.y = g;
    return [r3(p.x), r3(p.y), r3(p.z)];
  }

  _resolveAbility(E, ev) {
    const s = E.sim, id = ev.id, by = E.id, team = E.team;
    this._bcast({ type: 'anim', id: by, ab: id });
    const pos = [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)];
    switch (id) {
      case 'dash': case 'shield': case 'overclock': case 'fortify': case 'cloak':
        this._bcast({ type: 'fx', k: id, id: by }); break;
      case 'blink': this._bcast({ type: 'fx', k: 'blink', id: by, a: ev.from, b: ev.to }); break;
      case 'wall': this._bcast({ type: 'ev', k: 'wall', id: by, x: r3(ev.x), y: r3(ev.y), z: r3(ev.z), alongX: ev.alongX }); break;
      case 'firebomb': this._bcast({ type: 'zone', kind: 'fire', pos: this._aimPoint(ev, 22), r: 3.5, dur: 4, dps: 28, team, by, ab: id }); break;
      case 'storm': this._bcast({ type: 'zone', kind: 'storm', pos: this._aimPoint(ev, 40), r: 6, dur: 5, dps: 22, slow: 0.35, team, by, ab: id }); break;
      case 'smoke': this._bcast({ type: 'zone', kind: 'smoke', pos: this._aimPoint(ev, 30), r: 4.5, dur: 10, team, by, ab: id }); break;
      case 'field': this._bcast({ type: 'zone', kind: 'heal', pos, r: 5, dur: 6, hps: 12, team, by, ab: id }); break;
      case 'rocket': {
        const tr = this._trace(E, V(ev.eye), V(ev.aim).normalize(), 120);
        this._bcast({ type: 'fx', k: 'rocket', id: by, a: [r3(ev.eye.x), r3(ev.eye.y), r3(ev.eye.z)], b: [r3(tr.point.x), r3(tr.point.y), r3(tr.point.z)] });
        this._bcast({ type: 'aoe', kind: 'blast', pos: [r3(tr.point.x), r3(tr.point.y), r3(tr.point.z)], r: 5, dmg: 130, team, by, ab: id });
        break;
      }
      case 'quake': this._bcast({ type: 'aoe', kind: 'quake', pos, r: 9, dmg: 55, slow: 0.5, slowT: 3, team, by, ab: id }); break;
      case 'nova': this._bcast({ type: 'aoe', kind: 'frost', pos, r: 7, dmg: 20, slow: 0.5, slowT: 3, team, by, ab: id }); break;
      case 'freeze': this._bcast({ type: 'aoe', kind: 'frost', pos, r: 15, dmg: 40, slow: 0.6, slowT: 4, team, by, ab: id }); break;
      case 'heal': this._bcast({ type: 'aoe', kind: 'heal', pos, r: 8, heal: PICKUP_HEAL, team, by, ab: id }); break;
      case 'chain': {
        const o = V(ev.eye), tr = this._trace(E, o, V(ev.aim).normalize(), 40);
        const pts = [[o.x, o.y - 0.2, o.z], [r3(tr.point.x), r3(tr.point.y), r3(tr.point.z)]];
        if (tr.T) {
          this._dealDamage(tr.T, 35, false, by, 'ab:chain', pos);
          if (E === this.me) this._hitFeedback(tr.T, 35, false);
          const tp = tr.T.st.pos;
          const next = this._alive().find(X => X.team !== team && X !== tr.T && Math.hypot(X.st.pos.x - tp.x, X.st.pos.z - tp.z) < 7 && this._clear({ x: tp.x, y: tp.y + 1.2, z: tp.z }, { x: X.st.pos.x, y: X.st.pos.y + 1.2, z: X.st.pos.z }));
          if (next) {
            this._dealDamage(next, 25, false, by, 'ab:chain', pos);
            if (E === this.me) this._hitFeedback(next, 25, false);
            pts.push([r3(next.st.pos.x), r3(next.st.pos.y + 1.2), r3(next.st.pos.z)]);
          }
        }
        this._bcast({ type: 'fx', k: 'chain', id: by, pts });
        break;
      }
      case 'revive': {
        const any = this.deathOrder.some(i => { const D = this.ents.get(i); return D && D.team === team && !D.alive && D.connected; });
        if (!any) { s.ult = s.ultCost; if (E === this.me) this.hud.banner('', 'No fallen teammate to revive', '#39ff8a', 1.5); break; }
        this._req('reviveReq', {}, by); this._bcast({ type: 'fx', k: 'revive', id: by }); break;
      }
      case 'pulse': this._bcast({ type: 'fx', k: 'reveal', id: by, team, t: 4 }); break;
      case 'overwatch': this._bcast({ type: 'fx', k: 'reveal', id: by, team, t: 10 }); break;
      case 'mine': this._bcast({ type: 'mine', mid: by + ':' + (this.mineSeq++), pos, team, by }); break;
    }
  }

  _onFx(m) {
    const E = this.ents.get(m.id);
    if (!E) return;
    const p = E.st.pos, color = E.char.accent;
    const at = new THREE.Vector3(p.x, p.y + 1, p.z), foot = new THREE.Vector3(p.x, p.y + 0.05, p.z);
    const near = this.camera.position.distanceTo(at) < 35;
    switch (m.k) {
      case 'dash': this.fx.burst(at, color, 25, 3, 0.4, 0); this.fx.ring(foot, color, 1.5); if (near) sfx.ability('dash'); break;
      case 'blink': if (m.a && m.b) this.fx.blink(m.a, m.b, color); if (E === this.me) this.camBack = 0.5; if (near) sfx.ability('blink'); break;
      case 'shield': case 'overclock': case 'fortify':
        this.fx.ring(foot, color); this.fx.burst(at, color, 30, 3, 0.5, -2); if (near) sfx.ability('shield'); break;
      case 'cloak': this.fx.burst(at, 0xb877ff, 40, 2, 0.8, -1); if (near) sfx.ability('blink'); break;
      case 'rocket': if (m.a && m.b) this.fx.tracer(V(m.a), V(m.b), 0xffa040, 0.12); break;
      case 'chain': this.fx.beam(m.pts.map(V), 0x7ff6ff); if (near) sfx.ability('zap'); break;
      case 'revive': this.fx.ring(foot, 0x39ff8a, 4); break;
      case 'reveal':
        this.fx.ring(foot, color, 30);
        if (m.team === this.myTeam) { this.revealT = Math.max(this.revealT, m.t); this.hud.banner('', 'Enemies revealed', hexs(color), 1.5); }
        if (near) sfx.ability('blink');
        break;
    }
  }

  _onAoe(m) {
    const c = V(m.pos);
    const col = { blast: 0xff8a3a, quake: 0xc8a070, frost: 0x9fe6ff, heal: 0x39ff8a }[m.kind] || 0xffffff;
    const dist = this.camera.position.distanceTo(c);
    if (m.kind === 'blast') { this.fx.explosion(c.clone().setY(c.y + 0.5), col, m.r); sfx.explode(dist); if (dist < 25) this.shake = Math.min(1, this.shake + 0.6); }
    else if (m.kind === 'quake') { this.fx.ring(c.clone().setY(c.y + 0.05), col, m.r * 1.6); this.fx.burst(c.clone().setY(c.y + 0.3), col, 60, 6, 0.8, 10); sfx.explode(dist); if (dist < m.r * 2) this.shake = 1; }
    else if (m.kind === 'frost') { this.fx.ring(c.clone().setY(c.y + 0.05), col, m.r * 1.4); this.fx.burst(c.clone().setY(c.y + 1), col, 70, m.r * 0.8, 0.9, 2); sfx.ability('frost'); }
    else if (m.kind === 'heal') { this.fx.ring(c.clone().setY(c.y + 0.05), col, m.r); sfx.ability('heal'); }
    for (const E of this.ents.values()) {
      if (!E.local || !E.alive) continue;
      const sp = E.sim.pos;
      const d = Math.hypot(sp.x - c.x, sp.z - c.z);
      if (d > m.r || Math.abs(sp.y - c.y) > m.r) continue;
      if (m.kind === 'heal') { if (E.team === m.team) { E.sim.heal(m.heal); this.fx.burst(new THREE.Vector3(sp.x, sp.y + 1, sp.z), col, 25, 2.5, 0.8, -3); } continue; }
      if (E.team === m.team) continue;
      if (!this.world.clear(c.x, c.y + 0.8, c.z, sp.x, sp.y + 1.2, sp.z)) continue;
      if (m.slow) E.sim.slow(m.slow, m.slowT);
      if (m.dmg) this._applyDamage(E, m.dmg * (1 - 0.5 * d / m.r), false, m.by, 'ab:' + m.ab, m.pos);
    }
  }

  _onZone(m) {
    const c = V(m.pos);
    const g = new THREE.Group();
    g.position.copy(c);
    if (m.kind === 'smoke') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x4a3a66, roughness: 1, transparent: true, opacity: 0.0, depthWrite: false });
      for (let i = 0; i < 9; i++) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(m.r * (0.55 + Math.random() * 0.35), 2), mat);
        b.position.set((Math.random() - 0.5) * m.r * 0.8, m.r * 0.5 + (Math.random() - 0.3) * m.r * 0.5, (Math.random() - 0.5) * m.r * 0.8);
        g.add(b);
      }
      const core = new THREE.Mesh(new THREE.SphereGeometry(m.r, 20, 14), mat);
      core.position.y = m.r * 0.55; g.add(core);
      g.userData.mat = mat;
      sfx.ability('blink');
    } else {
      const color = { fire: 0xff6a1a, storm: 0x5ff2ff, heal: 0x39ff8a }[m.kind];
      const disc = new THREE.Mesh(new THREE.CircleGeometry(m.r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.06; g.add(disc);
      const ring = new THREE.Mesh(new THREE.RingGeometry(m.r - 0.12, m.r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07; g.add(ring);
      if (m.kind === 'storm') {
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(m.r, m.r, 8, 32, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        cyl.position.y = 4; g.add(cyl);
      }
      g.userData.color = color;
      sfx.ability(m.kind === 'fire' ? 'fire' : m.kind === 'storm' ? 'zap' : 'heal');
    }
    this.scene.add(g);
    const light = m.kind === 'smoke' ? null : this.fx.holdLight(c.clone().setY(c.y + 1.2), g.userData.color, 25, m.r * 3);
    this.zones.push({ ...m, c, t: m.dur, group: g, tick: 0, light });
  }

  _removeZone(z) { this.fx.release(z.light); this.scene.remove(z.group); z.group.traverse(o => o.geometry?.dispose?.()); }

  _updateZones(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t -= dt;
      if (z.kind === 'smoke') {
        const k = Math.min(1, (z.dur - z.t) * 3) * Math.min(1, z.t * 1.5);
        z.group.userData.mat.opacity = 0.93 * k;
      } else {
        if (Math.random() < dt * 30) this.fx.burst(new THREE.Vector3(z.c.x + (Math.random() - 0.5) * z.r * 1.6, z.c.y + 0.2, z.c.z + (Math.random() - 0.5) * z.r * 1.6), z.group.userData.color, 2, 2, 0.6, z.kind === 'fire' ? -4 : -1);
        if (z.kind === 'storm' && Math.random() < dt * 4) this.fx.beam([new THREE.Vector3(z.c.x + (Math.random() - 0.5) * z.r, z.c.y + 8, z.c.z + (Math.random() - 0.5) * z.r), new THREE.Vector3(z.c.x + (Math.random() - 0.5) * z.r, z.c.y, z.c.z + (Math.random() - 0.5) * z.r)], 0x9ff8ff);
        // Effects on players this machine owns (applied in 0.25s ticks)
        z.tick += dt;
        if (z.tick >= 0.25) {
          const step = z.tick; z.tick = 0;
          for (const E of this.ents.values()) {
            if (!E.local || !E.alive) continue;
            const p = E.sim.pos;
            if (Math.hypot(p.x - z.c.x, p.z - z.c.z) > z.r || Math.abs(p.y - z.c.y) > 3) continue;
            if (z.kind === 'heal') { if (E.team === z.team) E.sim.heal(z.hps * step); continue; }
            if (E.team === z.team) continue;
            if (z.slow) E.sim.slow(z.slow, 0.5);
            this._applyDamage(E, z.dps * step, false, z.by, 'ab:' + z.ab, z.pos);
          }
        }
      }
      if (z.t <= 0) { this._removeZone(z); this.zones.splice(i, 1); }
    }
  }

  // Line of sight that also respects smoke clouds.
  _clear(a, b) {
    if (!this.world.clear(a.x, a.y, a.z, b.x, b.y, b.z)) return false;
    for (const z of this.zones) {
      if (z.kind !== 'smoke' || z.t < 0.3) continue;
      const cx = z.c.x, cy = z.c.y + z.r * 0.55, cz = z.c.z, r = z.r * 0.9;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const L = dx * dx + dy * dy + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy + (cz - a.z) * dz) / L));
      const px = a.x + dx * t - cx, py = a.y + dy * t - cy, pz = a.z + dz * t - cz;
      if (px * px + py * py + pz * pz < r * r) return false;
    }
    return true;
  }

  _onMine(m) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0x22252b, metalness: 0.8, roughness: 0.3 }));
    base.position.y = 0.06; g.add(base);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3b5c, emissiveIntensity: 3 }));
    eye.position.y = 0.15; g.add(eye);
    g.position.set(m.pos[0], m.pos[1], m.pos[2]);
    this.scene.add(g);
    // Only one mine per player
    for (const [k, mi] of this.mines) if (mi.by === m.by) { this.scene.remove(mi.mesh); this.mines.delete(k); }
    this.mines.set(m.mid, { ...m, mesh: g, armT: 1 });
  }

  _updateMines(dt) {
    for (const [mid, mi] of this.mines) {
      mi.armT -= dt;
      const owner = this.ents.get(mi.by);
      if (!owner || owner.owner !== this.myId || mi.armT > 0) continue;
      const trip = this._alive().find(X => X.team !== mi.team && Math.hypot(X.st.pos.x - mi.pos[0], X.st.pos.z - mi.pos[2]) < 2.5 && Math.abs(X.st.pos.y - mi.pos[1]) < 2);
      if (trip) {
        this._bcast({ type: 'mineGone', mid });
        this._bcast({ type: 'aoe', kind: 'blast', pos: mi.pos, r: 3.5, dmg: 70, team: mi.team, by: mi.by, ab: 'mine' });
      }
    }
  }

  _onWall(m) {
    if (m.k !== 'wall') return;
    const hw = 2.4, ht = 0.35, h = 3.2;
    const box = m.alongX
      ? { min: { x: m.x - hw, y: m.y, z: m.z - ht }, max: { x: m.x + hw, y: m.y + h, z: m.z + ht } }
      : { min: { x: m.x - ht, y: m.y, z: m.z - hw }, max: { x: m.x + ht, y: m.y + h, z: m.z + hw } };
    const geo = new THREE.BoxGeometry(box.max.x - box.min.x, h, box.max.z - box.min.z, 4, 3, 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + (Math.random() - 0.5) * 0.15);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x3aa8e0, emissiveIntensity: 0.4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.82 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((box.min.x + box.max.x) / 2, m.y + h / 2, (box.min.z + box.max.z) / 2);
    mesh.castShadow = true;
    mesh.scale.y = 0.05;
    this.scene.add(mesh);
    this.world.boxes.push(box);
    this.walls.push({ box, mesh, t: 8, grow: 0 });
    this.fx.burst(mesh.position, 0xbff0ff, 40, 4, 0.6, 6);
    sfx.ability('frost');
  }

  _removeWall(w) {
    const i = this.world.boxes.indexOf(w.box);
    if (i >= 0) this.world.boxes.splice(i, 1);
    this.scene.remove(w.mesh);
    w.mesh.geometry.dispose();
  }

  // ------------------------------------------------------------ buy-phase barriers
  _setBarriers(on) {
    if (on && !this.barriers && !this.isRange) {
      this.barriers = [];
      this.map.spawnZones.forEach((z, side) => {
        const team = this.side.indexOf(side);
        const color = new THREE.Color(TEAM_COLORS[team === this.myTeam ? 0 : 1]);
        const mat = new THREE.ShaderMaterial({
          uniforms: { uColor: { value: color }, uTime: { value: 0 }, uY: { value: z.y } },
          vertexShader: 'varying vec3 vP; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vP = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }',
          fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uY; varying vec3 vP;
            void main(){ float stripe = step(0.5, fract((vP.x + vP.z + vP.y) * 0.6 - uTime * 0.6));
              float edge = smoothstep(0.35, 0.0, vP.y - uY) + smoothstep(4.2, 4.8, vP.y - uY);
              float grid = step(0.94, fract(vP.y * 2.0)) * 0.5;
              gl_FragColor = vec4(uColor * 0.9, 0.035 + stripe * 0.045 + edge * 0.3 + grid * 0.1); }`,
          transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
        });
        const H = 5, T = 0.1, y0 = z.y;
        const walls = [
          { min: { x: z.minX - T, y: y0 - 1, z: z.minZ - T }, max: { x: z.maxX + T, y: y0 + H, z: z.minZ } },
          { min: { x: z.minX - T, y: y0 - 1, z: z.maxZ }, max: { x: z.maxX + T, y: y0 + H, z: z.maxZ + T } },
          { min: { x: z.minX - T, y: y0 - 1, z: z.minZ }, max: { x: z.minX, y: y0 + H, z: z.maxZ } },
          { min: { x: z.maxX, y: y0 - 1, z: z.minZ }, max: { x: z.maxX + T, y: y0 + H, z: z.maxZ } }
        ];
        for (const b of walls) {
          this.world.boxes.push(b);
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z), mat);
          mesh.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
          mesh.renderOrder = 5;
          this.scene.add(mesh);
          this.barriers.push({ box: b, mesh, mat });
        }
      });
    } else if (!on && this.barriers) {
      for (const b of this.barriers) {
        const i = this.world.boxes.indexOf(b.box);
        if (i >= 0) this.world.boxes.splice(i, 1);
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
      }
      this.barriers = null;
      this.losCache.clear();
    }
  }

  // ------------------------------------------------------------ dropped guns
  _onDrop(m) {
    const g = new THREE.Group();
    const gun = buildGun(m.wid, 0xffd166, m.skin || 'default');
    gun.rotation.z = Math.PI / 2;
    gun.scale.setScalar(1.3);
    g.add(gun);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.42, 32), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.33; g.add(ring);
    g.position.set(m.pos[0], m.pos[1] + 0.35, m.pos[2]);
    this.scene.add(g);
    this.drops.set(m.id, { id: m.id, wid: m.wid, ammo: m.ammo, skin: m.skin, pos: m.pos, group: g, gun });
  }

  _onTaken(m) {
    const d = this.drops.get(m.drop);
    if (!d) return;
    this.scene.remove(d.group); disposeMerged(d.group);
    this.drops.delete(m.drop);
    const E = this.ents.get(m.by);
    if (E && E.local) {
      const prev = E.sim.give(d.wid, d.ammo, d.skin);
      if (E === this.me) { this.wantSlot = E.sim.slot; sfx.reloaded(); }
      if (prev && prev.id !== 'classic') this._req('dropReq', { wid: prev.id, ammo: prev.ammo, skin: prev.skin, pos: this._dropPos(E.sim) }, E.id);
    }
  }

  _onBought(m) {
    const E = this.ents.get(m.id);
    if (!E || !E.local) return;
    const sh = SHIELDS.find(s => s.id === m.item);
    if (sh) E.sim.shield = Math.max(E.sim.shield, sh.amount);
    else {
      const prev = E.sim.give(m.item);
      if (prev && prev.id !== 'classic' && !this.isRange) this._req('dropReq', { wid: prev.id, ammo: prev.ammo, skin: prev.skin, pos: this._dropPos(E.sim) }, E.id);
    }
    if (E === this.me) { this.wantSlot = E.sim.slot; sfx.pickup(); }
  }

  _dropPos(s) {
    const f = s.forward();
    const hit = this.world.raycast(s.pos.x, s.pos.y + 0.5, s.pos.z, f.x, 0, f.z, 1.3);
    const d = hit ? Math.max(0, hit.t - 0.3) : 1.2;
    return [s.pos.x + f.x * d, s.pos.y + 0.5, s.pos.z + f.z * d];
  }

  _nearestDrop(p, maxD) {
    let best = null, bd = maxD;
    for (const d of this.drops.values()) {
      const dd = Math.hypot(d.pos[0] - p.x, d.pos[2] - p.z);
      if (dd < bd && Math.abs(d.pos[1] - p.y) < 1.5) { bd = dd; best = d; }
    }
    return best;
  }

  // ------------------------------------------------------------ main loop
  _firstPerson() { return this.settings.camera !== 'third' && this.me.alive; }

  update(dt) {
    const simDt = this.paused && !this.net ? 0 : dt;
    const rs = this.rs;
    if (simDt > 0 && rs.phase !== 'wait' && rs.phase !== 'over' && !this.isRange) rs.t -= simDt;
    if (this.spike.state === 'planted' && simDt > 0) this.spike.t -= simDt;
    if (this.isHost && simDt > 0) this._hostTick(simDt);
    this.revealT = Math.max(0, this.revealT - simDt);
    this.takeCd -= dt; this.reqCd -= dt;

    const me = this.me, ms = me.sim;
    const K = this.keys, P = this.pressed;
    const active = this.pointer.locked && !this.over && !this.buyOpen && me.alive;

    if (active) {
      const zoom = 1 + (ms.w.zoom - 1) * this.adsT;
      const sens = this.settings.sensitivity * 0.0022 / zoom;
      this.yaw -= this.mdx * sens;
      this.pitch -= this.mdy * sens * (this.settings.invertY ? -1 : 1);
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
      this.vm.look(this.mdx, this.mdy);
    }
    this.mdx = 0; this.mdy = 0;

    const ads = active && this.mouse.right;
    const input = {
      mx: active ? (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0) : 0,
      mz: active ? (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0) : 0,
      jump: active && !!K.Space,
      walk: active && !!(K.ShiftLeft || K.ShiftRight),
      crouch: active && !!(K.KeyC || (CTRL_CROUCH && (K.ControlLeft || K.ControlRight))),
      yaw: this.yaw, pitch: this.pitch,
      fire: active && this.mouse.left,
      ads, reload: active && !!P.KeyR,
      slot: this.wantSlot,
      ab: active ? (P.KeyQ ? 'Q' : P.KeyE ? 'E' : P.KeyX ? 'X' : null) : null
    };
    const useHeld = active && !!K.KeyF;

    // Pick up guns / drop / auto-grab the spike
    if (active && me.alive) {
      const near = this._nearestDrop(ms.pos, 1.6);
      const emptySlot = near && !ms.inv[weaponById(near.wid).slot];
      if (near && (P.KeyF || emptySlot) && this.takeCd <= 0) { this.takeCd = 0.4; this._req('take', { drop: near.id }); }
      if (P.KeyG && rs.phase !== 'end' && !this.isRange) {
        const item = ms.takeHeld();
        if (item) { this._req('dropReq', { wid: item.id, ammo: item.ammo, skin: item.skin, pos: this._dropPos(ms) }); this.wantSlot = ms.slot; }
      }
    }
    this.pressed = {};

    let myChannel = null;
    if (simDt > 0) {
      for (const E of this.ents.values()) {
        if (!E.local) { E.remote.update(); continue; }
        const inp = E === me ? input : E.bot.think(simDt);
        const ch = this._channel(E, E === me ? useHeld : !!inp.use, simDt);
        if (E === me) myChannel = ch;
        E.sim.update(simDt, inp, (s, a) => this._fire(E, a));
        if (E === me && !ms.inv[this.wantSlot]) this.wantSlot = ms.slot;
        if (E.alive && !E.sim.dead && E.sim.pos.y < this.map.killY) this._announceDeath(E, null, false, null, 'fall');
        this._localEvents(E);
        // Auto-pick up a dropped spike (attackers)
        if (E.alive && this.spike.state === 'dropped' && this._isAttacker(E) && this.reqCd <= 0) {
          const sp = this.spike.pos;
          if (Math.hypot(sp[0] - E.sim.pos.x, sp[2] - E.sim.pos.z) < 1.5 && Math.abs(sp[1] - E.sim.pos.y) < 1.5) { this.reqCd = 0.4; this._req('spTake', {}, E.id); }
        }
        if (E.alive && rs.phase === 'live' && E.sim.hp < E.char.health) {
          for (const pk of this.pickups) {
            if (!pk.active || Math.hypot(E.sim.pos.x - pk.pos[0], E.sim.pos.z - pk.pos[2]) > 0.9 || Math.abs(E.sim.pos.y - pk.pos[1]) > 1.2) continue;
            E.sim.heal(PICKUP_HEAL);
            this._bcast({ type: 'pk', i: pk.i });
            this.fx.burst(new THREE.Vector3(pk.pos[0], pk.pos[1] + 0.8, pk.pos[2]), 0x39ff8a, 30, 3, 0.6, -2);
            if (E === me) sfx.pickup();
          }
        }
      }
      this._updateZones(simDt);
      this._updateMines(simDt);
    }

    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i];
      w.t -= simDt;
      w.grow = Math.min(1, w.grow + simDt * 5);
      w.mesh.scale.y = Math.max(0.05, w.t < 0.5 ? w.t * 2 : w.grow);
      if (w.t <= 0) { this._removeWall(w); this.walls.splice(i, 1); }
    }
    if (this.barriers) for (const b of this.barriers) b.mat.uniforms.uTime.value = performance.now() / 1000;

    if (this.net) {
      this.sendAcc += dt;
      if (this.sendAcc >= 1 / SEND_HZ) {
        this.sendAcc = 0;
        const list = [];
        for (const E of this.ents.values()) {
          if (!E.local) continue;
          const s = E.sim;
          const f = (s.grounded ? 1 : 0) | (s.dead ? 2 : 0) | (s.shieldT > 0 ? 4 : 0) | ((E === me ? ads : false) ? 16 : 0) | (s.cloaked ? 32 : 0) | (s.channeling ? 64 : 0) | (s.crouching ? 128 : 0);
          list.push({ id: E.id, t: performance.now(), p: [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)], v: [r3(s.vel.x), r3(s.vel.y), r3(s.vel.z)], y: r3(s.yaw), pi: r3(s.pitch), w: s.weaponId, sk: s.skinId, f, rl: r3(s.reloadProgress), hp: Math.ceil(s.hp), sh: Math.ceil(s.shield) });
        }
        this.net.send({ type: 'S', list });
      }
    }

    // Models
    this.adsT += ((ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
    for (const E of this.ents.values()) {
      const st = E.st, m = E.model;
      m.root.position.set(st.pos.x, st.pos.y, st.pos.z);
      m.setWeapon(st.weaponId, E.local ? E.sim.skinId : E.remote.skinId);
      m.update(dt, { vx: st.vel.x, vz: st.vel.z, yaw: st.yaw, pitch: st.pitch, grounded: st.grounded, dead: !E.alive || st.dead, reload: st.reloadProgress, shield: E.local ? st.shieldT > 0 : st.shieldOn, kneel: E.local ? E.sim.channeling : E.remote.channeling, crouch: st.crouchAmt || 0 });
      m.setShadow(this.camera.position.distanceToSquared(m.root.position) < 1600);
      const cloaked = E.local ? E.sim.cloaked : E.remote.cloaked;
      const hideCloak = cloaked && E.team !== this.myTeam;
      m.root.visible = E.connected && (E.local || E.remote.hasState || rs.phase !== 'wait') && !hideCloak;
    }

    // Spike model: on the carrier's back, on the ground, or planted
    const sp = this.spike;
    this.spikeMesh.visible = sp.state === 'carried' || sp.state === 'dropped' || sp.state === 'planted';
    if (sp.state === 'carried') {
      const H = this.ents.get(sp.holder);
      if (H && H.alive) {
        const f = { x: -Math.sin(H.st.yaw), z: -Math.cos(H.st.yaw) };
        this.spikeMesh.position.set(H.st.pos.x - f.x * 0.32, H.st.pos.y + 1.05, H.st.pos.z - f.z * 0.32);
        this.spikeMesh.scale.setScalar(0.6);
        this.spikeMesh.visible = !(H === me && this._firstPerson()) && (H.team === this.myTeam || !(H.local ? H.sim.cloaked : H.remote.cloaked));
      } else this.spikeMesh.visible = false;
    } else if (sp.pos) {
      this.spikeMesh.position.set(sp.pos[0], sp.pos[1], sp.pos[2]);
      this.spikeMesh.scale.setScalar(1);
    }
    if (sp.state === 'planted') {
      this.beepT -= dt;
      const rate = sp.t < 10 ? 0.2 : sp.t < 20 ? 0.5 : 1;
      if (this.beepT <= 0) { this.beepT = rate; sfx.beep(sp.t < 10); this.spikeMesh.userData.light.intensity = 25; }
      this.spikeMesh.userData.light.intensity *= 0.9;
      this.spikeMesh.rotation.y += dt * 2;
    } else this.spikeMesh.userData.light.intensity = 0;

    for (const d of this.drops.values()) d.gun.rotation.x += dt * 1.5;
    for (const pk of this.pickups) {
      pk.item.visible = pk.active;
      pk.light.intensity = pk.active ? 6 : 0;
      pk.item.rotation.y += dt * 1.5;
    }

    this.stepAcc += ms.grounded && me.alive && !input.walk && !ms.crouching ? Math.hypot(ms.vel.x, ms.vel.z) * dt : 0;
    if (this.stepAcc > 2.3) { this.stepAcc = 0; sfx.step(); }

    if (!me.alive && !this.isRange) {
      this.specT = (this.specT ?? 0) - dt;
      const spec = this.specId && this.ents.get(this.specId);
      if (this.specT <= 0 && (!spec || !spec.alive)) this._cycleSpectate();
    }

    this._camera(dt);
    const fp = this._firstPerson();
    this.vmPass.enabled = fp;
    if (fp) {
      this.vm.setWeapon(ms.weaponId, ms.skinId);
      this.vm.visible = true;
      if (input.fire || ads) this.vm.cancelInspect();
      this.vm.update(dt, { speed: Math.hypot(ms.vel.x, ms.vel.z), grounded: ms.grounded, ads: ads, reload: ms.reloadProgress, walk: input.walk, channel: ms.channeling }, this.camera);
    }
    this.fx.update(dt);
    this._hud(dt, myChannel);
    if (this.buyOpen) this.buy.update(this._buyState());
    this.scene.updateMatrixWorld();
    this.composer.render();
  }

  _cycleSpectate() {
    const mates = this._alive().filter(E => E.team === this.myTeam && E !== this.me);
    if (!mates.length) { this.specId = null; return; }
    const i = mates.findIndex(E => E.id === this.specId);
    this.specId = mates[(i + 1) % mates.length].id;
  }

  _camTarget() {
    if (this.me.alive || !this.specId) return this.me;
    return this.ents.get(this.specId) || this.me;
  }

  // ------------------------------------------------------------ camera
  _camera(dt) {
    const T = this._camTarget();
    const st = T.st, cam = this.camera;
    const spectating = T !== this.me;
    const yaw = spectating ? st.yaw : this.yaw, pitch = spectating ? st.pitch : this.pitch;
    const w = weaponById(st.weaponId);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dir = _v1.set(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp);
    const a = spectating ? 0 : this.adsT;
    const eyeY = st.pos.y + st.h * 0.9;

    if (!spectating && this._firstPerson()) {
      // First person: camera at the eyes (lower while kneeling to plant/defuse)
      this.kneelCam = (this.kneelCam || 0) + ((this.me.sim.channeling ? 1 : 0) - (this.kneelCam || 0)) * Math.min(1, dt * 8);
      cam.position.set(st.pos.x, eyeY - this.kneelCam * 0.5, st.pos.z);
      this.shake = Math.max(0, this.shake - dt * 4);
      if (this.shake > 0) cam.position.add(_v3.set((Math.random() - 0.5) * this.shake * 0.06, (Math.random() - 0.5) * this.shake * 0.06, 0));
      cam.lookAt(cam.position.x + dir.x * 50, cam.position.y + dir.y * 50, cam.position.z + dir.z * 50);
      this.me.model.root.visible = false;
      this.camBack = 0.3;
    } else {
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const scoped = !!w.scope;
      const deadCam = !spectating && !this.me.alive;
      const baseSide = 0.3 + st.r * (T.char.id === 'tank' ? 1.2 : 0.9);
      const side = baseSide - a * (scoped ? baseSide : 0.08), up = 0.32 - a * (scoped ? 0.2 : 0.04);
      const back = deadCam ? 5 : 3.1 - a * (scoped ? 3.0 : 1.3);
      const eY = st.pos.y + st.h * 0.86;
      const upHit = this.world.raycast(st.pos.x, eY, st.pos.z, 0, 1, 0, up + (deadCam ? 1.5 : 0) + 0.2);
      const upAmt = upHit ? Math.max(0, upHit.t - 0.2) : up + (deadCam ? 1.5 : 0);
      const sideHit = this.world.raycast(st.pos.x, eY + upAmt, st.pos.z, rx, 0, rz, side + 0.25);
      const sideAmt = sideHit ? Math.max(0, sideHit.t - 0.25) : side;
      const pivot = _v2.set(st.pos.x + rx * sideAmt, eY + upAmt, st.pos.z + rz * sideAmt);
      let allowed = back;
      for (const [ox, oy] of [[0, 0], [0.18, 0], [-0.18, 0], [0, 0.14], [0, -0.14]]) {
        const ddx = -dir.x + rx * ox * 0.5, ddy = -dir.y + oy * 0.5, ddz = -dir.z + rz * ox * 0.5;
        const l = Math.hypot(ddx, ddy, ddz);
        const hit = this.world.raycast(pivot.x, pivot.y, pivot.z, ddx / l, ddy / l, ddz / l, back + 0.35);
        if (hit) allowed = Math.min(allowed, Math.max(0.15, hit.t - 0.35));
      }
      this.camBack += (allowed - this.camBack) * Math.min(1, dt * (allowed < this.camBack ? 40 : 6));
      if (!Number.isFinite(this.camBack)) this.camBack = allowed;
      cam.position.copy(pivot).addScaledVector(dir, -this.camBack);
      this.shake = Math.max(0, this.shake - dt * 4);
      if (this.shake > 0 && !spectating) cam.position.add(_v3.set((Math.random() - 0.5) * this.shake * 0.15, (Math.random() - 0.5) * this.shake * 0.15, 0));
      cam.lookAt(pivot.x + dir.x * 50, pivot.y + dir.y * 50, pivot.z + dir.z * 50);
      T.model.root.visible = T.model.root.visible && !(scoped && a > 0.6) && this.camBack > 0.7;
    }
    const zoom = 1 + (w.zoom - 1) * a;
    this.fovKick = Math.max(0, (this.fovKick || 0) - dt * 4);
    const fov = this.settings.fov / zoom + this.fovKick * 10;
    if (Math.abs(cam.fov - fov) > 0.01 || Math.abs(cam.aspect - innerWidth / innerHeight) > 0.001) {
      cam.fov = fov; cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------ HUD
  _project(x, y, z) {
    const v = _v3.set(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }

  _hud(dt, channel) {
    const me = this.me, ms = me.sim, rs = this.rs, sp = this.spike;
    const T = this._camTarget();
    const w = ms.w;
    const fovR = this.camera.fov * Math.PI / 180;
    const spreadPx = Math.tan(ms.spread(this.adsT > 0.5)) / Math.tan(fovR / 2) * (innerHeight / 2);

    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.1;
      const c = this.camera.position;
      for (const E of this.ents.values()) this.losCache.set(E.id, this._clear(c, { x: E.st.pos.x, y: E.st.pos.y + E.st.h * 0.9, z: E.st.pos.z }));
    }
    const plates = [];
    for (const E of this.ents.values()) {
      if (E === T || !E.connected || !E.alive) continue;
      const ally = E.team === this.myTeam;
      const cloaked = E.local ? E.sim.cloaked : E.remote.cloaked;
      const revealed = !ally && this.revealT > 0;
      if (!ally && !revealed && (!this.losCache.get(E.id) || cloaked)) continue;
      const pp = this._project(E.st.pos.x, E.st.pos.y + E.st.h + 0.45, E.st.pos.z);
      if (!pp) continue;
      const dist = this.camera.position.distanceTo(_v1.set(E.st.pos.x, E.st.pos.y, E.st.pos.z));
      plates.push({ id: E.id, x: pp.x, y: pp.y, name: E.name, ally, revealed, spike: ally && sp.state === 'carried' && sp.holder === E.id, hp: Math.max(0, E.st.hp / E.char.health), scale: Math.max(0.55, Math.min(1, 12 / dist)) });
    }

    // Site + spike markers
    const markers = [];
    if (this.useSpike) {
      for (const s of this.map.sites) {
        const pp = this._project(s.cx, s.y + 3, s.cz);
        if (pp) markers.push({ id: 'site' + s.name, x: pp.x, y: pp.y, label: s.name, kind: 'site', dist: this.camera.position.distanceTo(_v1.set(s.cx, s.y, s.cz)) });
      }
      if (sp.pos && (sp.state === 'planted' || (sp.state === 'dropped' && this._isAttacker(me)))) {
        const pp = this._project(sp.pos[0], sp.pos[1] + 1.2, sp.pos[2]);
        if (pp) markers.push({ id: 'spike', x: pp.x, y: pp.y, label: '◆', kind: sp.state === 'planted' ? 'spike planted' : 'spike' });
      }
    }

    const us = this._team(this.myTeam).filter(E => !E.dummy), them = this._team(1 - this.myTeam).filter(E => !E.dummy);
    const pip = E => ({ color: E.char.color, alive: E.alive && E.connected, spike: E.team === this.myTeam && sp.state === 'carried' && sp.holder === E.id });
    const near = me.alive && rs.phase !== 'end' ? this._nearestDrop(ms.pos, 1.6) : null;
    let centerText = '';
    if (!me.alive && rs.phase !== 'over') {
      const spec = this.specId && this.ents.get(this.specId);
      centerText = this.isRange ? 'RESPAWNING…' : spec ? `SPECTATING <b>${esc(spec.name)}</b><small>Click to switch</small>` : 'YOU ARE DEAD<small>Waiting for next round</small>';
    } else if (rs.phase === 'wait') centerText = 'WAITING FOR PLAYERS…';

    let prompt = near ? `<kbd>F</kbd> Pick up <b>${weaponById(near.wid).name}</b>` : '';
    if (!prompt && this.useSpike && me.alive && rs.phase === 'live' && !channel) {
      if (sp.state === 'carried' && sp.holder === me.id && this._siteAt([ms.pos.x, ms.pos.y, ms.pos.z])) prompt = '<kbd>F</kbd> Hold to plant the spike';
      if (sp.state === 'planted' && !this._isAttacker(me) && Math.hypot(sp.pos[0] - ms.pos.x, sp.pos[2] - ms.pos.z) < 2.2) prompt = '<kbd>F</kbd> Hold to defuse';
    }

    let phaseText, timeText = null, time = rs.t, urgent = false;
    const role = this.useSpike ? (this._isAttacker(me) ? 'ATTACK' : 'DEFEND') : '';
    if (this.isRange) { phaseText = 'PRACTICE RANGE'; timeText = '∞'; }
    else if (rs.phase === 'buy' || rs.phase === 'wait') phaseText = `ROUND ${Math.max(1, rs.n)} · BUY PHASE${role ? ' · ' + role : ''}`;
    else if (rs.phase === 'live') {
      if (sp.state === 'planted') { phaseText = `SPIKE PLANTED · ${sp.site}`; time = Math.max(0, sp.t); urgent = sp.t < 10; }
      else { phaseText = `ROUND ${rs.n}${role ? ' · ' + role : ''}`; urgent = rs.t < 10; }
    } else phaseText = rs.phase === 'end' ? 'ROUND OVER' : 'MATCH OVER';

    const abilities = me.char.abilities.map((ab, i) => {
      if (ab.ult) return { frac: Math.min(1, ms.ult / ab.ult), ready: ms.ult >= ab.ult, points: ms.ult };
      return { frac: 1 - ms.cds[i] / ab.cd, ready: ms.cds[i] <= 0, active: (ab.id === 'shield' && ms.shieldT > 0) || (ab.id === 'overclock' && ms.overclockT > 0) || (ab.id === 'dash' && ms.dashT > 0) };
    });

    this.hud.update(dt, {
      usScore: rs.score[this.myTeam], themScore: rs.score[1 - this.myTeam],
      usPips: us.map(pip), themPips: them.map(pip),
      time, timeText, urgent, planted: sp.state === 'planted', phaseText,
      hp: ms.hp, maxHp: me.char.health, shield: ms.shield,
      credits: this.isRange ? '∞' : (this.credits[me.id] ?? 0),
      weaponName: w.name, ammo: ms.cur.ammo, mag: w.mag, reload: ms.reloadProgress,
      slotP: ms.inv.primary ? weaponById(ms.inv.primary.id).name : null, slotS: ms.inv.sidearm ? weaponById(ms.inv.sidearm.id).name : null, slot: ms.slot,
      abilities,
      spreadPx, showCross: me.alive && !(w.scope && this.adsT > 0.6) && !this.buyOpen && !channel && !(this._firstPerson() && this.adsT > 0.6 && ['holo', 'scope'].includes(this.vm.gun?.userData.sightType)),
      scope: !!w.scope && this.adsT > 0.6 && me.alive,
      dead: !me.alive, dmgAngle: this.dmgAngle, reveal: this.revealT > 0, slowed: ms.slowT > 0,
      centerText, prompt, channel,
      carrying: sp.state === 'carried' && sp.holder === me.id && me.alive,
      buyHint: rs.phase === 'buy' && me.alive && !this.buyOpen,
      ping: this.net ? Math.round(this.net.ping) : null,
      plates, markers,
      board: this.keys.Tab ? this._scoreboard() : null
    });
  }

  _scoreboard() {
    const row = E => `<tr class="${E === this.me ? 'me' : ''} ${E.alive ? '' : 'dead'}"><td><span style="color:${hexs(E.char.color)}">■</span> ${esc(E.name)}${E.tag ? `<span class="ptag">#${esc(E.tag)}</span>` : ''}</td><td>${E.char.name}</td><td>${E.kills}</td><td>${E.deaths}</td><td>${E.team === this.myTeam && !this.isRange ? '¤ ' + (this.credits[E.id] ?? 0).toLocaleString() : ''}</td></tr>`;
    const team = t => this._team(t).filter(E => !E.dummy && E.connected);
    const sec = (t, label, color) => `<tr class="hdr"><td colspan="5" style="color:${color}">${label}</td></tr>` + team(t).sort((a, b) => b.kills - a.kills).map(row).join('');
    return `<table><tr class="cols"><td>PLAYER</td><td>FIGHTER</td><td>K</td><td>D</td><td>CREDITS</td></tr>${sec(this.myTeam, 'YOUR TEAM', TEAM_COLORS[0])}${this.isRange ? '' : sec(1 - this.myTeam, 'ENEMY TEAM', TEAM_COLORS[1])}</table>`;
  }

  _buyState() {
    const ms = this.me.sim;
    const owned = new Set();
    for (const k of ['primary', 'sidearm']) if (ms.inv[k]) owned.add(ms.inv[k].id);
    return {
      credits: this.isRange ? 999999 : (this.credits[this.me.id] ?? 0), time: this.isRange ? 99 : this.rs.t, owned, shield: ms.shield, free: this.isRange,
      team: this._team(this.myTeam).filter(E => E !== this.me && !E.dummy).map(E => ({ name: esc(E.name), credits: this.credits[E.id] ?? 0, color: hexs(E.char.color) }))
    };
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
    canvas.removeEventListener('contextmenu', this.h.ctx);
    removeEventListener('blur', this.h.blur);
    this.unLock?.();
    if (this.buyOpen) { this.buy.onClose = null; this.buy.close(); }
    this.buy.onBuy = null; this.buy.onClose = null;
    if (this.net) for (const t of Object.keys(this.H)) this.net.off(t);
    this.scene.traverse(o => { o.geometry?.dispose?.(); });
    this.composer.dispose?.();
  }
}
