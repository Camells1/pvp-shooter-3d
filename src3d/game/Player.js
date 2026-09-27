// Player simulation: movement, collision, loadout, shields and abilities.
import { weaponById, GRAVITY } from './data.js';

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
    this.shots = 0; this.hits = 0; this.headshots = 0;
    this.events = [];
    this.inv = { primary: null, sidearm: { id: 'classic', ammo: weaponById('classic').mag } };
    this.slot = 'sidearm';
    this.shield = 0;
    this.frozen = false;
    this.reset([0, 0, 0], false);
  }

  // Start of a round. Survivors keep their loadout and shield.
  reset(spawn, keepLoadout) {
    this.pos.x = spawn[0]; this.pos.y = spawn[1] + 0.01; this.pos.z = spawn[2];
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.hp = this.char.health;
    this.dead = false;
    this.grounded = false;
    if (!keepLoadout) {
      this.inv = { primary: null, sidearm: { id: 'classic', ammo: weaponById('classic').mag } };
      this.shield = 0;
    }
    for (const k of ['primary', 'sidearm']) if (this.inv[k]) this.inv[k].ammo = weaponById(this.inv[k].id).mag;
    this.slot = this.inv.primary ? 'primary' : 'sidearm';
    this.fireCd = 0;
    this.reloadT = -1;
    this.abilityCd = 0;
    this.dashT = 0; this.shieldT = 0; this.overclockT = 0;
    this.bloom = 0;
    this.airTime = 0;
  }

  get cur() { return this.inv[this.slot] || this.inv.sidearm; }
  get weaponId() { return this.cur.id; }
  get w() { return weaponById(this.cur.id); }
  get invulnerable() { return this.shieldT > 0; }
  get reloadProgress() { return this.reloadT < 0 ? -1 : 1 - this.reloadT / this.w.reload; }

  forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }

  // Put a weapon in its slot. Returns what was there before (to drop), if anything.
  give(id, ammo) {
    const w = weaponById(id);
    const prev = this.inv[w.slot];
    this.inv[w.slot] = { id, ammo: ammo ?? w.mag };
    this.slot = w.slot;
    this.reloadT = -1;
    this.fireCd = Math.max(this.fireCd, 0.3);
    this.events.push({ type: 'switch' });
    return prev || null;
  }

  // Remove the held weapon (for dropping). You always keep at least a sidearm slot.
  takeHeld() {
    const s = this.slot;
    const item = this.inv[s];
    if (!item) return null;
    if (s === 'sidearm' && !this.inv.primary) return null; // can't be left empty-handed
    this.inv[s] = null;
    this.slot = this.inv.primary ? 'primary' : 'sidearm';
    this.reloadT = -1;
    return item;
  }

  spread(ads) {
    const w = this.w;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let s = w.spread + w.moveSpread * Math.min(1, sp / 6) + this.bloom;
    if (!this.grounded) s += 0.03;
    if (ads) s *= w.adsSpread;
    return s;
  }

  // input: { mx, mz, jump, yaw, pitch, fire, ads, reload, slot, ability }
  update(dt, input, onFire) {
    this.yaw = input.yaw; this.pitch = input.pitch;
    if (this.dead) return;

    this.fireCd -= dt;
    this.abilityCd = Math.max(0, this.abilityCd - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.overclockT = Math.max(0, this.overclockT - dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.12);

    // Weapon switch
    if (input.slot && input.slot !== this.slot && this.inv[input.slot]) {
      this.slot = input.slot;
      this.reloadT = -1;
      this.fireCd = Math.max(this.fireCd, 0.25);
      this.events.push({ type: 'switch' });
    }

    const cur = this.cur;
    // Reload
    if (this.reloadT >= 0) {
      this.reloadT -= dt * (this.overclockT > 0 ? 4 : 1);
      if (this.reloadT < 0) { cur.ammo = this.w.mag; this.reloadT = -1; this.events.push({ type: 'reloaded' }); }
    } else if (!this.frozen && ((input.reload && cur.ammo < this.w.mag) || cur.ammo === 0)) {
      this.reloadT = this.w.reload;
      this.events.push({ type: 'reload' });
    }

    // Fire
    if (!this.frozen && input.fire && this.fireCd <= 0 && this.reloadT < 0 && cur.ammo > 0) {
      this.fireCd = this.w.rate * (this.overclockT > 0 ? 0.5 : 1);
      cur.ammo--;
      this.shots++;
      onFire?.(this, input.ads);
      this.bloom = Math.min(0.05, this.bloom + this.w.recoil * 0.25);
    }

    if (!this.frozen && input.ability && this.abilityCd <= 0) this.useAbility(input);

    this.move(dt, input);
  }

  useAbility(input) {
    const c = this.char;
    this.abilityCd = c.abilityCd;
    const f = this.forward();
    if (c.ability === 'dash') {
      let dx = f.x, dz = f.z;
      if (input.mx || input.mz) { dx = f.x * input.mz - f.z * input.mx; dz = f.z * input.mz + f.x * input.mx; }
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
    } else if (c.ability === 'heal') {
      this.events.push({ type: 'heal' });
    } else if (c.ability === 'pulse') {
      this.events.push({ type: 'pulse' });
    } else if (c.ability === 'wall') {
      // Wall 4.5m ahead, perpendicular to the dominant facing axis
      const hit = this.world.raycast(this.pos.x, this.pos.y + 1, this.pos.z, f.x, 0, f.z, 5);
      const d = hit ? Math.max(1.4, hit.t - 0.6) : 4.5;
      const cx = this.pos.x + f.x * d, cz = this.pos.z + f.z * d;
      const g = this.world.groundBelow(cx, cz, 0.2, this.pos.y + 1.2, 4);
      const alongX = Math.abs(f.z) > Math.abs(f.x); // facing mostly along z -> wall spans x
      this.events.push({ type: 'wall', x: cx, y: g > -Infinity ? g : this.pos.y, z: cz, alongX });
    } else if (c.ability === 'blink') {
      const from = { ...this.pos };
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      let dx = f.x * cp, dy = Math.max(-0.3, sp), dz = f.z * cp;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const hit = this.world.raycast(this.pos.x, this.pos.y + 1.0, this.pos.z, dx, dy, dz, 9);
      let dist = hit ? Math.max(0, hit.t - this.r - 0.2) : 9;
      let placed = false;
      for (; dist >= 0 && !placed; dist -= 0.5) {
        const tx = this.pos.x + dx * dist, tz = this.pos.z + dz * dist;
        const ty = Math.max(this.pos.y + dy * dist, this.pos.y - 3);
        for (let up = 0; up <= 1.6; up += 0.4) {
          if (this.world.fits(tx, ty + up, tz, this.r, this.h)) { this.pos.x = tx; this.pos.y = ty + up; this.pos.z = tz; placed = true; break; }
        }
      }
      this.vel.y = Math.max(this.vel.y, 0);
      this.events.push({ type: 'blink', from, to: { ...this.pos } });
    }
  }

  move(dt, input) {
    const c = this.char;
    const f = this.forward(), rx = -f.z, rz = f.x;
    let mx = this.frozen ? 0 : input.mx, mz = this.frozen ? 0 : input.mz;
    let wx = f.x * mz + rx * mx, wz = f.z * mz + rz * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    let speed = c.speed * this.w.moveMul * (input.ads ? 0.62 : 1);
    if (this.reloadT >= 0) speed *= 0.9;

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.x = this.dashDir.x * 24;
      this.vel.z = this.dashDir.z * 24;
      this.vel.y = Math.max(this.vel.y, -1);
    } else {
      const accel = this.grounded ? 70 : 16;
      let dvx = wx * speed - this.vel.x, dvz = wz * speed - this.vel.z;
      const dl = Math.hypot(dvx, dvz), max = accel * dt;
      if (dl > max) { dvx *= max / dl; dvz *= max / dl; }
      if (!this.grounded && wl < 0.01) { dvx = 0; dvz = 0; }
      this.vel.x += dvx; this.vel.z += dvz;
      this.vel.y -= GRAVITY * dt;
    }

    if (input.jump && this.grounded && !this.frozen) {
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
    if (!this.grounded && wasGrounded && this.vel.y <= 0) {
      const g = this.world.groundBelow(this.pos.x, this.pos.z, this.r * 0.9, this.pos.y, 0.7);
      if (g > -Infinity && this.world.fits(this.pos.x, g, this.pos.z, this.r, this.h)) { this.pos.y = g; this.grounded = true; this.vel.y = 0; }
    }
    // If something (like an ice wall) spawned on top of us, get out of it
    if (this.world.overlap(this.pos.x - this.r, this.pos.y + 0.01, this.pos.z - this.r, this.pos.x + this.r, this.pos.y + this.h, this.pos.z + this.r)) this._unstick();
    if (this.grounded && !wasGrounded && fallSpeed < -6) this.events.push({ type: 'land', speed: -fallSpeed });
    if (!this.grounded) this.airTime += dt; else this.airTime = 0;
  }

  _unstick() {
    const p = this.pos;
    for (let r = 0.3; r <= 3; r += 0.3) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        if (this.world.fits(x, p.y, z, this.r, this.h)) { p.x = x; p.z = z; return; }
      }
    }
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

  // Shield soaks damage first. Returns damage actually dealt (0 if immune).
  takeDamage(dmg) {
    if (this.dead || this.invulnerable) return 0;
    const soak = Math.min(this.shield, dmg);
    this.shield -= soak;
    const rest = dmg - soak;
    this.hp = Math.max(0, this.hp - rest);
    return dmg;
  }

  heal(n) {
    if (this.dead) return;
    this.hp = Math.min(this.char.health, this.hp + n);
  }
}
