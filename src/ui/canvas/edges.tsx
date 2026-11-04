import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, Position, getBezierPath, getSmoothStepPath, useInternalNode, type Edge, type EdgeProps, type InternalNode } from '@xyflow/react';
import type { Entity, Relationship } from '../../core';
import type { Detail } from '../store';
import { isFolded, rowCenterY } from './geometry';
import { useFar } from './EntityNode';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
function rectOf(n: InternalNode | undefined): Rect | null {
  if (!n) return null;
  const { x, y } = n.internals.positionAbsolute;
  return { x, y, w: n.measured?.width ?? 280, h: n.measured?.height ?? 120 };
}

const NORMAL: Record<Position, [number, number]> = {
  [Position.Left]: [-1, 0],
  [Position.Right]: [1, 0],
  [Position.Top]: [0, -1],
  [Position.Bottom]: [0, 1],
};

/** Crow's-foot glyph at a node boundary point. `many` = crow's foot, otherwise a single bar. */
function cardinalityGlyph(x: number, y: number, side: Position, many: boolean): string {
  const [nx, ny] = NORMAL[side];
  const [tx, ty] = [-ny, nx];
  const spread = 7;
  if (many) {
    const qx = x + nx * 15;
    const qy = y + ny * 15;
    const bar = `M ${x + nx * 19 + tx * spread} ${y + ny * 19 + ty * spread} L ${x + nx * 19 - tx * spread} ${y + ny * 19 - ty * spread}`;
    return `M ${qx} ${qy} L ${x + tx * spread} ${y + ty * spread} M ${qx} ${qy} L ${x} ${y} M ${qx} ${qy} L ${x - tx * spread} ${y - ty * spread} ${bar}`;
  }
  const b1 = `M ${x + nx * 9 + tx * spread} ${y + ny * 9 + ty * spread} L ${x + nx * 9 - tx * spread} ${y + ny * 9 - ty * spread}`;
  const b2 = `M ${x + nx * 15 + tx * spread} ${y + ny * 15 + ty * spread} L ${x + nx * 15 - tx * spread} ${y + ny * 15 - ty * spread}`;
  return `${b1} ${b2}`;
}

/** Pick facing sides of two rectangles and anchor points, offset for parallel edges. */
function floatingAnchors(a: Rect, b: Rect, offset: number) {
  const hGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const vGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (hGap > 24 || hGap >= vGap) {
    const right = b.x + b.w / 2 > a.x + a.w / 2;
    const top = Math.max(a.y, b.y) + 30;
    const bottom = Math.min(a.y + a.h, b.y + b.h) - 12;
    let ay: number, by: number;
    if (bottom - top > 10) ay = by = clamp((top + bottom) / 2 + offset, top, bottom);
    else {
      ay = clamp(a.y + Math.min(a.h / 2, 40) + offset, a.y + 12, a.y + a.h - 12);
      by = clamp(b.y + Math.min(b.h / 2, 40) + offset, b.y + 12, b.y + b.h - 12);
    }
    return {
      sx: right ? a.x + a.w : a.x,
      sy: ay,
      sp: right ? Position.Right : Position.Left,
      tx: right ? b.x : b.x + b.w,
      ty: by,
      tp: right ? Position.Left : Position.Right,
    };
  }
  const down = b.y + b.h / 2 > a.y + a.h / 2;
  const left = Math.max(a.x, b.x) + 16;
  const rightEdge = Math.min(a.x + a.w, b.x + b.w) - 16;
  const x = rightEdge - left > 10 ? clamp((left + rightEdge) / 2 + offset, left, rightEdge) : null;
  return {
    sx: x ?? a.x + a.w / 2 + offset,
    sy: down ? a.y + a.h : a.y,
    sp: down ? Position.Bottom : Position.Top,
    tx: x ?? b.x + b.w / 2 + offset,
    ty: down ? b.y : b.y + b.h,
    tp: down ? Position.Top : Position.Bottom,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------------- relationship ----------------

export type RelEdgeData = { rel: Relationship; offset: number; dimmed: boolean; highlighted: boolean };
export type RelEdgeType = Edge<RelEdgeData, 'relationship'>;

function RelationshipEdgeImpl({ id, source, target, data, selected }: EdgeProps<RelEdgeType>) {
  const a = rectOf(useInternalNode(source));
  const b = rectOf(useInternalNode(target));
  const far = useFar();
  if (!a || !b || !data) return null;
  const { rel, offset, dimmed, highlighted } = data;
  const [srcMany, tgtMany] = cardinalityEnds(rel.cardinality);
  let path: string, lx: number, ly: number, glyphs: string;
  let labelAnchor = 'translate(-50%, -50%)';

  if (source === target) {
    // Loop over the top-right corner: out of the right side at header height, back in through the top edge.
    // The two ends sit on different sides so their cardinality glyphs never collide.
    const r = a.x + a.w;
    const sy = a.y + 29;
    const X = r + 52 + offset;
    const Y = a.y - 44 - offset;
    const tx = r - 48 - offset;
    const k = 12;
    path =
      `M ${r} ${sy} L ${X - k} ${sy} Q ${X} ${sy} ${X} ${sy - k} L ${X} ${Y + k} Q ${X} ${Y} ${X - k} ${Y} ` +
      `L ${tx + k} ${Y} Q ${tx} ${Y} ${tx} ${Y + k} L ${tx} ${a.y}`;
    // Label hangs off the outside of the loop so it never covers the card.
    lx = X + 8;
    ly = (sy + Y) / 2;
    labelAnchor = 'translate(0, -50%)';
    glyphs = cardinalityGlyph(r, sy, Position.Right, srcMany) + ' ' + cardinalityGlyph(tx, a.y, Position.Top, tgtMany);
  } else {
    const p = floatingAnchors(a, b, offset);
    [path, lx, ly] = getSmoothStepPath({
      sourceX: p.sx,
      sourceY: p.sy,
      sourcePosition: p.sp,
      targetX: p.tx,
      targetY: p.ty,
      targetPosition: p.tp,
      borderRadius: 12,
      offset: 26,
    });
    glyphs = cardinalityGlyph(p.sx, p.sy, p.sp, srcMany) + ' ' + cardinalityGlyph(p.tx, p.ty, p.tp, tgtMany);
  }
  const cls = `rel-edge${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}${highlighted ? ' highlighted' : ''}`;
  return (
    <>
      <BaseEdge id={id} path={path} className={cls} interactionWidth={18} />
      <path d={glyphs} className={`rel-glyph${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}${highlighted ? ' highlighted' : ''}`} />
      {(!far || selected) && <EdgeLabelRenderer>
        <div className={`rel-label nodrag nopan${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}${highlighted ? ' highlighted' : ''}`} style={{ transform: `${labelAnchor} translate(${lx}px, ${ly}px)` }}>
          <span className="rl-text">{rel.forward_label || rel.name}</span>
          <span className="rl-card">{rel.cardinality}</span>
          {selected && rel.bidirectional && rel.reverse_label && <span className="rl-rev">⇄ {rel.reverse_label}</span>}
          {!!rel.attributes?.length && (
            <span className="rl-attrs" title={rel.attributes.map((x) => `${x.name} ${x.type}`).join('\n')}>
              {rel.attributes.length > 3 ? `${rel.attributes.slice(0, 2).map((x) => x.name).join(', ')} +${rel.attributes.length - 2}` : rel.attributes.map((x) => x.name).join(', ')}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>}
    </>
  );
}

function cardinalityEnds(c: Relationship['cardinality']): [boolean, boolean] {
  // [source end is "many", target end is "many"]: 1:N = each source has many targets.
  switch (c) {
    case '1:1':
      return [false, false];
    case '1:N':
      return [false, true];
    case 'N:1':
      return [true, false];
    case 'N:N':
      return [true, true];
  }
}

export const RelationshipEdge = memo(RelationshipEdgeImpl);

// ---------------- reference lookup ----------------

export type RefEdgeData = {
  from: Entity;
  to: Entity;
  attr: string;
  field?: string;
  output: string;
  detail: Detail;
  dimmed: boolean;
  highlighted: boolean;
};
export type RefEdgeType = Edge<RefEdgeData, 'reference'>;

function attrSideAnchors(a: Rect, b: Rect, ay: number, by: number) {
  const overlapX = a.x < b.x + b.w + 30 && b.x < a.x + a.w + 30;
  if (overlapX) return { sx: a.x + a.w, sp: Position.Right, tx: b.x + b.w, tp: Position.Right, sy: ay, ty: by };
  const right = b.x > a.x;
  return { sx: right ? a.x + a.w : a.x, sp: right ? Position.Right : Position.Left, tx: right ? b.x : b.x + b.w, tp: right ? Position.Left : Position.Right, sy: ay, ty: by };
}

function ReferenceEdgeImpl({ id, source, target, data, selected }: EdgeProps<RefEdgeType>) {
  const a = rectOf(useInternalNode(source));
  const b = rectOf(useInternalNode(target));
  if (!a || !b || !data) return null;
  const { from, to, attr, field, output, detail, dimmed, highlighted } = data;
  // A field of a folded struct has no row of its own: the line starts at the struct's row.
  const fieldRow = field && !isFolded(from, attr);
  const ay = a.y + rowCenterY(from, detail, (r) => (fieldRow ? r.kind === 'field' && r.attr === attr && r.field === field : r.kind === 'attr' && r.attr === attr));
  const by = b.y + rowCenterY(to, detail, (r) => r.kind === 'attr' && r.attr === output);
  const p = attrSideAnchors(a, b, ay, by);
  const [path] = getBezierPath({ sourceX: p.sx, sourceY: p.sy, sourcePosition: p.sp, targetX: p.tx, targetY: p.ty, targetPosition: p.tp, curvature: 0.35 });
  const [nx] = NORMAL[p.tp];
  const arrow = `M ${p.tx + nx * 8} ${p.ty - 4.5} L ${p.tx} ${p.ty} L ${p.tx + nx * 8} ${p.ty + 4.5}`;
  const cls = `ref-edge${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}${highlighted ? ' highlighted' : ''}`;
  return (
    <>
      <BaseEdge id={id} path={path} className={cls} interactionWidth={14} />
      <circle cx={p.sx} cy={p.sy} r={3} className={`ref-dot${dimmed ? ' dimmed' : ''}`} />
      <path d={arrow} className={`ref-arrow${dimmed ? ' dimmed' : ''}${selected ? ' selected' : ''}`} />
    </>
  );
}
export const ReferenceEdge = memo(ReferenceEdgeImpl);

// ---------------- dependent reference ----------------

export type DepEdgeData = { child: Entity; parent: Entity; linked: string; detail: Detail; dimmed: boolean };
export type DepEdgeType = Edge<DepEdgeData, 'dependency'>;

function DependencyEdgeImpl({ id, source, target, data, selected }: EdgeProps<DepEdgeType>) {
  const a = rectOf(useInternalNode(source));
  const b = rectOf(useInternalNode(target));
  const far = useFar();
  if (!a || !b || !data) return null;
  const { child, parent, linked, detail, dimmed } = data;
  const ay = a.y + rowCenterY(child, detail, (r) => r.kind === 'linked');
  const by = b.y + rowCenterY(parent, detail, (r) => r.kind === 'attr' && r.attr === linked);
  const p = attrSideAnchors(a, b, ay, by);
  const [path, lx, ly] = getBezierPath({ sourceX: p.sx, sourceY: p.sy, sourcePosition: p.sp, targetX: p.tx, targetY: p.ty, targetPosition: p.tp, curvature: 0.35 });
  const [nx] = NORMAL[p.tp];
  const arrow = `M ${p.tx + nx * 9} ${p.ty - 5} L ${p.tx} ${p.ty} L ${p.tx + nx * 9} ${p.ty + 5}`;
  return (
    <>
      <BaseEdge id={id} path={path} className={`dep-edge${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`} interactionWidth={14} />
      <path d={arrow} className={`dep-arrow${dimmed ? ' dimmed' : ''}`} />
      {!far && (
        <EdgeLabelRenderer>
          <div className={`dep-label nodrag nopan${dimmed ? ' dimmed' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            depends on
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
export const DependencyEdge = memo(DependencyEdgeImpl);
