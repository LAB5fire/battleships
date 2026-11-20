import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, buildBoard, GameError, fleetDestroyed } from '../server/game.js';
import { FLEETS } from '../shared/config.js';
import { VIEW, toIdx } from '../shared/geometry.js';
import { emptyInventory, ITEMS } from '../shared/items.js';
import { randomFleet } from '../shared/layout.js';

const SIZE = 10;
const FLEET = FLEETS[10];
const I = (r, c) => toIdx(SIZE, r, c);

// carrier (0,0)-(0,4), battleship (2,0)-(2,3), cruiser (4,0)-(4,2), submarine (6,0)-(6,2), destroyer (8,0)-(8,1)
const rowsLayout = (extra = {}) => ({
  ships: FLEET.map((s, k) => ({ type: s.type, r: k * 2, c: 0, dir: 'h' })),
  decoys: [],
  mines: [],
  ...extra,
});

function setup({ layoutA = rowsLayout(), layoutB = rowsLayout(), invA = {}, invB = {}, first = 0 } = {}) {
  const players = [
    { inventory: { ...emptyInventory(), ...invA } },
    { inventory: { ...emptyInventory(), ...invB } },
  ];
  const boards = [
    buildBoard(SIZE, FLEET, layoutA, players[0].inventory),
    buildBoard(SIZE, FLEET, layoutB, players[1].inventory),
  ];
  return { bt: new Battle({ boards, first, players }), players, boards };
}

const shot = (bt, seat, r, c) => bt.act(seat, { type: 'shot', r, c });
const use = (bt, seat, itemId, extra = {}) => bt.act(seat, { type: 'item', itemId, ...extra });
const vessel = (board, id) => board.vessels.find((v) => v.id === id);
const hitCount = (board) => board.vessels.reduce((n, v) => n + v.hits.filter(Boolean).length, 0);
// Pass the turn back with a harmless shot into the bottom-right corner area.
let filler = 0;
const pass = (bt, seat) => {
  for (;;) {
    const i = 99 - (filler++ % 30);
    const b = bt.boards[1 - seat];
    if (!b.struck[i] && b.owner[i] < 0 && !b.mines.has(i) && b.view[i] === VIEW.UNKNOWN) {
      return shot(bt, seat, Math.floor(i / SIZE), i % SIZE);
    }
  }
};

test('catalog has at least 15 distinct items with valid fields', () => {
  assert.ok(ITEMS.length >= 15);
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  for (const item of ITEMS) {
    assert.ok(item.price > 0 && item.max > 0 && item.name && item.icon && item.desc, item.id);
    assert.ok(['attack', 'tactical', 'deploy', 'passive'].includes(item.action), item.id);
  }
  const nuke = ITEMS.find((i) => i.id === 'nuke');
  assert.equal(Math.max(...ITEMS.map((i) => i.price)), nuke.price, 'the 5x5 nuke is the most expensive');
});

test('buildBoard validates layouts', () => {
  assert.throws(() => buildBoard(SIZE, FLEET, { ships: [] }), GameError);
  const overlap = rowsLayout();
  overlap.ships[1] = { type: 'battleship', r: 0, c: 2, dir: 'v' };
  assert.throws(() => buildBoard(SIZE, FLEET, overlap), /overlaps/);
  const off = rowsLayout();
  off.ships[0] = { type: 'carrier', r: 0, c: 7, dir: 'h' };
  assert.throws(() => buildBoard(SIZE, FLEET, off), /doesn't fit/);
  const dup = rowsLayout();
  dup.ships[4] = { type: 'carrier', r: 9, c: 0, dir: 'h' };
  assert.throws(() => buildBoard(SIZE, FLEET, dup), /exactly once/);
  const decoys = rowsLayout({ decoys: [{ r: 9, c: 5, dir: 'h' }] });
  assert.throws(() => buildBoard(SIZE, FLEET, decoys, {}), /more decoys/);
  assert.ok(buildBoard(SIZE, FLEET, decoys, { decoy: 1 }));
  const strings = rowsLayout();
  strings.ships[0] = { type: 'carrier', r: '0', c: 0, dir: 'h' };
  assert.throws(() => buildBoard(SIZE, FLEET, strings), GameError);
});

test('random fleets are always valid on every board size', () => {
  for (const size of [10, 12, 14]) {
    for (let k = 0; k < 50; k++) {
      const ships = randomFleet(size, FLEETS[size]);
      assert.ok(buildBoard(size, FLEETS[size], { ships }));
    }
  }
});

test('a hit fires again, a miss passes the turn, cells cannot repeat', () => {
  const { bt, boards } = setup();
  assert.throws(() => shot(bt, 1, 0, 0), /not your turn/);
  const ctx = shot(bt, 0, 0, 0);
  assert.equal(boards[1].view[I(0, 0)], VIEW.HIT);
  assert.equal(bt.turn, 0, 'a hit keeps the turn');
  assert.ok(ctx.events[1].some((e) => e.type === 'bonus' && e.seat === 0));
  shot(bt, 0, 9, 9);
  assert.equal(bt.turn, 1, 'a miss passes the turn');
  shot(bt, 1, 5, 5);
  assert.equal(boards[0].view[I(5, 5)], VIEW.MISS);
  assert.throws(() => shot(bt, 0, 0, 0), /already know/);
  assert.equal(bt.earned[0].hits, 1);
});

test('sinking every real ship wins the round, decoys do not count', () => {
  const { bt, boards } = setup({ layoutB: rowsLayout({ decoys: [{ r: 9, c: 5, dir: 'h' }] }), invB: { decoy: 1 } });
  const targets = boards[1].vessels.filter((v) => !v.isDecoy).flatMap((v) => v.cells);
  for (const i of targets) {
    shot(bt, 0, Math.floor(i / SIZE), i % SIZE);
    if (bt.winner !== null) break;
    assert.equal(bt.turn, 0, 'every hit fires again');
  }
  assert.equal(bt.winner, 0);
  assert.ok(fleetDestroyed(boards[1]));
  assert.equal(bt.earned[0].sinks, 5);
  assert.equal(boards[1].view[I(4, 1)], VIEW.SUNK);
});

test('energy shield blocks two hits, secretly', () => {
  const { bt, boards } = setup({ invB: { shield: 1 }, first: 1 });
  const ctx = use(bt, 1, 'shield', { shipId: 'carrier' });
  assert.equal(vessel(boards[1], 'carrier').shield, 2);
  assert.equal(ctx.events[0].length, 0, 'the opponent sees nothing');
  assert.equal(bt.turn, 1, 'tactical item keeps the turn');
  pass(bt, 1);
  shot(bt, 0, 0, 0);
  assert.equal(boards[1].view[I(0, 0)], VIEW.SPOTTED);
  assert.equal(vessel(boards[1], 'carrier').hits[0], false);
  pass(bt, 1);
  shot(bt, 0, 0, 0); // a blocked cell can be fired on again
  pass(bt, 1);
  shot(bt, 0, 0, 0);
  assert.equal(vessel(boards[1], 'carrier').hits[0], true);
  assert.equal(vessel(boards[1], 'carrier').shield, 0);
});

test('sea mine counter-strikes the attacker fleet', () => {
  const { bt, boards } = setup({ layoutB: rowsLayout({ mines: [{ r: 9, c: 9 }] }), invB: { mine: 1 } });
  shot(bt, 0, 9, 9);
  assert.equal(boards[1].view[I(9, 9)], VIEW.MINE);
  assert.equal(hitCount(boards[0]), 1, 'one random part of the attacker was hit');
  assert.equal(bt.earned[1].hits, 1);
  assert.equal(bt.turn, 1);
});

test('decoys look like hits to the attacker until destroyed', () => {
  const { bt, boards } = setup({ layoutB: rowsLayout({ decoys: [{ r: 9, c: 5, dir: 'h' }] }), invB: { decoy: 1 } });
  const ctx = shot(bt, 0, 9, 5);
  const atk = ctx.events[0].find((e) => e.type === 'strike');
  const def = ctx.events[1].find((e) => e.type === 'strike');
  assert.equal(atk.result, 'hit');
  assert.equal(def.result, 'decoyhit');
  assert.equal(boards[1].view[I(9, 5)], VIEW.HIT);
  assert.equal(bt.turn, 0, 'a decoy hit also fires again, so it looks real');
  const ctx2 = shot(bt, 0, 9, 6);
  assert.equal(ctx2.events[0].find((e) => e.type === 'strike').result, 'decoy');
  assert.equal(boards[1].view[I(9, 5)], VIEW.DECOY);
  assert.equal(bt.earned[0].sinks, 0);
});

test('cluster bomb, nuke and cross missile cover the right cells', () => {
  let { bt, boards } = setup({ invA: { cluster: 1 } });
  use(bt, 0, 'cluster', { r: 1, c: 1 });
  assert.equal(hitCount(boards[1]), 6);
  assert.equal(boards[1].struck.filter(Boolean).length, 9);
  assert.equal(bt.turn, 1, 'attack items end the turn');

  ({ bt, boards } = setup({ invA: { nuke: 1 } }));
  use(bt, 0, 'nuke', { r: 0, c: 0 });
  assert.equal(boards[1].struck.filter(Boolean).length, 9, 'clipped at the corner');
  ({ bt, boards } = setup({ invA: { nuke: 1 } }));
  use(bt, 0, 'nuke', { r: 5, c: 5 });
  assert.equal(boards[1].struck.filter(Boolean).length, 25);

  ({ bt, boards } = setup({ invA: { cross: 1 } }));
  use(bt, 0, 'cross', { r: 4, c: 4 });
  assert.equal(boards[1].struck.filter(Boolean).length, 9);
  assert.ok(boards[1].struck[I(2, 4)] && boards[1].struck[I(4, 2)] && !boards[1].struck[I(3, 3)]);
});

test('items are consumed and cannot be used without owning them', () => {
  const { bt, players } = setup({ invA: { cluster: 1 } });
  assert.throws(() => use(bt, 0, 'nuke', { r: 5, c: 5 }), /don't have/);
  use(bt, 0, 'cluster', { r: 5, c: 5 });
  assert.equal(players[0].inventory.cluster, 0);
  pass(bt, 1);
  assert.throws(() => use(bt, 0, 'cluster', { r: 5, c: 5 }), /don't have/);
  assert.throws(() => use(bt, 0, 'mine', { r: 5, c: 5 }), GameError);
});

test('seeker missile homes onto the nearest ship part', () => {
  const { bt, boards } = setup({ invA: { seeker: 2 } });
  use(bt, 0, 'seeker', { r: 1, c: 4 });
  assert.ok(vessel(boards[1], 'carrier').hits[4], 'curved to (0,4)');
  pass(bt, 1);
  use(bt, 0, 'seeker', { r: 9, c: 9 });
  assert.equal(boards[1].view[I(9, 9)], VIEW.MISS, 'nothing in range -> plain miss');
});

test('torpedo stops at the first ship and reveals the water it passed', () => {
  let { bt, boards } = setup({ invA: { torpedo: 3 } });
  use(bt, 0, 'torpedo', { r: 0, c: 0, dir: 'left' });
  assert.ok(vessel(boards[1], 'carrier').hits[4]);
  for (let c = 5; c < 10; c++) assert.equal(boards[1].view[I(0, c)], VIEW.CLEAR);
  pass(bt, 1);
  use(bt, 0, 'torpedo', { r: 1, c: 0, dir: 'right' });
  for (let c = 0; c < 10; c++) assert.equal(boards[1].view[I(1, c)], VIEW.CLEAR);
  pass(bt, 1);
  use(bt, 0, 'torpedo', { r: 0, c: 0, dir: 'down' });
  assert.ok(vessel(boards[1], 'carrier').hits[0]);
  ({ bt } = setup({ invA: { torpedo: 1 } }));
  assert.throws(() => use(bt, 0, 'torpedo', { r: 0, c: 0, dir: 'sideways' }), GameError);
});

test('napalm sets a ship on fire that spreads each turn', () => {
  const { bt, boards } = setup({ invA: { napalm: 1 } });
  use(bt, 0, 'napalm', { r: 6, c: 0 });
  const sub = vessel(boards[1], 'submarine');
  assert.ok(sub.burning);
  assert.deepEqual(sub.hits, [true, false, false]);
  pass(bt, 1); // A's next turn starts -> fire spreads
  assert.deepEqual(sub.hits, [true, true, false]);
  pass(bt, 0);
  pass(bt, 1);
  assert.ok(sub.sunk);
  assert.equal(sub.burning, false);
});

test('repair kit fixes a part and puts out the fire', () => {
  const { bt, boards } = setup({ invA: { napalm: 1 }, invB: { repair: 1 } });
  use(bt, 0, 'napalm', { r: 6, c: 0 });
  assert.throws(() => use(bt, 1, 'repair', { r: 6, c: 1 }), /isn't damaged/);
  use(bt, 1, 'repair', { r: 6, c: 0 });
  const sub = vessel(boards[1], 'submarine');
  assert.equal(sub.burning, false);
  assert.deepEqual(sub.hits, [false, false, false]);
  assert.equal(boards[1].view[I(6, 0)], VIEW.SPOTTED);
  assert.equal(boards[1].struck[I(6, 0)], false);
});

test('chain lightning arcs to two more parts of the same ship', () => {
  const { bt, boards } = setup({ invA: { chain: 2 } });
  use(bt, 0, 'chain', { r: 0, c: 2 });
  assert.deepEqual(vessel(boards[1], 'carrier').hits, [false, true, true, true, false]);
  pass(bt, 1);
  use(bt, 0, 'chain', { r: 0, c: 2 }); // already damaged part still conducts
  assert.ok(vessel(boards[1], 'carrier').sunk);
});

test('rocket salvo fires at three chosen cells', () => {
  const { bt, boards } = setup({ invA: { salvo: 1 } });
  assert.throws(() => use(bt, 0, 'salvo', { targets: [{ r: 0, c: 0 }, { r: 0, c: 0 }] }), /different/);
  use(bt, 0, 'salvo', { targets: [{ r: 0, c: 0 }, { r: 2, c: 0 }, { r: 5, c: 5 }] });
  assert.equal(hitCount(boards[1]), 2);
  assert.equal(boards[1].view[I(5, 5)], VIEW.MISS);
});

test('bomber run bombs a whole row', () => {
  const { bt, boards } = setup({ invA: { bomber: 1 } });
  use(bt, 0, 'bomber', { r: 2, c: 7, orient: 'h' });
  assert.ok(vessel(boards[1], 'battleship').sunk);
  assert.equal(boards[1].struck.filter(Boolean).length, 10);
});

test('recon plane reveals a column, tactical limit is one per turn', () => {
  const { bt, boards } = setup({ invA: { recon: 2 } });
  use(bt, 0, 'recon', { r: 0, c: 0, orient: 'v' });
  assert.equal(bt.turn, 0);
  for (let r = 0; r < 10; r++) assert.equal(boards[1].view[I(r, 0)], r % 2 === 0 && r < 9 ? VIEW.SPOTTED : VIEW.CLEAR);
  assert.throws(() => use(bt, 0, 'recon', { r: 0, c: 5, orient: 'v' }), /already used a tactical/);
  shot(bt, 0, 2, 0);
  assert.equal(bt.turn, 0, 'hit on a spotted part fires again');
  assert.throws(() => use(bt, 0, 'recon', { r: 0, c: 5, orient: 'v' }), /already used a tactical/);
  pass(bt, 0);
  assert.equal(bt.turn, 1);
});

test('commando drop reveals a whole ship, exposes decoys, scouts water', () => {
  const { bt, boards } = setup({ invA: { commando: 3 }, layoutB: rowsLayout({ decoys: [{ r: 9, c: 5, dir: 'h' }] }), invB: { decoy: 1 } });
  use(bt, 0, 'commando', { r: 2, c: 1 });
  for (let c = 0; c < 4; c++) assert.equal(boards[1].view[I(2, c)], VIEW.SPOTTED);
  pass(bt, 0);
  pass(bt, 1);
  use(bt, 0, 'commando', { r: 9, c: 6 });
  assert.equal(boards[1].view[I(9, 5)], VIEW.DECOY);
  assert.throws(() => shot(bt, 0, 9, 5), /already know/);
  pass(bt, 0);
  pass(bt, 1);
  use(bt, 0, 'commando', { r: 5, c: 5 });
  assert.equal(boards[1].view[I(5, 5)], VIEW.CLEAR);
  assert.equal(boards[1].view[I(4, 5)], VIEW.CLEAR);
});

test('sonar counts, radar reveals, satellite marks three ships', () => {
  const { bt, boards } = setup({ invA: { sonar: 1, radar: 1, satellite: 1 } });
  use(bt, 0, 'sonar', { r: 1, c: 1 });
  assert.deepEqual(boards[1].sonar[0], { r: 1, c: 1, count: 8, radius: 2 });
  shot(bt, 0, 9, 9);
  pass(bt, 1);
  use(bt, 0, 'radar', { r: 1, c: 1 });
  assert.equal(boards[1].view.filter((v) => v === VIEW.SPOTTED).length, 6);
  assert.equal(boards[1].view[I(1, 1)], VIEW.CLEAR);
  shot(bt, 0, 9, 8);
  pass(bt, 1);
  use(bt, 0, 'satellite');
  const spottedShips = new Set(boards[1].view.map((v, i) => (v === VIEW.SPOTTED ? boards[1].owner[i] : null)).filter((x) => x !== null));
  assert.ok(spottedShips.size >= 3);
});

test('radar spots mines', () => {
  const { bt, boards } = setup({ invA: { radar: 1 }, layoutB: rowsLayout({ mines: [{ r: 5, c: 5 }] }), invB: { mine: 1 } });
  use(bt, 0, 'radar', { r: 5, c: 5 });
  assert.equal(boards[1].view[I(5, 5)], VIEW.MINE_SPOTTED);
  assert.throws(() => shot(bt, 0, 5, 5), /already know/);
});

test('evasive maneuver moves an undamaged ship onto unknown cells only', () => {
  const { bt, boards } = setup({ invA: { radar: 1 }, invB: { evasive: 2 }, first: 0 });
  use(bt, 0, 'radar', { r: 8, c: 4 }); // scans rows 7-9, cols 3-5
  shot(bt, 0, 8, 0); // hits the destroyer, so player 0 fires again
  shot(bt, 0, 5, 9); // a miss passes the turn
  assert.throws(() => use(bt, 1, 'evasive', { shipId: 'destroyer', r: 8, c: 7, dir: 'h' }), /undamaged/);
  assert.throws(() => use(bt, 1, 'evasive', { shipId: 'submarine', r: 8, c: 3, dir: 'h' }), /never hit or scanned/);
  use(bt, 1, 'evasive', { shipId: 'submarine', r: 7, c: 7, dir: 'h' });
  const sub = vessel(boards[1], 'submarine');
  assert.deepEqual(sub.cells, [I(7, 7), I(7, 8), I(7, 9)]);
  assert.equal(boards[1].owner[I(6, 0)], -1);
  assert.equal(boards[1].owner[I(7, 8)], boards[1].vessels.indexOf(sub));
  pass(bt, 1);
  pass(bt, 0);
  assert.throws(() => use(bt, 1, 'evasive', { shipId: 'cruiser', r: 6, c: 4, dir: 'h' }), /touch/);
});

test('ships and decoys cannot touch, even diagonally; mines can', () => {
  const side = rowsLayout();
  side.ships[4] = { type: 'destroyer', r: 8, c: 5, dir: 'h' }; // well clear of everything
  assert.ok(buildBoard(SIZE, FLEET, side));
  const adjacent = rowsLayout();
  adjacent.ships[4] = { type: 'destroyer', r: 7, c: 0, dir: 'h' }; // right under the submarine
  assert.throws(() => buildBoard(SIZE, FLEET, adjacent), /touching/);
  const diagonal = rowsLayout();
  diagonal.ships[4] = { type: 'destroyer', r: 7, c: 3, dir: 'h' }; // corner to corner with the submarine end (6,2)
  assert.throws(() => buildBoard(SIZE, FLEET, diagonal), /touching/);
  const sideBySide = rowsLayout();
  sideBySide.ships[4] = { type: 'destroyer', r: 6, c: 3, dir: 'h' };
  assert.throws(() => buildBoard(SIZE, FLEET, sideBySide), /touching/);
  assert.throws(() => buildBoard(SIZE, FLEET, rowsLayout({ decoys: [{ r: 9, c: 0, dir: 'h' }] }), { decoy: 1 }), /touching/);
  assert.ok(buildBoard(SIZE, FLEET, rowsLayout({ mines: [{ r: 1, c: 0 }] }), { mine: 1 }), 'mines may sit next to ships');
});

test('flak cannon shoots down planes, interceptor stops missiles but not torpedoes', () => {
  let { bt, boards, players } = setup({ invA: { bomber: 1, recon: 1 }, invB: { flak: 1 } });
  use(bt, 0, 'bomber', { r: 2, c: 0, orient: 'h' });
  assert.equal(players[1].inventory.flak, 0);
  assert.equal(players[0].inventory.bomber, 0);
  assert.equal(boards[1].struck.filter(Boolean).length, 0);
  assert.equal(bt.turn, 1, 'the attack is still spent');
  pass(bt, 1);
  use(bt, 0, 'recon', { r: 2, c: 0, orient: 'h' });
  assert.equal(boards[1].view[I(2, 0)], VIEW.SPOTTED, 'only one flak, so the second plane gets through');

  ({ bt, boards, players } = setup({ invA: { cluster: 1, torpedo: 1 }, invB: { interceptor: 2 } }));
  use(bt, 0, 'cluster', { r: 1, c: 1 });
  assert.equal(boards[1].struck.filter(Boolean).length, 1);
  assert.equal(players[1].inventory.interceptor, 1);
  pass(bt, 1);
  use(bt, 0, 'torpedo', { r: 0, c: 0, dir: 'right' });
  assert.ok(vessel(boards[1], 'carrier').hits[0]);
  assert.equal(players[1].inventory.interceptor, 1, 'torpedo slipped underneath');
});

test('auto-shot prefers spotted cells', () => {
  const { bt, boards } = setup({ invA: { radar: 1 } });
  use(bt, 0, 'radar', { r: 4, c: 1 });
  bt.autoShot(0);
  const struck = boards[1].struck.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  assert.equal(struck.length, 1);
  assert.equal(boards[1].owner[struck[0]] >= 0, true);
});
