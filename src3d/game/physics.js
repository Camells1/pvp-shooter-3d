// Axis-aligned box world: collision, ground probing, raycasts and bot navigation graph.

export class World {
  constructor(boxes) {
    // box: { min:{x,y,z}, max:{x,y,z} }
    this.boxes = boxes;
  }

  overlap(x0, y0, z0, x1, y1, z1) {
    for (const b of this.boxes) {
      if (x1 > b.min.x && x0 < b.max.x && y1 > b.min.y && y0 < b.max.y && z1 > b.min.z && z0 < b.max.z) return b;
    }
    return null;
  }

  // Can a body (feet at x,y,z) of given radius/height stand here without overlapping?
  fits(x, y, z, r, h) {
    return !this.overlap(x - r, y + 0.001, z - r, x + r, y + h, z + r);
  }

  // Highest surface top under (x,z) with top <= fromY and >= fromY - maxDrop.
  groundBelow(x, z, r, fromY, maxDrop) {
    let best = -Infinity;
    for (const b of this.boxes) {
      if (x + r <= b.min.x || x - r >= b.max.x || z + r <= b.min.z || z - r >= b.max.z) continue;
      const t = b.max.y;
      if (t <= fromY + 0.001 && t >= fromY - maxDrop && t > best) best = t;
    }
    return best;
  }

  // Ray vs all boxes. Returns { t, box, nx, ny, nz } or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let bestT = maxDist, hit = null, nx = 0, ny = 0, nz = 0;
    const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
    for (const b of this.boxes) {
      let t1 = (b.min.x - ox) * ix, t2 = (b.max.x - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), axis = 0;
      t1 = (b.min.y - oy) * iy; t2 = (b.max.y - oy) * iy;
      let a = Math.min(t1, t2);
      if (a > tmin) { tmin = a; axis = 1; }
      tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b.min.z - oz) * iz; t2 = (b.max.z - oz) * iz;
      a = Math.min(t1, t2);
      if (a > tmin) { tmin = a; axis = 2; }
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax < Math.max(tmin, 0) || tmin >= bestT || tmin < 0) continue;
      bestT = tmin; hit = b;
      nx = axis === 0 ? -Math.sign(dx) : 0;
      ny = axis === 1 ? -Math.sign(dy) : 0;
      nz = axis === 2 ? -Math.sign(dz) : 0;
    }
    return hit ? { t: bestT, box: hit, nx, ny, nz } : null;
  }

  clear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len);
  }

  // ---------- Navigation graph for bots ----------
  buildNav(bounds, spacing = 1.5, r = 0.4, h = 1.8) {
    const nodes = [];
    const cols = Math.floor((bounds.maxX - bounds.minX) / spacing);
    const rows = Math.floor((bounds.maxZ - bounds.minZ) / spacing);
    const grid = new Map(); // "i,j" -> [node]
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const x = bounds.minX + i * spacing, z = bounds.minZ + j * spacing;
        const tops = new Set();
        for (const b of this.boxes) {
          if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
          if (b.max.y > bounds.maxY || b.noWalk) continue;
          tops.add(b.max.y);
        }
        for (const y of tops) {
          if (!this.fits(x, y, z, r, h)) continue;
          const n = { id: nodes.length, x, y, z, i, j, edges: [] };
          nodes.push(n);
          const k = i + ',' + j;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(n);
        }
      }
    }
    for (const n of nodes) {
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const list = grid.get((n.i + di) + ',' + (n.j + dj));
        if (!list) continue;
        for (const m of list) {
          const dy = m.y - n.y;
          if (dy > 1.25 || dy < -4.5) continue;
          const lo = Math.max(n.y, m.y);
          let ok;
          if (dy < -0.6) ok = this.clear(n.x, n.y + 0.8, n.z, m.x, n.y + 0.8, m.z) && this.clear(n.x, n.y + 1.6, n.z, m.x, n.y + 1.6, m.z);
          else ok = this.clear(n.x, n.y + 0.65, n.z, m.x, m.y + 0.65, m.z) && this.clear(n.x, lo + 1.6, n.z, m.x, lo + 1.6, m.z);
          if (ok) n.edges.push({ to: m.id, jump: dy > 0.6, cost: Math.hypot(m.x - n.x, dy, m.z - n.z) });
        }
      }
    }
    this.nav = nodes;
    return nodes;
  }

  nearestNode(x, y, z) {
    let best = null, bd = Infinity;
    for (const n of this.nav) {
      const d = (n.x - x) ** 2 + ((n.y - y) * 2) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  findPath(from, to) {
    if (!from || !to) return null;
    const nodes = this.nav;
    const g = new Float32Array(nodes.length).fill(Infinity);
    const prev = new Int32Array(nodes.length).fill(-1);
    const open = [from.id];
    const f = new Float32Array(nodes.length).fill(Infinity);
    g[from.id] = 0;
    f[from.id] = Math.hypot(to.x - from.x, to.z - from.z);
    const inOpen = new Uint8Array(nodes.length); inOpen[from.id] = 1;
    let iter = 0;
    while (open.length && iter++ < 4000) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open[bi];
      open[bi] = open[open.length - 1]; open.pop(); inOpen[cur] = 0;
      if (cur === to.id) break;
      for (const e of nodes[cur].edges) {
        const ng = g[cur] + e.cost + (e.jump ? 1.5 : 0);
        if (ng < g[e.to]) {
          g[e.to] = ng; prev[e.to] = cur;
          const n = nodes[e.to];
          f[e.to] = ng + Math.hypot(to.x - n.x, to.z - n.z);
          if (!inOpen[e.to]) { open.push(e.to); inOpen[e.to] = 1; }
        }
      }
    }
    if (prev[to.id] === -1 && to.id !== from.id) return null;
    const path = [];
    for (let c = to.id; c !== -1; c = prev[c]) path.push(nodes[c]);
    return path.reverse();
  }
}
