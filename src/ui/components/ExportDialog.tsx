import { useMemo, useState } from 'react';
import { Braces, Check, ClipboardCopy, FileCode2, FileText, Image, Loader2 } from '../icons';
import { DOC_SECTIONS, SQL_DIALECTS, buildDocTables, serializeModel, toAvro, toDbml, toDbt, toJsonSchema, toMermaid, toOdcs, toSql, type DocSectionId, type SqlDialect } from '../../core';
import { buildModelPdf } from '../../core/pdf';
import { useStore } from '../store';
import { downloadBlob } from '../download';
import { storage } from '../storage';
import { dataUrlToBytes, renderDiagramPng, renderDiagramSvg, type ImageOptions } from '../exportImage';
import { loadPdfAssets } from '../pdfAssets';
import { Field, Modal, Segmented, Select, Toggle } from './forms';

type Kind = 'image' | 'pdf' | 'code' | 'model';
type CodeFormat = 'sql' | 'dbml' | 'mermaid' | 'dbt' | 'odcs' | 'jsonschema' | 'avro';
const CODE_FILE: Record<CodeFormat, { ext: string; type: string; label: string; hint: string }> = {
  sql: { ext: 'sql', type: 'application/sql', label: 'SQL DDL', hint: 'Tables, keys and comments for the chosen database. Relationships without a foreign-key column get one added; N:N relationships become junction tables. Databricks also tags PII columns.' },
  dbml: { ext: 'dbml', type: 'text/plain', label: 'DBML (dbdiagram.io)', hint: 'For dbdiagram.io and other DBML tools. Reference entities are grouped as “Reference data”; their values are not part of DBML.' },
  mermaid: { ext: 'mmd', type: 'text/plain', label: 'Mermaid erDiagram', hint: 'An erDiagram for GitHub, GitLab, Notion or mermaid.live — paste it into a ```mermaid block.' },
  dbt: { ext: 'schema.yml', type: 'text/yaml', label: 'dbt schema.yml', hint: 'dbt models with descriptions, data types and data tests: not_null, unique keys, relationships for foreign keys, accepted_values from reference lists. PII columns carry meta.pii.' },
  odcs: { ext: 'odcs.yaml', type: 'text/yaml', label: 'Data contract (ODCS v3)', hint: 'An Open Data Contract Standard v3 contract: schema, properties, keys, PII classification, valid values from reference lists and foreign keys.' },
  jsonschema: { ext: 'schema.json', type: 'application/schema+json', label: 'JSON Schema', hint: 'JSON Schema 2020-12 with one definition per table under $defs; required keys, enums from reference lists, x-references for foreign keys.' },
  avro: { ext: 'avsc', type: 'application/json', label: 'Avro schemas', hint: 'Avro record schemas (one per table) with logical date/timestamp types; optional columns are nullable unions.' },
};
const TYPED: CodeFormat[] = ['sql', 'dbt', 'odcs'];

export function ExportDialog({ initial = 'image', onClose }: { initial?: Kind; onClose: () => void }) {
  const model = useStore((s) => s.model)!;
  const doc = useStore((s) => s.doc)!;
  const modelId = useStore((s) => s.modelId)!;
  const toast = useStore((s) => s.toast);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const [kind, setKind] = useState<Kind>(initial);
  const [busy, setBusy] = useState(false);
  const [saveCopy, setSaveCopy] = useState(true);
  const [img, setImg] = useState<ImageOptions & { format: 'png' | 'svg' }>({ format: 'png', scale: 2, background: 'white', titleBlock: true, legend: true, theme: 'light' });
  const [pdf, setPdf] = useState({ diagram: true, tables: true, pageSize: 'letter' as 'letter' | 'a4' });
  const [pdfSections, setPdfSections] = useState<Set<DocSectionId>>(new Set(DOC_SECTIONS.map((s) => s.id)));
  const [pdfEntities, setPdfEntities] = useState<Set<string> | null>(null);
  const [code, setCode] = useState<{ format: CodeFormat; dialect: SqlDialect; values: boolean }>({ format: 'sql', dialect: (model.tab?.dialect as SqlDialect) || 'postgres', values: true });
  const [copied, setCopied] = useState(false);
  const codeText = useMemo(
    () => {
      if (kind !== 'code') return '';
      switch (code.format) {
        case 'sql':
          return toSql(model, { dialect: code.dialect, includeValues: code.values });
        case 'dbml':
          return toDbml(model);
        case 'mermaid':
          return toMermaid(model);
        case 'dbt':
          return toDbt(model, { dialect: code.dialect });
        case 'odcs':
          return toOdcs(model, { dialect: code.dialect });
        case 'jsonschema':
          return toJsonSchema(model);
        case 'avro':
          return toAvro(model);
      }
    },
    [kind, code, model],
  );
  const codeFile = `${model.name}${code.format === 'sql' ? `.${code.dialect}` : ''}.${CODE_FILE[code.format].ext}`;
  const toggleIn = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  };
  const pdfTables = () => (pdf.tables ? buildDocTables(model, { sections: [...pdfSections], entities: pdfEntities ? [...pdfEntities] : undefined }) : []);
  const date = new Date().toISOString().slice(0, 10);

  const deliver = async (bytes: Uint8Array | Blob, filename: string, type: string) => {
    downloadBlob(bytes, filename, type);
    if (saveCopy && storage.saveExport) {
      try {
        const path = await storage.saveExport(modelId, filename, bytes);
        toast(`Saved to ${path.split('/models/')[1] ? 'models/' + path.split('/models/')[1] : path}`, 'success');
      } catch (e: any) {
        toast(`Downloaded, but saving a copy failed: ${e.message}`, 'error');
      }
    } else toast(`Downloaded ${filename}`, 'success');
  };

  const run = async () => {
    setBusy(true);
    try {
      if (kind === 'image' || (kind === 'pdf' && pdf.diagram)) {
        if (view !== 'diagram') {
          setView('diagram');
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (kind === 'image') {
        if (img.format === 'png') {
          const url = await renderDiagramPng(model, img);
          await deliver(dataUrlToBytes(url), `${model.name}-diagram-${date}.png`, 'image/png');
        } else {
          const url = await renderDiagramSvg(img);
          const svg = decodeURIComponent(url.split(',')[1]);
          await deliver(new Blob([svg], { type: 'image/svg+xml' }), `${model.name}-diagram-${date}.svg`, 'image/svg+xml');
        }
      } else if (kind === 'pdf') {
        // The PDF cover carries the title, so the diagram goes in without its own title block
        const diagramPng = pdf.diagram ? dataUrlToBytes(await renderDiagramPng(model, { scale: 2, background: 'white', titleBlock: false, legend: true, theme: 'light' })) : undefined;
        const bytes = buildModelPdf(model, pdfTables(), { pageSize: pdf.pageSize, diagramPng, assets: await loadPdfAssets() });
        await deliver(bytes, `${model.name}-data-model-${date}.pdf`, 'application/pdf');
      } else if (kind === 'code') {
        await deliver(new Blob([codeText], { type: CODE_FILE[code.format].type }), codeFile, CODE_FILE[code.format].type);
      } else {
        await deliver(new Blob([serializeModel(doc)], { type: 'application/json' }), `${model.name}.json`, 'application/json');
      }
      onClose();
    } catch (e: any) {
      toast(`Export failed: ${e.message || e}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Export"
      onClose={onClose}
      width={720}
      footer={
        <>
          {storage.saveExport && <Toggle checked={saveCopy} onChange={setSaveCopy} label="Also save to models/…/exports/" />}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || (kind === 'pdf' && !pdf.diagram && !pdf.tables)} title={kind === 'pdf' && !pdf.diagram && !pdf.tables ? 'Include the diagram or the tables.' : undefined} onClick={run}>
            {busy && <Loader2 size={14} className="spin" />} Export
          </button>
        </>
      }
    >
      <div className="export-kinds">
        <button className={kind === 'image' ? 'active' : ''} onClick={() => setKind('image')}>
          <Image size={20} />
          <b>Diagram image</b>
          <span>PNG or SVG for design docs</span>
        </button>
        <button className={kind === 'pdf' ? 'active' : ''} onClick={() => setKind('pdf')}>
          <FileText size={20} />
          <b>PDF document</b>
          <span>Diagram + design-doc tables</span>
        </button>
        <button className={kind === 'code' ? 'active' : ''} onClick={() => setKind('code')}>
          <Braces size={20} />
          <b>Code</b>
          <span>SQL, dbt, contracts, schemas</span>
        </button>
        <button className={kind === 'model' ? 'active' : ''} onClick={() => setKind('model')}>
          <FileCode2 size={20} />
          <b>Model file</b>
          <span>.json to share or reopen</span>
        </button>
      </div>

      {kind === 'image' && (
        <div className="stack">
          <div className="grid2">
            <Field label="Format">
              <Segmented
                value={img.format}
                onChange={(v) => setImg({ ...img, format: v })}
                options={[
                  { value: 'png', label: 'PNG' },
                  { value: 'svg', label: 'SVG' },
                ]}
              />
            </Field>
            <Field label="Resolution">
              <Segmented
                value={String(img.scale) as '1' | '2' | '3'}
                onChange={(v) => setImg({ ...img, scale: Number(v) })}
                options={[
                  { value: '1', label: '1×' },
                  { value: '2', label: '2×' },
                  { value: '3', label: '3× print' },
                ]}
              />
            </Field>
          </div>
          <div className="grid2">
            <Field label="Theme">
              <Segmented
                value={img.theme}
                onChange={(v) => setImg({ ...img, theme: v })}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'current', label: 'Current' },
                ]}
              />
            </Field>
            <Field label="Background">
              <Segmented
                value={img.background}
                onChange={(v) => setImg({ ...img, background: v })}
                options={[
                  { value: 'white', label: 'White' },
                  { value: 'theme', label: 'Canvas' },
                  { value: 'transparent', label: 'None' },
                ]}
              />
            </Field>
          </div>
          {img.format === 'png' && (
            <div className="toggles-row">
              <Toggle checked={img.titleBlock} onChange={(v) => setImg({ ...img, titleBlock: v })} label="Title block" />
              <Toggle checked={img.legend} onChange={(v) => setImg({ ...img, legend: v })} label="Legend" />
            </div>
          )}
          <p className="muted small">Exports every entity at full detail of the current view settings (detail level, edge layers). Tip: switch detail to “Keys” for an executive-level diagram.</p>
        </div>
      )}

      {kind === 'pdf' && (
        <div className="stack">
          <div className="grid2">
            <div className="field">
              <span className="field-label">Contents</span>
              <div className="toggles-row">
                <Toggle checked={pdf.diagram} onChange={(v) => setPdf({ ...pdf, diagram: v })} label="Diagram" />
                <Toggle checked={pdf.tables} onChange={(v) => setPdf({ ...pdf, tables: v })} label="Documentation tables" />
              </div>
            </div>
            <Field label="Page size">
              <Segmented
                value={pdf.pageSize}
                onChange={(v) => setPdf({ ...pdf, pageSize: v })}
                options={[
                  { value: 'letter', label: 'Letter' },
                  { value: 'a4', label: 'A4' },
                ]}
              />
            </Field>
          </div>
          {pdf.tables && (
            <div className="grid2 pdf-pickers">
              <div className="field">
                <span className="field-label">Sections</span>
                <div className="pdf-picker">
                  {DOC_SECTIONS.map((s) => (
                    <label key={s.id} className="check-row" title={s.description}>
                      <input type="checkbox" checked={pdfSections.has(s.id)} onChange={() => setPdfSections(toggleIn(pdfSections, s.id))} />
                      {s.title}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label">
                  Entities{' '}
                  <button className="link small" onClick={() => setPdfEntities(pdfEntities ? null : new Set())}>
                    {pdfEntities ? 'select all' : 'clear'}
                  </button>
                </span>
                <div className="pdf-picker">
                  {model.entities.map((e) => (
                    <label key={e.name} className="check-row">
                      <input
                        type="checkbox"
                        checked={!pdfEntities || pdfEntities.has(e.name)}
                        onChange={() => {
                          const n = toggleIn(pdfEntities || new Set(model.entities.map((x) => x.name)), e.name);
                          setPdfEntities(n.size === model.entities.length ? null : n);
                        }}
                      />
                      <i className="dot" style={{ background: e.color_code }} />
                      {e.display_name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <p className="muted small">
            A cover page with model summary and linked contents, the diagram on a landscape page, then one chapter per section with headers repeated across pages. Uses the diagram's current detail level and edge layers.
          </p>
        </div>
      )}

      {kind === 'code' && (
        <div className="stack">
          <div className="grid2">
            <Field label="Format">
              <Select<CodeFormat> value={code.format} onChange={(v) => setCode({ ...code, format: v })} options={(Object.keys(CODE_FILE) as CodeFormat[]).map((f) => ({ value: f, label: CODE_FILE[f].label }))} />
            </Field>
            {TYPED.includes(code.format) && (
              <Field label={code.format === 'sql' ? 'Database' : 'Column types for'}>
                <Select value={code.dialect} onChange={(v) => setCode({ ...code, dialect: v as SqlDialect })} options={SQL_DIALECTS.map((d) => ({ value: d.id, label: d.label }))} />
              </Field>
            )}
          </div>
          {code.format === 'sql' && <Toggle checked={code.values} onChange={(v) => setCode({ ...code, values: v })} label="Include reference values (INSERT statements)" />}
          <div className="code-preview">
            <button
              className="btn sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(codeText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  toast('Could not copy — your browser blocked clipboard access.', 'error');
                }
              }}
            >
              {copied ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied ? 'Copied' : 'Copy'}
            </button>
            <textarea className="input textarea mono" readOnly rows={12} value={codeText} />
          </div>
          <p className="muted small">
            {CODE_FILE[code.format].hint}{' '}
            Export downloads <span className="mono">{codeFile}</span>.
          </p>
        </div>
      )}

      {kind === 'model' && <p className="muted">Download the design model as <span className="mono">{model.name}.json</span>. Open it in EntityModel.com with “Open model file”, or hand it to Claude.</p>}
    </Modal>
  );
}
