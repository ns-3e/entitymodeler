import type { ReactFlowInstance } from '@xyflow/react';
import type { DataModel } from '../../core';
import { estimateNodeHeight, nodeWidth } from './geometry';
import type { Detail } from '../store';

/** Gives toolbar/export code access to the React Flow instance mounted inside the canvas. */
export const bridge: { rf: ReactFlowInstance<any, any> | null } = { rf: null };

/**
 * Fit the whole diagram on screen, from the model rather than React Flow's nodes: on big zoomed-out
 * diagrams entities are drawn on the overview canvas, so React Flow does not know about them.
 */
export function fitDiagram(m: DataModel, detail: Detail, opts: { padding?: number; duration?: number } = {}) {
  const rf = bridge.rf;
  if (!rf) return;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, w: number, h: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  for (const e of m.entities) if (e.ui && !e.ui.hidden) add(e.ui.x, e.ui.y, nodeWidth(e), estimateNodeHeight(e, detail));
  for (const a of m.areas) add(a.x, a.y, a.w, a.h);
  for (const n of m.notes) add(n.x, n.y, n.w || 220, 80);
  if (x0 === Infinity) return;
  fitBoundsClear({ x: x0, y: y0, width: x1 - x0 + 40, height: y1 - y0 }, opts);
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 1.5;
const GAP = 16;

/**
 * Like React Flow's fitBounds, but fits the bounds into the part of the canvas the floating toolbar
 * doesn't cover (this React Flow version only pads all sides alike).
 */
export function fitBoundsClear(b: { x: number; y: number; width: number; height: number }, opts: { padding?: number; duration?: number } = {}) {
  const rf = bridge.rf;
  const pane = document.querySelector('.canvas-wrap .react-flow');
  if (!rf || !pane || b.width <= 0 || b.height <= 0) return;
  const box = pane.getBoundingClientRect();
  const bar = document.querySelector('.canvas-toolbar')?.getBoundingClientRect();
  const top = bar ? Math.max(GAP, bar.bottom - box.top + GAP) : GAP;
  const w = box.width - GAP * 2;
  const h = box.height - top - GAP;
  if (w <= 0 || h <= 0) return;
  const pad = 1 + (opts.padding ?? 0.12);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(w / (b.width * pad), h / (b.height * pad))));
  const x = GAP + (w - b.width * zoom) / 2 - b.x * zoom;
  const y = top + (h - b.height * zoom) / 2 - b.y * zoom;
  rf.setViewport({ x, y, zoom }, { duration: opts.duration ?? 300 });
}
