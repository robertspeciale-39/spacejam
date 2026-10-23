// Small shared helpers.

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
let lastTs = 0, seq = 0;

/** Time-ordered unique id (sorts by creation time, safe as a database key). */
export function newId(prefix = '') {
  const now = Date.now();
  seq = now === lastTs ? seq + 1 : 0;
  lastTs = now;
  let rnd = '';
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  for (const b of buf) rnd += ID_CHARS[b % ID_CHARS.length];
  return prefix + now.toString(36) + seq.toString(36).padStart(2, '0') + rnd;
}

// Join codes skip look-alike characters: 0/O, 1/I/L, 5/S, 2/Z.
const CODE_CHARS = 'ABCDEFGHJKMNPQRTUVWXY346789';
export function newJoinCode(len = 6) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function throttle(fn, ms) {
  let last = 0, timer = null, pending = null;
  const run = () => { last = Date.now(); timer = null; const a = pending; pending = null; fn(...a); };
  const t = (...args) => {
    pending = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) run();
    else if (!timer) timer = setTimeout(run, wait);
  };
  t.flush = () => { if (timer) { clearTimeout(timer); run(); } };
  return t;
}

export function debounce(fn, ms) {
  let timer = null;
  const d = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  d.cancel = () => clearTimeout(timer);
  return d;
}

export function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/** Firebase stores arrays as objects when sparse; always hand back a clean array. */
export function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(x => x != null);
  return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map(k => v[k]).filter(x => x != null);
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Stable categorical hue index 1..5 from a string (maps to --u1..--u5). */
export function hueIndex(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 5) + 1;
}

export function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(ts).toLocaleDateString();
}

export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function qs(name) { return new URLSearchParams(location.search).get(name); }

let toastTimer;
export function toast(msg, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = (kind === 'error' ? '⚠ ' : kind === 'ok' ? '✓ ' : '') + msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 5000 : 2600);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFilename(s) {
  return String(s || 'jam').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'jam';
}

/** Minimal accessible modal helper. Returns { open, close, el }. */
export function modal(id) {
  const el = document.getElementById(id);
  let lastFocus = null;
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function open() {
    lastFocus = document.activeElement;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', onKey, true);
    const f = el.querySelector('[autofocus], input, textarea, select, button');
    if (f) setTimeout(() => f.focus(), 30);
  }
  function close() {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKey, true);
    el.dispatchEvent(new Event('modal-close'));
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) close(); });
  return { el, open, close, isOpen: () => el.classList.contains('open') };
}
