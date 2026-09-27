// In-game HUD (DOM overlay).
const hex = c => '#' + c.toString(16).padStart(6, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="rb">
        <div class="rb-team us"><div class="rb-pips"></div><span class="rb-score">0</span></div>
        <div class="rb-mid"><div class="rb-time">0:00</div><div class="rb-phase"></div></div>
        <div class="rb-team them"><span class="rb-score">0</span><div class="rb-pips"></div></div>
      </div>
      <div class="rb-sub"></div>
      <div class="hud-feed"></div>
      <div class="hud-ping"></div>
      <div class="plates"></div>
      <div class="crosshair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><b class="dot"></b></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="scope"><div class="scope-ring"></div></div>
      <div class="vignette dmg"></div>
      <div class="vignette low"></div>
      <div class="vignette reveal"></div>
      <div class="dmg-dir"><div class="arc"></div></div>
      <div class="banner"><div class="b-title"></div><div class="b-sub"></div></div>
      <div class="center-text"></div>
      <div class="prompt"></div>
      <div class="buy-hint"><kbd>B</kbd> BUY MENU</div>
      <div class="hud-bl">
        <div class="char-tag"><span class="ct-name"></span><span class="ct-role"></span></div>
        <div class="sh-row"><div class="sh-bar"><i></i></div><span class="sh-num"></span></div>
        <div class="hp-row"><div class="hp-num">100</div><div class="hp-bar"><i class="hp-lag"></i><i class="hp-fill"></i></div></div>
        <div class="ability"><div class="ab-key">SHIFT</div><div class="ab-ring"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" class="bg"/><circle cx="22" cy="22" r="19" class="fg"/></svg><span class="ab-label"></span></div></div>
      </div>
      <div class="hud-br">
        <div class="credits">¤ <span>0</span></div>
        <div class="ammo"><span class="ammo-cur">12</span><span class="ammo-mag">/ 12</span></div>
        <div class="reload-bar"><i></i></div>
        <div class="wep-name"></div>
        <div class="wep-slots"><div class="slot" data-s="primary"><span>1</span><em></em></div><div class="slot" data-s="sidearm"><span>2</span><em></em></div></div>
      </div>
      <div class="dmg-nums"></div>`;
    const q = s => root.querySelector(s);
    this.el = {
      usScore: q('.rb-team.us .rb-score'), themScore: q('.rb-team.them .rb-score'),
      usPips: q('.rb-team.us .rb-pips'), themPips: q('.rb-team.them .rb-pips'),
      time: q('.rb-time'), phase: q('.rb-phase'), sub: q('.rb-sub'),
      feed: q('.hud-feed'), ping: q('.hud-ping'), plates: q('.plates'),
      cross: q('.crosshair'), hit: q('.hitmarker'), scope: q('.scope'),
      vDmg: q('.vignette.dmg'), vLow: q('.vignette.low'), vReveal: q('.vignette.reveal'), dmgDir: q('.dmg-dir'),
      banner: q('.banner'), bTitle: q('.b-title'), bSub: q('.b-sub'),
      center: q('.center-text'), prompt: q('.prompt'), buyHint: q('.buy-hint'),
      ctName: q('.ct-name'), ctRole: q('.ct-role'), hpNum: q('.hp-num'), hpFill: q('.hp-fill'), hpLag: q('.hp-lag'),
      shRow: q('.sh-row'), shFill: q('.sh-bar i'), shNum: q('.sh-num'),
      abRing: q('.ab-ring'), abFg: q('.ab-ring .fg'), abLabel: q('.ab-label'),
      credits: q('.credits span'), ammoCur: q('.ammo-cur'), ammoMag: q('.ammo-mag'), reload: q('.reload-bar'), reloadFill: q('.reload-bar i'),
      wepName: q('.wep-name'), slotP: q('.slot[data-s=primary]'), slotS: q('.slot[data-s=sidearm]'), nums: q('.dmg-nums')
    };
    this.plateEls = new Map();
    this.hitT = 0; this.dmgT = 0; this.dirT = 0; this.bannerT = 0; this.hpLag = 1;
    this.last = {};
  }

  setup({ roundsToWin, mapName, char }) {
    this.root.style.setProperty('--me', hex(char.color));
    this.root.style.setProperty('--accent', hex(char.accent));
    this.el.sub.textContent = `${mapName.toUpperCase()} · FIRST TO ${roundsToWin}`;
    this.el.ctName.textContent = char.name.toUpperCase();
    this.el.ctRole.textContent = char.role.toUpperCase();
    this.el.abLabel.textContent = char.abilityLabel.toUpperCase();
    this.last = {};
    this.el.feed.innerHTML = '';
    this.el.plates.innerHTML = '';
    this.plateEls.clear();
  }

  set(key, val, fn) { if (this.last[key] !== val) { this.last[key] = val; fn(val); } }

  pips(el, list) {
    const key = list.map(p => p.color + (p.alive ? 'a' : 'd')).join();
    if (el._k === key) return;
    el._k = key;
    el.innerHTML = list.map(p => `<i class="${p.alive ? '' : 'dead'}" style="--c:${hex(p.color)}"></i>`).join('');
  }

  update(dt, s) {
    const e = this.el;
    this.set('us', s.usScore, v => { e.usScore.textContent = v; pop(e.usScore); });
    this.set('them', s.themScore, v => { e.themScore.textContent = v; pop(e.themScore); });
    this.pips(e.usPips, s.usPips); this.pips(e.themPips, s.themPips);
    const tt = Math.max(0, Math.ceil(s.time));
    this.set('time', tt, v => { e.time.textContent = `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; });
    e.time.classList.toggle('urgent', s.phase === 'live' && s.time < 10);
    this.set('phase', s.phase + s.round, () => { e.phase.textContent = s.phase === 'buy' ? `ROUND ${s.round} · BUY PHASE` : s.phase === 'live' ? `ROUND ${s.round}` : s.phase === 'end' ? 'ROUND OVER' : 'MATCH OVER'; });

    const hpK = Math.max(0, s.hp / s.maxHp);
    this.set('hp', Math.ceil(s.hp), v => { e.hpNum.textContent = v; e.hpFill.style.transform = `scaleX(${hpK})`; e.hpNum.classList.toggle('crit', hpK < 0.3); });
    this.hpLag += (hpK - this.hpLag) * Math.min(1, dt * (hpK > this.hpLag ? 20 : 2.5));
    e.hpLag.style.transform = `scaleX(${this.hpLag})`;
    this.set('sh', Math.ceil(s.shield), v => { e.shRow.style.opacity = v > 0 ? 1 : 0; e.shFill.style.transform = `scaleX(${v / 50})`; e.shNum.textContent = v > 0 ? `+${v}` : ''; });

    this.set('credits', s.credits, v => { e.credits.textContent = v.toLocaleString(); });
    this.set('ammo', s.ammo + '/' + s.mag, () => { e.ammoCur.textContent = s.ammo; e.ammoMag.textContent = '/ ' + s.mag; e.ammoCur.classList.toggle('low', s.ammo <= Math.ceil(s.mag * 0.25)); });
    this.set('wep', s.weaponName, v => { e.wepName.textContent = v.toUpperCase(); });
    this.set('slots', `${s.slotP}|${s.slotS}|${s.slot}`, () => {
      e.slotP.querySelector('em').textContent = s.slotP || '—';
      e.slotS.querySelector('em').textContent = s.slotS || '—';
      e.slotP.classList.toggle('on', s.slot === 'primary'); e.slotS.classList.toggle('on', s.slot === 'sidearm');
      e.slotP.classList.toggle('empty', !s.slotP);
    });
    e.reload.style.opacity = s.reload >= 0 ? 1 : 0;
    if (s.reload >= 0) e.reloadFill.style.transform = `scaleX(${s.reload})`;

    const abK = s.abilityCdMax ? 1 - s.abilityCd / s.abilityCdMax : 1;
    e.abFg.style.strokeDashoffset = String(119.4 * (1 - abK));
    this.set('abr', abK >= 1, v => e.abRing.classList.toggle('ready', v));
    this.set('aba', s.abilityActive, v => e.abRing.classList.toggle('active', v));

    e.cross.style.setProperty('--gap', Math.max(4, Math.min(80, s.spreadPx)) + 'px');
    e.cross.style.opacity = s.showCross ? 1 : 0;
    this.set('scope', s.scope, v => e.scope.classList.toggle('on', v));

    this.hitT = Math.max(0, this.hitT - dt);
    e.hit.style.opacity = Math.min(1, this.hitT * 6);
    this.dmgT = Math.max(0, this.dmgT - dt * 1.6);
    e.vDmg.style.opacity = this.dmgT;
    e.vLow.style.opacity = hpK < 0.35 && !s.dead ? (0.55 + Math.sin(performance.now() / 180) * 0.2) * (1 - hpK / 0.35) : 0;
    e.vReveal.style.opacity = s.reveal ? 0.6 : 0;
    this.dirT = Math.max(0, this.dirT - dt);
    e.dmgDir.style.opacity = Math.min(1, this.dirT * 2);
    if (this.dirT > 0 && s.dmgAngle !== undefined) e.dmgDir.style.transform = `translate(-50%,-50%) rotate(${s.dmgAngle}rad)`;

    this.bannerT -= dt;
    if (this.bannerT <= 0) e.banner.classList.remove('on');

    this.set('center', s.centerText || '', v => { e.center.innerHTML = v; e.center.style.opacity = v ? 1 : 0; });
    this.set('prompt', s.prompt || '', v => { e.prompt.innerHTML = v; e.prompt.style.opacity = v ? 1 : 0; });
    this.set('buyHint', !!s.buyHint, v => { e.buyHint.style.opacity = v ? 1 : 0; });
    this.set('ping', s.ping, v => { e.ping.textContent = v === null ? '' : `${v} ms`; });

    // Nameplates
    const seen = new Set();
    for (const p of s.plates) {
      seen.add(p.id);
      let el = this.plateEls.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'nameplate';
        el.innerHTML = '<div class="np-mark"></div><div class="np-name"></div><div class="np-bar"><i></i></div>';
        this.el.plates.appendChild(el);
        this.plateEls.set(p.id, el);
      }
      el.style.display = 'block';
      el.classList.toggle('ally', p.ally);
      el.classList.toggle('revealed', !!p.revealed);
      el.style.setProperty('--pc', p.ally ? '#3dd6ff' : '#ff4a5a');
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%) scale(${p.scale})`;
      const nm = el.querySelector('.np-name');
      if (nm._t !== p.name) { nm._t = p.name; nm.textContent = p.name; }
      el.querySelector('.np-bar i').style.transform = `scaleX(${p.hp})`;
    }
    for (const [id, el] of this.plateEls) if (!seen.has(id)) el.style.display = 'none';

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
  hurt() { this.dmgT = Math.min(0.8, this.dmgT + 0.45); this.dirT = 1.2; }
  damageNumber(x, y, amount, head) {
    // Merge rapid hits into one number so SMG fire doesn't stack a pile of digits
    const last = this.el.nums.lastElementChild;
    if (last && last._t > 0.6 && Math.abs(last._x0 - x) < 60) {
      last._amt += amount; last.textContent = Math.round(last._amt); last._t = 0.9;
      if (head) last.classList.add('head');
      return;
    }
    const n = document.createElement('div');
    n.className = 'dnum' + (head ? ' head' : '');
    n._amt = amount; n.textContent = Math.round(amount);
    n._x0 = x; n._x = x + (Math.random() - 0.5) * 30; n._y = y; n._t = 0.9; n._s = head ? 1.25 : 1;
    this.el.nums.appendChild(n);
  }
  feed(html) {
    const d = document.createElement('div');
    d.className = 'feed-item'; d.innerHTML = html;
    this.el.feed.prepend(d);
    setTimeout(() => d.classList.add('out'), 5500);
    setTimeout(() => d.remove(), 6000);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
  }
  banner(title, sub = '', color = '#fff', dur = 2) {
    const e = this.el;
    e.bTitle.textContent = title; e.bSub.textContent = sub;
    e.banner.style.setProperty('--bc', color);
    e.banner.classList.remove('on'); void e.banner.offsetWidth; e.banner.classList.add('on');
    e.banner.style.animationDuration = dur + 's';
    this.bannerT = dur;
  }
}

function pop(el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
export { esc };
