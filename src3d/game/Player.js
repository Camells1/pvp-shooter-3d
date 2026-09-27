// Player simulation: movement, collision, weapons state, abilities.
import { WEAPONS, GRAVITY, SPAWN_PROTECT } from './data.js';

const STEP = 0.62;

export class Player {
  constructor(char, world) {
    this.char = char;
    this.world = world;
    this.r = char.radius;
    this.h = char.height;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0;
    this.kills = 0; this.deaths = 0;
    this.shots = 0; this.hits = 0; this.headshots = 0;
    this.events = [];
    this.weapon = 0;
    this.reset([0, 0, 0]);
  }

  reset(spawn) {
    this.pos.x = spawn[0]; this.pos.y = spawn[1] + 0.01; this.pos.z = spawn[2];
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.hp = this.char.health;
    this.dead = false;
    this.grounded = false;
    this.ammo = WEAPONS.map(w => w.mag);
    this.fireCd = 0;
    this.reloadT = -1;
    this.abilityCd = 0;
    this.dashT = 0; this.shieldT = 0; this.overclockT = 0;
    this.protectT = SPAWN_PROTECT;
    this.bloom = 0;
    this.airTime = 0;
    this.lastFire = false;
  }

  get w() { return WEAPONS[this.weapon]; }
  get invulnerable() { return this.shieldT > 0 || this.protectT > 0; }
  get reloadProgress() { return this.reloadT < 0 ? -1 : 1 - this.reloadT / this.w.reload; }

  forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }

  spread(ads) {
    const w = this.w;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let s = w.spread + w.moveSpread * Math.min(1, sp / 6) + this.bloom;
    if (!this.grounded) s += 0.03;
    if (ads) s *= w.adsSpread;
    return s;
  }

  // input: { mx, mz, jump, yaw, pitch, fire, ads, reload, weapon, ability }
  update(dt, input, onFire) {
    this.yaw = input.yaw; this.pitch = input.pitch;
    if (this.protectT > 0) this.protectT -= dt;
    if (this.dead) return;

    // Timers
    this.fireCd -= dt;
    this.abilityCd = Math.max(0, this.abilityCd - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.overclockT = Math.max(0, this.overclockT - dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.12);

    // Weapon switch
    if (input.weapon !== undefined && input.weapon !== this.weapon) {
      this.weapon = input.weapon;
      this.reloadT = -1;
      this.fireCd = Math.max(this.fireCd, 0.25);
      this.events.push({ type: 'switch' });
    }

    // Reload
    if (this.reloadT >= 0) {
      this.reloadT -= dt * (this.overclockT > 0 ? 4 : 1);
      if (this.reloadT < 0) { this.ammo[this.weapon] = this.w.mag; this.reloadT = -1; this.events.push({ type: 'reloaded' }); }
    } else if ((input.reload && this.ammo[this.weapon] < this.w.mag) || (this.ammo[this.weapon] === 0)) {
      this.reloadT = this.w.reload;
      this.events.push({ type: 'reload' });
    }

    // Fire
    if (input.fire && this.fireCd <= 0 && this.reloadT < 0 && this.ammo[this.weapon] > 0) {
      const rate = this.w.rate * (this.overclockT > 0 ? 0.5 : 1);
      this.fireCd = rate;
      this.ammo[this.weapon]--;
      this.shots++;
      this.protectT = 0;
      onFire?.(this, input.ads);
      this.bloom = Math.min(0.05, this.bloom + this.w.recoil * 0.25);
    }

    // Ability
    if (input.ability && this.abilityCd <= 0) this.useAbility(input);

    this.move(dt, input);
  }

  useAbility(input) {
    const c = this.char;
    this.abilityCd = c.abilityCd;
    if (c.ability === 'dash') {
      let dx = 0, dz = 0;
      const f = this.forward(), rx = -f.z, rz = f.x;
      if (input.mx || input.mz) { dx = f.x * input.mz + rx * input.mx; dz = f.z * input.mz + rz * input.mx; }
      else { dx = f.x; dz = f.z; }
      const l = Math.hypot(dx, dz) || 1;
      this.dashDir = { x: dx / l, z: dz / l };
      this.dashT = 0.2;
      this.events.push({ type: 'dash' });
    } else if (c.ability === 'shield') {
      this.shieldT = 2.5;
      this.events.push({ type: 'shield' });
    } else if (c.ability === 'overclock') {
      this.overclockT = 4;
      this.events.push({ type: 'overclock' });
    } else if (c.ability === 'blink') {
      const from = { ...this.pos };
      const f = this.forward();
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      let dx = f.x * cp, dy = Math.max(-0.3, sp), dz = f.z * cp;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const oy = this.pos.y + 1.0;
      const hit = this.world.raycast(this.pos.x, oy, this.pos.z, dx, dy, dz, 9);
      let dist = hit ? Math.max(0, hit.t - this.r - 0.2) : 9;
      let placed = false;
      for (; dist >= 0 && !placed; dist -= 0.5) {
        const tx = this.pos.x + dx * dist, tz = this.pos.z + dz * dist;
        const ty = Math.max(this.pos.y + dy * dist, this.pos.y - 3);
        for (let up = 0; up <= 1.6; up += 0.4) {
          if (this.world.fits(tx, ty + up, tz, this.r, this.h)) {
            this.pos.x = tx; this.pos.y = ty + up; this.pos.z = tz; placed = true; break;
          }
        }
      }
      this.vel.y = Math.max(this.vel.y, 0);
      this.events.push({ type: 'blink', from, to: { ...this.pos } });
    }
  }

  move(dt, input) {
    const c = this.char;
    const f = this.forward(), rx = -f.z, rz = f.x;
    let wx = f.x * input.mz + rx * input.mx, wz = f.z * input.mz + rz * input.mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    let speed = c.speed * (input.ads ? 0.62 : 1);
    if (this.reloadT >= 0) speed *= 0.9;

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.x = this.dashDir.x * 24;
      this.vel.z = this.dashDir.z * 24;
      this.vel.y = Math.max(this.vel.y, -1);
    } else {
      const accel = this.grounded ? 70 : 16;
      const tx = wx * speed, tz = wz * speed;
      let dvx = tx - this.vel.x, dvz = tz - this.vel.z;
      const dl = Math.hypot(dvx, dvz), max = accel * dt;
      if (dl > max) { dvx *= max / dl; dvz *= max / dl; }
      // In the air, don't bleed momentum when there's no input
      if (!this.grounded && wl < 0.01) { dvx = 0; dvz = 0; }
      this.vel.x += dvx; this.vel.z += dvz;
      this.vel.y -= GRAVITY * dt;
    }

    if (input.jump && this.grounded) {
      this.vel.y = c.jump;
      this.grounded = false;
      this.events.push({ type: 'jump' });
    }

    const wasGrounded = this.grounded;
    const fallSpeed = this.vel.y;
    this.grounded = false;
    const maxMove = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt;
    const steps = Math.max(1, Math.ceil(maxMove / 0.2));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this._axis('x', this.vel.x * sdt, wasGrounded);
      this._axis('z', this.vel.z * sdt, wasGrounded);
      this._axis('y', this.vel.y * sdt, wasGrounded);
    }
    // Snap down stairs/slopes
    if (!this.grounded && wasGrounded && this.vel.y <= 0) {
      const g = this.world.groundBelow(this.pos.x, this.pos.z, this.r * 0.9, this.pos.y, 0.7);
      if (g > -Infinity && this.world.fits(this.pos.x, g, this.pos.z, this.r, this.h)) { this.pos.y = g; this.grounded = true; this.vel.y = 0; }
    }
    if (this.grounded && !wasGrounded && fallSpeed < -6) this.events.push({ type: 'land', speed: -fallSpeed });
    if (!this.grounded) this.airTime += dt; else this.airTime = 0;
  }

  _axis(axis, amt, wasGrounded) {
    if (!amt) return;
    const p = this.pos, r = this.r, h = this.h;
    p[axis] += amt;
    for (let iter = 0; iter < 4; iter++) {
      const b = this.world.overlap(p.x - r, p.y, p.z - r, p.x + r, p.y + h, p.z + r);
      if (!b) return;
      if (axis === 'y') {
        if (amt < 0) { p.y = b.max.y; this.grounded = true; }
        else p.y = b.min.y - h - 0.001;
        this.vel.y = 0;
        return;
      }
      // Step up onto low obstacles
      const stepH = b.max.y - p.y;
      if ((wasGrounded || this.grounded) && stepH > 0 && stepH <= STEP && this.world.fits(p.x, b.max.y, p.z, r, h)) {
        p.y = b.max.y;
        continue;
      }
      if (amt > 0) p[axis] = b.min[axis] - r - 0.001;
      else p[axis] = b.max[axis] + r + 0.001;
      this.vel[axis] = 0;
    }
  }

  takeDamage(dmg) {
    if (this.dead || this.invulnerable) return false;
    this.hp = Math.max(0, this.hp - dmg);
    return true;
  }
}
