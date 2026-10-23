// Rendering: the same geometry feeds the live SVG board and the canvas renderer
// (thumbnails, PNG, PDF). Paths are built once as SVG path strings; canvas draws
// them through Path2D, so both outputs match.
import {
  FRAME_W, FRAME_H, noteHex, NOTE_TEXT, penStyle, parsePts, sortedObjects,
  BG_PAPER, BG_CHALK, BG_LINE, BG_LINE_SOFT, BG_RULE
} from './model.js';
import { layoutSticky, layoutText, fontStr } from './textfit.js';
import { esc } from './util.js';

const r1 = n => Math.round(n * 10) / 10;

// ── strokes ───────────────────────────────────────────────────
function smoothD(seg) {
  if (seg.length === 1) return `M${r1(seg[0].x)} ${r1(seg[0].y)}l0.01 0`;
  if (seg.length === 2) return `M${r1(seg[0].x)} ${r1(seg[0].y)}L${r1(seg[1].x)} ${r1(seg[1].y)}`;
  let d = `M${r1(seg[0].x)} ${r1(seg[0].y)}`;
  for (let i = 1; i < seg.length - 1; i++) {
    const p = seg[i], n = seg[i + 1];
    d += `Q${r1(p.x)} ${r1(p.y)} ${r1((p.x + n.x) / 2)} ${r1((p.y + n.y) / 2)}`;
  }
  const l = seg[seg.length - 1];
  return d + `L${r1(l.x)} ${r1(l.y)}`;
}

function brushOutline(seg, base) {
  const w = i => (seg[i].w ?? base) / 2;
  if (seg.length === 1) {
    const { x, y } = seg[0], r = w(0);
    return `M${r1(x - r)} ${r1(y)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(r * 2)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-r * 2)} 0Z`;
  }
  const L = [], R = [];
  for (let i = 0; i < seg.length; i++) {
    const a = seg[Math.max(0, i - 1)], b = seg[Math.min(seg.length - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy * w(i), ny = dx * w(i);
    L.push([seg[i].x + nx, seg[i].y + ny]);
    R.push([seg[i].x - nx, seg[i].y - ny]);
  }
  const last = seg.length - 1;
  let d = `M${r1(L[0][0])} ${r1(L[0][1])}`;
  for (let i = 1; i < L.length; i++) d += `L${r1(L[i][0])} ${r1(L[i][1])}`;
  d += `A${r1(w(last))} ${r1(w(last))} 0 0 1 ${r1(R[last][0])} ${r1(R[last][1])}`;
  for (let i = R.length - 2; i >= 0; i--) d += `L${r1(R[i][0])} ${r1(R[i][1])}`;
  d += `A${r1(w(0))} ${r1(w(0))} 0 0 1 ${r1(L[0][0])} ${r1(L[0][1])}Z`;
  return d;
}

/** Returns { d, fill } : fill=true → filled outline (brush), else stroked path. */
export function strokeGeometry(o) {
  const segs = parsePts(o.pts);
  const width = o.width || penStyle(o.tool).width;
  if (o.tool === 'brush') return { d: segs.map(s => brushOutline(s, width)).join(''), fill: true, width };
  return { d: segs.map(smoothD).join(''), fill: false, width };
}

// ── shapes ────────────────────────────────────────────────────
export function shapeGeometry(o) {
  const sw = o.stroke === 'none' ? 0 : (o.sw ?? 4);
  const i = sw / 2, w = o.w, h = o.h;
  const x0 = i, y0 = i, x1 = Math.max(i, w - i), y1 = Math.max(i, h - i);
  const cw = x1 - x0, ch = y1 - y0;
  let d = '', head = '';
  switch (o.kind) {
    case 'ellipse': {
      const rx = cw / 2, ry = ch / 2, cy = y0 + ry;
      d = `M${r1(x0)} ${r1(cy)}A${r1(rx)} ${r1(ry)} 0 1 0 ${r1(x1)} ${r1(cy)}A${r1(rx)} ${r1(ry)} 0 1 0 ${r1(x0)} ${r1(cy)}Z`;
      break;
    }
    case 'rounded': {
      const rr = Math.min(cw, ch) * 0.14;
      d = `M${r1(x0 + rr)} ${r1(y0)}H${r1(x1 - rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x1)} ${r1(y0 + rr)}V${r1(y1 - rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x1 - rr)} ${r1(y1)}H${r1(x0 + rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x0)} ${r1(y1 - rr)}V${r1(y0 + rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x0 + rr)} ${r1(y0)}Z`;
      break;
    }
    case 'triangle':
      d = `M${r1(x0 + cw / 2)} ${r1(y0)}L${r1(x1)} ${r1(y1)}L${r1(x0)} ${r1(y1)}Z`; break;
    case 'diamond':
      d = `M${r1(x0 + cw / 2)} ${r1(y0)}L${r1(x1)} ${r1(y0 + ch / 2)}L${r1(x0 + cw / 2)} ${r1(y1)}L${r1(x0)} ${r1(y0 + ch / 2)}Z`; break;
    case 'line':
    case 'arrow': {
      const sx = o.flipX ? w : 0, sy = o.flipY ? h : 0, ex = o.flipX ? 0 : w, ey = o.flipY ? 0 : h;
      if (o.kind === 'arrow') {
        const ang = Math.atan2(ey - sy, ex - sx);
        const hl = Math.max(16, (o.sw ?? 4) * 4), hw = hl * 0.6;
        const bx = ex - Math.cos(ang) * hl, by = ey - Math.sin(ang) * hl;
        d = `M${r1(sx)} ${r1(sy)}L${r1(bx)} ${r1(by)}`;
        head = `M${r1(ex)} ${r1(ey)}L${r1(bx - Math.sin(ang) * hw)} ${r1(by + Math.cos(ang) * hw)}L${r1(bx + Math.sin(ang) * hw)} ${r1(by - Math.cos(ang) * hw)}Z`;
      } else d = `M${r1(sx)} ${r1(sy)}L${r1(ex)} ${r1(ey)}`;
      break;
    }
    default: // rect
      d = `M${r1(x0)} ${r1(y0)}H${r1(x1)}V${r1(y1)}H${r1(x0)}Z`;
  }
  const isLine = o.kind === 'line' || o.kind === 'arrow';
  return { d, head, sw: isLine ? Math.max(1, o.sw ?? 4) : sw, isLine };
}

// ── SVG markup ────────────────────────────────────────────────
function textSVG(lay, family, color, bold, italic) {
  return `<text font-family="'${esc(family)}', Inter, sans-serif" font-size="${r1(lay.size)}" font-weight="${bold ? 700 : 400}"${italic ? ' font-style="italic"' : ''} fill="${color}" text-anchor="${lay.anchor}" xml:space="preserve">${
    lay.lines.map(l => `<tspan x="${r1(l.x)}" y="${r1(l.y)}">${esc(l.text) || ' '}</tspan>`).join('')
  }</text>`;
}

export function objectTransform(o) {
  return `translate(${r1(o.x)} ${r1(o.y)})${o.rot ? ` rotate(${r1(o.rot)} ${r1(o.w / 2)} ${r1(o.h / 2)})` : ''}`;
}

/** Inner SVG for an object in its local box (0..w, 0..h). */
export function objectInnerSVG(o, opts = {}) {
  switch (o.type) {
    case 'sticky': {
      const lay = layoutSticky(o);
      return `<rect class="note-bg" width="${r1(o.w)}" height="${r1(o.h)}" rx="3" fill="${noteHex(o.color)}" filter="url(#sj-shadow)"/>` +
        (opts.hideText ? '' : textSVG(lay, o.font || 'Patrick Hand', NOTE_TEXT, false, false));
    }
    case 'text': {
      const lay = layoutText(o);
      const hit = `<rect width="${r1(o.w)}" height="${r1(o.h)}" fill="transparent"/>`;
      return hit + (opts.hideText ? '' : textSVG(lay, o.font || 'Inter', o.color || '#202124', o.bold, o.italic));
    }
    case 'shape': {
      const g = shapeGeometry(o);
      const hit = g.isLine
        ? `<path d="${g.d}" stroke="transparent" stroke-width="${g.sw + 18}" fill="none"/>`
        : (o.fill === 'none' ? `<path d="${g.d}" fill="none" stroke="transparent" stroke-width="${g.sw + 14}"/>` : '');
      const body = g.isLine
        ? `<path d="${g.d}" stroke="${o.stroke}" stroke-width="${g.sw}" stroke-linecap="round" fill="none"/>` +
          (g.head ? `<path d="${g.head}" fill="${o.stroke}" stroke="${o.stroke}" stroke-width="${Math.min(g.sw, 4)}" stroke-linejoin="round"/>` : '')
        : `<path d="${g.d}" fill="${o.fill || 'none'}" stroke="${o.stroke === 'none' ? 'none' : o.stroke}" stroke-width="${g.sw}" stroke-linejoin="round"/>`;
      return hit + body;
    }
    case 'image':
      return `<image href="${o.src}" width="${r1(o.w)}" height="${r1(o.h)}" preserveAspectRatio="none"/>`;
    case 'stroke': {
      const g = strokeGeometry(o);
      const st = penStyle(o.tool);
      const sx = o.w / (o.pw || o.w || 1), sy = o.h / (o.ph || o.h || 1);
      const tf = (Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3) ? ` transform="scale(${sx} ${sy})"` : '';
      const hit = `<path d="${g.d}" fill="none" stroke="transparent" stroke-width="${g.width + 16}" stroke-linecap="round" stroke-linejoin="round"/>`;
      const body = g.fill
        ? `<path d="${g.d}" fill="${o.color}" fill-opacity="${st.opacity}"/>`
        : `<path d="${g.d}" fill="none" stroke="${o.color}" stroke-opacity="${st.opacity}" stroke-width="${g.width}" stroke-linecap="round" stroke-linejoin="round"/>`;
      return `<g${tf}>${hit}${body}</g>`;
    }
  }
  return '';
}

export function backgroundSVG(bg, idp = 'bg') {
  const t = bg?.type || 'blank';
  const W = FRAME_W, H = FRAME_H;
  if (t === 'image' && bg.src) {
    return `<rect width="${W}" height="${H}" fill="${BG_PAPER}"/><image href="${bg.src}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`;
  }
  if (t === 'chalkboard') return `<rect width="${W}" height="${H}" fill="${BG_CHALK}"/>`;
  const paper = `<rect width="${W}" height="${H}" fill="${BG_PAPER}"/>`;
  let pat = '';
  if (t === 'dots') pat = `<pattern id="${idp}" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="2.4" fill="${BG_LINE}"/></pattern>`;
  else if (t === 'lines') pat = `<pattern id="${idp}" width="${W}" height="45" patternUnits="userSpaceOnUse"><path d="M0 44.5H${W}" stroke="${BG_RULE}" stroke-width="2"/></pattern>`;
  else if (t === 'squares') pat = `<pattern id="${idp}" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0V50H0" fill="none" stroke="${BG_LINE}" stroke-width="1.5"/></pattern>`;
  else if (t === 'graph') pat = `<pattern id="${idp}" width="100" height="100" patternUnits="userSpaceOnUse">${
    [20, 40, 60, 80].map(v => `<path d="M${v} 0V100M0 ${v}H100" stroke="${BG_LINE_SOFT}" stroke-width="1"/>`).join('')
  }<path d="M100 0V100H0" fill="none" stroke="${BG_LINE}" stroke-width="2"/></pattern>`;
  if (!pat) return paper;
  return paper + `<defs>${pat}</defs><rect width="${W}" height="${H}" fill="url(#${idp})"/>`;
}

export const SVG_DEFS = `<defs><filter id="sj-shadow" x="-10%" y="-10%" width="125%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="3.5" flood-color="#000" flood-opacity="0.22"/></filter></defs>`;

/** Full static SVG string of a frame (used for lightweight previews). */
export function frameSVG(frame, { width = 320 } = {}) {
  const objs = sortedObjects(frame?.objects);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAME_W} ${FRAME_H}" width="${width}" height="${Math.round(width * FRAME_H / FRAME_W)}">${SVG_DEFS}${backgroundSVG(frame?.bg, 'p' + Math.random().toString(36).slice(2, 7))}${
    objs.map(o => `<g transform="${objectTransform(o)}">${objectInnerSVG(o)}</g>`).join('')
  }</svg>`;
}

// ── Canvas renderer ───────────────────────────────────────────
const imgCache = new Map();
export function getImage(src, onReady) {
  let e = imgCache.get(src);
  if (!e) {
    const img = new Image();
    e = { img, ready: false, waiters: new Set() };
    imgCache.set(src, e);
    img.onload = () => { e.ready = true; e.waiters.forEach(f => f()); e.waiters.clear(); };
    img.onerror = () => { e.failed = true; e.waiters.forEach(f => f()); e.waiters.clear(); };
    img.src = src;
  }
  if (!e.ready && onReady) e.waiters.add(onReady);
  return e;
}
export function preloadImages(frames) {
  const srcs = [];
  for (const f of frames) {
    if (f?.bg?.type === 'image' && f.bg.src) srcs.push(f.bg.src);
    for (const o of Object.values(f?.objects || {})) if (o.type === 'image' && o.src) srcs.push(o.src);
  }
  return Promise.all(srcs.map(s => new Promise(res => {
    const e = getImage(s, res);
    if (e.ready || e.failed) res();
  })));
}

function drawBackground(ctx, bg, onAsync) {
  const t = bg?.type || 'blank';
  const W = FRAME_W, H = FRAME_H;
  ctx.fillStyle = t === 'chalkboard' ? BG_CHALK : BG_PAPER;
  ctx.fillRect(0, 0, W, H);
  if (t === 'image' && bg.src) {
    const e = getImage(bg.src, onAsync);
    if (e.ready) {
      const { naturalWidth: iw, naturalHeight: ih } = e.img;
      const s = Math.max(W / iw, H / ih);
      ctx.drawImage(e.img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    }
    return;
  }
  ctx.save();
  if (t === 'dots') {
    ctx.fillStyle = BG_LINE;
    for (let x = 20; x < W; x += 40) for (let y = 20; y < H; y += 40) { ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill(); }
  } else if (t === 'lines') {
    ctx.strokeStyle = BG_RULE; ctx.lineWidth = 2;
    for (let y = 44.5; y < H; y += 45) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } else if (t === 'squares') {
    ctx.strokeStyle = BG_LINE; ctx.lineWidth = 1.5;
    for (let x = 50; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 50; y < H; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } else if (t === 'graph') {
    ctx.strokeStyle = BG_LINE_SOFT; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 20) if (x % 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 20) if (y % 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = BG_LINE; ctx.lineWidth = 2;
    for (let x = 100; x < W; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 100; y < H; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }
  ctx.restore();
}

function drawText(ctx, lay, family, color, bold, italic) {
  ctx.fillStyle = color;
  ctx.font = fontStr(family, lay.size, bold, italic);
  ctx.textAlign = lay.anchor === 'middle' ? 'center' : lay.anchor === 'end' ? 'right' : 'left';
  ctx.textBaseline = 'alphabetic';
  for (const l of lay.lines) ctx.fillText(l.text, l.x, l.y);
}

function drawObject(ctx, o, onAsync) {
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.rot) {
    ctx.translate(o.w / 2, o.h / 2);
    ctx.rotate(o.rot * Math.PI / 180);
    ctx.translate(-o.w / 2, -o.h / 2);
  }
  switch (o.type) {
    case 'sticky': {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 3;
      ctx.fillStyle = noteHex(o.color);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, 0, o.w, o.h, 3); else ctx.rect(0, 0, o.w, o.h);
      ctx.fill();
      ctx.restore();
      drawText(ctx, layoutSticky(o), o.font || 'Patrick Hand', NOTE_TEXT, false, false);
      break;
    }
    case 'text':
      drawText(ctx, layoutText(o), o.font || 'Inter', o.color || '#202124', o.bold, o.italic);
      break;
    case 'shape': {
      const g = shapeGeometry(o);
      const p = new Path2D(g.d);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (!g.isLine && o.fill && o.fill !== 'none') { ctx.fillStyle = o.fill; ctx.fill(p); }
      if (g.sw > 0 && o.stroke !== 'none') { ctx.strokeStyle = o.stroke; ctx.lineWidth = g.sw; ctx.stroke(p); }
      if (g.head) {
        const hp = new Path2D(g.head);
        ctx.fillStyle = o.stroke; ctx.fill(hp);
        ctx.lineWidth = Math.min(g.sw, 4); ctx.strokeStyle = o.stroke; ctx.stroke(hp);
      }
      break;
    }
    case 'image': {
      const e = getImage(o.src, onAsync);
      if (e.ready) ctx.drawImage(e.img, 0, 0, o.w, o.h);
      else { ctx.fillStyle = '#E8EAED'; ctx.fillRect(0, 0, o.w, o.h); }
      break;
    }
    case 'stroke': {
      const g = strokeGeometry(o);
      const st = penStyle(o.tool);
      ctx.scale(o.w / (o.pw || o.w || 1), o.h / (o.ph || o.h || 1));
      const p = new Path2D(g.d);
      ctx.globalAlpha = st.opacity;
      if (g.fill) { ctx.fillStyle = o.color; ctx.fill(p); }
      else { ctx.strokeStyle = o.color; ctx.lineWidth = g.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(p); }
      break;
    }
  }
  ctx.restore();
}

/**
 * Draw one frame onto a canvas context at the given pixel scale.
 * onAsync is called if an image finishes loading later (re-render then).
 */
export function drawFrame(ctx, frame, scale = 1, onAsync) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawBackground(ctx, frame?.bg, onAsync);
  for (const o of sortedObjects(frame?.objects)) drawObject(ctx, o, onAsync);
  ctx.restore();
}

export function renderFrameCanvas(frame, pxWidth, onAsync) {
  const c = document.createElement('canvas');
  const s = pxWidth / FRAME_W;
  c.width = Math.round(FRAME_W * s);
  c.height = Math.round(FRAME_H * s);
  drawFrame(c.getContext('2d'), frame, s, onAsync);
  return c;
}

/** Paint a frame into an existing canvas element sized for thumbnails. */
export function paintThumb(canvas, frame) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 200;
  const w = Math.round(cssW * dpr), h = Math.round(w * FRAME_H / FRAME_W);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  const again = () => paintThumb(canvas, frame);
  drawFrame(ctx, frame, w / FRAME_W, again);
}
