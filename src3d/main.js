// App entry: renderer, menus, lobby (1v1 / 2v2 with bots), match lifecycle.
import * as THREE from 'three';
import { CHARACTERS, charById } from './game/data.js';
import { MAPS } from './game/maps.js';
import { MenuStage } from './game/MenuStage.js';
import { Game } from './game/Game.js';
import { Hud } from './ui/hud.js';
import { BuyMenu } from './ui/buy.js';
import { PointerLock } from './ui/pointer.js';
import { PeerConnection } from './net/PeerConnection.js';
import { sfx, setVolume, unlock } from './audio.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const hex = c => '#' + c.toString(16).padStart(6, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TEAM_NAMES = ['TEAM 1', 'TEAM 2'], TEAM_COLORS = ['#3dd6ff', '#ff4a5a'];

if (navigator.userAgent.includes('Electron')) document.body.classList.add('electron');

// ---------------------------------------------------------------- settings
const DEFAULTS = { name: 'Player', sensitivity: 1, fov: 80, volume: 0.6, invertY: false, quality: 'medium', char: 'blaze', map: 0, rounds: 5, difficulty: 'normal', mode: '1v1' };
const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('pvp3d-settings') || '{}')); } catch (_) {}
if (!CHARACTERS.some(c => c.id === settings.char)) settings.char = 'blaze';
if (!MAPS[settings.map]) settings.map = 0;
if (![5, 7, 9].includes(settings.rounds)) settings.rounds = 5;
const save = () => { try { localStorage.setItem('pvp3d-settings', JSON.stringify(settings)); } catch (_) {} };
setVolume(settings.volume);

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
const app = {
  screen: null, game: null, net: null, mode: null, isHost: true, myId: 'h', code: '',
  myReady: false,
  lobby: null,
  lastResult: null
};
window.__app = app;
window.__stage = stage;

function freshLobby() {
  return { mode: settings.mode, map: settings.map, rounds: settings.rounds, difficulty: settings.difficulty, players: [{ id: 'h', name: settings.name, char: settings.char, team: 0, ready: true, isBot: false }] };
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
document.addEventListener('mouseover', e => { if (e.target.closest?.('.btn, .char-card, .map-card, .seg button, .bm-item')) sfx.hover(); });
document.addEventListener('click', e => { if (e.target.closest?.('.btn, .char-card, .map-card, .seg button')) sfx.click(); });

// ---------------------------------------------------------------- main menu
$('#name').value = settings.name;
$('#name').addEventListener('input', e => { settings.name = e.target.value.trim().slice(0, 14) || 'Player'; save(); });

const actions = {
  bot() { app.mode = 'bot'; app.isHost = true; app.myId = 'h'; app.lobby = freshLobby(); openSelect(); },
  host() { app.mode = 'online'; startHosting(); },
  join() { app.mode = 'online'; openJoin(); },
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
}
$('#set-sens').addEventListener('input', e => { settings.sensitivity = +e.target.value; save(); refreshSettingsUI(); });
$('#set-fov').addEventListener('input', e => { settings.fov = +e.target.value; save(); refreshSettingsUI(); });
$('#set-vol').addEventListener('input', e => { settings.volume = +e.target.value; setVolume(settings.volume); save(); refreshSettingsUI(); });
$('#set-invert').addEventListener('change', e => { settings.invertY = e.target.checked; save(); });
$$('#quality-seg button').forEach(b => b.addEventListener('click', () => { settings.quality = b.dataset.v; save(); refreshSettingsUI(); }));

// ---------------------------------------------------------------- hosting / joining
function startHosting() {
  closeNet();
  show('lobby');
  $('#lobby-host').classList.remove('hidden');
  $('#lobby-join').classList.add('hidden');
  $('#host-code').textContent = '······';
  $('#host-status').textContent = 'Creating room…'; $('#host-status').classList.remove('err');
  const pc = app.net = new PeerConnection();
  app.isHost = true; app.myId = 'h';
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
  pc.onJoin = id => { /* wait for their hello */ void id; };
  pc.onLeave = id => {
    const p = app.lobby.players.find(x => x.id === id);
    if (p) toast(`${p.name} left`);
    app.lobby.players = app.lobby.players.filter(x => x.id !== id);
    if (app.game) app.game.playerLeft(id);
    sendLobby();
  };
  pc.on('hello', (m, from) => {
    const size = app.lobby.mode === '2v2' ? 2 : 1;
    const humans = t => app.lobby.players.filter(p => p.team === t).length;
    const team = humans(0) <= humans(1) ? 0 : 1;
    if (app.lobby.players.length >= size * 2 && app.lobby.mode === '1v1') { app.lobby.mode = '2v2'; } // a third friend joined: switch to 2v2
    app.lobby.players.push({ id: from, name: String(m.name || 'Player').slice(0, 14), char: CHARACTERS.some(c => c.id === m.char) ? m.char : 'blaze', team, ready: false, isBot: false });
    toast(`${String(m.name || 'Player').slice(0, 14)} joined`, 2500, true);
    sendLobby();
  });
  pc.on('pick', (m, from) => { const p = app.lobby.players.find(x => x.id === from); if (p && CHARACTERS.some(c => c.id === m.c)) { p.char = m.c; sendLobby(); } });
  pc.on('ready', (m, from) => { const p = app.lobby.players.find(x => x.id === from); if (p) { p.ready = !!m.v; sendLobby(); } });
  pc.on('team', (m, from) => { swapTeam(from); });
}

function bindGuestNet(pc) {
  pc.onClose = () => { toast('Lost connection to the host'); leaveToMenu(); };
  pc.on('lobby', m => {
    app.lobby = m.lobby;
    const me = app.lobby.players.find(p => p.id === app.myId);
    if (me) app.myReady = me.ready;
    if (app.screen === 'select') renderSelect();
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
  if (L.players.filter(x => x.team === other).length >= size) {
    // Trade places with someone on the other team
    const q = L.players.find(x => x.team === other);
    if (q) q.team = p.team;
  }
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

$('#copy-code').addEventListener('click', () => navigator.clipboard?.writeText(app.code).then(() => toast('Code copied', 1500, true)).catch(() => {}));
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
    app.isHost = false; app.myId = id; app.code = code; app.myReady = false;
    app.lobby = null;
    pc.send({ type: 'hello', name: settings.name, char: settings.char });
    openSelect();
  }).catch(err => {
    if (app.net !== pc) return;
    $('#join-status').textContent = err.message || String(err); $('#join-status').classList.add('err');
  }).finally(() => { $('#join-btn').disabled = false; });
});

function closeNet() {
  if (app.net) { try { app.net.send({ type: 'bye' }); } catch (_) {} app.net.destroy(); }
  app.net = null;
}

// ---------------------------------------------------------------- lobby / character select
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
      <div class="cn">${ch.name}</div><div class="cr">${ch.role} · ${ch.abilityLabel}</div>
    </div>`).join('');
  const bars = n => Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'f' : ''}"></i>`).join('');
  $('#char-info').style.setProperty('--c', hex(c.color));
  $('#char-info').innerHTML = `
    <div class="ab">Ability · ${c.abilityLabel}</div>
    <p>${c.desc}</p>
    <div class="stat">SPEED<div class="bars">${bars(c.stats.spd)}</div></div>
    <div class="stat">HEALTH<div class="bars">${bars(c.stats.hp)}</div></div>
    <div class="stat">ABILITY<div class="bars">${bars(c.stats.abl)}</div></div>`;

  if (!L) { $('#teams').innerHTML = '<p class="muted">Connecting to lobby…</p>'; return; }
  const canEdit = app.isHost;
  const size = L.mode === '2v2' ? 2 : 1;
  $('#mode-seg').innerHTML = ['1v1', '2v2'].map(m => `<button data-m="${m}" class="${m === L.mode ? 'sel' : ''}">${m}</button>`).join('');
  $('#code-wrap').classList.toggle('hidden', app.mode !== 'online');
  $('#mini-code').textContent = app.code;

  let botsNeeded = 0;
  $('#teams').innerHTML = [0, 1].map(t => {
    const ps = L.players.filter(p => p.team === t);
    const rows = ps.map(p => {
      const pc = charById(p.char);
      return `<div class="pl"><span class="pn">${esc(p.name)}${p.id === app.myId ? ' (you)' : ''}</span><span class="pc" style="color:${hex(pc.color)}">${pc.name}</span>${app.mode === 'online' ? `<span class="rd">${p.id === 'h' ? 'HOST' : p.ready ? 'READY' : ''}</span>` : ''}</div>`;
    });
    for (let i = ps.length; i < size; i++) { rows.push('<div class="pl bot"><span class="pn">Bot (auto-fill)</span><span class="pc">Random</span></div>'); botsNeeded++; }
    return `<div class="team-col ${meP && meP.team === t ? 'mine' : ''}" style="--tc:${TEAM_COLORS[t]}"><h5>${TEAM_NAMES[t]}</h5>${rows.join('')}</div>`;
  }).join('');
  $('#swap-team').classList.toggle('hidden', app.mode !== 'online' && size === 1);

  $$('.cfg').forEach(el => el.classList.toggle('locked', !canEdit));
  $('#swap-team').disabled = false;
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
$('#mode-seg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  lobbyEdit(L => {
    if (b.dataset.m === '1v1' && L.players.length > 2) { toast('Too many players for 1v1'); return; }
    L.mode = b.dataset.m; settings.mode = L.mode; save();
    if (L.mode === '1v1') { // one per team
      const t0 = L.players.filter(p => p.team === 0);
      if (t0.length > 1) t0[1].team = 1;
      const t1 = L.players.filter(p => p.team === 1);
      if (t1.length > 1) t1[1].team = 0;
    }
  });
});
$('#swap-team').addEventListener('click', () => { if (app.isHost) swapTeam(app.myId); else app.net?.send({ type: 'team' }); });
$('#map-list').addEventListener('click', e => { const m = e.target.closest('.map-card'); if (m) lobbyEdit(L => { L.map = +m.dataset.m; settings.map = L.map; save(); }); });
$('#rounds-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) lobbyEdit(L => { L.rounds = +b.dataset.k; settings.rounds = L.rounds; save(); }); });
$('#diff-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) lobbyEdit(L => { L.difficulty = b.dataset.d; settings.difficulty = L.difficulty; save(); }); });
$('#ready-btn').addEventListener('click', () => {
  if (!app.isHost) {
    app.myReady = !app.myReady;
    app.net?.send({ type: 'ready', v: app.myReady });
    renderSelect();
    return;
  }
  hostStart();
});

function hostStart() {
  const L = app.lobby, size = L.mode === '2v2' ? 2 : 1;
  const roster = L.players.map(p => ({ id: p.id, name: p.name, char: p.char, team: p.team, isBot: false }));
  let n = 1;
  for (const t of [0, 1]) {
    for (let i = roster.filter(p => p.team === t).length; i < size; i++) {
      const ch = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      roster.push({ id: 'b' + n++, name: `Bot ${ch.name}`, char: ch.id, team: t, isBot: true });
    }
  }
  const msg = { type: 'start', roster, map: L.map, rounds: L.rounds, difficulty: L.difficulty };
  for (const p of L.players) if (p.id !== 'h') p.ready = false;
  if (app.net) { app.net.locked = true; app.net.send(msg); }
  startMatch(msg);
}

// ---------------------------------------------------------------- match
function startMatch(m) {
  app.myReady = false;
  show(null);
  $('#loading').classList.add('on');
  setTimeout(() => {
    try {
      app.game = new Game({
        renderer, hud, buy, pointer, settings,
        net: app.net, myId: app.myId, isHost: app.isHost,
        roster: m.roster, mapIndex: m.map, roundsToWin: m.rounds, difficulty: m.difficulty,
        onEnd: r => endMatch(r),
        onPauseRequest: () => pauseGame()
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
  app.lastResult = r;
  disposeGame();
  if (app.net && app.isHost) app.net.locked = false;
  const t = $('#over-title');
  t.textContent = r.win ? 'VICTORY' : 'DEFEAT';
  t.className = 'over-title ' + (r.win ? 'win' : 'lose');
  $('#over-score').textContent = `${r.myScore} — ${r.enemyScore}`;
  $('#over-stats').innerHTML = `
    <div><b>${r.kills}</b><span>Kills</span></div>
    <div><b>${r.deaths}</b><span>Deaths</span></div>
    <div><b>${r.accuracy}%</b><span>Accuracy</span></div>
    <div><b>${r.headshots}</b><span>Headshots</span></div>`;
  const myTeam = r.players.find(p => p.me)?.team ?? 0;
  $('#scoreboard').innerHTML = [myTeam, 1 - myTeam].map((t, i) => `
    <div class="sb-team" style="--tc:${TEAM_COLORS[i]}"><h5>${i === 0 ? 'YOUR TEAM' : 'ENEMY TEAM'}</h5>
      ${r.players.filter(p => p.team === t).sort((a, b) => b.kills - a.kills).map(p => `<div class="sb-row ${p.me ? 'me' : ''}"><span>${esc(p.name)} <small style="color:${hex(charById(p.char).color)}">${charById(p.char).name}</small></span><b>${p.kills} / ${p.deaths}</b></div>`).join('')}
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
  app.mode = null; app.lobby = null; app.code = '';
  show('main');
  stage.setMode('lineup');
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
    // Show "click to play" whenever we're in a match without mouse capture and no menu is up
    const needClick = !pointer.locked && !g.buyOpen && !g.over && !app.screen;
    $('#clickplay').style.display = needClick ? 'flex' : 'none';
  } else stage.update(dt);
}
show('main');
stage.resize(innerWidth, innerHeight);
requestAnimationFrame(frame);
