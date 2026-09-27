// A round-based team match (1v1 or 2v2) with an economy, buy phase and dropped guns.
//
// Authority model:
//  - Every machine simulates its own player (movement, shooting, health). The host also runs the bots.
//  - Shooters decide hits ("favor the shooter") and tell the victim's owner, who applies damage.
//  - The host owns the round flow, credits, dropped guns and bot purchases.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { weaponById, charById, SHIELDS, ECON, ROUND, PICKUP_HEAL } from './data.js';
import { buildMap } from './maps.js';
import { Player } from './Player.js';
import { Bot, botShopping } from './Bot.js';
import { CharacterModel, buildGun } from './models.js';
import { Effects } from './effects.js';
import { getEnvMap } from './envmap.js';
import { sfx } from '../audio.js';

const SEND_HZ = 30;
const INTERP_DELAY = 100;
const TEAM_COLORS = ['#3dd6ff', '#ff4a5a'];
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const r3 = v => Math.round(v * 1000) / 1000;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexs = c => '#' + c.toString(16).padStart(6, '0');

// A player simulated on another machine: interpolates network snapshots.
class RemotePlayer {
  constructor(char) {
    this.char = char;
    this.r = char.radius; this.h = char.height;
    this.pos = { x: 0, y: -100, z: 0 }; this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0; this.hp = char.health; this.shield = 0;
    this.dead = false; this.deadOverride = false;
    this.grounded = true; this.weaponId = 'classic'; this.shieldOn = false; this.reload = -1; this.ads = false;
    this.snaps = []; this.offset = null; this.hasState = false;
  }
  get invulnerable() { return this.shieldOn; }
  get reloadProgress() { return this.reload; }
  push(m) {
    const now = performance.now();
    const off = now - m.t;
    if (this.offset === null || off < this.offset) this.offset = off; else this.offset += (off - this.offset) * 0.02;
    const dead = !!(m.f & 2);
    const prev = this.snaps[this.snaps.length - 1];
    if (prev && prev.dead && !dead) this.snaps.length = 0; // respawn: don't slide across the map
    if (prev && Math.hypot(prev.p[0] - m.p[0], prev.p[2] - m.p[2]) > 12) this.snaps.length = 0; // teleport (round start)
    this.snaps.push({ t: m.t, p: m.p, v: m.v, yaw: m.y, pitch: m.pi, dead });
    if (this.snaps.length > 30) this.snaps.shift();
    this.hp = m.hp; this.shield = m.sh || 0; this.weaponId = m.w;
    this.grounded = !!(m.f & 1); this.shieldOn = !!(m.f & 4); this.ads = !!(m.f & 16);
    this.reload = m.rl;
    this.hasState = true;
  }
  update() {
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
   * o: { renderer, hud, buy, pointer, settings, net, myId, isHost, roster:[{id,name,team,char,isBot}],
   *      mapIndex, roundsToWin, difficulty, onEnd, onPauseRequest, onClickPlay }
   */
  constructor(o) {
    Object.assign(this, o);
    const R = this.renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 1000);
    this.map = buildMap(this.mapIndex, this.scene, this.settings.quality);
    this.world = this.map.world;
    R.toneMappingExposure = this.map.env.exposure;
    this.scene.environment = getEnvMap(R);
    this.scene.environmentIntensity = this.map.env.envI ?? 0.45;
    this.fx = new Effects(this.scene);

    // Round state (the host is authoritative; everyone keeps a copy)
    this.rs = { n: 0, phase: 'wait', t: 0, score: [0, 0], winner: null, matchWinner: null };
    this.credits = {};
    this.lossStreak = [0, 0];
    this.drops = new Map();
    this.dropSeq = 1;
    this.walls = [];
    this.revealT = 0;
    this.loaded = new Set([this.myId]);
    this.waitT = 0;

    this.pickups = this.map.pickups.map((p, i) => this._makePickup(p, i));

    this.ents = new Map();
    for (const r of this.roster) this._makeEnt(r);
    this.me = this.ents.get(this.myId);
    this.myTeam = this.me.team;
    for (const E of this.ents.values()) this.credits[E.id] = ECON.start;

    this.composer = new EffectComposer(R);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.settings.quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.45, 0.88);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());

    // Input / camera
    this.keys = {}; this.mouse = { left: false, right: false }; this.pressed = {};
    this.wantSlot = 'sidearm'; this.lastSlot = 'primary';
    this.mdx = 0; this.mdy = 0; this.skipMouse = 0;
    this.yaw = 0; this.pitch = 0;
    this.adsT = 0; this.shake = 0; this.stepAcc = 0; this.camBack = 3; this.dmgAngle = 0;
    this.sendAcc = 0; this.rsAcc = 0; this.promptT = 0; this.takeCd = 0;
    this.specId = null; this.over = false; this.ended = false; this.paused = false;
    this.losCache = new Map(); this.losT = 0;
    this._bindInput();
    this._bindNet();

    this.hud.setup({ roundsToWin: this.roundsToWin, mapName: this.map.name, char: this.me.char });
    this.buy.onBuy = item => this._req('buy', { item });
    this.buy.onClose = () => { this.buyOpen = false; if (!this.over) this.pointer.request(); };
    this.buyOpen = false;

    // Place everyone at a spawn right away so the first frame looks right
    this._placeAtSpawns();
    if (this.net && !this.isHost) this.net.sendTo('h', { type: 'loaded' });
  }

  // ------------------------------------------------------------ entities
  _makeEnt(r) {
    const char = charById(r.char);
    const local = r.id === this.myId || (r.isBot && this.isHost);
    const E = { id: r.id, name: r.name, team: r.team, char, isBot: !!r.isBot, owner: r.isBot ? 'h' : r.id, local, alive: true, connected: true, kills: 0, deaths: 0 };
    if (local) E.sim = new Player(char, this.world);
    else E.remote = new RemotePlayer(char);
    E.st = E.sim || E.remote;
    E.model = new CharacterModel(char);
    this.scene.add(E.model.root);
    if (r.isBot && this.isHost) {
      E.bot = new Bot(E.sim, this.world, this.difficulty, {
        enemies: () => this._alive().filter(o => o.team !== E.team).map(o => o.st),
        allies: () => this._alive().filter(o => o.team === E.team && o !== E).map(o => o.st),
        pickups: this.pickups,
        drops: () => [...this.drops.values()],
        wantsDrop: id => this._req('take', { drop: id }, E.id)
      });
    }
    this.ents.set(E.id, E);
  }

  _alive() { return [...this.ents.values()].filter(E => E.alive && E.connected); }
  _team(t) { return [...this.ents.values()].filter(E => E.team === t); }

  _spawnFor(E) {
    const mates = this._team(E.team);
    const i = mates.indexOf(E);
    const list = this.map.teamSpawns[E.team];
    return list[i % list.length];
  }

  _placeAtSpawns() {
    for (const E of this.ents.values()) {
      const s = this._spawnFor(E);
      const yaw = Math.atan2(s[0], s[2]);
      if (E.sim) { E.sim.reset(s, false); E.sim.yaw = yaw; E.sim.frozen = true; if (E.bot) { E.bot.yaw = yaw; E.bot.reset(); } }
      else { E.remote.pos.x = s[0]; E.remote.pos.y = s[1]; E.remote.pos.z = s[2]; E.remote.yaw = yaw; }
      if (E === this.me) { this.yaw = yaw; this.pitch = 0; }
    }
  }

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
        if (e.code === 'KeyQ') this._selectSlot(this.lastSlot);
        if (e.code === 'KeyB') this._toggleBuy();
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
        // Drop the first event after locking and absurd spikes (a known Chromium pointer-lock glitch)
        if (this.skipMouse > 0) { this.skipMouse--; return; }
        if (Math.abs(e.movementX) > 500 || Math.abs(e.movementY) > 500) return;
        this.mdx += e.movementX; this.mdy += e.movementY;
      },
      wheel: e => { if (this.pointer.locked) this._selectSlot(this.wantSlot === 'primary' ? 'sidearm' : 'primary'); },
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

  _selectSlot(s) {
    const inv = this.me.sim.inv;
    if (!inv[s] || s === this.wantSlot) return;
    this.lastSlot = this.wantSlot;
    this.wantSlot = s;
  }

  _toggleBuy() {
    if (this.buyOpen) { this.buy.close(); return; }
    if (this.rs.phase !== 'buy' || !this.me.alive) { if (this.rs.phase === 'live') this.hud.banner('', 'You can only buy during the buy phase', '#fff', 1.2); return; }
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
      hit: m => { const E = this.ents.get(m.target); if (E && E.local) this._applyDamage(E, m.dmg, m.head, m.by, m.w, m.from); },
      heal: m => { const E = this.ents.get(m.target); if (E && E.local && E.alive) { E.sim.heal(m.n); if (E === this.me) sfx.pickup(); } },
      shot: m => this._onRemoteShot(m),
      ev: m => this._onEvent(m),
      pk: m => { const p = this.pickups[m.i]; if (p) p.active = false; },
      drop: m => this._onDrop(m),
      taken: m => this._onTaken(m),
      bought: m => this._onBought(m),
      left: m => this._onLeft(m.id),
      over: m => this._onOver(m),
      // host-only requests
      buy: (m, from) => this.isHost && this._host('buy', m, from),
      take: (m, from) => this.isHost && this._host('take', m, from),
      dropReq: (m, from) => this.isHost && this._host('dropReq', m, from),
      loaded: (m, from) => this.isHost && this.loaded.add(from)
    };
    if (this.net) for (const t of Object.keys(this.H)) this.net.on(t, (m, from) => this.H[t](m, from));
  }

  // Broadcast to everyone and handle it here too.
  _bcast(msg) { this.net?.send(msg); this.H[msg.type](msg, this.myId); }
  // Send to the machine that owns a player (host owns bots).
  _sendToOwner(E, msg) {
    const owner = E.owner;
    if (owner === this.myId) this.H[msg.type](msg, this.myId);
    else this.net?.sendTo(owner, msg);
  }
  // A request only the host may decide.
  _req(type, data, fromId = this.myId) {
    if (this.isHost) this._host(type, data, fromId);
    else this.net.sendTo('h', { type, ...data });
  }

  // ------------------------------------------------------------ host logic
  _host(type, m, from) {
    const E = this.ents.get(from);
    if (type === 'buy') this._hostBuy(E, m.item);
    else if (type === 'take') {
      const d = this.drops.get(m.drop);
      if (d && E && E.alive && this.rs.phase !== 'end') this._bcast({ type: 'taken', drop: d.id, by: E.id });
    } else if (type === 'dropReq') this._hostDrop(m.wid, m.ammo, m.pos);
  }

  _hostBuy(E, item) {
    if (!E || !E.alive || this.rs.phase !== 'buy') return;
    const w = weaponById(item), sh = SHIELDS.find(s => s.id === item);
    const price = sh ? sh.price : (w.id === item ? w.price : Infinity);
    if (this.credits[E.id] < price) return;
    this.credits[E.id] -= price;
    this._sendToOwner(E, { type: 'bought', id: E.id, item });
    this._bcastRS();
  }

  _hostDrop(wid, ammo, pos) {
    const g = this.world.groundBelow(pos[0], pos[2], 0.1, pos[1] + 1, 30);
    this._bcast({ type: 'drop', id: this.dropSeq++, wid, ammo, pos: [r3(pos[0]), r3(g > -Infinity ? g : pos[1]), r3(pos[2])] });
  }

  _bcastRS() {
    const rs = this.rs;
    this._bcast({ type: 'rs', phase: rs.phase, t: rs.t, n: rs.n, score: rs.score, winner: rs.winner, credits: this.credits, kd: this._kd() });
  }
  _kd() { const o = {}; for (const E of this.ents.values()) o[E.id] = [E.kills, E.deaths]; return o; }

  _hostTick(dt) {
    const rs = this.rs;
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
      if (rs.t <= 0) this._hostEndRound(this._timeoutWinner());
    } else if (rs.phase === 'end') {
      if (rs.t <= 0) {
        if (rs.matchWinner !== null) { rs.phase = 'over'; this._bcast({ type: 'over', winner: rs.matchWinner, score: rs.score }); }
        else this._hostStartRound();
      }
    }
    if (this.rsAcc > 1) { this.rsAcc = 0; this._bcastRS(); }
  }

  _botsShop() {
    for (const E of this.ents.values()) {
      if (!E.bot || !E.alive) continue;
      let c = this.credits[E.id];
      for (const item of botShopping(c, E.sim)) this._hostBuy(E, item);
    }
  }

  _hostStartRound() {
    const rs = this.rs;
    rs.n++;
    rs.phase = 'buy';
    rs.t = rs.n === 1 ? ROUND.firstBuy : ROUND.buy;
    rs.winner = null;
    const spawns = {}, keep = {};
    for (const E of this.ents.values()) { spawns[E.id] = this._spawnFor(E); keep[E.id] = rs.n > 1 && E.alive && E.connected; }
    this.botsBought = false;
    this._bcast({ type: 'rstart', n: rs.n, t: rs.t, spawns, keep, score: rs.score, credits: this.credits });
  }

  _timeoutWinner() {
    const alive = [0, 0], hp = [0, 0];
    for (const E of this._alive()) { alive[E.team]++; hp[E.team] += E.st.hp + (E.st.shield || 0); }
    if (alive[0] !== alive[1]) return alive[0] > alive[1] ? 0 : 1;
    if (Math.abs(hp[0] - hp[1]) > 0.5) return hp[0] > hp[1] ? 0 : 1;
    return -1;
  }

  _hostCheckElimination() {
    if (this.rs.phase !== 'live') return;
    const alive = [0, 0];
    for (const E of this._alive()) alive[E.team]++;
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

  // ------------------------------------------------------------ round events (everyone)
  _onRoundStart(m) {
    this.rs.n = m.n; this.rs.phase = 'buy'; this.seenPhase = 'buy'; this.rs.t = m.t; this.rs.score = m.score; this.rs.winner = null;
    Object.assign(this.credits, m.credits);
    for (const d of this.drops.values()) this.scene.remove(d.group);
    this.drops.clear();
    for (const w of this.walls) this._removeWall(w);
    this.walls = [];
    for (const p of this.pickups) p.active = true;
    this.revealT = 0;
    for (const E of this.ents.values()) {
      if (!E.connected) { E.alive = false; continue; }
      E.alive = true;
      const s = m.spawns[E.id];
      const yaw = Math.atan2(s[0], s[2]);
      if (E.local) {
        E.sim.reset(s, !!m.keep[E.id]);
        E.sim.yaw = yaw; E.sim.frozen = true;
        if (E.bot) { E.bot.reset(); E.bot.yaw = yaw; }
      } else {
        E.remote.deadOverride = false;
        E.remote.snaps.length = 0;
        E.remote.pos.x = s[0]; E.remote.pos.y = s[1]; E.remote.pos.z = s[2]; E.remote.yaw = yaw; E.remote.dead = false;
      }
      if (E === this.me) {
        this.yaw = yaw; this.pitch = 0; this.specId = null;
        this.wantSlot = E.sim.slot;
      }
    }
    const buyTime = m.t;
    this.hud.banner(`ROUND ${m.n}`, `Buy phase · ${buyTime}s · press B to buy`, '#ffd166', 2.5);
  }

  _onRoundState(m) {
    const rs = this.rs;
    const prev = this.seenPhase; // track separately: the host mutates rs before broadcasting
    this.seenPhase = m.phase;
    rs.phase = m.phase; rs.t = m.t; rs.n = m.n; rs.score = m.score; rs.winner = m.winner;
    Object.assign(this.credits, m.credits);
    if (m.kd) for (const id in m.kd) { const E = this.ents.get(id); if (E) { E.kills = m.kd[id][0]; E.deaths = m.kd[id][1]; } }
    if (prev === 'buy' && m.phase === 'live') {
      for (const E of this.ents.values()) if (E.local) E.sim.frozen = false;
      if (this.buyOpen) this.buy.close();
      this.hud.banner('FIGHT', '', '#ffffff', 1.2);
      sfx.ability('dash');
    }
    if (prev === 'live' && m.phase === 'end') {
      const won = m.winner === this.myTeam, draw = m.winner === -1;
      this.hud.banner(draw ? 'DRAW' : won ? 'ROUND WON' : 'ROUND LOST', `${m.score[this.myTeam]} — ${m.score[1 - this.myTeam]}`, draw ? '#ffffff' : won ? '#3dff9a' : '#ff4a4a', 3);
      (won ? sfx.win : sfx.lose)();
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
    E.alive = false;
    E.model.root.visible = false;
    this.hud.feed(`<b style="color:${TEAM_COLORS[E.team === this.myTeam ? 0 : 1]}">${esc(E.name)}</b> <span class="fk">left the match</span>`);
    if (this.isHost) this._hostCheckElimination();
  }

  playerLeft(id) { // called by the app when the host loses a guest
    if (!this.ents.has(id)) return;
    this._bcast({ type: 'left', id });
  }

  // ------------------------------------------------------------ death & damage
  _announceDeath(E, byId, head, wid, cause) {
    const s = E.sim;
    if (s.dead) return;
    const drop = s.inv.primary || (s.inv.sidearm && s.inv.sidearm.id !== 'classic' ? s.inv.sidearm : null);
    s.dead = true; s.hp = 0;
    this._bcast({ type: 'die', id: E.id, by: byId, head, w: wid, cause, drop: drop ? { wid: drop.id, ammo: drop.ammo } : null, pos: [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)] });
  }

  _onDie(m) {
    const E = this.ents.get(m.id);
    if (!E || !E.alive) return;
    E.alive = false;
    E.deaths++;
    if (E.sim) E.sim.dead = true;
    if (E.remote) E.remote.deadOverride = true;
    const K = this.ents.get(m.by);
    const enemyKill = K && K.team !== E.team;
    if (enemyKill) { K.kills++; if (this.isHost) this.credits[K.id] = Math.min(ECON.max, this.credits[K.id] + ECON.kill); }

    const at = new THREE.Vector3(m.pos[0], m.pos[1] + 1, m.pos[2]);
    this.fx.burst(at, E.char.color, 40, 5, 0.7, 6);
    const col = X => TEAM_COLORS[X.team === this.myTeam ? 0 : 1];
    const name = X => `<b style="color:${col(X)}">${esc(X.name)}</b>`;
    const wName = m.w ? weaponById(m.w).name : '';
    if (m.cause === 'fall') this.hud.feed(`${name(E)} <span class="fk">fell to their doom</span>`);
    else if (K) this.hud.feed(`${name(K)} <span class="fk">${esc(wName)}${m.head ? ' ◎' : ''}</span> ${name(E)}`);

    if (E === this.me) {
      sfx.death();
      this.hud.banner('ELIMINATED', m.cause === 'fall' ? 'You fell' : K ? `by ${K.name}` : '', '#ff4a4a', 2);
      if (this.buyOpen) this.buy.close();
      this.specT = 2.5;
    } else if (K === this.me && enemyKill) {
      sfx.kill();
      this.hud.hitmarker(m.head, true);
      this.hud.banner(m.head ? 'HEADSHOT' : 'ELIMINATED', `${E.name} · +¤${ECON.kill}`, hexs(this.me.char.accent), 1.6);
    }
    if (this.isHost) {
      if (m.drop) this._hostDrop(m.drop.wid, m.drop.ammo, m.pos);
      this._hostCheckElimination();
      this._bcastRS();
    }
  }

  _applyDamage(E, dmg, head, byId, wid, from) {
    if (!E.alive || this.rs.phase !== 'live') return;
    const s = E.sim;
    if (!s.takeDamage(dmg)) return;
    E.model.hit();
    if (E === this.me) {
      sfx.hurt();
      this.shake = Math.min(1, this.shake + 0.4);
      const ang = Math.atan2(-(from[0] - s.pos.x), -(from[2] - s.pos.z)) - this.yaw;
      this.dmgAngle = -ang;
      this.hud.hurt();
    }
    if (s.hp <= 0) this._announceDeath(E, byId, head, wid, 'kill');
  }

  // ------------------------------------------------------------ shooting
  _hitboxes(p) {
    const s = p.char.id === 'tank' ? 1.12 : 1;
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

  _fire(E, ads) {
    const s = E.sim, w = s.w;
    const isMe = E === this.me;
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
      const cp = Math.cos(s.pitch);
      baseDir = new THREE.Vector3(-Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp);
    }
    E.model.root.updateMatrixWorld(true);
    const muzzle = E.model.getMuzzle(new THREE.Vector3());
    const spread = s.spread(ads);
    const targets = this._alive().filter(T => T.team !== E.team && T !== E);
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
      const wh = this.world.raycast(origin.x, origin.y, origin.z, d.x, d.y, d.z, 250);
      let t = wh ? wh.t : 250, hitT = null, hitHead = false;
      for (const T of targets) {
        const th = this._rayTarget(origin, d, T.st, hitT ? hitT.t : t);
        if (th) { hitT = { ...th, T }; hitHead = th.head; }
      }
      const end = origin.clone().addScaledVector(d, hitT ? hitT.t : t);
      const ex = end.x - eye.x, ey = end.y - eye.y, ez = end.z - eye.z, el = Math.hypot(ex, ey, ez);
      const block = el > 0.01 ? this.world.raycast(eye.x, eye.y, eye.z, ex / el, ey / el, ez / el, el - 0.02) : null;
      let normal = wh ? new THREE.Vector3(wh.nx, wh.ny, wh.nz) : null;
      if (block) { end.set(eye.x + ex / el * block.t, eye.y + ey / el * block.t, eye.z + ez / el * block.t); normal = new THREE.Vector3(block.nx, block.ny, block.nz); hitT = null; }
      if (hitT) {
        const T = hitT.T;
        const dist = Math.hypot(end.x - eye.x, end.z - eye.z);
        const [f0, f1, fm] = w.falloff;
        const fall = dist <= f0 ? 1 : dist >= f1 ? fm : 1 - (1 - fm) * (dist - f0) / (f1 - f0);
        const prev = dmgBy.get(T) || { dmg: 0, head: false };
        prev.dmg += w.dmg * fall * (hitHead ? w.head : 1);
        prev.head = prev.head || hitHead;
        dmgBy.set(T, prev);
        this.fx.burst(end, T.st.invulnerable ? T.char.accent : T.char.color, 10, 4, 0.35, 8, 0.8, d.clone().multiplyScalar(-1));
      } else if (normal && t < 250) this.fx.impact(end, normal);
      ends.push(end);
      this.fx.tracer(muzzle, end, isMe ? 0xfff0c0 : 0xffc0a0, w.pellets > 1 ? 0.018 : 0.028);
    }
    this.fx.muzzle(muzzle, baseDir, w.pellets > 1 ? 0.8 : w.scope ? 0.9 : 0.55);
    E.model.kick(w.recoil * 6);
    if (isMe) {
      this.pitch = Math.min(1.35, this.pitch + w.recoil * (ads ? 0.5 : 1));
      this.yaw += (Math.random() - 0.5) * w.recoil * 0.4;
      sfx.gun(w.id);
    } else this._spatialGun(s.pos, w.id);
    this.net?.send({ type: 'shot', id: E.id, w: w.id, e: ends.map(v => [r3(v.x), r3(v.y), r3(v.z)]) });

    for (const [T, h] of dmgBy) {
      s.hits++;
      if (h.head) s.headshots++;
      const from = [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)];
      if (isMe) {
        const blocked = T.st.invulnerable;
        const hb = this._hitboxes(T.st);
        const scr = this._project(hb.head.x, hb.head.y + 0.3, hb.head.z);
        if (scr && !blocked) this.hud.damageNumber(scr.x, scr.y, h.dmg, h.head);
        this.hud.hitmarker(h.head, !blocked && T.st.hp + (T.st.shield || 0) - h.dmg <= 0);
        sfx.hit(h.head);
      }
      T.model.hit();
      if (T.local) this._applyDamage(T, h.dmg, h.head, E.id, w.id, from);
      else this._sendToOwner(T, { type: 'hit', target: T.id, dmg: Math.round(h.dmg * 10) / 10, head: h.head, by: E.id, w: w.id, from });
    }
  }

  _spatialGun(pos, wid) {
    const c = this._camTarget().st.pos;
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const rel = Math.atan2(-dx, -dz) - this.yaw;
    sfx.gun(wid, Math.hypot(dx, dz), -Math.sin(rel) * 0.8);
  }

  _onRemoteShot(m) {
    const E = this.ents.get(m.id);
    if (!E || E.local) return;
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

  // ------------------------------------------------------------ abilities & events
  _localEvents(E) {
    const s = E.sim, color = E.char.accent;
    const isMe = E === this.me;
    for (const ev of s.events) {
      const at = new THREE.Vector3(s.pos.x, s.pos.y + 1, s.pos.z);
      const near = isMe || Math.hypot(s.pos.x - this.me.st.pos.x, s.pos.z - this.me.st.pos.z) < 30;
      switch (ev.type) {
        case 'jump': if (isMe) sfx.jump(); break;
        case 'land': if (isMe) sfx.land(); break;
        case 'reload': if (isMe) sfx.reload(); break;
        case 'reloaded': if (isMe) sfx.reloaded(); break;
        case 'dash': case 'shield': case 'overclock': case 'blink':
          this._bcast({ type: 'ev', k: ev.type, id: E.id, from: ev.from, to: ev.to });
          break;
        case 'wall':
          this._bcast({ type: 'ev', k: 'wall', id: E.id, x: r3(ev.x), y: r3(ev.y), z: r3(ev.z), alongX: ev.alongX });
          break;
        case 'heal':
          for (const A of this._alive()) {
            if (A.team !== E.team || Math.hypot(A.st.pos.x - s.pos.x, A.st.pos.z - s.pos.z) > 8) continue;
            this._sendToOwner(A, { type: 'heal', target: A.id, n: PICKUP_HEAL });
          }
          this._bcast({ type: 'ev', k: 'heal', id: E.id });
          break;
        case 'pulse':
          this._bcast({ type: 'ev', k: 'pulse', id: E.id, team: E.team });
          break;
      }
      void at; void near;
    }
    s.events.length = 0;
  }

  _onEvent(m) {
    const E = this.ents.get(m.id);
    if (!E) return;
    const p = E.st.pos, color = E.char.accent;
    const at = new THREE.Vector3(p.x, p.y + 1, p.z), foot = new THREE.Vector3(p.x, p.y + 0.05, p.z);
    const c = this._camTarget().st.pos;
    const near = Math.hypot(p.x - c.x, p.z - c.z) < 30;
    switch (m.k) {
      case 'dash': this.fx.burst(at, color, 25, 3, 0.4, 0); this.fx.ring(foot, color, 1.5); break;
      case 'blink': this.fx.blink(m.from, m.to, color); if (E === this.me) this.camBack = 0.5; break;
      case 'shield': case 'overclock': this.fx.ring(foot, color); this.fx.burst(at, color, 30, 3, 0.5, -2); break;
      case 'heal':
        this.fx.ring(foot, 0x39ff8a, 8);
        for (const A of this._alive()) if (A.team === E.team && Math.hypot(A.st.pos.x - p.x, A.st.pos.z - p.z) <= 8) this.fx.burst(new THREE.Vector3(A.st.pos.x, A.st.pos.y + 1, A.st.pos.z), 0x39ff8a, 30, 2.5, 0.8, -3);
        break;
      case 'pulse':
        this.fx.ring(foot, color, 25);
        if (m.team === this.myTeam) { this.revealT = 4; this.hud.banner('', 'Enemies revealed', hexs(color), 1.5); }
        break;
      case 'wall': this._makeWall(m, E); break;
    }
    if (near) sfx.ability(m.k === 'wall' || m.k === 'heal' ? 'shield' : m.k === 'pulse' ? 'blink' : m.k);
  }

  _makeWall(m, E) {
    const hw = 2.4, ht = 0.35, h = 3.2;
    const box = m.alongX
      ? { min: { x: m.x - hw, y: m.y, z: m.z - ht }, max: { x: m.x + hw, y: m.y + h, z: m.z + ht } }
      : { min: { x: m.x - ht, y: m.y, z: m.z - hw }, max: { x: m.x + ht, y: m.y + h, z: m.z + hw } };
    const geo = new THREE.BoxGeometry(box.max.x - box.min.x, h, box.max.z - box.min.z, 4, 3, 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + (Math.random() - 0.5) * 0.15);
    geo.computeVertexNormals();
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xbfefff, emissive: 0x3aa8e0, emissiveIntensity: 0.35, roughness: 0.08, transmission: 0.35, transparent: true, opacity: 0.88, thickness: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((box.min.x + box.max.x) / 2, m.y + h / 2, (box.min.z + box.max.z) / 2);
    mesh.castShadow = true;
    mesh.scale.y = 0.05;
    this.scene.add(mesh);
    this.world.boxes.push(box);
    const wall = { box, mesh, t: 8, grow: 0 };
    this.walls.push(wall);
    this.fx.burst(mesh.position, 0xbff0ff, 40, 4, 0.6, 6);
    void E;
  }

  _removeWall(w) {
    const i = this.world.boxes.indexOf(w.box);
    if (i >= 0) this.world.boxes.splice(i, 1);
    this.scene.remove(w.mesh);
    w.mesh.geometry.dispose();
  }

  // ------------------------------------------------------------ dropped guns
  _onDrop(m) {
    const g = new THREE.Group();
    const gun = buildGun(m.wid, 0xffd166);
    gun.rotation.z = Math.PI / 2;
    gun.scale.setScalar(1.3);
    g.add(gun);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.42, 32), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.33; g.add(ring);
    g.position.set(m.pos[0], m.pos[1] + 0.35, m.pos[2]);
    this.scene.add(g);
    this.drops.set(m.id, { id: m.id, wid: m.wid, ammo: m.ammo, pos: m.pos, group: g, gun });
  }

  _onTaken(m) {
    const d = this.drops.get(m.drop);
    if (!d) return;
    this.scene.remove(d.group);
    this.drops.delete(m.drop);
    const E = this.ents.get(m.by);
    if (E && E.local) {
      const prev = E.sim.give(d.wid, d.ammo);
      if (E === this.me) { this.wantSlot = E.sim.slot; sfx.reloaded(); }
      if (prev && prev.id !== 'classic') this._req('dropReq', { wid: prev.id, ammo: prev.ammo, pos: this._dropPos(E.sim) }, E.id);
    }
  }

  _onBought(m) {
    const E = this.ents.get(m.id);
    if (!E || !E.local) return;
    const sh = SHIELDS.find(s => s.id === m.item);
    if (sh) E.sim.shield = Math.max(E.sim.shield, sh.amount);
    else {
      const prev = E.sim.give(m.item);
      if (prev && prev.id !== 'classic') this._req('dropReq', { wid: prev.id, ammo: prev.ammo, pos: this._dropPos(E.sim) }, E.id);
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
  update(dt) {
    const simDt = this.paused && !this.net ? 0 : dt;
    const rs = this.rs;
    if (simDt > 0 && rs.phase !== 'wait' && rs.phase !== 'over') rs.t -= simDt;
    if (this.isHost && simDt > 0) this._hostTick(simDt);
    this.revealT = Math.max(0, this.revealT - simDt);
    this.takeCd -= dt;

    const me = this.me, ms = me.sim;
    const K = this.keys, P = this.pressed;
    const active = this.pointer.locked && !this.over && !this.buyOpen && me.alive;

    // Mouse look (accumulated deltas)
    if (active) {
      const zoom = 1 + (ms.w.zoom - 1) * this.adsT;
      const sens = this.settings.sensitivity * 0.0022 / zoom;
      this.yaw -= this.mdx * sens;
      this.pitch -= this.mdy * sens * (this.settings.invertY ? -1 : 1);
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
    }
    this.mdx = 0; this.mdy = 0;

    const ads = active && this.mouse.right;
    const input = {
      mx: active ? (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0) : 0,
      mz: active ? (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0) : 0,
      jump: active && !!K.Space,
      yaw: this.yaw, pitch: this.pitch,
      fire: active && this.mouse.left,
      ads, reload: active && !!P.KeyR,
      slot: this.wantSlot,
      ability: active && !!(P.ShiftLeft || P.ShiftRight)
    };

    // Pick up / drop
    if (active && me.alive) {
      const near = this._nearestDrop(ms.pos, 1.6);
      const emptySlot = near && !ms.inv[weaponById(near.wid).slot];
      if (near && (P.KeyF || P.KeyE || emptySlot) && this.takeCd <= 0) { this.takeCd = 0.4; this._req('take', { drop: near.id }); }
      if (P.KeyG && rs.phase !== 'end') {
        const item = ms.takeHeld();
        if (item) { this._req('dropReq', { wid: item.id, ammo: item.ammo, pos: this._dropPos(ms) }); this.wantSlot = ms.slot; }
      }
    }
    this.pressed = {};

    if (simDt > 0) {
      for (const E of this.ents.values()) {
        if (!E.local) { E.remote.update(); continue; }
        const inp = E === me ? input : E.bot.think(simDt);
        E.sim.update(simDt, inp, (s, a) => this._fire(E, a));
        if (E === me && !ms.inv[this.wantSlot]) this.wantSlot = ms.slot;
        if (E.alive && !E.sim.dead && E.sim.pos.y < this.map.killY) this._announceDeath(E, null, false, null, 'fall');
        this._localEvents(E);
        // Health packs (once per round)
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
    }

    // Walls melt after their timer
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i];
      w.t -= simDt;
      w.grow = Math.min(1, w.grow + simDt * 5);
      w.mesh.scale.y = Math.max(0.05, w.t < 0.5 ? w.t * 2 : w.grow);
      if (w.t <= 0) { this._removeWall(w); this.walls.splice(i, 1); }
    }

    // Network: batch all players this machine owns
    if (this.net) {
      this.sendAcc += dt;
      if (this.sendAcc >= 1 / SEND_HZ) {
        this.sendAcc = 0;
        const list = [];
        for (const E of this.ents.values()) {
          if (!E.local) continue;
          const s = E.sim;
          const f = (s.grounded ? 1 : 0) | (s.dead ? 2 : 0) | (s.shieldT > 0 ? 4 : 0) | ((E === me ? ads : false) ? 16 : 0);
          list.push({ id: E.id, t: performance.now(), p: [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)], v: [r3(s.vel.x), r3(s.vel.y), r3(s.vel.z)], y: r3(s.yaw), pi: r3(s.pitch), w: s.weaponId, f, rl: r3(s.reloadProgress), hp: Math.ceil(s.hp), sh: Math.ceil(s.shield) });
        }
        this.net.send({ type: 'S', list });
      }
    }

    // Models
    this.adsT += ((ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
    for (const E of this.ents.values()) {
      const st = E.st;
      const m = E.model;
      m.root.position.set(st.pos.x, st.pos.y, st.pos.z);
      m.setWeapon(st.weaponId);
      m.update(dt, { vx: st.vel.x, vz: st.vel.z, yaw: st.yaw, pitch: st.pitch, grounded: st.grounded, dead: !E.alive || st.dead, reload: st.reloadProgress, shield: E.local ? st.shieldT > 0 : st.shieldOn });
      m.root.visible = E.connected && (E.local || E.remote.hasState || rs.phase !== 'wait');
    }

    for (const d of this.drops.values()) d.gun.rotation.x += dt * 1.5;
    for (const pk of this.pickups) {
      pk.item.visible = pk.active;
      pk.light.intensity = pk.active ? 6 : 0;
      pk.item.rotation.y += dt * 1.5;
    }

    this.stepAcc += ms.grounded && me.alive ? Math.hypot(ms.vel.x, ms.vel.z) * dt : 0;
    if (this.stepAcc > 2.3) { this.stepAcc = 0; sfx.step(); }

    // Spectating when dead
    if (!me.alive) {
      this.specT = (this.specT ?? 0) - dt;
      const spec = this.specId && this.ents.get(this.specId);
      if (this.specT <= 0 && (!spec || !spec.alive)) this._cycleSpectate();
    }

    this._camera(dt);
    this.fx.update(dt);
    this._hud(dt);
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
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const a = spectating ? 0 : this.adsT;
    const scoped = !!w.scope;
    const deadCam = !spectating && !this.me.alive;
    const baseSide = 0.3 + st.r * (T.char.id === 'tank' ? 1.2 : 0.9);
    const side = baseSide - a * (scoped ? baseSide : 0.08), up = 0.32 - a * (scoped ? 0.2 : 0.04);
    let back = deadCam ? 5 : 3.1 - a * (scoped ? 3.0 : 1.3);
    const eyeY = st.pos.y + st.h * 0.86;

    // Pivot over the shoulder, pulled in if a wall is beside or above the head
    const upHit = this.world.raycast(st.pos.x, eyeY, st.pos.z, 0, 1, 0, up + (deadCam ? 1.5 : 0) + 0.2);
    const upAmt = upHit ? Math.max(0, upHit.t - 0.2) : up + (deadCam ? 1.5 : 0);
    const sideHit = this.world.raycast(st.pos.x, eyeY + upAmt, st.pos.z, rx, 0, rz, side + 0.25);
    const sideAmt = sideHit ? Math.max(0, sideHit.t - 0.25) : side;
    const pivot = _v2.set(st.pos.x + rx * sideAmt, eyeY + upAmt, st.pos.z + rz * sideAmt);

    // Boom collision: several rays in a small cone so the lens never clips through edges
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

    const zoom = 1 + (w.zoom - 1) * a;
    const fov = this.settings.fov / zoom;
    if (Math.abs(cam.fov - fov) > 0.01 || Math.abs(cam.aspect - innerWidth / innerHeight) > 0.001) {
      cam.fov = fov; cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
    }
    // Hide the model we're looking through when the camera is inside it or scoped
    for (const E of this.ents.values()) if (E === T) E.model.root.visible = E.model.root.visible && !(scoped && a > 0.6) && this.camBack > 0.7;
  }

  // ------------------------------------------------------------ HUD
  _project(x, y, z) {
    const v = _v3.set(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }

  _hud(dt) {
    const me = this.me, ms = me.sim, rs = this.rs;
    const T = this._camTarget();
    const w = ms.w;
    const fovR = this.camera.fov * Math.PI / 180;
    const spreadPx = Math.tan(ms.spread(this.adsT > 0.5)) / Math.tan(fovR / 2) * (innerHeight / 2);

    // Line-of-sight cache for enemy nameplates (checked 10x/second)
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.1;
      const c = this.camera.position;
      for (const E of this.ents.values()) this.losCache.set(E.id, this.world.clear(c.x, c.y, c.z, E.st.pos.x, E.st.pos.y + E.st.h * 0.9, E.st.pos.z));
    }
    const plates = [];
    for (const E of this.ents.values()) {
      if (E === T || !E.connected || !E.alive) continue;
      const ally = E.team === this.myTeam;
      const revealed = !ally && this.revealT > 0;
      if (!ally && !revealed && !this.losCache.get(E.id)) continue;
      const pp = this._project(E.st.pos.x, E.st.pos.y + E.st.h + 0.45, E.st.pos.z);
      if (!pp) continue;
      const dist = this.camera.position.distanceTo(_v1.set(E.st.pos.x, E.st.pos.y, E.st.pos.z));
      plates.push({ id: E.id, x: pp.x, y: pp.y, name: E.name, ally, revealed, hp: Math.max(0, E.st.hp / E.char.health), scale: Math.max(0.55, Math.min(1, 12 / dist)) });
    }

    const us = this._team(this.myTeam), them = this._team(1 - this.myTeam);
    const pip = E => ({ color: E.char.color, alive: E.alive && E.connected });
    const near = me.alive && rs.phase !== 'end' ? this._nearestDrop(ms.pos, 1.6) : null;
    let centerText = '';
    if (!me.alive && rs.phase !== 'over') {
      const spec = this.specId && this.ents.get(this.specId);
      centerText = spec ? `SPECTATING <b>${esc(spec.name)}</b><small>Click to switch</small>` : 'YOU ARE DEAD<small>Waiting for next round</small>';
    } else if (rs.phase === 'wait') centerText = 'WAITING FOR PLAYERS…';

    this.hud.update(dt, {
      usScore: rs.score[this.myTeam], themScore: rs.score[1 - this.myTeam],
      usPips: us.map(pip), themPips: them.map(pip),
      time: rs.t, phase: rs.phase === 'wait' ? 'buy' : rs.phase, round: Math.max(1, rs.n),
      hp: ms.hp, maxHp: me.char.health, shield: ms.shield,
      credits: this.credits[me.id] ?? 0,
      weaponName: w.name, ammo: ms.cur.ammo, mag: w.mag, reload: ms.reloadProgress,
      slotP: ms.inv.primary ? weaponById(ms.inv.primary.id).name : null, slotS: ms.inv.sidearm ? weaponById(ms.inv.sidearm.id).name : null, slot: ms.slot,
      abilityCd: ms.abilityCd, abilityCdMax: me.char.abilityCd, abilityActive: ms.shieldT > 0 || ms.overclockT > 0 || ms.dashT > 0,
      spreadPx, showCross: me.alive && !(w.scope && this.adsT > 0.6) && !this.buyOpen,
      scope: !!w.scope && this.adsT > 0.6 && me.alive,
      dead: !me.alive, dmgAngle: this.dmgAngle, reveal: this.revealT > 0,
      centerText,
      prompt: near ? `<kbd>F</kbd> Pick up <b>${weaponById(near.wid).name}</b>` : '',
      buyHint: rs.phase === 'buy' && me.alive && !this.buyOpen,
      ping: this.net ? Math.round(this.net.ping) : null,
      plates
    });
  }

  _buyState() {
    const ms = this.me.sim;
    const owned = new Set();
    for (const k of ['primary', 'sidearm']) if (ms.inv[k]) owned.add(ms.inv[k].id);
    return {
      credits: this.credits[this.me.id] ?? 0, time: this.rs.t, owned, shield: ms.shield,
      team: this._team(this.myTeam).filter(E => E !== this.me).map(E => ({ name: esc(E.name), credits: this.credits[E.id] ?? 0, color: hexs(E.char.color) }))
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
