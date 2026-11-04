import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Trash2, Wand2 } from '../icons';
import { applyBatches, listTabs, newTerm, suggestLinks, tabView, type DataModel, type GlossaryTerm } from '../../core';
import { useStore } from '../store';
import { useGlossary } from '../glossary';
import { storage } from '../storage';
import { CommitInput, Empty, Field, Select } from './forms';

/** The shared business glossary: terms every model can link to, and where this model uses them. */
export function GlossaryView() {
  const terms = useGlossary((s) => s.terms);
  const doc = useStore((s) => s.doc)!;
  const activeTab = useStore((s) => s.activeTab);
  const model = useStore((s) => s.model)!;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const { upsert, remove } = useGlossary.getState();
  const shown = terms.filter((t) => !q || `${t.name} ${t.definition} ${(t.synonyms || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const term = terms.find((t) => t.id === sel) || shown[0];
  const usage = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const t of listTabs(doc))
      for (const e of tabView(doc, t.id).entities) {
        const add = (id: string | undefined, where: string) => id && out.set(id, [...(out.get(id) || []), `${t.name}: ${where}`]);
        add(e.term, e.name);
        for (const a of e.attributes) add(a.term, `${e.name}.${a.name}`);
      }
    return out;
  }, [doc]);
  const suggestions = useMemo(() => suggestLinks(model, terms), [model, terms]);

  const linkSuggestions = () => {
    let res = { applied: 0, skipped: 0 };
    useStore.getState().updateDoc((d) => void (res = applyBatches(d as DataModel, suggestions.map((x) => [{ op: 'link_term', entity: x.entity, attribute: x.attribute, term: x.term }]), activeTab)));
    useStore.getState().toast(`Linked ${res.applied} name${res.applied === 1 ? '' : 's'} to glossary terms. ⌘Z undoes it.`, 'success');
  };
  const patch = (p: Partial<GlossaryTerm>) => term && upsert({ ...term, ...p });

  return (
    <div className="glossary-view">
      <div className="map-head">
        <h2>Business glossary</h2>
        <p className="muted small">
          Shared by every model {storage.kind === 'files' ? 'in this workbench (models/_glossary.json)' : 'in this browser'}. Link entities and attributes to terms in the inspector; docs, dbt and Databricks tags use them.
        </p>
        <div className="map-pick">
          <input className="input" placeholder="Search terms…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button
            className="btn sm"
            onClick={async () => {
              const t = newTerm(q.trim() || 'New term');
              await upsert(t);
              setSel(t.id);
              setQ('');
            }}
          >
            <Plus size={14} /> New term
          </button>
          <span className="spacer" />
          {suggestions.length > 0 && (
            <button className="btn sm primary" title={suggestions.slice(0, 12).map((x) => `${x.entity}${x.attribute ? `.${x.attribute}` : ''} → ${x.term.name}`).join('\n')} onClick={linkSuggestions}>
              <Wand2 size={14} /> Link {suggestions.length} matching name{suggestions.length === 1 ? '' : 's'} in this tab
            </button>
          )}
        </div>
      </div>
      {!terms.length ? (
        <Empty icon={<BookOpen size={22} />} title="No terms yet">
          Add terms like “Customer” or “Net Revenue” with a definition the business agrees on. Ask Claude to draft them from this model, or link names one at a time from the inspector.
        </Empty>
      ) : (
        <div className="map-body">
          <div className="map-entities">
            {shown.map((t) => (
              <button key={t.id} className={`side-item${term?.id === t.id ? ' active' : ''}`} onClick={() => setSel(t.id)}>
                <span className="side-label">{t.name}</span>
                <span className="side-meta">{usage.get(t.id)?.length || ''}</span>
              </button>
            ))}
          </div>
          {term && (
            <div className="map-grid-wrap stack term-edit">
              <div className="grid2">
                <Field label="Term">
                  <CommitInput value={term.name} onCommit={(v) => patch({ name: v })} validate={(v) => (v.trim() ? null : 'Required')} />
                </Field>
                <Field label="Status">
                  <Select value={term.status || 'draft'} onChange={(v) => patch({ status: v as GlossaryTerm['status'] })} options={['draft', 'approved', 'deprecated']} />
                </Field>
              </div>
              <Field label="Definition">
                <BlurTextArea key={term.id} value={term.definition} onCommit={(v) => patch({ definition: v })} />
              </Field>
              <div className="grid2">
                <Field label="Synonyms" hint="Comma-separated; used to suggest links (e.g. Client, Account holder).">
                  <CommitInput value={(term.synonyms || []).join(', ')} onCommit={(v) => patch({ synonyms: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
                </Field>
                <Field label="Domain / owner">
                  <CommitInput value={[term.domain, term.owner].filter(Boolean).join(' / ')} onCommit={(v) => {
                    const [domain, owner] = v.split('/').map((x) => x.trim());
                    patch({ domain: domain || undefined, owner: owner || undefined });
                  }} />
                </Field>
              </div>
              <div className="section-title">
                <span>Used in this model</span>
              </div>
              <div className="multi-list">
                {(usage.get(term.id) || []).map((u) => (
                  <span key={u} className="chip mono">
                    {u}
                  </span>
                ))}
                {!usage.get(term.id) && <span className="muted small">Not linked here yet.</span>}
              </div>
              <div className="row-end">
                <button
                  className="btn sm danger ghost"
                  onClick={() => {
                    if (window.confirm(`Delete “${term.name}” from the shared glossary? Models keep their own copy until relinked.`)) remove(term.id);
                  }}
                >
                  <Trash2 size={14} /> Delete term
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Saves when focus leaves (the glossary file is shared, so not on every keystroke). */
function BlurTextArea({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      className="input textarea"
      rows={3}
      value={v}
      placeholder="What the business means by this, in one or two sentences."
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
    />
  );
}
