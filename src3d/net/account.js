// Camel Studios accounts (Firebase Auth + Firestore over their REST APIs, no SDK needed in the game).
// Signing in happens on the account page (camells1.github.io/account); the game keeps only the refresh token.
// Firestore layout (see firestore.rules in the website repo):
//   ids/{name#TAG}   who owns each username#tag (each can exist once)
//   users/{uid}      { id } the ID an account holds
//   profiles/{uid}   { riftline: {...}, shattercrown: {...} } per-game progress, private to the owner
const API_KEY = 'AIzaSyAgEzMO9dzwwHr-iyvDhRho-DY1-gg9os4'; // public web key, safe to ship
const PROJECT = 'riftline-f4af8';
const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
const STORE = 'riftline-auth';

const read = () => {
  try { return JSON.parse(localStorage.getItem(STORE) || sessionStorage.getItem(STORE) || 'null'); } catch (_) { return null; }
};
const write = (data, stay) => {
  try {
    localStorage.removeItem(STORE); sessionStorage.removeItem(STORE);
    if (data) (stay ? localStorage : sessionStorage).setItem(STORE, JSON.stringify(data));
  } catch (_) {}
};
const splitId = dn => { const i = (dn || '').lastIndexOf('#'); return i > 0 ? [dn.slice(0, i), dn.slice(i + 1)] : [dn || '', '']; };
export const idKey = (name, tag) => name.toLowerCase() + '#' + tag;

async function call(url, { method = 'POST', body, form = false, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : form ? new URLSearchParams(body) : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error?.message || 'HTTP ' + res.status);
    e.code = json.error?.status || json.error?.message; e.http = res.status;
    throw e;
  }
  return json;
}

// Firestore value <-> plain JS
const toFs = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
};
const fromFs = f => {
  if (!f) return null;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(fromFs);
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  return null;
};

export const account = {
  user: null,        // { uid, email, name, tag }
  idToken: null,

  get signedIn() { return !!this.user; },

  // Called with what the account page handed back after sign-in
  async signIn(data) {
    const saved = { refreshToken: data.refreshToken, uid: data.uid, email: data.email, stay: data.stay !== false };
    write(saved, saved.stay);
    await this.restore();
    return this.user;
  },

  // Refresh the session from the saved token (on every launch). Returns the user or null.
  async restore() {
    const saved = read();
    if (!saved?.refreshToken) { this.user = null; return null; }
    try {
      const tok = await call(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, { body: { grant_type: 'refresh_token', refresh_token: saved.refreshToken }, form: true });
      this.idToken = tok.id_token;
      saved.refreshToken = tok.refresh_token;
      write(saved, saved.stay);
      const look = await call(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, { body: { idToken: this.idToken } });
      const u = look.users?.[0] || {};
      const [name, tag] = splitId(u.displayName);
      this.user = { uid: tok.user_id, email: u.email || saved.email, name, tag };
      return this.user;
    } catch (e) {
      // Only forget the session if Firebase rejected it (not when offline)
      if (/TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|INVALID_REFRESH_TOKEN/.test(e.code || e.message || '')) { write(null); this.user = null; }
      throw e;
    }
  },

  // Run an authenticated request; refresh the (1 hour) ID token once if it expired
  async authed(fn) {
    try { return await fn(this.idToken); }
    catch (e) { if (e.http !== 401 && e.http !== 403 || !this.user) throw e; await this.restore(); return fn(this.idToken); }
  },

  // Who owns a username#tag (uid), or null if it's free. Throws if the database can't be reached.
  async ownerOf(name, tag) {
    try {
      const d = await call(`${FS}/ids/${encodeURIComponent(idKey(name, tag))}`, { method: 'GET' });
      return fromFs(d.fields?.uid);
    } catch (e) {
      if (e.http === 404 && !/database/i.test(e.message)) return null;
      throw e;
    }
  },

  // Claim a username#tag for this account (atomic: fails if someone else has it) and release the old one.
  // Throws { code: 'taken' } when it belongs to someone else.
  async claimId(name, tag) {
    if (!this.user) throw new Error('Not signed in');
    const key = idKey(name, tag);
    const owner = await this.ownerOf(name, tag);
    if (owner && owner !== this.user.uid) throw Object.assign(new Error('That username#tag is taken'), { code: 'taken' });
    if (!owner) {
      let old = null;
      try { old = fromFs((await call(`${FS}/users/${this.user.uid}`, { method: 'GET' })).fields?.id); } catch (_) {}
      const writes = [
        { update: { name: `${DOCS}/ids/${key}`, fields: { uid: toFs(this.user.uid), name: toFs(name), tag: toFs(tag), at: { timestampValue: new Date().toISOString() } } }, currentDocument: { exists: false } },
        { update: { name: `${DOCS}/users/${this.user.uid}`, fields: { id: toFs(key) } } }
      ];
      if (old && old !== key) writes.push({ delete: `${DOCS}/ids/${old}` });
      try { await this.authed(t => call(`${FS}:commit`, { body: { writes }, token: t })); }
      catch (e) { if (/FAILED_PRECONDITION|ALREADY_EXISTS|PERMISSION_DENIED/.test(e.code || '')) throw Object.assign(new Error('That username#tag is taken'), { code: 'taken' }); throw e; }
    }
    await this.authed(t => call(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`, { body: { idToken: t, displayName: `${name}#${tag}`, returnSecureToken: false } }));
    this.user.name = name; this.user.tag = tag;
  },

  // Per-game progress stored on the account. Returns null if there's nothing saved yet.
  async loadProgress(game) {
    if (!this.user) return null;
    try {
      const d = await this.authed(t => call(`${FS}/profiles/${this.user.uid}`, { method: 'GET', token: t }));
      return fromFs(d.fields?.[game]) || null;
    } catch (e) { if (e.http === 404 && !/database/i.test(e.message)) return null; throw e; }
  },
  async saveProgress(game, data) {
    if (!this.user) return;
    await this.authed(t => call(`${FS}/profiles/${this.user.uid}?updateMask.fieldPaths=${game}`, { method: 'PATCH', body: { fields: { [game]: toFs(data) } }, token: t }));
  },

  logout() { write(null); this.user = null; this.idToken = null; }
};
