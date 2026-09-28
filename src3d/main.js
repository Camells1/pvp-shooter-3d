// Riftline app entry: renderer, menus, shop, matchmaking, lobby, match lifecycle.
import * as THREE from 'three';
import { CHARACTERS, charById, WEAPONS, SKINS, COINS, VERSION } from './game/data.js';
import { MAPS } from './game/maps.js';
import { MenuStage } from './game/MenuStage.js';
import { Game } from './game/Game.js';
import { Hud } from './ui/hud.js';
import { BuyMenu } from './ui/buy.js';
import { PointerLock } from './ui/pointer.js';
import { PeerConnection } from './net/PeerConnection.js';
import { account } from './net/account.js';
import { sfx, setVolume, unlock } from './audio.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const hex = c => '#' + c.toString(16).padStart(6, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TEAM_NAMES = ['TEAM 1', 'TEAM 2'], TEAM_COLORS = ['#3dd6ff', '#ff4a5a'];

if (navigator.userAgent.includes('Electron')) document.body.classList.add('electron');
$('#version').textContent = 'v' + VERSION;

// ---------------------------------------------------------------- settings + profile
const DEFAULTS = { name: 'Player', tag: '', account: false, sensitivity: 1, fov: 90, volume: 0.6, invertY: false, quality: 'medium', camera: 'first', char: 'blaze', map: 0, rounds: 5, difficulty: 'normal', mode: '1v1', game: 'spike' };
const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('riftline-settings') || '{}')); } catch (_) {}
if (!CHARACTERS.some(c => c.id === settings.char)) settings.char = 'blaze';
if (!MAPS.some(m => m.id === settings.map)) settings.map = 0;
if (![5, 7, 9].includes(settings.rounds)) settings.rounds = 5;
const save = () => { try { localStorage.setItem('riftline-settings', JSON.stringify(settings)); } catch (_) {} };
const TAG_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomTag = () => Array.from({ length: 4 }, () => TAG_CHARS[Math.floor(Math.random() * TAG_CHARS.length)]).join('');
const cleanTag = t => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
const cleanName = n => String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14);
if (!cleanTag(settings.tag)) settings.tag = randomTag();
setVolume(settings.volume);

// Coins and skins. Guests keep them on this PC; signed-in players keep them on their account
// (a local cache per account, and the cloud copy wins when the game starts).
const profile = { coins: COINS.start, owned: [], equipped: {} };
let profileKey = 'riftline-profile';
const loadProfileFrom = key => {
  profileKey = key;
  const fresh = { coins: COINS.start, owned: [], equipped: {} };
  try { Object.assign(fresh, JSON.parse(localStorage.getItem(key) || 'null') || {}); } catch (_) {}
  Object.assign(profile, fresh);
};
loadProfileFrom('riftline-profile');
// Signed in last time: show that account's cached coins right away (the cloud copy loads a moment later)
try {
  const last = JSON.parse(localStorage.getItem('riftline-auth') || sessionStorage.getItem('riftline-auth') || 'null');
  if (last?.uid && localStorage.getItem('riftline-profile-' + last.uid)) loadProfileFrom('riftline-profile-' + last.uid);
} catch (_) {}
let cloudTimer = 0;
const saveProfile = () => {
  try { localStorage.setItem(profileKey, JSON.stringify(profile)); } catch (_) {}
  renderCoins();
  // Push to the account a moment later (batches several changes into one write)
  if (account.signedIn && profileKey !== 'riftline-profile') {
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => account.saveProgress('riftline', { coins: profile.coins, owned: profile.owned, equipped: profile.equipped }).catch(() => {}), 1200);
  }
};
const mySkins = () => ({ ...profile.equipped });
function renderCoins() { $('#coin-count').textContent = profile.coins.toLocaleString(); for (const el of document.querySelectorAll('.coin-live')) el.textContent = profile.coins.toLocaleString(); }
renderCoins();

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'high' ? 2 : settings.quality === 'low' ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const stage = new MenuStage(renderer, settings.quality);
const hud = new Hud($('#hud'));
const buy = new BuyMenu($('#buy'));
const pointer = new PointerLock(renderer.domElement);

// ---------------------------------------------------------------- app state
const app = { screen: null, game: null, net: null, mode: null, isHost: true, myId: 'h', code: '', myReady: false, lobby: null, queue: null };
window.__app = app;
window.__stage = stage;

function freshLobby() {
  return { mode: settings.mode, game: settings.game, map: settings.map, rounds: settings.rounds, difficulty: settings.difficulty, players: [{ id: 'h', name: settings.name, tag: settings.tag, char: settings.char, team: 0, ready: true, isBot: false, skins: mySkins() }] };
}

function show(id) {
  $$('.screen').forEach(s => s.classList.remove('on'));
  if (id) $('#s-' + id).classList.add('on');
  app.screen = id;
}

function toast(msg, ms = 3500, ok = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.borderColor = ok ? 'var(--green)' : ''; t.style.color = ok ? '#d0ffe6' : '';
  t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}

document.addEventListener('pointerdown', () => unlock());
document.addEventListener('mouseover', e => { if (e.target.closest?.('.btn, .char-card, .map-card, .seg button, .bm-item, .offer, .featured, .lk, .ls')) sfx.hover(); });
document.addEventListener('click', e => { if (e.target.closest?.('.btn, .char-card, .map-card, .seg button, .offer, .featured, .lk, .ls')) sfx.click(); });

// ---------------------------------------------------------------- main menu
// ---------------------------------------------------------------- Riftline ID (username#tag)
function renderId() {
  $('#id-name').textContent = settings.name; $('#id-tag').textContent = '#' + settings.tag;
  const b = $('#login-btn');
  b.textContent = account.signedIn ? '✓ Signed in' : 'Log in';
  b.classList.toggle('in', account.signedIn);
  b.title = account.signedIn ? `Signed in as ${account.user.email}. Click to manage.` : 'Log in or create an account with your email';
  renderOnline();
}
// Account box on the Riftline ID screen
function renderOnline() {
  const el = $('#acc-online');
  if (!el) return;
  el.innerHTML = account.signedIn
    ? `<span>Signed in as <b>${esc(account.user.email)}</b></span><button class="btn" id="acc-logout">Log out</button>`
    : `<button class="btn cyan" id="acc-login">Log in / Create account</button><span class="muted small">Keep your ID on an account and use it on any PC.</span>`;
}
// Take the Riftline ID from the account (or give the account this PC's ID if it has none yet)
function adoptAccount(u) {
  if (!u) return;
  if (u.name && u.tag) { settings.name = u.name; settings.tag = u.tag; settings.account = true; save(); }
  else if (settings.account) account.claimId(settings.name, settings.tag).catch(() => {});
  renderId();
  syncProgress(u);
}
// Switch to the account's coins and skins. The first time an account is used, this PC's progress moves onto it.
async function syncProgress(u) {
  const key = 'riftline-profile-' + u.uid;
  const firstTime = !localStorage.getItem(key);
  const guest = { ...profile };
  loadProfileFrom(key);
  if (firstTime) Object.assign(profile, { coins: guest.coins, owned: [...guest.owned], equipped: { ...guest.equipped } });
  renderCoins(); refreshShops();
  try {
    const cloud = await account.loadProgress('riftline');
    if (cloud) Object.assign(profile, { coins: cloud.coins ?? profile.coins, owned: cloud.owned || [], equipped: cloud.equipped || {} });
    saveProfile(); // cache locally and (if the account had nothing yet) upload this PC's progress
    refreshShops();
  } catch (_) { /* offline: keep the cached copy, it uploads on the next change */ }
}
function refreshShops() {
  if (app.screen === 'store') renderStore();
  if (app.screen === 'locker') renderLocker();
}
async function doLogin() {
  const api = window.electronAPI;
  if (!api?.openLogin) { window.open('https://camells1.github.io/account/', '_blank'); return; }
  const data = await api.openLogin();
  if (!data?.refreshToken) return;
  try {
    const u = await account.signIn(data);
    adoptAccount(u);
    toast(`Signed in as ${u.name ? u.name + '#' + u.tag : u.email}`, 3000, true);
    if (app.screen === 'account') show(settings.account ? (app.accountReturn || 'main') : 'account');
    if (!settings.account) openAccount(true);
  } catch (e) { toast('Sign-in failed: ' + e.message); }
}
async function doLogout() {
  account.logout();
  loadProfileFrom('riftline-profile'); renderCoins(); refreshShops();
  await window.electronAPI?.logout?.();
  renderId();
  toast('Logged out', 2000, true);
}
document.addEventListener('click', e => {
  if (e.target.closest('#login-btn')) { if (account.signedIn) openAccount(false); else doLogin(); }
  if (e.target.closest('#acc-login')) doLogin();
  if (e.target.closest('#acc-logout')) doLogout();
});
// Stay logged in: refresh the saved session in the background on launch
account.restore().then(adoptAccount).catch(() => {
  // Session was rejected (signed out elsewhere, password changed): back to this PC's guest progress
  if (!localStorage.getItem('riftline-auth') && !sessionStorage.getItem('riftline-auth') && profileKey !== 'riftline-profile') { loadProfileFrom('riftline-profile'); renderCoins(); }
  renderId();
});
function accPreview() {
  const n = cleanName($('#acc-name').value), t = cleanTag($('#acc-tag').value);
  $('#acc-preview').innerHTML = n ? `You'll appear as <b>${esc(n)}</b><span class="ptag">#${esc(t || '????')}</span>` : '';
}
function openAccount(first) {
  app.accountReturn = first ? 'main' : (app.screen || 'main');
  $('#acc-title').textContent = first ? 'Create your Riftline ID' : 'Edit your Riftline ID';
  $('#acc-name').value = first && settings.name === 'Player' ? '' : settings.name;
  $('#acc-tag').value = settings.tag;
  $('#acc-cancel').classList.toggle('hidden', !!first);
  $('#acc-err').textContent = '';
  accPreview();
  show('account');
  setTimeout(() => $('#acc-name').focus(), 60);
}
$('#acc-name').addEventListener('input', accPreview);
$('#acc-tag').addEventListener('input', e => { e.target.value = cleanTag(e.target.value); accPreview(); });
$('#acc-roll').addEventListener('click', () => { $('#acc-tag').value = randomTag(); accPreview(); });
$('#acc-save').addEventListener('click', async () => {
  const n = cleanName($('#acc-name').value), t = cleanTag($('#acc-tag').value);
  if (n.length < 3) { $('#acc-err').textContent = 'Username needs at least 3 characters.'; return; }
  if (t.length < 3) { $('#acc-err').textContent = 'Tag needs 3 to 5 letters or numbers.'; return; }
  const btn = $('#acc-save'); btn.disabled = true; $('#acc-err').textContent = 'Checking…';
  // Every username#tag belongs to one player only
  try {
    if (account.signedIn) await account.claimId(n, t);
    else {
      const owner = await account.ownerOf(n, t);
      if (owner) throw Object.assign(new Error('taken'), { code: 'taken' });
    }
  } catch (e) {
    btn.disabled = false;
    if (e.code === 'taken') { $('#acc-err').textContent = account.signedIn ? 'That username#tag is taken. Try a different tag.' : 'That username#tag belongs to someone\'s account. Try a different tag, or log in if it\'s yours.'; return; }
    if (account.signedIn) toast('Saved on this PC. Your account will update when you are back online.');
  }
  btn.disabled = false; $('#acc-err').textContent = '';
  settings.name = n; settings.tag = t; settings.account = true; save();
  renderId();
  toast(`Welcome, ${n}#${t}`, 2500, true);
  show(app.accountReturn || 'main');
});
for (const id of ['#acc-name', '#acc-tag']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('#acc-save').click(); });
renderId();

const actions = {
  account() { openAccount(false); },
  'acc-cancel'() { if (settings.account) show(app.accountReturn || 'main'); },
  quick() { show('queue'); $('#queue-status').innerHTML = ''; $('#queue-btn').disabled = false; renderQueueAgents(); stage.setMode('select', settings.char); },
  bot() { app.mode = 'bot'; app.isHost = true; app.myId = 'h'; app.lobby = freshLobby(); openSelect(); },
  host() { app.mode = 'online'; startHosting(); },
  join() { app.mode = 'online'; openJoin(); },
  range() { app.mode = 'range'; app.isHost = true; app.myId = 'h'; startRange(); },
  store() { openStore(); },
  locker() { openLocker(); },
  settings() { openSettings(); },
  controls() { show('controls'); },
  back() { show('main'); stage.setMode('lineup'); },
  quit() { window.close(); },
  leave() { leaveToMenu(); },
  resume() { resumeGame(); },
  quitmatch() { leaveToMenu(); },
  'settings-back'() { show(app.settingsReturn || 'main'); },
  rematch() { backToLobby(); },
  menu() { leaveToMenu(); }
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) actions[b.dataset.act]();
});

// ---------------------------------------------------------------- settings screen
function openSettings() {
  app.settingsReturn = app.screen;
  $('#set-sens').value = settings.sensitivity; $('#set-fov').value = settings.fov; $('#set-vol').value = settings.volume; $('#set-invert').checked = settings.invertY;
  refreshSettingsUI();
  show('settings');
}
function refreshSettingsUI() {
  $('#o-sens').textContent = (+settings.sensitivity).toFixed(2);
  $('#o-fov').textContent = settings.fov + '°';
  $('#o-vol').textContent = Math.round(settings.volume * 100) + '%';
  $$('#quality-seg button').forEach(b => b.classList.toggle('sel', b.dataset.v === settings.quality));
  $$('#camera-seg button').forEach(b => b.classList.toggle('sel', b.dataset.v === settings.camera));
}
$('#set-sens').addEventListener('input', e => { settings.sensitivity = +e.target.value; save(); refreshSettingsUI(); });
$('#set-fov').addEventListener('input', e => { settings.fov = +e.target.value; save(); refreshSettingsUI(); });
$('#set-vol').addEventListener('input', e => { settings.volume = +e.target.value; setVolume(settings.volume); save(); refreshSettingsUI(); });
$('#set-invert').addEventListener('change', e => { settings.invertY = e.target.checked; save(); });
$$('#quality-seg button').forEach(b => b.addEventListener('click', () => { settings.quality = b.dataset.v; save(); refreshSettingsUI(); }));
$$('#camera-seg button').forEach(b => b.addEventListener('click', () => { settings.camera = b.dataset.v; save(); refreshSettingsUI(); }));

// ---------------------------------------------------------------- store (daily offers)
const TIER_COL = { Base: '#9aa3ad', Select: '#7fc8ff', Deluxe: '#3dff9a', Premium: '#d07bff', Exclusive: '#ffb347', Ultra: '#ffd166' };
const skinById = id => SKINS.find(k => k.id === id);
const wName = id => WEAPONS.find(w => w.id === id).name;
const owns = (w, k) => k === 'default' || profile.owned.includes(w + ':' + k);

// Same offers for everyone on the same day; they rotate at local midnight.
function dailyStore() {
  const d = new Date();
  let seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pool = [];
  for (const w of WEAPONS) for (const k of SKINS) if (k.price) pool.push({ w: w.id, k: k.id });
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const featured = pool.find(o => ['Exclusive', 'Ultra'].includes(skinById(o.k).tier));
  const offers = pool.filter(o => o !== featured).slice(0, 6);
  return { featured, offers };
}
let storeSel = null;
function openStore() {
  show('store');
  const { featured } = dailyStore();
  storeSel = storeSel || featured;
  renderStore();
}
function renderStore() {
  const { featured, offers } = dailyStore();
  const fs = skinById(featured.k);
  $('#store-featured').className = 'featured' + (storeSel.w === featured.w && storeSel.k === featured.k ? ' sel' : '');
  $('#store-featured').innerHTML = `<div class="fw" style="color:${TIER_COL[fs.tier]}">${fs.tier} · ${wName(featured.w)}</div><div class="fn">${fs.name}</div><div class="fp">${owns(featured.w, featured.k) ? 'OWNED' : '◈ ' + fs.price.toLocaleString()}</div>`;
  $('#store-offers').innerHTML = offers.map((o, i) => {
    const k = skinById(o.k), have = owns(o.w, o.k), sel = storeSel.w === o.w && storeSel.k === o.k;
    return `<button class="offer ${sel ? 'sel' : ''} ${have ? 'owned' : ''}" data-i="${i}"><span class="bar" style="background:${TIER_COL[k.tier]}"></span>
      <span class="ot" style="color:${TIER_COL[k.tier]}">${k.tier.toUpperCase()}</span>
      <div><div class="on">${k.name}</div><div class="ow">${wName(o.w)}</div></div>
      <div class="op">${have ? 'OWNED' : '◈ ' + k.price.toLocaleString()}</div></button>`;
  }).join('');
  const k = skinById(storeSel.k), have = owns(storeSel.w, storeSel.k), equipped = profile.equipped[storeSel.w] === storeSel.k;
  $('#store-preview').innerHTML = `<div class="pv-name">${k.name}</div><div class="pv-sub">${wName(storeSel.w)} · <span style="color:${TIER_COL[k.tier]}">${k.tier}</span></div>` +
    (have ? (equipped ? '<button class="btn" disabled>Equipped</button>' : '<button class="btn big green" id="store-equip">Equip</button>')
      : `<button class="btn big gold" id="store-buy" ${profile.coins < k.price ? 'disabled' : ''}>${profile.coins < k.price ? `Need ◈ ${(k.price - profile.coins).toLocaleString()} more` : `Buy for ◈ ${k.price.toLocaleString()}`}</button>`);
  stage.showGun(storeSel.w, storeSel.k);
  stage.setMode('gun');
  renderCoins();
}
$('#store-featured').addEventListener('click', () => { storeSel = dailyStore().featured; renderStore(); });
$('#store-offers').addEventListener('click', e => { const b = e.target.closest('.offer'); if (b) { storeSel = dailyStore().offers[+b.dataset.i]; renderStore(); } });
$('#store-preview').addEventListener('click', e => {
  if (e.target.id === 'store-buy') {
    const k = skinById(storeSel.k);
    if (profile.coins < k.price || owns(storeSel.w, storeSel.k)) return;
    profile.coins -= k.price;
    profile.owned.push(storeSel.w + ':' + storeSel.k);
    profile.equipped[storeSel.w] = storeSel.k;
    saveProfile(); sfx.pickup();
    toast(`${k.name} ${wName(storeSel.w)} unlocked and equipped`, 2500, true);
    renderStore();
  }
  if (e.target.id === 'store-equip') { profile.equipped[storeSel.w] = storeSel.k; saveProfile(); renderStore(); }
});
setInterval(() => {
  if (app.screen !== 'store') return;
  const now = new Date(), next = new Date(now); next.setHours(24, 0, 0, 0);
  const t = Math.max(0, next - now) / 1000;
  $('#store-timer').textContent = `${Math.floor(t / 3600)}h ${String(Math.floor(t % 3600 / 60)).padStart(2, '0')}m`;
}, 1000);

// ---------------------------------------------------------------- locker (your collection)
let lockerWeapon = 'ar';
function openLocker() { show('locker'); renderLocker(); }
function renderLocker() {
  $('#locker-grid').innerHTML = WEAPONS.map(w => {
    const k = skinById(profile.equipped[w.id] || 'default');
    return `<button class="lk ${w.id === lockerWeapon ? 'sel' : ''}" data-w="${w.id}"><span class="dot" style="background:${TIER_COL[k.tier]}"></span><b>${w.name}</b><small>${k.name}</small></button>`;
  }).join('');
  const eq = profile.equipped[lockerWeapon] || 'default';
  const count = SKINS.filter(k => owns(lockerWeapon, k.id)).length;
  $('#locker-title').innerHTML = `${wName(lockerWeapon).toUpperCase()} <span class="muted small">${count}/${SKINS.length} owned</span>`;
  $('#locker-skins').innerHTML = SKINS.map(k => {
    const have = owns(lockerWeapon, k.id);
    return `<button class="ls ${k.id === eq ? 'eq' : ''} ${have ? '' : 'locked'}" data-k="${k.id}" ${have ? '' : 'disabled'}><span>${k.name}</span><span class="tag" style="color:${have ? TIER_COL[k.tier] : 'var(--muted)'}">${k.id === eq ? 'EQUIPPED' : have ? k.tier.toUpperCase() : 'IN STORE'}</span></button>`;
  }).join('');
  stage.showGun(lockerWeapon, eq);
  stage.setMode('gun');
}
$('#locker-grid').addEventListener('click', e => { const b = e.target.closest('.lk'); if (b) { lockerWeapon = b.dataset.w; renderLocker(); } });
$('#locker-skins').addEventListener('click', e => { const b = e.target.closest('.ls'); if (b && !b.disabled) { profile.equipped[lockerWeapon] = b.dataset.k; saveProfile(); renderLocker(); } });

// ---------------------------------------------------------------- quick play (matchmaking)
let queueKind = '1v1';
const AGENT_SELECT = 10; // seconds to pick agents once a match is found
const hexc = n => '#' + n.toString(16).padStart(6, '0');
function renderQueueAgents() {
  const locked = !!app.game;
  $('#queue-agents').classList.toggle('locked', locked);
  $('#queue-agents').innerHTML = CHARACTERS.map(c => `<button data-c="${c.id}" class="${c.id === settings.char ? 'sel' : ''}" style="--c:${hexc(c.color)};--a:${hexc(c.accent)}" title="${c.name}: ${c.role}"><span class="dot"></span><span class="an">${c.name}</span><span class="ar">${c.role}</span></button>`).join('');
}
$('#queue-agents').addEventListener('click', e => {
  const b = e.target.closest('button[data-c]'); if (!b || app.game) return;
  settings.char = b.dataset.c; save();
  stage.setMode('select', settings.char);
  // Already in a match lobby: tell the host
  const me = app.lobby?.players.find(p => p.id === app.myId);
  if (me) me.char = settings.char;
  if (app.net && app.lobby) { if (app.isHost) sendLobby(); else app.net.send({ type: 'pick', c: settings.char }); }
  renderQueueAgents();
});
$('#queue-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; queueKind = b.dataset.q; $$('#queue-seg button').forEach(x => x.classList.toggle('sel', x === b)); });
$('#queue-btn').addEventListener('click', async () => {
  closeNet();
  const pc = app.net = new PeerConnection();
  app.mode = 'online'; app.queue = { kind: queueKind, since: performance.now() };
  $('#queue-btn').disabled = true;
  const status = t => { if (app.net === pc) $('#queue-status').innerHTML = `<div class="spinner"></div>${t}`; };
  try {
    const res = await pc.queue(queueKind, status);
    if (app.net !== pc) return;
    if (res.role === 'host') {
      app.isHost = true; app.myId = 'h'; app.code = '';
      app.lobby = freshLobby();
      app.lobby.mode = queueKind; app.lobby.game = 'spike'; app.lobby.rounds = 5;
      app.lobby.map = queueKind === '2v2' ? [0, 4, 5][Math.floor(Math.random() * 3)] : [0, 1, 2, 3][Math.floor(Math.random() * 4)];
      bindHostNet(pc);
      pc.onMerged = () => { app.isHost = false; bindGuestNet(pc); pc.send({ type: 'hello', name: settings.name, tag: settings.tag, char: settings.char, skins: mySkins(), auto: true }); status('Joined a match. Waiting for players…'); };
      status(`Waiting for players… (1/${queueKind === '2v2' ? 4 : 2})`);
    } else {
      app.isHost = false; app.myId = pc.myId;
      bindGuestNet(pc);
      pc.send({ type: 'hello', name: settings.name, tag: settings.tag, char: settings.char, skins: mySkins(), auto: true });
      status('Match found! Waiting for the other players…');
    }
  } catch (err) {
    if (app.net !== pc) return;
    $('#queue-status').textContent = err.message || String(err);
    $('#queue-btn').disabled = false;
  }
});

// Queue host: start as soon as the room is full (or after 40s for 2v2 with bots filling in)
function queueTick() {
  if (!app.queue || !app.isHost || !app.lobby || app.game || app.mode !== 'online' || app.screen !== 'queue') return;
  const need = app.lobby.mode === '2v2' ? 4 : 2;
  const have = app.lobby.players.length;
  const waited = (performance.now() - app.queue.since) / 1000;
  const full = have >= need || (app.lobby.mode === '2v2' && have >= 2 && waited > 40);
  if (!full) {
    app.queue.selectAt = null;
    if (app.lobby.startIn != null) { app.lobby.startIn = null; sendLobby(); }
    $('#queue-status').innerHTML = `<div class="spinner"></div>Waiting for players… (${have}/${need})`;
    return;
  }
  // Match found: everyone gets a few seconds to pick an agent
  app.queue.selectAt ??= performance.now();
  const left = Math.max(0, Math.ceil(AGENT_SELECT - (performance.now() - app.queue.selectAt) / 1000));
  if (app.lobby.startIn !== left) { app.lobby.startIn = left; sendLobby(); }
  showAgentSelect(left);
  if (left <= 0) {
    for (const p of app.lobby.players) p.ready = true;
    // Balance teams
    app.lobby.players.forEach((p, i) => { p.team = i % 2; });
    hostStart();
  }
}
setInterval(queueTick, 250);
function showAgentSelect(left) {
  if (app.screen !== 'queue') return;
  $('#queue-status').innerHTML = `Match found! Pick your agent<span class="count">${left}</span>`;
}

// ---------------------------------------------------------------- hosting / joining
function startHosting() {
  closeNet();
  show('lobby');
  $('#lobby-host').classList.remove('hidden');
  $('#lobby-join').classList.add('hidden');
  $('#host-status').textContent = 'Creating room…'; $('#host-status').classList.remove('err');
  const pc = app.net = new PeerConnection();
  app.isHost = true; app.myId = 'h'; app.queue = null;
  app.lobby = freshLobby();
  pc.host().then(code => {
    if (app.net !== pc) return;
    app.code = code;
    bindHostNet(pc);
    openSelect();
    toast(`Room ${code} is open. Send the code to your friends.`, 4000, true);
  }).catch(err => {
    if (app.net !== pc) return;
    $('#host-status').textContent = 'Error: ' + (err.message || err.type || err);
    $('#host-status').classList.add('err');
  });
}

function bindHostNet(pc) {
  pc.onBrokerIssue = () => toast('Lost contact with the matchmaking server. Players already here stay connected, but new players may not be able to join until it reconnects.', 6000);
  pc.onLeave = id => {
    const p = app.lobby?.players.find(x => x.id === id);
    if (p) toast(`${p.name} left`);
    if (app.lobby) app.lobby.players = app.lobby.players.filter(x => x.id !== id);
    if (app.game) app.game.playerLeft(id);
    sendLobby();
  };
  // Quick Play rooms stop accepting once they're full
  pc.acceptQueue = () => !app.queue || app.lobby.players.length < (app.lobby.mode === '2v2' ? 4 : 2);
  pc.on('hello', (m, from) => {
    const L = app.lobby;
    const size = L.mode === '2v2' ? 2 : 1;
    if (L.players.length >= size * 2 && L.mode === '1v1' && !app.queue) L.mode = '2v2';
    const count = t => L.players.filter(p => p.team === t).length;
    L.players.push({ id: from, name: cleanName(m.name) || 'Player', tag: cleanTag(m.tag), char: CHARACTERS.some(c => c.id === m.char) ? m.char : 'blaze', team: count(0) <= count(1) ? 0 : 1, ready: !!m.auto, isBot: false, skins: sanitizeSkins(m.skins) });
    toast(`${String(m.name || 'Player').slice(0, 14)} joined`, 2500, true);
    sendLobby();
  });
  pc.on('pick', (m, from) => { const p = app.lobby.players.find(x => x.id === from); if (p && CHARACTERS.some(c => c.id === m.c)) { p.char = m.c; sendLobby(); } });
  pc.on('ready', (m, from) => { const p = app.lobby.players.find(x => x.id === from); if (p) { p.ready = !!m.v; sendLobby(); } });
  pc.on('team', (m, from) => { swapTeam(from); });
}

function sanitizeSkins(s) {
  const out = {};
  if (s && typeof s === 'object') for (const w of WEAPONS) if (SKINS.some(k => k.id === s[w.id])) out[w.id] = s[w.id];
  return out;
}

function bindGuestNet(pc) {
  pc.onClose = () => { toast('Lost connection to the host'); leaveToMenu(); };
  pc.on('lobby', m => {
    app.lobby = m.lobby;
    const me = app.lobby.players.find(p => p.id === app.myId);
    if (me) app.myReady = me.ready;
    if (app.screen === 'select') renderSelect();
    if (app.screen === 'queue' && app.lobby.startIn != null) showAgentSelect(app.lobby.startIn);
  });
  pc.on('start', m => startMatch(m));
}

function sendLobby() {
  if (app.net && app.isHost) app.net.send({ type: 'lobby', lobby: app.lobby });
  if (app.screen === 'select') renderSelect();
}

function swapTeam(id) {
  const L = app.lobby, size = L.mode === '2v2' ? 2 : 1;
  const p = L.players.find(x => x.id === id);
  if (!p) return;
  const other = 1 - p.team;
  if (L.players.filter(x => x.team === other).length >= size) { const q = L.players.find(x => x.team === other); if (q) q.team = p.team; }
  p.team = other;
  sendLobby();
}

function openJoin() {
  closeNet();
  show('lobby');
  $('#lobby-host').classList.add('hidden');
  $('#lobby-join').classList.remove('hidden');
  $('#join-status').textContent = '';
  $('#join-code').value = '';
  setTimeout(() => $('#join-code').focus(), 50);
}

$('#mini-code').addEventListener('click', () => navigator.clipboard?.writeText(app.code).then(() => toast('Code copied', 1500, true)).catch(() => {}));
$('#join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#join-btn').click(); });
$('#join-btn').addEventListener('click', () => {
  const code = $('#join-code').value.trim();
  if (code.length !== 6) { $('#join-status').textContent = 'Codes are 6 characters.'; $('#join-status').classList.add('err'); return; }
  closeNet();
  const pc = app.net = new PeerConnection();
  $('#join-status').textContent = 'Connecting…'; $('#join-status').classList.remove('err');
  $('#join-btn').disabled = true;
  bindGuestNet(pc);
  pc.join(code).then(id => {
    if (app.net !== pc) return;
    app.isHost = false; app.myId = id; app.code = code; app.myReady = false; app.lobby = null; app.queue = null;
    pc.send({ type: 'hello', name: settings.name, tag: settings.tag, char: settings.char, skins: mySkins() });
    openSelect();
  }).catch(err => {
    if (app.net !== pc) return;
    $('#join-status').textContent = err.message || String(err); $('#join-status').classList.add('err');
    app.net = null;
  }).finally(() => { $('#join-btn').disabled = false; });
});

function closeNet() {
  if (app.net) { try { app.net.send({ type: 'bye' }); } catch (_) {} app.net.destroy(); }
  app.net = null;
}

// ---------------------------------------------------------------- lobby / agent select
function openSelect() {
  show('select');
  const me = app.lobby?.players.find(p => p.id === app.myId);
  stage.setMode('select', me?.char || settings.char);
  renderSelect();
}

function renderSelect() {
  if (app.screen !== 'select') return;
  const L = app.lobby;
  const meP = L?.players.find(p => p.id === app.myId);
  const myChar = meP?.char || settings.char;
  const c = charById(myChar);
  stage.setMode('select', myChar);

  $('#char-list').innerHTML = CHARACTERS.map(ch => `
    <div class="char-card ${ch.id === myChar ? 'sel' : ''}" data-c="${ch.id}" style="--c:${hex(ch.color)}">
      <div class="cn">${ch.name}</div><div class="cr">${ch.role}</div>
    </div>`).join('');
  $('#char-info').style.setProperty('--c', hex(c.color));
  $('#char-info').innerHTML = `<p>${c.desc}</p>` + c.abilities.map(a => `<div class="abl"><kbd>${a.key}</kbd><b>${a.name}</b>${a.ult ? ` <span class="ultc">ULT · ${a.ult} pts</span>` : ` <span class="cdn">${a.cd}s</span>`}<div class="abd">${a.desc}</div></div>`).join('');

  if (!L) { $('#teams').innerHTML = '<p class="muted">Connecting to lobby…</p>'; return; }
  const canEdit = app.isHost;
  const size = L.mode === '2v2' ? 2 : 1;
  $('#game-seg').innerHTML = [['spike', 'Spike'], ['elim', 'Elimination']].map(([k, n]) => `<button data-g="${k}" class="${k === L.game ? 'sel' : ''}">${n}</button>`).join('');
  $('#mode-seg').innerHTML = ['1v1', '2v2'].map(m => `<button data-m="${m}" class="${m === L.mode ? 'sel' : ''}">${m}</button>`).join('');
  $('#code-wrap').classList.toggle('hidden', app.mode !== 'online' || !app.code);
  $('#mini-code').textContent = app.code;

  let botsNeeded = 0;
  $('#teams').innerHTML = [0, 1].map(t => {
    const ps = L.players.filter(p => p.team === t);
    const rows = ps.map(p => {
      const pc = charById(p.char);
      return `<div class="pl"><span class="pn">${esc(p.name)}${p.tag ? `<span class="ptag">#${esc(p.tag)}</span>` : ''}${p.id === app.myId ? ' (you)' : ''}</span><span class="pc" style="color:${hex(pc.color)}">${pc.name}</span>${app.mode === 'online' ? `<span class="rd">${p.id === 'h' ? 'HOST' : p.ready ? 'READY' : ''}</span>` : ''}</div>`;
    });
    for (let i = ps.length; i < size; i++) { rows.push('<div class="pl bot"><span class="pn">Bot (auto-fill)</span><span class="pc">Random</span></div>'); botsNeeded++; }
    return `<div class="team-col ${meP && meP.team === t ? 'mine' : ''}" style="--tc:${TEAM_COLORS[t]}"><h5>${TEAM_NAMES[t]}${L.game === 'spike' ? (t === 0 ? ' · ATTACK FIRST' : ' · DEFEND FIRST') : ''}</h5>${rows.join('')}</div>`;
  }).join('');
  $('#swap-team').classList.toggle('hidden', app.mode !== 'online' && size === 1);

  $$('.cfg').forEach(el => el.classList.toggle('locked', !canEdit));
  $('#map-list').innerHTML = MAPS.map(m => `<div class="map-card ${m.id === L.map ? 'sel' : ''}" data-m="${m.id}"><span class="ms ${m.size === 'Large' ? 'large' : ''}">${m.size.toUpperCase()}</span><div class="mn">${m.name}</div><div class="md">${m.desc}</div></div>`).join('');
  $('#rounds-seg').innerHTML = [5, 7, 9].map(k => `<button data-k="${k}" class="${k === L.rounds ? 'sel' : ''}">${k}</button>`).join('');
  $('#diff-wrap').classList.toggle('hidden', botsNeeded === 0);
  $('#diff-seg').innerHTML = ['easy', 'normal', 'hard'].map(d => `<button data-d="${d}" class="${d === L.difficulty ? 'sel' : ''}">${d}</button>`).join('');

  const tooMany = [0, 1].some(t => L.players.filter(p => p.team === t).length > size);
  const guestsReady = L.players.every(p => p.id === 'h' || p.ready);
  let note = '';
  if (!canEdit) note = 'The host picks the mode, map and rounds.';
  else if (tooMany) note = 'Too many players on one team for this mode.';
  else if (app.mode === 'online' && !guestsReady) note = 'Waiting for everyone to ready up…';
  else if (app.mode === 'online' && L.players.length === 1) note = 'Share the room code. Empty slots are filled with bots.';
  else if (L.game === 'spike') note = 'Spike: attackers plant at A or B, defenders stop them. Sides swap at halftime.';
  $('#cfg-note').textContent = note;

  const rb = $('#ready-btn');
  if (app.isHost) { rb.textContent = 'Start match'; rb.disabled = tooMany || !guestsReady; rb.classList.remove('on-ready'); }
  else { rb.textContent = app.myReady ? 'Ready ✓' : 'Ready'; rb.disabled = false; rb.classList.toggle('on-ready', app.myReady); }
}

function lobbyEdit(fn) { if (!app.isHost) return; fn(app.lobby); sendLobby(); }

$('#char-list').addEventListener('click', e => {
  const c = e.target.closest('.char-card'); if (!c) return;
  settings.char = c.dataset.c; save();
  const me = app.lobby?.players.find(p => p.id === app.myId);
  if (me) me.char = c.dataset.c;
  if (app.isHost) sendLobby(); else { app.net?.send({ type: 'pick', c: c.dataset.c }); renderSelect(); }
});
$('#game-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) lobbyEdit(L => { L.game = b.dataset.g; settings.game = L.game; save(); }); });
$('#mode-seg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  lobbyEdit(L => {
    if (b.dataset.m === '1v1' && L.players.length > 2) { toast('Too many players for 1v1'); return; }
    L.mode = b.dataset.m; settings.mode = L.mode; save();
    if (L.mode === '1v1') {
      const t0 = L.players.filter(p => p.team === 0); if (t0.length > 1) t0[1].team = 1;
      const t1 = L.players.filter(p => p.team === 1); if (t1.length > 1) t1[1].team = 0;
    }
  });
});
$('#swap-team').addEventListener('click', () => { if (app.isHost) swapTeam(app.myId); else app.net?.send({ type: 'team' }); });
$('#map-list').addEventListener('click', e => { const m = e.target.closest('.map-card'); if (m) lobbyEdit(L => { L.map = +m.dataset.m; settings.map = L.map; save(); }); });
$('#rounds-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) lobbyEdit(L => { L.rounds = +b.dataset.k; settings.rounds = L.rounds; save(); }); });
$('#diff-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) lobbyEdit(L => { L.difficulty = b.dataset.d; settings.difficulty = L.difficulty; save(); }); });
$('#ready-btn').addEventListener('click', () => {
  if (!app.isHost) { app.myReady = !app.myReady; app.net?.send({ type: 'ready', v: app.myReady }); renderSelect(); return; }
  hostStart();
});

function hostStart() {
  const L = app.lobby, size = L.mode === '2v2' ? 2 : 1;
  const me = L.players.find(p => p.id === 'h'); if (me) { me.skins = mySkins(); me.char = settings.char; }
  const roster = L.players.map(p => ({ id: p.id, name: p.name, tag: p.tag || '', char: p.char, team: p.team, isBot: false, skins: p.skins || {} }));
  let n = 1;
  for (const t of [0, 1]) {
    for (let i = roster.filter(p => p.team === t).length; i < size; i++) {
      const ch = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      roster.push({ id: 'b' + n++, name: `Bot ${ch.name}`, char: ch.id, team: t, isBot: true, skins: {} });
    }
  }
  const msg = { type: 'start', roster, map: L.map, rounds: L.rounds, difficulty: L.difficulty, game: L.game };
  for (const p of L.players) if (p.id !== 'h') p.ready = false;
  if (app.net) { app.net.locked = true; app.net.send(msg); }
  startMatch(msg);
}

function startRange() {
  closeNet();
  const roster = [{ id: 'h', name: settings.name, tag: settings.tag, char: settings.char, team: 0, isBot: false, skins: mySkins() }];
  startMatch({ roster, map: 99, rounds: 0, difficulty: 'normal', game: 'range' });
}

// ---------------------------------------------------------------- match
function startMatch(m) {
  app.myReady = false;
  // Grab the mouse right away while we still have the click's user activation
  // (building a big map can take a few seconds on slower PCs).
  pointer.request();
  show(null);
  $('#loading').classList.add('on');
  setTimeout(() => {
    try {
      app.game = new Game({
        renderer, hud, buy, pointer, settings,
        net: app.net, myId: app.myId, isHost: app.isHost,
        roster: m.roster, mapIndex: m.map, roundsToWin: m.rounds, difficulty: m.difficulty, mode: m.game || 'spike',
        onEnd: r => endMatch(r),
        onPauseRequest: () => pauseGame(),
        onSettingsChange: () => save()
      });
      app.game.resize(innerWidth, innerHeight);
    } catch (err) {
      console.error(err);
      toast('Failed to start match: ' + err.message);
      $('#loading').classList.remove('on');
      leaveToMenu();
      return;
    }
    $('#loading').classList.remove('on');
    $('#hud').classList.remove('hidden');
    pointer.request();
  }, 50);
}

function pauseGame() {
  if (!app.game || app.game.over) return;
  if (!app.net) app.game.paused = true;
  $('#pause-note').textContent = app.net ? 'The match keeps running online.' : '';
  show('pause');
}

function resumeGame() {
  if (!app.game) return;
  show(null);
  app.game.paused = false;
  pointer.request();
}

pointer.onChange(locked => {
  if (locked && app.game && (app.screen === 'pause' || app.screen === 'settings')) { show(null); app.game.paused = false; }
});
$('#clickplay').addEventListener('click', () => pointer.request());

function endMatch(r) {
  disposeGame();
  if (app.net && app.isHost) app.net.locked = false;
  // Coins for playing
  const earned = COINS.match + (r.win ? COINS.win : 0) + r.kills * COINS.kill + r.myScore * COINS.round;
  profile.coins += earned;
  saveProfile();
  const t = $('#over-title');
  t.textContent = r.win ? 'VICTORY' : 'DEFEAT';
  t.className = 'over-title ' + (r.win ? 'win' : 'lose');
  $('#over-score').textContent = `${r.myScore} — ${r.enemyScore}`;
  $('#over-coins').textContent = `+ ◈ ${earned} coins`;
  $('#over-stats').innerHTML = `
    <div><b>${r.kills}</b><span>Kills</span></div>
    <div><b>${r.deaths}</b><span>Deaths</span></div>
    <div><b>${r.accuracy}%</b><span>Accuracy</span></div>
    <div><b>${r.headshots}</b><span>Headshots</span></div>`;
  const myTeam = r.players.find(p => p.me)?.team ?? 0;
  $('#scoreboard').innerHTML = [myTeam, 1 - myTeam].map((tm, i) => `
    <div class="sb-team" style="--tc:${TEAM_COLORS[i]}"><h5>${i === 0 ? 'YOUR TEAM' : 'ENEMY TEAM'}</h5>
      ${r.players.filter(p => p.team === tm).sort((a, b) => b.kills - a.kills).map(p => `<div class="sb-row ${p.me ? 'me' : ''}"><span>${esc(p.name)} <small style="color:${hex(charById(p.char).color)}">${charById(p.char).name}</small></span><b>${p.kills} / ${p.deaths}</b></div>`).join('')}
    </div>`).join('');
  $('#over-note').textContent = '';
  $$('#s-over [data-act=rematch]').forEach(b => { b.textContent = app.mode === 'online' ? 'Back to lobby' : 'Play again'; });
  show('over');
  stage.setMode('select', settings.char);
}

function backToLobby() {
  if (app.mode === 'online' && (!app.net || !app.net.connected)) { toast('Connection lost'); leaveToMenu(); return; }
  if (app.isHost && app.mode === 'online') sendLobby();
  openSelect();
}

function disposeGame() {
  if (!app.game) return;
  app.game.dispose();
  app.game = null;
  $('#hud').classList.add('hidden');
  $('#clickplay').style.display = 'none';
  pointer.release();
  renderer.toneMappingExposure = 1.0;
}

function leaveToMenu() {
  disposeGame();
  closeNet();
  app.mode = null; app.lobby = null; app.code = ''; app.queue = null;
  show('main');
  stage.setMode('lineup');
  renderCoins();
}

// ---------------------------------------------------------------- auto-update (desktop app only)
const api = window.electronAPI;
function renderUpdate(u) {
  const b = $('#upd-pill');
  if (!u) return;
  const show = ['downloading', 'ready', 'manual'].includes(u.status);
  b.classList.toggle('hidden', !show);
  b.classList.toggle('ready', u.status === 'ready' || u.status === 'manual');
  if (u.status === 'downloading') b.textContent = `Downloading v${u.latest} · ${Math.round((u.progress || 0) * 100)}%`;
  if (u.status === 'ready') b.textContent = `⟳ Restart to update to v${u.latest}`;
  if (u.status === 'manual') b.textContent = `v${u.latest} is out · Download`;
  if (u.status === 'ready' && !renderUpdate.told) { renderUpdate.told = true; toast(`Update v${u.latest} is ready. Click the green button to restart.`, 5000, true); }
}
if (api?.onUpdate) {
  api.onUpdate(renderUpdate);
  api.updateState().then(renderUpdate).catch(() => {});
  $('#upd-pill').addEventListener('click', () => { if (!app.game) api.installUpdate(); });
}

// ---------------------------------------------------------------- loop
addEventListener('resize', () => {
  if (!innerWidth || !innerHeight) return;
  renderer.setSize(innerWidth, innerHeight);
  stage.resize(innerWidth, innerHeight);
  app.game?.resize(innerWidth, innerHeight);
});
addEventListener('keydown', e => {
  if (e.code === 'F11' && !navigator.userAgent.includes('Electron')) {
    e.preventDefault();
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
  }
  // Escape backs out of whatever menu is open
  if (e.code === 'Escape' && !e.repeat && app.screen) {
    const ESC = { account: 'acc-cancel', store: 'back', locker: 'back', controls: 'back', settings: 'settings-back', pause: 'resume', queue: 'leave', lobby: 'leave', select: 'leave' };
    const act = ESC[app.screen];
    if (act) { e.preventDefault(); actions[act](); }
  }
});
addEventListener('beforeunload', () => { try { app.net?.destroy(); } catch (_) {} });

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const g = app.game;
  if (g) {
    g.update(dt);
    const needClick = !pointer.locked && !g.buyOpen && !g.over && !app.screen;
    $('#clickplay').style.display = needClick ? 'flex' : 'none';
  } else stage.update(dt);
}
show('main');
if (!settings.account) openAccount(true);
stage.resize(innerWidth, innerHeight);
requestAnimationFrame(frame);
