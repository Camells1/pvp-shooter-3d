// App entry: renderer, menus, lobby, character select, match lifecycle.
import * as THREE from 'three';
import { CHARACTERS, charById } from './game/data.js';
import { MAPS } from './game/maps.js';
import { MenuStage } from './game/MenuStage.js';
import { Game } from './game/Game.js';
import { Hud } from './ui/hud.js';
import { PeerConnection } from './net/PeerConnection.js';
import { sfx, setVolume, unlock } from './audio.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const hex = c => '#' + c.toString(16).padStart(6, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

if (navigator.userAgent.includes('Electron')) document.body.classList.add('electron');

// ---------------------------------------------------------------- settings
const DEFAULTS = { name: 'Player', sensitivity: 1, fov: 80, volume: 0.6, invertY: false, quality: 'medium', char: 'blaze', map: 0, kills: 10, difficulty: 'normal' };
const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('pvp3d-settings') || '{}')); } catch (_) {}
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

// ---------------------------------------------------------------- app state
const app = {
  screen: null, prevScreen: null,
  game: null, net: null, mode: null, isHost: false,
  myChar: settings.char, myReady: false,
  opp: { name: 'Opponent', char: null, ready: false, present: false },
  cfg: { map: settings.map, kills: settings.kills, difficulty: settings.difficulty },
  lastResult: null
};
window.__app = app; // handy for debugging
window.__stage = stage;

function show(id) {
  $$('.screen').forEach(s => s.classList.remove('on'));
  if (id) $('#s-' + id).classList.add('on');
  app.prevScreen = app.screen;
  app.screen = id;
}

function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}

// Button sounds
document.addEventListener('pointerdown', () => unlock(), { once: false });
document.addEventListener('mouseover', e => { if (e.target.closest?.('.btn, .char-card, .map-card, .seg button')) sfx.hover(); });
document.addEventListener('click', e => { if (e.target.closest?.('.btn, .char-card, .map-card, .seg button')) sfx.click(); });

// ---------------------------------------------------------------- main menu
$('#name').value = settings.name;
$('#name').addEventListener('input', e => { settings.name = e.target.value.trim().slice(0, 14) || 'Player'; save(); });

const actions = {
  bot() { app.mode = 'bot'; app.isHost = true; openSelect(); },
  host() { app.mode = 'online'; openLobby(true); },
  join() { app.mode = 'online'; openLobby(false); },
  settings() { openSettings(); },
  controls() { show('controls'); },
  back() { show('main'); stage.setMode('lineup'); },
  quit() { window.close(); },
  leave() { leaveToMenu(); },
  resume() { resumeGame(); },
  quitmatch() { leaveToMenu(); },
  'settings-back'() { show(app.settingsReturn || 'main'); if (app.settingsReturn === 'pause') $('#s-pause').classList.add('on'); },
  rematch() { rematch(); },
  menu() { leaveToMenu(); }
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) actions[b.dataset.act]();
});

// ---------------------------------------------------------------- settings screen
function openSettings() {
  app.settingsReturn = app.screen;
  const s = settings;
  $('#set-sens').value = s.sensitivity; $('#set-fov').value = s.fov; $('#set-vol').value = s.volume; $('#set-invert').checked = s.invertY;
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

// ---------------------------------------------------------------- lobby / networking
function openLobby(host) {
  show('lobby');
  $('#lobby-host').classList.toggle('hidden', !host);
  $('#lobby-join').classList.toggle('hidden', host);
  closeNet();
  const pc = app.net = new PeerConnection();
  if (host) {
    $('#host-code').textContent = '······';
    $('#host-status').textContent = 'Creating room…'; $('#host-status').classList.remove('err');
    pc.host().then(code => {
      if (app.net !== pc) return;
      $('#host-code').textContent = code;
      $('#host-status').textContent = 'Waiting for opponent…';
      return pc.waitForGuest().then(() => { if (app.net === pc) onConnected(true); });
    }).catch(err => {
      if (app.net !== pc) return;
      $('#host-status').textContent = 'Error: ' + (err.message || err.type || err);
      $('#host-status').classList.add('err');
    });
  } else {
    $('#join-status').textContent = '';
    $('#join-code').value = '';
    setTimeout(() => $('#join-code').focus(), 50);
  }
}

$('#copy-code').addEventListener('click', () => {
  const code = $('#host-code').textContent;
  navigator.clipboard?.writeText(code).then(() => toastOk('Code copied')).catch(() => {});
});
function toastOk(msg) { const t = $('#toast'); t.style.borderColor = 'var(--green)'; t.style.color = '#d0ffe6'; toast(msg, 1500); setTimeout(() => { t.style.borderColor = ''; t.style.color = ''; }, 1900); }

$('#join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#join-btn').click(); });
$('#join-btn').addEventListener('click', () => {
  const code = $('#join-code').value.trim();
  if (code.length !== 6) { $('#join-status').textContent = 'Codes are 6 characters.'; $('#join-status').classList.add('err'); return; }
  closeNet();
  const pc = app.net = new PeerConnection();
  $('#join-status').textContent = 'Connecting…'; $('#join-status').classList.remove('err');
  $('#join-btn').disabled = true;
  pc.join(code).then(() => { if (app.net === pc) onConnected(false); })
    .catch(err => { if (app.net !== pc) return; $('#join-status').textContent = err.message || String(err); $('#join-status').classList.add('err'); })
    .finally(() => { $('#join-btn').disabled = false; });
});

function onConnected(isHost) {
  const n = app.net;
  app.isHost = isHost;
  app.opp = { name: 'Opponent', char: null, ready: false, present: true };
  n.onClose = () => {
    if (!app.net) return;
    toast('Opponent disconnected');
    leaveToMenu();
  };
  n.on('hello', m => { app.opp.name = String(m.name || 'Opponent').slice(0, 14); app.opp.char = m.char; renderSelect(); });
  n.on('pick', m => { app.opp.char = m.c; renderSelect(); });
  n.on('ready', m => { app.opp.ready = !!m.v; renderSelect(); maybeStart(); });
  n.on('cfg', m => { if (!app.isHost) { app.cfg.map = m.map; app.cfg.kills = m.kills; renderSelect(); } });
  n.on('start', m => { if (!app.isHost) startMatch(m); });
  n.on('lobby', () => { app.opp.ready = false; app.opp.present = true; if (app.screen === 'over') $('#over-note').textContent = `${app.opp.name} is back in the lobby.`; renderSelect(); });
  n.on('leave', () => { toast(`${app.opp.name} left the match`); leaveToMenu(); });
  n.send({ type: 'hello', name: settings.name, char: app.myChar });
  openSelect();
}

function closeNet() {
  if (app.net) { app.net.send({ type: 'leave' }); app.net.destroy(); }
  app.net = null;
}

// ---------------------------------------------------------------- character select
function openSelect() {
  app.myReady = false;
  show('select');
  stage.setMode('select', app.myChar, app.mode === 'bot' ? null : app.opp.char);
  if (app.net) { app.net.send({ type: 'pick', c: app.myChar }); app.net.send({ type: 'ready', v: false }); if (app.isHost) sendCfg(); }
  renderSelect();
}

function sendCfg() { app.net?.send({ type: 'cfg', map: app.cfg.map, kills: app.cfg.kills }); }

function renderSelect() {
  if (app.screen !== 'select') return;
  const me = charById(app.myChar);
  $('#char-list').innerHTML = CHARACTERS.map(c => `
    <div class="char-card ${c.id === app.myChar ? 'sel' : ''}" data-c="${c.id}" style="--c:${hex(c.color)}">
      <div class="cn">${c.name}</div><div class="cr">${c.role}</div>
    </div>`).join('');
  const bars = n => Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'f' : ''}"></i>`).join('');
  $('#char-info').style.setProperty('--c', hex(me.color));
  $('#char-info').innerHTML = `
    <div class="ab">Ability · ${me.abilityLabel}</div>
    <p>${me.desc}</p>
    <div class="stat">SPEED<div class="bars">${bars(me.stats.spd)}</div></div>
    <div class="stat">HEALTH<div class="bars">${bars(me.stats.hp)}</div></div>
    <div class="stat">ABILITY<div class="bars">${bars(me.stats.abl)}</div></div>`;

  // Opponent panel
  const op = $('#opp-panel');
  if (app.mode === 'bot') {
    op.innerHTML = `<div class="ol">OPPONENT</div><div class="on">Bot</div><div class="oc muted">Random fighter</div>`;
  } else {
    const oc = app.opp.char ? charById(app.opp.char) : null;
    op.innerHTML = `<div class="ol">OPPONENT</div><div class="on">${esc(app.opp.name)}</div>
      <div class="oc" style="color:${oc ? hex(oc.color) : 'var(--muted)'}">${oc ? oc.name.toUpperCase() : 'CHOOSING…'}
      · <span class="${app.opp.ready ? 'ready' : 'notready'}">${app.opp.ready ? 'READY' : 'NOT READY'}</span></div>`;
  }
  stage.setMode('select', app.myChar, app.mode === 'bot' ? null : app.opp.char);

  // Config
  const canEdit = app.mode === 'bot' || app.isHost;
  $('.cfg').classList.toggle('locked', !canEdit);
  $('#map-list').innerHTML = MAPS.map(m => `<div class="map-card ${m.id === app.cfg.map ? 'sel' : ''}" data-m="${m.id}"><div class="mn">${m.name}</div><div class="md">${m.desc}</div></div>`).join('');
  $('#kills-seg').innerHTML = [5, 10, 15].map(k => `<button data-k="${k}" class="${k === app.cfg.kills ? 'sel' : ''}">${k}</button>`).join('');
  $('#diff-wrap').classList.toggle('hidden', app.mode !== 'bot');
  $('#diff-seg').innerHTML = ['easy', 'normal', 'hard'].map(d => `<button data-d="${d}" class="${d === app.cfg.difficulty ? 'sel' : ''}">${d}</button>`).join('');
  $('#cfg-note').textContent = canEdit ? '' : 'The host picks the map and score limit.';

  const rb = $('#ready-btn');
  if (app.mode === 'bot') { rb.textContent = 'Start'; rb.classList.remove('on-ready'); }
  else { rb.textContent = app.myReady ? 'Ready ✓ (waiting)' : 'Ready'; rb.classList.toggle('on-ready', app.myReady); }
}

$('#char-list').addEventListener('click', e => {
  const c = e.target.closest('.char-card'); if (!c) return;
  app.myChar = c.dataset.c; settings.char = app.myChar; save();
  app.net?.send({ type: 'pick', c: app.myChar });
  renderSelect();
});
$('#map-list').addEventListener('click', e => {
  const m = e.target.closest('.map-card'); if (!m) return;
  app.cfg.map = +m.dataset.m; settings.map = app.cfg.map; save(); sendCfg(); renderSelect();
});
$('#kills-seg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  app.cfg.kills = +b.dataset.k; settings.kills = app.cfg.kills; save(); sendCfg(); renderSelect();
});
$('#diff-seg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  app.cfg.difficulty = b.dataset.d; settings.difficulty = b.dataset.d; save(); renderSelect();
});
$('#ready-btn').addEventListener('click', () => {
  if (app.mode === 'bot') {
    const others = CHARACTERS.filter(c => c.id !== app.myChar);
    startMatch({ map: app.cfg.map, kills: app.cfg.kills, enemyChar: others[Math.floor(Math.random() * others.length)].id });
    return;
  }
  app.myReady = !app.myReady;
  app.net?.send({ type: 'ready', v: app.myReady });
  renderSelect();
  maybeStart();
});

function maybeStart() {
  if (app.mode !== 'online' || !app.isHost || app.screen !== 'select') return;
  if (!(app.myReady && app.opp.ready && app.opp.char)) return;
  const msg = { type: 'start', map: app.cfg.map, kills: app.cfg.kills, hostChar: app.myChar, guestChar: app.opp.char };
  app.net.send(msg);
  startMatch(msg);
}

// ---------------------------------------------------------------- match
function startMatch(m) {
  let myChar, enemyChar;
  if (app.mode === 'bot') { myChar = app.myChar; enemyChar = m.enemyChar; }
  else if (app.isHost) { myChar = m.hostChar; enemyChar = m.guestChar; }
  else { myChar = m.guestChar; enemyChar = m.hostChar; app.cfg.map = m.map; app.cfg.kills = m.kills; }
  app.myReady = false; app.opp.ready = false;

  show(null);
  $('#loading').classList.add('on');
  // Let the loading screen paint before the heavy build
  setTimeout(() => {
    try {
      const botName = `Bot ${charById(enemyChar).name}`;
      app.game = new Game({
        renderer, hud, settings,
        mapIndex: m.map, myChar: charById(myChar), enemyChar: charById(enemyChar),
        mode: app.mode, net: app.net, isHost: app.isHost,
        difficulty: app.cfg.difficulty, killLimit: m.kills,
        myName: settings.name, enemyName: app.mode === 'bot' ? botName : app.opp.name,
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
    $('#clickplay').style.display = 'block';
    app.game.lockPointer();
  }, 50);
}

function pauseGame() {
  if (!app.game || app.game.over) return;
  app.game.paused = true;
  $('#pause-note').textContent = app.mode === 'online' ? 'The match keeps running online.' : '';
  show('pause');
}

function resumeGame() {
  if (!app.game) return;
  show(null);
  app.game.paused = false;
  const p = renderer.domElement.requestPointerLock?.();
  if (p && p.catch) p.catch(() => { $('#clickplay').style.display = 'block'; });
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) { $('#clickplay').style.display = 'none'; if (app.screen === 'pause') { show(null); app.game && (app.game.paused = false); } }
});

function endMatch(r) {
  app.lastResult = r;
  disposeGame();
  const t = $('#over-title');
  t.textContent = r.win ? 'VICTORY' : 'DEFEAT';
  t.className = 'over-title ' + (r.win ? 'win' : 'lose');
  $('#over-score').textContent = `${r.myKills} — ${r.enemyKills}`;
  $('#over-stats').innerHTML = `
    <div><b>${r.myKills}</b><span>Kills</span></div>
    <div><b>${r.deaths}</b><span>Deaths</span></div>
    <div><b>${r.accuracy}%</b><span>Accuracy</span></div>
    <div><b>${r.headshots}</b><span>Headshots</span></div>`;
  $('#over-note').textContent = '';
  show('over');
  stage.setMode('select', app.myChar, null);
}

function rematch() {
  if (app.mode === 'online') {
    if (!app.net || !app.net.connected) { toast('Opponent is gone'); leaveToMenu(); return; }
    app.net.send({ type: 'lobby' });
  }
  openSelect();
}

function disposeGame() {
  if (!app.game) return;
  app.game.dispose();
  app.game = null;
  $('#hud').classList.add('hidden');
  $('#clickplay').style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();
  renderer.toneMappingExposure = 1.0;
}

function leaveToMenu() {
  disposeGame();
  closeNet();
  app.mode = null;
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

addEventListener('beforeunload', () => app.net?.send({ type: 'leave' }));

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (app.game) app.game.update(dt);
  else stage.update(dt);
}
show('main');
stage.resize(innerWidth, innerHeight);
requestAnimationFrame(frame);
