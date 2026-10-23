/* CyberSpesh Design System v3: rain + theme controller (shared key cs_theme) */
// ══════════════════════════════════════════
//  MATRIX RAIN — repalettes itself per theme
// ══════════════════════════════════════════
(function(){
  const canvas = document.getElementById('matrix-rain');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF<>{}[]|/\\';
  let cols, drops;
  function resize() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    cols = Math.floor(canvas.width / 16);
    drops = Array.from({length: cols}, () => Math.random() * -50);
  }
  resize();
  window.addEventListener('resize', resize);
  let PAL = {bg: '#05070a', primary: '#35d67d', bright: '#eafff2'};
  window.csRefreshRainPalette = function () {
    const cs = getComputedStyle(document.body);
    PAL = {
      bg:      cs.getPropertyValue('--bg').trim()          || PAL.bg,
      primary: cs.getPropertyValue('--primary').trim()     || PAL.primary,
      bright:  cs.getPropertyValue('--text-bright').trim() || PAL.bright
    };
  };
  window.csRefreshRainPalette();
  function draw() {
    ctx.globalAlpha = 0.18; ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1; ctx.font = '13px JetBrains Mono, monospace';
    drops.forEach((y, i) => {
      const ch = CHARS[Math.floor(Math.random() * CHARS.length)];
      ctx.fillStyle = Math.random() > 0.96 ? PAL.bright : PAL.primary;
      ctx.fillText(ch, i * 16, y * 16);
      if (y * 16 > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i] += 0.5 + Math.random() * 0.5;
    });
  }
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(draw, 50);
})();

// ══════════════════════════════════════════
//  THEME CONTROLLER — persists across apps
// ══════════════════════════════════════════
const CS_THEMES = ['matrix', 'arctic', 'crimson', 'tokyo', 'galaxy'];

function csSetTheme(name, persist) {
  if (!CS_THEMES.includes(name)) name = 'matrix';
  document.body.classList.remove(...CS_THEMES);
  document.body.classList.add(name);
  document.querySelectorAll('.theme-btn').forEach(b => {
    const on = b.dataset.theme === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  if (window.csRefreshRainPalette) window.csRefreshRainPalette();
  if (persist !== false) { try { localStorage.setItem('cs_theme', name); } catch (e) {} }
}

(function initTheme() {
  let saved = 'matrix';
  try { saved = localStorage.getItem('cs_theme') || 'matrix'; } catch (e) {}
  csSetTheme(saved, false);
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.addEventListener('click', () => csSetTheme(b.dataset.theme));
  });
})();

//
