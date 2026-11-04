import dagre from '@dagrejs/dagre';
import type { DataModel, Entity } from '../../core';
import type { Detail } from '../store';
import { estimateNodeHeight, nodeWidth } from './geometry';

type Positions = Map<string, { x: number; y: number }>;

/**
 * Full layout. Entities are layered left→right along relationships (dagre); reference lists
 * go in a grid to their right, ordered by first use so reference lines stay roughly parallel.
 */
export function autoLayout(m: DataModel, detail: Detail, names?: string[]): Positions {
  const include = new Set(names || m.entities.map((e) => e.name));
  const entities = m.entities.filter((e) => include.has(e.name));
  const core = entities.filter((e) => e.entity_type !== 'reference');
  const refs = entities.filter((e) => e.entity_type === 'reference');
  const size = (e: Entity) => ({ w: nodeWidth(e), h: estimateNodeHeight(e, detail) });

  const out = layoutCore(m, core, size);
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of core) {
    const p = out.get(e.name)!;
    const { w, h } = size(e);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + w);
    maxY = Math.max(maxY, p.y + h);
  }
  if (!core.length) [minY, maxX, maxY] = [40, 40 - REF_GAP_X, 40];

  const grid = layoutRefGrid(orderRefs(core, refs, out), size, maxY - minY);
  const offsetY = minY + Math.max(0, (maxY - minY - grid.height) / 2);
  grid.pos.forEach((p, k) => out.set(k, { x: Math.round(maxX + REF_GAP_X + p.x), y: Math.round(offsetY + p.y) }));
  return out;
}

const REF_GAP_X = 180; // core → reference grid
const GRID_GAP_X = 72;
const GRID_GAP_Y = 48;

type Size = (e: Entity) => { w: number; h: number };

function layoutCore(m: DataModel, core: Entity[], size: Size): Positions {
  const out: Positions = new Map();
  if (!core.length) return out;
  const names = new Set(core.map((e) => e.name));
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 160, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const e of core) {
    const { w, h } = size(e);
    g.setNode(e.name, { width: w, height: h });
  }
  for (const r of m.relationships) {
    if (r.source === r.target || !names.has(r.source) || !names.has(r.target)) continue;
    // N:1 / 1:1 point at the "one" side; draw parents to the left of children.
    const [a, b] = r.cardinality === 'N:1' ? [r.target, r.source] : [r.source, r.target];
    g.setEdge(a, b, { weight: 3, minlen: 1 }, `rel:${r.name}`);
  }
  dagre.layout(g);
  for (const n of g.nodes()) {
    const p = g.node(n);
    if (p) out.set(n, { x: Math.round(p.x - p.width / 2), y: Math.round(p.y - p.height / 2) });
  }
  return out;
}

/** Reference lists in order of first use (core entities top→bottom, attributes top→bottom); dependents follow their parent. */
function orderRefs(core: Entity[], refs: Entity[], corePos: Positions): Entity[] {
  const byName = new Map(refs.map((e) => [e.name, e]));
  const seen = new Set<string>();
  const order: Entity[] = [];
  const children = new Map<string, Entity[]>();
  for (const e of refs) {
    const p = e.dependent_reference?.parent;
    if (p && byName.has(p) && p !== e.name) children.set(p, [...(children.get(p) || []), e]);
  }
  const visit = (name: string | undefined) => {
    const e = name ? byName.get(name) : undefined;
    if (!e || seen.has(e.name)) return;
    seen.add(e.name);
    order.push(e);
    for (const c of children.get(e.name) || []) visit(c.name);
  };
  const sortedCore = [...core].sort((a, b) => {
    const pa = corePos.get(a.name)!;
    const pb = corePos.get(b.name)!;
    return pa.y - pb.y || pa.x - pb.x;
  });
  for (const e of sortedCore) {
    for (const a of e.attributes) {
      if (a.reference?.entity) visit(a.reference.entity);
      const st = a.type === 'STRUCT' ? e.struct_types?.find((s) => s.name === a.struct_type) : undefined;
      for (const f of st?.fields || []) visit(f.reference?.entity);
    }
  }
  // Lists only used by other lists, or not used at all: after a parent if they have one, else in model order.
  for (const e of refs) if (!e.dependent_reference || !byName.has(e.dependent_reference.parent)) visit(e.name);
  for (const e of refs) visit(e.name);
  return order;
}

/**
 * Row-major grid with aligned columns and rows. Uses the fewest columns that keep the block no taller than the
 * core diagram or a roughly square block, whichever is taller, so lists stay close to the entities that use them.
 */
function layoutRefGrid(refs: Entity[], size: Size, coreHeight: number): { pos: Positions; height: number } {
  const pos: Positions = new Map();
  if (!refs.length) return { pos, height: 0 };
  const sizes = refs.map(size);
  const measure = (cols: number) => {
    const colW = Array.from({ length: cols }, (_, c) => Math.max(...sizes.filter((_, i) => i % cols === c).map((s) => s.w)));
    const rowH: number[] = [];
    sizes.forEach((s, i) => {
      const r = Math.floor(i / cols);
      rowH[r] = Math.max(rowH[r] || 0, s.h);
    });
    const width = colW.reduce((a, b) => a + b, 0) + GRID_GAP_X * (cols - 1);
    const height = rowH.reduce((a, b) => a + b, 0) + GRID_GAP_Y * (rowH.length - 1);
    return { colW, rowH, width, height };
  };
  let square = 1;
  let squareScore = Infinity;
  for (let c = 1; c <= refs.length; c++) {
    const { width, height } = measure(c);
    if (Math.max(width, height) < squareScore) [square, squareScore] = [c, Math.max(width, height)];
  }
  const maxHeight = Math.max(coreHeight, measure(square).height);
  let best = square;
  for (let c = 1; c < square; c++) {
    if (measure(c).height <= maxHeight) {
      best = c;
      break;
    }
  }
  const { colW, rowH, height } = measure(best);
  const colX = colW.map((_, c) => colW.slice(0, c).reduce((a, b) => a + b + GRID_GAP_X, 0));
  const rowY = rowH.map((_, r) => rowH.slice(0, r).reduce((a, b) => a + b + GRID_GAP_Y, 0));
  refs.forEach((e, i) => pos.set(e.name, { x: colX[i % best], y: rowY[Math.floor(i / best)] }));
  return { pos, height };
}

/** Place entities that have no position yet below the existing diagram, entities before references. */
export function placeUnpositioned(m: DataModel, detail: Detail): Positions {
  const placed = m.entities.filter((e) => e.ui);
  const todo = m.entities.filter((e) => !e.ui);
  if (!todo.length) return new Map();
  if (!placed.length) return autoLayout(m, detail);
  const sub = autoLayout(m, detail, todo.map((e) => e.name));
  let maxY = -Infinity;
  let minX = Infinity;
  for (const e of placed) {
    maxY = Math.max(maxY, e.ui!.y + estimateNodeHeight(e, detail));
    minX = Math.min(minX, e.ui!.x);
  }
  for (const a of m.areas) {
    maxY = Math.max(maxY, a.y + a.h);
    minX = Math.min(minX, a.x);
  }
  let subMinX = Infinity;
  let subMinY = Infinity;
  sub.forEach((p) => {
    subMinX = Math.min(subMinX, p.x);
    subMinY = Math.min(subMinY, p.y);
  });
  const out: Positions = new Map();
  sub.forEach((p, k) => out.set(k, { x: p.x - subMinX + minX, y: p.y - subMinY + maxY + 120 }));
  return out;
}

/** Above this many entities layouts run in a Web Worker so the page stays responsive. */
const WORKER_AT = 300;
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (p: Positions) => void>();

function run(kind: 'full' | 'place', m: DataModel, detail: Detail, names?: string[]): Promise<Positions> {
  if (m.entities.length < WORKER_AT || typeof Worker === 'undefined') return Promise.resolve(kind === 'full' ? autoLayout(m, detail, names) : placeUnpositioned(m, detail));
  if (!worker) {
    worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; positions: [string, { x: number; y: number }][] }>) => {
      waiting.get(ev.data.id)?.(new Map(ev.data.positions));
      waiting.delete(ev.data.id);
    };
  }
  const id = ++seq;
  // Only what layout reads crosses to the worker.
  const slim = { ...m, entities: m.entities, relationships: m.relationships, hierarchies: [], notes: [], tabs: undefined, mappings: undefined, comments: undefined, glossary_snapshot: undefined } as DataModel;
  return new Promise((ok) => {
    waiting.set(id, ok);
    worker!.postMessage({ id, kind, model: JSON.parse(JSON.stringify(slim)), detail, names });
  });
}

export const autoLayoutAsync = (m: DataModel, detail: Detail, names?: string[]) => run('full', m, detail, names);
export const placeUnpositionedAsync = (m: DataModel, detail: Detail) => run('place', m, detail);
