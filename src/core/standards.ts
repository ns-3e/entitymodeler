// Naming standards: per tab kind (logical, physical…), optional rules that validation checks. Every issue that
// can be fixed mechanically carries `fix` ops (renames cascade), so the UI and `em validate --fix` apply them.
import { ABBREVIATIONS, expandWords, singularize } from './derive';
import { applyBatches, type Op } from './operations';
import { renameAttributes, renameEntities } from './ops';
import { tabView, withTab } from './tabs';

const NAME_RE = /^[a-z][a-z0-9_]*$/;
const ATTR_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
import type { DataModel, Issue, NamingStandard, TabKind } from './types';

/** Starting points for each kind of tab (see the Standards section in the model inspector). */
export const STANDARD_PRESETS: Record<TabKind, NamingStandard> = {
  conceptual: { entity_number: 'singular', require_entity_description: true },
  logical: { attribute_case: 'snake', entity_number: 'singular', abbreviations: 'expand', pk_suffix: '_id', require_entity_description: true, require_attribute_description: true, require_pii_review: true },
  physical: { attribute_case: 'snake', entity_number: 'singular', max_length: 63, require_pii_review: true },
  variant: { attribute_case: 'snake', entity_number: 'singular' },
};

/** Identifier limits per platform, for the physical preset. */
export const MAX_IDENTIFIER: Record<string, number> = { postgres: 63, mysql: 64, snowflake: 255, databricks: 255 };

const PII_NAME = /(^|_)(e?mail|phone|mobile|fax|ssn|social_security|soc_sec|passport|birth|dob|first_name|last_name|full_name|surname|address|street|postcode|postal_code|zip|ip_address|national_id|tax_id|iban|card_number|salary|gender|ethnicity)(_|$)/i;

/** Whether a column name looks like personal data (email, phone, SSN, birth date, address…), in snake or camel case. */
export const looksPersonal = (name: string) => PII_NAME.test(name.replace(/([a-z0-9])([A-Z])/g, '$1_$2'));

const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

export function toCase(name: string, c: NonNullable<NamingStandard['attribute_case']>): string {
  const w = words(name);
  if (c === 'camel') return w.map((x, i) => (i ? x[0].toUpperCase() + x.slice(1) : x)).join('');
  if (c === 'upper_snake') return w.join('_').toUpperCase();
  return w.join('_');
}

export function pluralize(word: string): string {
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

const withLast = (name: string, fn: (w: string) => string) => {
  const parts = name.split('_');
  parts[parts.length - 1] = fn(parts[parts.length - 1]);
  return parts.join('_');
};

/** The standard in force for a tab view, if any. */
export function standardFor(m: DataModel): NamingStandard | undefined {
  return m.standards?.[m.tab?.kind || 'logical'];
}

export function checkStandards(m: DataModel, std: NamingStandard | undefined = standardFor(m)): Issue[] {
  if (!std) return [];
  const issues: Issue[] = [];
  const entityNames = new Set(m.entities.map((e) => e.name));
  const push = (level: Issue['level'], code: string, message: string, target: Issue['target'], fix?: Op[]) => issues.push({ level, code, message, target, ...(fix ? { fix } : {}) });
  const renameEntity = (from: string, to: string): Op[] | undefined => (to !== from && /^[a-z][a-z0-9_]*$/.test(to) && !entityNames.has(to) ? [{ op: 'rename_entity', entity: from, to }] : undefined);

  for (const e of m.entities) {
    const te = { kind: 'entity' as const, name: e.name, tab: 'general' };
    // Entity names: number, prefixes, abbreviations, length.
    const prefix = e.entity_type === 'reference' ? std.reference_prefix : std.entity_prefix;
    if (prefix && !e.name.startsWith(prefix)) push('warning', 'std.prefix', `${e.display_name}: ${e.entity_type} entity names start with "${prefix}".`, te, renameEntity(e.name, `${prefix}${e.name}`));
    const last = e.name.split('_').pop()!;
    if (std.entity_number === 'singular' && singularize(last) !== last) push('warning', 'std.number', `${e.display_name}: entity names are singular (${e.name} → ${withLast(e.name, singularize)}).`, te, renameEntity(e.name, withLast(e.name, singularize)));
    if (std.entity_number === 'plural' && singularize(last) === last && !/s$/.test(last)) push('warning', 'std.number', `${e.display_name}: entity names are plural (${e.name} → ${withLast(e.name, pluralize)}).`, te, renameEntity(e.name, withLast(e.name, pluralize)));
    if (std.abbreviations === 'expand' && e.name.split('_').some((w) => ABBREVIATIONS[w])) push('warning', 'std.abbrev', `${e.display_name}: spell out abbreviations (${e.name} → ${expandWords(e.name)}).`, te, renameEntity(e.name, expandWords(e.name)));
    if (std.max_length && e.name.length > std.max_length) push('warning', 'std.length', `${e.display_name}: name is ${e.name.length} characters; the limit is ${std.max_length}.`, te);
    if (std.require_entity_description && !e.description?.trim()) push('warning', 'std.entity_desc', `${e.display_name}: needs a description.`, te);

    // Attributes.
    const attrNames = new Set(e.attributes.map((a) => a.name.toLowerCase()));
    const renameAttr = (from: string, to: string): Op[] | undefined =>
      to !== from && /^[A-Za-z][A-Za-z0-9_]*$/.test(to) && (!attrNames.has(to.toLowerCase()) || to.toLowerCase() === from.toLowerCase()) ? [{ op: 'rename_attribute', entity: e.name, attribute: from, to }] : undefined;
    for (const a of e.attributes) {
      const ta = { kind: 'entity' as const, name: e.name, tab: 'attributes', attribute: a.name };
      // One rename covers both case and abbreviations, so fixing never takes two rounds.
      const cased = std.attribute_case ? toCase(a.name, std.attribute_case) : a.name;
      const abbrev = std.abbreviations === 'expand' && words(a.name).some((w) => ABBREVIATIONS[w]);
      const want = abbrev ? toCase(expandWords(words(a.name).join('_')), std.attribute_case || (a.name === a.name.toUpperCase() ? 'upper_snake' : 'snake')) : cased;
      if (want !== a.name) {
        const why = cased !== a.name ? `attribute names use ${std.attribute_case!.replace('_', ' ')} case` : 'spell out abbreviations';
        push('warning', cased !== a.name ? 'std.case' : 'std.abbrev', `${e.display_name}.${a.name}: ${why} (${want}).`, ta, renameAttr(a.name, want));
      }
      if (std.max_length && a.name.length > std.max_length) push('warning', 'std.length', `${e.display_name}.${a.name}: name is ${a.name.length} characters; the limit is ${std.max_length}.`, ta);
      if (std.require_attribute_description && !a.description?.trim() && !a.is_primary_key) push('info', 'std.attr_desc', `${e.display_name}.${a.name}: needs a description.`, ta);
      if (std.require_pii_review && !a.pii && looksPersonal(a.name)) push('warning', 'std.pii', `${e.display_name}.${a.name}: looks like personal data; mark it PII (or rename it if it isn't).`, ta, [{ op: 'update_attribute', entity: e.name, attribute: a.name, set: { pii: true } }]);
    }
    const pk = e.attributes.filter((a) => a.is_primary_key);
    if (std.pk_suffix && e.entity_type === 'standard' && pk.length === 1 && !pk[0].name.endsWith(std.pk_suffix))
      push('warning', 'std.pk', `${e.display_name}: primary key ${pk[0].name} ends with "${std.pk_suffix}".`, { kind: 'entity', name: e.name, tab: 'attributes', attribute: pk[0].name }, renameAttr(pk[0].name, `${e.name}${std.pk_suffix}`));
  }
  return issues;
}

/**
 * Apply the fixes of many issues in one go (mutates `doc`, which may be an immer draft). Fixes that no longer
 * apply after an earlier one (e.g. two renames to the same name) are skipped. Returns how many were applied.
 */
export function applyFixes(doc: DataModel, issues: Issue[], tab: string): { applied: number; skipped: number; ops: Op[] } {
  const fixes = issues.filter((i) => i.fix?.length);
  // Single renames are checked here and applied together in two passes; one cascade per rename is quadratic
  // on big models. Anything else goes through applyBatches one fix at a time.
  const isRename = (i: Issue) => i.fix!.length === 1 && (i.fix![0].op === 'rename_attribute' || i.fix![0].op === 'rename_entity') && (i.fix![0].tab === undefined || i.fix![0].tab === tab);
  const other = fixes.filter((i) => !isRename(i));
  const res = applyBatches(doc, other.map((i) => i.fix!), tab);
  const ops = [...res.ops];
  let { applied, skipped } = res;

  const view = tabView(doc, tab);
  const entityNames = new Set(view.entities.map((e) => e.name));
  const attrNames = new Map(view.entities.map((e) => [e.name, new Set(e.attributes.map((a) => a.name.toLowerCase()))]));
  const attrRenames = new Map<string, Map<string, string>>();
  const entityRenames = new Map<string, string>();
  for (const i of fixes.filter(isRename)) {
    const op = i.fix![0];
    if (op.op === 'rename_attribute') {
      const names = attrNames.get(op.entity);
      const map = attrRenames.get(op.entity) || new Map<string, string>();
      const ok = names?.has(op.attribute.toLowerCase()) && !map.has(op.attribute) && ATTR_RE.test(op.to) && (op.to.toLowerCase() === op.attribute.toLowerCase() || !names.has(op.to.toLowerCase()));
      if (!ok) {
        skipped++;
        continue;
      }
      names!.delete(op.attribute.toLowerCase());
      names!.add(op.to.toLowerCase());
      map.set(op.attribute, op.to);
      attrRenames.set(op.entity, map);
    } else if (op.op === 'rename_entity') {
      if (!entityNames.has(op.entity) || entityRenames.has(op.entity) || !NAME_RE.test(op.to) || entityNames.has(op.to)) {
        skipped++;
        continue;
      }
      entityNames.delete(op.entity);
      entityNames.add(op.to);
      entityRenames.set(op.entity, op.to);
    }
    ops.push({ ...op, tab: op.tab ?? tab });
    applied++;
  }
  if (attrRenames.size || entityRenames.size)
    withTab(doc, tab, (v) => {
      renameAttributes(v, attrRenames);
      renameEntities(v, entityRenames);
    });
  // Report attribute renames before entity renames: replayed in order, every op then names things as they are.
  ops.sort((a, b) => (a.op === 'rename_entity' ? 1 : 0) - (b.op === 'rename_entity' ? 1 : 0));
  return { applied, skipped, ops };
}
