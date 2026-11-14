// App controller: socket connection, screen switching, HUD, reconnects.
import { $, h, toast, setChildren, fmt, confirmBox, closeTopModal } from './ui.js';
import { session } from './session.js';
import { HomeView } from './home.js';
import { PrepView } from './prep.js';
import { BattleView } from './battle.js';
import { sfx, isMuted, setMuted } from './sound.js';
import * as fx from './fx.js';
import { openHelp } from './help.js';

// eslint-disable-next-line no-undef
const socket = io({ transports: ['websocket', 'polling'] });

const app = {
  state: null,
  clockOffset: 0,
  call(event, payload = {}) {
    return new Promise((resolve) => {
      if (!socket.connected) {
        resolve({ ok: false, error: 'Not connected to the server. Reconnecting…' });
        return;
      }
      socket.timeout(10000).emit(event, payload, (err, res) => {
        if (err) resolve({ ok: false, error: 'The server did not answer. Try again.' });
        else resolve(res || { ok: false, error: 'No answer from the server.' });
      });
    });
  },
  async leave() {
    await app.call('room:leave');
    exitToHome();
  },
};

const home = new HomeView(app);
const prep = new PrepView(app);
const battle = new BattleView(app);

function exitToHome(message, tone = 'warn') {
  session.room = null;
  app.state = null;
  history.replaceState(null, '', location.pathname);
  render();
  if (message) toast(message, tone, 6000);
}

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === `screen-${id}`);
}

function renderHud(st) {
  $('#hud-round').textContent = `Round ${st.roundNo} · Best of ${st.settings.bestOf}`;
  const pips = (wins) => h('span', { class: 'score-pips' }, Array.from({ length: st.roundsToWin }, (_, k) => h('i', { class: k < wins ? 'on' : '' })));
  setChildren($('#hud-score'),
    h('div', { class: 'score-side me' }, h('span', { class: 'score-name' }, st.me.name), pips(st.me.wins)),
    h('div', { class: 'score-num' }, `${st.me.wins} : ${st.opp?.wins ?? 0}`),
    h('div', { class: 'score-side opp' }, pips(st.opp?.wins ?? 0), h('span', { class: 'score-name' }, st.opp ? `${st.opp.name}${st.opp.connected ? '' : ' 🔌'}` : '…')));
  $('#hud-coins').textContent = `💰 ${fmt(st.me.coins)}`;
}

function render() {
  const st = app.state;
  if (!st) {
    showScreen('home');
    home.render();
    document.title = 'Fleet Fury — Battleships with an arsenal';
    return;
  }
  if (st.phase === 'lobby') {
    showScreen('lobby');
    home.renderLobby(st);
    document.title = `Room ${st.code} · Fleet Fury`;
    return;
  }
  showScreen('game');
  renderHud(st);
  const inPrep = st.phase === 'prep';
  $('#prep-view').hidden = !inPrep;
  $('#battle-view').hidden = inPrep;
  if (inPrep) prep.render(st);
  else battle.render(st);
  const yourTurn = st.phase === 'battle' && st.battle?.turn === 'me';
  document.title = `${yourTurn ? '🎯 Your turn · ' : ''}Fleet Fury`;
}

function onUpdate({ state, events = [] }) {
  const prev = app.state;
  app.state = state;
  app.clockOffset = state.now - Date.now();
  session.room = state.code;
  session.last = { code: state.code, pid: session.pid, t: Date.now() };
  render();

  if (prev?.phase === 'lobby' && state.phase === 'prep') {
    fx.banner('⚓ Opponent joined!', `${state.opp?.name} is here. Round 1: to the Armory!`, 'good', 2200);
    sfx('turn');
  }
  for (const e of events) {
    if (e.type === 'phase' && e.phase === 'prep' && prev?.phase !== 'lobby') {
      fx.banner(`ROUND ${e.roundNo}`, 'The Armory is open', 'info', 1600);
      sfx('coin');
    }
    if (e.type === 'chat' && e.seat !== state.seat) sfx('chat');
  }
  if (state.phase !== 'prep' && state.phase !== 'lobby') battle.play(events);
}

socket.on('connect', async () => {
  $('#offline').hidden = true;
  const code = session.room;
  if (!code) return;
  const res = await app.call('room:join', { code, name: session.name || 'Captain', playerId: session.pid });
  if (!res.ok) exitToHome(/not found/i.test(res.error) ? 'That room has closed.' : res.error);
});
socket.on('disconnect', () => {
  if (app.state) $('#offline').hidden = false;
});
socket.on('update', onUpdate);
socket.on('kicked', ({ reason }) => exitToHome(reason));
socket.on('roomClosed', ({ reason }) => {
  session.last = null;
  exitToHome(reason);
});
socket.on('emote', ({ seat, emoji }) => {
  const st = app.state;
  if (!st) return;
  const anchor = $(seat === st.seat ? '.score-side.me' : '.score-side.opp') || $('#hud-score');
  if (anchor) fx.floatEmote(anchor, emoji);
  if (seat !== st.seat) sfx('chat');
});

// ------------------------------------------------------------------ HUD buttons

function syncSoundBtn() { $('#sound-btn').textContent = isMuted() ? '🔇' : '🔊'; }
$('#sound-btn').addEventListener('click', () => {
  setMuted(!isMuted());
  syncSoundBtn();
  sfx('click');
});
syncSoundBtn();
$('#help-btn').addEventListener('click', () => openHelp());
$('#leave-btn').addEventListener('click', async () => {
  const inMatch = app.state && app.state.phase !== 'lobby';
  const ok = await confirmBox(inMatch ? 'Leaving closes the room and ends the match for both players.' : 'Close this room?', 'Leave', { danger: true });
  if (ok) app.leave();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTopModal();
});

// ------------------------------------------------------------------ timers

setInterval(() => battle.tick(Date.now() + app.clockOffset), 250);

// Free Render instances sleep after 15 min without HTTP traffic: ping while in a room.
setInterval(() => {
  if (app.state) fetch('/healthz', { cache: 'no-store' }).catch(() => {});
}, 4 * 60 * 1000);

render();
