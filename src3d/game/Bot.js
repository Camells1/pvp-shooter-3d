// AI opponent. Produces the same input object a human player would.
const DIFF = {
  easy:   { reaction: 0.75, aimErr: 0.1,  aimSpeed: 3.5, burst: 0.55 },
  normal: { reaction: 0.4,  aimErr: 0.05, aimSpeed: 7,   burst: 0.8 },
  hard:   { reaction: 0.2,  aimErr: 0.022, aimSpeed: 13, burst: 1 }
};
const RANGE = [16, 10, 5, 28]; // preferred distance per weapon

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Bot {
  constructor(player, target, world, difficulty = 'normal', pickups) {
    this.p = player; this.t = target; this.world = world;
    this.d = DIFF[difficulty] || DIFF.normal;
    this.pickups = pickups;
    this.yaw = player.yaw; this.pitch = 0;
    this.seeT = 0; this.strafe = 1; this.strafeT = 0;
    this.weapon = 1; this.weaponT = 0;
    this.path = null; this.pathT = 0; this.pathI = 0;
    this.errX = 0; this.errY = 0; this.errT = 0;
    this.stuckT = 0; this.lastPos = { ...player.pos }; this.lastCheck = 0;
    this.lastHp = player.hp; this.hurtT = 0;
    this.burstT = 0;
  }

  lineOfSight() {
    const p = this.p.pos, t = this.t.pos;
    return this.world.clear(p.x, p.y + 1.55, p.z, t.x, t.y + 1.2, t.z);
  }

  think(dt) {
    const p = this.p, t = this.t, d = this.d;
    const input = { mx: 0, mz: 0, jump: false, yaw: this.yaw, pitch: this.pitch, fire: false, ads: false, reload: false, weapon: this.weapon, ability: false };
    if (p.dead) { this.path = null; return input; }

    if (p.hp < this.lastHp) this.hurtT = 1.5;
    this.lastHp = p.hp;
    this.hurtT -= dt;

    const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, dy = (t.pos.y + 1.2) - (p.pos.y + 1.55);
    const dist = Math.hypot(dx, dz);
    const los = !t.dead && this.lineOfSight();
    this.seeT = los ? this.seeT + dt : 0;

    // Wander aim error
    this.errT -= dt;
    if (this.errT <= 0) { this.errT = 0.3 + Math.random() * 0.5; this.errX = (Math.random() - 0.5) * 2 * d.aimErr; this.errY = (Math.random() - 0.5) * 2 * d.aimErr * 0.6; }

    let moveX = 0, moveZ = 0; // world direction
    let lookYaw = this.yaw, lookPitch = 0;

    const lowHp = p.hp < p.char.health * 0.45;
    const pickup = lowHp ? this.nearestPickup() : null;

    if (los && !(lowHp && pickup && dist > 12)) {
      // ---- Combat
      this.weaponT -= dt;
      if (this.weaponT <= 0) {
        this.weaponT = 1.5 + Math.random();
        this.weapon = dist < 7 ? 2 : dist < 13 ? 1 : dist < 24 ? 0 : 3;
        if (Math.random() < 0.15) this.weapon = Math.floor(Math.random() * 4);
      }
      lookYaw = Math.atan2(-dx, -dz) + this.errX;
      lookPitch = Math.atan2(dy, dist) + this.errY;

      const pref = RANGE[this.weapon];
      const toward = dist > pref + 2 ? 1 : dist < pref - 2 ? -1 : 0;
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.5 + Math.random() * 1.1; this.strafe = Math.random() < 0.5 ? -1 : 1; }
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      moveX = nx * toward + -nz * this.strafe * 0.9;
      moveZ = nz * toward + nx * this.strafe * 0.9;
      if (Math.random() < dt * 0.5) input.jump = true;

      const aimOff = Math.abs(angDiff(this.yaw, lookYaw)) + Math.abs(this.pitch - lookPitch);
      this.burstT -= dt;
      if (this.burstT <= 0) this.burstT = Math.random() < d.burst ? 0.8 : -0.5;
      input.fire = this.seeT > d.reaction && aimOff < 0.12 + 0.6 / Math.max(dist, 1) && this.burstT > 0;
      input.ads = this.weapon === 3 && dist > 15;

      const c = p.char;
      if (p.abilityCd <= 0) {
        if (c.ability === 'shield' && this.hurtT > 0 && p.hp < c.health * 0.7) input.ability = true;
        if (c.ability === 'overclock' && dist < 20) input.ability = true;
        if (c.ability === 'dash' && (dist > pref + 8 || (lowHp && Math.random() < dt))) input.ability = true;
        if (c.ability === 'blink' && this.hurtT > 0 && Math.random() < dt * 2) input.ability = true;
      }
      this.path = null;
    } else {
      // ---- Navigate (to target, or to a health pickup)
      const goal = pickup ? { x: pickup.pos[0], y: pickup.pos[1], z: pickup.pos[2] } : t.pos;
      this.pathT -= dt;
      if (!this.path || this.pathT <= 0) {
        this.pathT = 0.6;
        this.path = this.world.findPath(this.world.nearestNode(p.pos.x, p.pos.y, p.pos.z), this.world.nearestNode(goal.x, goal.y, goal.z));
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
      const tx = wp ? wp.x : goal.x, tz = wp ? wp.z : goal.z;
      const mx = tx - p.pos.x, mz = tz - p.pos.z, ml = Math.hypot(mx, mz) || 1;
      moveX = mx / ml; moveZ = mz / ml;
      if (wp && wp.y - p.pos.y > 0.55 && ml < 2.2 && p.grounded) input.jump = true;
      lookYaw = Math.atan2(-moveX, -moveZ);
      lookPitch = 0;
      if (p.ammo[this.weapon] < p.w.mag / 2) input.reload = true;
      if (p.abilityCd <= 0 && dist > 18 && Math.abs(angDiff(this.yaw, lookYaw)) < 0.1) {
        if (p.char.ability === 'dash' || (p.char.ability === 'blink' && ml > 6)) input.ability = true;
      }
    }

    // Stuck detection
    this.lastCheck += dt;
    if (this.lastCheck > 0.6) {
      const moved = Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z);
      this.stuckT = (moved < 0.6 && (moveX || moveZ)) ? this.stuckT + this.lastCheck : 0;
      this.lastPos = { ...p.pos }; this.lastCheck = 0;
      if (this.stuckT > 0) input.jump = true;
      if (this.stuckT > 1.8) { this.path = null; this.strafe *= -1; this.stuckT = 0; }
    }

    // Smooth aim
    const k = Math.min(1, dt * d.aimSpeed);
    this.yaw += angDiff(lookYaw, this.yaw) * k;
    this.pitch += (lookPitch - this.pitch) * k;
    input.yaw = this.yaw; input.pitch = this.pitch;

    // World move dir -> local input
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    input.mz = moveX * fx + moveZ * fz;
    input.mx = moveX * rx + moveZ * rz;
    input.weapon = this.weapon;
    return input;
  }

  nearestPickup() {
    let best = null, bd = Infinity;
    for (const pk of this.pickups) {
      if (!pk.active) continue;
      const d = Math.hypot(pk.pos[0] - this.p.pos.x, pk.pos[2] - this.p.pos.z);
      if (d < bd) { bd = d; best = pk; }
    }
    return best;
  }
}
