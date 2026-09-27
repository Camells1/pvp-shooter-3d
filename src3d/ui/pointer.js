// Single owner of mouse capture (pointer lock) so the camera never gets "stuck".
// - Prefers raw (unadjusted) mouse input, falls back to normal pointer lock.
// - Retries after the browser's short cooldown when a re-lock is refused.
export class PointerLock {
  constructor(el) {
    this.el = el;
    this.locked = false;
    this.listeners = new Set();
    this.lastExit = 0;
    this.pending = false;
    this.rawSupported = true;
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === el;
      this.pending = false;
      if (was && !this.locked) this.lastExit = performance.now();
      for (const fn of this.listeners) fn(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.pending = false; });
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // Returns a promise that resolves true once locked, false if the browser refused.
  request() {
    if (this.locked) return Promise.resolve(true);
    // Chrome refuses a re-lock ~1s after the user pressed Esc; wait it out.
    const wait = Math.max(0, 1100 - (performance.now() - this.lastExit));
    if (wait > 0) return new Promise(r => setTimeout(() => this.request().then(r), wait));
    this.pending = true;
    const attempt = raw => {
      try {
        const p = raw ? this.el.requestPointerLock({ unadjustedMovement: true }) : this.el.requestPointerLock();
        if (p && typeof p.then === 'function') return p.then(() => true);
        return new Promise(r => setTimeout(() => r(this.locked), 150));
      } catch (e) { return Promise.reject(e); }
    };
    const first = this.rawSupported ? attempt(true) : attempt(false);
    return first.catch(err => {
      if (this.rawSupported && err && err.name === 'NotSupportedError') { this.rawSupported = false; return attempt(false).catch(() => false); }
      return attempt(false).catch(() => false);
    }).finally(() => { this.pending = false; });
  }

  release() { if (document.pointerLockElement) document.exitPointerLock(); }
}
