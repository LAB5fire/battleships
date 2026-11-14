// Per-tab identity (sessionStorage) + remembered preferences (localStorage).
// Storage can throw in private mode, so every access is guarded.

function get(store, key) {
  try { return window[store].getItem(key); } catch { return null; }
}
function set(store, key, value) {
  try {
    if (value == null) window[store].removeItem(key);
    else window[store].setItem(key, value);
  } catch { /* ignore */ }
}

export function randomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const session = {
  get pid() {
    let id = get('sessionStorage', 'ff_pid');
    if (!id) {
      id = `p${randomId()}`;
      set('sessionStorage', 'ff_pid', id);
    }
    return id;
  },
  set pid(v) { set('sessionStorage', 'ff_pid', v); },

  get room() { return get('sessionStorage', 'ff_room'); },
  set room(v) { set('sessionStorage', 'ff_room', v); },

  get name() { return get('localStorage', 'ff_name') || ''; },
  set name(v) { set('localStorage', 'ff_name', v); },

  get last() {
    try { return JSON.parse(get('localStorage', 'ff_last') || 'null'); } catch { return null; }
  },
  set last(v) { set('localStorage', 'ff_last', v ? JSON.stringify(v) : null); },

  get muted() { return get('localStorage', 'ff_muted') === '1'; },
  set muted(v) { set('localStorage', 'ff_muted', v ? '1' : null); },

  get settings() {
    try { return JSON.parse(get('localStorage', 'ff_settings') || 'null'); } catch { return null; }
  },
  set settings(v) { set('localStorage', 'ff_settings', v ? JSON.stringify(v) : null); },

  loadDraft(key) {
    try { return JSON.parse(get('sessionStorage', `ff_draft_${key}`) || 'null'); } catch { return null; }
  },
  saveDraft(key, draft) { set('sessionStorage', `ff_draft_${key}`, draft ? JSON.stringify(draft) : null); },
};
