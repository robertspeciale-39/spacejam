// Shared UI helpers: prompt/confirm dialog, menus, present-code overlay, shell bits.
import { modal } from './util.js';
import { LIVE } from './db.js';

let askM = null;
/** Prompt for text (input shown) or confirm (input:false). Resolves value / true, or null if cancelled. */
export function ask({ title, message = '', value = '', input = true, ok = 'OK', danger = false }) {
  const el = document.getElementById('askModal');
  if (!el) return Promise.resolve(input ? window.prompt(title, value) : window.confirm(title));
  if (!askM) askM = modal('askModal');
  const inp = document.getElementById('askInput');
  const okBtn = document.getElementById('askOk');
  document.getElementById('askTitle').textContent = title;
  document.getElementById('askMsg').textContent = message;
  document.getElementById('askMsg').hidden = !message;
  inp.hidden = !input;
  inp.value = value;
  okBtn.textContent = ok;
  okBtn.classList.toggle('btn-danger', danger);
  return new Promise(resolve => {
    let done = false;
    const finish = v => {
      if (done) return; done = true;
      okBtn.onclick = null; inp.onkeydown = null;
      resolve(v);
    };
    okBtn.onclick = () => { const v = input ? inp.value.trim() : true; finish(input && !v ? null : v); askM.close(); };
    inp.onkeydown = e => { if (e.key === 'Enter') okBtn.click(); };
    el.addEventListener('modal-close', () => finish(null), { once: true });
    askM.open();
    if (input) setTimeout(() => { inp.focus(); inp.select(); }, 40);
    else setTimeout(() => okBtn.focus(), 40);
  });
}

/** Wire a button to toggle a dropdown menu; closes on outside click / Escape. */
export function wireMenu(btn, menu, onOpen) {
  const close = () => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = !menu.classList.contains('open');
    document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
    if (open) {
      onOpen && onOpen();
      menu.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      const first = menu.querySelector('button:not(:disabled)');
      first && first.focus({ preventScroll: true });
    } else close();
  });
  document.addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== btn) close(); });
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { close(); btn.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...menu.querySelectorAll('button:not(:disabled)')];
      const i = items.indexOf(document.activeElement);
      const n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      n && n.focus(); e.preventDefault();
    }
  });
  menu.addEventListener('click', e => { if (e.target.closest('.menu-item')) close(); });
  return close;
}

export function menuItem(icon, label, action, opts = {}) {
  const b = document.createElement('button');
  b.className = 'menu-item' + (opts.danger ? ' danger' : '');
  b.setAttribute('role', 'menuitem');
  b.innerHTML = `${icon || ''}<span>${label}</span>`;
  if (opts.disabled) b.disabled = true;
  b.addEventListener('click', action);
  return b;
}

export function joinUrl() {
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

/** Full-screen join code for the projector. */
export function presentCode(code, title) {
  const el = document.getElementById('present');
  if (!el) return;
  document.getElementById('presentTitle').textContent = title || 'Join the jam';
  document.getElementById('presentUrl').textContent = joinUrl().replace(/^https?:\/\//, '');
  document.getElementById('presentCode').textContent = code;
  el.classList.add('open');
  const close = () => { el.classList.remove('open'); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  document.getElementById('presentClose').onclick = close;
  document.getElementById('presentClose').focus();
}

export function demoBannerHTML() {
  if (LIVE) return '';
  return `<div class="demo-banner" role="note"><strong>LOCAL DEMO MODE</strong><span>Firebase isn't configured yet, so jams are saved in this browser only and sync between tabs on this computer. Add your Firebase settings to <code>js/firebase-config.js</code> to go live for students.</span></div>`;
}
