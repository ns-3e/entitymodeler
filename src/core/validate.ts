// Model validation: structural integrity (names, keys, references, structs, dependent references,
// relationships, hierarchies) plus design hygiene checks.
import { primaryKey, relationshipEnds } from './model';
import { checkStandards } from './standards';
import { validateMappings } from './mappings';
import { validateTerms } from './glossary';
import type { DataModel, Entity, Issue, IssueLevel } from './types';

const ENTITY_NAME_RE = /^[a-z][a-z0-9_]*$/;
const ATTR_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const REL_NAME_RE = /^[a-z][a-z0-9_]*$/;
const HIER_NAME_RE = /^[a-z][a-z0-9_]*$/;

export function validateModel(m: DataModel): Issue[] {
  const issues: Issue[] = [];
  const push = (level: IssueLevel, code: string, message: string, target: Issue['target']) => issues.push({ level, code, message, target });
  const entityByName = new Map(m.entities.map((e) => [e.name, e]));

  // ---- model ----
  if (!m.entities.length) push('info', 'model.empty', 'Model has no entities yet.', { kind: 'model' });
  dupes(m.entities.map((e) => e.name)).forEach((n) => push('error', 'entity.duplicate', `Duplicate entity name "${n}".`, { kind: 'entity', name: n }));
  dupes(m.relationships.map((r) => r.name)).forEach((n) => push('error', 'rel.duplicate', `Duplicate relationship name "${n}".`, { kind: 'relationship', name: n }));

  // ---- entities ----
  const conceptual = m.tab?.kind === 'conceptual';
  for (const e of m.entities) validateEntity(e, entityByName, push, conceptual);

  // dependent reference cycles
  for (const e of m.entities) {
    const seen = new Set<string>([e.name]);
    let cur = e.dependent_reference?.parent;
    while (cur) {
      if (seen.has(cur)) {
        push('error', 'depref.cycle', `Dependent reference chain from "${e.name}" forms a cycle.`, { kind: 'entity', name: e.name, tab: 'general' });
        break;
      }
      seen.add(cur);
      cur = entityByName.get(cur)?.dependent_reference?.parent;
    }
  }

  // ---- relationships ----
  for (const r of m.relationships) {
    const t = { kind: 'relationship' as const, name: r.name };
    if (!REL_NAME_RE.test(r.name)) push('error', 'rel.name', `Relationship name "${r.name}" must be lowercase letters, digits and underscores, starting with a letter.`, t);
    for (const end of ['source', 'target'] as const)
      if (!entityByName.has(r[end])) push('error', 'rel.endpoint', `Relationship "${r.name}" ${end} entity "${r[end]}" does not exist.`, t);
    if (!r.forward_label) push('warning', 'rel.fwd', `Relationship "${r.name}" has no forward label.`, t);
    if (r.foreign_key) {
      const ends = relationshipEnds(r);
      if (!ends) push('warning', 'rel.fknn', `Relationship "${r.name}" is N:N, so its foreign key "${r.foreign_key}" is ignored (a junction table is used).`, t);
      else if (entityByName.has(ends.child) && !entityByName.get(ends.child)!.attributes.some((a) => a.name === r.foreign_key))
        push('error', 'rel.fk', `Relationship "${r.name}": foreign key "${r.foreign_key}" is not an attribute of "${ends.child}".`, t);
    }
    if (r.bidirectional && !r.reverse_label) push('warning', 'rel.rev', `Bidirectional relationship "${r.name}" has no reverse label.`, t);
    if (r.bidirectional && r.reverse_label && r.reverse_label === r.forward_label)
      push('error', 'rel.labels', `Relationship "${r.name}" reverse label must differ from forward label.`, t);
  }

  // ---- hierarchies ----
  for (const h of m.hierarchies) {
    const t = { kind: 'hierarchy' as const, name: h.name };
    if (!HIER_NAME_RE.test(h.name)) push('error', 'hier.name', `Hierarchy name "${h.name}" must be lowercase letters, digits and underscores, starting with a letter.`, t);
    if (!entityByName.has(h.root)) push('error', 'hier.root', `Hierarchy "${h.name}" root "${h.root}" does not exist.`, t);
    const levels = [...h.levels].sort((a, b) => a.level - b.level);
    levels.forEach((l, i) => {
      if (l.level !== i + 2) push('error', 'hier.contiguous', `Hierarchy "${h.name}" levels must run contiguously from 2.`, t);
    });
    const branchEntities = new Map<string, string>([[h.root_branch_name || 'Root', h.root]]);
    for (const l of levels) {
      dupes(l.branches.map((b) => b.name)).forEach((n) => push('error', 'hier.branchdup', `Hierarchy "${h.name}" level ${l.level} has duplicate branch "${n}".`, t));
      const next = new Map<string, string>();
      for (const b of l.branches) {
        const rel = m.relationships.find((r) => r.name === b.relationship);
        const parentEntity = branchEntities.get(b.parent_branch);
        if (!rel) push('error', 'hier.rel', `Hierarchy "${h.name}" branch "${b.name}" uses unknown relationship "${b.relationship}".`, t);
        else {
          const [child, parent] = b.direction === 'forward' ? [rel.source, rel.target] : [rel.target, rel.source];
          if (child !== b.entity) push('error', 'hier.child', `Branch "${b.name}": "${b.entity}" is not the child side of "${rel.name}" in ${b.direction} direction.`, t);
          if (parentEntity && parent !== parentEntity)
            push('error', 'hier.parent', `Branch "${b.name}": "${rel.name}" parent side is "${parent}", but parent branch "${b.parent_branch}" is "${parentEntity}".`, t);
        }
        if (!parentEntity) push('error', 'hier.parentbranch', `Branch "${b.name}" parent branch "${b.parent_branch}" is not on the level above.`, t);
        next.set(b.name, b.entity);
      }
      branchEntities.clear();
      next.forEach((v, k) => branchEntities.set(k, v));
    }
  }

  // Naming standards for this kind of tab, when the model sets them.
  issues.push(...checkStandards(m));
  issues.push(...validateTerms(m));
  return issues;
}

function validateEntity(
  e: Entity,
  entityByName: Map<string, Entity>,
  push: (level: IssueLevel, code: string, message: string, target: Issue['target']) => void,
  conceptual = false,
) {
  const t = (tab?: string, attribute?: string) => ({ kind: 'entity' as const, name: e.name, tab, attribute });
  if (!ENTITY_NAME_RE.test(e.name)) push('error', 'entity.name', `Entity name "${e.name}" must be lowercase letters, digits and underscores.`, t('general'));
  if (!e.description) push('info', 'entity.desc', `${e.display_name}: add a description for the design doc.`, t('general'));
  // Conceptual tabs model entities and relationships only; attributes are optional there.
  if (conceptual && !e.attributes.length) return;
  if (!e.attributes.length) push('error', 'entity.noattrs', `${e.display_name} has no attributes.`, t('attributes'));

  dupes(e.attributes.map((a) => a.name.toLowerCase())).forEach((n) => push('error', 'attr.duplicate', `${e.display_name}: duplicate attribute "${n}".`, t('attributes', n)));

  const pks = e.attributes.filter((a) => a.is_primary_key);
  if (pks.length === 0) push(e.entity_type === 'reference' ? 'error' : 'warning', 'entity.nopk', `${e.display_name} has no primary key.`, t('attributes'));
  if (e.entity_type === 'reference' && pks.length > 1) push('error', 'ref.pk1', `Reference entity ${e.display_name} must have exactly one primary key.`, t('attributes'));
  if (!e.attributes.some((a) => a.is_label)) push('warning', 'entity.nolabel', `${e.display_name} has no primary display (label) attribute.`, t('attributes'));
  if (e.attributes.filter((a) => a.is_label).length > 1) push('warning', 'entity.labels', `${e.display_name} has more than one label attribute.`, t('attributes'));

  for (const a of e.attributes) {
    if (!ATTR_NAME_RE.test(a.name)) push('error', 'attr.name', `${e.display_name}.${a.name}: invalid attribute name.`, t('attributes', a.name));
    if (a.is_primary_key && (a.type === 'STRUCT' || a.is_array))
      push('error', 'attr.pkstruct', `${e.display_name}.${a.name}: STRUCT and array attributes cannot be primary keys.`, t('attributes', a.name));
    if (a.type === 'REFERENCE_ENTITY') checkRef(e, a.name, a.reference, entityByName, push, t('attributes', a.name));
    if (a.type === 'STRUCT') {
      const st = e.struct_types?.find((s) => s.name === a.struct_type);
      if (!st) push('error', 'attr.struct', `${e.display_name}.${a.name}: struct type "${a.struct_type || ''}" is not defined.`, t('structs', a.name));
    }
  }
  for (const st of e.struct_types || []) {
    if (!st.fields.length) push('warning', 'struct.empty', `${e.display_name}: struct type "${st.name}" has no fields.`, t('structs'));
    dupes(st.fields.map((f) => f.name)).forEach((n) => push('error', 'struct.dup', `${e.display_name}: struct "${st.name}" duplicates field "${n}".`, t('structs')));
    for (const f of st.fields) {
      if ((f.type as string) === 'STRUCT') push('error', 'struct.nested', `${e.display_name}: struct "${st.name}".${f.name} — structs cannot contain structs.`, t('structs'));
      if (f.type === 'REFERENCE_ENTITY') checkRef(e, `${st.name}.${f.name}`, f.reference, entityByName, push, t('structs'));
    }
  }

  // ---- dependent reference ----
  if (e.dependent_reference) {
    const d = e.dependent_reference;
    const parent = entityByName.get(d.parent);
    if (e.entity_type !== 'reference') push('error', 'depref.type', `${e.display_name}: dependent reference is only for Reference entities.`, t('general'));
    if (!parent) push('error', 'depref.parent', `${e.display_name}: parent "${d.parent}" does not exist.`, t('general'));
    else {
      if (parent.entity_type !== 'reference') push('error', 'depref.parenttype', `${e.display_name}: parent "${d.parent}" must be a Reference entity.`, t('general'));
      if (!primaryKey(parent)) push('error', 'depref.parentpk', `${e.display_name}: parent "${d.parent}" has no primary key.`, t('general'));
      if (!parent.attributes.some((a) => a.name === d.linked_column))
        push('error', 'depref.linked', `${e.display_name}: linked column "${d.linked_column}" is not an attribute of "${d.parent}".`, t('general'));
    }
    if (e.attributes.some((a) => a.name === d.linked_column))
      push('error', 'depref.collision', `${e.display_name}: linked column "${d.linked_column}" collides with an existing attribute — the dependent reference adds it automatically.`, t('general'));
  }

  // ---- reference values ----
  if (e.reference_values?.length) {
    const tv = t('values');
    if (e.entity_type !== 'reference') push('warning', 'values.type', `${e.display_name}: reference values are only used on Reference entities.`, tv);
    const pk = primaryKey(e);
    const known = new Set([...e.attributes.map((a) => a.name), ...(e.dependent_reference ? [e.dependent_reference.linked_column] : [])]);
    const stray = new Set<string>();
    e.reference_values.forEach((v) => Object.keys(v).forEach((k) => !known.has(k) && stray.add(k)));
    if (stray.size) push('warning', 'values.cols', `${e.display_name}: values contain columns that are not attributes (${[...stray].join(', ')}).`, tv);
    if (pk) {
      const keys = e.reference_values.map((v) => (v[pk.name] || '').trim());
      const blank = keys.filter((k) => !k).length;
      if (blank) push('error', 'values.pkblank', `${e.display_name}: ${blank} value row(s) have no ${pk.name}.`, tv);
      const d = dupes(keys.filter(Boolean));
      if (d.length) push('error', 'values.pkdup', `${e.display_name}: duplicate ${pk.name} value(s): ${d.slice(0, 8).join(', ')}${d.length > 8 ? '…' : ''}.`, tv);
    }
    const dep = e.dependent_reference;
    const parent = dep && entityByName.get(dep.parent);
    if (dep && parent?.reference_values?.length) {
      const parentKeys = new Set(parent.reference_values.map((v) => v[dep.linked_column]).filter(Boolean));
      const missing = [...new Set(e.reference_values.map((v) => v[dep.linked_column]).filter((x) => x && !parentKeys.has(x)))];
      if (missing.length)
        push('error', 'values.parent', `${e.display_name}: ${dep.linked_column} value(s) not found in ${parent.display_name}: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}. (Parent link matching is exact and case-sensitive.)`, tv);
      const noParent = e.reference_values.filter((v) => !v[dep.linked_column]).length;
      if (noParent) push('warning', 'values.noparent', `${e.display_name}: ${noParent} value row(s) have no ${dep.linked_column} (parent).`, tv);
    }
  }
}

function checkRef(
  e: Entity,
  where: string,
  ref: { entity: string; output_attribute: string } | undefined,
  entityByName: Map<string, Entity>,
  push: (level: IssueLevel, code: string, message: string, target: Issue['target']) => void,
  target: Issue['target'],
) {
  if (!ref?.entity) return push('error', 'ref.entity', `${e.display_name}.${where}: choose the reference entity.`, target);
  const r = entityByName.get(ref.entity);
  if (!r) return push('error', 'ref.missing', `${e.display_name}.${where}: reference entity "${ref.entity}" does not exist.`, target);
  if (r.entity_type !== 'reference') push('error', 'ref.type', `${e.display_name}.${where}: "${ref.entity}" is not a Reference entity.`, target);
  if (!ref.output_attribute) push('error', 'ref.output', `${e.display_name}.${where}: choose the reference output attribute.`, target);
  else if (!r.attributes.some((a) => a.name === ref.output_attribute))
    push('error', 'ref.output2', `${e.display_name}.${where}: output "${ref.output_attribute}" is not an attribute of "${ref.entity}".`, target);
}

function dupes(xs: string[]): string[] {
  const seen = new Set<string>();
  const d = new Set<string>();
  for (const x of xs) (seen.has(x) ? d : seen).add(x);
  return [...d];
}

/** Model-level checks across tabs: names, lineage links. Per-tab content is checked by validateModel(tabView(…)). */
export function validateTabs(m: DataModel): Issue[] {
  const issues: Issue[] = [];
  const tabs = [{ id: 'main', name: m.tab?.name || 'Main' }, ...(m.tabs || [])];
  const ids = new Set(tabs.map((t) => t.id));
  dupes(tabs.map((t) => t.name.toLowerCase())).forEach((n) => issues.push({ level: 'error', code: 'tab.duplicate', message: `Duplicate tab name "${n}".`, target: { kind: 'model' } }));
  dupes(tabs.map((t) => t.id)).forEach((n) => issues.push({ level: 'error', code: 'tab.id', message: `Duplicate tab id "${n}".`, target: { kind: 'model' } }));
  for (const t of [{ ...m.tab, id: 'main', name: m.tab?.name || 'Main' }, ...(m.tabs || [])])
    if (t.derived_from && !ids.has(t.derived_from))
      issues.push({ level: 'warning', code: 'tab.lineage', message: `Tab "${t.name}" was derived from tab "${t.derived_from}", which no longer exists.`, target: { kind: 'model' } });
  issues.push(...validateMappings(m));
  return issues;
}

export function issueCounts(issues: Issue[]) {
  return {
    error: issues.filter((i) => i.level === 'error').length,
    warning: issues.filter((i) => i.level === 'warning').length,
    info: issues.filter((i) => i.level === 'info').length,
  };
}
