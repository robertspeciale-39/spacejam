// Board constants and object helpers shared by the board, renderers, and dashboard.
// Content colours live here (they're data, saved with the jam), not in the CSS theme.

export const FRAME_W = 1600;
export const FRAME_H = 900;
export const MAX_FRAMES = 20;
export const MAX_IMAGES_PER_FRAME = 10;
export const MAX_NOTE_CHARS = 500;
export const MAX_IMAGE_BYTES = 300 * 1024;

export const NOTE_COLORS = [
  { id: 'yellow', name: 'Yellow', hex: '#FFF59D' },
  { id: 'orange', name: 'Orange', hex: '#FFCC80' },
  { id: 'pink',   name: 'Pink',   hex: '#F8BBD0' },
  { id: 'green',  name: 'Green',  hex: '#C5E1A5' },
  { id: 'blue',   name: 'Blue',   hex: '#B3E5FC' },
  { id: 'purple', name: 'Purple', hex: '#D1C4E9' }
];
export const noteHex = id => (NOTE_COLORS.find(c => c.id === id) || NOTE_COLORS[0]).hex;
export const NOTE_TEXT = '#202124';

export const INK_COLORS = [
  { id: 'black',  name: 'Black',  hex: '#202124' },
  { id: 'blue',   name: 'Blue',   hex: '#1A73E8' },
  { id: 'green',  name: 'Green',  hex: '#188038' },
  { id: 'yellow', name: 'Yellow', hex: '#F9AB00' },
  { id: 'red',    name: 'Red',    hex: '#D93025' },
  { id: 'white',  name: 'White',  hex: '#FFFFFF' }
];
export const SHAPE_COLORS = [
  { name: 'None',   hex: 'none' },
  { name: 'Black',  hex: '#202124' },
  { name: 'White',  hex: '#FFFFFF' },
  { name: 'Blue',   hex: '#1A73E8' },
  { name: 'Light blue', hex: '#A8C7FA' },
  { name: 'Green',  hex: '#188038' },
  { name: 'Light green', hex: '#B7E1C1' },
  { name: 'Yellow', hex: '#F9AB00' },
  { name: 'Light yellow', hex: '#FFE69C' },
  { name: 'Red',    hex: '#D93025' },
  { name: 'Light red', hex: '#F6AEA9' },
  { name: 'Purple', hex: '#9334E6' }
];

export const PEN_STYLES = [
  { id: 'pen',         name: 'Pen',         width: 4,  opacity: 1 },
  { id: 'marker',      name: 'Marker',      width: 10, opacity: 1 },
  { id: 'highlighter', name: 'Highlighter', width: 26, opacity: 0.38 },
  { id: 'brush',       name: 'Brush',       width: 14, opacity: 1 }
];
export const penStyle = id => PEN_STYLES.find(p => p.id === id) || PEN_STYLES[0];

export const SHAPES = [
  { id: 'ellipse',  name: 'Circle' },
  { id: 'rect',     name: 'Square' },
  { id: 'rounded',  name: 'Rounded rectangle' },
  { id: 'triangle', name: 'Triangle' },
  { id: 'diamond',  name: 'Diamond' },
  { id: 'line',     name: 'Line' },
  { id: 'arrow',    name: 'Arrow' }
];

export const BACKGROUNDS = [
  { id: 'blank',      name: 'Blank' },
  { id: 'dots',       name: 'Dots' },
  { id: 'lines',      name: 'Lines' },
  { id: 'squares',    name: 'Squares' },
  { id: 'graph',      name: 'Graph' },
  { id: 'chalkboard', name: 'Chalkboard' }
];
export const BG_PAPER = '#FFFFFF';
export const BG_CHALK = '#2B4A3C';
export const BG_LINE = '#D3D8DD';
export const BG_LINE_SOFT = '#E6E9EC';
export const BG_RULE = '#BFD4F2';

// Curated Google Fonts. bold:true → request weight 700 too (only where it exists,
// because the Google Fonts API rejects the whole request for a missing weight).
export const FONTS = [
  { name: 'Inter', group: 'Clean sans', bold: true },
  { name: 'Roboto', group: 'Clean sans', bold: true },
  { name: 'Open Sans', group: 'Clean sans', bold: true },
  { name: 'Lato', group: 'Clean sans', bold: true },
  { name: 'Montserrat', group: 'Clean sans', bold: true },
  { name: 'Poppins', group: 'Clean sans', bold: true },
  { name: 'Nunito', group: 'Clean sans', bold: true },
  { name: 'Work Sans', group: 'Clean sans', bold: true },
  { name: 'Rubik', group: 'Clean sans', bold: true },
  { name: 'Source Sans 3', group: 'Clean sans', bold: true },
  { name: 'Lexend', group: 'Readability', bold: true },
  { name: 'Atkinson Hyperlegible', group: 'Readability', bold: true },
  { name: 'Merriweather', group: 'Serif', bold: true },
  { name: 'Lora', group: 'Serif', bold: true },
  { name: 'Playfair Display', group: 'Serif', bold: true },
  { name: 'Roboto Slab', group: 'Serif', bold: true },
  { name: 'Oswald', group: 'Display', bold: true },
  { name: 'Bebas Neue', group: 'Display', bold: false },
  { name: 'Righteous', group: 'Display', bold: false },
  { name: 'Bangers', group: 'Display', bold: false },
  { name: 'Lobster', group: 'Display', bold: false },
  { name: 'Pacifico', group: 'Display', bold: false },
  { name: 'Caveat', group: 'Handwritten', bold: true },
  { name: 'Patrick Hand', group: 'Handwritten', bold: false },
  { name: 'Indie Flower', group: 'Handwritten', bold: false },
  { name: 'Kalam', group: 'Handwritten', bold: true },
  { name: 'Shadows Into Light', group: 'Handwritten', bold: false },
  { name: 'Permanent Marker', group: 'Handwritten', bold: false },
  { name: 'Gloria Hallelujah', group: 'Handwritten', bold: false },
  { name: 'Amatic SC', group: 'Handwritten', bold: true },
  { name: 'JetBrains Mono', group: 'Mono / retro', bold: true },
  { name: 'Press Start 2P', group: 'Mono / retro', bold: false }
];
export const DEFAULT_NOTE_FONT = 'Patrick Hand';
export const DEFAULT_TEXT_FONT = 'Inter';

// ── object helpers ──────────────────────────────────────────

export function center(o) { return { x: o.x + o.w / 2, y: o.y + o.h / 2 }; }

export function rotatePt(p, c, deg) {
  if (!deg) return { x: p.x, y: p.y };
  const a = deg * Math.PI / 180, s = Math.sin(a), co = Math.cos(a);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
}

/** Axis-aligned bounding box of a (possibly rotated) object. */
export function aabb(o) {
  const c = center(o);
  const pts = [
    { x: o.x, y: o.y }, { x: o.x + o.w, y: o.y },
    { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }
  ].map(p => rotatePt(p, c, o.rot || 0));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

export function sortedObjects(objects) {
  return Object.entries(objects || {})
    .map(([id, o]) => ({ ...o, id }))
    .sort((a, b) => (a.z || 0) - (b.z || 0) || (a.id < b.id ? -1 : 1));
}

export function maxZ(objects) {
  let m = 0;
  for (const o of Object.values(objects || {})) m = Math.max(m, o.z || 0);
  return m;
}
export function minZ(objects) {
  let m = 0;
  for (const o of Object.values(objects || {})) m = Math.min(m, o.z || 0);
  return m;
}

/** Parse stroke point data "x,y[,w];x,y[,w]|x,y;..." into segments of {x,y,w}. */
export function parsePts(s) {
  if (!s) return [];
  return String(s).split('|').map(seg => seg.split(';').filter(Boolean).map(p => {
    const [x, y, w] = p.split(',').map(Number);
    return { x, y, w: Number.isFinite(w) ? w : undefined };
  })).filter(seg => seg.length);
}
export function serializePts(segs) {
  const r = n => Math.round(n * 10) / 10;
  return segs.filter(s => s.length).map(seg => seg.map(p =>
    p.w !== undefined ? `${r(p.x)},${r(p.y)},${r(p.w)}` : `${r(p.x)},${r(p.y)}`
  ).join(';')).join('|');
}
