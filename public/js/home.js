// Home screen (create / join) and the lobby while waiting for an opponent.
import { h, $, toast, copyText, setChildren, confirmBox } from './ui.js';
import { BEST_OF_OPTIONS, BOARD_SIZES, COIN_OPTIONS, TIMER_OPTIONS, DEFAULT_SETTINGS, sanitizeSettings } from '/shared/config.js';
import { session } from './session.js';
import { openHelp } from './help.js';
import { sfx } from './sound.js';

const SETTING_DEFS = [
  { key: 'bestOf', label: 'Match', options: BEST_OF_OPTIONS, fmt: (v) => `Best of ${v}` },
  { key: 'boardSize', label: 'Board', options: BOARD_SIZES, fmt: (v) => `${v}×${v}` },
  { key: 'startingCoins', label: 'Starting coins', options: COIN_OPTIONS, fmt: (v) => `${v}` },
  { key: 'turnTimer', label: 'Turn timer', options: TIMER_OPTIONS, fmt: (v) => (v ? `${v}s` : 'Off') },
];

export function settingsChips(settings) {
  return SETTING_DEFS.map((d) => h('span', { class: 'chip' }, `${d.label}: `, h('b', {}, d.fmt(settings[d.key]))));
}

export class HomeView {
  constructor(app) {
    this.app = app;
    this.settings = sanitizeSettings(session.settings || DEFAULT_SETTINGS);
    this.nameInput = $('#name-input');
    this.codeInput = $('#code-input');
    this.nameInput.value = session.name;
    this.nameInput.addEventListener('input', () => { session.name = this.nameInput.value.trim(); });

    const params = new URLSearchParams(location.search);
    const invite = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (invite) {
      this.codeInput.value = invite;
      this.codeInput.closest('.card').classList.add('highlight');
    }
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    });
    this.codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.join(); });
    $('#create-btn').addEventListener('click', () => this.create());
    $('#join-btn').addEventListener('click', () => this.join());
    $('#howto-btn').addEventListener('click', () => openHelp());
    this.buildSettings();

    // lobby
    $('#copy-code').addEventListener('click', async () => {
      if (await copyText(this.app.state?.code || '')) toast('Room code copied!', 'good');
    });
    $('#copy-link').addEventListener('click', () => this.shareLink());
    $('#lobby-leave').addEventListener('click', async () => {
      if (await confirmBox('Close this room?', 'Leave')) this.app.leave();
    });
  }

  buildSettings() {
    const form = $('#settings-form');
    setChildren(form, SETTING_DEFS.map((d) => h('div', { class: 'setting' },
      h('span', { class: 'setting-label' }, d.label),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': d.label }, d.options.map((v) => h('button', {
        class: `seg-btn ${this.settings[d.key] === v ? 'active' : ''}`,
        role: 'radio',
        'aria-checked': String(this.settings[d.key] === v),
        onclick: () => {
          this.settings[d.key] = v;
          session.settings = this.settings;
          sfx('click');
          this.buildSettings();
        },
      }, d.fmt(v)))))));
  }

  readName() {
    const name = this.nameInput.value.trim();
    if (!name) {
      toast('Pick a captain name first.', 'warn');
      this.nameInput.focus();
      return null;
    }
    session.name = name;
    return name;
  }

  async create() {
    const name = this.readName();
    if (!name) return;
    const btn = $('#create-btn');
    btn.disabled = true;
    const res = await this.app.call('room:create', { name, playerId: session.pid, settings: this.settings });
    btn.disabled = false;
    if (!res.ok) toast(res.error, 'bad');
  }

  async join(code = this.codeInput.value, pid = null) {
    const name = this.readName();
    if (!name) return;
    if (!code || code.length < 5) {
      toast('Enter the 5-letter room code.', 'warn');
      this.codeInput.focus();
      return;
    }
    if (pid) session.pid = pid;
    const btn = $('#join-btn');
    btn.disabled = true;
    const res = await this.app.call('room:join', { code, name, playerId: session.pid });
    btn.disabled = false;
    if (!res.ok) toast(res.error, 'bad');
  }

  render() {
    const last = session.last;
    const slot = $('#rejoin-slot');
    if (last && last.code && Date.now() - last.t < 3 * 60 * 60 * 1000) {
      setChildren(slot, h('button', { class: 'btn btn-rejoin', onclick: () => this.join(last.code, last.pid) }, `↩ Rejoin room ${last.code}`));
    } else {
      setChildren(slot);
    }
  }

  async shareLink() {
    const code = this.app.state?.code;
    if (!code) return;
    const url = `${location.origin}/?room=${code}`;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: 'Fleet Fury', text: `Join my Fleet Fury battle! Room code: ${code}`, url });
        return;
      } catch { /* fall back to copy */ }
    }
    if (await copyText(url)) toast('Invite link copied! Send it to your friend.', 'good');
    else toast(url, 'info', 8000);
  }

  renderLobby(st) {
    $('#lobby-code').textContent = st.code;
    setChildren($('#lobby-settings'), settingsChips(st.settings));
  }
}
