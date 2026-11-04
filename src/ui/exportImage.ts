import { toPng, toSvg } from 'html-to-image';
import { getNodesBounds } from '@xyflow/react';
import { SOURCE_URL, type DataModel } from '../core';
import { bridge } from './canvas/bridge';
import { useStore } from './store';

export interface ImageOptions {
  scale: number;
  background: 'white' | 'transparent' | 'theme';
  titleBlock: boolean;
  legend: boolean;
  theme: 'light' | 'dark' | 'current';
  padding?: number;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** Wait (up to 2 s) until every node is in the DOM and measured, so edges are drawn too. */
async function allNodesMounted() {
  const until = performance.now() + 2000;
  while (performance.now() < until) {
    const nodes = bridge.rf?.getNodes() || [];
    if (document.querySelectorAll('.react-flow__node').length >= nodes.length && nodes.every((n) => n.measured?.width)) break;
    await nextFrame();
  }
  await nextFrame();
}

async function withTheme<T>(theme: ImageOptions['theme'], fn: () => Promise<T>): Promise<T> {
  const root = document.documentElement;
  const prev = root.dataset.theme;
  const exporting = root.classList.contains('exporting');
  root.classList.add('exporting');
  if (theme !== 'current') root.dataset.theme = theme;
  // Large diagrams render only on-screen nodes; the capture needs all of them in the DOM.
  // The image shows the model, not the editing state: no selection outlines or related-entity highlights.
  const { renderAll, selection, multi } = useStore.getState();
  useStore.setState({ renderAll: true, selection: { kind: 'model' }, multi: [] });
  await nextFrame();
  await allNodesMounted();
  try {
    return await fn();
  } finally {
    if (prev) root.dataset.theme = prev;
    if (!exporting) root.classList.remove('exporting');
    useStore.setState({ renderAll, selection, multi });
  }
}

function captureBox(pad: number) {
  const rf = bridge.rf;
  if (!rf) throw new Error('Diagram is not ready');
  const nodes = rf.getNodes();
  if (!nodes.length) throw new Error('Nothing to export — the diagram is empty');
  const b = getNodesBounds(nodes);
  // Self-relationship loops and labels stick out to the right of nodes
  return { x: b.x - pad, y: b.y - pad, width: Math.ceil(b.width + pad * 2 + 40), height: Math.ceil(b.height + pad * 2) };
}

function viewportEl() {
  const el = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!el) throw new Error('Diagram is not mounted — switch to the Diagram view');
  return el;
}

function bgColor(o: ImageOptions) {
  if (o.background === 'transparent') return undefined;
  if (o.background === 'white') return '#FFFFFF';
  return getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#FFFFFF';
}

/** Render the diagram (all nodes) to a PNG data URL, then compose a title block + legend around it. */
export async function renderDiagramPng(model: DataModel, o: ImageOptions): Promise<string> {
  return withTheme(o.theme, async () => {
    const box = captureBox(o.padding ?? 48);
    const bg = bgColor(o);
    const diagram = await toPng(viewportEl(), {
      backgroundColor: bg,
      width: box.width,
      height: box.height,
      pixelRatio: o.scale,
      style: { width: `${box.width}px`, height: `${box.height}px`, transform: `translate(${-box.x}px, ${-box.y}px) scale(1)` },
      filter: (n) => !(n instanceof HTMLElement && n.classList?.contains('react-flow__resize-control')),
    });
    // Always composed: even a bare diagram carries the credit line.
    return compose(model, diagram, box.width, box.height, o, bg);
  });
}

export async function renderDiagramSvg(o: ImageOptions): Promise<string> {
  return withTheme(o.theme, async () => {
    const box = captureBox(o.padding ?? 48);
    const bg = bgColor(o);
    const url = await toSvg(viewportEl(), {
      backgroundColor: bg,
      width: box.width,
      height: box.height,
      style: { width: `${box.width}px`, height: `${box.height}px`, transform: `translate(${-box.x}px, ${-box.y}px) scale(1)` },
    });
    const dark = (o.theme === 'current' ? document.documentElement.dataset.theme : o.theme) === 'dark';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(withSvgCredit(decodeURIComponent(url.split(',')[1]), box.width, box.height, bg, dark));
  });
}

const CREDIT = `Made with ${SOURCE_URL.replace(/^https?:\/\//, '')}`;
const CREDIT_STRIP = 24;

// The diagram tokens from styles.css, per theme: an export can use a theme other than the current one.
const INK = {
  light: { ink: '#1F2124', ink2: '#44474C', muted: '#5E6268', rule: '#BDBCB6', plane: '#F2A67C', ref: '#3E6A8F', dep: '#7A5C8E', pk: '#9A4A10' },
  dark: { ink: '#F1F0EC', ink2: '#C9C8C4', muted: '#A1A19D', rule: '#4E5056', plane: '#F2A67C', ref: '#7FA6C7', dep: '#B79BCB', pk: '#F2A67C' },
};
const SANS = '"Schibsted Grotesk", "Segoe UI", Arial, sans-serif';
const SERIF = '"DM Serif Display", Georgia, serif';

/** Add a credit strip under an SVG of width w × height h. */
function withSvgCredit(svg: string, w: number, h: number, bg: string | undefined, dark: boolean): string {
  const H = h + CREDIT_STRIP;
  const open = svg.match(/^<svg[^>]*>/);
  if (!open) return svg;
  const tag = open[0].replace(/height="[^"]*"/, `height="${H}"`).replace(/viewBox="[^"]*"/, `viewBox="0 0 ${w} ${H}"`);
  const fill = INK[dark ? 'dark' : 'light'].muted;
  const strip = bg ? `<rect x="0" y="${h}" width="${w}" height="${CREDIT_STRIP}" fill="${bg}"/>` : '';
  const text = `<a href="${SOURCE_URL}"><text x="${w - 16}" y="${h + 16}" text-anchor="end" font-family='${SANS}' font-size="11" fill="${fill}">${CREDIT}</text></a>`;
  return svg.replace(open[0], tag).replace(/<\/svg>\s*$/, `${strip}${text}</svg>`);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, bad) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = bad;
    i.src = src;
  });
}

async function compose(model: DataModel, diagramUrl: string, w: number, h: number, o: ImageOptions, bg?: string): Promise<string> {
  const img = await loadImage(diagramUrl);
  const s = o.scale;
  const dark = (o.theme === 'current' ? document.documentElement.dataset.theme : o.theme) === 'dark';
  const c = INK[dark ? 'dark' : 'light'];
  const { ink, muted, rule } = c;
  const minW = 900;
  const W = Math.max(w, minW);
  const headH = o.titleBlock ? 92 : 0;
  const legendH = o.legend ? 56 : CREDIT_STRIP + 4;
  const canvas = document.createElement('canvas');
  canvas.width = W * s;
  canvas.height = (h + headH + legendH) * s;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(s, s);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, h + headH + legendH);
  }
  const font = (weight: number, size: number) => `${weight} ${size}px ${SANS}`;
  await document.fonts?.ready;

  if (o.titleBlock) {
    // A small orange plane on a hard offset, edged in ink.
    ctx.fillStyle = c.plane;
    ctx.fillRect(32, 30, 8, 36);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(32, 30, 8, 36);
    ctx.fillStyle = ink;
    ctx.font = `400 30px ${SERIF}`;
    ctx.fillText(model.title, 54, 52);
    ctx.font = font(500, 13);
    ctx.fillStyle = muted;
    const meta = [model.organization, model.version && `v${model.version}`, model.status, new Date().toISOString().slice(0, 10)].filter(Boolean).join('  ·  ');
    ctx.fillText(meta, 54, 72);
    ctx.textAlign = 'right';
    ctx.font = font(600, 11);
    ctx.fillStyle = muted;
    ctx.letterSpacing = '0.12em';
    ctx.fillText('DATA MODEL', W - 32, 46);
    ctx.letterSpacing = '0px';
    ctx.font = font(500, 12);
    ctx.fillStyle = muted;
    const n = model.entities.filter((e) => e.entity_type === 'standard').length;
    const r = model.entities.filter((e) => e.entity_type === 'reference').length;
    ctx.fillText(`${n} entities · ${r} reference · ${model.relationships.length} relationships`, W - 32, 66);
    ctx.textAlign = 'left';
    ctx.fillStyle = ink;
    ctx.fillRect(32, headH - 2, W - 64, 1.5);
  }
  ctx.drawImage(img, (W - w) / 2, headH, w, h);

  if (o.legend) {
    const y = headH + h + 28;
    ctx.fillStyle = rule;
    ctx.fillRect(32, headH + h + 4, W - 64, 1);
    let x = 32;
    ctx.font = font(500, 12);
    const item = (draw: () => void, label: string) => {
      draw();
      ctx.fillStyle = muted;
      ctx.fillText(label, x + 34, y + 4);
      x += 34 + ctx.measureText(label).width + 28;
    };
    item(() => {
      ctx.strokeStyle = c.ink2;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'square';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 26, y);
      ctx.moveTo(x + 18, y);
      ctx.lineTo(x + 26, y - 6);
      ctx.moveTo(x + 18, y);
      ctx.lineTo(x + 26, y + 6);
      ctx.stroke();
    }, 'Relationship (crow’s foot = many)');
    item(() => {
      ctx.strokeStyle = c.ref;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 26, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }, 'Reference lookup');
    item(() => {
      ctx.strokeStyle = c.dep;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 26, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }, 'Dependent reference');
    // The entity-type stamps on the nodes.
    const stamp = (color: string) => () => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 4.5, y - 6.5, 18, 13);
    };
    item(stamp(c.ink2), 'Entity');
    item(stamp(c.ref), 'Reference');
    item(() => {
      ctx.fillStyle = c.pk;
      ctx.font = font(600, 12);
      ctx.fillText('PK', x + 6, y + 4);
      ctx.font = font(500, 12);
    }, 'Primary key');
  }
  // Credit, bottom right: on the legend row, or in its own strip.
  ctx.font = font(500, 11);
  ctx.fillStyle = muted;
  ctx.textAlign = 'right';
  ctx.fillText(CREDIT, W - 32, o.legend ? headH + h + 32 : headH + h + 18);
  ctx.textAlign = 'left';
  return canvas.toDataURL('image/png');
}

export function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function currentModel() {
  return useStore.getState().model!;
}
