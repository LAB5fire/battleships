// Small DOM helpers. All dynamic text goes through text nodes (never innerHTML).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function setChildren(el, ...children) {
  el.textContent = '';
  append(el, children);
  return el;
}

export const fmt = (n) => Number(n || 0).toLocaleString('en-US');

// ------------------------------------------------------------------ toasts

export function toast(text, tone = 'info', ms = 3400) {
  const root = $('#toasts');
  const el = h('div', { class: `toast toast-${tone}` }, text);
  root.append(el);
  while (root.children.length > 4) root.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// ------------------------------------------------------------------ modals

let openModals = [];

export function modal({ title, body, actions = [], className = '', dismissible = true, onClose } = {}) {
  const root = $('#modal-root');
  const box = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true' });
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.classList.remove('show');
    openModals = openModals.filter((m) => m !== api);
    setTimeout(() => backdrop.remove(), 200);
    onClose?.();
  };
  if (title) {
    box.append(h('div', { class: 'modal-head' },
      h('h2', {}, title),
      dismissible ? h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕') : null));
  }
  const content = h('div', { class: 'modal-body' });
  append(content, [body]);
  box.append(content);
  if (actions.length) {
    box.append(h('div', { class: 'modal-actions' }, actions.map((a) => h('button', {
      class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`,
      onclick: () => { if (a.onClick?.() !== false) close(); },
    }, a.label))));
  }
  if (dismissible) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  root.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  const api = { close, el: box, content, dismissible };
  openModals.push(api);
  return api;
}

export function closeTopModal() {
  const top = openModals.at(-1);
  if (top && top.dismissible) top.close();
  return Boolean(top);
}

export function confirmBox(text, okLabel = 'OK', { danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title: 'Are you sure?',
      body: h('p', {}, text),
      actions: [
        { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
        { label: okLabel, primary: !danger, danger, onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}
