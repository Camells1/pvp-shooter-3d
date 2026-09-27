// Peer-to-peer connection via PeerJS (uses the free public PeerJS broker only for the handshake).
const PREFIX = 'pvpshooter3d-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class PeerConnection {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.handlers = {};
    this.onClose = null;
    this.ping = 0;
    this._pingTimer = null;
  }

  host() {
    return new Promise((resolve, reject) => {
      let code = '';
      for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      this.peer = new Peer(PREFIX + code);
      const t = setTimeout(() => reject(new Error('Could not reach the matchmaking broker. Check your internet.')), 12000);
      this.peer.on('open', () => { clearTimeout(t); resolve(code); });
      this.peer.on('error', e => { clearTimeout(t); reject(e); });
    });
  }

  waitForGuest() {
    return new Promise(resolve => {
      this.peer.on('connection', conn => {
        if (this.conn) { conn.close(); return; } // 1v1 only
        conn.on('open', () => { this._attach(conn); resolve(); });
      });
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      this.peer = new Peer();
      const t = setTimeout(() => reject(new Error('Timed out. Check the code and try again.')), 15000);
      this.peer.on('error', e => {
        clearTimeout(t);
        reject(e.type === 'peer-unavailable' ? new Error('No game found with that code.') : e);
      });
      this.peer.on('open', () => {
        const conn = this.peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
        conn.on('open', () => { clearTimeout(t); this._attach(conn); resolve(); });
      });
    });
  }

  _attach(conn) {
    this.conn = conn;
    this.lastRecv = performance.now();
    conn.on('data', d => {
      this.lastRecv = performance.now();
      if (d.type === 'ping') return this.send({ type: 'pong', t: d.t });
      if (d.type === 'pong') { this.ping = performance.now() - d.t; return; }
      this.handlers[d.type]?.(d);
      this.handlers['*']?.(d);
    });
    const closed = () => { if (this.conn === conn) { this.conn = null; clearInterval(this._pingTimer); this.onClose?.(); } };
    conn.on('close', closed);
    conn.on('error', closed);
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (_) {} });
    // Heartbeat: PeerJS doesn't always fire 'close' when the other window dies.
    this._pingTimer = setInterval(() => {
      this.send({ type: 'ping', t: performance.now() });
      if (performance.now() - this.lastRecv > 10000) closed();
    }, 1000);
  }

  on(type, fn) { this.handlers[type] = fn; }
  off(type) { delete this.handlers[type]; }
  clearHandlers() { this.handlers = {}; }

  send(msg) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(msg); } catch (_) {}
    }
  }

  get connected() { return !!(this.conn && this.conn.open); }

  destroy() {
    clearInterval(this._pingTimer);
    this.onClose = null;
    try { this.conn?.close(); } catch (_) {}
    try { this.peer?.destroy(); } catch (_) {}
    this.conn = null; this.peer = null;
  }
}
