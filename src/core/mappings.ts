// Source-to-target mappings between tabs: which source columns feed each target attribute, and how. Auto-map
// uses derivation lineage first, then normalized names. Outputs: a design-doc table, CSV, and dbt model SQL.
import { logicalAttributeName, logicalEntityName } from './derive';
import { uid } from './model';
import { listTabs, tabView, viewTabId } from './tabs';
import type { DataModel, Issue, Mapping, MappingEnd } from './types';

// CustNm, CUST_NM and cust_nm all become "customername".
const norm = (s: string) => logicalAttributeName(s.replace(/([a-z0-9])([A-Z])/g, '$1_$2')).replace(/[^a-z0-9]/g, '');
const normEntity = (s: string) => logicalEntityName(s).replace(/[^a-z0-9]/g, '');
export const endLabel = (e: MappingEnd) => `${e.entity}${e.attribute ? `.${e.attribute}` : ''}`;

export function mappingsFor(doc: DataModel, targetTab: string): Mapping[] {
  return (doc.mappings || []).filter((x) => x.target.tab === targetTab);
}

/** Tab ids from `to` up its derived_from chain to `from` (inclusive), when `to` descends from `from`. */
export function lineageChain(doc: DataModel, from: string, to: string): string[] | null {
  const parent = new Map(listTabs(doc).map((t) => [t.id, t.derived_from]));
  const chain = [to];
  for (let cur = to; cur !== from; ) {
    const p = parent.get(cur);
    if (!p || chain.includes(p)) return null;
    chain.push(p);
    cur = p;
  }
  return chain;
}

/**
 * Follow derived_from from a tab down a chain (first tab → last): each entity and attribute names what it came
 * from in the next tab. Renames made after a derive still resolve, because derived_from does not change.
 */
function tracer(doc: DataModel, chain: string[]) {
  const views = chain.map((t) => new Map(tabView(doc, t).entities.map((e) => [e.name, e])));
  return (entity: string, attribute?: string): { entity: string; attribute?: string } | undefined => {
    let e = entity;
    let a = attribute;
    for (let i = 0; i < chain.length - 1; i++) {
      const ent = views[i].get(e);
      if (!ent?.derived_from) return undefined;
      const at = a ? ent.attributes.find((x) => x.name === a) : undefined;
      e = ent.derived_from;
      a = a ? at?.derived_from : undefined;
      if (attribute && !a) return { entity: e };
    }
    return views[views.length - 1].has(e) ? { entity: e, attribute: a } : undefined;
  };
}

/**
 * Proposed mappings for target attributes that have none yet: lineage when one tab descends from the other
 * (through any intermediate tabs), else matching entity and attribute names.
 */
export function autoMap(doc: DataModel, sourceTab: string, targetTab: string): Mapping[] {
  const S = tabView(doc, sourceTab);
  const T = tabView(doc, targetTab);
  const sByName = new Map(S.entities.map((e) => [e.name, e]));
  const down = lineageChain(doc, sourceTab, targetTab); // target descends from source
  const up = down ? null : lineageChain(doc, targetTab, sourceTab); // source descends from target
  const traceDown = down && tracer(doc, down);
  // Source descends from target: index source entities/attributes by where they trace to in the target.
  const fromTarget = new Map<string, { entity: string; attribute?: string }>();
  if (up) {
    const traceUp = tracer(doc, up);
    for (const se of S.entities) {
      const te = traceUp(se.name);
      if (te && !fromTarget.has(te.entity)) fromTarget.set(te.entity, { entity: se.name });
      for (const sa of se.attributes) {
        const ta = traceUp(se.name, sa.name);
        if (ta?.attribute) fromTarget.set(`${ta.entity}.${ta.attribute}`, { entity: se.name, attribute: sa.name });
      }
    }
  }
  const done = new Set(mappingsFor(doc, targetTab).map((x) => `${x.target.entity}.${x.target.attribute}`));
  const out: Mapping[] = [];
  for (const te of T.entities) {
    const seName = (traceDown && traceDown(te.name)?.entity) || fromTarget.get(te.name)?.entity;
    const se = (seName && sByName.get(seName)) || sByName.get(te.name) || S.entities.find((e) => normEntity(e.name) === normEntity(te.name));
    if (!se) continue;
    for (const ta of te.attributes) {
      if (done.has(`${te.name}.${ta.name}`)) continue;
      const traced = traceDown ? traceDown(te.name, ta.name) : fromTarget.get(`${te.name}.${ta.name}`);
      const sa =
        (traced?.attribute && traced.entity === se.name && se.attributes.find((a) => a.name === traced.attribute)) ||
        se.attributes.find((a) => a.name === ta.name) ||
        se.attributes.find((a) => norm(a.name) === norm(ta.name));
      if (!sa) continue;
      out.push({ id: uid('map'), target: { tab: targetTab, entity: te.name, attribute: ta.name }, sources: [{ tab: sourceTab, entity: se.name, attribute: sa.name }], status: 'draft' });
    }
  }
  return out;
}

export function mappingCoverage(doc: DataModel, targetTab: string) {
  const T = tabView(doc, targetTab);
  const mapped = new Set(mappingsFor(doc, targetTab).map((x) => `${x.target.entity}.${x.target.attribute}`));
  const byEntity = T.entities.map((e) => ({ entity: e.name, total: e.attributes.length, mapped: e.attributes.filter((a) => mapped.has(`${e.name}.${a.name}`)).length }));
  const total = byEntity.reduce((n, x) => n + x.total, 0);
  const done = byEntity.reduce((n, x) => n + x.mapped, 0);
  return { total, mapped: done, pct: total ? Math.round((done / total) * 100) : 0, byEntity };
}

/** Mapping ends that no longer exist, and target attributes mapped twice. Model-level (mappings span tabs). */
export function validateMappings(doc: DataModel): Issue[] {
  const issues: Issue[] = [];
  const tabs = new Set(listTabs(doc).map((t) => t.id));
  const views = new Map<string, DataModel>();
  const view = (t: string) => views.get(t) || (views.set(t, tabView(doc, t)), views.get(t)!);
  const exists = (e: MappingEnd) => {
    if (!tabs.has(e.tab)) return false;
    const ent = view(e.tab).entities.find((x) => x.name === e.entity);
    return !!ent && (!e.attribute || ent.attributes.some((a) => a.name === e.attribute));
  };
  const seen = new Set<string>();
  for (const x of doc.mappings || []) {
    const k = `${x.target.tab}:${x.target.entity}.${x.target.attribute}`;
    if (seen.has(k)) issues.push({ level: 'warning', code: 'map.duplicate', message: `${endLabel(x.target)} is mapped more than once.`, target: { kind: 'model' } });
    seen.add(k);
    for (const e of [x.target, ...x.sources]) if (!exists(e)) issues.push({ level: 'warning', code: 'map.dangling', message: `Mapping for ${endLabel(x.target)} refers to ${endLabel(e)} in tab "${e.tab}", which no longer exists.`, target: { kind: 'model' } });
  }
  return issues;
}

/** dbt model SQL for one target entity, from its mappings (unmapped columns are left as TODOs). */
export function mappingSql(doc: DataModel, targetTab: string, entity: string): string {
  const T = tabView(doc, targetTab);
  const te = T.entities.find((e) => e.name === entity);
  if (!te) return '';
  const maps = new Map(mappingsFor(doc, targetTab).filter((x) => x.target.entity === entity).map((x) => [x.target.attribute, x]));
  const sources = [...new Set([...maps.values()].flatMap((x) => x.sources.map((s) => s.entity)))];
  const alias = (n: string) => (sources.length === 1 ? 'src' : n);
  // Commas go before trailing comments, so a TODO never comments one out.
  const cols = te.attributes.map((a, i) => {
    const x = maps.get(a.name);
    const expr = x?.transform?.trim() || (x?.sources.length === 1 && x.sources[0].attribute ? `${alias(x.sources[0].entity)}.${x.sources[0].attribute}` : null);
    const comma = i < te.attributes.length - 1 ? ',' : '';
    return expr ? `    ${expr} as ${a.name}${comma}` : `    null as ${a.name}${comma}  -- TODO: not mapped yet`;
  });
  const from = sources.length ? `from {{ ref('${sources[0]}') }} as ${alias(sources[0])}` : `-- TODO: no sources mapped`;
  const joins = sources.slice(1).map((s) => `-- join {{ ref('${s}') }} as ${s} on …`);
  return [`-- ${te.display_name} (${T.tab?.name || targetTab} tab), from EntityModel.com mappings`, 'select', cols.join('\n'), from, ...joins].join('\n') + '\n';
}

/** CSV: one row per mapped target attribute. */
export function mappingsCsv(doc: DataModel, targetTab: string): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [['target_entity', 'target_attribute', 'sources', 'transform', 'status', 'notes']];
  for (const x of mappingsFor(doc, targetTab)) rows.push([x.target.entity, x.target.attribute, x.sources.map((s) => `${s.tab}:${endLabel(s)}`).join(' + '), x.transform || '', x.status || 'draft', x.notes || '']);
  return rows.map((r) => r.map(q).join(',')).join('\n') + '\n';
}

/** For doc tables: the mappings whose target is the view's tab. */
export function viewMappings(m: DataModel): Mapping[] {
  const id = viewTabId(m);
  return (m.mappings || []).filter((x) => x.target.tab === id);
}
