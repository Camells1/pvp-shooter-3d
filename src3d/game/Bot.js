// AI player. Produces the same input object a human player would.
const DIFF = {
  easy:   { reaction: 0.75, aimErr: 0.1,  aimSpeed: 3.5, burst: 0.55, abil: 0.3 },
  normal: { reaction: 0.4,  aimErr: 0.05, aimSpeed: 7,   burst: 0.8, abil: 0.6 },
  hard:   { reaction: 0.2,  aimErr: 0.022, aimSpeed: 13, burst: 1, abil: 1 }
};
const RANGE = { classic: 14, shorty: 4, mpistol: 9, cannon: 16, stinger: 9, smg: 10, shotgun: 5, carbine: 17, marksman: 26, ar: 18, scout: 26, sniper: 30, lmg: 16 };
// Abilities a bot fires at an enemy it can see (the rest are used situationally below)
const COMBAT = new Set(['firebomb', 'rocket', 'quake', 'chain', 'storm', 'nova', 'freeze', 'overclock', 'shield', 'smoke', 'pulse', 'overwatch', 'mine', 'wall']);

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Bot {
  /**
   * ctx: { enemies(): [state], pickups, drops(), wantsDrop(id), clear(a, b), objective(): {x,y,z,use,radius}|null }
   */
  constructor(player, world, difficulty, ctx) {
    this.p = player; this.world = world; this.ctx = ctx;
    this.d = DIFF[difficulty] || DIFF.normal;
    this.yaw = player.yaw; this.pitch = 0;
    this.seeT = 0; this.strafe = 1; this.strafeT = 0;
    this.path = null; this.pathT = 0; this.pathI = 0;
    this.errX = 0; this.errY = 0; this.errT = 0;
    this.stuckT = 0; this.lastPos = { ...player.pos }; this.lastCheck = 0;
    this.lastHp = player.hp; this.hurtT = 0;
    this.burstT = 0; this.abilT = 1;
    this.target = null; this.targetT = 0;
  }

  reset() { this.path = null; this.target = null; this.seeT = 0; this.yaw = this.p.yaw; this.pitch = 0; this.lastHp = this.p.hp; }

  canSee(t) {
    const p = this.p.pos;
    const dist = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
    if (t.cloaked && dist > 4) return false;
    return this.ctx.clear({ x: p.x, y: p.y + 1.55, z: p.z }, { x: t.pos.x, y: t.pos.y + 1.2, z: t.pos.z });
  }

  think(dt) {
    const p = this.p, d = this.d;
    const input = { mx: 0, mz: 0, jump: false, walk: false, yaw: this.yaw, pitch: this.pitch, fire: false, ads: false, reload: false, slot: p.inv.primary ? 'primary' : 'sidearm', ab: null, use: false };
    if (p.dead) { this.path = null; return input; }

    if (p.hp < this.lastHp) this.hurtT = 1.5;
    this.lastHp = p.hp;
    this.hurtT -= dt;
    this.abilT -= dt;

    this.targetT -= dt;
    const enemies = this.ctx.enemies();
    if (this.targetT <= 0 || !this.target || this.target.dead) {
      this.targetT = 0.3;
      let best = null, bd = Infinity, vis = false;
      for (const e of enemies) {
        const dist = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        const see = this.canSee(e);
        const score = dist - (see ? 1000 : 0);
        if (score < bd) { bd = score; best = e; vis = see; }
      }
      if (best !== this.target) this.seeT = 0;
      this.target = best;
      this.visible = vis;
    } else this.visible = this.canSee(this.target);
    const t = this.target;
    this.seeT = this.visible ? this.seeT + dt : 0;

    this.errT -= dt;
    if (this.errT <= 0) { this.errT = 0.3 + Math.random() * 0.5; this.errX = (Math.random() - 0.5) * 2 * d.aimErr; this.errY = (Math.random() - 0.5) * 2 * d.aimErr * 0.6; }

    let moveX = 0, moveZ = 0, lookYaw = this.yaw, lookPitch = 0, fighting = false;
    const lowHp = p.hp < p.char.health * 0.45;
    const wid = p.weaponId;
    const abs = p.char.abilities;

    // Goals when nobody is in view: the objective, a dropped gun, health, or the nearest enemy
    let goal = null;
    const obj = this.ctx.objective?.();
    if (obj) goal = obj;
    if (!p.inv.primary && !this.visible && !(obj && obj.use)) {
      let bd = 14;
      for (const dr of this.ctx.drops()) {
        const dd = Math.hypot(dr.pos[0] - p.pos.x, dr.pos[2] - p.pos.z);
        if (dd < bd && Math.abs(dr.pos[1] - p.pos.y) < 3) { bd = dd; goal = { x: dr.pos[0], y: dr.pos[1], z: dr.pos[2], drop: dr.id }; }
      }
      if (goal && goal.drop && bd < 1.4) this.ctx.wantsDrop(goal.drop);
    }
    if (!goal && lowHp && !this.visible) {
      const pk = this.nearestPickup();
      if (pk) goal = { x: pk.pos[0], y: pk.pos[1], z: pk.pos[2] };
    }

    // Standing on the objective (planting / defusing)
    if (obj && obj.use && Math.hypot(obj.x - p.pos.x, obj.z - p.pos.z) < (obj.radius ?? 1.2) && !(this.visible && t && Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) < 15)) {
      input.use = true;
      lookYaw = this.yaw; lookPitch = -0.4;
    } else if (t && this.visible) {
      fighting = true;
      const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, dy = (t.pos.y + 1.2) - (p.pos.y + 1.55);
      const dist = Math.hypot(dx, dz);
      lookYaw = Math.atan2(-dx, -dz) + this.errX;
      lookPitch = Math.atan2(dy, dist) + this.errY;
      const pref = RANGE[wid] ?? 14;
      const toward = dist > pref + 2 ? 1 : dist < pref - 2 ? -1 : 0;
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.5 + Math.random() * 1.1; this.strafe = Math.random() < 0.5 ? -1 : 1; }
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      moveX = nx * toward - nz * this.strafe * 0.9;
      moveZ = nz * toward + nx * this.strafe * 0.9;
      if (Math.random() < dt * 0.5) input.jump = true;
      const aimOff = Math.abs(angDiff(this.yaw, lookYaw)) + Math.abs(this.pitch - lookPitch);
      this.burstT -= dt;
      if (this.burstT <= 0) this.burstT = Math.random() < d.burst ? 0.8 : -0.5;
      input.fire = this.seeT > d.reaction && aimOff < 0.12 + 0.6 / Math.max(dist, 1) && this.burstT > 0;
      input.ads = (wid === 'sniper' || wid === 'scout') && dist > 12;

      // Abilities in a fight
      if (this.abilT <= 0 && aimOff < 0.2 && this.seeT > d.reaction) {
        this.abilT = 1.2 / d.abil;
        for (const [i, key] of [[2, 'X'], [1, 'E'], [0, 'Q']]) {
          const ab = abs[i];
          if (!p.canUse(key)) continue;
          const combat = COMBAT.has(ab.id) || (ab.id === 'dash' && dist > pref + 8) || (ab.id === 'blink' && this.hurtT > 0) || (ab.id === 'cloak') || ((ab.id === 'heal' || ab.id === 'fortify') && p.hp < p.char.health * 0.6);
          if (combat && Math.random() < d.abil) { input.ab = key; break; }
        }
      }
      this.path = null;
    } else {
      const g = goal || (t ? t.pos : null);
      if (g) {
        this.pathT -= dt;
        // Re-plan on a timer, or right away when the kind of goal changes (not every time a target moves)
        const gk = g === goal ? (goal.drop ? 'drop' + goal.drop : Math.round(g.x) + ',' + Math.round(g.z)) : 'target';
        if (!this.path || this.pathT <= 0 || this.pathGoal !== gk) {
          this.pathT = 0.6; this.pathGoal = gk;
          this.path = this.world.findPath(this.world.nearestNode(p.pos.x, p.pos.y, p.pos.z), this.world.nearestNode(g.x, g.y, g.z));
          this.pathI = 1;
        }
        let wp = null;
        if (this.path) {
          while (this.pathI < this.path.length) {
            const n = this.path[this.pathI];
            if (Math.hypot(n.x - p.pos.x, n.z - p.pos.z) < 0.9 && Math.abs(n.y - p.pos.y) < 1.2) this.pathI++;
            else break;
          }
          wp = this.path[this.pathI] || null;
        }
        const tx = wp ? wp.x : g.x, tz = wp ? wp.z : g.z;
        const mx = tx - p.pos.x, mz = tz - p.pos.z, ml = Math.hypot(mx, mz);
        if (ml > 0.3) { moveX = mx / ml; moveZ = mz / ml; }
        if (wp && wp.y - p.pos.y > 0.55 && ml < 2.2 && p.grounded) input.jump = true;
        if (ml > 0.3) lookYaw = Math.atan2(-moveX, -moveZ);
        if (p.cur.ammo < p.w.mag / 2) input.reload = true;
        // Utility on the move
        if (this.abilT <= 0) {
          this.abilT = 2 / d.abil;
          if (abs[0].id === 'pulse' && p.canUse('Q') && Math.random() < 0.3) input.ab = 'Q';
          if (abs[1].id === 'heal' && p.canUse('E') && p.hp < p.char.health * 0.7) input.ab = 'E';
          if (abs[0].id === 'heal' && p.canUse('Q') && p.hp < p.char.health * 0.7) input.ab = 'Q';
          if (abs[2].id === 'revive' && p.canUse('X') && this.ctx.canRevive?.()) input.ab = 'X';
          if (abs[2].id === 'overwatch' && p.canUse('X') && Math.random() < 0.3) input.ab = 'X';
        }
      }
    }

    // Never strafe off a ledge into a drop (path following already avoids holes)
    if (fighting && (moveX || moveZ) && p.grounded) {
      const ml = Math.hypot(moveX, moveZ) || 1, ax = p.pos.x + moveX / ml * 0.8, az = p.pos.z + moveZ / ml * 0.8;
      if (this.world.groundBelow(ax, az, 0.1, p.pos.y + 0.7, 2.6) === -Infinity) { moveX = 0; moveZ = 0; this.strafe *= -1; input.jump = false; }
    }

    this.lastCheck += dt;
    if (this.lastCheck > 0.6) {
      const moved = Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z);
      this.stuckT = (moved < 0.6 && (moveX || moveZ) && !p.frozen && !input.use) ? this.stuckT + this.lastCheck : 0;
      this.lastPos = { ...p.pos }; this.lastCheck = 0;
      if (this.stuckT > 0) input.jump = true;
      if (this.stuckT > 1.8) { this.path = null; this.strafe *= -1; this.stuckT = 0; }
    }

    const k = Math.min(1, dt * d.aimSpeed);
    this.yaw += angDiff(lookYaw, this.yaw) * k;
    this.pitch += (lookPitch - this.pitch) * k;
    input.yaw = this.yaw; input.pitch = this.pitch;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    input.mz = moveX * fx + moveZ * fz;
    input.mx = moveX * -fz + moveZ * fx;
    return input;
  }

  nearestPickup() {
    let best = null, bd = Infinity;
    for (const pk of this.ctx.pickups) {
      if (!pk.active) continue;
      const d = Math.hypot(pk.pos[0] - this.p.pos.x, pk.pos[2] - this.p.pos.z);
      if (d < bd) { bd = d; best = pk; }
    }
    return best;
  }
}

// Practice-range target: stands still or strafes, never shoots back.
export class Dummy {
  constructor(player, kind) { this.p = player; this.kind = kind; this.t = Math.random() * 2; this.dir = 1; }
  reset() {}
  think(dt) {
    this.t += dt;
    if (this.t > 1.3) { this.t = 0; this.dir *= -1; }
    return { mx: this.kind === 'strafe' ? this.dir : 0, mz: 0, jump: false, walk: false, yaw: this.p.yaw, pitch: 0, fire: false, ads: false, reload: false, slot: 'sidearm', ab: null, use: false };
  }
}

// What a bot buys with its credits. Returns a list of item ids.
export function botShopping(credits, player) {
  const buys = [];
  let c = credits;
  if (!player.inv.primary) {
    const r = Math.random();
    let pick = null;
    if (c >= 4200 && r < 0.15) pick = 'sniper';
    else if (c >= 3200 && r < 0.25) pick = 'lmg';
    else if (c >= 2900) pick = r < 0.7 ? 'ar' : 'marksman';
    else if (c >= 2500) pick = r < 0.5 ? 'marksman' : 'carbine';
    else if (c >= 2100) pick = 'carbine';
    else if (c >= 1800) pick = r < 0.5 ? 'shotgun' : 'smg';
    else if (c >= 1500) pick = 'smg';
    else if (c >= 1100) pick = r < 0.5 ? 'scout' : 'stinger';
    if (pick) { buys.push(pick); c -= { sniper: 4200, lmg: 3200, ar: 2900, marksman: 2500, carbine: 2100, shotgun: 1800, smg: 1500, scout: 1100, stinger: 1100 }[pick]; }
  }
  if (c >= 1000 && player.shield < 50) { buys.push('heavy'); c -= 1000; }
  else if (c >= 400 && player.shield < 25) { buys.push('light'); c -= 400; }
  if (!player.inv.primary && !buys.length && player.inv.sidearm?.id === 'classic') {
    if (c >= 900) buys.push('cannon'); else if (c >= 300 && Math.random() < 0.5) buys.push('shorty');
  }
  return buys;
}
