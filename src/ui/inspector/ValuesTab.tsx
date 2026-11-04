import { useMemo, useRef, useState } from 'react';
import { ClipboardPaste, Download, FileUp, ListOrdered, Plus, Search, Trash2 } from '../icons';
import { columnValues, parseDelimited, primaryKey, rowsToValues, valueColumns, valuesToCSV, type Entity } from '../../core';
import { useStore } from '../store';
import { downloadBlob } from '../download';
import { Empty, Field, Modal, Segmented, TextArea, TextInput } from '../components/forms';
import type { EntityUpdater } from './EntityInspector';

const PAGE = 300;

export function ValuesTab({ entity, upd }: { entity: Entity; upd: EntityUpdater }) {
  const model = useStore((s) => s.model)!;
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState('');
  const [paste, setPaste] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const fileRef = useRef<HTMLInputElement>(null);
  const cols = valueColumns(entity);
  const values = entity.reference_values || [];
  const pk = primaryKey(entity);
  const linked = entity.dependent_reference?.linked_column;
  const parent = model.entities.find((e) => e.name === entity.dependent_reference?.parent);
  const parentKeys = linked ? columnValues(parent, linked) : [];

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return values.map((v, i) => ({ v, i })).filter(({ v }) => !needle || Object.values(v).some((x) => x.toLowerCase().includes(needle)));
  }, [values, q]);

  const dupKeys = useMemo(() => {
    if (!pk) return new Set<string>();
    const seen = new Set<string>();
    const d = new Set<string>();
    for (const v of values) {
      const k = v[pk.name];
      if (k) (seen.has(k) ? d : seen).add(k);
    }
    return d;
  }, [values, pk]);

  const setCell = (i: number, col: string, val: string) =>
    upd((e) => {
      const row = e.reference_values![i];
      if (val) row[col] = val;
      else delete row[col];
    }, `val:${i}:${col}`);

  const importText = async (text: string, mode: 'append' | 'replace') => {
    const { values: incoming, header, unknown } = rowsToValues(entity, parseDelimited(text));
    if (!incoming.length) return toast('No rows found', 'error');
    upd((e) => {
      e.reference_values = mode === 'replace' ? incoming : [...(e.reference_values || []), ...incoming];
    });
    toast(`${mode === 'replace' ? 'Loaded' : 'Added'} ${incoming.length} value(s)${header ? ' (header detected)' : ''}${unknown.length ? ` — ignored columns: ${unknown.join(', ')}` : ''}`, 'success');
  };

  return (
    <div className="stack">
      <p className="muted small">
        The values this list holds. They document what each code means, show up as hints on the attributes that reference this list, go into the design-doc tables, and download as{' '}
        <span className="mono">{entity.name}.csv</span>.
      </p>
      <Field label="Source of values">
        <TextInput
          value={entity.reference_values_source}
          placeholder="e.g. ISO 3166-1, codes workbook v1.1"
          onChange={(v) =>
            upd((e) => {
              e.reference_values_source = v || undefined;
            }, 'valsrc')
          }
        />
      </Field>
      <div className="attr-toolbar">
        <span className="muted small">
          <b>{values.length}</b> values{dupKeys.size > 0 && <span className="text-error"> · {dupKeys.size} duplicate key(s)</span>}
        </span>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => setPaste(true)} title="Paste rows from Excel, Sheets or CSV">
          <ClipboardPaste size={14} /> Paste
        </button>
        <button className="btn sm ghost" onClick={() => fileRef.current?.click()} title="Import a CSV file">
          <FileUp size={14} />
        </button>
        <button className="btn sm ghost" disabled={!values.length} onClick={() => downloadBlob(valuesToCSV(entity), `${entity.name}.csv`, 'text/csv')} title="Download CSV">
          <Download size={14} />
        </button>
        <button
          className="btn sm primary"
          onClick={() => {
            upd((e) => {
              e.reference_values = [...(e.reference_values || []), {}];
            });
            setQ('');
            setLimit(Math.max(limit, values.length + 1));
          }}
        >
          <Plus size={14} /> Value
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt"
        hidden
        onChange={async (ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = '';
          if (f) importText(await f.text(), values.length && !window.confirm(`Replace the ${values.length} existing values? (Cancel appends)`) ? 'append' : 'replace');
        }}
      />
      {values.length === 0 ? (
        <Empty icon={<ListOrdered size={22} />} title="No values yet">
          Paste the list from a spreadsheet or a source extract. A header row with attribute names ({cols.join(', ')}) is matched automatically.
        </Empty>
      ) : (
        <>
          {values.length > 12 && (
            <div className="side-search values-search">
              <Search size={14} />
              <input placeholder="Filter values…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <div className="values-grid" style={{ gridTemplateColumns: `${cols.map(() => 'minmax(90px, 1fr)').join(' ')} 26px` }}>
            {cols.map((c) => (
              <div key={c} className={`vg-head mono${c === pk?.name ? ' pk' : ''}${c === linked ? ' linked' : ''}`} title={c === linked ? `Parent reference → ${parent?.display_name}` : c}>
                {c === linked ? `↑ ${c}` : c}
              </div>
            ))}
            <div className="vg-head" />
            {rows.slice(0, limit).map(({ v, i }) => (
              <ValueRow
                key={i}
                cols={cols}
                v={v}
                listId={linked ? `parent-${entity.name}` : undefined}
                linked={linked}
                badKey={!!pk && (!v[pk.name] || dupKeys.has(v[pk.name]))}
                badParent={!!linked && !!v[linked] && parentKeys.length > 0 && !parentKeys.includes(v[linked])}
                pk={pk?.name}
                onCell={(c, val) => setCell(i, c, val)}
                onDelete={() => upd((e) => void e.reference_values!.splice(i, 1))}
              />
            ))}
          </div>
          {linked && (
            <datalist id={`parent-${entity.name}`}>
              {parentKeys.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          )}
          {rows.length > limit && (
            <button className="btn sm ghost" onClick={() => setLimit(limit + PAGE)}>
              Show more ({rows.length - limit} hidden)
            </button>
          )}
          <div className="row-end">
            <button
              className="btn xs danger ghost"
              onClick={() => {
                if (window.confirm(`Remove all ${values.length} values?`))
                  upd((e) => {
                    e.reference_values = [];
                  });
              }}
            >
              <Trash2 size={12} /> Clear all
            </button>
          </div>
        </>
      )}
      {paste && <PasteValues entity={entity} onClose={() => setPaste(false)} onImport={(t, mode) => (importText(t, mode), setPaste(false))} />}
    </div>
  );
}

function ValueRow({
  cols,
  v,
  pk,
  linked,
  listId,
  badKey,
  badParent,
  onCell,
  onDelete,
}: {
  cols: string[];
  v: Record<string, string>;
  pk?: string;
  linked?: string;
  listId?: string;
  badKey: boolean;
  badParent: boolean;
  onCell: (c: string, val: string) => void;
  onDelete: () => void;
}) {
  return (
    <>
      {cols.map((c) => (
        <input
          key={c}
          className={`vg-cell mono${c === pk ? ' pk' : ''}${(c === pk && badKey) || (c === linked && badParent) ? ' invalid' : ''}`}
          value={v[c] ?? ''}
          list={c === linked ? listId : undefined}
          title={c === linked && badParent ? 'Not found in the parent list (matching is exact and case-sensitive)' : c === pk && badKey ? 'Key is blank or duplicated' : undefined}
          onChange={(e) => onCell(c, e.target.value)}
        />
      ))}
      <button className="icon-btn xs" onClick={onDelete} aria-label="Delete value">
        <Trash2 size={12} />
      </button>
    </>
  );
}

function PasteValues({ entity, onClose, onImport }: { entity: Entity; onClose: () => void; onImport: (text: string, mode: 'append' | 'replace') => void }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'append' | 'replace'>(entity.reference_values?.length ? 'append' : 'replace');
  const parsed = useMemo(() => rowsToValues(entity, parseDelimited(text)), [entity, text]);
  const cols = valueColumns(entity);
  return (
    <Modal
      title={`Paste values into ${entity.display_name}`}
      onClose={onClose}
      width={700}
      footer={
        <>
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'append', label: 'Append' },
              { value: 'replace', label: 'Replace all' },
            ]}
          />
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!parsed.values.length} title={parsed.values.length ? undefined : 'Paste or type some values first.'} onClick={() => onImport(text, mode)}>
            {mode === 'replace' ? 'Load' : 'Add'} {parsed.values.length} value(s)
          </button>
        </>
      }
    >
      <p className="muted small">
        Copy rows from Excel/Sheets (tab-separated) or CSV. Include a header row with attribute names to map columns by name; otherwise columns are taken in this order: <span className="mono">{cols.join(', ')}</span>.
      </p>
      <TextArea mono rows={10} value={text} onChange={setText} placeholder={`${cols.join('\t')}\n${cols.map((c) => (c.endsWith('_cd') || c.endsWith('_code') ? 'CODE' : 'Name')).join('\t')}`} />
      {parsed.values.length > 0 && (
        <div className="bulk-preview">
          <div className="muted small" style={{ gridTemplateColumns: '1fr' }}>
            {parsed.header ? 'Header row detected — columns mapped by name.' : 'No header row — columns mapped by position.'}
            {parsed.unknown.length > 0 && ` Ignored: ${parsed.unknown.join(', ')}.`}
          </div>
          {parsed.values.slice(0, 40).map((v, i) => (
            <div key={i} style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
              {cols.map((c) => (
                <span key={c} className="mono">
                  {v[c] ?? ''}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
