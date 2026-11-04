import { memo } from 'react';
import { Handle, Position, useStore as useFlowStore, type Node, type NodeProps } from '@xyflow/react';
import { BookMarked, Braces, ChevronDown, ChevronRight, CornerDownRight, Database, KeyRound, Book, ListOrdered, MessageSquare, Tag, TriangleAlert, CircleX } from '../icons';
import { columnValues, previewList, primaryKey } from '../../core';
import type { Entity } from '../../core';
import { useStore, type Detail } from '../store';
import { nodeRows, hasFooter, isFolded, nodeWidth, ROW_H, ROWS_PAD } from './geometry';
import { toggleFold } from '../components/actions';

export type EntityNodeData = {
  entity: Entity;
  detail: Detail;
  errors: number;
  warnings: number;
  dimmed: boolean;
  highlighted: boolean;
  pendingSource: boolean;
  highlightAttr?: string;
  /** Open review comments on this entity. */
  comments?: number;
  /** Values of a reference entity's column, for hover hints on reference attributes. */
  lookup: (entity: string | undefined, column: string | undefined) => string[];
};
export type EntityNodeType = Node<EntityNodeData, 'entity'>;

/** Below this zoom, attribute rows are too small to read: draw a same-sized placeholder instead (much cheaper). */
export const LOD_ZOOM = 0.4;
export function useFar() {
  const far = useFlowStore((s) => s.transform[2] < LOD_ZOOM);
  // Image export captures the DOM at the current zoom: it needs full detail.
  const renderAll = useStore((s) => s.renderAll);
  return far && !renderAll;
}

const TYPE_META = {
  standard: { label: 'ENTITY', Icon: Database },
  reference: { label: 'REFERENCE', Icon: BookMarked },
} as const;

/** Folds a STRUCT attribute's fields into its row, or shows them again. */
function FoldButton({ entity, attr }: { entity: Entity; attr: string }) {
  const a = entity.attributes.find((x) => x.name === attr);
  const n = entity.struct_types?.find((s) => s.name === a?.struct_type)?.fields.length || 0;
  if (!n) return null;
  const folded = isFolded(entity, attr);
  return (
    <button
      type="button"
      className={`en-fold nodrag${folded ? ' folded' : ''}`}
      title={folded ? `Show the ${n} fields of ${attr}` : `Fold the fields of ${attr} into one row`}
      aria-label={folded ? `Show ${attr} fields` : `Fold ${attr} fields`}
      aria-expanded={!folded}
      onClick={(ev) => {
        ev.stopPropagation();
        toggleFold(entity.name, attr);
      }}
    >
      {folded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      {folded && <span>{n}</span>}
    </button>
  );
}

function EntityNodeImpl({ data, selected }: NodeProps<EntityNodeType>) {
  const { entity: e, detail, errors, warnings, dimmed, highlighted, pendingSource, highlightAttr, lookup, comments } = data;
  const allowed = (ref?: { entity: string; output_attribute: string }) => {
    const vals = lookup(ref?.entity, ref?.output_attribute);
    return vals.length ? `\nValues: ${previewList(vals, 12)}` : '';
  };
  const far = useFar();
  const meta = TYPE_META[e.entity_type];
  const rows = nodeRows(e, detail);
  const footer = hasFooter(e);
  const cls = [
    'entity-node',
    `type-${e.entity_type}`,
    selected ? 'selected' : '',
    dimmed ? 'dimmed' : '',
    highlighted ? 'highlighted' : '',
    pendingSource ? 'pending' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} style={{ width: nodeWidth(e), ['--entity-color' as any]: e.color_code }}>
      <Handle type="target" position={Position.Top} className="hidden-handle" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="hidden-handle" isConnectable={false} />
      <div className="en-strip" />
      <div className="en-header">
        <div className="en-icon">
          <meta.Icon size={16} />
        </div>
        <div className="en-titles">
          <div className="en-title" title={e.display_name}>
            {e.display_name}
          </div>
          <div className="en-sub">
            <span className="mono">{e.name}</span>
            <span className="en-dot">·</span>
            <span>{e.attributes.length} attr</span>
          </div>
        </div>
        <div className="en-badges">
          {(!!comments || errors > 0 || warnings > 0) && (
            <span className="en-flags">
              {!!comments && (
                <span className="en-issue en-comments" title={`${comments} open review comment${comments === 1 ? '' : 's'}`}>
                  <MessageSquare size={12} /> {comments}
                </span>
              )}
              {errors > 0 ? (
                <span className="en-issue error" title={`${errors} error(s)`}>
                  <CircleX size={12} /> {errors}
                </span>
              ) : warnings > 0 ? (
                <span className="en-issue warning" title={`${warnings} warning(s)`}>
                  <TriangleAlert size={12} /> {warnings}
                </span>
              ) : null}
            </span>
          )}
          <span className={`en-type en-type-${e.entity_type}`}>{meta.label}</span>
        </div>
      </div>
      {rows.length > 0 && far && <div className="en-rows lod" style={{ height: rows.length * ROW_H + ROWS_PAD * 2 }} />}
      {rows.length > 0 && !far && (
        <div className="en-rows">
          {rows.map((r) => {
            if (r.kind === 'linked') {
              return (
                <div key={r.key} className="en-row linked" title={`Parent reference → ${e.dependent_reference?.parent}`}>
                  <span className="en-ico">
                    <Book size={12} />
                  </span>
                  <span className="en-name mono">{r.attr}</span>
                  <span className="en-ref">↑ {e.dependent_reference?.parent}</span>
                </div>
              );
            }
            const a = e.attributes.find((x) => x.name === r.attr)!;
            if (r.kind === 'field') {
              const st = e.struct_types?.find((s) => s.name === a.struct_type);
              const f = st?.fields.find((x) => x.name === r.field)!;
              return (
                <div key={r.key} className={`en-row en-field${highlightAttr === a.name ? ' hl' : ''}`} data-attr={a.name} title={`${a.name}.${f.name}${f.reference ? ` → ${f.reference.entity}.${f.reference.output_attribute}${allowed(f.reference)}` : ` (${f.type})`}`}>
                  <span className="en-ico">
                    <CornerDownRight size={12} />
                  </span>
                  <span className="en-name mono">{f.name}</span>
                  {f.type === 'REFERENCE_ENTITY' ? <span className="en-ref">→ {f.reference?.entity || '?'}</span> : <span className="en-typ mono">{f.type}</span>}
                </div>
              );
            }
            const isRef = a.type === 'REFERENCE_ENTITY';
            return (
              <div
                key={r.key}
                className={`en-row${a.is_primary_key ? ' pk' : ''}${highlightAttr === a.name ? ' hl' : ''}`}
                data-attr={a.name}
                title={`${a.name} — ${a.label}${isRef ? `\n→ ${a.reference?.entity}.${a.reference?.output_attribute}${allowed(a.reference)}` : ''}${a.example ? `\nExample: ${a.example}` : ''}${a.description ? `\n${a.description}` : ''}`}
              >
                <span className="en-ico">
                  {a.is_primary_key ? (
                    <KeyRound size={12} className="ic-pk" />
                  ) : isRef ? (
                    <Book size={12} className="ic-ref" />
                  ) : a.type === 'STRUCT' ? (
                    <Braces size={12} className="ic-struct" />
                  ) : a.is_label ? (
                    <Tag size={12} className="ic-label" />
                  ) : null}
                </span>
                <span className={`en-name mono${a.is_label ? ' is-label' : ''}`}>
                  {a.name}
                </span>
                {isRef ? (
                  <span className="en-ref">
                    → {a.reference?.entity || '?'}
                  </span>
                ) : (
                  <span className="en-typ mono">
                    {a.is_array ? `${a.type === 'STRUCT' ? a.struct_type : a.type}[]` : a.type === 'STRUCT' ? a.struct_type || 'STRUCT' : a.type}
                  </span>
                )}
                {a.type === 'STRUCT' && <FoldButton entity={e} attr={a.name} />}
              </div>
            );
          })}
        </div>
      )}
      {footer && (
        <div className="en-footer">
          {!!e.reference_values?.length && (
            <span className="en-values" title={`${e.reference_values.length} values: ${previewList(columnValues(e, primaryKey(e)?.name), 15)}`}>
              <ListOrdered size={12} /> {e.reference_values.length} values
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const EntityNode = memo(EntityNodeImpl);
