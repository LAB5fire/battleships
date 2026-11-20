// Core battle rules. Pure game logic, no networking.
import {
  VIEW, LANE_DIRS, toIdx, toRC, inBounds, shipCells, squareCells, crossCells,
  lineCells, lanePath, cellLabel, colLabel, laneLabel, neighborCells, touchesAny,
} from '../shared/geometry.js';
import { ITEM_MAP } from '../shared/items.js';
import { ECONOMY } from '../shared/config.js';

export class GameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GameError';
  }
}

const randInt = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[randInt(arr.length)];
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const isInt = Number.isInteger;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// ------------------------------------------------------------------ boards

export function createBoard(size) {
  const n = size * size;
  return {
    size,
    vessels: [],
    owner: new Array(n).fill(-1), // cell -> vessel index
    mines: new Set(),
    struck: new Array(n).fill(false), // the enemy has fired on this cell
    view: new Array(n).fill(VIEW.UNKNOWN), // what the enemy knows about this cell
    sonar: [], // enemy sonar readings on this board
  };
}

function makeVessel(id, type, name, cells, dir, isDecoy = false) {
  return {
    id, type, name, size: cells.length, cells, dir,
    hits: cells.map(() => false),
    sunk: false, shield: 0, burning: false, isDecoy, exposed: false,
  };
}

function addVessel(board, vessel) {
  const vi = board.vessels.length;
  board.vessels.push(vessel);
  for (const i of vessel.cells) board.owner[i] = vi;
}

// Validates a player's layout and builds their board.
// layout = { ships: [{type, r, c, dir}], decoys: [{r, c, dir}], mines: [{r, c}] }
export function buildBoard(size, fleet, layout, inventory = {}) {
  if (!layout || typeof layout !== 'object') throw new GameError('Invalid layout.');
  const ships = Array.isArray(layout.ships) ? layout.ships : [];
  const decoys = Array.isArray(layout.decoys) ? layout.decoys : [];
  const mines = Array.isArray(layout.mines) ? layout.mines : [];
  if (ships.length !== fleet.length) throw new GameError('Place all of your ships first.');
  if (decoys.length > (inventory.decoy || 0)) throw new GameError('You placed more decoys than you own.');
  if (mines.length > (inventory.mine || 0)) throw new GameError('You placed more mines than you own.');

  const board = createBoard(size);
  const used = new Set();
  const hulls = new Set(); // cells of ships and decoys, which may not touch each other
  const claim = (cells, what, vessel = true) => {
    if (!cells) throw new GameError(`${what} doesn't fit on the board.`);
    for (const i of cells) if (used.has(i)) throw new GameError(`${what} overlaps something else.`);
    if (vessel && touchesAny(size, cells, hulls)) throw new GameError(`${what} is touching another ship. Ships need at least one empty cell between them.`);
    for (const i of cells) used.add(i);
    if (vessel) for (const i of cells) hulls.add(i);
  };
  const cellsFor = (p, len) => (p && typeof p === 'object' && inBounds(size, p.r, p.c)
    ? shipCells(size, p.r, p.c, p.dir === 'v' ? 'v' : 'h', len)
    : null);

  for (const spec of fleet) {
    const matches = ships.filter((s) => s && s.type === spec.type);
    if (matches.length !== 1) throw new GameError(`Place your ${spec.name} exactly once.`);
    const s = matches[0];
    const cells = cellsFor(s, spec.size);
    claim(cells, `Your ${spec.name}`);
    addVessel(board, makeVessel(spec.type, spec.type, spec.name, cells, s.dir === 'v' ? 'v' : 'h'));
  }
  decoys.forEach((d, k) => {
    const cells = cellsFor(d, 2);
    claim(cells, 'A decoy');
    addVessel(board, makeVessel(`decoy${k + 1}`, 'decoy', 'Decoy', cells, d.dir === 'v' ? 'v' : 'h', true));
  });
  for (const m of mines) {
    if (!m || typeof m !== 'object' || !inBounds(size, m.r, m.c)) throw new GameError('A mine is off the board.');
    const i = toIdx(size, m.r, m.c);
    claim([i], 'A mine', false);
    board.mines.add(i);
  }
  return board;
}

// Normalized copy of a layout that passed buildBoard.
export function cleanLayout(layout) {
  const dir = (d) => (d === 'v' ? 'v' : 'h');
  return {
    ships: layout.ships.map((s) => ({ type: s.type, r: s.r, c: s.c, dir: dir(s.dir) })),
    decoys: (layout.decoys || []).map((d) => ({ r: d.r, c: d.c, dir: dir(d.dir) })),
    mines: (layout.mines || []).map((m) => ({ r: m.r, c: m.c })),
  };
}

export const fleetDestroyed = (board) => board.vessels.every((v) => v.isDecoy || v.sunk);

// Tally strike results into a short phrase like "2 hits, 1 blocked, 6 misses".
function tally(results, perspective) {
  const t = { hit: 0, decoy: 0, blocked: 0, mine: 0, miss: 0 };
  for (const r of results) {
    switch (r.result) {
      case 'hit': if (r.decoy && perspective === 'def') t.decoy++; else t.hit++; break;
      case 'sunk': t.hit++; break;
      case 'decoy': case 'decoyhit': t.decoy++; break;
      case 'blocked': t.blocked++; break;
      case 'mine': t.mine++; break;
      case 'miss': t.miss++; break;
      default: break;
    }
  }
  const parts = [];
  if (t.hit) parts.push(plural(t.hit, 'HIT', 'HITS'));
  if (t.decoy) parts.push(`${t.decoy} on a decoy`);
  if (t.blocked) parts.push(`${t.blocked} blocked by a shield`);
  if (t.mine) parts.push(plural(t.mine, 'MINE', 'MINES'));
  if (t.miss) parts.push(plural(t.miss, 'miss', 'misses'));
  return parts.length ? parts.join(', ') : 'nothing new';
}
const anyHit = (results) => results.some((r) => ['hit', 'sunk'].includes(r.result));
const anyDamage = (results, perspective) => results.some((r) => r.result === 'sunk' || (r.result === 'hit' && !(perspective === 'def' && r.decoy)));

// ------------------------------------------------------------------ event context

// Collects what each player should see about one action.
export class Ctx {
  constructor() {
    this.events = [[], []];
    this.notes = [[], []];
    this.counters = [];
  }

  ev(seat, e) { this.events[seat].push(e); }

  all(e) { this.events[0].push(e); this.events[1].push(e); }

  say(actor, mine, theirs, toneMine = 'info', toneTheirs = 'info') {
    if (mine) this.events[actor].push({ type: 'log', text: mine, tone: toneMine });
    if (theirs) this.events[1 - actor].push({ type: 'log', text: theirs, tone: toneTheirs });
  }

  // Like say(), but shown after the action's summary line.
  note(actor, mine, theirs, toneMine = 'info', toneTheirs = 'info') {
    if (mine) this.notes[actor].push({ type: 'log', text: mine, tone: toneMine });
    if (theirs) this.notes[1 - actor].push({ type: 'log', text: theirs, tone: toneTheirs });
  }

  flush() {
    for (const s of [0, 1]) {
      this.events[s].push(...this.notes[s]);
      this.notes[s] = [];
    }
  }
}

// ------------------------------------------------------------------ battle

export class Battle {
  // players: [{ inventory }, { inventory }] – live references, items are consumed from them
  constructor({ boards, first, players }) {
    this.boards = boards;
    this.size = boards[0].size;
    this.players = players;
    this.turn = first;
    this.turnNo = 1;
    this.step = 1; // bumps on every new turn and every bonus strike
    this.tacticalUsed = false;
    this.winner = null;
    this.earned = [0, 1].map(() => ({ hits: 0, sinks: 0, coins: 0 }));
  }

  label(i) { return cellLabel(this.size, i); }

  cellOf(a) {
    if (!a || !inBounds(this.size, a.r, a.c)) throw new GameError('Pick a cell on the board.');
    return toIdx(this.size, a.r, a.c);
  }

  // Is cell i an intact (not yet hit) part of a vessel that is still afloat?
  isIntact(board, i, { skipExposed = false } = {}) {
    const vi = board.owner[i];
    if (vi < 0) return false;
    const v = board.vessels[vi];
    if (v.sunk || (skipExposed && v.exposed)) return false;
    return !v.hits[v.cells.indexOf(i)];
  }

  // Fire on one cell of the defender's board. The single source of truth for damage.
  strike(ctx, attacker, idx, source) {
    const def = 1 - attacker;
    const b = this.boards[def];
    if (b.struck[idx]) return { idx, result: 'already' };
    const vi = b.owner[idx];

    if (vi >= 0) {
      const v = b.vessels[vi];
      const k = v.cells.indexOf(idx);
      if (v.shield > 0) {
        v.shield -= 1;
        if (b.view[idx] === VIEW.UNKNOWN) b.view[idx] = VIEW.SPOTTED;
        ctx.all({ type: 'strike', board: def, idx, result: 'blocked', source });
        if (v.shield === 0) ctx.note(attacker, '🛡️ Their shield collapsed!', `🛡️ The shield on your ${v.name} is gone.`, 'good', 'warn');
        return { idx, result: 'blocked', vessel: v };
      }
      b.struck[idx] = true;
      v.hits[k] = true;
      this.earned[attacker].hits += 1;
      this.earned[attacker].coins += ECONOMY.hit;

      if (v.hits.every(Boolean)) {
        v.sunk = true;
        v.burning = false;
        if (v.isDecoy) {
          v.exposed = true;
          for (const c of v.cells) b.view[c] = VIEW.DECOY;
          ctx.all({ type: 'strike', board: def, idx, result: 'decoy', source, cells: [...v.cells] });
          ctx.note(attacker, '🎭 That was a DECOY! Nothing but plywood and paint.', '🎭 The enemy finished off your decoy. It soaked up their fire!', 'warn', 'good');
          return { idx, result: 'decoy', vessel: v };
        }
        for (const c of v.cells) b.view[c] = VIEW.SUNK;
        this.earned[attacker].sinks += 1;
        this.earned[attacker].coins += ECONOMY.sink;
        ctx.all({ type: 'strike', board: def, idx, result: 'sunk', source, cells: [...v.cells], name: v.name });
        ctx.note(attacker, `💀 You sank the enemy ${v.name}!`, `💀 Your ${v.name} was sunk!`, 'good', 'bad');
        return { idx, result: 'sunk', vessel: v };
      }
      if (v.exposed) {
        b.view[idx] = VIEW.DECOY;
        ctx.all({ type: 'strike', board: def, idx, result: 'decoyhit', source });
        return { idx, result: 'decoyhit', vessel: v };
      }
      b.view[idx] = VIEW.HIT;
      if (v.isDecoy) {
        // The attacker must not learn it's a decoy yet.
        ctx.ev(attacker, { type: 'strike', board: def, idx, result: 'hit', source });
        ctx.ev(def, { type: 'strike', board: def, idx, result: 'decoyhit', source });
        return { idx, result: 'hit', vessel: v, decoy: true };
      }
      ctx.all({ type: 'strike', board: def, idx, result: 'hit', source });
      return { idx, result: 'hit', vessel: v };
    }

    if (b.mines.has(idx)) {
      b.mines.delete(idx);
      b.struck[idx] = true;
      b.view[idx] = VIEW.MINE;
      ctx.all({ type: 'strike', board: def, idx, result: 'mine', source });
      ctx.note(attacker, `🧨 You hit a hidden SEA MINE at ${this.label(idx)}!`, `🧨 The enemy hit your sea mine at ${this.label(idx)}!`, 'bad', 'good');
      ctx.counters.push({ owner: def });
      return { idx, result: 'mine' };
    }

    b.struck[idx] = true;
    b.view[idx] = VIEW.MISS;
    ctx.all({ type: 'strike', board: def, idx, result: 'miss', source });
    return { idx, result: 'miss' };
  }

  // A mine's shockwave hits a random intact part of the attacker's real fleet.
  resolveCounters(ctx) {
    while (ctx.counters.length && this.winner === null) {
      const { owner } = ctx.counters.shift();
      const victim = 1 - owner;
      const vb = this.boards[victim];
      const cells = [];
      for (const v of vb.vessels) {
        if (v.isDecoy || v.sunk) continue;
        v.cells.forEach((c, k) => { if (!v.hits[k]) cells.push(c); });
      }
      if (!cells.length) continue;
      const target = pick(cells);
      ctx.all({ type: 'fx', fx: 'counter', board: victim, idx: target });
      const res = this.strike(ctx, owner, target, 'mine');
      const where = this.label(target);
      if (res.result === 'blocked') {
        ctx.say(owner, `💥 Your mine's shockwave struck the enemy at ${where}, but a shield absorbed it.`, `💥 The mine's shockwave struck your fleet at ${where}. Your shield held!`, 'info', 'good');
      } else {
        ctx.say(owner, `💥 Your mine's shockwave HIT the enemy fleet at ${where}!`, `💥 The mine's shockwave HIT your fleet at ${where}!`, 'good', 'bad');
      }
      ctx.flush();
      if (fleetDestroyed(vb)) this.winner = owner;
    }
  }

  // ---------------------------------------------------------------- actions

  act(seat, action) {
    if (this.winner !== null) throw new GameError('This round is already over.');
    if (this.turn !== seat) throw new GameError("It's not your turn.");
    if (!action || typeof action !== 'object') throw new GameError('Invalid action.');
    const ctx = new Ctx();
    if (action.type === 'shot') this.doShot(ctx, seat, action);
    else if (action.type === 'item') this.doItem(ctx, seat, action);
    else throw new GameError('Invalid action.');
    ctx.flush();
    return ctx;
  }

  // Fired automatically when the turn timer runs out.
  autoShot(seat) {
    const b = this.boards[1 - seat];
    const spotted = [];
    const unknown = [];
    for (let i = 0; i < b.view.length; i++) {
      if (b.struck[i]) continue;
      if (b.view[i] === VIEW.SPOTTED) spotted.push(i);
      else if (b.view[i] === VIEW.UNKNOWN) unknown.push(i);
    }
    const i = pick(spotted.length ? spotted : unknown);
    const [r, c] = toRC(this.size, i);
    const ctx = new Ctx();
    this.doShot(ctx, seat, { r, c }, true);
    ctx.flush();
    return ctx;
  }

  doShot(ctx, seat, a, auto = false) {
    const i = this.cellOf(a);
    const b = this.boards[1 - seat];
    if (b.struck[i] || !(b.view[i] === VIEW.UNKNOWN || b.view[i] === VIEW.SPOTTED)) {
      throw new GameError('You already know what is there. Pick another cell.');
    }
    ctx.all({ type: 'fx', fx: 'shot', board: 1 - seat, idx: i });
    const res = this.strike(ctx, seat, i, 'shot');
    const where = this.label(i);
    const pre = auto ? '⏱️ Time ran out, auto-fire! ' : '';
    ctx.say(
      seat,
      `${pre}🎯 You fired at ${where}: ${tally([res], 'atk')}.`,
      `${pre}🎯 Enemy fired at your ${where}: ${tally([res], 'def')}.`,
      anyHit([res]) ? 'good' : 'info',
      anyDamage([res], 'def') ? 'bad' : 'info',
    );
    this.afterAttack(ctx, seat, ['hit', 'sunk', 'decoy'].includes(res.result));
  }

  doItem(ctx, seat, a) {
    const item = ITEM_MAP[a.itemId];
    if (!item) throw new GameError('Unknown item.');
    const inv = this.players[seat].inventory;
    if (!(inv[item.id] > 0)) throw new GameError(`You don't have any ${item.name} left.`);
    if (item.action === 'tactical') {
      if (this.tacticalUsed) throw new GameError('You already used a tactical item this turn. Now take your shot!');
    } else if (item.action !== 'attack') {
      throw new GameError(`${item.name} can't be used during the battle.`);
    }
    const effect = EFFECTS[item.id];
    const plan = effect.prepare(this, a, seat); // validates, throws GameError
    inv[item.id] -= 1;

    const def = 1 - seat;
    const defInv = this.players[def].inventory;
    const use = { type: 'use', by: seat, item: item.id };
    if (item.secret) ctx.ev(seat, use); else ctx.all(use);

    if (item.plane && defInv.flak > 0) {
      defInv.flak -= 1;
      ctx.all({ type: 'fx', fx: 'shotdown', board: def, item: item.id, orient: plan.orient, r: plan.r, c: plan.c, idx: plan.idx });
      ctx.say(seat, `🎇 Your ${item.name} was shot down by an enemy Flak Cannon!`, `🎇 Your Flak Cannon shot down the enemy ${item.name}!`, 'bad', 'good');
    } else if (item.missile && defInv.interceptor > 0) {
      defInv.interceptor -= 1;
      ctx.all({ type: 'fx', fx: 'intercept', board: def, idx: plan.primary, item: item.id });
      const res = this.strike(ctx, seat, plan.primary, item.id);
      const where = this.label(plan.primary);
      ctx.say(
        seat,
        `🚀 An enemy Interceptor caught your ${item.name}! Only ${where} was hit: ${tally([res], 'atk')}.`,
        `🚀 Your Interceptor caught the enemy ${item.name}! Only ${where} was hit: ${tally([res], 'def')}.`,
        'bad', 'good',
      );
    } else {
      effect.run(this, ctx, seat, plan, item);
    }

    if (item.action === 'attack') this.afterAttack(ctx, seat);
    else this.tacticalUsed = true;
  }

  // bonus = a standard shot hit something, so the shooter fires again.
  afterAttack(ctx, seat, bonus = false) {
    ctx.flush();
    const def = 1 - seat;
    if (fleetDestroyed(this.boards[def])) { this.winner = seat; return; }
    this.resolveCounters(ctx);
    if (this.winner !== null) return;
    this.step += 1;
    if (bonus) {
      ctx.all({ type: 'bonus', seat });
      ctx.say(seat, '🔁 Direct hit! Fire again.', '🔁 The enemy hit, so they fire again.', 'good', 'warn');
      ctx.flush();
      return;
    }
    this.turn = def;
    this.turnNo += 1;
    this.tacticalUsed = false;
    ctx.all({ type: 'turn', seat: def, turnNo: this.turnNo });
    this.processBurns(ctx, def);
    ctx.flush();
  }

  // At the start of `seat`'s turn, fires they started on the enemy fleet spread.
  processBurns(ctx, seat) {
    const b = this.boards[1 - seat];
    for (const v of b.vessels) {
      if (!v.burning) continue;
      if (v.sunk) { v.burning = false; continue; }
      const intact = [];
      const spread = [];
      v.cells.forEach((c, k) => {
        if (v.hits[k]) return;
        intact.push(c);
        if ((k > 0 && v.hits[k - 1]) || (k < v.size - 1 && v.hits[k + 1])) spread.push(c);
      });
      if (!intact.length) { v.burning = false; continue; }
      const target = pick(spread.length ? spread : intact);
      ctx.all({ type: 'fx', fx: 'burn', board: 1 - seat, idx: target });
      const res = this.strike(ctx, seat, target, 'burn');
      const where = this.label(target);
      ctx.say(
        seat,
        `🔥 The fire spreads across the enemy ship to ${where}: ${tally([res], 'atk')}.`,
        `🔥 The fire on your ${v.name} spreads to ${where}${res.result === 'blocked' ? ', but the shield held' : ''}!`,
        'good', 'bad',
      );
      ctx.flush();
      if (fleetDestroyed(b)) { this.winner = seat; return; }
    }
  }

  // ---------------------------------------------------------------- item helpers

  reveal(board, cells) {
    let ships = 0;
    let mines = 0;
    for (const i of cells) {
      if (board.struck[i]) continue;
      const vi = board.owner[i];
      if (vi >= 0) {
        if (board.vessels[vi].exposed) continue;
        board.view[i] = VIEW.SPOTTED;
        ships++;
      } else if (board.mines.has(i)) {
        board.view[i] = VIEW.MINE_SPOTTED;
        mines++;
      } else {
        board.view[i] = VIEW.CLEAR;
      }
    }
    return { ships, mines };
  }

  areaAttack(ctx, seat, item, plan, cells) {
    const def = 1 - seat;
    ctx.all({ type: 'fx', fx: 'blast', board: def, cells, center: plan.idx, item: item.id });
    const results = cells.map((i) => this.strike(ctx, seat, i, item.id));
    const where = this.label(plan.idx);
    ctx.say(
      seat,
      `${item.icon} Your ${item.name} hit ${where}: ${tally(results, 'atk')}.`,
      `${item.icon} Enemy ${item.name} hit your ${where}: ${tally(results, 'def')}.`,
      anyHit(results) ? 'good' : 'info',
      anyDamage(results, 'def') ? 'bad' : 'info',
    );
  }

  lineAttack(ctx, seat, item, plan) {
    const def = 1 - seat;
    ctx.all({ type: 'fx', fx: 'flyover', board: def, orient: plan.orient, r: plan.r, c: plan.c, item: item.id });
    const results = plan.cells.map((i) => this.strike(ctx, seat, i, item.id));
    const line = plan.orient === 'v' ? `column ${colLabel(plan.c)}` : `row ${plan.r + 1}`;
    ctx.say(
      seat,
      `✈️ Your Bomber Run swept ${line}: ${tally(results, 'atk')}.`,
      `✈️ An enemy bomber swept your ${line}: ${tally(results, 'def')}.`,
      anyHit(results) ? 'good' : 'info',
      anyDamage(results, 'def') ? 'bad' : 'info',
    );
  }
}

// ------------------------------------------------------------------ item effects

const aimCell = (bt, a) => {
  const idx = bt.cellOf(a);
  return { idx, r: a.r, c: a.c, primary: idx };
};

const aimLine = (bt, a) => {
  if (a.orient !== 'h' && a.orient !== 'v') throw new GameError('Choose a row or a column.');
  const idx = bt.cellOf(a);
  return { idx, r: a.r, c: a.c, orient: a.orient, primary: idx, cells: lineCells(bt.size, a.r, a.c, a.orient) };
};

const ownVessel = (bt, a, seat) => {
  const b = bt.boards[seat];
  const vi = b.vessels.findIndex((v) => v.id === a.shipId && !v.isDecoy);
  if (vi < 0) throw new GameError('Pick one of your ships.');
  const v = b.vessels[vi];
  if (v.sunk) throw new GameError('That ship has already been sunk.');
  return { b, vi, v };
};

const EFFECTS = {
  cluster: {
    prepare: aimCell,
    run: (bt, ctx, seat, p, item) => bt.areaAttack(ctx, seat, item, p, squareCells(bt.size, p.r, p.c, 1)),
  },
  nuke: {
    prepare: aimCell,
    run: (bt, ctx, seat, p, item) => bt.areaAttack(ctx, seat, item, p, squareCells(bt.size, p.r, p.c, 2)),
  },
  cross: {
    prepare: aimCell,
    run: (bt, ctx, seat, p, item) => bt.areaAttack(ctx, seat, item, p, crossCells(bt.size, p.r, p.c, 2)),
  },

  seeker: {
    prepare: aimCell,
    run(bt, ctx, seat, p) {
      const def = 1 - seat;
      const b = bt.boards[def];
      let target = p.idx;
      if (!bt.isIntact(b, target, { skipExposed: true })) {
        const candidates = squareCells(bt.size, p.r, p.c, 2).filter((i) => bt.isIntact(b, i, { skipExposed: true }));
        if (candidates.length) {
          let best = Infinity;
          let nearest = [];
          for (const i of candidates) {
            const [r, c] = toRC(bt.size, i);
            const d = (r - p.r) ** 2 + (c - p.c) ** 2;
            if (d < best) { best = d; nearest = [i]; } else if (d === best) nearest.push(i);
          }
          target = pick(nearest);
        }
      }
      ctx.all({ type: 'fx', fx: 'missile', board: def, from: p.idx, idx: target, item: 'seeker' });
      const res = bt.strike(ctx, seat, target, 'seeker');
      const homed = target !== p.idx;
      const where = bt.label(target);
      ctx.say(
        seat,
        `🎯 Your Seeker Missile ${homed ? `locked on and curved to ${where}` : `struck ${where}`}: ${tally([res], 'atk')}.`,
        `🎯 An enemy Seeker Missile ${homed ? 'homed in on' : 'struck'} your ${where}: ${tally([res], 'def')}.`,
        anyHit([res]) ? 'good' : 'info',
        anyDamage([res], 'def') ? 'bad' : 'info',
      );
    },
  },

  torpedo: {
    prepare(bt, a) {
      if (!LANE_DIRS.includes(a.dir)) throw new GameError('Choose which way the torpedo travels.');
      const idx = bt.cellOf(a);
      return { idx, r: a.r, c: a.c, dir: a.dir, primary: idx };
    },
    run(bt, ctx, seat, p) {
      const def = 1 - seat;
      const b = bt.boards[def];
      const path = lanePath(bt.size, p.r, p.c, p.dir);
      const travelled = [];
      let impact = null;
      for (const i of path) {
        travelled.push(i);
        if (b.struck[i]) continue; // slips past wrecks and old splashes
        if (b.owner[i] >= 0 || b.mines.has(i)) { impact = i; break; }
        if (b.view[i] === VIEW.UNKNOWN) b.view[i] = VIEW.CLEAR;
      }
      ctx.all({ type: 'fx', fx: 'torpedo', board: def, path: travelled, impact, dir: p.dir });
      const lane = laneLabel(bt.size, p.r, p.c, p.dir);
      if (impact === null) {
        ctx.say(seat, `🦈 Your torpedo ran the whole of ${lane}: nothing but water.`, `🦈 An enemy torpedo ran through your ${lane} and missed everything.`, 'info', 'good');
        return;
      }
      const res = bt.strike(ctx, seat, impact, 'torpedo');
      const where = bt.label(impact);
      ctx.say(
        seat,
        `🦈 Your torpedo raced along ${lane} and struck ${where}: ${tally([res], 'atk')}.`,
        `🦈 An enemy torpedo raced along your ${lane} and struck ${where}: ${tally([res], 'def')}.`,
        anyHit([res]) ? 'good' : 'info',
        anyDamage([res], 'def') ? 'bad' : 'info',
      );
    },
  },

  napalm: {
    prepare: aimCell,
    run(bt, ctx, seat, p) {
      const def = 1 - seat;
      const b = bt.boards[def];
      const vi = b.owner[p.idx];
      ctx.all({ type: 'fx', fx: 'missile', board: def, idx: p.idx, item: 'napalm' });
      const res = bt.strike(ctx, seat, p.idx, 'napalm');
      let ignited = null;
      if (vi >= 0) {
        const v = b.vessels[vi];
        const partHit = v.hits[v.cells.indexOf(p.idx)];
        if (!v.sunk && partHit && ['hit', 'decoyhit', 'already'].includes(res.result)) {
          v.burning = true;
          ignited = v;
        }
      }
      const where = bt.label(p.idx);
      ctx.say(
        seat,
        `🔥 Your Napalm Shell hit ${where}: ${tally([res], 'atk')}.${ignited ? ' The ship is ON FIRE!' : ''}`,
        `🔥 Enemy napalm hit your ${where}: ${tally([res], 'def')}.${ignited ? ` Your ${ignited.name} is on fire! A Repair Kit puts it out.` : ''}`,
        ignited || anyHit([res]) ? 'good' : 'info',
        ignited ? 'bad' : 'info',
      );
    },
  },

  chain: {
    prepare: aimCell,
    run(bt, ctx, seat, p) {
      const def = 1 - seat;
      const b = bt.boards[def];
      const vi = b.owner[p.idx];
      ctx.all({ type: 'fx', fx: 'missile', board: def, idx: p.idx, item: 'chain' });
      const results = [bt.strike(ctx, seat, p.idx, 'chain')];
      if (vi >= 0 && !b.vessels[vi].sunk && results[0].result !== 'miss') {
        const v = b.vessels[vi];
        const k0 = v.cells.indexOf(p.idx);
        const order = shuffle(v.cells.map((c, k) => ({ c, k })).filter((o) => o.k !== k0 && !v.hits[o.k]))
          .sort((x, y) => Math.abs(x.k - k0) - Math.abs(y.k - k0));
        const arcs = [];
        for (const o of order.slice(0, 2)) {
          if (v.sunk) break;
          arcs.push(o.c);
          results.push(bt.strike(ctx, seat, o.c, 'chain'));
        }
        if (arcs.length) ctx.all({ type: 'fx', fx: 'arc', board: def, cells: [p.idx, ...arcs] });
      }
      const where = bt.label(p.idx);
      ctx.say(
        seat,
        `⚡ Your Chain Lightning struck ${where}${results.length > 1 ? ' and arced through the ship' : ''}: ${tally(results, 'atk')}.`,
        `⚡ Enemy Chain Lightning struck your ${where}${results.length > 1 ? ' and arced through your ship' : ''}: ${tally(results, 'def')}.`,
        anyHit(results) ? 'good' : 'info',
        anyDamage(results, 'def') ? 'bad' : 'info',
      );
    },
  },

  salvo: {
    prepare(bt, a) {
      if (!Array.isArray(a.targets) || a.targets.length < 1 || a.targets.length > 3) throw new GameError('Pick up to 3 cells for the salvo.');
      const targets = a.targets.map((t) => bt.cellOf(t));
      if (new Set(targets).size !== targets.length) throw new GameError('Pick different cells for each rocket.');
      return { targets, idx: targets[0], primary: targets[0] };
    },
    run(bt, ctx, seat, p) {
      const def = 1 - seat;
      ctx.all({ type: 'fx', fx: 'salvo', board: def, cells: p.targets });
      const results = p.targets.map((i) => bt.strike(ctx, seat, i, 'salvo'));
      const where = p.targets.map((i) => bt.label(i)).join(', ');
      ctx.say(
        seat,
        `🎆 Your Rocket Salvo hit ${where}: ${tally(results, 'atk')}.`,
        `🎆 An enemy Rocket Salvo hit your ${where}: ${tally(results, 'def')}.`,
        anyHit(results) ? 'good' : 'info',
        anyDamage(results, 'def') ? 'bad' : 'info',
      );
    },
  },

  bomber: {
    prepare: aimLine,
    run: (bt, ctx, seat, p, item) => bt.lineAttack(ctx, seat, item, p),
  },

  recon: {
    prepare: aimLine,
    run(bt, ctx, seat, p) {
      const def = 1 - seat;
      ctx.all({ type: 'fx', fx: 'flyover', board: def, orient: p.orient, r: p.r, c: p.c, item: 'recon' });
      const found = bt.reveal(bt.boards[def], p.cells);
      const line = p.orient === 'v' ? `column ${colLabel(p.c)}` : `row ${p.r + 1}`;
      ctx.all({ type: 'fx', fx: 'scan', board: def, cells: p.cells, item: 'recon' });
      ctx.say(
        seat,
        `🛩️ Your Recon Plane flew over ${line} and spotted ${plural(found.ships, 'ship part')}${found.mines ? ` and ${plural(found.mines, 'mine')}` : ''}.`,
        `🛩️ An enemy recon plane flew over your ${line}.`,
        found.ships ? 'good' : 'info', 'warn',
      );
    },
  },

  commando: {
    prepare: aimCell,
    run(bt, ctx, seat, p) {
      const def = 1 - seat;
      const b = bt.boards[def];
      const vi = b.owner[p.idx];
      const where = bt.label(p.idx);
      ctx.all({ type: 'fx', fx: 'drop', board: def, idx: p.idx });
      if (vi >= 0) {
        const v = b.vessels[vi];
        if (v.isDecoy) {
          v.exposed = true;
          for (const c of v.cells) b.view[c] = VIEW.DECOY;
          ctx.all({ type: 'fx', fx: 'scan', board: def, cells: [...v.cells], item: 'commando' });
          ctx.say(seat, `🪂 Your commandos boarded the target at ${where}. It's a DECOY! Marked on your map.`, `🪂 Enemy commandos exposed your decoy at ${where}.`, 'good', 'bad');
          return;
        }
        let intact = 0;
        v.cells.forEach((c, k) => {
          if (!v.hits[k]) { b.view[c] = VIEW.SPOTTED; intact++; }
        });
        ctx.all({ type: 'fx', fx: 'scan', board: def, cells: [...v.cells], item: 'commando' });
        if (v.sunk) {
          ctx.say(seat, `🪂 Your commandos found only the wreck of the ${v.name}.`, `🪂 Enemy commandos landed on the wreck of your ${v.name}.`);
        } else {
          ctx.say(seat, `🪂 Your commandos boarded the enemy ${v.name} and marked all of it (${plural(intact, 'intact part')})!`, `🪂 Enemy commandos boarded your ${v.name}. Its position is exposed!`, 'good', 'bad');
        }
        return;
      }
      const cells = crossCells(bt.size, p.r, p.c, 1);
      const found = bt.reveal(b, cells);
      ctx.all({ type: 'fx', fx: 'scan', board: def, cells, item: 'commando' });
      ctx.say(
        seat,
        `🪂 Your commandos landed in the water at ${where} and scouted around: ${plural(found.ships, 'ship part')}${found.mines ? `, ${plural(found.mines, 'mine')}` : ''}.`,
        `🪂 Enemy commandos landed near your ${where}.`,
        found.ships ? 'good' : 'info', 'warn',
      );
    },
  },

  sonar: {
    prepare: aimCell,
    run(bt, ctx, seat, p) {
      const def = 1 - seat;
      const b = bt.boards[def];
      const cells = squareCells(bt.size, p.r, p.c, 2);
      const count = cells.filter((i) => bt.isIntact(b, i)).length;
      b.sonar = b.sonar.filter((s) => !(s.r === p.r && s.c === p.c));
      b.sonar.push({ r: p.r, c: p.c, count, radius: 2 });
      if (b.sonar.length > 12) b.sonar.shift();
      ctx.all({ type: 'fx', fx: 'scan', board: def, cells, item: 'sonar' });
      ctx.say(seat, `🐬 Sonar ping at ${bt.label(p.idx)}: ${plural(count, 'intact ship part')} in the 5×5 area.`, `🐬 Enemy sonar pinged around your ${bt.label(p.idx)}.`, count ? 'good' : 'info', 'warn');
    },
  },

  radar: {
    prepare: aimCell,
    run(bt, ctx, seat, p) {
      const def = 1 - seat;
      const cells = squareCells(bt.size, p.r, p.c, 1);
      const found = bt.reveal(bt.boards[def], cells);
      ctx.all({ type: 'fx', fx: 'scan', board: def, cells, item: 'radar' });
      ctx.say(
        seat,
        `📡 Radar scan at ${bt.label(p.idx)}: ${plural(found.ships, 'ship part')}${found.mines ? `, ${plural(found.mines, 'mine')}` : ''} found.`,
        `📡 Enemy radar swept your ${bt.label(p.idx)} area.`,
        found.ships ? 'good' : 'info', 'warn',
      );
    },
  },

  satellite: {
    prepare: () => ({ idx: null, primary: null }),
    run(bt, ctx, seat) {
      const def = 1 - seat;
      const b = bt.boards[def];
      const options = [];
      for (const v of b.vessels) {
        if (v.sunk || v.exposed) continue;
        const hidden = v.cells.filter((c, k) => !v.hits[k] && b.view[c] === VIEW.UNKNOWN);
        if (hidden.length) options.push(hidden);
      }
      const revealed = shuffle(options).slice(0, 3).map((cells) => pick(cells));
      for (const i of revealed) b.view[i] = VIEW.SPOTTED;
      ctx.all({ type: 'fx', fx: 'scan', board: def, cells: revealed, item: 'satellite' });
      if (!revealed.length) {
        ctx.say(seat, '🛰️ Your Spy Satellite found nothing new to reveal.', '🛰️ An enemy spy satellite passed overhead but found nothing new.');
        return;
      }
      ctx.say(
        seat,
        `🛰️ Your Spy Satellite marked ${plural(revealed.length, 'enemy ship part')}: ${revealed.map((i) => bt.label(i)).join(', ')}.`,
        `🛰️ An enemy spy satellite revealed ${plural(revealed.length, 'part')} of your fleet!`,
        'good', 'bad',
      );
    },
  },

  shield: {
    prepare(bt, a, seat) {
      const { v } = ownVessel(bt, a, seat);
      if (v.shield >= 4) throw new GameError(`Your ${v.name}'s shield is already at maximum.`);
      return { vessel: v, idx: null, primary: null };
    },
    run(bt, ctx, seat, p) {
      p.vessel.shield = Math.min(4, p.vessel.shield + 2);
      ctx.ev(seat, { type: 'fx', fx: 'shield', board: seat, cells: [...p.vessel.cells] });
      ctx.say(seat, `🛡️ Energy Shield raised on your ${p.vessel.name} (${plural(p.vessel.shield, 'charge')}).`, null, 'good');
    },
  },

  repair: {
    prepare(bt, a, seat) {
      const idx = bt.cellOf(a);
      const b = bt.boards[seat];
      const vi = b.owner[idx];
      if (vi < 0) throw new GameError('Pick a damaged part of one of your ships.');
      const v = b.vessels[vi];
      if (v.isDecoy) throw new GameError("Decoys can't be repaired.");
      if (v.sunk) throw new GameError('That ship has already been sunk.');
      const k = v.cells.indexOf(idx);
      if (!v.hits[k]) throw new GameError("That part isn't damaged.");
      return { idx, vessel: v, k, primary: null };
    },
    run(bt, ctx, seat, p) {
      const b = bt.boards[seat];
      const v = p.vessel;
      v.hits[p.k] = false;
      b.struck[p.idx] = false;
      b.view[p.idx] = VIEW.SPOTTED;
      const wasBurning = v.burning;
      v.burning = false;
      ctx.all({ type: 'fx', fx: 'repair', board: seat, idx: p.idx });
      const where = bt.label(p.idx);
      ctx.say(
        seat,
        `🔧 Repaired your ${v.name} at ${where}${wasBurning ? ' and put out the fire' : ''}.`,
        `🔧 The enemy repaired a ship part at ${where}${wasBurning ? ' and put out the fire' : ''}. Hit it again!`,
        'good', 'warn',
      );
    },
  },

  evasive: {
    prepare(bt, a, seat) {
      const { b, vi, v } = ownVessel(bt, a, seat);
      if (v.hits.some(Boolean)) throw new GameError('Only undamaged ships can make an evasive maneuver.');
      const dir = a.dir === 'v' ? 'v' : 'h';
      if (!inBounds(bt.size, a.r, a.c)) throw new GameError('Pick a new position on your board.');
      const cells = shipCells(bt.size, a.r, a.c, dir, v.size);
      if (!cells) throw new GameError('The ship has to stay on the board.');
      for (const i of cells) {
        const own = b.owner[i] === vi;
        if (!own && (b.owner[i] >= 0 || b.mines.has(i))) throw new GameError('That spot is already taken.');
        if (b.struck[i] || (!own && b.view[i] !== VIEW.UNKNOWN)) {
          throw new GameError('You can only move onto cells the enemy has never hit or scanned.');
        }
      }
      if (cells.every((c, k) => c === v.cells[k])) throw new GameError('Move it somewhere new.');
      const near = cells.some((i) => neighborCells(bt.size, i).some((n) => b.owner[n] >= 0 && b.owner[n] !== vi));
      if (near) throw new GameError("Ships can't touch each other. Leave an empty cell around it.");
      return { vi, vessel: v, cells, dir, idx: null, primary: null };
    },
    run(bt, ctx, seat, p) {
      const b = bt.boards[seat];
      const v = p.vessel;
      const from = [...v.cells];
      for (const i of v.cells) {
        b.owner[i] = -1;
        if (b.view[i] === VIEW.SPOTTED) b.view[i] = VIEW.UNKNOWN;
      }
      v.cells = p.cells;
      v.dir = p.dir;
      for (const i of v.cells) b.owner[i] = p.vi;
      b.sonar = [];
      ctx.ev(seat, { type: 'fx', fx: 'move', board: seat, from, cells: [...v.cells] });
      ctx.say(
        seat,
        `🌀 Your ${v.name} slipped away to ${bt.label(v.cells[0])}.`,
        '🌀 An enemy ship made an evasive maneuver! Your intel on it and your sonar readings are gone.',
        'good', 'warn',
      );
    },
  },
};

export { EFFECTS };
