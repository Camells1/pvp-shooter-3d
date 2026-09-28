// Riftline accounts (Firebase Auth over its REST API, no SDK needed in the game).
// Signing in happens on the account page (see docs/index.html); the game only keeps the refresh token.
const API_KEY = 'AIzaSyAgEzMO9dzwwHr-iyvDhRho-DY1-gg9os4'; // public web key, safe to ship
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

async function post(url, body, form = false) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body) : JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json.error?.message || 'HTTP ' + res.status); e.code = json.error?.message; throw e; }
  return json;
}

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
      const tok = await post(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, { grant_type: 'refresh_token', refresh_token: saved.refreshToken }, true);
      this.idToken = tok.id_token;
      saved.refreshToken = tok.refresh_token;
      write(saved, saved.stay);
      const look = await post(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, { idToken: this.idToken });
      const u = look.users?.[0] || {};
      const [name, tag] = splitId(u.displayName);
      this.user = { uid: tok.user_id, email: u.email || saved.email, name, tag };
      return this.user;
    } catch (e) {
      // Only forget the session if Firebase rejected it (not when offline)
      if (/TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|INVALID_REFRESH_TOKEN/.test(e.code || '')) { write(null); this.user = null; }
      throw e;
    }
  },

  // Save the Riftline ID (username#tag) on the account
  async setId(name, tag) {
    if (!this.user || !this.idToken) return;
    await post(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`, { idToken: this.idToken, displayName: `${name}#${tag}`, returnSecureToken: false });
    this.user.name = name; this.user.tag = tag;
  },

  logout() { write(null); this.user = null; this.idToken = null; }
};
