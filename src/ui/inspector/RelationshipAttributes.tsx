import { Plus, Trash2 } from '../icons';
import { SCALAR_TYPES, relationshipEnds, toLabel, uniqueName, type AttrType, type Relationship } from '../../core';
import { useStore } from '../store';
import { Check, CommitInput, NumberInput, Select, TextInput } from '../components/forms';

const NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Attributes of a relationship itself (an enrollment's grade, an assignment's start date). They describe the
 * link, not either entity: exports put them on the junction table for N:N, otherwise on the child table.
 */
export function RelationshipAttributes({ r }: { r: Relationship }) {
  const m = useStore((s) => s.model)!;
  const update = useStore((s) => s.update);
  const attrs = r.attributes || [];
  const set = (fn: (x: Relationship) => void, key?: string) =>
    update((d) => {
      const x = d.relationships.find((y) => y.name === r.name);
      if (x) fn(x);
    }, key && `relattr:${r.name}:${key}`);
  const ends = relationshipEnds(r);
  const where = ends ? `columns of ${m.entities.find((e) => e.name === ends.child)?.display_name || ends.child}` : `columns of the ${r.name} junction table`;

  return (
    <>
      <div className="section-title">
        <span>Relationship attributes</span>
        <button
          className="btn xs"
          title="Add an attribute that describes the relationship itself"
          onClick={() => set((x) => void (x.attributes = [...(x.attributes || []), { name: uniqueName('attribute', (x.attributes || []).map((a) => a.name)), label: 'Attribute', type: 'STRING' }]))}
        >
          <Plus size={12} /> Attribute
        </button>
      </div>
      <p className="muted small rel-attr-hint">
        Facts about the link itself, like an enrollment's grade or a role's start date. {attrs.length ? `Exports make them ${where}.` : `In exports they become ${where}.`}
      </p>
      {attrs.map((a, i) => (
        <div className="rel-attr" key={`${a.name}:${i}`}>
          <div className="rel-attr-row">
            <CommitInput
              mono
              value={a.name}
              transform={(v) => v.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_')}
              validate={(v) => (!NAME.test(v) ? 'Lowercase letters, digits and underscores' : attrs.some((o, j) => j !== i && o.name === v) ? 'Name in use' : null)}
              onCommit={(v) =>
                set((x) => {
                  const t = x.attributes![i];
                  // Keep a label the person wrote; regenerate one that was derived from the old name.
                  if (!t.label || t.label === toLabel(t.name)) t.label = toLabel(v);
                  t.name = v;
                })
              }
            />
            <Select<AttrType> mono value={a.type} onChange={(v) => set((x) => void (x.attributes![i].type = v))} options={SCALAR_TYPES.map((t) => ({ value: t, label: t }))} />
            <button className="icon-btn danger" title={`Remove ${a.name}`} onClick={() => set((x) => void x.attributes!.splice(i, 1))}>
              <Trash2 size={14} />
            </button>
          </div>
          <div className="rel-attr-row">
            <label className="rel-attr-check">
              <Check checked={a.required} onChange={(v) => set((x) => void (x.attributes![i].required = v || undefined))} title="Every link has a value" /> Required
            </label>
            {a.type === 'DECIMAL' && (
              <span className="rel-attr-num">
                <label className="rel-attr-check">
                  Precision <NumberInput step={1} min={1} max={38} value={a.precision ?? 18} onChange={(v) => set((x) => void (x.attributes![i].precision = v), `p${i}`)} />
                </label>
                <label className="rel-attr-check">
                  Scale <NumberInput step={1} min={0} max={38} value={a.scale ?? 2} onChange={(v) => set((x) => void (x.attributes![i].scale = v), `s${i}`)} />
                </label>
              </span>
            )}
          </div>
          <TextInput value={a.description} onChange={(v) => set((x) => void (x.attributes![i].description = v), `d${i}`)} placeholder="Description" />
        </div>
      ))}
    </>
  );
}
