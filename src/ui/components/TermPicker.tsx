import { BookOpen, Plus } from '../icons';
import { applyOpsInPlace, matchTerm, newTerm, termOf, type DataModel } from '../../core';
import { useStore } from '../store';
import { useGlossary } from '../glossary';

/** Link an entity or attribute to a shared glossary term (with a one-click suggestion when the name matches). */
export function TermPicker({ entity, attribute, current, name, label }: { entity: string; attribute?: string; current?: string; name: string; label?: string }) {
  const terms = useGlossary((s) => s.terms);
  const model = useStore((s) => s.model)!;
  const link = (id: string | null) => {
    const term = id ? terms.find((t) => t.id === id) || termOf(model, id) || null : null;
    try {
      useStore.getState().updateDoc((d) => void applyOpsInPlace(d as DataModel, [{ op: 'link_term', entity, attribute, term }], { tab: useStore.getState().activeTab }));
    } catch (e: any) {
      useStore.getState().toast(e.message, 'error');
    }
  };
  const linked = current ? terms.find((t) => t.id === current) || termOf(model, current) : undefined;
  const suggestion = !current ? matchTerm(terms, name) || (label ? matchTerm(terms, label) : undefined) : undefined;
  return (
    <div className="term-picker">
      <select className="input select" value={current || ''} onChange={(e) => link(e.target.value || null)}>
        <option value="">— no business term —</option>
        {terms.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.status === 'deprecated' ? ' (deprecated)' : ''}
          </option>
        ))}
        {linked && !terms.some((t) => t.id === linked.id) && <option value={linked.id}>{linked.name}</option>}
      </select>
      {suggestion && (
        <button className="btn xs" title={suggestion.definition} onClick={() => link(suggestion.id)}>
          <BookOpen size={12} /> Use “{suggestion.name}”
        </button>
      )}
      {!current && !suggestion && (
        <button
          className="btn xs ghost"
          title="Add a glossary term with this name and link it"
          onClick={async () => {
            const t = newTerm(label || name);
            await useGlossary.getState().upsert(t);
            link(t.id);
          }}
        >
          <Plus size={12} /> New term
        </button>
      )}
      {linked?.definition && <div className="muted small term-def">{linked.definition}</div>}
    </div>
  );
}
