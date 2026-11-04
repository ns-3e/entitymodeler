import { useMemo, useState } from 'react';
import { Check, Copy, Download, FileSpreadsheet, FileText } from '../icons';
import { DOC_SECTIONS, buildDocTables, tableToHTML, tableToMarkdown, tableToTSV, tablesToHTMLDocument, tablesToMarkdown, type DocSectionId, type DocTable } from '../../core';
import { useStore } from '../store';
import { copyRich, downloadBlob } from '../download';

export function TablesView() {
  const model = useStore((s) => s.model)!;
  const toast = useStore((s) => s.toast);
  const [sections, setSections] = useState<Set<DocSectionId>>(new Set(DOC_SECTIONS.map((s) => s.id)));
  const [entities, setEntities] = useState<Set<string> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const tables = useMemo(() => buildDocTables(model, { sections: [...sections], entities: entities ? [...entities] : undefined }), [model, sections, entities]);
  const allHtml = () => tables.map((t) => tableToHTML(t)).join('<p></p>');
  const flash = (id: string) => {
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  };

  const copyTable = async (t: DocTable, mode: 'rich' | 'md' | 'tsv') => {
    try {
      if (mode === 'rich') await copyRich(tableToHTML(t), tableToTSV(t));
      else await navigator.clipboard.writeText(mode === 'md' ? tableToMarkdown(t) : tableToTSV(t));
      flash(`${t.id}:${mode}`);
      toast(mode === 'rich' ? 'Copied — paste into Google Docs, Word or Confluence' : mode === 'md' ? 'Copied Markdown' : 'Copied for Excel / Sheets', 'success');
    } catch (e: any) {
      toast(`Copy failed: ${e.message}`, 'error');
    }
  };

  const toggleSection = (id: DocSectionId) => {
    const n = new Set(sections);
    n.has(id) ? n.delete(id) : n.add(id);
    setSections(n);
  };
  const toggleEntity = (name: string) => {
    const n = new Set(entities || model.entities.map((e) => e.name));
    n.has(name) ? n.delete(name) : n.add(name);
    setEntities(n.size === model.entities.length ? null : n);
  };

  let lastSection = '';
  return (
    <div className="tables-view">
      <aside className="tables-side">
        <div className="side-block">
          <div className="side-title">Sections</div>
          {DOC_SECTIONS.map((s) => (
            <label key={s.id} className="check-row" title={s.description}>
              <input type="checkbox" checked={sections.has(s.id)} onChange={() => toggleSection(s.id)} />
              {s.title}
            </label>
          ))}
        </div>
        <div className="side-block">
          <div className="side-title">
            Entities
            <button className="link small" onClick={() => setEntities(entities ? null : new Set())}>
              {entities ? 'all' : 'none'}
            </button>
          </div>
          {model.entities.map((e) => (
            <label key={e.name} className="check-row">
              <input type="checkbox" checked={!entities || entities.has(e.name)} onChange={() => toggleEntity(e.name)} />
              <i className="dot" style={{ background: e.color_code }} />
              {e.display_name}
            </label>
          ))}
        </div>
      </aside>
      <div className="tables-main">
        <div className="tables-toolbar">
          <div>
            <h2>Data model tables</h2>
            <span className="muted small">{tables.length} tables · formatted for design documents</span>
          </div>
          <span className="spacer" />
          <button
            className="btn primary"
            onClick={async () => {
              await copyRich(allHtml(), tables.map((t) => `${t.title}\n${tableToTSV(t)}`).join('\n\n'));
              flash('all');
              toast('Copied all tables — paste into your design doc', 'success');
            }}
          >
            {copied === 'all' ? <Check size={14} /> : <Copy size={14} />} Copy all
          </button>
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(tablesToMarkdown(model, tables));
              toast('Copied all tables as Markdown', 'success');
            }}
          >
            <FileText size={14} /> Copy Markdown
          </button>
          <button className="btn" onClick={() => downloadBlob(tablesToHTMLDocument(model, tables), `${model.name}-data-model.html`, 'text/html')}>
            <Download size={14} /> HTML
          </button>
          <button className="btn" onClick={() => downloadBlob(tablesToMarkdown(model, tables), `${model.name}-data-model.md`, 'text/markdown')}>
            <Download size={14} /> .md
          </button>
        </div>
        <div className="doc-page">
          {tables.map((t) => {
            const sec = t.section !== lastSection ? DOC_SECTIONS.find((s) => s.id === t.section) : null;
            lastSection = t.section;
            return (
              <div key={t.id}>
                {sec && <h3 className="doc-section">{sec.title}</h3>}
                <div className="doc-table">
                  <div className="doc-table-actions">
                    <button className="btn xs" onClick={() => copyTable(t, 'rich')} title="Rich table for Google Docs / Word / Confluence">
                      {copied === `${t.id}:rich` ? <Check size={12} /> : <Copy size={12} />} Copy
                    </button>
                    <button className="btn xs ghost" onClick={() => copyTable(t, 'md')} title="Markdown">
                      MD
                    </button>
                    <button className="btn xs ghost" onClick={() => copyTable(t, 'tsv')} title="Tab-separated for Excel / Sheets">
                      <FileSpreadsheet size={12} />
                    </button>
                  </div>
                  <div dangerouslySetInnerHTML={{ __html: tableToHTML(t) }} />
                </div>
              </div>
            );
          })}
          {!tables.length && <div className="muted pad">Nothing selected.</div>}
        </div>
      </div>
    </div>
  );
}
