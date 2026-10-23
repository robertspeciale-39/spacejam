// Text layout shared by the live SVG view and the canvas exporter, so a note
// looks identical on screen, in thumbnails, and in the PDF.
import { fontsVersion } from './fonts.js';

const mctx = document.createElement('canvas').getContext('2d');
const cache = new Map();
let cacheVer = -1;

export function fontStr(family, size, bold, italic) {
  return `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px "${family}", "Inter", sans-serif`;
}

function measure(s) { return mctx.measureText(s).width; }

function wrap(text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (measure(test) <= maxW) { line = test; continue; }
      if (line) out.push(line);
      if (measure(word) <= maxW) { line = word; continue; }
      // break a long word by characters
      let chunk = '';
      for (const ch of word) {
        if (measure(chunk + ch) > maxW && chunk) { out.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

function cached(key, fn) {
  if (cacheVer !== fontsVersion) { cache.clear(); cacheVer = fontsVersion; }
  let v = cache.get(key);
  if (!v) {
    v = fn();
    if (cache.size > 2000) cache.clear();
    cache.set(key, v);
  }
  return v;
}

export function clearTextCache() { cache.clear(); }

/** Sticky note: text auto-shrinks to fit, centred both ways. */
export function layoutSticky(o) {
  const text = o.text || '';
  const font = o.font || 'Patrick Hand';
  const key = `s|${font}|${o.w}|${o.h}|${text}`;
  return cached(key, () => {
    const pad = Math.max(8, Math.min(o.w, o.h) * 0.08);
    const aw = o.w - pad * 2, ah = o.h - pad * 2;
    if (!text.trim()) return { size: 24, lineH: 29, lines: [], anchor: 'middle' };
    let lo = 8, hi = 120, best = 8, bestLines = null;
    const words = text.split(/\s+/).filter(Boolean);
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      mctx.font = fontStr(font, mid, false, false);
      const lines = wrap(text, aw);
      // prefer a smaller size over splitting a word across lines
      const wordsFit = mid <= 14 || words.every(w => measure(w) <= aw + 0.5);
      const fits = wordsFit && lines.length * mid * 1.2 <= ah && lines.every(l => measure(l) <= aw + 0.5);
      if (fits) { best = mid; bestLines = lines; lo = mid + 1; } else hi = mid - 1;
    }
    if (!bestLines) { mctx.font = fontStr(font, best, false, false); bestLines = wrap(text, aw); }
    const lineH = best * 1.2;
    const top = pad + Math.max(0, (ah - bestLines.length * lineH) / 2);
    return {
      size: best, lineH, anchor: 'middle',
      lines: bestLines.map((t, i) => ({ text: t, x: o.w / 2, y: top + i * lineH + lineH / 2 + best * 0.35 }))
    };
  });
}

export const TEXT_PAD = 6;

/** Text box: fixed font size, wraps to the box width, height grows with content. */
export function layoutText(o) {
  const text = o.text || '';
  const font = o.font || 'Inter';
  const size = o.size || 32;
  const key = `t|${font}|${size}|${o.bold ? 1 : 0}|${o.italic ? 1 : 0}|${o.align}|${o.w}|${text}`;
  return cached(key, () => {
    mctx.font = fontStr(font, size, o.bold, o.italic);
    const lines = wrap(text || ' ', Math.max(10, o.w - TEXT_PAD * 2));
    const lineH = size * 1.25;
    const align = o.align || 'left';
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const x = align === 'center' ? o.w / 2 : align === 'right' ? o.w - TEXT_PAD : TEXT_PAD;
    return {
      size, lineH, anchor,
      height: lines.length * lineH + TEXT_PAD * 2,
      lines: lines.map((t, i) => ({ text: t, x, y: TEXT_PAD + i * lineH + lineH / 2 + size * 0.35 }))
    };
  });
}
