// Teacher dashboard: my jams, assignments, live view of every copy.
import { getDb, LIVE } from './db.js';
import {
  P, createJam, duplicateJam, deleteJam, renameJam, createAssignment, deleteAssignment,
  setJoinOpen, regenerateCode
} from './jams.js';
import { paintThumb } from './render.js';
import { loadFonts } from './fonts.js';
import { I } from './icons.js';
import { esc, asArray, timeAgo, toast, modal, qs, clamp, debounce } from './util.js';
import { ask, menuItem, presentCode, demoBannerHTML, joinUrl } from './ui.js';

const $ = id => document.getElementById(id);
let db, uid;
const subs = [];           // detail-view listeners
const unsubAll = () => { while (subs.length) { try { subs.pop()(); } catch {} } };

(async function boot() {
  $('signOut').innerHTML = I.signout;
  try { db = await getDb(); } catch { $('gate').hidden = false; return; }
  if (!db.user || db.user.isAnonymous || !(await db.isTeacher())) { $('gate').hidden = false; return; }
  uid = db.user.uid;
  $('who').textContent = (db.user.displayName || db.user.email || 'Teacher').toUpperCase();
  $('demoBanner').innerHTML = demoBannerHTML();
  $('dash').hidden = false;
  $('signOut').onclick = async () => { await db.signOut(); location.href = './'; };
  $('newJam').onclick = newJam;
  $('tabJams').onclick = () => showTab('jams');
  $('tabAssign').onclick = () => showTab('assign');
  $('backToList').onclick = () => { history.pushState({}, '', 'dashboard.html'); route(); };
  window.addEventListener('popstate', route);
  document.addEventListener('click', e => { if (!$('cardMenu').contains(e.target)) $('cardMenu').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('cardMenu').hidden = true; });
  db.on(P.ownerJams(uid), renderJams);
  db.on(P.teacherAssignments(uid), renderAssignments);
  route();
})();

function route() {
  unsubAll();
  const a = qs('a');
  $('listView').hidden = !!a;
  $('detailView').hidden = !a;
  if (a) openDetail(a);
  else showTab(sessionStorage.getItem('sj_dash_tab') || 'jams');
}
function showTab(t) {
  sessionStorage.setItem('sj_dash_tab', t);
  $('tabJams').setAttribute('aria-selected', String(t === 'jams'));
  $('tabAssign').setAttribute('aria-selected', String(t === 'assign'));
  $('paneJams').hidden = t !== 'jams';
  $('paneAssign').hidden = t !== 'assign';
}

function popCardMenu(anchor, items) {
  const m = $('cardMenu'), list = $('cardMenuList');
  list.innerHTML = '';
  items.forEach(i => list.appendChild(i));
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.right - 240, innerWidth - 256)) + 'px';
  m.style.top = Math.min(r.bottom + 6, innerHeight - 320) + 'px';
  m.hidden = false;
  list.onclick = e => { if (e.target.closest('.menu-item')) m.hidden = true; };
  list.querySelector('button')?.focus();
}

async function paintJamThumb(canvas, jamId, frameIdx = 0) {
  const jam = await db.get(P.jam(jamId)).catch(() => null);
  if (!jam) return null;
  const order = asArray(jam.frameOrder);
  const f = jam.frames?.[order[Math.min(frameIdx, order.length - 1)]];
  await fontsFor([f]);
  paintThumb(canvas, f);
  return jam;
}
function fontsFor(frames) {
  const names = [];
  for (const f of frames) for (const o of Object.values(f?.objects || {})) {
    if (o.type === 'sticky') names.push(o.font || 'Patrick Hand');
    if (o.type === 'text') names.push(o.font || 'Inter');
  }
  return names.length ? loadFonts(names) : Promise.resolve();
}

// ── my jams ───────────────────────────────────────────────────
async function newJam() {
  const title = await ask({ title: 'New jam', message: 'Give it a name. You can change it later.', value: 'Untitled jam' });
  if (!title) return;
  const id = await createJam(db, { title });
  location.href = `board.html?jam=${id}`;
}

function renderJams(v) {
  const grid = $('jamGrid');
  const ids = Object.keys(v || {}).sort((a, b) => (v[b].createdAt || 0) - (v[a].createdAt || 0));
  if (!ids.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><p style="margin-bottom:var(--sp-4)">No jams yet. Create one, build your activity, then assign it to students.</p><button class="btn" id="emptyNew">+ New jam</button></div>`;
    $('emptyNew').onclick = newJam;
    return;
  }
  grid.innerHTML = ids.map(id => `
    <article class="jam-card" data-id="${id}">
      <a class="thumb-btn" href="board.html?jam=${id}" aria-label="Open ${esc(v[id].title)}"><canvas class="thumb"></canvas></a>
      <div class="jam-card-body">
        <div><div class="jam-card-title">${esc(v[id].title || 'Untitled jam')}</div><div class="jam-card-meta" data-meta>…</div></div>
        <button class="icon-btn" data-menu aria-label="Options for ${esc(v[id].title)}">${I.more}</button>
      </div>
    </article>`).join('');
  grid.querySelectorAll('.jam-card').forEach(card => {
    const id = card.dataset.id;
    paintJamThumb(card.querySelector('canvas'), id).then(jam => {
      if (jam) card.querySelector('[data-meta]').textContent = `${asArray(jam.frameOrder).length} frames · edited ${timeAgo(jam.touched)}`;
    });
    card.querySelector('[data-menu]').onclick = e => {
      e.stopPropagation();
      popCardMenu(e.currentTarget, [
        menuItem(I.open, 'Open', () => { location.href = `board.html?jam=${id}`; }),
        menuItem(I.share, 'Assign to students…', () => openAssign(id, v[id].title)),
        menuItem(I.edit, 'Rename', async () => {
          const t = await ask({ title: 'Rename jam', value: v[id].title });
          if (t) renameJam(db, id, t, {});
        }),
        menuItem(I.copy, 'Duplicate', async () => { await duplicateJam(db, id); toast('Duplicated', 'ok'); }),
        menuItem(I.trash, 'Delete', async () => {
          const ok = await ask({ title: `Delete “${v[id].title}”?`, message: 'This removes the jam and its version history. Assignments already started from it keep their copies.', input: false, ok: 'Delete', danger: true });
          if (ok) { await deleteJam(db, id); toast('Deleted', 'ok'); }
        }, { danger: true })
      ]);
    };
  });
}

// ── assign dialog ─────────────────────────────────────────────
let assignM;
function openAssign(jamId, title) {
  assignM ||= modal('assignModal');
  const card = $('assignCard');
  card.innerHTML = `
    <div class="modal-title" id="amTitle">Assign to students</div>
    <p class="hint" style="margin-bottom:var(--sp-4)">Students work on copies, so this jam stays clean as your template.</p>
    <div class="field-row"><label class="field-label" for="amName">Assignment title</label><input id="amName" class="field" maxlength="80" value="${esc(title || '')}"></div>
    <div class="field-row"><span class="field-label">How should students work?</span>
      <div class="mode-list" role="radiogroup">
        <label class="mode-opt"><input type="radio" name="amMode" value="class" checked><div><b>Whole class</b><span>Everyone works together on one shared copy.</span></div></label>
        <label class="mode-opt"><input type="radio" name="amMode" value="individual"><div><b>Individual</b><span>Each student gets their own copy, named after them.</span></div></label>
        <label class="mode-opt"><input type="radio" name="amMode" value="groups"><div><b>Groups</b><span>Students pick a group number when they join.</span></div></label>
      </div></div>
    <div class="field-row" id="amGrpRow" hidden><label class="field-label" for="amGroups">Number of groups</label><input id="amGroups" type="number" class="field" min="2" max="12" value="4" style="max-width:120px"></div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="amStart">Start &amp; get code</button></div>`;
  card.querySelectorAll('input[name="amMode"]').forEach(r => r.onchange = () => { $('amGrpRow').hidden = card.querySelector('input[name="amMode"]:checked').value !== 'groups'; });
  $('amStart').onclick = async () => {
    $('amStart').disabled = true;
    try {
      const mode = card.querySelector('input[name="amMode"]:checked').value;
      const { aid } = await createAssignment(db, jamId, {
        title: $('amName').value.trim() || title, mode, groupCount: clamp(Number($('amGroups').value) || 4, 2, 12)
      });
      assignM.close();
      history.pushState({}, '', `dashboard.html?a=${aid}`);
      route();
    } catch (e) { console.error(e); toast('Could not start the assignment.', 'error'); $('amStart').disabled = false; }
  };
  assignM.open();
}

// ── assignments list ──────────────────────────────────────────
const MODE_LABEL = { class: 'Whole class', individual: 'Individual', groups: 'Groups' };
async function renderAssignments(v) {
  const box = $('assignList');
  const ids = Object.keys(v || {}).sort((a, b) => (v[b].createdAt || 0) - (v[a].createdAt || 0));
  if (!ids.length) {
    box.innerHTML = `<div class="empty"><p>No assignments yet. Open a jam's ⋮ menu and choose <b>Assign to students</b>.</p></div>`;
    return;
  }
  box.innerHTML = ids.map(id => `<button class="assign-row" data-a="${id}"><div class="grow"><div class="row-title">${esc(v[id].title)}</div><div class="row-meta" data-m>Loading…</div></div><span class="code-pill" data-code>······</span><span class="status-pill" data-st></span></button>`).join('');
  box.querySelectorAll('[data-a]').forEach(async row => {
    const aid = row.dataset.a;
    row.onclick = () => { history.pushState({}, '', `dashboard.html?a=${aid}`); route(); };
    const [info, copies] = await Promise.all([db.get(`${P.assignment(aid)}/info`), db.get(`${P.assignment(aid)}/copies`)]);
    if (!info) { row.querySelector('[data-m]').textContent = 'Missing'; return; }
    const code = info.code ? await db.get(P.code(info.code)) : null;
    const n = Object.keys(copies || {}).length;
    row.querySelector('[data-m]').textContent = `${MODE_LABEL[info.mode]} · ${n} ${info.mode === 'individual' ? (n === 1 ? 'student' : 'students') : (n === 1 ? 'copy' : 'copies')} · started ${timeAgo(info.createdAt)}`;
    row.querySelector('[data-code]').textContent = info.code || '—';
    const st = row.querySelector('[data-st]');
    st.className = 'status-pill ' + (code?.open ? 'open' : 'closed');
    st.textContent = code?.open ? 'OPEN' : 'CLOSED';
  });
}

// ── assignment detail: live view of every copy ────────────────
function openDetail(aid) {
  let info = null, codeOpen = false, copies = {}, frameIdx = 0, maxFrames = 1;
  const jams = {}, pres = {};
  const grid = $('copyGrid');

  subs.push(db.on(`${P.assignment(aid)}/info`, v => {
    if (!v) { grid.innerHTML = '<div class="empty">This assignment was deleted.</div>'; return; }
    const codeChanged = !info || info.code !== v.code;
    info = v;
    $('dTitle').textContent = v.title;
    $('dCode').textContent = v.code;
    $('dMode').textContent = v.mode === 'individual'
      ? `Individual · each student gets their own copy when they join at ${joinUrl().replace(/^https?:\/\//, '')}`
      : v.mode === 'groups' ? `Groups · ${v.groupCount} group copies` : 'Whole class · one shared copy';
    document.title = `${v.title} · SpaceJam`;
    if (codeChanged) subs.push(db.on(P.code(v.code), c => { codeOpen = !!c?.open; renderStatus(); }));
  }));
  subs.push(db.on(`${P.assignment(aid)}/copies`, v => { copies = v || {}; syncCopies(); }));

  function renderStatus() {
    const st = $('dStatus');
    st.className = 'status-pill ' + (codeOpen ? 'open' : 'closed');
    st.textContent = codeOpen ? 'JOINING OPEN' : 'JOINING CLOSED';
    $('dToggleOpen').textContent = codeOpen ? 'Close joining' : 'Open joining';
  }

  function syncCopies() {
    const ids = Object.keys(copies).sort((a, b) => {
      const ca = copies[a], cb = copies[b];
      return (ca.group || 0) - (cb.group || 0) || String(ca.label).localeCompare(String(cb.label));
    });
    if (!ids.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Waiting for students to join with code <b>${esc(info?.code || '')}</b>…</div>`;
      return;
    }
    grid.querySelector('.empty')?.remove();
    for (const id of ids) {
      if (grid.querySelector(`[data-id="${id}"]`)) continue;
      const card = document.createElement('article');
      card.className = 'jam-card';
      card.dataset.id = id;
      card.innerHTML = `
        <a class="thumb-btn" href="board.html?jam=${id}" target="_blank" rel="noopener" aria-label="Open ${esc(copies[id].label)} in a new tab"><canvas class="thumb"></canvas></a>
        <div class="jam-card-body"><div><div class="jam-card-title">${esc(copies[id].label)}</div><div class="jam-card-meta" data-meta></div></div>
        <a class="icon-btn" href="board.html?jam=${id}" target="_blank" rel="noopener" aria-label="Open in new tab" title="Open in new tab">${I.open}</a></div>`;
      grid.appendChild(card);
      subs.push(db.on(P.jam(id), v => { jams[id] = v; paintCard(id); updateFrameSelect(); }));
      subs.push(db.on(P.presence(id), v => { pres[id] = v || {}; paintMeta(id); }));
    }
    // order cards
    ids.forEach(id => grid.appendChild(grid.querySelector(`[data-id="${id}"]`)));
    grid.querySelectorAll('.jam-card').forEach(c => { if (!copies[c.dataset.id]) c.remove(); });
  }
  const painters = {};
  function paintCard(id) {
    painters[id] ||= debounce(async () => {
      const jam = jams[id];
      const card = grid.querySelector(`[data-id="${id}"]`);
      if (!jam || !card) return;
      const order = asArray(jam.frameOrder);
      const f = jam.frames?.[order[Math.min(frameIdx, order.length - 1)]];
      await fontsFor([f]);
      paintThumb(card.querySelector('canvas'), f);
      paintMeta(id);
    }, 500);
    painters[id]();
  }
  function paintMeta(id) {
    const card = grid.querySelector(`[data-id="${id}"]`);
    const jam = jams[id];
    if (!card || !jam) return;
    const online = Object.values(pres[id] || {}).filter(p => p.role !== 'teacher').length;
    const nMem = Object.keys(jam.members || {}).length;
    card.querySelector('[data-meta]').innerHTML =
      `${online ? `<span class="online-dot">${online} online</span> · ` : ''}${nMem} joined · ${asArray(jam.frameOrder).length} frames · ${timeAgo(jam.touched)}${jam.meta?.locked ? ' · 🔒 locked' : ''}`;
  }
  function updateFrameSelect() {
    const m = Math.max(1, ...Object.values(jams).map(j => asArray(j?.frameOrder).length));
    if (m === maxFrames && $('dFrame').options.length) return;
    maxFrames = m;
    $('dFrame').innerHTML = Array.from({ length: m }, (_, i) => `<option value="${i}"${i === frameIdx ? ' selected' : ''}>${i + 1}</option>`).join('');
  }
  $('dFrame').onchange = () => { frameIdx = Number($('dFrame').value); Object.keys(jams).forEach(paintCard); };
  const tick = setInterval(() => Object.keys(jams).forEach(paintMeta), 30000);
  subs.push(() => clearInterval(tick));

  $('dPresent').onclick = () => info && presentCode(info.code, info.title);
  $('dToggleOpen').onclick = () => info && setJoinOpen(db, aid, info.code, !codeOpen);
  $('dNewCode').onclick = async () => {
    const ok = await ask({ title: 'Make a new join code?', message: 'The old code stops working. Students already in stay.', input: false, ok: 'New code' });
    if (ok && info) { const c = await regenerateCode(db, aid, info.code); toast(`New code: ${c}`, 'ok'); }
  };
  const lockAll = async v => {
    const m = {};
    Object.keys(copies).forEach(id => { m[`${P.meta(id)}/locked`] = v; });
    if (Object.keys(m).length) { await db.update(m); toast(v ? 'All copies locked (view only)' : 'All copies unlocked', 'ok'); }
  };
  $('dLockAll').onclick = () => lockAll(true);
  $('dUnlockAll').onclick = () => lockAll(false);
  $('dDelete').onclick = async () => {
    const ok = await ask({ title: 'Delete this assignment?', message: 'All student and group copies are deleted and the code stops working. Your original jam is not affected. Export anything you want to keep first.', input: false, ok: 'Delete', danger: true });
    if (!ok) return;
    unsubAll();
    await deleteAssignment(db, aid);
    toast('Assignment deleted', 'ok');
    history.pushState({}, '', 'dashboard.html');
    route();
    showTab('assign');
  };
}
