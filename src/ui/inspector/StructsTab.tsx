import { ArrowDown, ArrowUp, Braces, Plus, Trash2 } from '../icons';
import { SCALAR_TYPES, uniqueName, type Entity, type StructField } from '../../core';
import { useStore } from '../store';
import { CommitInput, Empty, Select, TextInput } from '../components/forms';
import type { EntityUpdater } from './EntityInspector';

export function StructsTab({ entity, upd }: { entity: Entity; upd: EntityUpdater }) {
  const model = useStore((s) => s.model)!;
  const refs = model.entities.filter((e) => e.entity_type === 'reference');
  const structs = entity.struct_types || [];
  const usedBy = (n: string) => entity.attributes.filter((a) => a.type === 'STRUCT' && a.struct_type === n).map((a) => a.name);

  const addStruct = () =>
    upd((e) => {
      e.struct_types = e.struct_types || [];
      e.struct_types.push({ name: uniqueName('address', e.struct_types.map((s) => s.name)), fields: [{ name: 'line1', type: 'STRING' }] });
    });

  return (
    <div className="stack">
      <p className="muted small">
        Struct types are per entity. Fields are scalars or REFERENCE_ENTITY only — no nesting. Use an ARRAY attribute for repeating groups (ARRAY&lt;STRUCT&gt;).
      </p>
      {!structs.length && (
        <Empty icon={<Braces size={22} />} title="No struct types">
          Group fields like an address into one complex attribute.
        </Empty>
      )}
      {structs.map((st, si) => {
        const setSt = (fn: (s: typeof st) => void, key?: string) =>
          upd((e) => {
            const s = e.struct_types![si];
            if (s) fn(s);
          }, key && `struct:${si}:${key}`);
        const setField = (fi: number, fn: (f: StructField) => void, key?: string) => setSt((s) => fn(s.fields[fi]), key && `${fi}:${key}`);
        return (
          <div className="card" key={si}>
            <div className="card-head">
              <CommitInput
                mono
                value={st.name}
                transform={(v) => v.trim().replace(/[^A-Za-z0-9_]+/g, '_')}
                validate={(v) => (!v ? 'Required' : structs.some((x, i) => i !== si && x.name === v) ? 'Duplicate' : null)}
                onCommit={(v) =>
                  upd((e) => {
                    const old = e.struct_types![si].name;
                    e.struct_types![si].name = v;
                    for (const a of e.attributes) if (a.struct_type === old) a.struct_type = v;
                  })
                }
              />
              <span className="muted small">{usedBy(st.name).length ? `used by ${usedBy(st.name).join(', ')}` : 'unused'}</span>
              <button
                className="icon-btn danger"
                title="Delete struct type"
                onClick={() =>
                  upd((e) => {
                    e.struct_types!.splice(si, 1);
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="struct-fields">
              {st.fields.map((f, fi) => {
                const target = model.entities.find((e) => e.name === f.reference?.entity);
                return (
                  <div className="struct-field" key={fi}>
                    <div className="sf-main">
                      <TextInput mono value={f.name} onChange={(v) => setField(fi, (x) => void (x.name = v.replace(/[^A-Za-z0-9_]/g, '_')), 'name')} />
                      <Select
                        mono
                        value={f.type}
                        onChange={(t) =>
                          setField(fi, (x) => {
                            x.type = t;
                            if (t === 'REFERENCE_ENTITY') x.reference = x.reference || { entity: refs[0]?.name || '', output_attribute: refs[0]?.attributes[0]?.name || '' };
                            else delete x.reference;
                          })
                        }
                        options={[...SCALAR_TYPES.map((t) => ({ value: t, label: t })), { value: 'REFERENCE_ENTITY' as const, label: 'REFERENCE' }]}
                      />
                      <button className="icon-btn xs" disabled={fi === 0} onClick={() => setSt((s) => void s.fields.splice(fi - 1, 0, s.fields.splice(fi, 1)[0]))}>
                        <ArrowUp size={12} />
                      </button>
                      <button className="icon-btn xs" disabled={fi === st.fields.length - 1} onClick={() => setSt((s) => void s.fields.splice(fi + 1, 0, s.fields.splice(fi, 1)[0]))}>
                        <ArrowDown size={12} />
                      </button>
                      <button className="icon-btn xs danger" onClick={() => setSt((s) => void s.fields.splice(fi, 1))}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {f.type === 'REFERENCE_ENTITY' && (
                      <div className="sf-ref">
                        <Select
                          value={f.reference?.entity}
                          placeholder="Reference entity"
                          onChange={(v) =>
                            setField(fi, (x) => {
                              const r = model.entities.find((e) => e.name === v);
                              x.reference = { entity: v, output_attribute: r?.attributes.find((a) => a.is_label)?.name || r?.attributes[0]?.name || '' };
                            })
                          }
                          options={refs.map((r) => ({ value: r.name, label: r.display_name }))}
                        />
                        <Select
                          mono
                          value={f.reference?.output_attribute}
                          placeholder="Output attribute"
                          onChange={(v) => setField(fi, (x) => void (x.reference = { entity: x.reference?.entity || '', output_attribute: v }))}
                          options={(target?.attributes || []).map((a) => a.name)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              <button className="btn sm ghost" onClick={() => setSt((s) => void s.fields.push({ name: uniqueName('field', s.fields.map((f) => f.name)), type: 'STRING' }))}>
                <Plus size={14} /> Field
              </button>
            </div>
          </div>
        );
      })}
      <button className="btn sm" onClick={addStruct}>
        <Plus size={14} /> Struct type
      </button>
    </div>
  );
}
