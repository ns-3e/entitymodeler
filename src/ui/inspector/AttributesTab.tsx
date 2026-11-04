import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Braces, ChevronRight, ClipboardPaste, KeyRound, Book, Plus, Tag, Trash2 } from '../icons';
import { ATTR_TYPES, columnValues, deleteAttribute, renameAttribute, toLabel, uniqueName, type AttrType, type Attribute, type Entity } from '../../core';
import { useStore } from '../store';
import { CommitInput, Field, Modal, Select, TextArea, TextInput, Toggle, NumberInput } from '../components/forms';
import { TermPicker } from '../components/TermPicker';
import { mapSqlType, parseColumns, slugAttr } from '../util';
import type { EntityUpdater } from './EntityInspector';

export function AttributesTab({ entity, upd, focus }: { entity: Entity; upd: EntityUpdater; focus?: string }) {
  const [open, setOpen] = useState<string | null>(focus || null);
  const [bulk, setBulk] = useState(false);
  const update = useStore((s) => s.update);
  useEffect(() => {
    if (focus) setOpen(focus);
  }, [focus]);

  const add = () => {
    const name = uniqueName('new_attribute', entity.attributes.map((a) => a.name));
    upd((e) => {
      e.attributes.push({ name, label: toLabel(name), type: 'STRING' });
    });
    setOpen(name);
  };
  const move = (i: number, d: number) =>
    upd((e) => {
      const j = i + d;
      if (j < 0 || j >= e.attributes.length) return;
      [e.attributes[i], e.attributes[j]] = [e.attributes[j], e.attributes[i]];
    });

  return (
    <div className="attr-list">
      <div className="attr-toolbar">
        <span className="muted small">
          {entity.attributes.length} attributes · drag to reorder
          {entity.profile && ` · ${entity.profile.rows.toLocaleString()}${entity.profile.sampled ? ' sampled' : ''} rows profiled ${new Date(entity.profile.profiled_at).toLocaleDateString('en-CA')}`}
        </span>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => setBulk(true)}>
          <ClipboardPaste size={14} /> Paste columns
        </button>
        <button className="btn sm primary" onClick={add}>
          <Plus size={14} /> Attribute
        </button>
      </div>
      {entity.attributes.map((a, i) => (
        <AttributeRow
          key={a.name}
          entity={entity}
          attr={a}
          index={i}
          open={open === a.name}
          onToggle={() => setOpen(open === a.name ? null : a.name)}
          upd={upd}
          onRename={(to) => {
            update((m) => renameAttribute(m, entity.name, a.name, to));
            if (open === a.name) setOpen(to);
          }}
          onDelete={() => update((m) => deleteAttribute(m, entity.name, a.name))}
          onMove={(d) => move(i, d)}
        />
      ))}
      {!entity.attributes.length && <div className="muted small pad">No attributes yet.</div>}
      {bulk && <BulkAttributes entity={entity} upd={upd} onClose={() => setBulk(false)} />}
    </div>
  );
}

function AttributeRow({
  entity,
  attr: a,
  index,
  open,
  onToggle,
  upd,
  onRename,
  onDelete,
  onMove,
}: {
  entity: Entity;
  attr: Attribute;
  index: number;
  open: boolean;
  onToggle: () => void;
  upd: EntityUpdater;
  onRename: (to: string) => void;
  onDelete: () => void;
  onMove: (d: number) => void;
}) {
  const model = useStore((s) => s.model)!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);
  const set = (fn: (x: Attribute) => void, key?: string) =>
    upd((e) => {
      const x = e.attributes.find((y) => y.name === a.name);
      if (x) fn(x);
    }, key && `${a.name}:${key}`);
  const refEntities = model.entities.filter((e) => e.entity_type === 'reference');
  const target = model.entities.find((e) => e.name === a.reference?.entity);

  return (
    <div ref={ref} className={`attr-row${open ? ' open' : ''}${a.is_primary_key ? ' pk' : ''}`}>
      <div className="attr-main">
        <button className="icon-btn xs chevron" onClick={onToggle} aria-label="Details">
          <ChevronRight size={14} />
        </button>
        <CommitInput
          mono
          className="attr-name"
          value={a.name}
          transform={slugAttrKeepCase}
          validate={(v) =>
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(v)
              ? 'Letters, digits, _'
              : entity.attributes.some((x) => x !== a && x.name.toLowerCase() === v.toLowerCase())
                ? 'Duplicate'
                : null
          }
          onCommit={onRename}
        />
        <Select<AttrType>
          mono
          className="attr-type"
          value={a.type}
          onChange={(t) =>
            set((x) => {
              x.type = t;
              if (t === 'REFERENCE_ENTITY') {
                x.reference = x.reference || { entity: refEntities[0]?.name || '', output_attribute: refEntities[0]?.attributes.find((y) => y.is_label)?.name || refEntities[0]?.attributes[0]?.name || '' };
                x.is_primary_key = false;
              } else delete x.reference;
              if (t === 'STRUCT') {
                x.struct_type = x.struct_type || entity.struct_types?.[0]?.name;
                x.is_primary_key = false;
              } else delete x.struct_type;
            })
          }
          options={ATTR_TYPES.map((t) => ({ value: t, label: t === 'REFERENCE_ENTITY' ? 'REFERENCE' : t }))}
        />
        <div className="attr-flags">
          <button
            className={`flag${a.is_primary_key ? ' on pk' : ''}`}
            title={a.type === 'STRUCT' || a.is_array ? 'Struct and array attributes can’t be primary keys.' : 'Primary key'}
            disabled={a.type === 'STRUCT' || !!a.is_array}
            onClick={() =>
              upd((e) => {
                const on = !a.is_primary_key;
                for (const x of e.attributes) if (e.entity_type === 'reference' && on) x.is_primary_key = false;
                e.attributes.find((y) => y.name === a.name)!.is_primary_key = on;
              })
            }
          >
            <KeyRound size={14} />
          </button>
          <button
            className={`flag${a.is_label ? ' on label' : ''}`}
            title="Primary display field (label)"
            onClick={() =>
              upd((e) => {
                const on = !a.is_label;
                for (const x of e.attributes) x.is_label = false;
                e.attributes.find((y) => y.name === a.name)!.is_label = on;
              })
            }
          >
            <Tag size={14} />
          </button>
          <button
            className={`flag${a.is_array ? ' on arr' : ''}`}
            title="Array"
            onClick={() =>
              set((x) => {
                x.is_array = !x.is_array;
                if (x.is_array) x.is_primary_key = false;
              })
            }
          >
            []
          </button>
        </div>
        <div className="attr-move">
          <button className="icon-btn xs" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp size={12} />
          </button>
          <button className="icon-btn xs" disabled={index === entity.attributes.length - 1} onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown size={12} />
          </button>
        </div>
      </div>
      {a.type === 'REFERENCE_ENTITY' && !open && (
        <div className="attr-sub">
          <Book size={12} /> {a.reference?.entity || '?'} <span className="muted">↳ {a.reference?.output_attribute || '?'}</span>
        </div>
      )}
      {a.example && !open && a.type !== 'REFERENCE_ENTITY' && a.type !== 'STRUCT' && (
        <div className="attr-sub example">
          e.g. <span className="mono">{a.example}</span>
        </div>
      )}
      {a.type === 'STRUCT' && !open && (
        <div className="attr-sub">
          <Braces size={12} /> {a.struct_type || 'no struct type'}
        </div>
      )}
      {a.profile && entity.profile?.rows ? (
        <div className="attr-sub example" title="Measured with em profile">
          {profileLine(a.profile, entity.profile.rows)}
        </div>
      ) : null}
      {open && (
        <div className="attr-detail">
          <div className="grid2">
            <Field label="Label">
              <TextInput value={a.label} onChange={(v) => set((x) => void (x.label = v), 'label')} />
            </Field>
            <Field label="Example value">
              <TextInput value={a.example} onChange={(v) => set((x) => void (x.example = v), 'example')} placeholder="e.g. ACME-0042" />
            </Field>
          </div>
          {a.type === 'REFERENCE_ENTITY' && (
            <div className="ref-config">
              <div className="ref-config-title">Reference data configuration</div>
              <div className="grid2">
                <Field label="Reference entity">
                  <Select
                    value={a.reference?.entity}
                    placeholder="Choose…"
                    onChange={(v) =>
                      set((x) => {
                        const r = model.entities.find((e) => e.name === v);
                        x.reference = { entity: v, output_attribute: r?.attributes.find((y) => y.is_label)?.name || r?.attributes[0]?.name || '' };
                      })
                    }
                    options={refEntities.map((e) => ({ value: e.name, label: e.display_name }))}
                  />
                </Field>
                <Field label="Output attribute">
                  <Select
                    mono
                    value={a.reference?.output_attribute}
                    placeholder="Choose…"
                    onChange={(v) => set((x) => void (x.reference = { entity: x.reference?.entity || '', output_attribute: v }))}
                    options={(target?.attributes || []).map((y) => y.name)}
                  />
                </Field>
              </div>
              {!refEntities.length && <div className="muted small">Create a Reference entity first.</div>}
              <AllowedValues values={columnValues(target, a.reference?.output_attribute)} emptyHint={target ? `No values recorded on ${target.display_name} yet — add them on its Values tab.` : ''} />
            </div>
          )}
          {a.type === 'DECIMAL' && (
            <div className="grid2">
              <Field label="Precision" hint="Total digits (default 18).">
                <NumberInput step={1} min={1} max={38} value={a.precision} onChange={(v) => set((x) => void (x.precision = Math.round(v)), 'precision')} />
              </Field>
              <Field label="Scale" hint="Digits after the point (default 2).">
                <NumberInput step={1} min={0} max={38} value={a.scale} onChange={(v) => set((x) => void (x.scale = Math.round(v)), 'scale')} />
              </Field>
            </div>
          )}
          {a.type === 'STRUCT' && (
            <Field label="Struct type" hint="Define struct types on the Structs tab.">
              <Select value={a.struct_type} placeholder="Choose…" onChange={(v) => set((x) => void (x.struct_type = v))} options={(entity.struct_types || []).map((s) => s.name)} />
            </Field>
          )}
          <Field label="Description">
            <TextArea value={a.description} rows={2} onChange={(v) => set((x) => void (x.description = v), 'desc')} />
          </Field>
          <Field label="Business term">
            <TermPicker entity={entity.name} attribute={a.name} current={a.term} name={a.name} label={a.label} />
          </Field>
          <div className="toggles-row">
            <Toggle checked={a.required} onChange={(v) => set((x) => void (x.required = v))} label="Required" title="Design metadata" />
            <Toggle checked={a.pii} onChange={(v) => set((x) => void (x.pii = v))} label="PII" title="Design metadata" />
            {!a.is_primary_key && <Toggle checked={a.unique} onChange={(v) => set((x) => void (v ? (x.unique = true) : delete x.unique))} label="Unique" title="A UNIQUE constraint in SQL and a unique test in dbt" />}
          </div>
          <div className="row-end">
            <button className="btn sm danger ghost" onClick={onDelete}>
              <Trash2 size={14} /> Delete attribute
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "12% empty · 3 distinct · 1 – 300": what profiling found, in one line. */
function profileLine(p: NonNullable<Attribute['profile']>, rows: number): string {
  const empty = rows - p.non_null;
  const parts = [empty === 0 ? 'never empty' : empty === rows ? 'always empty' : `${Math.max(1, Math.round((100 * empty) / rows))}% empty`];
  if (p.distinct !== undefined && p.non_null) parts.push(p.distinct >= p.non_null ? 'all distinct' : `${p.distinct.toLocaleString()} distinct`);
  if (p.min !== undefined && p.max !== undefined) parts.push(p.min === p.max ? p.min : `${p.min} – ${p.max}`);
  if (p.max_length !== undefined) parts.push(`up to ${p.max_length} chars`);
  return parts.join(' · ');
}

export function AllowedValues({ values, emptyHint, max = 24 }: { values: string[]; emptyHint?: string; max?: number }) {
  if (!values.length) return emptyHint ? <div className="muted small">{emptyHint}</div> : null;
  return (
    <div className="allowed-values">
      <span className="muted small">{values.length} allowed value(s):</span>
      {values.slice(0, max).map((v) => (
        <span key={v} className="val-chip mono">
          {v}
        </span>
      ))}
      {values.length > max && <span className="muted small">+{values.length - max} more</span>}
    </div>
  );
}

const slugAttrKeepCase = (v: string) => v.trim().replace(/[^A-Za-z0-9_]+/g, '_');

function BulkAttributes({ entity, upd, onClose }: { entity: Entity; upd: EntityUpdater; onClose: () => void }) {
  const [text, setText] = useState('');
  const parsed = parseColumns(text);
  const existing = new Set(entity.attributes.map((a) => a.name.toLowerCase()));
  const apply = () => {
    upd((e) => {
      for (const c of parsed) {
        const name = slugAttr(c.name);
        if (!name || e.attributes.some((a) => a.name.toLowerCase() === name)) continue;
        e.attributes.push({ name, label: toLabel(name), type: mapSqlType(c.type), description: c.description || '' });
      }
    });
    onClose();
  };
  return (
    <Modal
      title={`Paste attributes into ${entity.display_name}`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <span className="muted small">{parsed.filter((c) => !existing.has(slugAttr(c.name))).length} new attribute(s)</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!parsed.length} title={parsed.length ? undefined : 'Paste column names first.'} onClick={apply}>
            Add attributes
          </button>
        </>
      }
    >
      <p className="muted small">Paste a CREATE TABLE statement, "name TYPE" lines, CSV (name,type,description) or rows copied from a spreadsheet. SQL types are mapped to the model's scalar types.</p>
      <TextArea value={text} onChange={setText} rows={10} mono placeholder={'supplier_id STRING\nsupplier_name VARCHAR(200)\nannual_spend DECIMAL(18,2)\nonboarded_on DATE'} />
      {parsed.length > 0 && (
        <div className="bulk-preview">
          {parsed.slice(0, 60).map((c, i) => (
            <div key={i} className={existing.has(slugAttr(c.name)) ? 'dupe' : ''}>
              <span className="mono">{slugAttr(c.name)}</span>
              <span className="mono muted">{mapSqlType(c.type)}</span>
              <span className="muted small">{existing.has(slugAttr(c.name)) ? 'exists — skipped' : c.description}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
