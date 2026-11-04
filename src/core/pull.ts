// A database snapshot → ops for the model. The first pull of a schema becomes a Physical tab (or fills an empty
// model). Later pulls of the same source become a dated version tab derived from the previous one, so Compare
// and migration SQL show the drift, and layout carries over.
import { CATALOG_PLATFORMS, fromCatalog, type CatalogSnapshot } from './interop/catalog';
import { listTabs, structuredCopy, tabView, uniqueTabName } from './tabs';
import type { Op } from './operations';
import type { DataModel, ModelContent, TabMeta } from './types';

export interface PullPlan {
  ops: Op[];
  /** Tab the pull compares against (same source pulled before). */
  previous?: string;
  tabName: string;
  tables: number;
  warnings: string[];
}

const sourceKey = (s: { platform: string; catalog?: string; schema?: string }) => `${s.platform}|${(s.catalog || '').toLowerCase()}|${(s.schema || '').toLowerCase()}`;

export function planPull(doc: DataModel, snap: CatalogSnapshot, opts: { name?: string; profile?: string } = {}): PullPlan {
  const { model, warnings } = fromCatalog(snap);
  const source: NonNullable<TabMeta['source']> = { platform: snap.platform, ...(snap.catalog ? { catalog: snap.catalog } : {}), ...(snap.schema ? { schema: snap.schema } : {}), ...(opts.profile && snap.platform === 'databricks' ? { profile: opts.profile } : {}), pulled_at: snap.captured_at };
  const key = sourceKey(source);
  const previous = listTabs(doc)
    .filter((t) => t.source && sourceKey(t.source) === key)
    .sort((a, b) => (b.source!.pulled_at || '').localeCompare(a.source!.pulled_at || ''))[0];
  const content: ModelContent = { entities: model.entities, relationships: model.relationships, hierarchies: [], areas: [], notes: [] };
  const where = [snap.catalog, snap.schema].filter(Boolean).join('.') || 'database';
  const platform = CATALOG_PLATFORMS.find((p) => p.id === snap.platform)?.label.replace(/ \(.*\)$/, '') || snap.platform;

  if (previous) {
    // Same physical names on both sides: lineage is by name, and positions carry over.
    const prev = tabView(doc, previous.id);
    for (const e of content.entities) {
      e.derived_from = e.name;
      for (const a of e.attributes) a.derived_from = a.name;
      const old = prev.entities.find((x) => x.name === e.name);
      if (old?.ui) e.ui = { x: old.ui.x, y: old.ui.y };
      if (old) {
        // Keep what people wrote in the model when the database has nothing better.
        if (!e.description && old.description) e.description = old.description;
        if (old.display_name && old.display_name !== e.name) e.display_name = old.display_name;
        e.color_code = old.color_code;
        for (const a of e.attributes) {
          const oa = old.attributes.find((x) => x.name === a.name);
          if (oa && !a.description && oa.description) a.description = oa.description;
          if (oa?.pii) a.pii = true;
        }
      }
    }
    content.areas = structuredCopy(prev.areas);
    const tabName = opts.name || uniqueTabName(doc, `${previous.name.replace(/ @ \d{4}-\d{2}-\d{2}.*$/, '')} @ ${snap.captured_at.slice(0, 10)}`);
    return {
      // With content, `from` only records lineage (nothing is derived).
      ops: [{ op: 'add_tab', name: tabName, kind: 'physical', dialect: snap.platform, content, source, from: previous.id }],
      previous: previous.id,
      tabName,
      tables: snap.tables.length,
      warnings,
    };
  }

  const empty = !doc.entities.length && !doc.tabs?.length;
  if (empty) {
    // A new model: the pulled schema becomes the primary tab.
    const tabName = opts.name || `${where} (${platform})`;
    return {
      ops: [
        ...content.entities.map((e) => ({ op: 'add_entity' as const, entity: e })),
        ...content.relationships.map((r) => ({ op: 'add_relationship' as const, relationship: r })),
        { op: 'update_tab', set: { name: tabName, kind: 'physical', dialect: snap.platform, source } },
      ],
      tabName,
      tables: snap.tables.length,
      warnings,
    };
  }
  const tabName = opts.name || uniqueTabName(doc, `${where} (${platform})`);
  return { ops: [{ op: 'add_tab', name: tabName, kind: 'physical', dialect: snap.platform, content, source }], tabName, tables: snap.tables.length, warnings };
}
