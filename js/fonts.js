// On-demand Google Fonts loading for board content (sticky notes and text boxes).
// The interface itself only ever uses Inter + JetBrains Mono (CyberSpesh v3).
import { FONTS } from './model.js';

const requested = new Set();
const previewed = new Set();
const listeners = new Set();
export let fontsVersion = 0;

function fontMeta(name) { return FONTS.find(f => f.name === name); }
function familyParam(name) { return encodeURIComponent(name).replace(/%20/g, '+'); }

function addLink(href) {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
  return l;
}

/** Load the full font (regular + bold where available). Resolves when usable. */
const sheetReady = new Map();
export function loadFont(name) {
  const meta = fontMeta(name);
  if (!meta) return Promise.resolve();
  if (!requested.has(name)) {
    requested.add(name);
    const w = meta.bold ? ':wght@400;700' : '';
    const link = addLink(`https://fonts.googleapis.com/css2?family=${familyParam(name)}${w}&display=swap`);
    sheetReady.set(name, new Promise(res => {
      link.onload = res; link.onerror = res; setTimeout(res, 6000);
    }));
  }
  return sheetReady.get(name).then(() => {
    const loads = [document.fonts.load(`400 32px "${name}"`)];
    if (meta.bold) loads.push(document.fonts.load(`700 32px "${name}"`));
    return Promise.all(loads);
  }).catch(() => {}).then(() => undefined);
}

export function loadFonts(names) {
  return Promise.all([...new Set(names)].filter(Boolean).map(loadFont));
}

/** Tiny glyph-subset load so the font menu can show each name in its own face. */
export function loadPreviews() {
  for (const f of FONTS) {
    if (previewed.has(f.name) || requested.has(f.name)) continue;
    previewed.add(f.name);
    addLink(`https://fonts.googleapis.com/css2?family=${familyParam(f.name)}&text=${encodeURIComponent(f.name)}&display=swap`);
  }
}

/** Called whenever a font finishes loading; text must be re-measured. */
export function onFontsChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); }

if (document.fonts) {
  document.fonts.addEventListener('loadingdone', () => {
    fontsVersion++;
    listeners.forEach(cb => cb());
  });
}

export function fontOptionsHTML(selected) {
  const groups = {};
  for (const f of FONTS) (groups[f.group] ||= []).push(f);
  return Object.entries(groups).map(([g, list]) =>
    `<optgroup label="${g}">${list.map(f =>
      `<option value="${f.name}" style="font-family:'${f.name}'"${f.name === selected ? ' selected' : ''}>${f.name}</option>`
    ).join('')}</optgroup>`
  ).join('');
}
