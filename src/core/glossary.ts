// Business glossary: terms live in one shared glossary across models; each model embeds the terms it links to
// (glossary_snapshot) so its file stands alone. Suggestions match names and synonyms after the same
// normalization as derivation (CustNm, cust_nm and customer_name all match "Customer Name").
import { logicalAttributeName } from './derive';
import { uid } from './model';
import { listTabs, tabView } from './tabs';
import type { DataModel, GlossaryTerm, Issue } from './types';

export const termKey = (s: string) => logicalAttributeName(s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_')).replace(/[^a-z0-9]/g, '');

export function newTerm(name: string, definition = '', extra: Partial<GlossaryTerm> = {}): GlossaryTerm {
  return { id: uid('term'), name, definition, status: 'draft', updated_at: new Date().toISOString(), ...extra };
}

/** The term a name stands for: same normalized name or synonym. */
export function matchTerm(terms: GlossaryTerm[], name: string): GlossaryTerm | undefined {
  const k = termKey(name);
  if (!k) return undefined;
  return terms.find((t) => t.status !== 'deprecated' && (termKey(t.name) === k || (t.synonyms || []).some((s) => termKey(s) === k)));
}

export interface TermSuggestion {
  entity: string;
  attribute?: string;
  term: GlossaryTerm;
}

/** Unlinked entities and attributes in a tab view whose names match a term. */
export function suggestLinks(m: DataModel, terms: GlossaryTerm[]): TermSuggestion[] {
  const out: TermSuggestion[] = [];
  for (const e of m.entities) {
    const te = !e.term && matchTerm(terms, e.name);
    if (te) out.push({ entity: e.name, term: te });
    for (const a of e.attributes) {
      const ta = !a.term && (matchTerm(terms, a.name) || matchTerm(terms, a.label));
      if (ta) out.push({ entity: e.name, attribute: a.name, term: ta });
    }
  }
  return out;
}

export function usedTermIds(doc: DataModel): Set<string> {
  const ids = new Set<string>();
  for (const t of listTabs(doc))
    for (const e of tabView(doc, t.id).entities) {
      if (e.term) ids.add(e.term);
      for (const a of e.attributes) if (a.term) ids.add(a.term);
    }
  return ids;
}

/** Terms the model uses, with the newest definition from the shared glossary (mutates `doc`). Returns whether it changed. */
export function refreshSnapshot(doc: DataModel, shared: GlossaryTerm[]): boolean {
  const used = usedTermIds(doc);
  const old = doc.glossary_snapshot || [];
  const next = [...used].map((id) => shared.find((t) => t.id === id) || old.find((t) => t.id === id)).filter((t): t is GlossaryTerm => !!t);
  if (JSON.stringify(next) === JSON.stringify(old)) return false;
  if (next.length) doc.glossary_snapshot = JSON.parse(JSON.stringify(next));
  else delete doc.glossary_snapshot;
  return true;
}

/** Shared glossary plus terms from a model's snapshot (newer `updated_at` wins), e.g. when a model arrives from elsewhere. */
export function mergeTerms(shared: GlossaryTerm[], incoming: GlossaryTerm[]): GlossaryTerm[] {
  const byId = new Map(shared.map((t) => [t.id, t]));
  for (const t of incoming) {
    const cur = byId.get(t.id);
    if (!cur || (t.updated_at || '') > (cur.updated_at || '')) byId.set(t.id, t);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function termOf(m: DataModel, id: string | undefined): GlossaryTerm | undefined {
  return id ? m.glossary_snapshot?.find((t) => t.id === id) : undefined;
}

/** Links to terms the model doesn't carry. */
export function validateTerms(m: DataModel): Issue[] {
  const known = new Set((m.glossary_snapshot || []).map((t) => t.id));
  const issues: Issue[] = [];
  for (const e of m.entities) {
    if (e.term && !known.has(e.term)) issues.push({ level: 'warning', code: 'term.unknown', message: `${e.display_name}: linked glossary term "${e.term}" is not in this model's glossary.`, target: { kind: 'entity', name: e.name, tab: 'general' } });
    for (const a of e.attributes)
      if (a.term && !known.has(a.term)) issues.push({ level: 'warning', code: 'term.unknown', message: `${e.display_name}.${a.name}: linked glossary term "${a.term}" is not in this model's glossary.`, target: { kind: 'entity', name: e.name, tab: 'attributes', attribute: a.name } });
  }
  return issues;
}
