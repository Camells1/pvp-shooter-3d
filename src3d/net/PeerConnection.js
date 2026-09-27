// Peer-to-peer networking via PeerJS (the free public PeerJS broker is only used for the handshake).
// Star topology: guests connect to the host, and the host relays messages between guests.
// Player ids: host = 'h', guests = 'g1', 'g2', 'g3'.
const PREFIX = 'pvpshooter3d-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TIMEOUT = 10000;

export class PeerConnection {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.myId = null;
    this.links = new Map();   // peerId -> { conn, lastRecv, ping }
    this.handlers = {};
    this.maxGuests = 3;
    this.locked = false;      // host refuses new guests while a match runs
    this.nextId = 1;
    this.onJoin = null;       // host: (id) => {}
    this.onLeave = null;      // host: (id) => {}
    this.onClose = null;      // guest: lost the host
    this._timer = null;
  }

  host() {
    this.isHost = true;
    this.myId = 'h';
    return new Promise((resolve, reject) => {
      let code = '';
      for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      this.peer = new Peer(PREFIX + code);
      const t = setTimeout(() => reject(new Error('Could not reach the matchmaking broker. Check your internet.')), 12000);
      this.peer.on('open', () => { clearTimeout(t); this._startHeartbeat(); resolve(code); });
      this.peer.on('error', e => { clearTimeout(t); reject(e); });
      this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (_) {} });
      this.peer.on('connection', conn => {
        conn.on('open', () => {
          if (this.links.size >= this.maxGuests || this.locked) {
            conn.send({ type: 'full' });
            setTimeout(() => conn.close(), 500);
            return;
          }
          const id = 'g' + this.nextId++;
          this._attach(conn, id);
          conn.send({ type: 'welcome', id });
          this.onJoin?.(id);
        });
      });
    });
  }

  join(code) {
    this.isHost = false;
    return new Promise((resolve, reject) => {
      this.peer = new Peer();
      const t = setTimeout(() => reject(new Error('Timed out. Check the code and try again.')), 15000);
      this.peer.on('error', e => {
        clearTimeout(t);
        reject(e.type === 'peer-unavailable' ? new Error('No game found with that code.') : e);
      });
      this.peer.on('open', () => {
        const conn = this.peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
        conn.on('data', d => {
          if (d.type === 'full') { clearTimeout(t); reject(new Error('That lobby is full or already in a match.')); }
          if (d.type === 'welcome') { clearTimeout(t); this.myId = d.id; resolve(d.id); }
        });
        conn.on('open', () => { this._attach(conn, 'h'); this._startHeartbeat(); });
      });
    });
  }

  _attach(conn, id) {
    const link = { conn, lastRecv: performance.now(), ping: 0 };
    this.links.set(id, link);
    conn.on('data', d => {
      link.lastRecv = performance.now();
      if (d.type === 'ping') { try { conn.send({ type: 'pong', t: d.t }); } catch (_) {} return; }
      if (d.type === 'pong') { link.ping = performance.now() - d.t; return; }
      if (d.type === 'welcome' || d.type === 'full') return;
      this._recv(d, id);
    });
    const lost = () => this._lost(id, link);
    conn.on('close', lost);
    conn.on('error', lost);
  }

  _lost(id, link) {
    if (this.links.get(id) !== link) return;
    this.links.delete(id);
    try { link.conn.close(); } catch (_) {}
    if (this.isHost) this.onLeave?.(id);
    else this.onClose?.();
  }

  _startHeartbeat() {
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      const now = performance.now();
      for (const [id, link] of this.links) {
        try { link.conn.send({ type: 'ping', t: now }); } catch (_) {}
        if (now - link.lastRecv > TIMEOUT) this._lost(id, link);
      }
    }, 1000);
  }

  _recv(d, fromLink) {
    if (this.isHost) {
      d.from = fromLink; // never trust a guest's claimed sender id
      if (d.to && d.to !== 'h') { this._raw(d.to, d); return; }
      if (!d.to) for (const id of this.links.keys()) if (id !== fromLink) this._raw(id, d);
    }
    this.handlers[d.type]?.(d, d.from);
  }

  _raw(id, msg) {
    const link = this.links.get(id);
    if (link && link.conn.open) { try { link.conn.send(msg); } catch (_) {} }
  }

  on(type, fn) { this.handlers[type] = fn; }
  off(type) { delete this.handlers[type]; }

  // Broadcast to everyone else.
  send(msg) {
    msg.from = this.myId;
    delete msg.to;
    if (this.isHost) for (const id of this.links.keys()) this._raw(id, msg);
    else this._raw('h', msg);
  }

  // Send to one player (routed through the host). Sending to yourself delivers locally.
  sendTo(id, msg) {
    msg.from = this.myId;
    msg.to = id;
    if (id === this.myId) { this.handlers[msg.type]?.(msg, msg.from); return; }
    if (this.isHost) this._raw(id, msg);
    else this._raw('h', msg);
  }

  kick(id) { const l = this.links.get(id); if (l) this._lost(id, l); }

  get ping() {
    if (this.isHost) { let m = 0; for (const l of this.links.values()) m = Math.max(m, l.ping); return m; }
    return this.links.get('h')?.ping ?? 0;
  }
  get connected() { return this.isHost ? true : this.links.has('h'); }
  get guestIds() { return [...this.links.keys()]; }

  destroy() {
    clearInterval(this._timer);
    this.onClose = null; this.onLeave = null;
    for (const l of this.links.values()) { try { l.conn.close(); } catch (_) {} }
    this.links.clear();
    try { this.peer?.destroy(); } catch (_) {}
    this.peer = null;
  }
}
