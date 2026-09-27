// Pooled visual effects: tracers, muzzle flashes, sparks, bullet holes, ability particles.
import * as THREE from 'three';

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.translate(64, 64);
  for (let i = 0; i < 7; i++) {
    x.rotate(Math.PI * 2 / 7 + Math.random() * 0.3);
    const g = x.createLinearGradient(0, 0, 60, 0);
    g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(1, 'rgba(255,140,40,0)');
    x.fillStyle = g; x.beginPath(); x.moveTo(0, -7); x.lineTo(40 + Math.random() * 22, 0); x.lineTo(0, 7); x.fill();
  }
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 30);
  g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(1, 'rgba(255,180,60,0)');
  x.fillStyle = g; x.fillRect(-30, -30, 60, 60);
  return new THREE.CanvasTexture(c);
}
function holeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(0.35, 'rgba(20,18,15,0.8)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const _up = new THREE.Vector3(0, 1, 0);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const dot = dotTexture();

    // Tracers
    const tg = new THREE.BoxGeometry(1, 1, 1); tg.translate(0, 0, 0.5);
    this.tracers = [];
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false; m.frustumCulled = false; scene.add(m);
      this.tracers.push({ mesh: m, life: 0, max: 0 });
    }
    this.ti = 0;

    // Muzzle flashes
    const ft = flashTexture();
    this.flashes = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ft, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.visible = false; scene.add(s);
      const l = new THREE.PointLight(0xffb060, 0, 9, 2); scene.add(l);
      this.flashes.push({ sprite: s, light: l, life: 0 });
    }
    this.fi = 0;

    // Particles (sparks, blood-energy, blink)
    this.N = 900;
    this.pp = new Float32Array(this.N * 3);
    this.pc = new Float32Array(this.N * 3);
    this.pv = new Float32Array(this.N * 3);
    this.pl = new Float32Array(this.N);
    this.pg = new Float32Array(this.N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pp, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pc, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.12, map: dot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pi = 0;
    for (let i = 0; i < this.N; i++) this.pp[i * 3 + 1] = -9999;

    // Bullet holes
    const hg = new THREE.PlaneGeometry(0.16, 0.16);
    const hm = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.holes = [];
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(hg, hm); m.visible = false; scene.add(m);
      this.holes.push(m);
    }
    this.hi = 0;

    // Rings (blink / dash / pickups)
    this.rings = [];
    const rg = new THREE.RingGeometry(0.8, 1, 40); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.visible = false; scene.add(m);
      this.rings.push({ mesh: m, life: 0 });
    }
    this.ri = 0;
  }

  tracer(from, to, color = 0xffe0a0, width = 0.03) {
    const t = this.tracers[this.ti++ % this.tracers.length];
    const len = from.distanceTo(to);
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(width, width, len);
    t.mesh.material.color.set(color);
    t.mesh.material.opacity = 1;
    t.mesh.visible = true;
    t.life = t.max = 0.09;
  }

  muzzle(pos, dir, size = 0.5) {
    const f = this.flashes[this.fi++ % this.flashes.length];
    f.sprite.position.copy(pos).addScaledVector(dir, 0.08);
    f.sprite.scale.setScalar(size * (0.8 + Math.random() * 0.4));
    f.sprite.material.rotation = Math.random() * Math.PI * 2;
    f.sprite.visible = true;
    f.light.position.copy(pos);
    f.light.intensity = 25;
    f.life = 0.05;
  }

  burst(pos, color, count = 12, speed = 4, life = 0.4, gravity = 12, spread = 1, dir = null) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.pi++ % this.N;
      this.pp[i * 3] = pos.x; this.pp[i * 3 + 1] = pos.y; this.pp[i * 3 + 2] = pos.z;
      let vx = (Math.random() - 0.5) * 2, vy = (Math.random() - 0.5) * 2, vz = (Math.random() - 0.5) * 2;
      if (dir) { vx = vx * spread + dir.x; vy = vy * spread + dir.y; vz = vz * spread + dir.z; }
      const s = speed * (0.4 + Math.random() * 0.8);
      const l = Math.hypot(vx, vy, vz) || 1;
      this.pv[i * 3] = vx / l * s; this.pv[i * 3 + 1] = vy / l * s; this.pv[i * 3 + 2] = vz / l * s;
      const b = 0.7 + Math.random() * 0.6;
      this.pc[i * 3] = c.r * b; this.pc[i * 3 + 1] = c.g * b; this.pc[i * 3 + 2] = c.b * b;
      this.pl[i] = life * (0.5 + Math.random() * 0.8);
      this.pg[i] = gravity;
    }
  }

  impact(point, normal, color = 0xffc070, hole = true) {
    this.burst(point, color, 8, 5, 0.3, 14, 0.6, normal);
    this.burst(point, 0x8a8078, 4, 1.5, 0.5, -1, 1);
    if (!hole) return;
    const h = this.holes[this.hi++ % this.holes.length];
    h.position.copy(point).addScaledVector(normal, 0.01);
    h.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
    h.rotation.z = Math.random() * 6.28;
    h.visible = true;
  }

  ring(pos, color, maxScale = 2.5) {
    const r = this.rings[this.ri++ % this.rings.length];
    r.mesh.position.copy(pos);
    r.mesh.material.color.set(color);
    r.mesh.visible = true;
    r.life = 0.5; r.max = maxScale;
  }

  blink(from, to, color) {
    const a = new THREE.Vector3(from.x, from.y + 1, from.z), b = new THREE.Vector3(to.x, to.y + 1, to.z);
    for (let i = 0; i <= 12; i++) this.burst(a.clone().lerp(b, i / 12), color, 5, 1.2, 0.6, -1, 1);
    this.burst(a, color, 30, 5, 0.5, 0, 1);
    this.burst(b, color, 30, 5, 0.5, 0, 1);
    this.ring(new THREE.Vector3(to.x, to.y + 0.05, to.z), color);
    this.ring(new THREE.Vector3(from.x, from.y + 0.05, from.z), color);
  }

  explosion(pos, color = 0xff8a3a, radius = 5) {
    if (!this.booms) this.booms = [];
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    ball.position.copy(pos); this.scene.add(ball);
    const light = new THREE.PointLight(color, 120, radius * 5, 2); light.position.copy(pos); this.scene.add(light);
    this.booms.push({ ball, light, t: 0, radius });
    this.burst(pos, color, 70, radius * 2.2, 0.8, 6);
    this.burst(pos, 0x444444, 30, radius * 0.8, 1.4, -1.5);
    this.ring(new THREE.Vector3(pos.x, pos.y - 0.4, pos.z), color, radius * 1.2);
  }

  // Jagged lightning through a list of points
  beam(points, color = 0x7ff6ff) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      let prev = a.clone();
      const n = 6;
      for (let k = 1; k <= n; k++) {
        const p = a.clone().lerp(b, k / n);
        if (k < n) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
        this.tracer(prev, p, color, 0.05);
        prev = p;
      }
      this.burst(b, color, 20, 3, 0.4, 2);
    }
  }

  update(dt) {
    if (this.booms) for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.t += dt;
      const k = b.t / 0.45;
      b.ball.scale.setScalar(0.5 + k * b.radius);
      b.ball.material.opacity = Math.max(0, 0.85 * (1 - k));
      b.light.intensity = Math.max(0, 120 * (1 - k));
      if (k >= 1) { this.scene.remove(b.ball); this.scene.remove(b.light); b.ball.geometry.dispose(); this.booms.splice(i, 1); }
    }
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else t.mesh.material.opacity = t.life / t.max;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.sprite.visible = false; f.light.intensity = 0; }
    }
    for (let i = 0; i < this.N; i++) {
      if (this.pl[i] <= 0) continue;
      this.pl[i] -= dt;
      if (this.pl[i] <= 0) { this.pp[i * 3 + 1] = -9999; continue; }
      this.pv[i * 3 + 1] -= this.pg[i] * dt;
      this.pp[i * 3] += this.pv[i * 3] * dt; this.pp[i * 3 + 1] += this.pv[i * 3 + 1] * dt; this.pp[i * 3 + 2] += this.pv[i * 3 + 2] * dt;
      const fade = Math.min(1, this.pl[i] * 4);
      this.pc[i * 3] *= fade > 0.99 ? 1 : 0.94; this.pc[i * 3 + 1] *= fade > 0.99 ? 1 : 0.94; this.pc[i * 3 + 2] *= fade > 0.99 ? 1 : 0.94;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const k = 1 - r.life / 0.5;
      r.mesh.scale.setScalar(0.3 + k * r.max);
      r.mesh.material.opacity = 1 - k;
    }
  }

  dispose() {
    for (const t of this.tracers) this.scene.remove(t.mesh);
    for (const f of this.flashes) { this.scene.remove(f.sprite); this.scene.remove(f.light); }
    for (const h of this.holes) this.scene.remove(h);
    for (const r of this.rings) this.scene.remove(r.mesh);
    this.scene.remove(this.points);
  }
}
