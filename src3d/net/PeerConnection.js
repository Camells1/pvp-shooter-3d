// Peer-to-peer networking via PeerJS (the free public PeerJS broker is only used for the handshake).
// Star topology: guests connect to the host, and the host relays messages between guests.
// Player ids: host = 'h', guests = 'g1', 'g2', 'g3'.
import { VERSION } from '../game/data.js';

// The protocol tag is part of every room id, so different game versions never find each other by accident.
const PROTO = 'p3';
const PREFIX = `riftline-${PROTO}-`;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TIMEOUT = 10000;
const QUEUE_SLOTS = 6;

// STUN finds your public address; TURN relays traffic when a direct connection is impossible
// (strict routers, some school/work networks, mobile hotspots).
const ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

function newPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { config: ICE, debug: 0 }) : new Peer({ config: ICE, debug: 0 });
    const t = setTimeout(() => { try { peer.destroy(); } catch (_) {} reject(new Error('Could not reach the matchmaking server. Check your internet connection.')); }, 12000);
    peer.once('open', () => { clearTimeout(t); resolve(peer); });
    peer.once('error', e => { clearTimeout(t); try { peer.destroy(); } catch (_) {} reject(e); });
  });
}

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

  // ---------------------------------------------------------------- hosting
  async host() {
    let code = '';
    for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    await this._hostAs(PREFIX + code);
    return code;
  }

  async _hostAs(id) {
    this.peer = await newPeer(id);
    this.isHost = true;
    this.myId = 'h';
    this._startHeartbeat();
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (_) {} });
    this.peer.on('error', () => {});
    this.peer.on('connection', conn => {
      conn.on('data', d => {
        if (d.type !== 'hello0') return;
        if (d.v !== VERSION) { conn.send({ type: 'full', reason: 'version', v: VERSION }); setTimeout(() => conn.close(), 500); return; }
        if (this.links.size >= this.maxGuests || this.locked || (this.acceptQueue && !this.acceptQueue())) { conn.send({ type: 'full' }); setTimeout(() => conn.close(), 500); return; }
        const pid = 'g' + this.nextId++;
        this._attach(conn, pid);
        conn.send({ type: 'welcome', id: pid, v: VERSION });
        this.onJoin?.(pid);
      });
    });
  }

  // ---------------------------------------------------------------- joining
  async join(code) {
    this.peer = await newPeer();
    this.peer.on('error', () => {});
    try { return await this._connect(PREFIX + code.toUpperCase(), 15000); }
    catch (e) { this.destroy(); throw e; }
  }

  // Connect to a host id and complete the version handshake. Resolves with our player id.
  _connect(hostId, timeout) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, id) => { if (done) return; done = true; clearTimeout(t); this.peer.off?.('error', onErr); err ? reject(err) : resolve(id); };
      const t = setTimeout(() => { try { conn.close(); } catch (_) {} finish(new Error('Could not connect. The code may be wrong, or one of you is behind a strict firewall.')); }, timeout);
      const onErr = e => { if (e.type === 'peer-unavailable' && String(e.message).includes(hostId)) finish(new Error('No game found with that code.')); };
      this.peer.on('error', onErr);
      const conn = this.peer.connect(hostId, { reliable: true, serialization: 'json' });
      conn.on('open', () => conn.send({ type: 'hello0', v: VERSION }));
      conn.on('data', d => {
        if (d.type === 'full') {
          try { conn.close(); } catch (_) {}
          finish(new Error(d.reason === 'version' ? `Version mismatch: the host has v${d.v}, you have v${VERSION}. Both players need the latest version.` : 'That lobby is full or already in a match.'));
        }
        if (d.type === 'welcome') {
          this.isHost = false; this.myId = d.id;
          this._attach(conn, 'h');
          this._startHeartbeat();
          finish(null, d.id);
        }
      });
      conn.on('error', () => {});
    });
  }

  // ---------------------------------------------------------------- matchmaking queue
  // Finds (or opens) a public queue room for `kind` ('1v1' | '2v2'). Resolves { role: 'host'|'guest' }.
  async queue(kind, onStatus) {
    const slotId = i => `${PREFIX}q-${kind}-${i}`;
    onStatus?.('Looking for a match…');
    // 1) Try to join someone who is already waiting
    const joined = await this._tryJoinSlots(slotId, [...Array(QUEUE_SLOTS).keys()]);
    if (joined) return { role: 'guest' };
    // 2) Nobody waiting: open the lowest free queue room and wait there
    for (let i = 0; i < QUEUE_SLOTS; i++) {
      try {
        await this._hostAs(slotId(i));
        this.queueSlot = i;
        onStatus?.('Waiting for players…');
        // If someone opened a lower room at the same time, merge into theirs (lower slot wins)
        if (i > 0) this._mergeTimer = setInterval(() => this._tryMerge(slotId), 4000);
        return { role: 'host' };
      } catch (e) {
        if (e.type !== 'unavailable-id') throw e;
      }
    }
    throw new Error('Matchmaking is busy right now. Try again in a moment.');
  }

  async _tryJoinSlots(slotId, slots) {
    let peer;
    try { peer = await newPeer(); } catch (e) { throw e; }
    this.peer = peer;
    peer.on('error', () => {});
    for (const i of slots) {
      try { await this._connect(slotId(i), 3500); return true; } catch (_) { /* next slot */ }
    }
    try { peer.destroy(); } catch (_) {}
    this.peer = null;
    return false;
  }

  async _tryMerge(slotId) {
    if (this.links.size > 0 || this.merging) { clearInterval(this._mergeTimer); return; }
    this.merging = true;
    const probe = new PeerConnection();
    try {
      const ok = await probe._tryJoinSlots(slotId, [...Array(this.queueSlot).keys()]);
      if (ok && this.links.size === 0) {
        // Become a guest of the lower room
        clearInterval(this._mergeTimer);
        const oldPeer = this.peer;
        clearInterval(this._timer);
        Object.assign(this, { peer: probe.peer, isHost: false, myId: probe.myId, links: probe.links });
        for (const [id, link] of this.links) this._rebind(link, id);
        this._startHeartbeat();
        try { oldPeer.destroy(); } catch (_) {}
        this.onMerged?.();
      } else probe.destroy();
    } catch (_) { probe.destroy(); }
    this.merging = false;
  }

  _rebind(link, id) {
    link.conn.removeAllListeners?.('data');
    link.conn.on('data', d => this._onData(link, id, d));
  }

  // ---------------------------------------------------------------- links
  _attach(conn, id) {
    const link = { conn, lastRecv: performance.now(), ping: 0 };
    this.links.set(id, link);
    conn.on('data', d => this._onData(link, id, d));
    const lost = () => this._lost(id, link);
    conn.on('close', lost);
    conn.on('error', lost);
  }

  _onData(link, id, d) {
    link.lastRecv = performance.now();
    if (d.type === 'ping') { try { link.conn.send({ type: 'pong', t: d.t }); } catch (_) {} return; }
    if (d.type === 'pong') { link.ping = performance.now() - d.t; return; }
    if (d.type === 'welcome' || d.type === 'full' || d.type === 'hello0') return;
    this._recv(d, id);
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

  send(msg) {
    msg.from = this.myId;
    delete msg.to;
    if (this.isHost) for (const id of this.links.keys()) this._raw(id, msg);
    else this._raw('h', msg);
  }

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
    clearInterval(this._mergeTimer);
    this.onClose = null; this.onLeave = null;
    for (const l of this.links.values()) { try { l.conn.close(); } catch (_) {} }
    this.links.clear();
    try { this.peer?.destroy(); } catch (_) {}
    this.peer = null;
  }
}
