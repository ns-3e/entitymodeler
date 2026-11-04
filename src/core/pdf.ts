// PDF data-model document in the app's Skailr style: a flat ink header band, Schibsted Grotesk with
// DM Serif Display titles and IBM Plex Mono figures, small orange
// planes edged in ink, grey table headers on a heavy ink rule, warm hairlines, hard offset shadows
// and no gradients. Cover + contents, the diagram on a landscape page,
// then every doc table. jsPDF runs in the browser and in Node, so the UI and the CLI produce the
// same file; each caller loads the font assets (PDF_ASSET_FILES).
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
import { DOC_SECTIONS, type DocTable } from './docs';
import { SOURCE_URL, type DataModel } from './types';

applyPlugin(jsPDF);

/** Font assets, by file name under src/core/assets/. */
export const PDF_ASSET_FILES = {
  regular: 'SchibstedGrotesk-Regular.ttf',
  semibold: 'SchibstedGrotesk-SemiBold.ttf',
  display: 'DMSerifDisplay-Regular.ttf',
  mono: 'IBMPlexMono-Regular.ttf',
} as const;
export type PdfAssets = Partial<Record<keyof typeof PDF_ASSET_FILES, Uint8Array>>;

export interface PdfOptions {
  pageSize?: 'letter' | 'a4';
  /** PNG bytes of the diagram (as rendered by the UI, or a saved diagram.png). */
  diagramPng?: Uint8Array;
  /** The PDF_ASSET_FILES fonts. Without them the document falls back to Helvetica, Times and Courier. */
  assets?: PdfAssets;
}

// EntityModel.com tokens (match the app's styles.css)
type RGB = [number, number, number];
const hex = (c: string): RGB => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const T = {
  ink: hex('#1F2124'),
  textStrong: hex('#1F2124'),
  textBody: hex('#44474C'),
  textMuted: hex('#5E6268'),
  textSubtle: hex('#5E6268'),
  onInk: hex('#FAFAF8'),
  surface: hex('#FFFFFF'),
  canvas: hex('#F4F3F0'),
  sunken: hex('#E9E8E4'),
  border: hex('#DAD9D4'),
  borderStrong: hex('#BDBCB6'),
  plane: hex('#F2A67C'),
};

// Keep text inside WinAnsi + the glyphs the bundled Latin font subsets carry; swap the symbols the doc tables use.
const SYMBOLS: Record<string, string> = { '→': '->', '←': '<-', '↔': '<->', '★': '*', '≥': '>=', '≤': '<=', '≠': '!=', '✓': 'Yes', '✔': 'Yes', '✗': 'No', '×': 'x' };
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function pdfText(s: string): string {
  let out = '';
  for (const ch of s || '') {
    if (SYMBOLS[ch] !== undefined) out += SYMBOLS[ch];
    else if (ch.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else out += '?';
  }
  return out;
}

function pngSize(png: Uint8Array): { width: number; height: number } {
  // IHDR: width/height are big-endian uint32 at bytes 16 and 20
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (png.length < 24 || v.getUint32(0) !== 0x89504e47) throw new Error('Image is not a PNG');
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

function base64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const MONO_COLUMN: Partial<Record<string, number>> = { attributes: 1 };
/** Tables wider than this go on a landscape page. */
const LANDSCAPE_COLUMNS = 6;
const M = 36; // page margin
const CONTENT_TOP = 54; // below the running header on inner pages
const FOOT = 40;

export function buildModelPdf(m: DataModel, tables: DocTable[], opts: PdfOptions = {}): Uint8Array {
  const a = opts.assets || {};
  const format = opts.pageSize || 'letter';
  const doc = new jsPDF({ unit: 'pt', format, orientation: 'portrait', compress: true });
  doc.setDisplayMode('fullwidth', 'continuous', 'UseOutlines');
  const date = new Date().toISOString().slice(0, 10);
  const W = () => doc.internal.pageSize.getWidth();
  const H = () => doc.internal.pageSize.getHeight();
  const docTitle = `${m.title} data model`;
  doc.setProperties({ title: pdfText(docTitle), subject: 'Data model', author: pdfText(m.author || ''), creator: 'EntityModel.com' });

  // Fonts: Schibsted Grotesk for text, DM Serif Display for titles, IBM Plex Mono for figures and names
  const branded = !!(a.regular && a.semibold && a.display && a.mono);
  const F = branded
    ? { regular: ['Schibsted', 'normal'], semibold: ['Schibsted', 'bold'], display: ['DMSerif', 'normal'], mono: ['PlexMono', 'normal'] }
    : { regular: ['helvetica', 'normal'], semibold: ['helvetica', 'bold'], display: ['times', 'normal'], mono: ['courier', 'normal'] };
  if (branded) {
    const add = (file: string, bytes: Uint8Array, family: string, style: string) => {
      doc.addFileToVFS(file, base64(bytes));
      doc.addFont(file, family, style);
    };
    add(PDF_ASSET_FILES.regular, a.regular!, 'Schibsted', 'normal');
    add(PDF_ASSET_FILES.semibold, a.semibold!, 'Schibsted', 'bold');
    add(PDF_ASSET_FILES.display, a.display!, 'DMSerif', 'normal');
    add(PDF_ASSET_FILES.mono, a.mono!, 'PlexMono', 'normal');
  }
  const font = (f: keyof typeof F, size: number, color: RGB) => {
    doc.setFont(F[f][0], F[f][1]).setFontSize(size).setTextColor(...color);
  };
  /** Letter-spaced text (eyebrows, kickers, footers). jsPDF's width ignores char spacing, so align by hand. */
  const tracked = (text: string, x: number, y: number, space: number, align: 'left' | 'right' = 'left') => {
    const t = pdfText(text);
    const w = doc.getTextWidth(t) + space * Math.max(0, t.length - 1);
    doc.setCharSpace(space);
    doc.text(t, align === 'right' ? x - w : x, y);
    doc.setCharSpace(0);
    return w;
  };
  /** A small orange plane edged in ink. */
  const plane = (x: number, y: number, w: number, h: number, edge: RGB = T.ink) => {
    doc.setFillColor(...T.plane).setDrawColor(...edge).setLineWidth(1);
    doc.rect(x, y, w, h, 'FD');
  };
  /** A resting card: hairline edge on a hard offset plane, no blur. */
  const card = (x: number, y: number, w: number, h: number) => {
    doc.setFillColor(...T.borderStrong);
    doc.rect(x + 3, y + 3, w, h, 'F');
    doc.setFillColor(...T.surface).setDrawColor(...T.borderStrong).setLineWidth(0.75);
    doc.rect(x, y, w, h, 'FD');
  };
  /** Sheet section heading: a small plane + semibold title. */
  const secHeading = (title: string, y: number, size = 11.5) => {
    plane(M, y - size * 0.7, 9, size * 0.7);
    font('semibold', size, T.textStrong);
    doc.text(pdfText(title), M + 20, y);
  };

  // ---------- Cover ----------
  const bandH = 66;
  doc.setFillColor(...T.ink);
  doc.rect(0, 0, W(), bandH, 'F');
  plane(M, bandH / 2 - 8, 10, 14, T.onInk);
  font('display', 17, T.onInk);
  doc.text('EntityModel.com', M + 20, bandH / 2 + 5);
  font('semibold', 7.5, T.onInk);
  tracked('DATA MODEL', W() - M, bandH / 2 + 2.5, 1.5, 'right');

  let y = bandH + 44;
  font('semibold', 8, T.textMuted);
  tracked('DESIGN DOCUMENT  ·  DATA MODEL', M, y, 1.6);
  y += 36;
  font('display', 34, T.textStrong);
  doc.setCharSpace(-0.4);
  const titleLines = doc.splitTextToSize(pdfText(m.title), W() - M * 2);
  doc.text(titleLines, M, y, { lineHeightFactor: 1.08 });
  doc.setCharSpace(0);
  y += (titleLines.length - 1) * 36.7 + 28;
  if (m.description) {
    font('regular', 10.5, T.textMuted);
    const lines = doc.splitTextToSize(pdfText(m.description), W() - M * 2 - 60);
    doc.text(lines, M, y, { lineHeightFactor: 1.5 });
    y += lines.length * 15.75 + 14;
  }

  // Meta strip: label over value, between hairlines
  const meta: [string, string][] = (
    [
      ['Organization', m.organization],
      ['Version', m.version],
      ['Status', m.status && m.status[0].toUpperCase() + m.status.slice(1)],
      ['Author', m.author],
      ['Generated', date],
    ] as [string, string | undefined][]
  ).filter((x): x is [string, string] => !!x[1]);
  doc.setDrawColor(...T.ink).setLineWidth(1.5);
  doc.line(M, y, W() - M, y);
  const colW = (W() - M * 2) / meta.length;
  meta.forEach(([label, value], i) => {
    const x = M + i * colW;
    font('semibold', 6.5, T.textSubtle);
    tracked(label.toUpperCase(), x, y + 17, 1.1);
    font('semibold', 9.5, T.textStrong);
    doc.text(doc.splitTextToSize(pdfText(value), colW - 10)[0], x, y + 31);
  });
  y += 44;
  doc.setDrawColor(...T.border).setLineWidth(0.75);
  doc.line(M, y, W() - M, y);
  y += 22;

  // Metric cards
  const count = (t: string) => m.entities.filter((e) => e.entity_type === t).length;
  const stats: [string, number][] = [
    ['Entities', count('standard')],
    ['Reference entities', count('reference')],
    ['Attributes', m.entities.reduce((n, e) => n + e.attributes.length, 0)],
    ['Relationships', m.relationships.length],
    ['Hierarchies', m.hierarchies?.length || 0],
  ];
  const gap = 7.5;
  const boxW = (W() - M * 2 - gap * (stats.length - 1)) / stats.length;
  stats.forEach(([label, n], i) => {
    const x = M + i * (boxW + gap);
    card(x, y, boxW - 3, 60);
    font('mono', 22, T.ink);
    doc.text(String(n), x + 12, y + 31);
    doc.setCharSpace(0);
    font('regular', 8, T.textMuted);
    doc.text(label, x + 12, y + 47);
  });
  y += 60 + 36;
  const contentsY = y; // filled in once page numbers are known

  // ---------- Body ----------
  const chapters: { title: string; page: number }[] = [];
  const chapter = (title: string, orientation: 'portrait' | 'landscape', intro?: string) => {
    doc.addPage(format, orientation);
    chapters.push({ title, page: doc.getNumberOfPages() });
    (doc as any).outline?.add(null, pdfText(title), { pageNumber: doc.getNumberOfPages() });
    let cy = CONTENT_TOP + 14;
    font('semibold', 7.5, T.textMuted);
    tracked(`SECTION ${String(chapters.length).padStart(2, '0')}`, M, cy, 1.5);
    cy += 24;
    font('display', 26, T.textStrong);
    doc.setCharSpace(-0.3);
    doc.text(pdfText(title), M, cy);
    doc.setCharSpace(0);
    if (!intro) return cy + 28;
    cy += 17;
    font('regular', 9.5, T.textMuted);
    const lines = doc.splitTextToSize(pdfText(intro), W() - M * 2);
    doc.text(lines, M, cy, { lineHeightFactor: 1.5 });
    return cy + lines.length * 14.25 + 18;
  };

  if (opts.diagramPng) {
    const top = chapter('Data model diagram', 'landscape', 'Every entity in the model with its reference lookups and relationships.');
    const { width, height } = pngSize(opts.diagramPng);
    const pad = 10;
    const maxW = W() - M * 2 - pad * 2;
    const maxH = H() - top - FOOT - 12 - pad * 2;
    const s = Math.min(maxW / width, maxH / height);
    const w = width * s;
    const h = height * s;
    const x = M + (maxW - w) / 2;
    doc.setFillColor(...T.surface).setDrawColor(...T.borderStrong).setLineWidth(0.75);
    doc.rect(x, top, w + pad * 2, h + pad * 2, 'FD');
    doc.addImage(opts.diagramPng, 'PNG', x + pad, top + pad, w, h, undefined, 'FAST');
  }

  const sections = DOC_SECTIONS.filter((s) => tables.some((t) => t.section === s.id));
  for (const s of sections) {
    const group = tables.filter((t) => t.section === s.id);
    const orientation = group.some((t) => t.columns.length > LANDSCAPE_COLUMNS) ? 'landscape' : 'portrait';
    let cursor = chapter(s.title, orientation, `${s.description}.`);
    for (const t of group) {
      if (cursor > H() - FOOT - 100) {
        doc.addPage(format, orientation);
        cursor = CONTENT_TOP + 14;
      }
      secHeading(t.title, cursor);
      cursor += 6;
      if (t.caption) {
        font('regular', 8, T.textMuted);
        const cap = doc.splitTextToSize(pdfText(t.caption), W() - M * 2);
        doc.text(cap, M, cursor + 10, { lineHeightFactor: 1.45 });
        cursor += cap.length * 11.6 + 2;
      }
      const total = (t.widths || []).reduce((x, y) => x + y, 0);
      const avail = W() - M * 2;
      const key = MONO_COLUMN[t.section];
      const columnStyles: Record<number, any> = {};
      t.columns.forEach((_, i) => {
        columnStyles[i] = {};
        if (total && t.widths) columnStyles[i].cellWidth = (t.widths[i] / total) * avail;
        if (i === 0) Object.assign(columnStyles[i], { fillColor: T.canvas, textColor: T.textStrong, font: F.semibold[0], fontStyle: F.semibold[1] });
        else if (i === key) Object.assign(columnStyles[i], { textColor: T.textStrong, font: F.mono[0], fontStyle: F.mono[1] });
      });
      const dense = t.columns.length > 10;
      (doc as any).autoTable({
        startY: cursor + 5,
        margin: { left: M, right: M, top: CONTENT_TOP, bottom: FOOT + 8 },
        head: [t.columns.map((c) => pdfText(c).toUpperCase())],
        body: t.rows.map((r) => t.columns.map((_, i) => pdfText(r[i] || ''))),
        theme: 'grid',
        styles: {
          font: F.regular[0],
          fontStyle: F.regular[1],
          fontSize: dense ? 6.8 : 7.8,
          cellPadding: { top: 5, bottom: 5, left: 7, right: 7 },
          textColor: T.textBody,
          lineColor: T.border,
          lineWidth: 0.6,
          overflow: 'linebreak',
          valign: 'top',
        },
        headStyles: { fillColor: T.sunken, textColor: T.ink, font: F.semibold[0], fontStyle: F.semibold[1], fontSize: dense ? 6 : 6.5, valign: 'middle' },
        columnStyles,
        rowPageBreak: 'avoid',
        willDrawCell: (d: any) => {
          if (d.section === 'head') doc.setCharSpace(0.7);
        },
        didDrawCell: (d: any) => {
          doc.setCharSpace(0);
          // Header sits on a heavy ink rule.
          if (d.section === 'head') {
            doc.setDrawColor(...T.ink).setLineWidth(1.5);
            doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height);
          }
        },
      });
      cursor = (doc as any).lastAutoTable.finalY + 28;
    }
  }

  // ---------- Contents (on the cover) ----------
  doc.setPage(1);
  secHeading('Contents', contentsY, 13);
  chapters.forEach((c, i) => {
    const ly = contentsY + 28 + i * 21;
    font('mono', 9, T.textMuted);
    doc.text(String(i + 1).padStart(2, '0'), M, ly);
    font('regular', 10.5, T.textStrong);
    const label = pdfText(c.title);
    doc.textWithLink(label, M + 28, ly, { pageNumber: c.page });
    const leaderFrom = M + 28 + doc.getTextWidth(label) + 8;
    font('regular', 9.5, T.textMuted);
    doc.text(String(c.page), W() - M, ly, { align: 'right' });
    doc.setDrawColor(...T.borderStrong).setLineWidth(0.6).setLineDashPattern([0.6, 2.4], 0);
    doc.line(leaderFrom, ly - 2.5, W() - M - 20, ly - 2.5);
    doc.setLineDashPattern([], 0);
  });

  // ---------- Page chrome ----------
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    if (i > 1) {
      // Thin sheet-header strip, running kicker and the wordmark
      doc.setFillColor(...T.ink);
      doc.rect(0, 0, W(), 4, 'F');
      font('semibold', 6.5, T.textSubtle);
      tracked([m.title, m.organization].filter(Boolean).join('  ·  ').toUpperCase(), M, 27, 1.1);
      font('display', 10, T.ink);


      doc.text('EntityModel.com', W() - M, 27, { align: 'right' });
    }
    doc.setDrawColor(...T.border).setLineWidth(0.75);
    doc.line(M, H() - FOOT + 8, W() - M, H() - FOOT + 8);
    font('regular', 7, T.textSubtle);
    tracked(i === 1 ? `GENERATED ${date}` : docTitle, M, H() - FOOT + 22, i === 1 ? 1.1 : 0.5);
    const right = i === 1 ? 'MADE WITH ENTITYMODEL.COM' : `ENTITYMODEL.COM  ·  PAGE ${i} OF ${n}`;
    const rw = tracked(right, W() - M, H() - FOOT + 22, 1.1, 'right');
    doc.link(W() - M - rw, H() - FOOT + 13, rw, 12, { url: SOURCE_URL });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
