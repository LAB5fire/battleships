// Battle phase: both boards, the arsenal, targeting, effects, log & chat, round results.
import { h, $, toast, setChildren, fmt, modal } from './ui.js';
import { BoardView } from './board.js';
import { ITEMS, ITEM_MAP } from '/shared/items.js';
import { VIEW, toRC, shapeCells, squareCells, lineCells, lanePath, shipCells, LANE_DIRS } from '/shared/geometry.js';
import { EMOTES } from '/shared/config.js';
import { sfx } from './sound.js';
import * as fx from './fx.js';
import { itemTag } from './help.js';

const VIEW_CLASS = {
  [VIEW.UNKNOWN]: 'fog', [VIEW.MISS]: 'miss', [VIEW.HIT]: 'hit', [VIEW.SUNK]: 'sunk', [VIEW.SPOTTED]: 'spotted',
  [VIEW.CLEAR]: 'clear', [VIEW.DECOY]: 'decoy', [VIEW.MINE]: 'mine-hit', [VIEW.MINE_SPOTTED]: 'mine-spotted',
};
const VIEW_CONTENT = { [VIEW.DECOY]: '🎭', [VIEW.MINE]: '💥', [VIEW.MINE_SPOTTED]: '🧨' };
const DIR_LABEL = { right: '→ from the left', left: '← from the right', down: '↓ from the top', up: '↑ from the bottom' };
const STRIKE_FX = { hit: 'boom', decoyhit: 'boom', decoy: 'boom', sunk: 'boom-big', miss: 'splash', blocked: 'block', mine: 'mine' };
const STRIKE_SOUND = { hit: 'hit', decoyhit: 'hit', decoy: 'hit', sunk: 'sunk', miss: 'splash', blocked: 'block', mine: 'big' };

const HOW_TO_AIM = {
  cell: 'Click a cell on the enemy board to aim, then Launch (or click it again).',
  line: 'Pick a row or column on the enemy board. Rotate switches between them.',
  lane: 'Pick the lane, and set which edge the torpedo starts from.',
  multi: 'Pick the cells to fire at on the enemy board.',
  none: 'No aiming needed. Just launch.',
  ownShip: 'Click one of YOUR ships to protect it.',
  ownHit: 'Click a damaged part of one of YOUR ships.',
  relocate: 'Click one of YOUR undamaged ships, then click where it should go.',
};

export class BattleView {
  constructor(app) {
    this.app = app;
    this.root = $('#battle-view');
    this.enemy = new BoardView('enemy');
    this.mine = new BoardView('mine');
    this.sel = this.freshSel();
    this.commsTab = 'log';
    this.lastLogId = null;
    this.chatSeen = 0;
    this.resultKey = null;
    this.resultModal = null;
    this.busy = false;
    this.build();
    this.enemy.on({ click: (i) => this.onEnemyClick(i), hover: (i) => { this.sel.hover = i; this.refreshMarks(); }, context: () => this.rotate() });
    this.mine.on({ click: (i) => this.onMineClick(i), hover: (i) => { this.sel.hoverMine = i; this.refreshMarks(); }, context: () => this.rotate() });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  freshSel(keep = {}) {
    return { itemId: null, orient: keep.orient || 'h', dir: keep.dir || 'right', aim: null, multi: [], shipId: null, hover: -1, hoverMine: -1 };
  }

  build() {
    this.turnEl = h('div', { class: 'turn-pill' });
    this.timerEl = h('div', { class: 'timer', hidden: true });
    this.enemyFleetEl = h('div', { class: 'fleet-chips' });
    this.enemyPanel = h('section', { class: 'panel enemy-panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, '🎯 Enemy waters'), h('div', { class: 'head-right' }, this.timerEl, this.turnEl)),
      h('div', { class: 'board-wrap' }, this.enemy.el),
      this.enemyFleetEl);

    this.tacticalEl = h('span', { class: 'tactical-state' });
    this.arsenalEl = h('div', { class: 'arsenal-items' });
    this.aimEl = h('div', { class: 'aim-bar' });
    this.passiveEl = h('div', { class: 'passives' });
    this.arsenalPanel = h('section', { class: 'panel arsenal-panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, '🧰 Arsenal'), this.tacticalEl),
      this.arsenalEl, this.aimEl, this.passiveEl);

    this.earnedEl = h('span', { class: 'earned' });
    this.myFleetEl = h('div', { class: 'my-fleet' });
    this.minePanel = h('section', { class: 'panel mine-panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, '⚓ Your fleet'), this.earnedEl),
      h('div', { class: 'board-wrap' }, this.mine.el),
      this.myFleetEl);

    this.commsTabsEl = h('div', { class: 'tabs tabs-small' });
    this.logEl = h('div', { class: 'log-list', role: 'log' });
    this.chatEl = h('div', { class: 'chat-list', hidden: true });
    this.chatInput = h('input', { class: 'chat-input', maxlength: '200', placeholder: 'Message your opponent…', 'aria-label': 'Chat message' });
    this.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sendChat(); });
    this.commsPanel = h('section', { class: 'panel comms-panel' },
      this.commsTabsEl, this.logEl, this.chatEl,
      h('div', { class: 'chat-row' }, this.chatInput, h('button', { class: 'btn btn-small', onclick: () => this.sendChat() }, 'Send')),
      h('div', { class: 'emotes' }, EMOTES.map((e) => h('button', { class: 'emote-btn', title: 'Send emote', onclick: () => this.emote(e) }, e))));

    this.roundBar = h('div', { class: 'round-bar', hidden: true });
    setChildren(this.root,
      h('div', { class: 'battle-layout' },
        h('div', { class: 'col-main' }, this.enemyPanel, this.arsenalPanel),
        h('div', { class: 'col-side' }, this.minePanel, this.commsPanel)),
      this.roundBar);
  }

  // ---------------------------------------------------------------- helpers

  myTurn() { return this.st?.phase === 'battle' && this.st.battle?.turn === 'me' && this.st.opp?.connected !== false; }
  item() { return this.sel.itemId ? ITEM_MAP[this.sel.itemId] : null; }
  rc(i) { const [r, c] = toRC(this.st.battle.size, i); return { r, c }; }

  shotValid(i) {
    const v = this.st.battle.enemy.view[i];
    return v === VIEW.UNKNOWN || v === VIEW.SPOTTED;
  }

  vesselAt(i) {
    for (const v of this.st.battle.my.vessels) {
      const k = v.cells.indexOf(i);
      if (k >= 0) return { v, k };
    }
    return null;
  }

  preview(item, i) {
    const size = this.st.battle.size;
    const [r, c] = toRC(size, i);
    if (item.targeting === 'line') return { cells: lineCells(size, r, c, this.sel.orient) };
    if (item.targeting === 'lane') return { cells: lanePath(size, r, c, this.sel.dir) };
    return { cells: shapeCells(item.shape, size, r, c), zone: item.zone ? shapeCells(item.zone, size, r, c) : null };
  }

  // Evasive maneuver target for the selected ship dropped at cell i.
  relocation(i) {
    const my = this.st.battle.my;
    const ship = my.vessels.find((v) => v.id === this.sel.shipId);
    if (!ship || i < 0) return null;
    const size = this.st.battle.size;
    let [r, c] = toRC(size, i);
    if (this.sel.orient === 'h') c = Math.min(c, size - ship.size); else r = Math.min(r, size - ship.size);
    const cells = shipCells(size, r, c, this.sel.orient, ship.size) || [];
    const mines = new Set(my.mines);
    const valid = cells.length > 0 && cells.every((x) => {
      const o = this.vesselAt(x);
      if (o && o.v.id !== ship.id) return false;
      if (mines.has(x)) return false;
      return o ? true : my.view[x] === VIEW.UNKNOWN;
    }) && !cells.every((x, k) => x === ship.cells[k]);
    return { anchor: r * size + c, cells, valid };
  }

  aimReady() {
    const item = this.item();
    if (!item) return false;
    const s = this.sel;
    switch (item.targeting) {
      case 'cell': case 'line': case 'lane': case 'ownHit': return s.aim != null;
      case 'multi': {
        const open = this.st.battle.enemy.view.filter((v) => v === VIEW.UNKNOWN || v === VIEW.SPOTTED).length;
        return s.multi.length > 0 && s.multi.length >= Math.min(item.count, open);
      }
      case 'none': return true;
      case 'ownShip': return Boolean(s.shipId);
      case 'relocate': return Boolean(s.shipId) && s.aim != null && Boolean(this.relocation(s.aim)?.valid);
      default: return false;
    }
  }

  // ---------------------------------------------------------------- input

  selectItem(id) {
    if (!this.myTurn()) return;
    this.sel = { ...this.freshSel(this.sel), itemId: id };
    sfx('click');
    this.renderArsenal();
    this.refreshMarks();
  }

  clearSel(redraw = true) {
    this.sel = this.freshSel(this.sel);
    if (redraw && this.st?.battle) {
      this.renderArsenal();
      this.refreshMarks();
    }
  }

  rotate() {
    const item = this.item();
    if (!item) return;
    if (item.targeting === 'line' || item.targeting === 'relocate') this.sel.orient = this.sel.orient === 'h' ? 'v' : 'h';
    else if (item.targeting === 'lane') this.sel.dir = LANE_DIRS[(LANE_DIRS.indexOf(this.sel.dir) + 1) % LANE_DIRS.length];
    else return;
    sfx('click');
    this.renderAim();
    this.refreshMarks();
  }

  onKey(e) {
    if (!this.st || this.st.phase !== 'battle' || e.target.closest('input, textarea') || document.querySelector('.modal-backdrop')) return;
    if (e.key === 'r' || e.key === 'R') this.rotate();
    else if (e.key === 'Escape') this.clearSel();
    else if (e.key === 'Enter' && this.aimReady()) this.launch();
  }

  onEnemyClick(i) {
    if (!this.myTurn()) {
      if (this.st?.phase === 'battle') toast(this.st.opp?.connected === false ? 'Waiting for your opponent to reconnect.' : "It's the enemy's turn.", 'warn', 1500);
      return;
    }
    const item = this.item();
    if (!item) {
      if (this.shotValid(i)) this.fire({ type: 'shot', ...this.rc(i) });
      else { sfx('error'); toast('You already know what is there. Pick another cell.', 'warn', 1600); }
      return;
    }
    switch (item.targeting) {
      case 'cell': case 'line': case 'lane':
        if (this.sel.aim === i) { this.launch(); return; }
        this.sel.aim = i;
        break;
      case 'multi': {
        const k = this.sel.multi.indexOf(i);
        if (k >= 0) this.sel.multi.splice(k, 1);
        else if (!this.shotValid(i)) { sfx('error'); return; }
        else if (this.sel.multi.length < item.count) this.sel.multi.push(i);
        break;
      }
      case 'none':
        return;
      default:
        toast(HOW_TO_AIM[item.targeting], 'info', 2000);
        return;
    }
    sfx('click');
    this.renderAim();
    this.refreshMarks();
  }

  onMineClick(i) {
    if (!this.myTurn()) return;
    const item = this.item();
    if (!item) return;
    const o = this.vesselAt(i);
    switch (item.targeting) {
      case 'ownShip':
        if (!o || o.v.isDecoy || o.v.sunk) { sfx('error'); toast('Click one of your ships that is still afloat.', 'warn'); return; }
        if (this.sel.shipId === o.v.id) { this.launch(); return; }
        this.sel.shipId = o.v.id;
        break;
      case 'ownHit':
        if (!o || o.v.isDecoy || o.v.sunk || !o.v.hits[o.k]) { sfx('error'); toast('Click a damaged part of a ship that is still afloat.', 'warn'); return; }
        if (this.sel.aim === i) { this.launch(); return; }
        this.sel.aim = i;
        break;
      case 'relocate': {
        if (o && !o.v.isDecoy && (!this.sel.shipId || (o.v.id !== this.sel.shipId && this.sel.aim == null))) {
          if (o.v.sunk || o.v.hits.some(Boolean)) { sfx('error'); toast('Only undamaged ships can maneuver.', 'warn'); return; }
          this.sel.shipId = o.v.id;
          this.sel.orient = o.v.dir;
          this.sel.aim = null;
          break;
        }
        if (!this.sel.shipId) { sfx('error'); toast('First click one of your undamaged ships.', 'warn'); return; }
        const p = this.relocation(i);
        if (!p?.valid) { sfx('error'); toast('It can only move onto cells the enemy has never hit or scanned.', 'warn', 2200); return; }
        if (this.sel.aim === p.anchor) { this.launch(); return; }
        this.sel.aim = p.anchor;
        break;
      }
      default:
        toast(HOW_TO_AIM[item.targeting] || 'Aim at the enemy board.', 'info', 1800);
        return;
    }
    sfx('click');
    this.renderAim();
    this.refreshMarks();
  }

  launch() {
    const item = this.item();
    if (!item || !this.myTurn()) return;
    if (!this.aimReady()) { toast('Aim first!', 'warn', 1400); return; }
    const s = this.sel;
    const payload = { type: 'item', itemId: item.id };
    switch (item.targeting) {
      case 'cell': case 'ownHit': Object.assign(payload, this.rc(s.aim)); break;
      case 'line': Object.assign(payload, this.rc(s.aim), { orient: s.orient }); break;
      case 'lane': Object.assign(payload, this.rc(s.aim), { dir: s.dir }); break;
      case 'multi': payload.targets = s.multi.map((i) => this.rc(i)); break;
      case 'ownShip': payload.shipId = s.shipId; break;
      case 'relocate': Object.assign(payload, this.rc(s.aim), { shipId: s.shipId, dir: s.orient }); break;
      default: break;
    }
    this.fire(payload);
  }

  async fire(payload) {
    if (this.busy) return;
    this.busy = true;
    const res = await this.app.call('battle:act', payload);
    this.busy = false;
    if (!res.ok) { toast(res.error, 'bad'); sfx('error'); return; }
    this.clearSel();
  }

  async sendChat() {
    const text = this.chatInput.value.trim();
    if (!text) return;
    const res = await this.app.call('chat', { text });
    if (!res.ok) { toast(res.error, 'warn'); return; }
    this.chatInput.value = '';
  }

  async emote(e) {
    const res = await this.app.call('emote', { emoji: e });
    if (!res.ok) toast(res.error, 'warn', 1500);
  }

  // ---------------------------------------------------------------- render

  render(st) {
    this.st = st;
    const bt = st.battle;
    if (!bt) return;
    this.enemy.setSize(bt.size);
    this.mine.setSize(bt.size);
    const item = this.item();
    if (!this.myTurn() || (item && !(st.me.inventory[item.id] > 0)) || (item?.action === 'tactical' && bt.tacticalUsed)) {
      this.sel = this.freshSel(this.sel);
    }
    this.root.classList.toggle('my-turn', this.myTurn());
    this.paintEnemy();
    this.paintMine();
    this.renderHeader();
    this.renderArsenal();
    this.renderFleets();
    this.renderComms();
    this.renderRoundEnd();
    this.refreshMarks();
  }

  paintEnemy() {
    const bt = this.st.battle;
    const e = bt.enemy;
    const size = bt.size;
    const burning = new Set(e.burning);
    let revealAt = null;
    let revealMines = null;
    if (e.reveal) {
      revealAt = new Map();
      for (const v of e.reveal.vessels) v.cells.forEach((c, k) => revealAt.set(c, { v, k }));
      revealMines = new Set(e.reveal.mines);
    }
    for (let i = 0; i < size * size; i++) {
      const v = e.view[i];
      let cls = VIEW_CLASS[v] || 'fog';
      let content = VIEW_CONTENT[v] || '';
      if (v === VIEW.HIT && burning.has(i)) cls += ' burning';
      if (revealAt && (v === VIEW.UNKNOWN || v === VIEW.SPOTTED || v === VIEW.CLEAR)) {
        const o = revealAt.get(i);
        if (o) {
          cls += ` revealed seg-${o.v.dir}${o.k === 0 ? ' first' : ''}${o.k === o.v.size - 1 ? ' last' : ''}${o.v.isDecoy ? ' revealed-decoy' : ''}`;
          if (o.v.isDecoy && o.k === 0) content = '🎭';
        } else if (revealMines.has(i)) {
          cls += ' revealed-mine';
          content = '🧨';
        }
      }
      this.enemy.paint(i, cls, content);
    }
    const overlays = e.sunk.map((s) => ({ cells: s.cells, cls: 'ov-sunk' }));
    for (const s of e.sonar) overlays.push({ cells: squareCells(size, s.r, s.c, s.radius), cls: 'ov-sonar', label: String(s.count) });
    this.enemy.setOverlays(overlays);
    this.enemy.el.classList.toggle('targeting', this.myTurn());
  }

  paintMine() {
    const bt = this.st.battle;
    const my = bt.my;
    const size = bt.size;
    const at = new Map();
    for (const v of my.vessels) v.cells.forEach((c, k) => at.set(c, { v, k }));
    const mines = new Set(my.mines);
    for (let i = 0; i < size * size; i++) {
      const known = my.view[i];
      const o = at.get(i);
      let cls;
      let content = '';
      if (o) {
        const { v, k } = o;
        cls = `ship seg-${v.dir}${k === 0 ? ' first' : ''}${k === v.size - 1 ? ' last' : ''}`;
        if (v.isDecoy) cls += ' decoy';
        if (v.hits[k]) cls += ' hit';
        if (v.sunk) cls += ' sunk';
        if (v.shield > 0 && !v.sunk) cls += ' shielded';
        if (v.burning && v.hits[k]) cls += ' burning';
        if (!v.hits[k] && (known === VIEW.SPOTTED || known === VIEW.DECOY)) cls += ' exposed';
        if (v.isDecoy && k === 0) content = '🎭';
      } else if (mines.has(i)) {
        cls = `water own-mine${known === VIEW.MINE_SPOTTED ? ' exposed' : ''}`;
        content = '🧨';
      } else {
        cls = 'water';
        if (known === VIEW.MISS) cls += ' miss';
        else if (known === VIEW.CLEAR) cls += ' scanned';
        else if (known === VIEW.MINE) { cls += ' mine-hit'; content = '💥'; }
      }
      this.mine.paint(i, cls, content);
    }
    this.mine.setOverlays(my.vessels.filter((v) => v.sunk && !v.isDecoy).map((v) => ({ cells: v.cells, cls: 'ov-sunk' })));
  }

  renderHeader() {
    const st = this.st;
    const bt = st.battle;
    let text;
    let cls;
    if (st.phase !== 'battle') { text = 'Round over'; cls = 'over'; }
    else if (st.opp && !st.opp.connected) { text = 'Paused: opponent offline'; cls = 'paused'; }
    else if (bt.turn === 'me') { text = bt.tacticalUsed ? 'Your turn: now attack!' : 'Your turn'; cls = 'mine'; }
    else { text = `${st.opp?.name || 'Enemy'}'s turn`; cls = 'theirs'; }
    this.turnEl.textContent = text;
    this.turnEl.className = `turn-pill turn-${cls}`;
    this.earnedEl.textContent = st.phase === 'battle' ? `+${fmt(bt.earned.coins)} 💰 this round` : '';
    this.earnedEl.title = 'Paid out when the round ends';
  }

  tick(now) {
    const st = this.st;
    if (!st || st.phase !== 'battle' || !st.deadline) { this.timerEl.hidden = true; return; }
    const left = Math.max(0, Math.ceil((st.deadline - now) / 1000));
    this.timerEl.hidden = false;
    this.timerEl.textContent = `⏱ ${left}s`;
    this.timerEl.classList.toggle('urgent', left <= 10 && st.battle.turn === 'me');
  }

  renderArsenal() {
    const st = this.st;
    const bt = st.battle;
    const inv = st.me.inventory;
    const mine = this.myTurn();
    const usable = ITEMS.filter((i) => (i.action === 'attack' || i.action === 'tactical') && inv[i.id] > 0);
    const btn = (item) => {
      const tactical = item?.action === 'tactical';
      const active = item ? this.sel.itemId === item.id : !this.sel.itemId;
      return h('button', {
        class: `arsenal-btn ${tactical ? 'is-tactical' : 'is-attack'} ${active && mine ? 'active' : ''}`,
        disabled: !mine || (tactical && bt.tacticalUsed),
        title: item ? `${item.name}: ${item.desc}` : 'Standard shot: free, fires at one cell',
        onclick: () => this.selectItem(item ? item.id : null),
      },
      h('span', { class: 'a-icon' }, item ? item.icon : '🎯'),
      h('span', { class: 'a-name' }, item ? item.name : 'Standard shot'),
      h('span', { class: `a-count ${item ? '' : 'free'}` }, item ? `×${inv[item.id]}` : 'free'));
    };
    const attacks = usable.filter((i) => i.action === 'attack');
    const tacticals = usable.filter((i) => i.action === 'tactical');
    setChildren(this.arsenalEl,
      h('div', { class: 'arsenal-group' }, h('span', { class: 'group-label' }, 'Attack · ends turn'), btn(null), attacks.map(btn)),
      tacticals.length ? h('div', { class: 'arsenal-group' }, h('span', { class: 'group-label' }, 'Tactical · 1 per turn, free'), tacticals.map(btn)) : null);
    this.tacticalEl.textContent = mine ? (bt.tacticalUsed ? 'Tactical used ✓' : tacticals.length ? 'Tactical available' : '') : '';
    const passives = ITEMS.filter((i) => i.action === 'passive' && inv[i.id] > 0)
      .map((i) => h('span', { class: 'chip chip-passive', title: i.desc }, `${i.icon} ${i.name} ×${inv[i.id]} armed`));
    const leftovers = ITEMS.filter((i) => i.action === 'deploy' && inv[i.id] > 0)
      .map((i) => h('span', { class: 'chip chip-muted', title: 'Deployables are placed before a battle' }, `${i.icon} ${i.name} ×${inv[i.id]} for next round`));
    setChildren(this.passiveEl, passives, leftovers);
    this.passiveEl.hidden = !passives.length && !leftovers.length;
    this.renderAim();
  }

  renderAim() {
    const st = this.st;
    const item = this.item();
    if (st.phase !== 'battle') { setChildren(this.aimEl, h('span', { class: 'muted' }, 'The round is over.')); return; }
    if (!this.myTurn()) {
      setChildren(this.aimEl, h('span', { class: 'muted' }, st.opp?.connected === false ? '🔌 Waiting for your opponent to reconnect…' : '⏳ Waiting for the enemy to make their move…'));
      return;
    }
    if (!item) {
      setChildren(this.aimEl, h('div', { class: 'aim-info' },
        h('span', { class: 'aim-icon' }, '🎯'),
        h('div', {}, h('b', {}, 'Standard shot'), h('div', { class: 'small muted' }, 'Click any unexplored cell on the enemy board to fire. Or pick an item from your arsenal.'))));
      return;
    }
    const s = this.sel;
    const controls = [];
    if (item.targeting === 'line' || item.targeting === 'relocate') {
      controls.push(h('button', { class: 'btn btn-small', onclick: () => this.rotate() }, s.orient === 'h' ? '⟳ Row (R)' : '⟳ Column (R)'));
    }
    if (item.targeting === 'lane') {
      controls.push(h('div', { class: 'dir-pick' }, LANE_DIRS.map((d) => h('button', {
        class: `btn btn-small ${s.dir === d ? 'active' : ''}`,
        title: DIR_LABEL[d],
        onclick: () => { s.dir = d; sfx('click'); this.renderAim(); this.refreshMarks(); },
      }, { right: '→', left: '←', down: '↓', up: '↑' }[d]))));
    }
    let status = HOW_TO_AIM[item.targeting];
    if (item.targeting === 'multi') status = `Pick ${item.count} cells on the enemy board (${s.multi.length}/${item.count} chosen).`;
    if (item.targeting === 'lane') status = `Pick a ${s.dir === 'right' || s.dir === 'left' ? 'row' : 'column'}. The torpedo travels ${DIR_LABEL[s.dir]}.`;
    if (item.targeting === 'relocate' && s.shipId) status = 'Now click where the ship should go on YOUR board. Rotate to turn it.';
    if (item.targeting === 'ownShip' && s.shipId) status = `Shield your ${st.battle.my.vessels.find((v) => v.id === s.shipId)?.name}?`;
    setChildren(this.aimEl,
      h('div', { class: 'aim-info' },
        h('span', { class: 'aim-icon' }, item.icon),
        h('div', {},
          h('div', {}, h('b', {}, item.name), ' ', itemTag(item)),
          h('div', { class: 'small muted' }, item.desc),
          h('div', { class: 'small aim-status' }, status))),
      h('div', { class: 'aim-controls' },
        controls,
        h('button', { class: 'btn btn-small btn-ghost', onclick: () => this.clearSel() }, 'Cancel'),
        h('button', { class: `btn btn-primary ${this.aimReady() ? 'pulse' : ''}`, disabled: !this.aimReady(), onclick: () => this.launch() }, `Launch ${item.icon}`)));
  }

  refreshMarks() {
    const eMarks = new Map();
    const mMarks = new Map();
    const add = (map, cells, cls) => { for (const i of cells) if (i >= 0) map.set(i, map.has(i) ? `${map.get(i)} ${cls}` : cls); };
    if (this.st?.battle && this.myTurn()) {
      const item = this.item();
      const s = this.sel;
      if (!item) {
        if (s.hover >= 0) add(eMarks, [s.hover], this.shotValid(s.hover) ? 'pv' : 'pv-bad');
      } else {
        switch (item.targeting) {
          case 'cell': case 'line': case 'lane': {
            const show = (i, cls) => {
              const p = this.preview(item, i);
              if (p.zone) add(eMarks, p.zone, 'pv-zone');
              add(eMarks, p.cells, cls);
              if (item.targeting === 'lane') add(eMarks, [p.cells[0]], `pv-start dir-${s.dir}`);
            };
            if (s.aim != null) show(s.aim, 'pv-lock');
            if (s.hover >= 0 && s.hover !== s.aim) show(s.hover, 'pv');
            break;
          }
          case 'multi':
            add(eMarks, s.multi, 'pv-lock');
            if (s.hover >= 0 && !s.multi.includes(s.hover)) add(eMarks, [s.hover], this.shotValid(s.hover) && s.multi.length < item.count ? 'pv' : 'pv-bad');
            break;
          case 'ownShip': {
            const chosen = this.st.battle.my.vessels.find((v) => v.id === s.shipId);
            if (chosen) add(mMarks, chosen.cells, 'pv-lock');
            const o = s.hoverMine >= 0 ? this.vesselAt(s.hoverMine) : null;
            if (o && o.v.id !== s.shipId) add(mMarks, o.v.cells, !o.v.isDecoy && !o.v.sunk ? 'pv' : 'pv-bad');
            break;
          }
          case 'ownHit': {
            if (s.aim != null) add(mMarks, [s.aim], 'pv-lock');
            if (s.hoverMine >= 0 && s.hoverMine !== s.aim) {
              const o = this.vesselAt(s.hoverMine);
              add(mMarks, [s.hoverMine], o && !o.v.isDecoy && !o.v.sunk && o.v.hits[o.k] ? 'pv' : 'pv-bad');
            }
            break;
          }
          case 'relocate': {
            const ship = this.st.battle.my.vessels.find((v) => v.id === s.shipId);
            if (!ship) {
              const o = s.hoverMine >= 0 ? this.vesselAt(s.hoverMine) : null;
              if (o) add(mMarks, o.v.cells, !o.v.isDecoy && !o.v.sunk && !o.v.hits.some(Boolean) ? 'pv' : 'pv-bad');
              break;
            }
            add(mMarks, ship.cells, 'pv-from');
            if (s.aim != null) {
              const p = this.relocation(s.aim);
              if (p) add(mMarks, p.cells, 'pv-lock');
            }
            if (s.hoverMine >= 0) {
              const p = this.relocation(s.hoverMine);
              if (p && p.anchor !== s.aim) add(mMarks, p.cells, p.valid ? 'ghost-ok' : 'ghost-bad');
            }
            break;
          }
          default: break;
        }
      }
    }
    this.enemy.setMarks(eMarks);
    this.mine.setMarks(mMarks);
  }

  renderFleets() {
    const bt = this.st.battle;
    setChildren(this.enemyFleetEl, bt.enemy.fleet.map((s) => h('span', { class: `fleet-chip ${s.sunk ? 'sunk' : ''}` },
      s.sunk ? '💀 ' : '', s.name, h('span', { class: 'pips' }, Array.from({ length: s.size }, () => h('i'))))));
    setChildren(this.myFleetEl, bt.my.vessels.filter((v) => !v.isDecoy).map((v) => h('div', { class: `my-ship ${v.sunk ? 'sunk' : ''}` },
      h('span', { class: 'my-ship-name' }, v.sunk ? `💀 ${v.name}` : v.name),
      h('span', { class: 'pips health' }, v.hits.map((hit) => h('i', { class: hit ? 'hit' : '' }))),
      v.shield > 0 && !v.sunk ? h('span', { class: 'badge badge-shield', title: 'Shield charges' }, `🛡️${v.shield}`) : null,
      v.burning ? h('span', { class: 'badge badge-fire', title: 'On fire! Use a Repair Kit.' }, '🔥') : null)));
  }

  renderComms() {
    const st = this.st;
    const unread = st.chat.filter((m) => !m.mine).length - this.chatSeen;
    if (this.commsTab === 'chat') this.chatSeen = st.chat.filter((m) => !m.mine).length;
    const tab = (id, label) => h('button', {
      class: `tab ${this.commsTab === id ? 'active' : ''}`,
      onclick: () => { this.commsTab = id; this.renderComms(); },
    }, label);
    setChildren(this.commsTabsEl,
      tab('log', '📜 Battle log'),
      tab('chat', unread > 0 && this.commsTab !== 'chat' ? `💬 Chat (${unread})` : '💬 Chat'));
    this.logEl.hidden = this.commsTab !== 'log';
    this.chatEl.hidden = this.commsTab !== 'chat';

    const atBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    const logStick = atBottom(this.logEl) || this.lastLogId === null;
    const seen = this.lastLogId ?? Infinity;
    setChildren(this.logEl, st.log.map((l) => h('div', { class: `log-line tone-${l.tone} ${l.id > seen ? 'new' : ''}` }, l.text)));
    this.lastLogId = st.log.length ? st.log[st.log.length - 1].id : 0;
    if (logStick) this.logEl.scrollTop = this.logEl.scrollHeight;

    const chatStick = atBottom(this.chatEl) || this.chatEl.childElementCount === 0;
    setChildren(this.chatEl, st.chat.length
      ? st.chat.map((m) => h('div', { class: `chat-msg ${m.mine ? 'mine' : ''}` }, h('b', {}, m.name), h('span', {}, m.text)))
      : h('p', { class: 'muted small' }, 'No messages yet. Say hi! 👋'));
    if (chatStick) this.chatEl.scrollTop = this.chatEl.scrollHeight;
  }

  // ---------------------------------------------------------------- round end

  renderRoundEnd() {
    const st = this.st;
    const over = st.phase === 'roundOver' || st.phase === 'matchOver';
    this.roundBar.hidden = !over;
    if (!over) {
      this.resultModal?.close();
      this.resultModal = null;
      return;
    }
    const lr = st.lastRound;
    const won = lr?.winner === st.seat;
    const match = st.phase === 'matchOver';
    const title = match ? (won ? '🎉 You won the match!' : '🏳️ You lost the match') : (won ? `🏆 You won round ${st.roundNo}` : `☠️ You lost round ${st.roundNo}`);
    setChildren(this.roundBar,
      h('span', { class: `rb-title ${won ? 'good' : 'bad'}` }, title),
      h('div', { class: 'rb-actions' },
        h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.openResult() }, '📊 Results'),
        st.me.continue
          ? h('span', { class: 'muted small' }, `Waiting for ${st.opp?.name || 'opponent'}…`)
          : h('button', { class: 'btn btn-primary', onclick: () => this.continueRound() }, match ? '🔁 Rematch' : 'Next round ▶'),
        match ? h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.app.leave() }, 'Leave') : null));
    const key = `${st.code}:${st.phase}:${st.roundNo}:${st.me.wins}:${st.opp?.wins}`;
    if (this.resultKey !== key) {
      this.resultKey = key;
      this.resultModal?.close();
      // play() runs right after render(), so read its delay on the next tick.
      setTimeout(() => {
        const delay = this.pendingResultDelay ?? 600;
        this.pendingResultDelay = null;
        setTimeout(() => {
          if (this.resultKey === key && (this.st.phase === 'roundOver' || this.st.phase === 'matchOver')) this.openResult();
        }, delay);
      }, 0);
    } else if (this.resultModal) {
      this.fillResult();
    }
  }

  async continueRound() {
    const res = await this.app.call(this.st.phase === 'matchOver' ? 'match:rematch' : 'round:continue');
    if (!res.ok) toast(res.error, 'bad');
    else sfx('click');
  }

  openResult() {
    this.resultModal?.close();
    this.resultModal = modal({ title: ' ', body: h('div', { class: 'result' }), className: 'modal-result', onClose: () => { this.resultModal = null; } });
    this.fillResult();
  }

  fillResult() {
    const st = this.st;
    const lr = st.lastRound;
    if (!this.resultModal || !lr) return;
    const mine = lr.players[st.seat];
    const won = lr.winner === st.seat;
    const match = st.phase === 'matchOver';
    const row = (label, value) => h('div', { class: 'res-row' }, h('span', {}, label), h('b', {}, value));
    const body = h('div', { class: 'result' },
      h('div', { class: `res-head ${won ? 'good' : 'bad'}` },
        h('div', { class: 'res-emoji' }, match ? (won ? '🏆' : '🏳️') : (won ? '🎖️' : '☠️')),
        h('h2', {}, match ? (won ? 'VICTORY!' : 'DEFEAT') : (won ? `Round ${lr.round} won!` : `Round ${lr.round} lost`)),
        h('div', { class: 'res-score' }, `${st.me.name} ${st.me.wins} – ${st.opp?.wins ?? 0} ${st.opp?.name ?? ''}`),
        h('div', { class: 'muted small' }, match ? 'Match over.' : `First to ${st.roundsToWin} round wins takes the match.`)),
      !match ? h('div', { class: 'res-table' },
        row(`Hits ×${mine.hits}`, `+${fmt(mine.hitCoins)}`),
        row(`Ships sunk ×${mine.sinks}`, `+${fmt(mine.sinkCoins)}`),
        row(won ? 'Round win bonus' : 'Comeback bonus', `+${fmt(mine.bonus)}`),
        h('div', { class: 'res-total' }, h('span', {}, 'Earned'), h('b', {}, `+${fmt(mine.total)} 💰`)),
        h('div', { class: 'muted small' }, `You now have 💰 ${fmt(st.me.coins)} for the next Armory.`)) : null,
      h('div', { class: 'res-actions' },
        h('button', { class: 'btn btn-ghost', onclick: () => this.resultModal?.close() }, '👀 View boards'),
        st.me.continue
          ? h('span', { class: 'muted' }, `Waiting for ${st.opp?.name || 'opponent'}…`)
          : h('button', { class: 'btn btn-primary btn-big', onclick: () => this.continueRound() }, match ? '🔁 Rematch' : 'Next round ▶'),
        st.opp?.continue && !st.me.continue ? h('div', { class: 'small good-text' }, match ? `${st.opp.name} wants a rematch!` : `${st.opp.name} is ready for the next round.`) : null,
        match ? h('button', { class: 'btn btn-ghost', onclick: () => this.app.leave() }, 'Leave room') : null));
    setChildren(this.resultModal.content, body);
  }

  // ---------------------------------------------------------------- effects

  play(events) {
    const st = this.st;
    if (!st?.battle) return;
    const me = st.seat;
    const boardFor = (seat) => (seat === me ? this.mine : this.enemy);
    let delay = 0;
    let stagger = 55;
    const later = (ms, fn) => setTimeout(fn, ms);
    for (const e of events) {
      switch (e.type) {
        case 'strike': {
          const board = boardFor(e.board);
          const kind = STRIKE_FX[e.result];
          if (!kind) break;
          const d = delay;
          later(d, () => {
            fx.burst(board, e.idx, kind);
            sfx(STRIKE_SOUND[e.result]);
            if (e.result === 'sunk') fx.shake(board.el);
            if (e.result === 'mine') fx.shake(board.el, true);
          });
          if (e.source !== 'shot') delay += stagger;
          break;
        }
        case 'fx': {
          const board = boardFor(e.board);
          const d = delay;
          switch (e.fx) {
            case 'blast':
              later(d, () => {
                fx.areaFlash(board, e.cells, e.item === 'nuke' ? 'nuke' : 'blast');
                if (e.item === 'nuke') { sfx('big'); fx.shake(document.body, true); }
              });
              delay += e.item === 'nuke' ? 350 : 150;
              stagger = e.item === 'nuke' ? 25 : 45;
              break;
            case 'missile':
              later(d, () => fx.missile(board, e.idx, ITEM_MAP[e.item]?.icon || '🚀'));
              delay += 380;
              break;
            case 'salvo':
              later(d, () => e.cells.forEach((i, k) => setTimeout(() => fx.missile(board, i, '🚀'), k * 120)));
              delay += 420;
              stagger = 120;
              break;
            case 'flyover':
              later(d, () => { fx.flyover(board, e.orient, e.r, e.c, e.item === 'recon' ? '🛩️' : '✈️'); sfx('plane'); });
              delay += 120;
              stagger = 85;
              break;
            case 'shotdown':
              later(d, () => {
                if (e.item === 'commando') {
                  fx.drop(board, e.idx);
                  setTimeout(() => fx.burst(board, e.idx, 'flak'), 450);
                } else {
                  fx.flyover(board, e.orient, e.r, e.c, e.item === 'recon' ? '🛩️' : '✈️', { shotDown: true });
                }
                sfx('plane');
              });
              later(d + 650, () => sfx('hit'));
              delay += 800;
              break;
            case 'intercept':
              later(d, () => { fx.burst(board, e.idx, 'intercept'); sfx('block'); });
              delay += 400;
              break;
            case 'torpedo':
              later(d, () => { fx.torpedo(board, e.path, e.impact, e.dir); sfx('torpedo'); });
              delay += 950;
              break;
            case 'arc':
              later(d, () => { fx.cellFlash(board, e.cells, 'zap', 110); sfx('zap'); });
              break;
            case 'scan':
              later(d, () => { fx.scan(board, e.cells, e.item); sfx(e.item === 'sonar' ? 'ping' : 'scan'); });
              break;
            case 'drop':
              later(d, () => { fx.drop(board, e.idx); sfx('plane'); });
              delay += 700;
              break;
            case 'counter':
              later(d + 200, () => { fx.burst(board, e.idx, 'counter'); fx.shake(board.el); });
              delay += 400;
              break;
            case 'burn':
              later(d, () => { fx.burst(board, e.idx, 'burn'); sfx('fire'); });
              delay += 300;
              break;
            case 'shield':
              later(d, () => { fx.cellFlash(board, e.cells, 'shield', 40); sfx('block'); });
              break;
            case 'repair':
              later(d, () => { fx.burst(board, e.idx, 'repair'); sfx('repair'); });
              break;
            case 'move':
              later(d, () => { fx.cellFlash(board, e.from, 'move', 30); fx.cellFlash(board, e.cells, 'move', 30); sfx('scan'); });
              break;
            default: break;
          }
          break;
        }
        case 'use': {
          if (e.by === me) break;
          const item = ITEM_MAP[e.item];
          if (!item) break;
          toast(`Enemy used ${item.icon} ${item.name}!`, item.action === 'attack' ? 'bad' : 'warn', 2600);
          if (e.item === 'nuke') fx.banner('☢️ NUKE INCOMING', '', 'bad', 1300);
          break;
        }
        case 'bonus':
          if (e.seat === me) later(delay + 300, () => { fx.banner('HIT! FIRE AGAIN', '', 'good', 1000); sfx('turn'); });
          else later(delay + 300, () => toast('Enemy hit, so they fire again!', 'warn', 1800));
          break;
        case 'turn':
          if (e.seat === me) later(delay + 300, () => { fx.banner('YOUR TURN', '', 'good', 1000); sfx('turn'); });
          break;
        case 'battleStart':
          fx.banner('⚔️ BATTLE STATIONS', e.first ? 'You fire first' : 'The enemy fires first', 'info', 1900);
          sfx('turn');
          break;
        case 'roundOver':
        case 'matchOver': {
          const won = e.winner === me;
          later(delay + 400, () => {
            sfx(won ? 'win' : 'lose');
            if (e.type === 'matchOver') fx.banner(won ? '🏆 VICTORY' : '🏳️ DEFEAT', '', won ? 'good' : 'bad', 1800);
            else fx.banner(won ? 'ROUND WON' : 'ROUND LOST', '', won ? 'good' : 'bad', 1500);
            if (won && e.type === 'matchOver') fx.confetti();
          });
          this.pendingResultDelay = delay + 1700;
          break;
        }
        default: break;
      }
    }
  }
}
