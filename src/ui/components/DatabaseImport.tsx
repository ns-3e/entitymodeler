import { useMemo, useRef, useState } from 'react';
import { Copy, Database, FileUp, Terminal } from '../icons';
import {
  CATALOG_PLATFORMS,
  applyOpsInPlace,
  catalogQuery,
  createModel,
  applyOps,
  fromCatalogRows,
  issueCounts,
  parseResultSets,
  planPull,
  tabView,
  toInternalName,
  validateModel,
  resolveTab,
  type CatalogPlatform,
  type DataModel,
} from '../../core';
import { useStore } from '../store';
import { storage } from '../storage';
import { Field, Modal, Segmented, Select, TextArea, TextInput } from './forms';

/**
 * Import a live schema without giving the app any credentials: copy the metadata query, run it in your own SQL
 * tool, paste the result. Inside a model it becomes a Physical tab, or a version tab of an earlier pull.
 */
export function DatabaseImport({ onCreate, onClose, switcher }: { onCreate?: (m: DataModel) => Promise<void>; onClose: () => void; switcher: React.ReactNode }) {
  const doc = useStore((s) => s.doc);
  const modelId = useStore((s) => s.modelId);
  const toast = useStore((s) => s.toast);
  const inModel = !onCreate && !!doc;
  const [platform, setPlatform] = useState<CatalogPlatform>('databricks');
  const [catalog, setCatalog] = useState('');
  const [schema, setSchema] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const meta = CATALOG_PLATFORMS.find((p) => p.id === platform)!;
  const needsCatalog = platform === 'databricks' || platform === 'snowflake';
  const query = catalogQuery(platform, { catalog: needsCatalog ? catalog || undefined : undefined, schema: platform === 'mysql' ? catalog || schema : schema || undefined });

  const result = useMemo(() => {
    if (!text.trim()) return null;
    const snap = fromCatalogRows(parseResultSets(text), platform, { catalog: catalog || undefined, schema: schema || undefined });
    const base = inModel ? doc! : createModel(toInternalName(schema || catalog || 'database') || 'database', [catalog, schema].filter(Boolean).join('.') || 'Database schema');
    const plan = planPull(base, snap);
    const r = applyOps(base, plan.ops);
    const tab = r.ok ? resolveTab(r.doc, plan.tabName) : undefined;
    return { snap, plan, doc: r.ok ? r.doc : null, error: r.ok ? undefined : r.error, issues: r.ok && tab ? issueCounts(validateModel(tabView(r.doc, tab))) : null };
  }, [text, platform, catalog, schema, inModel, doc]);

  const apply = async () => {
    if (!result?.doc) return;
    setBusy(true);
    try {
      if (inModel) {
        useStore.getState().updateDoc((d) => void applyOpsInPlace(d, result.plan.ops));
        const id = resolveTab(useStore.getState().doc!, result.plan.tabName);
        if (id) useStore.getState().setActiveTab(id);
        toast(`Imported ${result.plan.tables} tables into “${result.plan.tabName}”.${result.plan.previous ? ' Compare it with the previous pull to see what changed.' : ''}`, 'success');
      } else await onCreate?.(result.doc);
      onClose();
    } catch (e: any) {
      toast(e.message || String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const cli = `node bin/em.mjs pull ${modelId || '<model>'} --from ${platform === 'mysql' ? 'postgres' : platform}${needsCatalog ? ` --catalog ${catalog || '<catalog>'}` : ''} --schema ${schema || (platform === 'postgres' ? 'public' : '<schema>')}`;
  const copy = (s: string, what: string) => navigator.clipboard.writeText(s).then(() => toast(`Copied the ${what}.`, 'success'));

  return (
    <Modal
      title={
        <>
          <Database size={16} /> Import from a database
        </>
      }
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className="muted small">{result ? `${result.snap.tables.length} tables read` : 'Run the query, then paste its result.'}</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!result?.doc || !result.plan.tables || busy} title={!result?.doc || !result.plan.tables ? 'Load catalog results with at least one table first.' : undefined} onClick={apply}>
            {inModel ? (result?.plan.previous ? 'Add as new version' : 'Add as Physical tab') : 'Create model'}
          </button>
        </>
      }
    >
      <div className="stack">
        {switcher}
        <div className="field-row">
          <Field label="Platform">
            <Select<CatalogPlatform> value={platform} onChange={setPlatform} options={CATALOG_PLATFORMS.map((p) => ({ value: p.id, label: p.label }))} />
          </Field>
          {(needsCatalog || platform === 'mysql') && (
            <Field label={platform === 'databricks' ? 'Catalog' : 'Database'}>
              <TextInput value={catalog} onChange={setCatalog} placeholder={platform === 'databricks' ? 'main' : 'ANALYTICS'} mono />
            </Field>
          )}
          {platform !== 'mysql' && (
            <Field label="Schema">
              <TextInput value={schema} onChange={setSchema} placeholder={platform === 'postgres' ? 'public' : 'sales'} mono />
            </Field>
          )}
        </div>
        <Field label={`1. Run this in ${meta.label.replace(/ \(.*/, '')} (it only reads metadata)`}>
          <div className="code-preview">
            <textarea className="input textarea mono" rows={7} readOnly value={query} />
            <button className="btn sm" onClick={() => copy(query, 'query')}>
              <Copy size={14} /> Copy
            </button>
          </div>
        </Field>
        <Field label={`2. Paste the result as CSV or TSV${platform === 'snowflake' ? ' (add the two SHOW results below it, separated by a blank line)' : ''}`}>
          <TextArea rows={6} mono value={text} onChange={setText} placeholder={'table_schema,table_name,table_comment,column_name,…'} />
        </Field>
        <div className="row-actions">
          <button className="btn sm" onClick={() => fileInput.current?.click()}>
            <FileUp size={14} /> Open result files
          </button>
          {storage.kind === 'files' && platform !== 'mysql' && (
            <button className="btn sm ghost" title="Pull directly with your local credentials, no copy-paste" onClick={() => copy(cli, 'command')}>
              <Terminal size={14} /> Copy CLI command
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".csv,.tsv,.txt"
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files || [])];
            setText((await Promise.all(files.map((f) => f.text()))).join('\n\n'));
            e.target.value = '';
          }}
        />
        {result && (
          <div className={`callout small ${result.error || !result.plan.tables ? 'error' : result.issues?.error ? 'warning' : 'success'}`}>
            {result.error ? (
              <div>{result.error}</div>
            ) : (
              <>
                <div>
                  <b>{result.plan.tables} tables</b> → {inModel ? <>tab “{result.plan.tabName}”</> : 'a new model'}
                  {result.plan.previous && <> (a new version of an earlier pull: Compare shows the drift)</>}
                </div>
                {result.plan.warnings.length > 0 && (
                  <ul className="claude-changes">
                    {result.plan.warnings.slice(0, 5).map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                {result.issues && (
                  <div>
                    Validation: {result.issues.error} error(s), {result.issues.warning} warning(s).
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** The two import modes, shown at the top of both dialogs. */
export function ImportModeSwitch({ value, onChange }: { value: 'ddl' | 'db'; onChange: (v: 'ddl' | 'db') => void }) {
  return (
    <Segmented<'ddl' | 'db'>
      value={value}
      onChange={onChange}
      options={[
        { value: 'ddl', label: 'SQL DDL or DBML' },
        { value: 'db', label: <><Database size={14} /> From a database</> },
      ]}
    />
  );
}
