// Buy menu overlay (opened with B during the buy phase).
import { WEAPONS, SHIELDS } from '../game/data.js';

const CATS = [
  { title: 'Sidearms', ids: ['classic', 'mpistol', 'cannon'] },
  { title: 'SMGs & Shotguns', ids: ['smg', 'shotgun'] },
  { title: 'Rifles', ids: ['scout', 'ar'] },
  { title: 'Snipers & Heavy', ids: ['sniper', 'lmg'] }
];

const bar = (v, max) => `<div class="bm-bar"><i style="transform:scaleX(${Math.min(1, v / max)})"></i></div>`;

export class BuyMenu {
  constructor(root) {
    this.root = root;
    this.onBuy = null;
    this.onClose = null;
    this.isOpen = false;
    const weaponCard = w => {
      const dps = Math.round(w.dmg * w.pellets / w.rate);
      return `<button class="bm-item" data-id="${w.id}">
        <div class="bm-top"><span class="bm-name">${w.name}</span><span class="bm-price">${w.price ? '¤ ' + w.price.toLocaleString() : 'FREE'}</span></div>
        <div class="bm-stats">
          <label>DMG</label>${bar(w.dmg * w.pellets, 110)}<label>RATE</label>${bar(1 / w.rate, 14)}<label>DPS</label>${bar(dps, 330)}
        </div>
        <div class="bm-meta">${w.mag} rounds · ${w.slot === 'primary' ? 'Primary' : 'Sidearm'}${w.scope ? ' · Scope' : ''}</div>
        <div class="bm-badge"></div>
      </button>`;
    };
    root.innerHTML = `
      <div class="bm-panel">
        <div class="bm-head">
          <div><div class="bm-title">BUY MENU</div><div class="bm-timer"></div></div>
          <div class="bm-credits">¤ <span>0</span></div>
        </div>
        <div class="bm-grid">
          ${CATS.map(c => `<div class="bm-col"><h4>${c.title}</h4>${c.ids.map(id => weaponCard(WEAPONS.find(w => w.id === id))).join('')}</div>`).join('')}
          <div class="bm-col"><h4>Shields</h4>
            ${SHIELDS.map(s => `<button class="bm-item shield" data-id="${s.id}">
              <div class="bm-top"><span class="bm-name">${s.name}</span><span class="bm-price">¤ ${s.price.toLocaleString()}</span></div>
              <div class="bm-shield"><i style="width:${s.amount * 2}%"></i></div>
              <div class="bm-meta">+${s.amount} shield · absorbs damage before health</div>
              <div class="bm-badge"></div>
            </button>`).join('')}
            <div class="bm-team"></div>
          </div>
        </div>
        <div class="bm-foot">Click to buy · Buying a new gun drops your old one for a teammate · <kbd>B</kbd> or <kbd>Esc</kbd> to close</div>
      </div>`;
    root.addEventListener('click', e => {
      const b = e.target.closest('.bm-item');
      if (b && !b.classList.contains('locked')) this.onBuy?.(b.dataset.id);
      if (e.target === root) this.close();
    });
  }

  open() { this.isOpen = true; this.root.classList.add('on'); }
  close() { if (!this.isOpen) return; this.isOpen = false; this.root.classList.remove('on'); this.onClose?.(); }

  // s: { credits, time, owned: Set(ids), shield, team: [{name, credits, color}] }
  update(s) {
    if (!this.isOpen) return;
    this.root.querySelector('.bm-credits span').textContent = s.credits.toLocaleString();
    this.root.querySelector('.bm-timer').textContent = `Buy phase ends in ${Math.max(0, Math.ceil(s.time))}s`;
    for (const b of this.root.querySelectorAll('.bm-item')) {
      const id = b.dataset.id;
      const w = WEAPONS.find(x => x.id === id), sh = SHIELDS.find(x => x.id === id);
      const price = w ? w.price : sh.price;
      const owned = w ? s.owned.has(id) : s.shield >= sh.amount;
      b.classList.toggle('owned', owned);
      b.classList.toggle('locked', owned || price > s.credits);
      b.querySelector('.bm-badge').textContent = owned ? 'OWNED' : price > s.credits ? 'NEED ¤' + (price - s.credits) : '';
    }
    const team = this.root.querySelector('.bm-team');
    const html = s.team.length ? '<h4>Teammates</h4>' + s.team.map(t => `<div class="bm-mate"><span style="color:${t.color}">${t.name}</span><b>¤ ${t.credits.toLocaleString()}</b></div>`).join('') : '';
    if (team._h !== html) { team._h = html; team.innerHTML = html; }
  }
}
