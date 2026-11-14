// Visual effects: explosions, splashes, planes, torpedoes, scans, banners.
import { h, $ } from './ui.js';

const rowOf = (board, i) => Math.floor(i / board.size);
const colOf = (board, i) => i % board.size;

export function burst(board, idx, kind, delay = 0) {
  if (idx == null || idx < 0 || !board.size) return;
  const el = h('div', { class: `fx-burst fx-${kind}`, style: { animationDelay: `${delay}ms` } });
  board.effect(el, [idx], 1100 + delay);
}

export function cellFlash(board, cells, kind, stagger = 25) {
  cells.forEach((i, k) => burst(board, i, kind, k * stagger));
}

export function areaFlash(board, cells, kind) {
  if (!cells.length) return;
  board.effect(h('div', { class: `fx-area fx-area-${kind}` }), cells, 1200);
}

// A plane crossing a whole row ('h') or column ('v').
export function flyover(board, orient, r, c, icon, { shotDown = false } = {}) {
  const n = board.size;
  const cells = orient === 'v' ? Array.from({ length: n }, (_, k) => k * n + c) : Array.from({ length: n }, (_, k) => r * n + k);
  const mover = h('span', { class: `mover plane plane-${orient}` }, icon);
  const lane = h('div', { class: `fx-lane lane-${orient} ${shotDown ? 'shot-down' : ''}` }, mover);
  board.effect(lane, cells, 1700);
  if (shotDown) {
    const mid = cells[Math.floor(n / 2)];
    setTimeout(() => burst(board, mid, 'flak'), 650);
  }
}

// A torpedo travelling along a lane until it hits (or leaves the board).
export function torpedo(board, path, impact, dir) {
  if (!path.length) return;
  const n = board.size;
  const horizontal = dir === 'right' || dir === 'left';
  const r = rowOf(board, path[0]);
  const c = colOf(board, path[0]);
  const lane = horizontal ? Array.from({ length: n }, (_, k) => r * n + k) : Array.from({ length: n }, (_, k) => k * n + c);
  const end = impact != null ? impact : path[path.length - 1];
  const pos = horizontal ? colOf(board, end) : rowOf(board, end);
  const pct = ((pos + 0.5) / n) * 100;
  const startPct = dir === 'right' || dir === 'down' ? -6 : 106;
  const endPct = impact != null ? pct : (dir === 'right' || dir === 'down' ? 106 : -6);
  const mover = h('span', { class: `mover torp torp-${dir}` });
  const el = h('div', { class: `fx-lane lane-${horizontal ? 'h' : 'v'} torpedo-lane`, style: { '--from': `${startPct}%`, '--to': `${endPct}%` } }, mover);
  mover.style.setProperty('--from', `${startPct}%`);
  mover.style.setProperty('--to', `${endPct}%`);
  board.effect(el, lane, 1300);
}

export function scan(board, cells, item) {
  if (!cells.length) return;
  if (item === 'sonar') {
    board.effect(h('div', { class: 'fx-sonar' }, h('i'), h('i'), h('i')), cells, 1600);
    return;
  }
  cellFlash(board, cells, `scan-${item}`, item === 'recon' ? 40 : 30);
}

export function drop(board, idx) {
  board.effect(h('div', { class: 'fx-drop' }, h('span', {}, '🪂')), [idx], 1100);
}

export function missile(board, idx, icon) {
  board.effect(h('div', { class: 'fx-missile' }, h('span', {}, icon)), [idx], 700);
}

export function shake(el, big = false) {
  el.classList.remove('shake', 'shake-big');
  void el.offsetWidth;
  el.classList.add(big ? 'shake-big' : 'shake');
  setTimeout(() => el.classList.remove('shake', 'shake-big'), 700);
}

let bannerTimer = null;
export function banner(title, sub = '', tone = 'info', ms = 1500) {
  const el = $('#banner');
  el.className = `banner-${tone}`;
  el.textContent = '';
  el.append(h('div', { class: 'banner-title' }, title));
  if (sub) el.append(h('div', { class: 'banner-sub' }, sub));
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function floatEmote(anchor, emoji) {
  const rect = anchor.getBoundingClientRect();
  const el = h('div', { class: `float-emote ${emoji.length > 2 ? 'text' : ''}` }, emoji);
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height / 2}px`;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

export function confetti() {
  const colors = ['#38d6ff', '#ffd166', '#3ee08f', '#ff5d5d', '#b28dff', '#ffffff'];
  const layer = h('div', { class: 'confetti' });
  for (let k = 0; k < 90; k++) {
    layer.append(h('i', {
      style: {
        left: `${Math.random() * 100}%`,
        background: colors[k % colors.length],
        animationDelay: `${Math.random() * 0.8}s`,
        animationDuration: `${2.2 + Math.random() * 1.6}s`,
        transform: `rotate(${Math.random() * 360}deg)`,
      },
    }));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 4800);
}
