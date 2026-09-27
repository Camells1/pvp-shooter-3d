// AI player. Produces the same input object a human player would.
const DIFF = {
  easy:   { reaction: 0.75, aimErr: 0.1,  aimSpeed: 3.5, burst: 0.55 },
  normal: { reaction: 0.4,  aimErr: 0.05, aimSpeed: 7,   burst: 0.8 },
  hard:   { reaction: 0.2,  aimErr: 0.022, aimSpeed: 13, burst: 1 }
};
// Preferred fighting distance per weapon
const RANGE = { classic: 14, mpistol: 9, cannon: 16, smg: 10, shotgun: 5, ar: 18, scout: 26, sniper: 30, lmg: 16 };

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Bot {
  /**
   * ctx: { enemies(): [state], allies(): [state], pickups: [...], drops(): [{id, wid, pos}], wantsDrop(dropId) }
   */
  constructor(player, world, difficulty, ctx) {
    this.p = player; this.world = world; this.ctx = ctx;
    this.d = DIFF[difficulty] || DIFF.normal;
    this.yaw = player.yaw; this.pitch = 0;
    this.seeT = 0; this.strafe = 1; this.strafeT = 0;
    this.path = null; this.pathT = 0; this.pathI = 0; this.pathGoal = null;
    this.errX = 0; this.errY = 0; this.errT = 0;
    this.stuckT = 0; this.lastPos = { ...player.pos }; this.lastCheck = 0;
    this.lastHp = player.hp; this.hurtT = 0;
    this.burstT = 0;
    this.target = null; this.targetT = 0;
  }

  reset() { this.path = null; this.target = null; this.seeT = 0; this.yaw = this.p.yaw; this.pitch = 0; this.lastHp = this.p.hp; }

  canSee(t) {
    const p = this.p.pos;
    return this.world.clear(p.x, p.y + 1.55, p.z, t.pos.x, t.pos.y + 1.2, t.pos.z);
  }

  think(dt) {
    const p = this.p, d = this.d;
    const input = { mx: 0, mz: 0, jump: false, yaw: this.yaw, pitch: this.pitch, fire: false, ads: false, reload: false, slot: p.inv.primary ? 'primary' : 'sidearm', ability: false };
    if (p.dead) { this.path = null; return input; }

    if (p.hp < this.lastHp) this.hurtT = 1.5;
    this.lastHp = p.hp;
    this.hurtT -= dt;

    // Pick a target: nearest visible enemy, else nearest enemy
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
    } else {
      this.visible = this.canSee(this.target);
    }
    const t = this.target;
    this.seeT = this.visible ? this.seeT + dt : 0;

    this.errT -= dt;
    if (this.errT <= 0) { this.errT = 0.3 + Math.random() * 0.5; this.errX = (Math.random() - 0.5) * 2 * d.aimErr; this.errY = (Math.random() - 0.5) * 2 * d.aimErr * 0.6; }

    let moveX = 0, moveZ = 0, lookYaw = this.yaw, lookPitch = 0;
    const lowHp = p.hp < p.char.health * 0.45;
    const wid = p.weaponId;

    // Grab a nearby dropped gun if we have no primary and nobody is shooting at us
    let goal = null;
    if (!p.inv.primary && !this.visible) {
      let bd = 14;
      for (const dr of this.ctx.drops()) {
        const dd = Math.hypot(dr.pos[0] - p.pos.x, dr.pos[2] - p.pos.z);
        if (dd < bd && Math.abs(dr.pos[1] - p.pos.y) < 3) { bd = dd; goal = { x: dr.pos[0], y: dr.pos[1], z: dr.pos[2], drop: dr.id }; }
      }
      if (goal && bd < 1.4) this.ctx.wantsDrop(goal.drop);
    }
    if (!goal && lowHp && !this.visible) {
      const pk = this.nearestPickup();
      if (pk) goal = { x: pk.pos[0], y: pk.pos[1], z: pk.pos[2] };
    }

    if (t && this.visible && !goal) {
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

      const c = p.char;
      if (p.abilityCd <= 0) {
        if (c.ability === 'shield' && this.hurtT > 0 && p.hp < c.health * 0.7) input.ability = true;
        if (c.ability === 'overclock' && dist < 20) input.ability = true;
        if (c.ability === 'dash' && (dist > pref + 8 || (lowHp && Math.random() < dt))) input.ability = true;
        if (c.ability === 'blink' && this.hurtT > 0 && Math.random() < dt * 2) input.ability = true;
        if (c.ability === 'heal' && p.hp < c.health * 0.6) input.ability = true;
        if (c.ability === 'wall' && this.hurtT > 0 && lowHp) input.ability = true;
      }
      this.path = null;
    } else {
      const g = goal || (t ? t.pos : null);
      if (g) {
        this.pathT -= dt;
        if (!this.path || this.pathT <= 0) {
          this.pathT = 0.6;
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
        const mx = tx - p.pos.x, mz = tz - p.pos.z, ml = Math.hypot(mx, mz) || 1;
        moveX = mx / ml; moveZ = mz / ml;
        if (wp && wp.y - p.pos.y > 0.55 && ml < 2.2 && p.grounded) input.jump = true;
        lookYaw = Math.atan2(-moveX, -moveZ);
        if (p.cur.ammo < p.w.mag / 2) input.reload = true;
        if (p.abilityCd <= 0 && p.char.ability === 'pulse' && t && Math.random() < dt * 0.3) input.ability = true;
        if (p.abilityCd <= 0 && t && Math.abs(angDiff(this.yaw, lookYaw)) < 0.1 && Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) > 18) {
          if (p.char.ability === 'dash' || (p.char.ability === 'blink' && ml > 6)) input.ability = true;
        }
      }
    }

    // Stuck detection
    this.lastCheck += dt;
    if (this.lastCheck > 0.6) {
      const moved = Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z);
      this.stuckT = (moved < 0.6 && (moveX || moveZ) && !p.frozen) ? this.stuckT + this.lastCheck : 0;
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

// What a bot buys with its credits. Returns a list of item ids.
export function botShopping(credits, player) {
  const buys = [];
  let c = credits;
  if (!player.inv.primary) {
    const r = Math.random();
    let pick = null;
    if (c >= 4200 && r < 0.15) pick = 'sniper';
    else if (c >= 3200 && r < 0.25) pick = 'lmg';
    else if (c >= 2900) pick = 'ar';
    else if (c >= 1800) pick = r < 0.5 ? 'shotgun' : 'smg';
    else if (c >= 1500) pick = 'smg';
    else if (c >= 1100 && r < 0.5) pick = 'scout';
    if (pick) { buys.push(pick); c -= { sniper: 4200, lmg: 3200, ar: 2900, shotgun: 1800, smg: 1500, scout: 1100 }[pick]; }
  }
  if (c >= 1000 && player.shield < 50) { buys.push('heavy'); c -= 1000; }
  else if (c >= 400 && player.shield < 25) { buys.push('light'); c -= 400; }
  if (!player.inv.primary && !buys.length && player.inv.sidearm?.id === 'classic' && c >= 900) buys.push('cannon');
  return buys;
}
