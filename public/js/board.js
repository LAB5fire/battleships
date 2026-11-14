// A board grid. Cells, labels, overlays and effects are all explicitly placed
// grid items, so everything lines up at any size without measuring the DOM.
import { h } from './ui.js';
import { colLabel } from '/shared/geometry.js';

export class BoardView {
  constructor(kind) {
    this.kind = kind;
    this.el = h('div', { class: `board board-${kind}` });
    this.grid = h('div', { class: 'grid' });
    this.el.append(this.grid);
    this.size = 0;
    this.cells = [];
    this.base = [];
    this.content = [];
    this.marks = new Map();
    this.overlayEls = [];
    this.handlers = {};
    this.hoverIdx = -1;

    this.grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (cell) this.handlers.click?.(Number(cell.dataset.i), e);
    });
    this.grid.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const cell = e.target.closest('.cell');
      const i = cell ? Number(cell.dataset.i) : -1;
      if (i !== this.hoverIdx) {
        this.hoverIdx = i;
        this.handlers.hover?.(i, e);
      }
    });
    this.grid.addEventListener('pointerleave', () => {
      this.hoverIdx = -1;
      this.handlers.hover?.(-1);
    });
    this.grid.addEventListener('contextmenu', (e) => {
      if (!this.handlers.context) return;
      e.preventDefault();
      this.handlers.context(e);
    });
  }

  on(handlers) {
    Object.assign(this.handlers, handlers);
    return this;
  }

  setSize(size) {
    if (size === this.size) return;
    this.size = size;
    this.el.style.setProperty('--n', size);
    this.grid.textContent = '';
    this.grid.append(h('div', { class: 'corner', style: { gridRow: '1', gridColumn: '1' } }));
    for (let c = 0; c < size; c++) this.grid.append(h('div', { class: 'lbl lbl-col', style: { gridRow: '1', gridColumn: String(c + 2) } }, colLabel(c)));
    for (let r = 0; r < size; r++) this.grid.append(h('div', { class: 'lbl lbl-row', style: { gridRow: String(r + 2), gridColumn: '1' } }, String(r + 1)));
    this.cells = [];
    for (let i = 0; i < size * size; i++) {
      const r = Math.floor(i / size);
      const c = i % size;
      const cell = h('div', { class: 'cell', 'data-i': String(i), style: { gridRow: String(r + 2), gridColumn: String(c + 2) } });
      this.cells.push(cell);
      this.grid.append(cell);
    }
    this.base = new Array(size * size).fill('');
    this.content = new Array(size * size).fill('');
    this.marks = new Map();
    this.overlayEls = [];
    this.hoverIdx = -1;
  }

  applyClass(i) {
    const mark = this.marks.get(i);
    this.cells[i].className = `cell ${this.base[i]}${mark ? ` ${mark}` : ''}`;
  }

  paint(i, cls, content = '') {
    if (this.base[i] !== cls) {
      this.base[i] = cls;
      this.applyClass(i);
    }
    if (this.content[i] !== content) {
      this.content[i] = content;
      this.cells[i].textContent = content;
    }
  }

  // marks: Map(index -> extra class string), e.g. targeting previews
  setMarks(marks) {
    const touched = new Set([...this.marks.keys(), ...marks.keys()]);
    this.marks = marks;
    for (const i of touched) if (i >= 0 && i < this.cells.length) this.applyClass(i);
  }

  clearMarks() { this.setMarks(new Map()); }

  // Place an element over a rectangle of cells (inclusive bounds).
  place(el, r0, c0, r1 = r0, c1 = c0) {
    el.style.gridRow = `${r0 + 2} / ${r1 + 3}`;
    el.style.gridColumn = `${c0 + 2} / ${c1 + 3}`;
    this.grid.append(el);
    return el;
  }

  bounds(cells) {
    let r0 = Infinity; let c0 = Infinity; let r1 = -1; let c1 = -1;
    for (const i of cells) {
      const r = Math.floor(i / this.size);
      const c = i % this.size;
      r0 = Math.min(r0, r); r1 = Math.max(r1, r);
      c0 = Math.min(c0, c); c1 = Math.max(c1, c);
    }
    return { r0, c0, r1, c1 };
  }

  // overlays: [{ cells, cls, label }]
  setOverlays(list) {
    for (const el of this.overlayEls) el.remove();
    this.overlayEls = list.map((o) => {
      const b = this.bounds(o.cells);
      return this.place(h('div', { class: `ov ${o.cls}` }, o.label != null ? h('span', {}, o.label) : null), b.r0, b.c0, b.r1, b.c1);
    });
  }

  // A temporary effect element over some cells.
  effect(el, cells, ms = 1000) {
    const b = this.bounds(cells);
    el.classList.add('fx');
    this.place(el, b.r0, b.c0, b.r1, b.c1);
    setTimeout(() => el.remove(), ms);
    return el;
  }
}
