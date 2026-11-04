import { ENTITY_COLORS, REFERENCE_COLORS, primaryKey, referenceUsages, type Entity, type EntityType } from '../../core';
import { useStore } from '../store';
import { ColorSwatches, Field, Segmented, Select, TextArea, Toggle } from '../components/forms';
import type { EntityUpdater } from './EntityInspector';
import { TermPicker } from '../components/TermPicker';

export function GeneralTab({ entity, upd }: { entity: Entity; upd: EntityUpdater }) {
  const model = useStore((s) => s.model)!;
  const select = useStore((s) => s.select);
  const usages = entity.entity_type === 'reference' ? referenceUsages(model, entity.name) : [];

  // Eligible dependent-reference parents: other reference entities that are not descendants of this one.
  const descendants = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of model.entities)
      if (e.dependent_reference && (e.dependent_reference.parent === entity.name || descendants.has(e.dependent_reference.parent)) && !descendants.has(e.name)) {
        descendants.add(e.name);
        grew = true;
      }
  }
  const parents = model.entities.filter((e) => e.entity_type === 'reference' && e.name !== entity.name && !descendants.has(e.name));
  const dep = entity.dependent_reference;
  const parent = model.entities.find((e) => e.name === dep?.parent);

  return (
    <div className="stack">
      <Field label="Entity type" hint="Reference entities hold controlled lists of values that other entities point at.">
        <Segmented<EntityType>
          value={entity.entity_type}
          onChange={(v) =>
            upd((e) => {
              e.entity_type = v;
              if (v !== 'reference') e.dependent_reference = null;
            })
          }
          options={[
            { value: 'standard', label: 'Entity' },
            { value: 'reference', label: 'Reference' },
          ]}
        />
      </Field>
      <Field label="Description">
        <TextArea
          value={entity.description}
          rows={3}
          placeholder="What business concept does this entity represent?"
          onChange={(v) =>
            upd((e) => {
              e.description = v;
            }, 'desc')
          }
        />
      </Field>
      <Field label="Business term" hint="From the shared glossary; the docs and Databricks tags use it.">
        <TermPicker entity={entity.name} current={entity.term} name={entity.name} label={entity.display_name} />
      </Field>
      <Field label="Color">
        <ColorSwatches
          value={entity.color_code}
          colors={entity.entity_type === 'reference' ? [...REFERENCE_COLORS, ...ENTITY_COLORS.slice(0, 7)] : ENTITY_COLORS}
          onChange={(c) =>
            upd((e) => {
              e.color_code = c;
            }, 'color')
          }
        />
      </Field>
      {model.areas.length > 0 && (
        <Field label="Subject area">
          <Select
            value={entity.area || ''}
            onChange={(v) =>
              upd((e) => {
                e.area = v || undefined;
              })
            }
            options={[{ value: '', label: '— none —' }, ...model.areas.map((a) => ({ value: a.name, label: a.name }))]}
          />
        </Field>
      )}

      {entity.entity_type === 'reference' && (
        <div className="card">
          <div className="card-head">
            <span>Dependent reference</span>
            <Toggle
              checked={!!dep}
              onChange={(on) =>
                upd((e) => {
                  if (!on) e.dependent_reference = null;
                  else {
                    const p = parents[0];
                    e.dependent_reference = { parent: p?.name || '', linked_column: (p && primaryKey(p)?.name) || '' };
                  }
                })
              }
            />
          </div>
          <p className="muted small">Constrains values to a parent list (Country → State → City).</p>
          {dep && (
            <div className="grid2">
              <Field label="Parent entity">
                <Select
                  value={dep.parent}
                  placeholder="Choose parent"
                  onChange={(v) =>
                    upd((e) => {
                      const p = model.entities.find((x) => x.name === v);
                      e.dependent_reference = { parent: v, linked_column: (p && primaryKey(p)?.name) || '' };
                    })
                  }
                  options={parents.map((p) => ({ value: p.name, label: `${p.display_name}${primaryKey(p) ? ` (PK ${primaryKey(p)!.name})` : ''}` }))}
                />
              </Field>
              <Field label="Linked column">
                <Select
                  mono
                  value={dep.linked_column}
                  placeholder="Parent attribute"
                  onChange={(v) =>
                    upd((e) => {
                      e.dependent_reference!.linked_column = v;
                    })
                  }
                  options={(parent?.attributes || []).map((a) => ({ value: a.name, label: `${a.name}${a.is_primary_key ? ' (PK)' : ''}` }))}
                />
              </Field>
            </div>
          )}
        </div>
      )}

      {usages.length > 0 && (
        <div className="card">
          <div className="card-head">
            <span>Used by</span>
            <span className="muted small">{usages.length}</span>
          </div>
          <ul className="link-list">
            {usages.map((u) => (
              <li key={`${u.entity}.${u.attribute}`}>
                <button className="link" onClick={() => select({ kind: 'entity', name: u.entity, tab: 'attributes', attribute: u.attribute.split('.')[0] })}>
                  {u.entity}.{u.attribute}
                </button>
                <span className="muted small mono"> stores {u.output}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Field label="Design notes" hint="Internal notes — kept in the model file, not shown in the docs.">
        <TextArea
          value={entity.notes}
          rows={3}
          onChange={(v) =>
            upd((e) => {
              e.notes = v;
            }, 'notes')
          }
        />
      </Field>
    </div>
  );
}
