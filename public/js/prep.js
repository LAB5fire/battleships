// Prep phase: the Armory (shop) and fleet deployment.
import { h, $, toast, setChildren, fmt } from './ui.js';
import { BoardView } from './board.js';
import { ITEMS, ITEM_MAP, CATEGORIES } from '/shared/items.js';
import { shipCells, toIdx, toRC } from '/shared/geometry.js';
import { randomFleet } from '/shared/layout.js';
import { session } from './session.js';
import { sfx } from './sound.js';
import { itemTag } from './help.js';
import { shake } from './fx.js';

const emptyDraft = () => ({ ships: {}, decoys: [], mines: [] });
const coarse = () => matchMedia('(pointer: coarse)').matches;

// 5x5 mini pattern shown on shop cards. Returns a Set of "r,c" strings (+ zone set).
function pattern(item) {
  const on = new Set();
  const zone = new Set();
  const add = (r, c, set = on) => set.add(`${r},${c}`);
  const square = (k, set = on) => { for (let r = 2 - k; r <= 2 + k; r++) for (let c = 2 - k; c <= 2 + k; c++) add(r, c, set); };
  switch (item.id) {
    case 'cluster': case 'radar': square(1); break;
    case 'nuke': case 'sonar': square(2); break;
    case 'cross': for (let k = 0; k < 5; k++) { add(2, k); add(k, 2); } break;
    case 'seeker': square(2, zone); add(2, 2); break;
    case 'napalm': case 'commando': add(2, 2); break;
    case 'chain': add(2, 1); add(2, 2); add(2, 3); break;
    case 'salvo': add(0, 3); add(2, 1); add(4, 4); break;
    case 'satellite': add(0, 1); add(3, 4); add(4, 0); break;
    case 'bomber': case 'recon': for (let k = 0; k < 5; k++) add(2, k); break;
    case 'torpedo': for (let k = 0; k < 4; k++) add(2, k, zone); add(2, 3); break;
    default: return null;
  }
  return { on, zone };
}

function patternGlyph(item) {
  const p = pattern(item);
  if (!p) return null;
  const cells = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const key = `${r},${c}`;
      cells.push(h('i', { class: p.on.has(key) ? 'on' : p.zone.has(key) ? 'zone' : '' }));
    }
  }
  return h('div', { class: `glyph glyph-${item.category}`, 'aria-hidden': 'true' }, cells);
}

export class PrepView {
  constructor(app) {
    this.app = app;
    this.root = $('#prep-view');
    this.tab = 'armory';
    this.draft = emptyDraft();
    this.draftKey = null;
    this.sel = null; // {kind:'ship', type} | {kind:'decoy'} | {kind:'mine'}
    this.orient = 'h';
    this.hover = -1;
    this.board = new BoardView('prep');
    this.board.on({
      click: (i) => this.onCell(i),
      hover: (i) => { this.hover = i; this.paintGhost(); },
      context: () => this.rotate(),
    });
    this.build();
    window.addEventListener('keydown', (e) => {
      if (this.app.state?.phase !== 'prep' || this.tab !== 'deploy' || e.target.closest('input, textarea')) return;
      if (e.key === 'r' || e.key === 'R') this.rotate();
      if (e.key === 'Escape') { this.sel = null; this.renderDeploy(); }
    });
  }

  build() {
    this.tabsEl = h('div', { class: 'tabs' });
    this.oppEl = h('div', { class: 'opp-status' });
    this.mainBtn = h('button', { class: 'btn btn-primary btn-ready', onclick: () => this.mainAction() });
    this.armoryEl = h('div', { class: 'armory' });
    this.paletteEl = h('div', { class: 'palette panel' });
    this.hintEl = h('p', { class: 'hint' });
    this.deployEl = h('div', { class: 'deploy' },
      h('div', { class: 'panel deploy-board' }, h('div', { class: 'board-wrap' }, this.board.el), this.hintEl),
      this.paletteEl);
    this.waitingEl = h('div', { class: 'ready-banner' });
    setChildren(this.root,
      h('div', { class: 'prep-top' }, this.tabsEl, h('div', { class: 'prep-top-right' }, this.oppEl, this.mainBtn)),
      this.waitingEl,
      this.armoryEl,
      this.deployEl);
  }

  get size() { return this.st.settings.boardSize; }

  // ---------------------------------------------------------------- draft

  ensureDraft(st) {
    const key = `${st.code}:${st.roundNo}`;
    if (this.draftKey !== key) {
      this.draftKey = key;
      this.tab = 'armory';
      this.sel = null;
      this.orient = 'h';
      const saved = session.loadDraft(key);
      this.draft = saved || (st.me.layout ? this.fromLayout(st.me.layout) : emptyDraft());
    }
    this.sanitizeDraft();
  }

  fromLayout(layout) {
    const d = emptyDraft();
    for (const s of layout.ships || []) d.ships[s.type] = { r: s.r, c: s.c, dir: s.dir };
    d.decoys = (layout.decoys || []).map((x) => ({ r: x.r, c: x.c, dir: x.dir }));
    d.mines = (layout.mines || []).map((x) => ({ r: x.r, c: x.c }));
    return d;
  }

  toLayout() {
    return {
      ships: this.st.fleet.map((spec) => ({ type: spec.type, ...this.draft.ships[spec.type] })),
      decoys: this.draft.decoys,
      mines: this.draft.mines,
    };
  }

  // Drop anything invalid: off-board, overlapping, or more deployables than owned.
  sanitizeDraft() {
    const inv = this.st.me.inventory;
    const size = this.size;
    const used = new Set();
    const claim = (cells) => {
      if (!cells || cells.some((i) => used.has(i))) return false;
      for (const i of cells) used.add(i);
      return true;
    };
    const ships = {};
    for (const spec of this.st.fleet) {
      const p = this.draft.ships?.[spec.type];
      if (p && claim(shipCells(size, p.r, p.c, p.dir, spec.size))) ships[spec.type] = p;
    }
    const decoys = [];
    for (const d of this.draft.decoys || []) {
      if (decoys.length < (inv.decoy || 0) && claim(shipCells(size, d.r, d.c, d.dir, 2))) decoys.push(d);
    }
    const mines = [];
    for (const m of this.draft.mines || []) {
      const inside = m.r >= 0 && m.c >= 0 && m.r < size && m.c < size;
      if (mines.length < (inv.mine || 0) && inside && claim([toIdx(size, m.r, m.c)])) mines.push(m);
    }
    this.draft = { ships, decoys, mines };
  }

  save() { session.saveDraft(this.draftKey, this.draft); }

  occupancy() {
    const size = this.size;
    const occ = new Map();
    for (const spec of this.st.fleet) {
      const p = this.draft.ships[spec.type];
      if (p) shipCells(size, p.r, p.c, p.dir, spec.size)?.forEach((i, k) => occ.set(i, { kind: 'ship', key: spec.type, k, len: spec.size, dir: p.dir }));
    }
    this.draft.decoys.forEach((d, n) => shipCells(size, d.r, d.c, d.dir, 2)?.forEach((i, k) => occ.set(i, { kind: 'decoy', key: n, k, len: 2, dir: d.dir })));
    this.draft.mines.forEach((m, n) => occ.set(toIdx(size, m.r, m.c), { kind: 'mine', key: n }));
    return occ;
  }

  selLength() {
    if (!this.sel) return 0;
    if (this.sel.kind === 'ship') return this.st.fleet.find((s) => s.type === this.sel.type).size;
    return this.sel.kind === 'decoy' ? 2 : 1;
  }

  // Cells the selection would occupy when dropped at cell i (nudged to fit on the board).
  placementAt(i) {
    const len = this.selLength();
    if (!len || i < 0) return null;
    const size = this.size;
    let [r, c] = toRC(size, i);
    const dir = this.orient;
    if (dir === 'h') c = Math.min(c, size - len); else r = Math.min(r, size - len);
    const cells = shipCells(size, r, c, dir, len);
    const occ = this.occupancy();
    const valid = Boolean(cells) && cells.every((x) => !occ.has(x));
    return { r, c, dir, cells: cells || [], valid };
  }

  allPlaced() { return this.st.fleet.every((s) => this.draft.ships[s.type]); }

  nextUnplaced() {
    const spec = this.st.fleet.find((s) => !this.draft.ships[s.type]);
    return spec ? { kind: 'ship', type: spec.type } : null;
  }

  // ---------------------------------------------------------------- actions

  mainAction() {
    const st = this.st;
    if (st.me.ready) { this.unready(); return; }
    if (!this.allPlaced()) {
      this.tab = 'deploy';
      if (!this.sel) this.sel = this.nextUnplaced();
      this.render(st);
      return;
    }
    this.ready();
  }

  async ready() {
    const res = await this.app.call('prep:ready', { layout: this.toLayout() });
    if (!res.ok) { toast(res.error, 'bad'); sfx('error'); return; }
    sfx('turn');
  }

  async unready() {
    const res = await this.app.call('prep:unready');
    if (!res.ok) toast(res.error, 'bad');
  }

  async buy(item) {
    const res = await this.app.call('prep:buy', { itemId: item.id });
    if (!res.ok) { toast(res.error, 'bad'); sfx('error'); return; }
    sfx('coin');
  }

  async refund(item) {
    const res = await this.app.call('prep:refund', { itemId: item.id });
    if (!res.ok) toast(res.error, 'bad');
    else sfx('click');
  }

  rotate() {
    this.orient = this.orient === 'h' ? 'v' : 'h';
    sfx('click');
    this.renderDeploy();
  }

  select(sel) {
    if (this.st.me.ready) return;
    if (sel?.kind === 'ship' && this.draft.ships[sel.type]) {
      this.orient = this.draft.ships[sel.type].dir;
      delete this.draft.ships[sel.type]; // pick it up
      this.save();
    }
    this.sel = sel;
    sfx('click');
    this.renderDeploy();
  }

  onCell(i) {
    if (this.st.me.ready) return;
    const clicked = this.occupancy().get(i);
    if (!this.sel || (clicked && !this.placementAt(i)?.valid)) {
      const hit = clicked;
      if (!hit) return;
      if (hit.kind === 'ship') { this.select({ kind: 'ship', type: hit.key }); return; }
      if (hit.kind === 'decoy') { this.orient = this.draft.decoys[hit.key].dir; this.draft.decoys.splice(hit.key, 1); this.sel = { kind: 'decoy' }; }
      if (hit.kind === 'mine') { this.draft.mines.splice(hit.key, 1); this.sel = { kind: 'mine' }; }
      this.save();
      sfx('click');
      this.renderDeploy();
      return;
    }
    const p = this.placementAt(i);
    if (!p || !p.valid) {
      sfx('error');
      shake(this.board.el);
      return;
    }
    if (this.sel.kind === 'ship') {
      this.draft.ships[this.sel.type] = { r: p.r, c: p.c, dir: p.dir };
      this.sel = this.nextUnplaced();
    } else if (this.sel.kind === 'decoy') {
      this.draft.decoys.push({ r: p.r, c: p.c, dir: p.dir });
      if (this.draft.decoys.length >= (this.st.me.inventory.decoy || 0)) this.sel = null;
    } else {
      this.draft.mines.push({ r: p.r, c: p.c });
      if (this.draft.mines.length >= (this.st.me.inventory.mine || 0)) this.sel = null;
    }
    this.save();
    sfx('click');
    this.renderDeploy();
    this.renderTabs();
    this.renderMain();
  }

  randomize() {
    const size = this.size;
    const blocked = new Set();
    this.draft.decoys.forEach((d) => shipCells(size, d.r, d.c, d.dir, 2)?.forEach((i) => blocked.add(i)));
    this.draft.mines.forEach((m) => blocked.add(toIdx(size, m.r, m.c)));
    const ships = randomFleet(size, this.st.fleet, blocked);
    if (!ships) { toast('Could not fit the fleet. Clear some decoys or mines.', 'warn'); return; }
    this.draft.ships = Object.fromEntries(ships.map((s) => [s.type, { r: s.r, c: s.c, dir: s.dir }]));
    this.sel = null;
    this.save();
    sfx('click');
    this.render(this.st);
  }

  reuseLast() {
    const last = this.st.me.lastLayout;
    if (!last) return;
    this.draft = this.fromLayout(last);
    this.sanitizeDraft();
    this.sel = null;
    this.save();
    this.render(this.st);
  }

  clearAll() {
    this.draft = emptyDraft();
    this.sel = this.nextUnplaced();
    this.save();
    this.render(this.st);
  }

  // ---------------------------------------------------------------- rendering

  render(st) {
    this.st = st;
    this.ensureDraft(st);
    this.board.setSize(st.settings.boardSize);
    if (st.me.ready) this.sel = null;
    this.renderTabs();
    this.renderMain();
    this.renderArmory();
    this.renderDeploy();
    this.armoryEl.hidden = this.tab !== 'armory';
    this.deployEl.hidden = this.tab !== 'deploy';
  }

  renderTabs() {
    const placed = this.st.fleet.filter((s) => this.draft.ships[s.type]).length;
    const tab = (id, label) => h('button', {
      class: `tab ${this.tab === id ? 'active' : ''}`,
      onclick: () => { this.tab = id; if (id === 'deploy' && !this.sel && !this.st.me.ready) this.sel = this.nextUnplaced(); sfx('click'); this.render(this.st); },
    }, label);
    setChildren(this.tabsEl,
      tab('armory', '🛒 Armory'),
      tab('deploy', `⚓ Deploy fleet ${placed}/${this.st.fleet.length}`));
  }

  renderMain() {
    const st = this.st;
    const opp = st.opp;
    let oppText = '';
    if (opp) oppText = !opp.connected ? `🔌 ${opp.name} disconnected` : opp.ready ? `✅ ${opp.name} is ready` : `🛠️ ${opp.name} is preparing…`;
    this.oppEl.textContent = oppText;
    this.oppEl.className = `opp-status ${opp?.ready ? 'is-ready' : ''}`;
    if (st.me.ready) {
      this.mainBtn.textContent = '✏️ Edit';
      this.mainBtn.className = 'btn btn-ready';
    } else if (this.allPlaced()) {
      this.mainBtn.textContent = 'Ready ✓';
      this.mainBtn.className = 'btn btn-primary btn-ready pulse';
    } else {
      this.mainBtn.textContent = 'Deploy fleet ▶';
      this.mainBtn.className = 'btn btn-primary btn-ready';
    }
    if (st.me.ready) {
      setChildren(this.waitingEl, h('span', { class: 'spinner' }), opp?.ready ? 'Starting battle…' : `Ready! Waiting for ${opp?.name || 'your opponent'} to finish.`);
      this.waitingEl.hidden = false;
    } else {
      this.waitingEl.hidden = true;
    }
  }

  renderArmory() {
    const st = this.st;
    const me = st.me;
    const lr = st.lastRound?.players?.[st.seat];
    const owned = ITEMS.filter((i) => me.inventory[i.id] > 0);
    const head = h('div', { class: 'armory-head panel' },
      h('div', { class: 'wallet' }, h('span', { class: 'wallet-label' }, 'Your coins'), h('span', { class: 'wallet-amount' }, `💰 ${fmt(me.coins)}`)),
      h('div', { class: 'armory-info' },
        h('div', {}, h('b', {}, `Round ${st.roundNo}`), ` · first to ${st.roundsToWin} round wins`),
        lr ? h('div', { class: 'muted small' }, `Last round you earned +${fmt(lr.total)}: ${lr.hits} hits (+${lr.hitCoins}), ${lr.sinks} sinks (+${lr.sinkCoins}), round bonus +${lr.bonus}.`) : h('div', { class: 'muted small' }, 'Buy items now. Coins from hits and sinks pay out after each round.'),
        h('div', { class: 'muted small' }, 'Unused items carry over to later rounds.')));

    const shop = h('div', { class: 'shop' }, CATEGORIES.map((cat) => h('section', { class: 'shop-cat' },
      h('div', { class: 'shop-cat-head' }, h('h3', {}, `${cat.icon} ${cat.name}`), h('span', { class: 'muted small' }, cat.blurb)),
      h('div', { class: 'item-grid' }, ITEMS.filter((i) => i.category === cat.id).map((item) => this.card(item))))));

    const loadout = h('aside', { class: 'loadout panel' },
      h('h3', {}, '🎒 Your loadout'),
      owned.length
        ? h('ul', { class: 'loadout-list' }, owned.map((i) => h('li', {}, h('span', {}, `${i.icon} ${i.name}`), h('b', {}, `×${me.inventory[i.id]}`))))
        : h('p', { class: 'muted small' }, 'Nothing yet. A standard shot is always free!'),
      h('button', { class: 'btn btn-primary btn-block', onclick: () => { this.tab = 'deploy'; if (!this.sel) this.sel = this.nextUnplaced(); this.render(this.st); } }, 'Deploy fleet ▶'));

    setChildren(this.armoryEl, head, h('div', { class: 'armory-body' }, shop, loadout));
  }

  card(item) {
    const me = this.st.me;
    const owned = me.inventory[item.id] || 0;
    const bought = me.bought[item.id] || 0;
    const maxed = owned >= item.max;
    const broke = me.coins < item.price;
    const canBuy = !me.ready && !maxed && !broke;
    return h('div', { class: `item-card cat-${item.category} ${owned ? 'is-owned' : ''}` },
      h('div', { class: 'item-top' },
        h('div', { class: 'item-icon' }, item.icon),
        h('div', { class: 'item-title' }, h('div', { class: 'item-name' }, item.name), itemTag(item)),
        patternGlyph(item)),
      h('p', { class: 'item-desc' }, item.desc),
      h('div', { class: 'item-foot' },
        h('span', { class: 'item-owned' }, owned ? `Owned ${owned}/${item.max}` : `Max ${item.max}`),
        bought && !me.ready ? h('button', { class: 'btn btn-small btn-ghost', title: 'Sell back for the full price', onclick: () => this.refund(item) }, '↩ Sell') : null,
        h('button', {
          class: `btn btn-small btn-buy ${broke && !maxed ? 'is-broke' : ''}`,
          disabled: !canBuy,
          onclick: () => this.buy(item),
        }, maxed ? 'Maxed' : `💰 ${item.price}`)));
  }

  renderDeploy() {
    if (!this.st) return;
    const st = this.st;
    const inv = st.me.inventory;
    const occ = this.occupancy();
    const size = this.size;

    for (let i = 0; i < size * size; i++) {
      const o = occ.get(i);
      if (!o) { this.board.paint(i, 'water'); continue; }
      if (o.kind === 'mine') { this.board.paint(i, 'water own-mine', '🧨'); continue; }
      const ends = `${o.k === 0 ? ' first' : ''}${o.k === o.len - 1 ? ' last' : ''}`;
      this.board.paint(i, `ship seg-${o.dir}${ends}${o.kind === 'decoy' ? ' decoy' : ''}`, o.kind === 'decoy' && o.k === 0 ? '🎭' : '');
    }
    this.paintGhost();

    this.hintEl.textContent = st.me.ready
      ? 'Your fleet is locked in. Press Edit to change it.'
      : coarse()
        ? 'Pick a ship from the list, then tap the board. Use Rotate to turn it. Tap a placed ship to move it.'
        : 'Pick a ship, then click the board. Right-click or press R to rotate. Click a placed ship to move it.';

    const shipRow = (spec) => {
      const placed = Boolean(this.draft.ships[spec.type]);
      const active = this.sel?.kind === 'ship' && this.sel.type === spec.type;
      return h('button', {
        class: `pal-row ${placed ? 'placed' : ''} ${active ? 'active' : ''}`,
        disabled: st.me.ready,
        onclick: () => this.select({ kind: 'ship', type: spec.type }),
      },
      h('span', { class: 'pal-name' }, spec.name),
      h('span', { class: 'pips' }, Array.from({ length: spec.size }, () => h('i'))),
      h('span', { class: 'pal-state' }, active ? 'placing…' : placed ? '✓' : ''));
    };
    const deployRow = (kind, item, count, placed) => {
      const active = this.sel?.kind === kind;
      return h('button', {
        class: `pal-row ${placed >= count ? 'placed' : ''} ${active ? 'active' : ''}`,
        disabled: st.me.ready || (placed >= count && !active),
        onclick: () => { if (placed < count) { this.sel = { kind }; sfx('click'); this.renderDeploy(); } },
      },
      h('span', { class: 'pal-name' }, `${item.icon} ${item.name}`),
      h('span', { class: 'pal-count' }, `${placed}/${count}`),
      h('span', { class: 'pal-state' }, active ? 'placing…' : placed >= count ? '✓' : ''));
    };

    const deployables = [];
    if (inv.decoy > 0) deployables.push(deployRow('decoy', ITEM_MAP.decoy, inv.decoy, this.draft.decoys.length));
    if (inv.mine > 0) deployables.push(deployRow('mine', ITEM_MAP.mine, inv.mine, this.draft.mines.length));

    setChildren(this.paletteEl,
      h('h3', {}, '🚢 Your fleet'),
      h('div', { class: 'pal-list' }, st.fleet.map(shipRow)),
      deployables.length
        ? [h('h3', {}, '🧰 Deployables'), h('div', { class: 'pal-list' }, deployables)]
        : h('p', { class: 'muted small' }, 'Buy Decoy Ships or Sea Mines in the Armory to place them here.'),
      h('div', { class: 'pal-tools' },
        h('button', { class: 'btn', disabled: st.me.ready, onclick: () => this.rotate() }, this.orient === 'h' ? '⟳ Rotate (horizontal)' : '⟳ Rotate (vertical)'),
        h('button', { class: 'btn', disabled: st.me.ready, onclick: () => this.randomize() }, '🎲 Random fleet'),
        st.me.lastLayout ? h('button', { class: 'btn', disabled: st.me.ready, onclick: () => this.reuseLast() }, '↺ Last round\'s layout') : null,
        h('button', { class: 'btn btn-ghost', disabled: st.me.ready, onclick: () => this.clearAll() }, '✖ Clear')),
      h('button', {
        class: `btn btn-primary btn-block btn-big ${this.allPlaced() && !st.me.ready ? 'pulse' : ''}`,
        disabled: !this.allPlaced() && !st.me.ready,
        onclick: () => this.mainAction(),
      }, st.me.ready ? '✏️ Edit fleet' : this.allPlaced() ? 'Ready for battle ✓' : `Place ${st.fleet.length - Object.keys(this.draft.ships).length} more ship(s)`));
  }

  paintGhost() {
    const marks = new Map();
    if (this.sel && this.hover >= 0 && !this.st.me.ready) {
      const p = this.placementAt(this.hover);
      if (p) for (const i of p.cells) marks.set(i, p.valid ? 'ghost-ok' : 'ghost-bad');
    }
    this.board.setMarks(marks);
  }
}
