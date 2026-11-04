// Review two versions of a model file (e.g. a pull request's base and head): what changed per tab in modeling
// terms, validation before and after, and migration SQL for physical tabs. Feeds `em review` and the GitHub
// Action that comments on pull requests.
import { diffCounts, diffViews, migrationSql, type TabDiff } from './diff';
import { listTabs, structuredCopy, tabContent, tabView } from './tabs';
import { issueCounts, validateModel } from './validate';
import type { SqlDialect } from './interop/sqlTypes';
import type { DataModel } from './types';
import { typeDisplay } from './model';

export interface TabReview {
  id: string;
  name: string;
  kind: string;
  change: 'added' | 'removed' | 'changed' | 'unchanged';
  entities: [number, number];
  relationships: [number, number];
  errors: [number, number];
  warnings: [number, number];
  diff?: TabDiff;
  sql?: string;
}

export interface ModelReview {
  path: string;
  title: string;
  change: 'added' | 'removed' | 'changed' | 'unchanged';
  header: string[];
  tabs: TabReview[];
  comments: { opened: number; resolved: number; open: number };
}

const HEADER_KEYS = ['title', 'organization', 'version', 'status', 'description'] as const;

export function reviewModels(path: string, before: DataModel | null, after: DataModel | null, opts: { dialect?: SqlDialect; sql?: boolean } = {}): ModelReview {
  const doc = after || before!;
  const header: string[] = [];
  if (before && after)
    for (const k of HEADER_KEYS) if ((before[k] || '') !== (after[k] || '')) header.push(k === 'description' ? 'description changed' : `${k}: ${before[k] || '—'} → ${after[k] || '—'}`);

  const tabsB = before ? listTabs(before) : [];
  const tabsA = after ? listTabs(after) : [];
  const ids = [...new Set([...tabsA.map((t) => t.id), ...tabsB.map((t) => t.id)])];
  const stats = (m: DataModel | null, id: string, present: boolean) => {
    if (!m || !present) return { e: 0, r: 0, err: 0, warn: 0 };
    const v = tabView(m, id);
    const c = issueCounts(validateModel(v));
    return { e: v.entities.length, r: v.relationships.length, err: c.error, warn: c.warning };
  };
  const tabs: TabReview[] = ids.map((id) => {
    const tb = tabsB.find((t) => t.id === id);
    const ta = tabsA.find((t) => t.id === id);
    const sb = stats(before, id, !!tb);
    const sa = stats(after, id, !!ta);
    const meta = ta || tb!;
    const r: TabReview = { id, name: meta.name, kind: meta.kind, change: !tb ? 'added' : !ta ? 'removed' : 'unchanged', entities: [sb.e, sa.e], relationships: [sb.r, sa.r], errors: [sb.err, sa.err], warnings: [sb.warn, sa.warn] };
    if (tb && ta) {
      const vb = tabView(before!, id);
      const va = tabView(after!, id);
      const d = pairRenames(diffViews(vb, va, 'none', { id, name: `${tb.name} (base)` }, { id, name: ta.name }), vb, va);
      const c = diffCounts(d);
      if (c.added || c.removed || c.changed) {
        r.change = 'changed';
        r.diff = d;
        // Physical tabs: the DDL that takes a database built from the base to this version.
        const dialect = opts.dialect || (ta.dialect as SqlDialect | undefined);
        if (opts.sql !== false && (ta.kind === 'physical' || dialect)) {
          // Detected renames become lineage, so the DDL renames columns and tables instead of dropping them.
          const head = structuredCopy(tabContent(after!, id));
          for (const e of head.entities) {
            const de = d.entities.find((x) => x.name === e.name);
            e.derived_from = de?.change === 'added' ? undefined : de?.from || e.name;
            for (const a of e.attributes) {
              const da = de?.attributes.find((x) => x.name === a.name);
              a.derived_from = da?.change === 'added' ? undefined : da?.from || a.name;
            }
          }
          const combined: DataModel = {
            ...after!,
            tabs: [
              { id: '__base', name: `${tb.name} (base)`, kind: 'physical', ...tabContent(before!, id) },
              { id: '__head', name: ta.name, kind: 'physical', derived_from: '__base', ...head },
            ],
          };
          r.sql = migrationSql(combined, '__base', '__head', dialect || 'postgres');
        }
      }
    }
    return r;
  });

  const cb = before?.comments || [];
  const ca = after?.comments || [];
  const comments = {
    opened: ca.filter((c) => !cb.some((x) => x.id === c.id)).length,
    resolved: ca.filter((c) => c.resolved && cb.some((x) => x.id === c.id && !x.resolved)).length,
    open: ca.filter((c) => !c.resolved).length,
  };
  const change = !before ? 'added' : !after ? 'removed' : header.length || tabs.some((t) => t.change !== 'unchanged') || comments.opened || comments.resolved ? 'changed' : 'unchanged';
  return { path, title: doc.title, change, header, tabs, comments };
}

/**
 * Two versions of a file have no lineage, so a rename diffs as remove + add. Pair them back up: an attribute
 * removed and one added with the same type at the same position, or an entity removed and one added with the
 * same attribute names, is a rename.
 */
function pairRenames(d: TabDiff, before: DataModel, after: DataModel): TabDiff {
  const eb = new Map(before.entities.map((e) => [e.name, e]));
  const ea = new Map(after.entities.map((e) => [e.name, e]));
  for (const e of d.entities) {
    if (e.change !== 'changed' || e.from) continue;
    const oldE = eb.get(e.name);
    const newE = ea.get(e.name);
    if (!oldE || !newE) continue;
    const removed = e.attributes.filter((a) => a.change === 'removed');
    for (const add of e.attributes.filter((a) => a.change === 'added')) {
      const at = newE.attributes.findIndex((a) => a.name === add.name);
      const match = removed.find((r) => {
        const i = oldE.attributes.findIndex((a) => a.name === r.name);
        return i === at && typeDisplay(oldE.attributes[i]) === typeDisplay(newE.attributes[at]);
      });
      if (!match) continue;
      removed.splice(removed.indexOf(match), 1);
      Object.assign(add, { change: 'changed', from: match.name, details: [] });
      e.attributes = e.attributes.filter((a) => a !== match);
    }
  }
  const sig = (m: Map<string, { attributes: { name: string }[] }>, n: string) => m.get(n)?.attributes.map((a) => a.name).sort().join(',') ?? '';
  for (const add of d.entities.filter((x) => x.change === 'added')) {
    const gone = d.entities.find((x) => x.change === 'removed' && sig(eb, x.name) === sig(ea, add.name) && sig(ea, add.name));
    if (!gone) continue;
    Object.assign(add, { change: 'changed', from: gone.name, details: [], attributes: [] });
    d.entities = d.entities.filter((x) => x !== gone);
  }
  return d;
}

const SYM = { added: '+', removed: '−', changed: '~' } as const;
const arrow = ([a, b]: [number, number]) => (a === b ? String(b) : `${a} → ${b}`);

/** GitHub-flavored Markdown for one or more reviews (a pull-request comment). */
export function reviewToMarkdown(reviews: ModelReview[], opts: { maxSqlLines?: number } = {}): string {
  const out = ['### EntityModel.com review', ''];
  const changed = reviews.filter((r) => r.change !== 'unchanged');
  if (!changed.length) return [...out, 'No model changes.', ''].join('\n');
  for (const r of changed) {
    out.push(`#### ${r.title} · \`${r.path}\`${r.change === 'added' ? ' (new model)' : r.change === 'removed' ? ' (removed)' : ''}`, '');
    if (r.header.length) out.push(`Model: ${r.header.join('; ')}.`, '');
    const tabs = r.tabs.filter((t) => t.change !== 'unchanged');
    if (tabs.length) {
      out.push('| Tab | Change | Entities | Relationships | Validation |', '| --- | --- | --- | --- | --- |');
      for (const t of tabs) {
        const c = t.diff ? diffCounts(t.diff) : null;
        const what = t.change === 'changed' && c ? [c.added && `${c.added} added`, c.removed && `${c.removed} removed`, c.changed && `${c.changed} changed`].filter(Boolean).join(', ') : t.change;
        const bad = t.errors[1] > t.errors[0];
        const val = `${t.errors[1]} errors${t.errors[0] !== t.errors[1] ? ` (was ${t.errors[0]})` : ''}, ${t.warnings[1]} warnings${t.warnings[0] !== t.warnings[1] ? ` (was ${t.warnings[0]})` : ''}${bad ? ' ⚠️' : ''}`;
        out.push(`| ${t.name} (${t.kind}) | ${what} | ${arrow(t.entities)} | ${arrow(t.relationships)} | ${val} |`);
      }
      out.push('');
    }
    for (const t of tabs) {
      if (!t.diff) continue;
      const lines: string[] = [];
      for (const e of t.diff.entities) {
        lines.push(`- ${SYM[e.change]} **${e.name}**${e.from ? ` (was ${e.from})` : ''}${e.details.length ? ` — ${e.details.join('; ')}` : ''}`);
        for (const a of e.attributes) lines.push(`  - ${SYM[a.change]} \`${a.name}\`${a.from ? ` (was \`${a.from}\`)` : ''}${a.details.length ? ` — ${a.details.join('; ')}` : ''}`);
      }
      for (const x of t.diff.relationships) lines.push(`- ${SYM[x.change]} relationship **${x.name}**${x.details.length ? ` — ${x.details.join('; ')}` : ''}`);
      out.push(`<details><summary>${t.name}: what changed</summary>`, '', ...lines, '', '</details>', '');
      if (t.sql) {
        const sqlLines = t.sql.split('\n');
        const max = opts.maxSqlLines ?? 200;
        out.push(`<details><summary>${t.name}: migration SQL</summary>`, '', '```sql', ...sqlLines.slice(0, max), ...(sqlLines.length > max ? [`-- … ${sqlLines.length - max} more lines (run em migrate locally)`] : []), '```', '', '</details>', '');
      }
    }
    if (r.comments.opened || r.comments.resolved) out.push(`Review comments: ${r.comments.opened} new, ${r.comments.resolved} resolved, ${r.comments.open} open.`, '');
  }
  out.push('<sub>Generated by `em review` · [EntityModel.com](https://entitymodel.com)</sub>', '');
  return out.join('\n');
}

