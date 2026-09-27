// In-game HUD (DOM overlay).
import { WEAPONS } from '../game/data.js';

const hex = c => '#' + c.toString(16).padStart(6, '0');

export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-score">
        <div class="hs-side me"><span class="hs-name"></span><span class="hs-kills">0</span></div>
        <div class="hs-mid"><div class="hs-limit"></div><div class="hs-map"></div></div>
        <div class="hs-side enemy"><span class="hs-kills">0</span><span class="hs-name"></span></div>
      </div>
      <div class="hud-feed"></div>
      <div class="hud-ping"></div>
      <div class="crosshair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><b class="dot"></b></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="scope"><div class="scope-ring"></div></div>
      <div class="vignette dmg"></div>
      <div class="vignette low"></div>
      <div class="dmg-dir"><div class="arc"></div></div>
      <div class="banner"><div class="b-title"></div><div class="b-sub"></div></div>
      <div class="respawn"></div>
      <div class="nameplate"><div class="np-name"></div><div class="np-bar"><i></i></div></div>
      <div class="hud-bl">
        <div class="char-tag"><span class="ct-name"></span><span class="ct-role"></span></div>
        <div class="hp-row"><div class="hp-num">100</div><div class="hp-bar"><i class="hp-lag"></i><i class="hp-fill"></i></div></div>
        <div class="ability"><div class="ab-key">SHIFT</div><div class="ab-ring"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" class="bg"/><circle cx="22" cy="22" r="19" class="fg"/></svg><span class="ab-label"></span></div></div>
      </div>
      <div class="hud-br">
        <div class="ammo"><span class="ammo-cur">12</span><span class="ammo-mag">/ 12</span></div>
        <div class="reload-bar"><i></i></div>
        <div class="wep-name"></div>
        <div class="wep-slots"></div>
      </div>
      <div class="dmg-nums"></div>`;
    const q = s => root.querySelector(s);
    this.el = {
      meName: q('.hs-side.me .hs-name'), meKills: q('.hs-side.me .hs-kills'),
      enName: q('.hs-side.enemy .hs-name'), enKills: q('.hs-side.enemy .hs-kills'),
      limit: q('.hs-limit'), map: q('.hs-map'), feed: q('.hud-feed'), ping: q('.hud-ping'),
      cross: q('.crosshair'), hit: q('.hitmarker'), scope: q('.scope'),
      vDmg: q('.vignette.dmg'), vLow: q('.vignette.low'), dmgDir: q('.dmg-dir'),
      banner: q('.banner'), bTitle: q('.b-title'), bSub: q('.b-sub'), respawn: q('.respawn'),
      np: q('.nameplate'), npName: q('.np-name'), npFill: q('.np-bar i'),
      ctName: q('.ct-name'), ctRole: q('.ct-role'), hpNum: q('.hp-num'), hpFill: q('.hp-fill'), hpLag: q('.hp-lag'),
      abRing: q('.ab-ring'), abFg: q('.ab-ring .fg'), abLabel: q('.ab-label'),
      ammoCur: q('.ammo-cur'), ammoMag: q('.ammo-mag'), reload: q('.reload-bar'), reloadFill: q('.reload-bar i'),
      wepName: q('.wep-name'), slots: q('.wep-slots'), nums: q('.dmg-nums')
    };
    this.el.slots.innerHTML = WEAPONS.map((w, i) => `<div class="slot" data-i="${i}"><span>${i + 1}</span>${w.name}</div>`).join('');
    this.hitT = 0; this.dmgT = 0; this.dirT = 0; this.bannerT = 0; this.hpLag = 1;
    this.last = {};
  }

  setup({ myName, enemyName, myColor, enemyColor, limit, mapName, char }) {
    this.el.meName.textContent = myName; this.el.enName.textContent = enemyName;
    this.root.style.setProperty('--me', hex(myColor));
    this.root.style.setProperty('--enemy', hex(enemyColor));
    this.root.style.setProperty('--accent', hex(char.accent));
    this.el.limit.textContent = `FIRST TO ${limit}`;
    this.el.map.textContent = mapName.toUpperCase();
    this.el.ctName.textContent = char.name.toUpperCase();
    this.el.ctRole.textContent = char.role.toUpperCase();
    this.el.abLabel.textContent = char.abilityLabel.toUpperCase();
    this.el.npName.textContent = enemyName;
  }

  set(key, val, fn) { if (this.last[key] !== val) { this.last[key] = val; fn(val); } }

  update(dt, s) {
    const e = this.el;
    this.set('mk', s.myKills, v => { e.meKills.textContent = v; e.meKills.classList.remove('pop'); void e.meKills.offsetWidth; e.meKills.classList.add('pop'); });
    this.set('ek', s.enemyKills, v => { e.enKills.textContent = v; e.enKills.classList.remove('pop'); void e.enKills.offsetWidth; e.enKills.classList.add('pop'); });
    const hpK = Math.max(0, s.hp / s.maxHp);
    this.set('hp', Math.ceil(s.hp), v => { e.hpNum.textContent = v; e.hpFill.style.transform = `scaleX(${hpK})`; e.hpNum.classList.toggle('crit', hpK < 0.3); });
    this.hpLag += (hpK - this.hpLag) * Math.min(1, dt * (hpK > this.hpLag ? 20 : 2.5));
    e.hpLag.style.transform = `scaleX(${this.hpLag})`;

    const w = WEAPONS[s.weapon];
    this.set('ammo', s.ammo + '/' + w.mag, () => { e.ammoCur.textContent = s.ammo; e.ammoMag.textContent = '/ ' + w.mag; e.ammoCur.classList.toggle('low', s.ammo <= Math.ceil(w.mag * 0.25)); });
    this.set('wep', s.weapon, v => { e.wepName.textContent = w.name.toUpperCase(); for (const el of e.slots.children) el.classList.toggle('on', +el.dataset.i === v); });
    e.reload.style.opacity = s.reload >= 0 ? 1 : 0;
    if (s.reload >= 0) e.reloadFill.style.transform = `scaleX(${s.reload})`;

    const abK = s.abilityCdMax ? 1 - s.abilityCd / s.abilityCdMax : 1;
    e.abFg.style.strokeDashoffset = String(119.4 * (1 - abK));
    this.set('abr', abK >= 1, v => e.abRing.classList.toggle('ready', v));
    this.set('aba', s.abilityActive, v => e.abRing.classList.toggle('active', v));

    // Crosshair
    const gap = Math.max(4, Math.min(80, s.spreadPx));
    e.cross.style.setProperty('--gap', gap + 'px');
    e.cross.style.opacity = s.showCross ? 1 : 0;
    this.set('scope', s.scope, v => e.scope.classList.toggle('on', v));

    // Hitmarker / vignettes
    this.hitT = Math.max(0, this.hitT - dt);
    e.hit.style.opacity = Math.min(1, this.hitT * 6);
    this.dmgT = Math.max(0, this.dmgT - dt * 1.6);
    e.vDmg.style.opacity = this.dmgT;
    e.vLow.style.opacity = hpK < 0.35 && !s.dead ? (0.55 + Math.sin(performance.now() / 180) * 0.2) * (1 - hpK / 0.35) : 0;
    this.dirT = Math.max(0, this.dirT - dt);
    e.dmgDir.style.opacity = Math.min(1, this.dirT * 2);
    if (this.dirT > 0 && s.dmgAngle !== undefined) e.dmgDir.style.transform = `translate(-50%,-50%) rotate(${s.dmgAngle}rad)`;

    this.bannerT -= dt;
    if (this.bannerT <= 0) e.banner.classList.remove('on');

    e.respawn.textContent = s.respawnText || '';
    e.respawn.style.opacity = s.respawnText ? 1 : 0;
    this.set('ping', s.ping, v => { e.ping.textContent = v === null ? '' : `${v} ms`; });

    // Nameplate
    if (s.plate) {
      e.np.style.display = 'block';
      e.np.style.transform = `translate(${s.plate.x}px, ${s.plate.y}px) translate(-50%, -100%) scale(${s.plate.scale})`;
      e.npFill.style.transform = `scaleX(${s.plate.hp})`;
    } else e.np.style.display = 'none';

    // Damage numbers float
    for (const n of [...e.nums.children]) {
      n._t -= dt;
      if (n._t <= 0) { n.remove(); continue; }
      n._y -= dt * 40;
      n.style.transform = `translate(${n._x}px, ${n._y}px) translate(-50%,-50%) scale(${n._s})`;
      n.style.opacity = Math.min(1, n._t * 2.5);
    }
  }

  hitmarker(head, kill) {
    this.hitT = kill ? 0.45 : 0.25;
    this.el.hit.className = 'hitmarker' + (head ? ' head' : '') + (kill ? ' kill' : '');
  }
  hurt(angle) { this.dmgT = Math.min(0.8, this.dmgT + 0.45); this.dirT = 1.2; }
  damageNumber(x, y, amount, head) {
    const n = document.createElement('div');
    n.className = 'dnum' + (head ? ' head' : '');
    n.textContent = Math.round(amount);
    n._x = x + (Math.random() - 0.5) * 30; n._y = y; n._t = 0.9; n._s = head ? 1.25 : 1;
    this.el.nums.appendChild(n);
  }
  feed(html) {
    const d = document.createElement('div');
    d.className = 'feed-item'; d.innerHTML = html;
    this.el.feed.prepend(d);
    setTimeout(() => d.classList.add('out'), 4500);
    setTimeout(() => d.remove(), 5000);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
  }
  banner(title, sub = '', color = '#fff', dur = 2) {
    const e = this.el;
    e.bTitle.textContent = title; e.bSub.textContent = sub;
    e.banner.style.setProperty('--bc', color);
    e.banner.classList.remove('on'); void e.banner.offsetWidth; e.banner.classList.add('on');
    this.bannerT = dur;
  }
}
