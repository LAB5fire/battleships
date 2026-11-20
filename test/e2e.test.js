// Two real Socket.IO clients play a full match against the real server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { startServer } from '../server/index.js';
import { randomFleet } from '../shared/layout.js';
import { VIEW, toRC, touchesAny } from '../shared/geometry.js';

let srv;
before(async () => { srv = await startServer(0); });
after(async () => { await srv.close(); });

function client(name, pid = `pid_${Math.random().toString(36).slice(2, 12)}`) {
  const socket = connect(`http://localhost:${srv.port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  const c = { socket, name, pid, state: null, waiters: [], closed: null, emotes: [] };
  socket.on('update', ({ state }) => {
    c.state = state;
    c.waiters = c.waiters.filter((w) => !w(state));
  });
  socket.on('roomClosed', (msg) => { c.closed = msg; });
  socket.on('emote', (e) => c.emotes.push(e));
  return c;
}
const call = (c, ev, payload = {}) => new Promise((resolve) => c.socket.emit(ev, payload, resolve));
const waitFor = (c, pred, ms = 4000) => new Promise((resolve, reject) => {
  if (c.state && pred(c.state)) { resolve(c.state); return; }
  const t = setTimeout(() => reject(new Error(`timeout waiting for state on ${c.name}`)), ms);
  c.waiters.push((s) => {
    if (!pred(s)) return false;
    clearTimeout(t);
    resolve(s);
    return true;
  });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function layoutFor(state, { decoys = 0, mines = 0 } = {}) {
  const size = state.settings.boardSize;
  const ships = randomFleet(size, state.fleet);
  const used = new Set();
  for (const s of ships) {
    const spec = state.fleet.find((f) => f.type === s.type);
    for (let k = 0; k < spec.size; k++) used.add(s.dir === 'v' ? (s.r + k) * size + s.c : s.r * size + s.c + k);
  }
  const free = [];
  for (let i = 0; i < size * size; i++) if (!used.has(i) && !used.has(i + 1) && (i % size) < size - 1) free.push(i);
  const out = { ships, decoys: [], mines: [] };
  for (let k = 0; k < decoys; k++) {
    const i = free.find((x) => !touchesAny(size, [x, x + 1], used));
    used.add(i); used.add(i + 1);
    const [r, c] = toRC(size, i);
    out.decoys.push({ r, c, dir: 'h' });
  }
  for (let k = 0; k < mines; k++) {
    const i = free.find((x) => !used.has(x));
    used.add(i);
    const [r, c] = toRC(size, i);
    out.mines.push({ r, c });
  }
  return out;
}

function chooseAction(state) {
  const bt = state.battle;
  const inv = state.me.inventory;
  const size = bt.size;
  const view = bt.enemy.view;
  const open = [];
  const spotted = [];
  view.forEach((v, i) => {
    if (v === VIEW.UNKNOWN) open.push(i);
    if (v === VIEW.SPOTTED) spotted.push(i);
  });
  const pickCell = () => {
    const i = spotted.length ? spotted[0] : open[Math.floor(Math.random() * open.length)];
    const [r, c] = toRC(size, i);
    return { r, c };
  };
  if (!bt.tacticalUsed && inv.radar > 0) return { type: 'item', itemId: 'radar', ...pickCell() };
  if (inv.cluster > 0) return { type: 'item', itemId: 'cluster', ...pickCell() };
  return { type: 'shot', ...pickCell() };
}

function assertNoLeak(state) {
  if (state.phase !== 'battle') return;
  const bt = state.battle;
  assert.equal(bt.enemy.reveal, null, 'enemy board must stay hidden during battle');
  assert.ok(bt.enemy.view.every((v) => Object.values(VIEW).includes(v)));
  for (const s of bt.enemy.fleet) assert.deepEqual(Object.keys(s).sort(), ['name', 'size', 'sunk', 'type']);
  assert.equal(JSON.stringify(state).includes('"mines":['), true); // only our own mines
}

test('full best-of-3 match between two connected players', async () => {
  const a = client('Alice');
  const b = client('Bob');

  const created = await call(a, 'room:create', { name: 'Alice', playerId: a.pid, settings: { bestOf: 3, boardSize: 10, startingCoins: 800, turnTimer: 0 } });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-Z2-9]{5}$/);
  await waitFor(a, (s) => s.phase === 'lobby');

  const bad = await call(b, 'room:join', { code: 'ZZZZZ', name: 'Bob', playerId: b.pid });
  assert.equal(bad.ok, false);

  const joined = await call(b, 'room:join', { code: created.code.toLowerCase(), name: 'Bob', playerId: b.pid });
  assert.equal(joined.ok, true);
  await waitFor(a, (s) => s.phase === 'prep' && s.roundNo === 1);
  await waitFor(b, (s) => s.phase === 'prep' && s.opp?.name === 'Alice');

  const third = client('Eve');
  assert.equal((await call(third, 'room:join', { code: created.code, name: 'Eve', playerId: third.pid })).ok, false);
  third.socket.close();

  // ---- shopping
  for (const id of ['cluster', 'radar', 'mine']) assert.equal((await call(a, 'prep:buy', { itemId: id })).ok, true);
  for (const id of ['flak', 'decoy', 'shield']) assert.equal((await call(b, 'prep:buy', { itemId: id })).ok, true);
  assert.equal((await call(b, 'prep:buy', { itemId: 'nuke' })).ok, true);
  const second = await call(b, 'prep:buy', { itemId: 'nuke' });
  assert.equal(second.ok, false, 'only one nuke allowed');
  assert.equal((await call(b, 'prep:refund', { itemId: 'nuke' })).ok, true);
  assert.equal((await call(b, 'prep:refund', { itemId: 'shield' })).ok, true);
  await waitFor(a, (s) => s.me.coins === 800 - 150 - 100 - 100);
  await waitFor(b, (s) => s.me.coins === 800 - 130 - 90 && s.me.inventory.shield === 0);
  assert.equal((await call(a, 'prep:buy', { itemId: 'bogus' })).ok, false);

  // ---- deploy (invalid first)
  assert.equal((await call(a, 'prep:ready', { layout: { ships: [] } })).ok, false);
  assert.equal((await call(a, 'prep:ready', { layout: layoutFor(a.state, { mines: 2 }) })).ok, false, 'owns only one mine');
  assert.equal((await call(a, 'prep:ready', { layout: layoutFor(a.state, { mines: 1 }) })).ok, true);
  assert.equal((await call(a, 'prep:buy', { itemId: 'sonar' })).ok, false, 'cannot shop while ready');
  await waitFor(b, (s) => s.opp.ready === true);
  assert.equal((await call(b, 'prep:ready', { layout: layoutFor(b.state, { decoys: 1 }) })).ok, true);

  await waitFor(a, (s) => s.phase === 'battle');
  await waitFor(b, (s) => s.phase === 'battle');
  assert.equal(a.state.me.inventory.mine, 0, 'deployed mine consumed');
  assert.equal(b.state.battle.my.vessels.filter((v) => v.isDecoy).length, 1);

  // ---- play rounds until the match ends
  let actions = 0;
  let rounds = 0;
  let timeoutTested = false;
  while (true) {
    const phase = a.state.phase;
    if (phase === 'matchOver') break;
    if (phase === 'roundOver') {
      rounds++;
      assert.ok(a.state.battle.enemy.reveal, 'boards are revealed after the round');
      assert.ok(a.state.lastRound.players[0].total > 0);
      assert.equal((await call(a, 'round:continue')).ok, true);
      assert.equal((await call(b, 'round:continue')).ok, true);
      await waitFor(a, (s) => s.phase === 'prep');
      await waitFor(b, (s) => s.phase === 'prep');
      assert.equal((await call(a, 'prep:ready', { layout: layoutFor(a.state) })).ok, true);
      assert.equal((await call(b, 'prep:ready', { layout: layoutFor(b.state) })).ok, true);
      await waitFor(a, (s) => s.phase === 'battle');
      await waitFor(b, (s) => s.phase === 'battle');
      continue;
    }
    assert.equal(phase, 'battle');
    assertNoLeak(a.state);
    assertNoLeak(b.state);
    const actor = a.state.battle.turn === 'me' ? a : b;
    assert.equal((actor === a ? b : a).state.battle.turn, 'opp', 'both clients agree whose turn it is');
    const room = srv.rooms.get(created.code);

    if (!timeoutTested && actions === 10) {
      // Simulate the turn timer running out.
      room.onTimeout(room.battle.step);
      timeoutTested = true;
      assert.ok(actor.state.rev === room.rev || (await waitFor(actor, (s) => s.rev === room.rev)));
    } else {
      const res = await call(actor, 'battle:act', chooseAction(actor.state));
      assert.equal(res.ok, true, res.error);
    }
    actions++;
    await waitFor(a, (s) => s.rev === room.rev);
    await waitFor(b, (s) => s.rev === room.rev);
    assert.ok(actions < 2000, 'match should finish');
  }
  await waitFor(b, (s) => s.phase === 'matchOver');
  const wins = [a.state.me.wins, b.state.me.wins].sort();
  assert.deepEqual(wins.slice(1), [2]);
  assert.ok(rounds >= 1);
  assert.ok(a.state.log.some((l) => /won round|lost round/.test(l.text)));

  // ---- chat + emotes
  assert.equal((await call(a, 'chat', { text: 'gg <b>wp</b>' })).ok, true);
  await waitFor(b, (s) => s.chat.some((m) => m.text === 'gg <b>wp</b>' && !m.mine));
  assert.equal((await call(b, 'emote', { emoji: '😂' })).ok, true);
  assert.equal((await call(b, 'emote', { emoji: '<script>' })).ok, false);
  await sleep(50);
  assert.equal(a.emotes.at(-1).emoji, '😂');

  // ---- rematch
  await call(a, 'match:rematch');
  await call(b, 'match:rematch');
  await waitFor(a, (s) => s.phase === 'prep' && s.roundNo === 1 && s.me.wins === 0 && s.me.coins === 800);

  // ---- reconnect with the same player id keeps the seat
  b.socket.close();
  await waitFor(a, (s) => s.opp.connected === false);
  const b2 = client('Bob again', b.pid);
  const rejoin = await call(b2, 'room:join', { code: created.code, name: 'Bob', playerId: b.pid });
  assert.equal(rejoin.ok, true);
  await waitFor(b2, (s) => s.phase === 'prep' && s.seat === b.state.seat);
  await waitFor(a, (s) => s.opp.connected === true);

  // ---- leaving closes the room for the other player
  assert.equal((await call(a, 'room:leave')).ok, true);
  await sleep(50);
  assert.match(b2.closed.reason, /left/);
  assert.equal(srv.rooms.has(created.code), false);

  a.socket.close();
  b2.socket.close();
});
