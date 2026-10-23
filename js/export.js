// Export: PNG (one frame) and PDF (all frames). No libraries — the PDF writer
// below embeds one JPEG per landscape page, which is all a whiteboard needs.
import { renderFrameCanvas, preloadImages } from './render.js';
import { loadFonts } from './fonts.js';
import { downloadBlob, safeFilename } from './util.js';

function fontsIn(frames) {
  const names = [];
  for (const f of frames) for (const o of Object.values(f?.objects || {})) {
    if (o.type === 'sticky') names.push(o.font || 'Patrick Hand');
    if (o.type === 'text') names.push(o.font || 'Inter');
  }
  return names;
}

async function ready(frames) {
  await Promise.all([loadFonts(fontsIn(frames)), preloadImages(frames)]);
  if (document.fonts?.ready) await document.fonts.ready;
}

export async function exportPNG(frame, title, frameNo) {
  await ready([frame]);
  const c = renderFrameCanvas(frame, 3200);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  downloadBlob(blob, `${safeFilename(title)} - frame ${frameNo}.png`);
}

export async function exportPDF(frames, title) {
  await ready(frames);
  const pages = [];
  for (const f of frames) {
    const c = renderFrameCanvas(f, 2400);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    pages.push({ w: c.width, h: c.height, bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  const pdf = buildPDF(pages, title);
  downloadBlob(new Blob([pdf], { type: 'application/pdf' }), `${safeFilename(title)}.pdf`);
}

/** Minimal PDF 1.4 writer: one full-bleed JPEG per page, 11in × 6.1875in (16:9). */
export function buildPDF(pages, title = 'SpaceJam') {
  const enc = new TextEncoder();
  const chunks = [];
  let length = 0;
  const offsets = [];
  const push = data => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b); length += b.length;
  };
  const PW = 792, PH = 445.5;
  const n = pages.length;
  // object numbers: 1 catalog, 2 pages, 3 info, then per page: page, contents, image
  const pageObj = i => 4 + i * 3;
  const startObj = num => { offsets[num] = length; push(`${num} 0 obj\n`); };
  const pdfStr = s => '(' + String(s).replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, '') + ')';

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  startObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2); push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>\nendobj\n`);
  startObj(3); push(`<< /Title ${pdfStr(title)} /Producer (SpaceJam) /Creator (SpaceJam) >>\nendobj\n`);

  pages.forEach((p, i) => {
    const po = pageObj(i), co = po + 1, io = po + 2;
    const content = `q\n${PW} 0 0 ${PH} 0 0 cm\n/Im0 Do\nQ\n`;
    startObj(po);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${io} 0 R >> >> /Contents ${co} 0 R >>\nendobj\n`);
    startObj(co);
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
    startObj(io);
    push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
    push(p.bytes);
    push('\nendstream\nendobj\n');
  });

  const total = 3 + n * 3;
  const xref = length;
  let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
