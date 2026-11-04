import { useMemo, useRef, useState } from 'react';
import { FileInput, FileUp } from '../icons';
import { importModelText, issueCounts, mergeModels, validateModel, type DataModel, type ImportFormat } from '../../core';
import { useStore } from '../store';
import { Field, Modal, Segmented, TextArea, TextInput } from './forms';
import { DatabaseImport, ImportModeSwitch } from './DatabaseImport';

type FormatChoice = 'auto' | ImportFormat;

/**
 * Import SQL DDL or DBML. With `model`, the tables are added to it (one undoable step); without, `onCreate`
 * receives a new model.
 */
export function ImportDialog(props: { model?: DataModel; onCreate?: (m: DataModel) => Promise<void>; onClose: () => void }) {
  const [mode, setMode] = useState<'ddl' | 'db'>('ddl');
  const switcher = <ImportModeSwitch value={mode} onChange={setMode} />;
  return mode === 'db' ? <DatabaseImport onCreate={props.onCreate} onClose={props.onClose} switcher={switcher} /> : <DdlImport {...props} switcher={switcher} />;
}

function DdlImport({ model, onCreate, onClose, switcher }: { model?: DataModel; onCreate?: (m: DataModel) => Promise<void>; onClose: () => void; switcher: React.ReactNode }) {
  const toast = useStore((s) => s.toast);
  const [text, setText] = useState('');
  const [format, setFormat] = useState<FormatChoice>('auto');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const result = useMemo(() => {
    if (!text.trim()) return null;
    const r = importModelText(text, { format: format === 'auto' ? undefined : format, title: title.trim() || 'Imported model', keepJunctions: model?.tab?.kind === 'physical' });
    const merged = model ? mergeModels(model, r.model) : null;
    const target = merged?.model || r.model;
    return { ...r, merged, issues: issueCounts(validateModel(target)) };
  }, [text, format, title, model]);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
    if (!title) setTitle(f.name.replace(/\.(sql|dbml|ddl|txt)$/i, '').replace(/[_-]+/g, ' ').trim());
    if (/\.dbml$/i.test(f.name)) setFormat('dbml');
    else if (/\.(sql|ddl)$/i.test(f.name)) setFormat('sql');
  };

  const apply = async () => {
    if (!result) return;
    setBusy(true);
    try {
      if (model && result.merged) {
        useStore.getState().replaceModel(result.merged.model);
        toast(`Imported ${result.merged.added.length} table(s). Undo (⌘Z) to revert.`, 'success');
      } else await onCreate?.(result.model);
      onClose();
    } catch (e: any) {
      toast(e.message || String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const m = result?.model;
  const refs = m?.entities.filter((e) => e.entity_type === 'reference').length || 0;
  const count = model ? result?.merged?.added.length || 0 : m?.entities.length || 0;

  return (
    <Modal
      title={
        <>
          <FileInput size={16} /> Import tables
        </>
      }
      onClose={onClose}
      width={720}
      footer={
        <>
          <span className="muted small">{result ? `Detected ${result.format === 'dbml' ? 'DBML' : 'SQL DDL'}` : 'Paste a schema or open a file.'}</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!count || busy} title={!count ? 'Paste or drop SQL or DBML with at least one table.' : undefined} onClick={apply}>
            {model ? `Add ${count || ''} table${count === 1 ? '' : 's'}` : 'Create model'}
          </button>
        </>
      }
    >
      <div className="stack">
        {switcher}
        <div className="grid2">
          <Field label="Format">
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'sql', label: 'SQL DDL' },
                { value: 'dbml', label: 'DBML' },
              ]}
            />
          </Field>
          {!model && (
            <Field label="Model title">
              <TextInput value={title} onChange={setTitle} placeholder="Imported model" />
            </Field>
          )}
        </div>
        <div
          className={`import-drop${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            readFile(e.dataTransfer.files[0]);
          }}
        >
          <TextArea
            rows={10}
            mono
            value={text}
            onChange={setText}
            placeholder={'CREATE TABLE customer (\n  customer_id BIGINT PRIMARY KEY,\n  name VARCHAR(200) NOT NULL\n);\n\n— or DBML: Table customer { id int [pk] }'}
          />
        </div>
        <div className="row-actions">
          <button className="btn sm" onClick={() => fileInput.current?.click()}>
            <FileUp size={14} /> Open a .sql or .dbml file
          </button>
          <span className="muted small">PostgreSQL, MySQL/MariaDB, Snowflake, Databricks and most ANSI DDL. Or drop a file on the box above.</span>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".sql,.ddl,.dbml,.txt"
          hidden
          onChange={(e) => {
            readFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {result && m && (
          <div className={`callout small ${count ? (result.issues.error ? 'warning' : 'success') : 'error'}`}>
            <div>
              <b>
                {m.entities.length} table{m.entities.length === 1 ? '' : 's'}
              </b>{' '}
              ({refs} reference list{refs === 1 ? '' : 's'}), {m.relationships.length} relationship{m.relationships.length === 1 ? '' : 's'}
              {m.entities.some((e) => e.dependent_reference) && ', with dependent references'}
            </div>
            {result.merged?.skipped.length ? <div>Already in this model, skipped: {result.merged.skipped.join(', ')}</div> : null}
            {result.warnings.length > 0 && (
              <ul className="claude-changes">
                {result.warnings.slice(0, 6).map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {result.warnings.length > 6 && <li>…and {result.warnings.length - 6} more</li>}
              </ul>
            )}
            <div>
              Validation after import: {result.issues.error} error(s), {result.issues.warning} warning(s).
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
