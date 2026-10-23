// SpaceJam board controller.
import { getDb, LIVE } from './db.js';
import { P, renameJam, createAssignment, jamToSnapshot, setJoinOpen, regenerateCode } from './jams.js';
import * as M from './model.js';
import {
  objectInnerSVG, objectTransform, backgroundSVG, SVG_DEFS, strokeGeometry, paintThumb, renderFrameCanvas, preloadImages
} from './render.js';
import { layoutText, TEXT_PAD, fontStr } from './textfit.js';
import { loadFont, loadFonts, loadPreviews, fontOptionsHTML, onFontsChanged, fontsVersion } from './fonts.js';
import { exportPDF, exportPNG } from './export.js';
import { I } from './icons.js';
import { newId, esc, clamp, clone, asArray, initials, hueIndex, qs, toast, modal, fmtDateTime, debounce } from './util.js';
import { ask, wireMenu, menuItem, presentCode, joinUrl } from './ui.js';

const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const svg = $('board'), bgLayer = $('bgLayer'), objLayer = $('objLayer'), liveLayer = $('liveLayer'),
  selLayer = $('selLayer'), laserLayer = $('laserLayer'), stage = $('stage'), paper = $('paper'),
  stageWrap = $('stageWrap'), ta = $('textEditor');

// ── state ─────────────────────────────────────────────────────
let db, uid, jamId = qs('jam');
let jam = null, meta = {}, order = [], members = {};
let cur = null, isOwner = false, myName = 'Someone';
let started = false;
let tool = 'select', tempSelect = false;
let sel = new Set();
const overrides = new Map();            // oid → { fid, obj|null }  (local, uncommitted view)
const objEls = new Map();               // oid → { g, sig }
let bgSig = '';
let drag = null;
let editing = null;                     // inline text edit { oid, isNew, start }
let zoom = 1, scale = 1;
const undoStack = [], redoStack = [];
let presence = {}, following = false;
let assignmentInfo = null;

const opts = {
  pen: 'pen', penColor: M.INK_COLORS[0].hex,
  shapeKind: 'rect', shapeFill: 'none', shapeStroke: '#202124', shapeSw: 4,
  noteColor: 'yellow', noteFont: M.DEFAULT_NOTE_FONT,
  textFont: M.DEFAULT_TEXT_FONT, textSize: 36, textColor: '#202124', bold: false, italic: false, align: 'left'
};
try { Object.assign(opts, JSON.parse(localStorage.getItem('sj_tool_opts') || '{}')); } catch {}
const saveOpts = debounce(() => { try { localStorage.setItem('sj_tool_opts', JSON.stringify(opts)); } catch {} }, 400);

// ── boot ──────────────────────────────────────────────────────
function gate(title, msg, showHome = true) {
  $('app').hidden = true;
  $('gate').hidden = false;
  $('gateTitle').textContent = title;
  $('gateMsg').textContent = msg;
  $('gateBtn').hidden = !showHome;
}

(async function boot() {
  if (!jamId) return gate('No jam selected', 'Open a jam from the dashboard, or join one with a code.');
  try { db = await getDb(); } catch (e) {
    console.error(e);
    return gate('Could not connect', 'SpaceJam could not reach its database. Check your internet connection and refresh.');
  }
  if (!db.user) await db.signInAnon();
  uid = db.user.uid;
  db.on(P.jam(jamId), onJam, () => gate("You can't open this jam",
    "You haven't joined it, you were removed, or it was deleted. Ask your teacher for the join code."));
})();

function onJam(v) {
  if (!v || !v.meta) {
    if (started) return gate('This jam was deleted', 'Ask your teacher for a new join code.');
    return gate('Jam not found', 'It may have been deleted. Check the link or ask your teacher.');
  }
  jam = v; meta = v.meta; order = asArray(v.frameOrder); members = v.members || {};
  isOwner = meta.ownerUid === uid;
  if (!isOwner && !members[uid]) {
    return gate("You haven't joined this jam", 'Go to the SpaceJam home page and enter the join code from your teacher.');
  }
  myName = isOwner ? (db.user.displayName || 'Teacher') : members[uid].name;
  if (!cur || !order.includes(cur)) {
    const prevIdx = cur ? Math.max(0, Math.min(order.length - 1, lastIdx)) : 0;
    cur = order[prevIdx] || order[0];
    resetFrameView();
  }
  if (!started) { started = true; init(); }
  // drop selection of objects that vanished remotely
  const objs = frameObjects(cur);
  for (const id of [...sel]) if (!objs[id]) sel.delete(id);
  preloadFontsFor(cur);
  updateChrome();
  requestRender();
  stripDirty();
}
let lastIdx = 0;

// ── helpers ───────────────────────────────────────────────────
const frameData = fid => (jam?.frames?.[fid]) || { bg: { type: 'blank' } };
const remoteObjects = fid => frameData(fid).objects || {};
function frameObjects(fid) {
  const base = remoteObjects(fid);
  if (!overrides.size) return base;
  const out = { ...base };
  for (const [id, ov] of overrides) {
    if (ov.fid !== fid) continue;
    if (ov.obj) out[id] = ov.obj; else delete out[id];
  }
  return out;
}
const objById = id => { const o = frameObjects(cur)[id]; return o ? { ...o, id } : null; };
const selectedObjects = () => [...sel].map(objById).filter(Boolean);

const canEdit = () => isOwner || (!meta.locked && !!members[uid]);
const canClear = () => isOwner || !!meta.studentsCanClear;
const canTouch = o => isOwner || !o.lockedByTeacher;
const canDelete = o => isOwner || !!meta.studentsCanClear || o.authorUid === uid || o.type === 'stroke';

function authorFields() {
  const now = Date.now();
  return { authorUid: uid, authorName: myName, createdAt: now, updatedAt: now };
}
function nextZ() { return M.maxZ(frameObjects(cur)) + 1; }
function strip(o) { if (!o) return null; const { id, ...rest } = o; return rest; }

function objChanges(fid, oid, before, after) {
  const base = P.obj(jamId, fid, oid);
  before = strip(before); after = strip(after);
  if (!before || !after) return [{ path: base, before, after }];
  const out = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      out.push({ path: `${base}/${k}`, before: before[k] ?? null, after: after[k] ?? null });
    }
  }
  return out;
}

function writeMap(map) {
  map[P.touched(jamId)] = Date.now();
  return db.update(map).catch(e => {
    console.error(e);
    toast(meta.locked && !isOwner ? 'This jam is locked by your teacher.' : "That change wasn't allowed or didn't save.", 'error');
  });
}
function applyChanges(changes, which) {
  const map = {};
  for (const c of changes) {
    // never resurrect half an object: skip field writes to objects that no longer exist
    const m = c.path.match(/^jams\/[^/]+\/frames\/([^/]+)\/objects\/([^/]+)\/.+$/);
    if (m && !jam?.frames?.[m[1]]?.objects?.[m[2]]) continue;
    map[c.path] = c[which];
  }
  if (Object.keys(map).length) writeMap(map);
}
function commit(changes) {
  if (!changes.length) return;
  applyChanges(changes, 'after');
  undoStack.push(changes);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
function undo() {
  if (!canEdit()) return;
  const c = undoStack.pop(); if (!c) return;
  applyChanges(c, 'before'); redoStack.push(c);
  followFrameOf(c); updateUndoButtons();
}
function redo() {
  if (!canEdit()) return;
  const c = redoStack.pop(); if (!c) return;
  applyChanges(c, 'after'); undoStack.push(c);
  followFrameOf(c); updateUndoButtons();
}
function followFrameOf(changes) {
  const m = changes[0]?.path.match(/frames\/([^/]+)/);
  if (m && m[1] !== cur && order.includes(m[1])) goToFrame(m[1]);
}
function createObj(obj, oid = newId('o')) {
  commit(objChanges(cur, oid, null, obj));
  return oid;
}

// ── init (once) ───────────────────────────────────────────────
function init() {
  $('gate').hidden = true;
  $('app').hidden = false;
  document.title = `${meta.title || 'Jam'} · SpaceJam`;
  buildToolbar();
  setupChrome();
  setupPointer();
  setupKeys();
  setupClipboardAndDrop();
  setupNoteModal();
  setupBackground();
  setupPresence();
  setupLaser();
  setupVersions();
  onFontsChanged(() => requestRender());
  new ResizeObserver(() => layout()).observe(stage);
  stage.addEventListener('scroll', () => { if (editing) positionEditor(); positionObjMenuBtn(); });
  stage.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  layout();
  if (LIVE) db.onConnection(on => {
    const c = $('connState');
    c.textContent = on ? '' : 'OFFLINE · RECONNECTING';
    c.className = 'conn' + (on ? '' : ' off');
  }); else { $('connState').textContent = 'LOCAL DEMO'; $('connState').className = 'conn local'; }
  setInterval(() => maybeAutoVersion(), 60 * 1000);
  setTimeout(() => maybeAutoVersion(), 15 * 1000);
}

// ── chrome: title, frames, menus ──────────────────────────────
function setupChrome() {
  $('prevFrame').innerHTML = I.left;
  $('nextFrame').innerHTML = I.right;
  $('moreBtn').innerHTML = I.more;
  $('themeBtn').innerHTML = I.palette;
  $('bgBtn').innerHTML = I.background;
  $('zoomIn').innerHTML = I.plus;
  $('zoomOut').innerHTML = I.minus;
  $('objMenuBtn').innerHTML = I.more;
  $('prevFrame').onclick = () => stepFrame(-1);
  $('nextFrame').onclick = () => stepFrame(1);
  $('frameCounter').onclick = toggleStrip;
  $('zoomIn').onclick = () => setZoom(zoom * 1.25);
  $('zoomOut').onclick = () => setZoom(zoom / 1.25);
  $('zoomLabel').onclick = () => setZoom(1);
  wireMenu($('themeBtn'), $('themeMenu'));
  wireMenu($('moreBtn'), $('moreMenu'), buildMoreMenu);
  const title = $('jamTitle');
  title.addEventListener('change', () => {
    const t = title.value.trim() || 'Untitled jam';
    renameJam(db, jamId, t, meta).catch(() => toast('Could not rename.', 'error'));
  });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') title.blur(); });
  $('shareBtn').onclick = openShare;
  $('followBtn').onclick = () => {
    following = !following;
    $('followBtn').setAttribute('aria-pressed', String(following));
    followCheck();
  };
  $('objMenuBtn').onclick = e => { e.stopPropagation(); openObjMenu(); };
  document.addEventListener('pointerdown', e => {
    if (!$('objMenu').contains(e.target) && e.target !== $('objMenuBtn')) $('objMenu').hidden = true;
  });
  loadPreviews();
}

function updateChrome() {
  const idx = Math.max(0, order.indexOf(cur));
  lastIdx = idx;
  $('frameCounter').innerHTML = `${idx + 1} / ${order.length}${I.down}`;
  $('prevFrame').disabled = idx === 0;
  $('nextFrame').disabled = idx === order.length - 1 && (!canEdit() || order.length >= M.MAX_FRAMES);
  $('nextFrame').setAttribute('aria-label', idx === order.length - 1 ? 'Add frame' : 'Next frame');
  const title = $('jamTitle');
  if (document.activeElement !== title) title.value = meta.title || 'Untitled jam';
  title.readOnly = !isOwner;
  title.title = isOwner ? 'Rename jam' : '';
  document.title = `${meta.title || 'Jam'} · SpaceJam`;
  $('shareBtn').hidden = !isOwner;
  $('bgBtn').hidden = !isOwner;
  $('followBtn').hidden = isOwner;
  const ro = !canEdit();
  $('lockedBanner').hidden = !ro;
  svg.classList.toggle('readonly', ro);
  document.querySelectorAll('#toolbar .tool[data-tool]').forEach(b => {
    b.disabled = ro && b.dataset.tool !== 'laser' && b.dataset.tool !== 'select';
  });
  if (ro && !['select', 'laser'].includes(tool)) setTool('select');
  updateUndoButtons();
  renderPropbar();
}

function buildMoreMenu() {
  const m = $('moreMenu');
  m.innerHTML = '';
  m.append(
    menuItem(I.pdf, 'Download as PDF', () => doExportPDF()),
    menuItem(I.png, 'Save frame as image', () => doExportPNG())
  );
  m.append(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
  if (canEdit() && canClear()) m.append(menuItem(I.clear, 'Clear frame', clearFrame, { danger: true }));
  if (isOwner) {
    m.append(menuItem(I.history, 'Version history', openVersions));
    m.append(menuItem(I.share, meta.kind === 'copy' ? 'Share & classroom controls' : 'Assign to students', openShare));
    m.append(menuItem(I.template, 'Teacher dashboard', () => { location.href = 'dashboard.html'; }));
  } else {
    m.append(menuItem(I.home, 'Join a different jam', () => { location.href = './'; }));
  }
  m.append(menuItem(I.settings, 'Keyboard shortcuts', openKeys));
}

async function doExportPDF() {
  toast('Building PDF…');
  try {
    await exportPDF(order.map(f => frameData(f)), meta.title || 'SpaceJam');
    toast('PDF downloaded', 'ok');
  } catch (e) { console.error(e); toast('PDF export failed.', 'error'); }
}
async function doExportPNG() {
  try {
    await exportPNG(frameData(cur), meta.title || 'SpaceJam', order.indexOf(cur) + 1);
    toast('Image downloaded', 'ok');
  } catch (e) { console.error(e); toast('Image export failed.', 'error'); }
}

// ── frames ────────────────────────────────────────────────────
function resetFrameView() {
  bgSig = '';
  objLayer.innerHTML = '';
  objEls.clear();
}
function goToFrame(fid) {
  if (!fid || fid === cur) return;
  if (editing) finishTextEdit();
  sel.clear();
  overrides.clear();
  cur = fid;
  resetFrameView();
  preloadFontsFor(fid);
  updateChrome();
  requestRender();
  writePresence();
  markStripCurrent();
}
function stepFrame(d) {
  const i = order.indexOf(cur) + d;
  if (i >= order.length) { if (canEdit() && order.length < M.MAX_FRAMES) addFrame(); return; }
  if (i >= 0) goToFrame(order[i]);
}
function addFrame(afterFid = cur) {
  if (!canEdit()) return;
  if (order.length >= M.MAX_FRAMES) return toast(`A jam can have up to ${M.MAX_FRAMES} frames.`, 'error');
  const fid = newId('f');
  const nOrder = [...order];
  nOrder.splice(order.indexOf(afterFid) + 1, 0, fid);
  commit([
    { path: P.frame(jamId, fid), before: null, after: { bg: { type: 'blank' } } },
    { path: P.order(jamId), before: order, after: nOrder }
  ]);
  goToFrame(fid);
}
function duplicateFrame(fid) {
  if (!canEdit()) return;
  if (order.length >= M.MAX_FRAMES) return toast(`A jam can have up to ${M.MAX_FRAMES} frames.`, 'error');
  const src = clone(frameData(fid));
  const objs = {};
  for (const o of Object.values(src.objects || {})) objs[newId('o')] = { ...o, ...authorFieldsKeep(o) };
  const nf = newId('f');
  const nOrder = [...order];
  nOrder.splice(order.indexOf(fid) + 1, 0, nf);
  commit([
    { path: P.frame(jamId, nf), before: null, after: { bg: src.bg || { type: 'blank' }, objects: objs } },
    { path: P.order(jamId), before: order, after: nOrder }
  ]);
  goToFrame(nf);
}
function authorFieldsKeep(o) {
  // duplicates keep the original author unless the student couldn't delete it otherwise
  return isOwner ? {} : { authorUid: uid, authorName: myName, updatedAt: Date.now() };
}
async function deleteFrame(fid) {
  if (!canEdit() || !canClear()) return toast('Only your teacher can delete frames.', 'error');
  if (order.length <= 1) return toast("A jam needs at least one frame. Use Clear frame instead.", 'error');
  const okd = await ask({ title: 'Delete this frame?', message: `Frame ${order.indexOf(fid) + 1} and everything on it will be removed. You can undo this.`, input: false, ok: 'Delete', danger: true });
  if (!okd) return;
  const i = order.indexOf(fid);
  const nOrder = order.filter(f => f !== fid);
  const goto = nOrder[Math.min(i, nOrder.length - 1)];
  commit([
    { path: P.order(jamId), before: order, after: nOrder },
    { path: P.frame(jamId, fid), before: clone(frameData(fid)), after: null }
  ]);
  if (fid === cur) goToFrame(goto);
}
function moveFrame(fromIdx, toIdx) {
  if (!canEdit() || fromIdx === toIdx) return;
  const nOrder = [...order];
  const [f] = nOrder.splice(fromIdx, 1);
  nOrder.splice(toIdx, 0, f);
  commit([{ path: P.order(jamId), before: order, after: nOrder }]);
}
async function clearFrame() {
  if (!canEdit() || !canClear()) return toast('Only your teacher can clear frames.', 'error');
  const objs = remoteObjects(cur);
  if (!Object.keys(objs).length) return toast('This frame is already empty.');
  const okd = await ask({ title: 'Clear this frame?', message: 'Removes every note, drawing, shape, and image on this frame. The background stays. You can undo this.', input: false, ok: 'Clear frame', danger: true });
  if (!okd) return;
  sel.clear();
  commit(Object.entries(objs).map(([id, o]) => ({ path: P.obj(jamId, cur, id), before: o, after: null })));
}

// frame strip
let stripOpen = false;
function toggleStrip() {
  stripOpen = !stripOpen;
  $('frameStrip').hidden = !stripOpen;
  $('frameCounter').setAttribute('aria-expanded', String(stripOpen));
  if (stripOpen) buildStrip();
  layout();
}
const stripDirty = debounce(() => { if (stripOpen) buildStrip(); }, 350);
function markStripCurrent() {
  document.querySelectorAll('.fthumb').forEach(t => t.classList.toggle('current', t.dataset.fid === cur));
}
function buildStrip() {
  const s = $('frameStrip');
  const existing = new Map([...s.querySelectorAll('.fthumb')].map(e => [e.dataset.fid, e]));
  const frag = document.createDocumentFragment();
  order.forEach((fid, i) => {
    let el = existing.get(fid);
    if (!el) {
      el = document.createElement('div');
      el.className = 'fthumb';
      el.dataset.fid = fid;
      el.innerHTML = `<button class="fthumb-btn"><canvas></canvas></button><span class="fthumb-num"></span>` +
        (canEdit() ? `<button class="fthumb-more" aria-label="Frame options">${I.more}</button>` : '');
      el.querySelector('.fthumb-btn').onclick = () => goToFrame(fid);
      const more = el.querySelector('.fthumb-more');
      if (more) more.onclick = e => {
        e.stopPropagation();
        const r = more.getBoundingClientRect(), wr = stageWrap.getBoundingClientRect();
        popMenu(r.left - wr.left, r.bottom - wr.top + 4, [
          menuItem(I.copy, 'Duplicate frame', () => duplicateFrame(fid), { disabled: order.length >= M.MAX_FRAMES }),
          menuItem(I.trash, 'Delete frame', () => deleteFrame(fid), { danger: true, disabled: !canClear() || order.length <= 1 })
        ]);
      };
      if (canEdit()) {
        el.draggable = true;
        el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/sj-frame', fid); e.dataTransfer.effectAllowed = 'move'; });
        el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/sj-frame')) { e.preventDefault(); el.classList.add('drag-over'); } });
        el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
        el.addEventListener('drop', e => {
          e.preventDefault(); el.classList.remove('drag-over');
          const from = order.indexOf(e.dataTransfer.getData('text/sj-frame'));
          moveFrame(from, order.indexOf(fid));
        });
      }
    }
    el.querySelector('.fthumb-num').textContent = i + 1;
    el.querySelector('.fthumb-btn').setAttribute('aria-label', `Go to frame ${i + 1}`);
    el.classList.toggle('current', fid === cur);
    frag.appendChild(el);
    existing.delete(fid);
  });
  if (canEdit() && order.length < M.MAX_FRAMES) {
    const add = s.querySelector('.fthumb-add') || Object.assign(document.createElement('button'), {
      className: 'fthumb-add', textContent: '+', title: 'Add frame', onclick: () => addFrame(order[order.length - 1])
    });
    add.setAttribute('aria-label', 'Add frame');
    frag.appendChild(add);
  }
  s.innerHTML = '';
  s.appendChild(frag);
  requestAnimationFrame(() => {
    s.querySelectorAll('.fthumb').forEach(el => paintThumb(el.querySelector('canvas'), frameData(el.dataset.fid)));
  });
}

function popMenu(x, y, items) {
  const wrap = $('objMenu'), list = $('objMenuList');
  list.innerHTML = '';
  items.forEach(i => list.appendChild(i));
  wrap.style.left = Math.max(8, Math.min(x, stageWrap.clientWidth - 260)) + 'px';
  wrap.style.top = Math.max(8, y) + 'px';
  wrap.hidden = false;
  list.addEventListener('click', e => { if (e.target.closest('.menu-item') && !e.target.closest('[data-keep]')) wrap.hidden = true; }, { once: true });
  const first = list.querySelector('button:not(:disabled)');
  first && first.focus();
  list.onkeydown = e => { if (e.key === 'Escape') { wrap.hidden = true; } };
}

// ── toolbar ───────────────────────────────────────────────────
const TOOLS = [
  { id: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'select', icon: 'select', label: 'Select', key: 'V' },
  { id: 'sticky', icon: 'sticky', label: 'Sticky note', key: 'N' },
  { id: 'image', icon: 'image', label: 'Image', key: 'I' },
  { id: 'shape', icon: 'shape', label: 'Shape', key: 'S' },
  { id: 'text', icon: 'text', label: 'Text box', key: 'T' },
  { id: 'laser', icon: 'laser', label: 'Laser', key: 'L' }
];
function buildToolbar() {
  const tb = $('toolbar');
  tb.innerHTML = TOOLS.map(t => `<button class="tool" data-tool="${t.id}" aria-pressed="false" aria-label="${t.label}">${I[t.icon]}<span class="tool-tip">${t.label}<kbd>${t.key}</kbd></span>${t.id === 'pen' ? '<span class="swatch-dot" id="penDot"></span>' : ''}</button>`).join('') +
    `<div class="toolbar-sep"></div>
     <button class="tool" id="undoBtn" aria-label="Undo">${I.undo}<span class="tool-tip">Undo<kbd>Ctrl Z</kbd></span></button>
     <button class="tool" id="redoBtn" aria-label="Redo">${I.redo}<span class="tool-tip">Redo<kbd>Ctrl Y</kbd></span></button>`;
  tb.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => onToolClick(b.dataset.tool)));
  $('undoBtn').onclick = undo;
  $('redoBtn').onclick = redo;
  $('imageInput').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) addImageFile(f);
  });
  setTool('select');
}
function onToolClick(t) {
  if (t === 'sticky') { if (canEdit()) openNote(); return; }
  if (t === 'image') { if (canEdit()) $('imageInput').click(); return; }
  setTool(t);
}
function setTool(t) {
  if (editing) finishTextEdit();
  tool = t;
  if (t !== 'select') sel.clear();
  document.querySelectorAll('#toolbar .tool[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  svg.setAttribute('class', 'tool-' + effectiveTool() + (canEdit() ? '' : ' readonly'));
  const dot = $('penDot'); if (dot) dot.style.background = opts.penColor;
  renderPropbar();
  requestRender();
}
const effectiveTool = () => (tempSelect ? 'select' : tool);
function updateUndoButtons() {
  if (!$('undoBtn')) return;
  $('undoBtn').disabled = !undoStack.length || !canEdit();
  $('redoBtn').disabled = !redoStack.length || !canEdit();
}

// ── layout / zoom ─────────────────────────────────────────────
function layout() {
  const sw = stage.clientWidth - 48, sh = stage.clientHeight - 48;
  const fit = Math.max(0.1, Math.min(sw / M.FRAME_W, sh / M.FRAME_H));
  scale = fit * zoom;
  svg.style.width = Math.round(M.FRAME_W * scale) + 'px';
  svg.style.height = Math.round(M.FRAME_H * scale) + 'px';
  $('zoomLabel').textContent = Math.round(zoom * 100) + '%';
  requestRender();
  if (editing) positionEditor();
}
function setZoom(z) { zoom = clamp(z, 0.4, 4); layout(); }

function toBoard(e) {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}
function toScreen(x, y) {
  const pr = svg.getBoundingClientRect(), wr = stageWrap.getBoundingClientRect();
  return { x: pr.left - wr.left + x * scale, y: pr.top - wr.top + y * scale };
}
function viewCenter() {
  const sr = stage.getBoundingClientRect(), pr = svg.getBoundingClientRect();
  return {
    x: clamp((sr.left + sr.width / 2 - pr.left) / scale, 150, M.FRAME_W - 150),
    y: clamp((sr.top + sr.height / 2 - pr.top) / scale, 150, M.FRAME_H - 150)
  };
}

// ── rendering ─────────────────────────────────────────────────
let raf = 0;
function requestRender() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function sigOf(o) {
  return JSON.stringify(o, (k, v) => (k === 'src' ? (v ? v.length : 0) : v)) + '|' + fontsVersion + '|' + (editing?.oid === o.id) + '|' + isOwner;
}
function render() {
  if (!jam || !cur) return;
  const f = frameData(cur);
  const bs = JSON.stringify(f.bg || {});
  if (bs !== bgSig) { bgSig = bs; bgLayer.innerHTML = SVG_DEFS + backgroundSVG(f.bg, 'bgpat'); }
  const objs = M.sortedObjects(frameObjects(cur));
  const seen = new Set();
  let prev = null;
  for (const o of objs) {
    if (!o.type) continue;
    seen.add(o.id);
    let e = objEls.get(o.id);
    if (!e) {
      const g = document.createElementNS(SVGNS, 'g');
      g.dataset.oid = o.id;
      e = { g, sig: '' };
      objEls.set(o.id, e);
    }
    const sig = sigOf(o);
    if (e.sig !== sig) {
      e.sig = sig;
      e.g.setAttribute('class', 'obj' + (o.lockedByTeacher ? ' locked' : ''));
      e.g.setAttribute('transform', objectTransform(o));
      const tip = isOwner && o.authorName ? `<title>Added by ${esc(o.authorName)}${o.lockedByTeacher ? ' · locked' : ''}</title>`
        : (o.lockedByTeacher ? '<title>Locked by teacher</title>' : '');
      e.g.innerHTML = tip + objectInnerSVG(o, { hideText: editing?.oid === o.id });
    }
    const want = prev ? prev.nextSibling : objLayer.firstChild;
    if (want !== e.g) objLayer.insertBefore(e.g, want);
    prev = e.g;
  }
  for (const [id, e] of objEls) if (!seen.has(id)) { e.g.remove(); objEls.delete(id); }
  renderSelection();
  positionObjMenuBtn();
  if (propbarDirtyFromRender) { propbarDirtyFromRender = false; renderPropbar(); }
}
let propbarDirtyFromRender = false;

function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
function renderSelection() {
  selLayer.innerHTML = '';
  const objs = selectedObjects();
  if (!objs.length || effectiveTool() !== 'select' && !editing) return;
  const hs = 11 / scale;
  if (objs.length === 1) {
    const o = objs[0];
    const g = el('g', { transform: objectTransform(o) }, selLayer);
    const pad = 3 / scale;
    el('rect', { class: 'sel-box', x: -pad, y: -pad, width: o.w + pad * 2, height: Math.max(o.h, 0) + pad * 2 }, g);
    if (editing || !canEdit() || !canTouch(o) || drag?.kind === 'move') return;
    const names = o.type === 'text' ? ['nw', 'ne', 'se', 'sw', 'e', 'w'] : Object.keys(HANDLES);
    for (const n of names) {
      const [fx, fy] = HANDLES[n];
      if (o.h < 24 / scale && (n === 'n' || n === 's')) continue;
      el('rect', { class: 'handle', 'data-handle': n, x: o.w * fx - hs / 2, y: o.h * fy - hs / 2, width: hs, height: hs, rx: 2 / scale, style: `cursor:${CURSORS[n]}` }, g);
    }
    el('line', { x1: o.w / 2, y1: -pad, x2: o.w / 2, y2: -26 / scale, class: 'sel-box' }, g);
    el('circle', { class: 'handle rot', 'data-handle': 'rot', cx: o.w / 2, cy: -30 / scale, r: hs * 0.62, style: 'cursor:grab' }, g);
  } else {
    const b = unionBox(objs);
    el('rect', { class: 'sel-box multi', x: b.x - 4 / scale, y: b.y - 4 / scale, width: b.x2 - b.x + 8 / scale, height: b.y2 - b.y + 8 / scale }, selLayer);
  }
}
function unionBox(objs) {
  const bs = objs.map(M.aabb);
  return { x: Math.min(...bs.map(b => b.x)), y: Math.min(...bs.map(b => b.y)), x2: Math.max(...bs.map(b => b.x2)), y2: Math.max(...bs.map(b => b.y2)) };
}

function positionObjMenuBtn() {
  const btn = $('objMenuBtn');
  const objs = selectedObjects();
  if (!objs.length || effectiveTool() !== 'select' || drag || editing) { btn.hidden = true; return; }
  const b = unionBox(objs);
  const p = toScreen(b.x2, b.y);
  btn.style.left = Math.min(stageWrap.clientWidth - 44, p.x + 10) + 'px';
  btn.style.top = Math.max(4, p.y - 46) + 'px';
  btn.hidden = false;
}

// ── propbar (context options) ─────────────────────────────────
function swatchBtn(hex, name, pressed, extraClass = '') {
  const dark = ['#202124', '#1A73E8', '#188038', '#D93025', '#9334E6'].includes(hex);
  const cls = 'swatch ' + extraClass + (hex === 'none' ? ' none' : '') + (dark ? ' dark' : '');
  return `<button class="${cls}" data-val="${hex}" aria-label="${name}" title="${name}" aria-pressed="${pressed}" style="${hex === 'none' ? '' : `background:${hex}`}"></button>`;
}
function propContext() {
  if (!canEdit()) return { kind: tool === 'laser' ? 'tool:laser' : 'none' };
  if (editing) { const o = objById(editing.oid); return o ? { kind: 'text', objs: [o] } : { kind: 'none' }; }
  const objs = selectedObjects();
  if (objs.length && effectiveTool() === 'select') {
    const types = [...new Set(objs.map(o => o.type === 'shape' && (o.kind === 'line' || o.kind === 'arrow') ? 'line' : o.type))];
    return types.length === 1 ? { kind: types[0], objs } : { kind: 'none' };
  }
  return { kind: 'tool:' + tool };
}
function renderPropbar() {
  const pb = $('propbar');
  if (pb.contains(document.activeElement) && ['SELECT', 'INPUT'].includes(document.activeElement.tagName)) return;
  const ctx = propContext();
  const o = ctx.objs?.[0];
  let h = '';
  const inks = (val) => M.INK_COLORS.map(c => swatchBtn(c.hex, c.name, c.hex === val)).join('');
  const fills = (val, noNone) => M.SHAPE_COLORS.filter(c => !(noNone && c.hex === 'none')).map(c => swatchBtn(c.hex, c.name, c.hex === val)).join('');
  const pop = (k, val, label, noNone) => `<div class="menu-wrap"><button class="opt-btn" data-pop="${k}" aria-haspopup="true" aria-expanded="false"><span class="chip${val === 'none' ? ' none' : ''}" style="${val === 'none' ? '' : `background:${val}`}"></span>${label}${I.down}</button><div class="flyout pop" data-k="${k}" role="group" aria-label="${label}"><div class="flyout-row">${fills(val, noNone)}</div></div></div>`;
  switch (ctx.kind) {
    case 'tool:pen':
      h = `<span class="prop-label">Pen</span>${M.PEN_STYLES.map(s => `<button class="opt-btn" data-k="pen" data-val="${s.id}" aria-pressed="${opts.pen === s.id}">${s.name}</button>`).join('')}
           <span class="prop-sep"></span><span data-k="penColor" class="flyout-row" role="group" aria-label="Pen colour">${inks(opts.penColor)}</span>
           <span class="hint">Hold Shift for a straight line</span>`;
      break;
    case 'tool:shape':
      h = `<span class="prop-label">Shape</span>${M.SHAPES.map(s => `<button class="opt-btn" data-k="shapeKind" data-val="${s.id}" aria-pressed="${opts.shapeKind === s.id}" aria-label="${s.name}" title="${s.name}">${I[s.id]}</button>`).join('')}
           <span class="prop-sep"></span>${pop('shapeFill', opts.shapeFill, 'Fill')}${pop('shapeStroke', opts.shapeStroke, 'Border')}
           <span class="hint">Drag on the board</span>`;
      break;
    case 'tool:text':
    case 'text': {
      const v = ctx.kind === 'text' ? o : { font: opts.textFont, size: opts.textSize, color: opts.textColor, bold: opts.bold, italic: opts.italic, align: opts.align };
      h = `<select class="field" data-k="font" aria-label="Font">${fontOptionsHTML(v.font)}</select>
           <input type="number" class="field" data-k="size" min="8" max="240" value="${Math.round(v.size)}" aria-label="Font size">
           <span data-k="textColor" class="flyout-row">${inks(v.color)}</span>
           <span class="prop-sep"></span>
           <button class="opt-btn" data-k="bold" aria-pressed="${!!v.bold}" aria-label="Bold" title="Bold">${I.bold}</button>
           <button class="opt-btn" data-k="italic" aria-pressed="${!!v.italic}" aria-label="Italic" title="Italic">${I.italic}</button>
           <span class="prop-sep"></span>
           ${['left', 'center', 'right'].map(a => `<button class="opt-btn" data-k="align" data-val="${a}" aria-pressed="${v.align === a || (!v.align && a === 'left')}" aria-label="Align ${a}" title="Align ${a}">${I['align' + a[0].toUpperCase()]}</button>`).join('')}
           ${ctx.kind === 'tool:text' ? '<span class="hint">Click the board to type</span>' : ''}`;
      break;
    }
    case 'sticky':
      h = `<span class="prop-label">Note</span><span data-k="noteColor" class="flyout-row">${M.NOTE_COLORS.map(c => swatchBtn(c.id, c.name, c.id === o.color, 'note-sw')).join('').replace(/background:(\w+)/g, (m, id) => `background:${M.noteHex(id)}`)}</span>
           <select class="field" data-k="noteFont" aria-label="Note font">${fontOptionsHTML(o.font || M.DEFAULT_NOTE_FONT)}</select>
           <button class="opt-btn" data-act="editNote">${I.edit} Edit text</button>`;
      break;
    case 'shape':
      h = `${pop('shapeFill', o.fill, 'Fill')}${pop('shapeStroke', o.stroke, 'Border')}
           <select class="field" data-k="shapeSw" aria-label="Border width">${[2, 4, 8, 12, 16].map(w => `<option value="${w}"${(o.sw ?? 4) === w ? ' selected' : ''}>${w} px</option>`).join('')}</select>`;
      break;
    case 'line':
      h = `<button class="opt-btn" data-k="lineKind" data-val="line" aria-pressed="${o.kind === 'line'}" aria-label="Line" title="Line">${I.line}</button>
           <button class="opt-btn" data-k="lineKind" data-val="arrow" aria-pressed="${o.kind === 'arrow'}" aria-label="Arrow" title="Arrow">${I.arrow}</button>
           <span class="prop-sep"></span>${pop('shapeStroke', o.stroke, 'Colour', true)}
           <select class="field" data-k="shapeSw" aria-label="Line width">${[2, 4, 8, 12, 16].map(w => `<option value="${w}"${(o.sw ?? 4) === w ? ' selected' : ''}>${w} px</option>`).join('')}</select>`;
      break;
    case 'stroke':
      h = `<span class="prop-label">Ink</span><span data-k="penColor" class="flyout-row">${inks(o.color)}</span>`;
      break;
    case 'tool:eraser':
      h = `<span class="hint">Drag over pen strokes to erase them</span>` + (canClear() ? `<span class="prop-sep"></span><button class="opt-btn" data-act="clearFrame">${I.clear} Clear frame</button>` : '');
      break;
    case 'tool:laser':
      h = `<span class="hint">Drag to point. Everyone on this frame sees it, and it fades on its own.</span>`;
      break;
    default:
      pb.hidden = true; pb.innerHTML = ''; return;
  }
  pb.innerHTML = h;
  pb.hidden = false;
  pb.querySelectorAll('select[data-k="font"], select[data-k="noteFont"]').forEach(s => s.style.fontFamily = `'${s.value}'`);
}
function setupPropbarEvents() {
  const pb = $('propbar');
  pb.addEventListener('click', e => {
    const popBtn = e.target.closest('[data-pop]');
    if (popBtn) {
      const fl = popBtn.nextElementSibling;
      const open = !fl.classList.contains('open');
      pb.querySelectorAll('.flyout.pop.open').forEach(f => { f.classList.remove('open'); f.previousElementSibling.setAttribute('aria-expanded', 'false'); });
      if (open) {
        const r = popBtn.getBoundingClientRect();
        fl.style.left = r.left + 'px'; fl.style.top = (r.bottom + 8) + 'px';
        fl.classList.add('open'); popBtn.setAttribute('aria-expanded', 'true');
        fl.querySelector('[aria-pressed="true"], button')?.focus();
      }
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act) { if (act.dataset.act === 'clearFrame') clearFrame(); if (act.dataset.act === 'editNote') openNote([...sel][0]); return; }
    const b = e.target.closest('button[data-val], button[data-k]');
    if (!b) return;
    const k = b.dataset.k || b.closest('[data-k]')?.dataset.k;
    let val = b.dataset.val;
    if (k === 'bold' || k === 'italic') val = b.getAttribute('aria-pressed') !== 'true';
    setProp(k, val);
  });
  document.addEventListener('pointerdown', e => {
    if (!pb.contains(e.target)) pb.querySelectorAll('.flyout.pop.open').forEach(f => f.classList.remove('open'));
  });
  pb.addEventListener('keydown', e => {
    if (e.key === 'Escape') pb.querySelectorAll('.flyout.pop.open').forEach(f => { f.classList.remove('open'); f.previousElementSibling.focus(); });
  });
  pb.addEventListener('change', e => {
    const k = e.target.dataset.k; if (!k) return;
    let v = e.target.value;
    if (k === 'size') v = clamp(Number(v) || 32, 8, 240);
    if (k === 'shapeSw') v = Number(v);
    setProp(k, v);
    e.target.blur();
  });
}
function setProp(k, val) {
  // remember as the default for new objects
  const map = { pen: 'pen', penColor: 'penColor', shapeKind: 'shapeKind', shapeFill: 'shapeFill', shapeStroke: 'shapeStroke', shapeSw: 'shapeSw', noteColor: 'noteColor', noteFont: 'noteFont', font: 'textFont', size: 'textSize', textColor: 'textColor', bold: 'bold', italic: 'italic', align: 'align' };
  if (map[k]) { opts[map[k]] = val; saveOpts(); }
  if (k === 'penColor') { const d = $('penDot'); if (d) d.style.background = val; }
  if (k === 'font' || k === 'noteFont') loadFont(val);
  // apply to the selection / the text being edited
  const targets = editing ? [objById(editing.oid)].filter(Boolean) : (effectiveTool() === 'select' ? selectedObjects() : []);
  const field = { penColor: 'color', noteColor: 'color', noteFont: 'font', font: 'font', size: 'size', textColor: 'color', bold: 'bold', italic: 'italic', align: 'align', shapeFill: 'fill', shapeStroke: 'stroke', shapeSw: 'sw', lineKind: 'kind' }[k];
  if (field && targets.length) {
    if (editing) {
      const ov = overrides.get(editing.oid);
      const base = ov?.obj || remoteObjects(cur)[editing.oid];
      const n = { ...base, [field]: val, updatedAt: Date.now() };
      n.h = layoutText(n).height;
      overrides.set(editing.oid, { fid: cur, obj: n });
      positionEditor();
      if (!editing.isNew) editing.pendingStyle = true;
    } else {
      const changes = [];
      for (const o of targets) {
        if (!canTouch(o)) continue;
        const okType = (k === 'penColor' && o.type === 'stroke') || (['noteColor', 'noteFont'].includes(k) && o.type === 'sticky') ||
          (['font', 'size', 'textColor', 'bold', 'italic', 'align'].includes(k) && o.type === 'text') ||
          (['shapeFill', 'shapeStroke', 'shapeSw', 'lineKind'].includes(k) && o.type === 'shape');
        if (!okType) continue;
        const after = { ...o, [field]: val, updatedAt: Date.now() };
        if (o.type === 'text') after.h = layoutText(after).height;
        changes.push(...objChanges(cur, o.id, o, after));
      }
      commit(changes);
    }
  }
  renderPropbar();
  requestRender();
}

// ── pointer input ─────────────────────────────────────────────
function setupPointer() {
  setupPropbarEvents();
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const evs = drag.coalesce && e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of (evs.length ? evs : [e])) drag.move(ce, toBoard(ce));
  });
  const end = e => {
    if (!drag) return;
    const d = drag; drag = null;
    try { d.up(e, toBoard(e)); } finally { requestRender(); renderPropbar(); }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

function onDown(e) {
  if (e.button !== 0) return;
  // stop the browser moving focus (it would blur the inline text editor we may open)
  e.preventDefault();
  const ae = document.activeElement;
  if (ae && ae !== document.body && ae !== ta && ae.blur) ae.blur();
  $('objMenu').hidden = true;
  if (editing) { finishTextEdit(); if (tool === 'text') return; }
  const p = toBoard(e);
  const t = effectiveTool();
  svg.setPointerCapture(e.pointerId);
  if (t === 'laser') return laserDown(p);
  if (!canEdit()) return;
  if (t === 'select') return selectDown(e, p);
  if (t === 'pen') return penDown(e, p);
  if (t === 'eraser') return eraserDown(p);
  if (t === 'shape') return shapeDown(p);
  if (t === 'text') return textDown(e, p);
}

// select / move / resize / rotate / marquee
let lastTap = { oid: null, t: 0 };
function selectDown(e, p) {
  const handle = e.target.closest('[data-handle]');
  if (handle && sel.size === 1) {
    const o = selectedObjects()[0];
    if (o && canTouch(o)) return handle.dataset.handle === 'rot' ? startRotate(o, p) : startResize(o, handle.dataset.handle, p);
  }
  const g = e.target.closest('.obj');
  const o = g && objById(g.dataset.oid);
  // double-click (detected here because pointerdown's preventDefault suppresses dblclick)
  const now = performance.now();
  if (o && lastTap.oid === o.id && now - lastTap.t < 420 && !e.shiftKey) {
    lastTap = { oid: null, t: 0 };
    if (canTouch(o) && o.type === 'sticky') { drag = null; return openNote(o.id); }
    if (canTouch(o) && o.type === 'text') { drag = null; return startTextEdit(o.id, false); }
  }
  lastTap = { oid: o?.id || null, t: now };
  if (o && canTouch(o)) {
    if (e.shiftKey) {
      if (sel.has(o.id)) { sel.delete(o.id); requestRender(); renderPropbar(); return; }
      sel.add(o.id);
    } else if (!sel.has(o.id)) sel = new Set([o.id]);
    renderPropbar();
    return startMove(p);
  }
  if (!e.shiftKey) sel.clear();
  renderPropbar();
  startMarquee(p, e.shiftKey);
}

function startMove(p) {
  const ids = [...sel].filter(id => { const o = objById(id); return o && canTouch(o); });
  const start = Object.fromEntries(ids.map(id => [id, objById(id)]));
  let moved = false, lastSend = 0;
  const now = () => performance.now();
  const sendLive = () => {
    const map = {};
    for (const id of ids) {
      const o = overrides.get(id)?.obj; if (!o) continue;
      const base = P.obj(jamId, cur, id);
      map[`${base}/x`] = o.x; map[`${base}/y`] = o.y; map[`${base}/updatedAt`] = o.updatedAt;
    }
    if (Object.keys(map).length) db.update(map).catch(() => {});
  };
  drag = {
    kind: 'move',
    move(e, q) {
      let dx = q.x - p.x, dy = q.y - p.y;
      if (!moved && Math.hypot(dx, dy) < 3 / scale) return;
      moved = true;
      for (const id of ids) {
        const s = start[id];
        const nx = clamp(s.x + dx, -s.w + 24, M.FRAME_W - 24), ny = clamp(s.y + dy, -s.h + 24, M.FRAME_H - 24);
        overrides.set(id, { fid: cur, obj: { ...strip(s), x: nx, y: ny, updatedAt: Date.now() } });
      }
      requestRender();
      if (now() - lastSend > 150) { lastSend = now(); sendLive(); }
    },
    up() {
      if (!moved) return;
      const changes = [];
      for (const id of ids) { const o = overrides.get(id)?.obj; if (o) changes.push(...objChanges(cur, id, start[id], o)); }
      overrides.clear();
      commit(changes);
    }
  };
}

function startResize(o, h, p) {
  const start = { ...o };
  const hx = h.includes('w') ? -1 : h.includes('e') ? 1 : 0;
  const hy = h.includes('n') ? -1 : h.includes('s') ? 1 : 0;
  const rot = start.rot || 0;
  const c = M.center(start);
  const A = M.rotatePt({ x: c.x - hx * start.w / 2, y: c.y - hy * start.h / 2 }, c, rot);
  const isLine = start.type === 'shape' && (start.kind === 'line' || start.kind === 'arrow');
  const minW = isLine ? 0 : 16, minH = isLine ? 0 : 16;
  drag = {
    kind: 'resize',
    move(e, q) {
      const v = M.rotatePt(q, A, -rot);
      const vx = v.x - A.x, vy = v.y - A.y;
      let nw = hx ? Math.max(minW, hx * vx) : start.w;
      let nh = hy ? Math.max(minH, hy * vy) : start.h;
      const corner = hx && hy;
      const keep = (start.type === 'image' && corner && !e.shiftKey) || (start.type !== 'image' && corner && e.shiftKey) || (start.type === 'text' && corner);
      if (keep && start.w > 0 && start.h > 0) {
        const s = Math.max(nw / start.w, nh / start.h);
        nw = start.w * s; nh = start.h * s;
      }
      const n = { ...strip(start), w: nw, h: nh, updatedAt: Date.now() };
      if (start.type === 'text') {
        if (corner) n.size = clamp(start.size * nw / start.w, 8, 240);
        n.h = layoutText(n).height;
        nh = n.h;
      }
      const cl = { x: A.x + (hx ? hx * nw / 2 : 0), y: A.y + (hy ? hy * nh / 2 : 0) };
      const ncenter = M.rotatePt(cl, A, rot);
      n.x = ncenter.x - nw / 2; n.y = ncenter.y - nh / 2;
      if (start.type === 'text' && !hy && !rot) n.y = start.y; // keep the top edge on side drags
      overrides.set(o.id, { fid: cur, obj: n });
      requestRender();
    },
    up() {
      const n = overrides.get(o.id)?.obj;
      overrides.clear();
      if (n) commit(objChanges(cur, o.id, start, n));
    }
  };
}

function startRotate(o, p) {
  const start = { ...o };
  const c = M.center(start);
  const a0 = Math.atan2(p.y - c.y, p.x - c.x);
  drag = {
    kind: 'rotate',
    move(e, q) {
      let r = (start.rot || 0) + (Math.atan2(q.y - c.y, q.x - c.x) - a0) * 180 / Math.PI;
      r = ((r % 360) + 360) % 360;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      else for (const snap of [0, 90, 180, 270, 360]) if (Math.abs(r - snap) < 3) r = snap % 360;
      overrides.set(o.id, { fid: cur, obj: { ...strip(start), rot: Math.round(r * 10) / 10, updatedAt: Date.now() } });
      requestRender();
    },
    up() {
      const n = overrides.get(o.id)?.obj;
      overrides.clear();
      if (n) commit(objChanges(cur, o.id, start, n));
    }
  };
}

function startMarquee(p, additive) {
  const base = new Set(additive ? sel : []);
  const rect = el('rect', { class: 'marquee', x: p.x, y: p.y, width: 0, height: 0 }, liveLayer);
  drag = {
    kind: 'marquee',
    move(e, q) {
      const x = Math.min(p.x, q.x), y = Math.min(p.y, q.y), w = Math.abs(q.x - p.x), h = Math.abs(q.y - p.y);
      rect.setAttribute('x', x); rect.setAttribute('y', y); rect.setAttribute('width', w); rect.setAttribute('height', h);
      if (w < 4 && h < 4) return;
      const ns = new Set(base);
      for (const o of M.sortedObjects(frameObjects(cur))) {
        if (!canTouch(o)) continue;
        const b = M.aabb(o);
        if (b.x < x + w && b.x2 > x && b.y < y + h && b.y2 > y) ns.add(o.id);
      }
      sel = ns;
      requestRender();
    },
    up() { rect.remove(); renderPropbar(); }
  };
}

// pen
function penDown(e, p) {
  const st = M.penStyle(opts.pen);
  const color = opts.penColor;
  const pts = [{ x: p.x, y: p.y, t: performance.now(), w: st.width }];
  const path = el('path', {}, liveLayer);
  let lastW = st.width;
  const update = () => {
    const segs = [pts.map(q => ({ x: q.x, y: q.y, w: opts.pen === 'brush' ? q.w : undefined }))];
    const g = strokeGeometry({ tool: opts.pen, width: st.width, pts: M.serializePts(segs) });
    path.setAttribute('d', g.d);
    if (g.fill) { path.setAttribute('fill', color); path.setAttribute('fill-opacity', st.opacity); path.removeAttribute('stroke'); }
    else {
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', color); path.setAttribute('stroke-opacity', st.opacity);
      path.setAttribute('stroke-width', st.width); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    }
  };
  update();
  drag = {
    kind: 'pen', coalesce: true,
    move(e, q) {
      if (e.shiftKey) { pts.length = 1; pts.push({ x: q.x, y: q.y, t: performance.now(), w: st.width }); update(); return; }
      const last = pts[pts.length - 1];
      const d = Math.hypot(q.x - last.x, q.y - last.y);
      if (d < 1.2) return;
      const now = performance.now();
      const speed = d / Math.max(1, now - last.t);
      const target = st.width * clamp(1.3 - speed * 0.35, 0.45, 1.3);
      lastW = lastW * 0.75 + target * 0.25;
      pts.push({ x: q.x, y: q.y, t: now, w: lastW });
      update();
    },
    up() {
      path.remove();
      finishStroke(pts, st, color);
    }
  };
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let idx = -1, max = 0;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
function finishStroke(pts, st, color) {
  let ps = opts.pen === 'brush' ? pts.filter((q, i) => i === 0 || i === pts.length - 1 || i % 2 === 0) : rdp(pts, 0.6);
  const pad = st.width / 2 + 2;
  const xs = ps.map(q => q.x), ys = ps.map(q => q.y);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2, h = Math.max(...ys) - Math.min(...ys) + pad * 2;
  const local = ps.map(q => ({ x: q.x - x, y: q.y - y, w: opts.pen === 'brush' ? q.w : undefined }));
  createObj({
    type: 'stroke', tool: opts.pen, color, width: st.width, pts: M.serializePts([local]),
    x, y, w, h, pw: w, ph: h, rot: 0, z: nextZ(), ...authorFields()
  });
}

// eraser
function densify(seg, step) {
  const out = [];
  for (let i = 0; i < seg.length; i++) {
    const a = seg[i];
    out.push(a);
    const b = seg[i + 1]; if (!b) break;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.floor(d / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w !== undefined ? a.w + ((b.w ?? a.w) - a.w) * t : undefined });
    }
  }
  return out;
}
function eraserDown(p) {
  const R = 16;
  const work = new Map();
  const cursor = el('circle', { cx: p.x, cy: p.y, r: R, fill: 'rgba(255,255,255,.35)', stroke: '#5f6368', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }, liveLayer);
  const step = q => {
    cursor.setAttribute('cx', q.x); cursor.setAttribute('cy', q.y);
    for (const o of M.sortedObjects(frameObjects(cur))) {
      if (o.type !== 'stroke' || !canTouch(o)) continue;
      const b = M.aabb(o);
      if (q.x < b.x - R || q.x > b.x2 + R || q.y < b.y - R || q.y > b.y2 + R) continue;
      let w = work.get(o.id);
      if (!w) {
        const orig = remoteObjects(cur)[o.id];
        w = { start: { ...orig, id: o.id }, segs: M.parsePts(o.pts).map(s => densify(s, 3)) };
      }
      const sx = o.w / (o.pw || o.w || 1), sy = o.h / (o.ph || o.h || 1);
      const uq = M.rotatePt(q, M.center(o), -(o.rot || 0));
      const lx = (uq.x - o.x) / sx, ly = (uq.y - o.y) / sy;
      const r = R / ((sx + sy) / 2) + (o.width || 4) * 0.35;
      let changed = false;
      const out = [];
      for (const seg of w.segs) {
        let curSeg = [];
        for (const pt of seg) {
          if (Math.hypot(pt.x - lx, pt.y - ly) <= r) { changed = true; if (curSeg.length) out.push(curSeg); curSeg = []; }
          else curSeg.push(pt);
        }
        if (curSeg.length) out.push(curSeg);
      }
      if (!changed) { if (!work.has(o.id)) continue; }
      w.segs = out.filter(s => s.length > 1 || (s.length === 1 && o.tool !== 'highlighter'));
      work.set(o.id, w);
      overrides.set(o.id, { fid: cur, obj: w.segs.length ? { ...strip(o), pts: M.serializePts(w.segs), updatedAt: Date.now() } : null });
    }
    requestRender();
  };
  step(p);
  drag = {
    kind: 'eraser', coalesce: true,
    move(e, q) { step(q); },
    up() {
      cursor.remove();
      const changes = [];
      for (const [id, w] of work) {
        const after = w.segs.length ? { ...strip(w.start), pts: M.serializePts(w.segs), updatedAt: Date.now() } : null;
        changes.push(...objChanges(cur, id, w.start, after));
      }
      overrides.clear();
      commit(changes);
    }
  };
}

// shapes
function shapeDown(p) {
  const id = newId('o');
  const kind = opts.shapeKind;
  const isLine = kind === 'line' || kind === 'arrow';
  const base = () => ({
    type: 'shape', kind, fill: isLine ? 'none' : opts.shapeFill, stroke: opts.shapeStroke === 'none' && isLine ? '#202124' : opts.shapeStroke,
    sw: opts.shapeSw, rot: 0, z: nextZ(), ...authorFields()
  });
  if (!isLine && opts.shapeFill === 'none' && opts.shapeStroke === 'none') opts.shapeStroke = '#202124';
  drag = {
    kind: 'shape',
    move(e, q) {
      let x1 = q.x, y1 = q.y;
      if (isLine && e.shiftKey) {
        const a = Math.round(Math.atan2(y1 - p.y, x1 - p.x) / (Math.PI / 4)) * (Math.PI / 4);
        const d = Math.hypot(x1 - p.x, y1 - p.y);
        x1 = p.x + Math.cos(a) * d; y1 = p.y + Math.sin(a) * d;
      }
      let w = Math.abs(x1 - p.x), h = Math.abs(y1 - p.y);
      if (!isLine && e.shiftKey) { const m = Math.max(w, h); w = m; h = m; x1 = p.x + Math.sign(x1 - p.x || 1) * m; y1 = p.y + Math.sign(y1 - p.y || 1) * m; }
      const o = { ...base(), x: Math.min(p.x, x1), y: Math.min(p.y, y1), w, h };
      if (isLine) { o.flipX = x1 < p.x; o.flipY = y1 < p.y; }
      overrides.set(id, { fid: cur, obj: o });
      requestRender();
    },
    up() {
      let o = overrides.get(id)?.obj;
      overrides.delete(id);
      if (!o || (o.w < 8 && o.h < 8)) {
        o = isLine ? { ...base(), x: p.x, y: p.y, w: 200, h: 0 } : { ...base(), x: p.x - 80, y: p.y - 80, w: 160, h: 160 };
      }
      if (isLine) { o.flipX = !!o.flipX; o.flipY = !!o.flipY; }
      createObj(o, id);
      setTool('select');
      sel = new Set([id]);
      renderPropbar();
    }
  };
}

// text boxes (inline editor)
function textDown(e, p) {
  const g = e.target.closest('.obj');
  const hit = g && objById(g.dataset.oid);
  if (hit && hit.type === 'text' && canTouch(hit)) return startTextEdit(hit.id, false);
  const id = newId('o');
  const o = {
    type: 'text', text: '', font: opts.textFont, size: opts.textSize, color: opts.textColor,
    bold: !!opts.bold, italic: !!opts.italic, align: opts.align, x: p.x - 8, y: p.y - opts.textSize * 0.75,
    w: 440, rot: 0, z: nextZ(), ...authorFields()
  };
  o.h = layoutText(o).height;
  overrides.set(id, { fid: cur, obj: o });
  startTextEdit(id, true);
}
function startTextEdit(oid, isNew) {
  const o = objById(oid);
  if (!o) return;
  editing = { oid, isNew, start: isNew ? null : { ...remoteObjects(cur)[oid], id: oid } };
  if (!isNew) overrides.set(oid, { fid: cur, obj: strip(o) });
  sel = new Set([oid]);
  loadFont(o.font);
  ta.value = o.text || '';
  ta.hidden = false;
  positionEditor();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  setTimeout(() => { if (editing?.oid === oid && document.activeElement !== ta) ta.focus(); }, 0);
  requestRender();
  renderPropbar();
}
function positionEditor() {
  if (!editing) return;
  const o = overrides.get(editing.oid)?.obj || objById(editing.oid);
  if (!o) return;
  const p = toScreen(o.x, o.y);
  Object.assign(ta.style, {
    left: p.x + 'px', top: p.y + 'px', width: o.w * scale + 'px',
    font: fontStr(o.font || 'Inter', o.size * scale, o.bold, o.italic),
    lineHeight: (o.size * 1.25 * scale) + 'px',
    padding: (TEXT_PAD * scale) + 'px', color: o.color || '#202124', textAlign: o.align || 'left',
    transformOrigin: `${o.w * scale / 2}px ${o.h * scale / 2}px`, transform: o.rot ? `rotate(${o.rot}deg)` : ''
  });
  ta.style.height = '0px';
  ta.style.height = Math.max(o.h * scale, ta.scrollHeight) + 'px';
}
ta.addEventListener('input', () => {
  if (!editing) return;
  const ov = overrides.get(editing.oid);
  if (!ov?.obj) return;
  if (ta.value.length > M.MAX_NOTE_CHARS) ta.value = ta.value.slice(0, M.MAX_NOTE_CHARS);
  const n = { ...ov.obj, text: ta.value, updatedAt: Date.now() };
  n.h = layoutText(n).height;
  overrides.set(editing.oid, { fid: cur, obj: n });
  positionEditor();
});
ta.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); finishTextEdit(); }
  e.stopPropagation();
});
ta.addEventListener('blur', () => setTimeout(() => {
  if (editing && !$('propbar').contains(document.activeElement)) finishTextEdit();
}, 120));
function finishTextEdit() {
  if (!editing) return;
  const { oid, isNew, start } = editing;
  const o = overrides.get(oid)?.obj;
  editing = null;
  ta.hidden = true;
  overrides.delete(oid);
  if (o) {
    const text = o.text || '';
    if (isNew) { if (text.trim()) { createObj({ ...o, text }, oid); sel = new Set([oid]); } else sel.delete(oid); }
    else if (!text.trim()) {
      if (canDelete(start)) { commit(objChanges(cur, oid, start, null)); sel.delete(oid); }
      else toast('Only the author or your teacher can delete that.', 'error');
    } else commit(objChanges(cur, oid, start, { ...o, text, updatedAt: Date.now() }));
  }
  if (tool === 'text') setTool('select');
  requestRender();
  renderPropbar();
}

// ── object actions ────────────────────────────────────────────
function deleteSelection() {
  const objs = selectedObjects();
  if (!objs.length || !canEdit()) return;
  const ok = objs.filter(o => canTouch(o) && canDelete(o));
  if (ok.length < objs.length) toast('You can only delete things you added. Ask your teacher to remove the rest.', 'error');
  if (!ok.length) return;
  commit(ok.flatMap(o => objChanges(cur, o.id, o, null)));
  sel.clear();
  renderPropbar();
}
function duplicateSelection(offset = 24) {
  const objs = selectedObjects();
  if (!objs.length || !canEdit()) return;
  let z = nextZ();
  const ns = new Set(), changes = [];
  for (const o of objs.sort((a, b) => (a.z || 0) - (b.z || 0))) {
    const id = newId('o');
    changes.push(...objChanges(cur, id, null, { ...strip(o), x: o.x + offset, y: o.y + offset, z: z++, lockedByTeacher: null, ...authorFields() }));
    ns.add(id);
  }
  commit(changes);
  sel = ns;
  renderPropbar();
}
function reorder(front) {
  const objs = selectedObjects().filter(canTouch).sort((a, b) => (a.z || 0) - (b.z || 0));
  if (!objs.length) return;
  const all = frameObjects(cur);
  let z = front ? M.maxZ(all) + 1 : M.minZ(all) - objs.length;
  commit(objs.flatMap(o => objChanges(cur, o.id, o, { ...o, z: z++, updatedAt: Date.now() })));
}
function moveSelectionToFrame(fid) {
  const objs = selectedObjects().filter(o => canTouch(o) && canDelete(o));
  if (!objs.length) return toast('You can only move things you added to another frame.', 'error');
  let z = M.maxZ(remoteObjects(fid)) + 1;
  const changes = [];
  for (const o of objs) {
    changes.push(...objChanges(cur, o.id, o, null));
    changes.push(...objChanges(fid, o.id, null, { ...strip(o), z: z++, updatedAt: Date.now() }));
  }
  commit(changes);
  sel.clear();
  toast(`Moved to frame ${order.indexOf(fid) + 1}`, 'ok');
}
function toggleLock() {
  const objs = selectedObjects();
  if (!isOwner || !objs.length) return;
  const lock = !objs.every(o => o.lockedByTeacher);
  commit(objs.flatMap(o => objChanges(cur, o.id, o, { ...o, lockedByTeacher: lock || null, updatedAt: Date.now() })));
  toast(lock ? 'Locked: students can’t move or edit these' : 'Unlocked', 'ok');
}
function openObjMenu() {
  const objs = selectedObjects();
  if (!objs.length) return;
  const single = objs.length === 1 ? objs[0] : null;
  const btn = $('objMenuBtn');
  const x = parseFloat(btn.style.left) - 200, y = parseFloat(btn.style.top) + 42;
  const items = [];
  if (canEdit()) {
    if (single?.type === 'sticky') items.push(menuItem(I.edit, 'Edit note', () => openNote(single.id)));
    if (single?.type === 'text') items.push(menuItem(I.edit, 'Edit text', () => startTextEdit(single.id, false)));
    items.push(menuItem(I.copy, 'Duplicate', () => duplicateSelection()));
    items.push(menuItem(I.front, 'Bring to front', () => reorder(true)));
    items.push(menuItem(I.back, 'Send to back', () => reorder(false)));
    if (order.length > 1) {
      const mv = menuItem(I.move, 'Move to frame…', () => {
        popMenu(x, y, order.filter(f => f !== cur).map(f => menuItem('', `Frame ${order.indexOf(f) + 1}`, () => moveSelectionToFrame(f))));
      });
      mv.dataset.keep = '1';
      items.push(mv);
    }
    if (isOwner) {
      const locked = objs.every(o => o.lockedByTeacher);
      items.push(menuItem(locked ? I.unlock : I.lock, locked ? 'Unlock' : 'Lock in place', toggleLock));
    }
    items.push(menuItem(I.trash, 'Delete', deleteSelection, { danger: true }));
  }
  if (isOwner && single?.authorName) {
    const info = document.createElement('div');
    info.className = 'menu-label';
    info.textContent = `Added by ${single.authorName}`;
    items.push(Object.assign(document.createElement('div'), { className: 'menu-sep' }), info);
  }
  popMenu(x, y, items);
}

// ── sticky note dialog ────────────────────────────────────────
let noteM, noteEditId = null, noteColor = 'yellow';
function setupNoteModal() {
  noteM = modal('noteModal');
  const colors = $('noteColors');
  colors.innerHTML = M.NOTE_COLORS.map(c => `<button class="swatch note" data-c="${c.id}" aria-label="${c.name}" title="${c.name}" style="background:${c.hex}" aria-pressed="false"></button>`).join('');
  colors.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) setNoteColor(b.dataset.c); });
  const font = $('noteFont');
  font.innerHTML = fontOptionsHTML(M.DEFAULT_NOTE_FONT);
  font.addEventListener('change', () => { loadFont(font.value); $('noteText').style.fontFamily = `'${font.value}', Inter, sans-serif`; font.style.fontFamily = `'${font.value}'`; });
  const text = $('noteText');
  text.addEventListener('input', () => { $('noteCount').textContent = `${text.value.length} / ${M.MAX_NOTE_CHARS}`; });
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveNote(); });
  $('noteSave').onclick = saveNote;
}
function setNoteColor(c) {
  noteColor = c;
  $('noteEditor').style.background = M.noteHex(c);
  $('noteColors').querySelectorAll('[data-c]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c === c)));
}
function openNote(oid) {
  if (!canEdit()) return;
  const o = oid ? objById(oid) : null;
  if (o && !canTouch(o)) return;
  noteEditId = o ? o.id : null;
  setNoteColor(o?.color || opts.noteColor);
  const f = o?.font || opts.noteFont;
  loadFont(f);
  $('noteFont').value = f;
  $('noteFont').style.fontFamily = `'${f}'`;
  $('noteText').style.fontFamily = `'${f}', Inter, sans-serif`;
  $('noteText').value = o?.text || '';
  $('noteCount').textContent = `${($('noteText').value).length} / ${M.MAX_NOTE_CHARS}`;
  $('noteTitle').textContent = o ? 'Edit sticky note' : 'New sticky note';
  noteM.open();
  setTimeout(() => $('noteText').focus(), 50);
}
function saveNote() {
  const text = $('noteText').value.slice(0, M.MAX_NOTE_CHARS);
  const font = $('noteFont').value;
  opts.noteColor = noteColor; opts.noteFont = font; saveOpts();
  noteM.close();
  if (noteEditId) {
    const o = objById(noteEditId);
    if (o) commit(objChanges(cur, o.id, o, { ...o, text, font, color: noteColor, updatedAt: Date.now() }));
    return;
  }
  const c = viewCenter();
  const jitter = () => (Math.random() - 0.5) * 60;
  const id = createObj({
    type: 'sticky', text, color: noteColor, font, x: c.x - 100 + jitter(), y: c.y - 100 + jitter(), w: 200, h: 200,
    rot: 0, z: nextZ(), ...authorFields()
  });
  setTool('select');
  sel = new Set([id]);
  renderPropbar();
  requestRender();
}

// ── images ────────────────────────────────────────────────────
async function compressImage(file, maxDim = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    let s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const limit = M.MAX_IMAGE_BYTES * 1.36; // base64 overhead
    for (let attempt = 0; attempt < 6; attempt++) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * s));
      c.height = Math.max(1, Math.round(img.naturalHeight * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.85, 0.72, 0.6]) {
        let d = c.toDataURL('image/webp', q);
        if (!d.startsWith('data:image/webp')) d = c.toDataURL('image/jpeg', q);
        if (d.length <= limit) return { src: d, w: c.width, h: c.height };
      }
      s *= 0.72;
    }
    throw new Error('too big');
  } finally { URL.revokeObjectURL(url); }
}
async function addImageFile(file, at) {
  if (!canEdit()) return;
  if (!file.type.startsWith('image/')) return toast('That file is not an image.', 'error');
  const count = Object.values(remoteObjects(cur)).filter(o => o.type === 'image').length;
  if (count >= M.MAX_IMAGES_PER_FRAME) return toast(`Up to ${M.MAX_IMAGES_PER_FRAME} images per frame.`, 'error');
  toast('Adding image…');
  try {
    const { src, w, h } = await compressImage(file);
    const fit = Math.min(1, 640 / w, 420 / h);
    const W = Math.round(w * fit), H = Math.round(h * fit);
    const c = at || viewCenter();
    const id = createObj({ type: 'image', src, x: c.x - W / 2, y: c.y - H / 2, w: W, h: H, rot: 0, z: nextZ(), ...authorFields() });
    setTool('select');
    sel = new Set([id]);
    renderPropbar();
  } catch (e) { console.error(e); toast("Couldn't add that image.", 'error'); }
}

// ── background (teacher) ──────────────────────────────────────
let bgM;
function setupBackground() {
  bgM = modal('bgModal');
  $('bgBtn').onclick = openBackground;
  $('bgUpload').onclick = () => $('bgInput').click();
  $('bgInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const { src } = await compressImage(f, 1600);
      setBackground({ type: 'image', src });
      bgM.close();
    } catch { toast("Couldn't use that image.", 'error'); }
  });
  $('bgGrid').addEventListener('click', e => {
    const b = e.target.closest('[data-bg]'); if (!b) return;
    setBackground({ type: b.dataset.bg });
    $('bgGrid').querySelectorAll('[data-bg]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
}
function openBackground() {
  const curBg = frameData(cur).bg?.type || 'blank';
  $('bgGrid').innerHTML = M.BACKGROUNDS.map(b => `<button class="bg-opt" data-bg="${b.id}" aria-pressed="${b.id === curBg}">
      <svg viewBox="0 0 1600 900">${backgroundSVG({ type: b.id }, 'bgp-' + b.id)}</svg><span>${b.name}</span></button>`).join('');
  bgM.open();
}
function setBackground(bg) {
  if (!isOwner) return;
  const before = frameData(cur).bg || { type: 'blank' };
  commit([{ path: `${P.frame(jamId, cur)}/bg`, before, after: bg }]);
}

// ── clipboard & drag-drop ─────────────────────────────────────
const isTyping = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
function setupClipboardAndDrop() {
  document.addEventListener('copy', e => {
    if (isTyping(e.target) || anyModalOpen()) return;
    const objs = selectedObjects();
    if (!objs.length) return;
    const data = JSON.stringify(objs.map(strip));
    e.clipboardData.setData('application/x-spacejam', data);
    e.clipboardData.setData('text/plain', objs.map(o => o.text).filter(Boolean).join('\n') || 'SpaceJam objects');
    try { localStorage.setItem('sj_clip', data); } catch {}
    e.preventDefault();
  });
  document.addEventListener('cut', e => {
    if (isTyping(e.target) || anyModalOpen() || !canEdit()) return;
    const objs = selectedObjects();
    if (!objs.length) return;
    const data = JSON.stringify(objs.map(strip));
    e.clipboardData.setData('application/x-spacejam', data);
    e.clipboardData.setData('text/plain', 'SpaceJam objects');
    e.preventDefault();
    deleteSelection();
  });
  document.addEventListener('paste', e => {
    if (isTyping(e.target) || anyModalOpen() || !canEdit()) return;
    const cd = e.clipboardData;
    const custom = cd.getData('application/x-spacejam');
    const file = [...(cd.files || [])].find(f => f.type.startsWith('image/'));
    e.preventDefault();
    if (custom) return pasteObjects(custom);
    if (file) return addImageFile(file);
    const text = cd.getData('text/plain');
    if (text && text !== 'SpaceJam objects') {
      const c = viewCenter();
      const id = createObj({
        type: 'sticky', text: text.slice(0, M.MAX_NOTE_CHARS), color: opts.noteColor, font: opts.noteFont,
        x: c.x - 100, y: c.y - 100, w: 200, h: 200, rot: 0, z: nextZ(), ...authorFields()
      });
      setTool('select'); sel = new Set([id]); renderPropbar();
    } else if (text === 'SpaceJam objects') {
      const fb = localStorage.getItem('sj_clip'); if (fb) pasteObjects(fb);
    }
  });
  stage.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files') && canEdit()) e.preventDefault(); });
  stage.addEventListener('drop', e => {
    const f = [...(e.dataTransfer.files || [])].find(x => x.type.startsWith('image/'));
    if (!f || !canEdit()) return;
    e.preventDefault();
    addImageFile(f, toBoard(e));
  });
}
function pasteObjects(json) {
  let arr;
  try { arr = JSON.parse(json); } catch { return; }
  if (!Array.isArray(arr) || !arr.length) return;
  let z = nextZ();
  const ns = new Set(), changes = [];
  const imgCount = Object.values(remoteObjects(cur)).filter(o => o.type === 'image').length;
  let addImgs = 0;
  for (const o of arr) {
    if (!o?.type) continue;
    if (o.type === 'image' && imgCount + ++addImgs > M.MAX_IMAGES_PER_FRAME) continue;
    const id = newId('o');
    changes.push(...objChanges(cur, id, null, { ...o, x: (o.x || 0) + 24, y: (o.y || 0) + 24, z: z++, lockedByTeacher: null, ...authorFields() }));
    ns.add(id);
  }
  commit(changes);
  setTool('select');
  sel = ns;
  renderPropbar();
}
const anyModalOpen = () => !!document.querySelector('.modal.open, .present.open');

// ── keyboard ──────────────────────────────────────────────────
const KEYS = [
  ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'], ['Copy / Paste / Duplicate', 'Ctrl+C / Ctrl+V / Ctrl+D'],
  ['Delete selected', 'Delete or Backspace'], ['Temporarily switch to Select', 'Hold Ctrl'],
  ['Straight line with pen', 'Hold Shift while drawing'], ['Select all on frame', 'Ctrl+A'],
  ['Next / previous frame', 'Page Down / Page Up'], ['Zoom in / out / fit', 'Ctrl+= / Ctrl+− / Ctrl+0'],
  ['New sticky note', 'N'], ['Pen / Eraser / Select / Text / Laser / Shape', 'P / E / V / T / L / S'],
  ['Nudge selected', 'Arrow keys (Shift = 10×)'], ['Deselect / finish typing', 'Esc']
];
let keysM;
function openKeys() {
  keysM ||= modal('keysModal');
  $('keysBody').innerHTML = KEYS.map(([a, k]) => `<tr><td>${a}</td><td style="font-family:var(--font-mono)">${k}</td></tr>`).join('');
  keysM.open();
}
function setupKeys() {
  document.addEventListener('keydown', e => {
    if (isTyping(e.target) || anyModalOpen()) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Control' && !e.repeat && tool !== 'select' && !drag) { tempSelect = true; setToolClassOnly(); return; }
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (k === 'd') { e.preventDefault(); duplicateSelection(); }
      else if (k === 'a') {
        e.preventDefault(); setTool('select');
        sel = new Set(M.sortedObjects(frameObjects(cur)).filter(canTouch).map(o => o.id));
        renderPropbar(); requestRender();
      }
      else if (k === '=' || k === '+') { e.preventDefault(); setZoom(zoom * 1.25); }
      else if (k === '-') { e.preventDefault(); setZoom(zoom / 1.25); }
      else if (k === '0') { e.preventDefault(); setZoom(1); }
      return;
    }
    if (e.altKey) return;
    switch (e.key) {
      case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); return;
      case 'Escape': sel.clear(); $('objMenu').hidden = true; if (tool !== 'select') setTool('select'); else { renderPropbar(); requestRender(); } return;
      case 'PageDown': e.preventDefault(); stepFrame(1); return;
      case 'PageUp': e.preventDefault(); stepFrame(-1); return;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        const objs = selectedObjects().filter(canTouch);
        if (!objs.length || !canEdit()) return;
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        commit(objs.flatMap(o => objChanges(cur, o.id, o, { ...o, x: o.x + dx, y: o.y + dy, updatedAt: Date.now() })));
        return;
      }
    }
    if (e.key.length !== 1) return;
    const map = { v: 'select', p: 'pen', e: 'eraser', t: 'text', l: 'laser', s: 'shape' };
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); openNote(); return; }
    if (k === 'i') { if (canEdit()) $('imageInput').click(); return; }
    if (map[k] && (canEdit() || ['select', 'laser'].includes(map[k]))) setTool(map[k]);
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'Control' && tempSelect) { tempSelect = false; setToolClassOnly(); }
  });
  window.addEventListener('blur', () => { if (tempSelect) { tempSelect = false; setToolClassOnly(); } });
}
function setToolClassOnly() {
  svg.setAttribute('class', 'tool-' + effectiveTool() + (canEdit() ? '' : ' readonly'));
  requestRender();
}

// ── presence & follow ─────────────────────────────────────────
const HEARTBEAT = LIVE ? 20000 : 4000;
function presPath() { return `${P.presence(jamId)}/${uid}`; }
function writePresence() {
  if (!uid || !started) return;
  db.set(presPath(), { name: myName, role: isOwner ? 'teacher' : 'student', f: cur, t: Date.now() }).catch(() => {});
}
function setupPresence() {
  db.onDisconnectRemove(presPath());
  writePresence();
  setInterval(writePresence, HEARTBEAT);
  setInterval(renderPresence, HEARTBEAT);
  db.on(P.presence(jamId), v => { presence = v || {}; renderPresence(); followCheck(); });
}
function livePresence() {
  const cutoff = Date.now() - HEARTBEAT * 3.5;
  return Object.entries(presence).filter(([, p]) => p && (!LIVE ? p.t > cutoff : true)).map(([id, p]) => ({ id, ...p }));
}
function renderPresence() {
  const list = livePresence().sort((a, b) => (a.role === 'teacher' ? -1 : 0) - (b.role === 'teacher' ? -1 : 0) || String(a.name).localeCompare(b.name));
  const max = 6;
  const shown = list.slice(0, max);
  $('presence').innerHTML = shown.map(p => `<span class="avatar h${hueIndex(p.id)}${p.role === 'teacher' ? ' teacher' : ''}" title="${esc(p.name)}${p.id === uid ? ' (you)' : ''}${p.role === 'teacher' ? ' · teacher' : ''} · frame ${order.indexOf(p.f) + 1 || '?'}">${esc(initials(p.name))}</span>`).join('') +
    (list.length > max ? `<span class="avatar more" title="${list.slice(max).map(p => esc(p.name)).join(', ')}">+${list.length - max}</span>` : '');
  $('presence').setAttribute('aria-label', `${list.length} ${list.length === 1 ? 'person' : 'people'} on this jam`);
}
function followCheck() {
  if (!following || isOwner) return;
  const t = livePresence().find(p => p.role === 'teacher');
  if (t && t.f && t.f !== cur && order.includes(t.f)) goToFrame(t.f);
}

// ── laser ─────────────────────────────────────────────────────
const LASER = '#FF3B30';
let myLaser = [], remoteLaser = {}, laserRaf = 0, lastLaserSend = 0;
function setupLaser() {
  db.on(P.laser(jamId), v => {
    const now = performance.now();
    for (const [id, l] of Object.entries(v || {})) {
      if (id === uid) continue;
      const prev = remoteLaser[id];
      if (!prev || prev.p !== l.p) remoteLaser[id] = { ...l, recv: now };
    }
    kickLaser();
  });
  db.onDisconnectRemove(`${P.laser(jamId)}/${uid}`);
}
function laserDown(p) {
  myLaser.push({ x: p.x, y: p.y, t: performance.now() });
  kickLaser();
  drag = {
    kind: 'laser', coalesce: true,
    move(e, q) {
      myLaser.push({ x: q.x, y: q.y, t: performance.now() });
      if (performance.now() - lastLaserSend > 60) sendLaser();
      kickLaser();
    },
    up() {
      sendLaser();
      setTimeout(() => { if (!drag) db.remove(`${P.laser(jamId)}/${uid}`).catch(() => {}); }, 1400);
    }
  };
}
function sendLaser() {
  lastLaserSend = performance.now();
  const now = performance.now();
  const pts = myLaser.filter(q => now - q.t < 900).slice(-40);
  db.set(`${P.laser(jamId)}/${uid}`, { f: cur, p: pts.map(q => `${Math.round(q.x)},${Math.round(q.y)}`).join(';'), t: Date.now() }).catch(() => {});
}
function kickLaser() { if (!laserRaf) laserRaf = requestAnimationFrame(drawLaser); }
function trail(points, alphaOf, g) {
  for (let i = 1; i < points.length; i++) {
    const a = alphaOf(i);
    if (a <= 0.02) continue;
    const p0 = points[i - 1], p1 = points[i];
    el('line', { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, stroke: LASER, 'stroke-opacity': a * 0.28, 'stroke-width': 14, 'stroke-linecap': 'round' }, g);
    el('line', { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, stroke: LASER, 'stroke-opacity': a, 'stroke-width': 5, 'stroke-linecap': 'round' }, g);
  }
}
function drawLaser() {
  laserRaf = 0;
  laserLayer.innerHTML = '';
  const now = performance.now();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  myLaser = myLaser.filter(q => now - q.t < 900);
  trail(myLaser, i => reduce ? 1 : 1 - (now - myLaser[i].t) / 900, laserLayer);
  let active = myLaser.length > 0;
  for (const [id, l] of Object.entries(remoteLaser)) {
    const age = now - l.recv;
    if (age > 1200) { delete remoteLaser[id]; continue; }
    if (l.f !== cur || !l.p) continue;
    const pts = l.p.split(';').map(s => { const [x, y] = s.split(',').map(Number); return { x, y }; });
    const fade = 1 - age / 1200;
    trail(pts, i => fade * (0.25 + 0.75 * i / pts.length), laserLayer);
    active = true;
  }
  if (active) kickLaser();
}

// ── share / classroom controls (teacher) ──────────────────────
let shareM;
async function openShare() {
  if (!isOwner) return;
  shareM ||= modal('shareModal');
  const card = $('shareCard');
  if (meta.kind === 'copy' && meta.assignmentId) {
    card.innerHTML = '<p class="hint">Loading…</p>';
    shareM.open();
    const info = await db.get(`${P.assignment(meta.assignmentId)}/info`);
    const codeEntry = info?.code ? await db.get(P.code(info.code)) : null;
    assignmentInfo = info;
    renderCopyShare(info, codeEntry);
  } else {
    renderAssignForm();
    shareM.open();
  }
}
function renderAssignForm() {
  $('shareCard').innerHTML = `
    <div class="modal-title" id="shareTitle">Assign to students</div>
    <p class="hint" style="margin-bottom:var(--sp-4)">Students work on copies of this jam, so it stays clean as your template. You'll get a join code to put on the board.</p>
    <div class="field-row"><label class="field-label" for="asgTitle">Assignment title</label><input id="asgTitle" class="field" maxlength="80" value="${esc(meta.title || '')}"></div>
    <div class="field-row"><span class="field-label">How should students work?</span>
      <div class="mode-list" role="radiogroup">
        <label class="mode-opt"><input type="radio" name="asgMode" value="class" checked><div><b>Whole class</b><span>Everyone works together on one shared copy.</span></div></label>
        <label class="mode-opt"><input type="radio" name="asgMode" value="individual"><div><b>Individual</b><span>Each student gets their own copy, named after them.</span></div></label>
        <label class="mode-opt"><input type="radio" name="asgMode" value="groups"><div><b>Groups</b><span>Students pick a group number when they join.</span></div></label>
      </div></div>
    <div class="field-row" id="grpRow" hidden><label class="field-label" for="asgGroups">Number of groups</label><input id="asgGroups" type="number" class="field" min="2" max="12" value="4" style="max-width:120px"></div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="asgStart">Start &amp; get code</button></div>`;
  const card = $('shareCard');
  card.querySelectorAll('input[name="asgMode"]').forEach(r => r.onchange = () => { $('grpRow').hidden = card.querySelector('input[name="asgMode"]:checked').value !== 'groups'; });
  $('asgStart').onclick = async () => {
    const mode = card.querySelector('input[name="asgMode"]:checked').value;
    const groups = clamp(Number($('asgGroups').value) || 4, 2, 12);
    const title = $('asgTitle').value.trim() || meta.title || 'Jam';
    $('asgStart').disabled = true;
    try {
      const { aid, code } = await createAssignment(db, jamId, { title, mode, groupCount: groups });
      $('shareCard').innerHTML = `
        <div class="modal-title">Ready! Students join with this code</div>
        <div class="big-code" aria-label="Join code ${code.split('').join(' ')}">${code}</div>
        <p class="hint">Students go to <b>${esc(joinUrl().replace(/^https?:\/\//, ''))}</b> and type the code. Watch their work live from the dashboard.</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="presentNow">${'Present code'}</button>
          <a class="btn" style="display:inline-flex;align-items:center;text-decoration:none" href="dashboard.html?a=${aid}">Open in dashboard</a>
        </div>`;
      $('presentNow').onclick = () => presentCode(code, title);
    } catch (e) {
      console.error(e); toast('Could not start the assignment.', 'error');
      $('asgStart').disabled = false;
    }
  };
}
function renderCopyShare(info, codeEntry) {
  const card = $('shareCard');
  const code = info?.code;
  const open = !!codeEntry?.open;
  const mems = Object.entries(members).filter(([id]) => id !== uid);
  card.innerHTML = `
    <div class="modal-title" id="shareTitle">${esc(info?.title || meta.title)}</div>
    ${code ? `<span class="field-label">Join code</span><div class="big-code">${code}</div>` : ''}
    <div class="panel" style="margin:var(--sp-4) 0"><div class="panel-body" style="padding:var(--sp-2) var(--sp-4)">
      <div class="toggle-row"><span>Lock jam (view only for students)</span><button class="switch" role="switch" id="swLock" aria-checked="${!!meta.locked}" aria-label="Lock jam"></button></div>
      <div class="toggle-row"><span>Students can clear frames and delete others' work</span><button class="switch" role="switch" id="swClear" aria-checked="${!!meta.studentsCanClear}" aria-label="Students can clear"></button></div>
      ${code ? `<div class="toggle-row"><span>Joining open (code works)</span><button class="switch" role="switch" id="swOpen" aria-checked="${open}" aria-label="Joining open"></button></div>` : ''}
    </div></div>
    <span class="field-label">Students on this jam (${mems.length})</span>
    <div class="member-list">${mems.length ? mems.map(([id, m]) => `<div class="member-row"><span class="avatar h${hueIndex(id)}">${esc(initials(m.name))}</span><span class="grow">${esc(m.name)}</span><button class="btn btn-ghost sm" data-remove="${id}">Remove</button></div>`).join('') : '<p class="hint">No one has joined yet.</p>'}</div>
    <div class="modal-actions">
      ${code ? '<button class="btn btn-ghost" id="presentNow">Present code</button><button class="btn btn-ghost" id="newCode">New code</button>' : ''}
      <a class="btn btn-ghost" style="display:inline-flex;align-items:center;text-decoration:none" href="dashboard.html?a=${meta.assignmentId}">Dashboard</a>
      <button class="btn" data-close>Done</button>
    </div>`;
  const sw = (id, fn) => { const b = $(id); if (b) b.onclick = () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); fn(v); }; };
  sw('swLock', v => db.update({ [`${P.meta(jamId)}/locked`]: v }));
  sw('swClear', v => db.update({ [`${P.meta(jamId)}/studentsCanClear`]: v }));
  sw('swOpen', v => setJoinOpen(db, meta.assignmentId, code, v));
  if ($('presentNow')) $('presentNow').onclick = () => presentCode(info.code, info.title);
  if ($('newCode')) $('newCode').onclick = async () => {
    const ok = await ask({ title: 'Make a new join code?', message: 'The old code stops working. Students already on the jam stay.', input: false, ok: 'New code' });
    if (!ok) return;
    const c = await regenerateCode(db, meta.assignmentId, code);
    toast(`New code: ${c}`, 'ok');
    openShare();
  };
  card.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
    const id = b.dataset.remove;
    const ok = await ask({ title: `Remove ${members[id]?.name}?`, message: 'They lose access to this jam. Their notes stay. They can rejoin with the code if joining is open.', input: false, ok: 'Remove', danger: true });
    if (!ok) return;
    await db.update({ [`${P.members(jamId)}/${id}`]: null, [`${P.presence(jamId)}/${id}`]: null });
    toast('Removed', 'ok');
    openShare();
  });
}

// ── version history ───────────────────────────────────────────
let versionsM, versionPick = null, versionsCache = {};
function setupVersions() {
  versionsM = modal('versionsModal');
  $('nameVersion').onclick = async () => {
    const label = await ask({ title: 'Name this version', message: 'Saves a snapshot of every frame right now.', value: '' });
    if (!label) return;
    await saveVersion(label, false);
    toast('Version saved', 'ok');
    openVersions();
  };
  $('restoreVersion').onclick = restoreVersion;
}
async function saveVersion(label, auto) {
  const vid = newId('v');
  const now = Date.now();
  await db.update({
    [`${P.versions(jamId)}/${vid}`]: { createdAt: now, auto: !!auto, label: label || null, by: myName, snapshot: jamToSnapshot(jam) },
    [P.versionsLast(jamId)]: now
  });
}
async function maybeAutoVersion() {
  if (!jam || !started || !canEdit()) return;
  // one client snapshots: the teacher if they're here, otherwise the lowest-id student present
  const present = livePresence().map(p => p.id);
  const elected = present.includes(meta.ownerUid) ? meta.ownerUid : present.filter(id => members[id]).sort()[0];
  if (elected && elected !== uid) return;
  try {
    const last = (await db.get(P.versionsLast(jamId))) || 0;
    const touched = jam.touched || 0;
    if (touched > last && Date.now() - last >= 5 * 60 * 1000) await saveVersion(null, true);
  } catch (e) { /* not fatal */ }
}
async function openVersions() {
  if (!isOwner) return;
  versionsM.open();
  $('versionList').innerHTML = '<p class="hint">Loading…</p>';
  $('versionPreview').innerHTML = '<p class="hint">Pick a version to preview it.</p>';
  $('restoreVersion').disabled = true;
  versionPick = null;
  const v = (await db.get(P.versions(jamId))) || {};
  const ids = Object.keys(v).sort((a, b) => v[b].createdAt - v[a].createdAt);
  // keep the most recent 50
  if (ids.length > 50) {
    const m = {};
    ids.slice(50).forEach(id => m[`${P.versions(jamId)}/${id}`] = null);
    db.update(m).catch(() => {});
  }
  versionsCache = v;
  const list = ids.slice(0, 50);
  $('versionList').innerHTML = list.length ? list.map(id => `<button class="version-item" role="listitem" data-v="${id}" aria-pressed="false">
      <b>${esc(v[id].label || (v[id].auto ? 'Auto-save' : 'Saved version'))}</b>
      <span>${fmtDateTime(v[id].createdAt)} · ${asArray(v[id].snapshot?.frameOrder).length} frames${v[id].by ? ' · ' + esc(v[id].by) : ''}</span></button>`).join('')
    : '<p class="hint">No versions yet. SpaceJam saves one automatically every 5 minutes while people are editing, or you can name one now.</p>';
  $('versionList').querySelectorAll('[data-v]').forEach(b => b.onclick = () => previewVersion(b.dataset.v));
}
async function previewVersion(id) {
  versionPick = id;
  $('versionList').querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === id)));
  const snap = versionsCache[id]?.snapshot;
  const frames = asArray(snap?.frameOrder).map(f => snap.frames?.[f] || { bg: { type: 'blank' } });
  await preloadImages(frames);
  const box = $('versionPreview');
  box.innerHTML = '';
  frames.forEach(f => box.appendChild(renderFrameCanvas(f, 360)));
  $('restoreVersion').disabled = false;
}
async function restoreVersion() {
  const v = versionsCache[versionPick];
  if (!v) return;
  const ok = await ask({ title: 'Restore this version?', message: 'Every frame goes back to how it looked then. The current state is saved as a version first, so you can switch back.', input: false, ok: 'Restore' });
  if (!ok) return;
  await saveVersion('Before restore', false);
  const snap = v.snapshot;
  const nOrder = asArray(snap.frameOrder);
  await db.update({ [P.order(jamId)]: nOrder, [P.frames(jamId)]: snap.frames || {}, [P.touched(jamId)]: Date.now() });
  undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
  versionsM.close();
  toast('Version restored', 'ok');
}

function preloadFontsFor(fid) {
  const names = [];
  for (const o of Object.values(remoteObjects(fid))) {
    if (o.type === 'sticky') names.push(o.font || M.DEFAULT_NOTE_FONT);
    if (o.type === 'text') names.push(o.font || M.DEFAULT_TEXT_FONT);
  }
  if (names.length) loadFonts(names);
}
