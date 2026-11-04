import { useEffect, useRef } from 'react';
import { useStore as useFlowStore } from '@xyflow/react';
import type { DataModel, Entity } from '../../core';
import type { Detail } from '../store';
import { estimateNodeHeight, nodeWidth } from './geometry';

/** Big models zoomed out this far are drawn here instead of as React Flow cards (thousands of DOM nodes). */
export const OVERVIEW_ZOOM = 0.22;
export const OVERVIEW_MIN_ENTITIES = 300;

export interface Box {
  e: Entity;
  x: number;
  y: number;
  w: number;
  h: number;
}

const sizes = new WeakMap<Entity, { w: number; h: number; detail: Detail }>();
/** Canvas boxes for visible entities, sized like the cards (cached per entity object). */
export function entityBoxes(m: DataModel, detail: Detail): Box[] {
  const out: Box[] = [];
  for (const e of m.entities) {
    if (!e.ui || e.ui.hidden) continue;
    let s = sizes.get(e);
    if (!s || s.detail !== detail) sizes.set(e, (s = { w: nodeWidth(e), h: estimateNodeHeight(e, detail), detail }));
    out.push({ e, x: e.ui.x, y: e.ui.y, w: s.w, h: s.h });
  }
  return out;
}

export function boxAt(boxes: Box[], x: number, y: number): Box | undefined {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return undefined;
}

/** One canvas for every entity and relationship, redrawn on pan and zoom (a few ms for thousands of boxes). */
export function OverviewLayer({ boxes, model, selected }: { boxes: Box[]; model: DataModel; selected: Set<string> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const transform = useFlowStore((s) => s.transform);
  const width = useFlowStore((s) => s.width);
  const height = useFlowStore((s) => s.height);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const css = getComputedStyle(document.documentElement);
    const col = (v: string, d: string) => css.getPropertyValue(v).trim() || d;
    const [tx, ty, k] = transform;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
    // Only what is on screen (in flow coordinates).
    const x0 = -tx / k;
    const y0 = -ty / k;
    const x1 = x0 + width / k;
    const y1 = y0 + height / k;
    const onScreen = (b: Box) => b.x + b.w >= x0 && b.x <= x1 && b.y + b.h >= y0 && b.y <= y1;
    const byName = new Map(boxes.map((b) => [b.e.name, b]));

    ctx.lineWidth = 1.2 / k;
    ctx.strokeStyle = col('--rel', '#44474c');
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (const r of model.relationships) {
      const a = byName.get(r.source);
      const b = byName.get(r.target);
      if (!a || !b || a === b || (!onScreen(a) && !onScreen(b))) continue;
      ctx.moveTo(a.x + a.w / 2, a.y + a.h / 2);
      ctx.lineTo(b.x + b.w / 2, b.y + b.h / 2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    const body = col('--node-bg', '#fafaf8');
    const border = col('--node-border', '#bdbcb6');
    // Selected: the contour, as on full entity cards.
    const contour = col('--contour', '#1f2124');
    const ink = col('--ink', '#1f2124');
    const labels = k * 280 > 70; // a card is wide enough on screen to hold its name
    ctx.font = `600 ${Math.min(40, 13 / k)}px 'Schibsted Grotesk', system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const b of boxes) {
      if (!onScreen(b)) continue;
      ctx.fillStyle = body;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.e.color_code;
      ctx.fillRect(b.x, b.y, b.w, Math.max(8, 58 * 0.25));
      const sel = selected.has(b.e.name);
      ctx.lineWidth = (sel ? 3 : 1) / k;
      ctx.strokeStyle = sel ? contour : border;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      if (labels) {
        ctx.fillStyle = ink;
        ctx.fillText(b.e.display_name, b.x + 14, b.y + 36, b.w - 28);
      }
    }
  }, [boxes, model.relationships, selected, transform, width, height]);

  return <canvas ref={ref} className="overview-layer" style={{ width, height }} />;
}
