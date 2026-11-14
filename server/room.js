// One private room = one 1v1 match (best of N rounds).
import { Battle, Ctx, GameError, buildBoard, cleanLayout } from './game.js';
import { FLEETS, roundsToWin, lossBonusFor, ECONOMY, EMOTES } from '../shared/config.js';
import { ITEM_MAP, emptyInventory } from '../shared/items.js';

const MAX_LOG = 80;
const MAX_CHAT = 60;

export class Room {
  constructor(code, settings, io) {
    this.code = code;
    this.settings = settings;
    this.io = io;
    this.players = [];
    this.phase = 'lobby'; // lobby | prep | battle | roundOver | matchOver
    this.roundNo = 0;
    this.battle = null;
    this.lastRound = null;
    this.chat = [];
    this.timer = null;
    this.deadline = null;
    this.lastActive = Date.now();
    this.emptySince = null;
    this.rev = 0; // bumps on every state broadcast
  }

  get fleet() { return FLEETS[this.settings.boardSize]; }

  seatOfSocket(socketId) {
    return this.players.findIndex((p) => p.socketId === socketId);
  }

  requirePhase(...phases) {
    if (!phases.includes(this.phase)) throw new GameError('You can’t do that right now.');
  }

  // ------------------------------------------------------------- membership

  join(socket, playerId, name) {
    let p = this.players.find((x) => x.id === playerId);
    let rejoined = false;
    if (p) {
      rejoined = true;
      if (p.socketId && p.socketId !== socket.id) {
        const old = this.io.sockets.sockets.get(p.socketId);
        if (old) {
          old.data.roomCode = null;
          old.emit('kicked', { reason: 'You opened this game in another tab.' });
        }
      }
      p.socketId = socket.id;
      p.connected = true;
      if (name) p.name = name;
    } else {
      if (this.players.length >= 2) throw new GameError('This room is already full.');
      p = {
        id: playerId,
        name,
        seat: this.players.length,
        socketId: socket.id,
        connected: true,
        coins: this.settings.startingCoins,
        inventory: emptyInventory(),
        bought: {},
        ready: false,
        layout: null,
        lastLayout: null,
        continue: false,
        wins: 0,
        lossStreak: 0,
        log: [],
        chatTimes: [],
      };
      this.players.push(p);
    }
    socket.data.roomCode = this.code;
    this.touch();
    this.emptySince = null;

    const other = this.players[1 - p.seat];
    if (!rejoined && this.players.length === 2 && this.phase === 'lobby') {
      this.startMatch();
      return p;
    }
    if (other) {
      this.pushLog(other.seat, rejoined ? `🔌 ${p.name} reconnected.` : `⚓ ${p.name} joined the room.`, 'info');
    }
    if (this.phase === 'battle' && !this.timer) this.startTurnTimer();
    this.sync();
    return p;
  }

  onDisconnect(socketId) {
    const seat = this.seatOfSocket(socketId);
    if (seat < 0) return;
    const p = this.players[seat];
    p.connected = false;
    p.socketId = null;
    this.clearTimer(); // the game waits for them
    const other = this.players[1 - seat];
    if (other) this.pushLog(other.seat, `🔌 ${p.name} disconnected. Waiting for them to come back…`, 'warn');
    if (this.players.every((x) => !x.connected)) this.emptySince = Date.now();
    this.sync();
  }

  touch() { this.lastActive = Date.now(); }

  // ------------------------------------------------------------- match flow

  startMatch() {
    for (const p of this.players) {
      p.coins = this.settings.startingCoins;
      p.inventory = emptyInventory();
      p.wins = 0;
      p.lossStreak = 0;
      p.lastLayout = null;
      p.continue = false;
    }
    this.roundNo = 0;
    this.lastRound = null;
    this.battle = null;
    for (const p of this.players) this.pushLog(p.seat, `⚔️ Match on! First to ${roundsToWin(this.settings.bestOf)} round wins takes it.`, 'info');
    this.startPrep();
  }

  startPrep() {
    this.clearTimer();
    this.roundNo += 1;
    this.phase = 'prep';
    this.battle = null;
    for (const p of this.players) {
      p.ready = false;
      p.layout = null;
      p.bought = {};
      p.continue = false;
      this.pushLog(p.seat, `🛒 Round ${this.roundNo}: shop in the Armory, then deploy your fleet.`, 'info');
    }
    this.sync([[{ type: 'phase', phase: 'prep', roundNo: this.roundNo }], [{ type: 'phase', phase: 'prep', roundNo: this.roundNo }]]);
  }

  buy(seat, itemId) {
    this.requirePhase('prep');
    const p = this.players[seat];
    if (p.ready) throw new GameError('You are marked ready. Press "Edit" to shop again.');
    const item = ITEM_MAP[itemId];
    if (!item) throw new GameError('Unknown item.');
    if (p.inventory[item.id] >= item.max) throw new GameError(`You can hold at most ${item.max} × ${item.name}.`);
    if (p.coins < item.price) throw new GameError('Not enough coins.');
    p.coins -= item.price;
    p.inventory[item.id] += 1;
    p.bought[item.id] = (p.bought[item.id] || 0) + 1;
    this.touch();
    this.sync();
  }

  refund(seat, itemId) {
    this.requirePhase('prep');
    const p = this.players[seat];
    if (p.ready) throw new GameError('You are marked ready. Press "Edit" first.');
    const item = ITEM_MAP[itemId];
    if (!item) throw new GameError('Unknown item.');
    if (!(p.bought[item.id] > 0)) throw new GameError('You can only sell back items bought this round.');
    p.coins += item.price;
    p.inventory[item.id] -= 1;
    p.bought[item.id] -= 1;
    this.touch();
    this.sync();
  }

  setReady(seat, layout) {
    this.requirePhase('prep');
    const p = this.players[seat];
    buildBoard(this.settings.boardSize, this.fleet, layout, p.inventory); // throws if invalid
    p.layout = cleanLayout(layout);
    p.ready = true;
    this.touch();
    if (this.players.length === 2 && this.players.every((x) => x.ready)) this.startBattle();
    else this.sync();
  }

  unready(seat) {
    this.requirePhase('prep');
    const p = this.players[seat];
    p.ready = false;
    this.sync();
  }

  startBattle() {
    const size = this.settings.boardSize;
    const boards = this.players.map((p) => buildBoard(size, this.fleet, p.layout, p.inventory));
    for (const p of this.players) {
      p.inventory.decoy -= p.layout.decoys.length;
      p.inventory.mine -= p.layout.mines.length;
      p.lastLayout = p.layout;
    }
    const first = this.lastRound ? 1 - this.lastRound.winner : (Math.random() < 0.5 ? 0 : 1);
    this.battle = new Battle({ boards, first, players: this.players });
    this.phase = 'battle';
    const events = [[], []];
    for (const p of this.players) {
      const mine = p.seat === first;
      const why = this.lastRound ? (mine ? ' (the loser of the last round starts)' : '') : (mine ? ' (coin flip)' : '');
      events[p.seat].push({ type: 'battleStart', first: mine });
      events[p.seat].push({ type: 'log', text: mine ? `⚔️ Battle stations! You fire first${why}.` : '⚔️ Battle stations! The enemy fires first.', tone: 'info' });
    }
    this.startTurnTimer();
    this.sync(events);
  }

  battleAction(seat, action) {
    this.requirePhase('battle');
    if (!this.players.every((p) => p.connected)) throw new GameError('Wait for your opponent to reconnect.');
    const before = this.battle.turnNo;
    const ctx = this.battle.act(seat, action);
    this.touch();
    this.afterBattleStep(ctx, before);
  }

  afterBattleStep(ctx, turnBefore) {
    if (this.battle.winner !== null) {
      this.endRound(ctx);
      return;
    }
    if (this.battle.turnNo !== turnBefore) this.startTurnTimer();
    this.sync(ctx.events);
  }

  endRound(ctx = new Ctx(), reason = 'fleet') {
    this.clearTimer();
    const winner = this.battle.winner;
    const summary = { round: this.roundNo, winner, reason, players: [] };
    for (const p of this.players) {
      const e = this.battle.earned[p.seat];
      let bonus;
      if (p.seat === winner) {
        bonus = ECONOMY.winBonus;
        p.wins += 1;
        p.lossStreak = 0;
      } else {
        bonus = lossBonusFor(p.lossStreak);
        p.lossStreak += 1;
      }
      const total = e.coins + bonus;
      p.coins += total;
      summary.players[p.seat] = {
        hits: e.hits,
        sinks: e.sinks,
        hitCoins: e.hits * ECONOMY.hit,
        sinkCoins: e.sinks * ECONOMY.sink,
        bonus,
        total,
        coinsAfter: p.coins,
      };
    }
    this.lastRound = summary;
    const matchOver = this.players[winner].wins >= roundsToWin(this.settings.bestOf);
    this.phase = matchOver ? 'matchOver' : 'roundOver';
    for (const p of this.players) p.continue = false;
    ctx.say(winner, `🏆 You won round ${this.roundNo}!`, `☠️ You lost round ${this.roundNo}.`, 'good', 'bad');
    if (matchOver) ctx.say(winner, '🎉 YOU WON THE MATCH!', '🏳️ The enemy won the match.', 'good', 'bad');
    ctx.all({ type: matchOver ? 'matchOver' : 'roundOver', winner });
    this.sync(ctx.events);
  }

  continueRound(seat) {
    this.requirePhase('roundOver');
    this.players[seat].continue = true;
    if (this.players.length === 2 && this.players.every((p) => p.continue)) this.startPrep();
    else this.sync();
  }

  rematch(seat) {
    this.requirePhase('matchOver');
    this.players[seat].continue = true;
    if (this.players.length === 2 && this.players.every((p) => p.continue)) this.startMatch();
    else this.sync();
  }

  // ------------------------------------------------------------- turn timer

  startTurnTimer() {
    this.clearTimer();
    const secs = this.settings.turnTimer;
    if (!secs || this.phase !== 'battle' || !this.battle || this.players.length < 2) return;
    if (!this.players.every((p) => p.connected)) return;
    const turnNo = this.battle.turnNo;
    this.deadline = Date.now() + secs * 1000;
    this.timer = setTimeout(() => this.onTimeout(turnNo), secs * 1000 + 250);
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  onTimeout(turnNo) {
    this.timer = null;
    this.deadline = null;
    if (this.phase !== 'battle' || !this.battle || this.battle.winner !== null || this.battle.turnNo !== turnNo) return;
    try {
      const ctx = this.battle.autoShot(this.battle.turn);
      this.afterBattleStep(ctx, turnNo);
    } catch (err) {
      console.error('auto-shot failed', err);
    }
  }

  // ------------------------------------------------------------- chat

  sendChat(seat, text) {
    const p = this.players[seat];
    const clean = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    if (!clean) return;
    this.rateLimit(p);
    this.chat.push({ seat, name: p.name, text: clean, t: Date.now() });
    if (this.chat.length > MAX_CHAT) this.chat.shift();
    this.sync([[{ type: 'chat', seat }], [{ type: 'chat', seat }]]);
  }

  sendEmote(seat, emoji) {
    if (!EMOTES.includes(emoji)) throw new GameError('Unknown emote.');
    this.rateLimit(this.players[seat]);
    const ev = { type: 'emote', seat, emoji };
    for (const p of this.players) {
      if (p.socketId) this.io.to(p.socketId).emit('emote', ev);
    }
  }

  rateLimit(p) {
    const now = Date.now();
    p.chatTimes = p.chatTimes.filter((t) => now - t < 5000);
    if (p.chatTimes.length >= 6) throw new GameError('Slow down a little!');
    p.chatTimes.push(now);
  }

  // ------------------------------------------------------------- state out

  pushLog(seat, text, tone = 'info') {
    const p = this.players[seat];
    if (!p) return;
    p.logSeq = (p.logSeq || 0) + 1;
    p.log.push({ id: p.logSeq, text, tone });
    if (p.log.length > MAX_LOG) p.log.splice(0, p.log.length - MAX_LOG);
  }

  sync(events = null) {
    this.rev += 1;
    for (const p of this.players) {
      const evs = events ? events[p.seat] || [] : [];
      for (const e of evs) if (e.type === 'log') this.pushLog(p.seat, e.text, e.tone);
    }
    for (const p of this.players) {
      if (!p.connected || !p.socketId) continue;
      const evs = events ? events[p.seat] || [] : [];
      this.io.to(p.socketId).emit('update', { state: this.stateFor(p.seat), events: evs.filter((e) => e.type !== 'log') });
    }
  }

  stateFor(seat) {
    const me = this.players[seat];
    const opp = this.players[1 - seat] || null;
    const state = {
      rev: this.rev,
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      roundNo: this.roundNo,
      roundsToWin: roundsToWin(this.settings.bestOf),
      fleet: this.fleet,
      seat,
      me: {
        name: me.name,
        coins: me.coins,
        inventory: me.inventory,
        bought: me.bought,
        wins: me.wins,
        ready: me.ready,
        continue: me.continue,
        layout: me.layout,
        lastLayout: me.lastLayout,
        lossStreak: me.lossStreak,
      },
      opp: opp ? { name: opp.name, wins: opp.wins, ready: opp.ready, continue: opp.continue, connected: opp.connected } : null,
      log: me.log,
      chat: this.chat.map((m) => ({ mine: m.seat === seat, name: m.name, text: m.text, t: m.t })),
      lastRound: this.lastRound,
      deadline: this.deadline,
      now: Date.now(),
      battle: this.battle ? this.battleView(seat) : null,
    };
    return state;
  }

  battleView(seat) {
    const bt = this.battle;
    const mine = bt.boards[seat];
    const theirs = bt.boards[1 - seat];
    const revealAll = this.phase !== 'battle';
    const vesselOut = (v) => ({
      id: v.id, type: v.type, name: v.name, size: v.size, cells: v.cells, dir: v.dir,
      hits: v.hits, sunk: v.sunk, shield: v.shield, burning: v.burning, isDecoy: v.isDecoy, exposed: v.exposed,
    });
    const burning = [];
    for (const v of theirs.vessels) {
      if (v.burning && !v.sunk) v.cells.forEach((c, k) => { if (v.hits[k]) burning.push(c); });
    }
    return {
      size: bt.size,
      turn: bt.turn === seat ? 'me' : 'opp',
      turnNo: bt.turnNo,
      tacticalUsed: bt.turn === seat ? bt.tacticalUsed : false,
      earned: bt.earned[seat],
      winner: bt.winner === null ? null : (bt.winner === seat ? 'me' : 'opp'),
      my: {
        vessels: mine.vessels.map(vesselOut),
        mines: [...mine.mines],
        view: mine.view,
      },
      enemy: {
        view: theirs.view,
        sonar: theirs.sonar,
        burning,
        fleet: theirs.vessels.filter((v) => !v.isDecoy).map((v) => ({ type: v.type, name: v.name, size: v.size, sunk: v.sunk })),
        sunk: theirs.vessels.filter((v) => v.sunk && !v.isDecoy).map((v) => ({ name: v.name, cells: v.cells, dir: v.dir })),
        reveal: revealAll ? { vessels: theirs.vessels.map(vesselOut), mines: [...theirs.mines] } : null,
      },
    };
  }
}
