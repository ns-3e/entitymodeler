// Model → Mermaid erDiagram (renders on GitHub, GitLab, Notion, mermaid.live). Export only.
import { resolveForeignKey, relationshipEnds } from '../model';
import type { Cardinality, DataModel } from '../types';
import { MADE_WITH, valueType } from './sqlTypes';

const CROWS_FOOT: Record<Cardinality, string> = { 'N:1': '}o--||', '1:N': '||--o{', '1:1': '||--||', 'N:N': '}o--o{' };
const text = (s: string) => s.replace(/"/g, "'").replace(/\s+/g, ' ').trim();

export function toMermaid(m: DataModel): string {
  const out: string[] = ['---', `title: ${text(m.title)}`, '---', `%% ${MADE_WITH}`, 'erDiagram'];
  const fkCols = new Map<string, Set<string>>();
  const markFk = (entity: string, attr: string) => fkCols.set(entity, (fkCols.get(entity) || new Set()).add(attr));
  for (const r of m.relationships) {
    const ends = relationshipEnds(r);
    const fk = ends && resolveForeignKey(m, r);
    if (ends && fk) markFk(ends.child, fk);
  }
  for (const e of m.entities) for (const a of e.attributes) if (a.type === 'REFERENCE_ENTITY') markFk(e.name, a.name);

  for (const e of m.entities) {
    out.push(`  ${e.name} {`);
    for (const a of e.attributes) {
      const base = a.type === 'STRUCT' ? `struct_${a.struct_type || 'object'}` : valueType(m, a).toLowerCase();
      const keys = [a.is_primary_key ? 'PK' : '', fkCols.get(e.name)?.has(a.name) ? 'FK' : ''].filter(Boolean).join(', ');
      const comment = a.description || a.label;
      out.push(`    ${base}${a.is_array ? '[]' : ''} ${a.name}${keys ? ` ${keys}` : ''}${comment ? ` "${text(comment)}"` : ''}`);
    }
    if (e.dependent_reference && !e.attributes.some((a) => a.name === e.dependent_reference!.linked_column))
      out.push(`    string ${e.dependent_reference.linked_column} FK "Parent ${text(e.dependent_reference.parent)}"`);
    out.push('  }');
  }
  for (const r of m.relationships) out.push(`  ${r.source} ${CROWS_FOOT[r.cardinality]} ${r.target} : "${text(r.forward_label || r.name)}"`);
  for (const e of m.entities) {
    for (const a of e.attributes) if (a.type === 'REFERENCE_ENTITY' && a.reference) out.push(`  ${e.name} }o..|| ${a.reference.entity} : "${text(a.label || a.name)}"`);
    if (e.dependent_reference) out.push(`  ${e.name} }o..|| ${e.dependent_reference.parent} : "depends on"`);
  }
  return out.join('\n') + '\n';
}
