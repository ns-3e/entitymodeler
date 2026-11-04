// Typed model operations: small, describable edits that agents, proposals, standards fixes and sync all
// apply through. Renames and deletes cascade with the same functions the UI uses (ops.ts), so an operation
// can never leave a dangling reference that a hand edit of the JSON could.
import { createEntity, createRelationship, toLabel, uid } from './model';
import { deleteAttribute, deleteEntity, deleteRelationship, renameAttribute, renameEntity, renameRelationship } from './ops';
import { MAIN_TAB, addTab, deleteTab, listTabs, makePrimary, resolveTab, structuredCopy, tabView, updateTabMeta, withTab } from './tabs';
import { deriveTab } from './derive';
import type { Attribute, CommentTarget, DataModel, Entity, GlossaryTerm, Mapping, MappingEnd, ModelContent, ReferenceValue, Relationship, TabKind, TabMeta } from './types';

const NAME_RE = /^[a-z][a-z0-9_]*$/;
const ATTR_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

type ModelHeader = Partial<Pick<DataModel, 'title' | 'description' | 'organization' | 'version' | 'author' | 'status'>>;

/** One edit. `tab` (id or name) picks the tab; default is the call's tab, else the primary one. */
export type Op = { tab?: string } & (
  | { op: 'add_entity'; entity: Partial<Entity> & { name: string } }
  | { op: 'update_entity'; entity: string; set: Partial<Omit<Entity, 'name' | 'attributes'>> }
  | { op: 'rename_entity'; entity: string; to: string }
  | { op: 'delete_entity'; entity: string }
  | { op: 'add_attribute'; entity: string; attribute: Partial<Attribute> & { name: string }; after?: string }
  | { op: 'update_attribute'; entity: string; attribute: string; set: Partial<Omit<Attribute, 'name'>> }
  | { op: 'rename_attribute'; entity: string; attribute: string; to: string }
  | { op: 'delete_attribute'; entity: string; attribute: string }
  /** `after: null` moves it first. */
  | { op: 'move_attribute'; entity: string; attribute: string; after: string | null }
  | { op: 'add_relationship'; relationship: Partial<Relationship> & { source: string; target: string } }
  | { op: 'update_relationship'; relationship: string; set: Partial<Omit<Relationship, 'name'>> }
  | { op: 'rename_relationship'; relationship: string; to: string }
  | { op: 'delete_relationship'; relationship: string }
  | { op: 'set_reference_values'; entity: string; values: ReferenceValue[]; source?: string }
  | { op: 'add_note'; text: string; x?: number; y?: number }
  | { op: 'set_hidden'; entities: string[]; hidden: boolean }
  | { op: 'update_model'; set: ModelHeader }
  /**
   * New tab: blank, derived from `from` (kind decides the transformation), or with the given `content` (then
   * `from` only records lineage). Later ops can target it by name.
   */
  | { op: 'add_tab'; name: string; kind: TabKind; from?: string; dialect?: TabMeta['dialect']; description?: string; content?: ModelContent; source?: TabMeta['source'] }
  | { op: 'update_tab'; set: Partial<Omit<TabMeta, 'derived_from' | 'derived_at'>> }
  /** Make the op's tab the primary one (the old primary keeps its content as another tab). */
  | { op: 'make_primary' }
  /** Delete the op's tab (not the primary one; make another primary first). */
  | { op: 'delete_tab' }
  /** Create or replace the mapping for a target attribute (ends name tabs by id or name). */
  | { op: 'set_mapping'; target: MappingEnd & { attribute: string }; sources: MappingEnd[]; transform?: string; notes?: string; status?: Mapping['status'] }
  | { op: 'delete_mapping'; target: MappingEnd & { attribute: string } }
  /** Link an entity or attribute to a glossary term (carried into glossary_snapshot); null unlinks. */
  | { op: 'link_term'; entity: string; attribute?: string; term: GlossaryTerm | null }
  /** Review comments. `target.tab` defaults to the op's tab. */
  | { op: 'add_comment'; target: Omit<CommentTarget, 'tab'> & { tab?: string }; text: string; author: string }
  | { op: 'reply_comment'; id: string; text: string; author: string }
  | { op: 'resolve_comment'; id: string; resolved: boolean }
);

export type OpName = Op['op'];

export interface OpResult {
  op: Op;
  ok: boolean;
  error?: string;
  /** Name of what the op created (entity, relationship, tab id), when it differs from the input. */
  created?: string;
}

export class OpError extends Error {}

const fail = (msg: string): never => {
  throw new OpError(msg);
};

function entityOf(m: DataModel, name: string): Entity {
  return m.entities.find((e) => e.name === name) || fail(`Entity "${name}" not found.`);
}
function attributeOf(e: Entity, name: string): Attribute {
  return e.attributes.find((a) => a.name === name) || fail(`Attribute "${e.name}.${name}" not found.`);
}
function relationshipOf(m: DataModel, name: string): Relationship {
  return m.relationships.find((r) => r.name === name) || fail(`Relationship "${name}" not found.`);
}

/** Apply one op to a single-tab view (mutates). Returns the created name, if any. */
function applyToView(m: DataModel, op: Op): string | undefined {
  switch (op.op) {
    case 'add_entity': {
      const { name } = op.entity;
      if (!NAME_RE.test(name)) fail(`Entity name "${name}" must be lowercase letters, digits and underscores.`);
      if (m.entities.some((e) => e.name === name)) fail(`Entity "${name}" already exists.`);
      const type = op.entity.entity_type === 'reference' ? 'reference' : 'standard';
      // Defaults (color, key and label attributes) come from the same factory as the UI's "Add entity".
      const base = createEntity(m, op.entity.display_name || toLabel(name), type);
      const e: Entity = { ...base, ...structuredCopy(op.entity), name, entity_type: type };
      if (!op.entity.attributes) e.attributes = base.attributes.map((a) => ({ ...a, name: a.name.replace(base.name, name), label: toLabel(a.name.replace(base.name, name)) }));
      for (const a of e.attributes) a.label = a.label || toLabel(a.name);
      delete e.ui;
      m.entities.push(e);
      return;
    }
    case 'update_entity': {
      const e = entityOf(m, op.entity);
      const set = { ...op.set } as Partial<Entity>;
      delete set.name;
      delete set.attributes;
      Object.assign(e, structuredCopy(set));
      return;
    }
    case 'rename_entity': {
      entityOf(m, op.entity);
      if (!NAME_RE.test(op.to)) fail(`Entity name "${op.to}" must be lowercase letters, digits and underscores.`);
      if (op.to !== op.entity && m.entities.some((e) => e.name === op.to)) fail(`Entity "${op.to}" already exists.`);
      renameEntity(m, op.entity, op.to);
      return;
    }
    case 'delete_entity':
      entityOf(m, op.entity);
      deleteEntity(m, op.entity);
      return;
    case 'add_attribute': {
      const e = entityOf(m, op.entity);
      const { name } = op.attribute;
      if (!ATTR_RE.test(name)) fail(`Attribute name "${name}" is not valid.`);
      if (e.attributes.some((a) => a.name.toLowerCase() === name.toLowerCase())) fail(`Attribute "${e.name}.${name}" already exists.`);
      const a: Attribute = { type: 'STRING', ...structuredCopy(op.attribute), name, label: op.attribute.label || toLabel(name) };
      const at = op.after ? e.attributes.findIndex((x) => x.name === op.after) + 1 : e.attributes.length;
      if (op.after && at === 0) fail(`Attribute "${e.name}.${op.after}" not found.`);
      e.attributes.splice(at, 0, a);
      return;
    }
    case 'update_attribute': {
      const a = attributeOf(entityOf(m, op.entity), op.attribute);
      const set = { ...op.set } as Partial<Attribute>;
      delete set.name;
      Object.assign(a, structuredCopy(set));
      // Clear fields that no longer apply, so a type change can't leave a stale reference or struct.
      if (a.type !== 'REFERENCE_ENTITY') delete a.reference;
      if (a.type !== 'STRUCT') delete a.struct_type;
      return;
    }
    case 'rename_attribute': {
      const e = entityOf(m, op.entity);
      attributeOf(e, op.attribute);
      if (!ATTR_RE.test(op.to)) fail(`Attribute name "${op.to}" is not valid.`);
      if (op.to !== op.attribute && e.attributes.some((a) => a.name === op.to)) fail(`Attribute "${e.name}.${op.to}" already exists.`);
      renameAttribute(m, op.entity, op.attribute, op.to);
      return;
    }
    case 'delete_attribute':
      attributeOf(entityOf(m, op.entity), op.attribute);
      deleteAttribute(m, op.entity, op.attribute);
      return;
    case 'move_attribute': {
      const e = entityOf(m, op.entity);
      const a = attributeOf(e, op.attribute);
      e.attributes = e.attributes.filter((x) => x !== a);
      const at = op.after === null ? 0 : e.attributes.findIndex((x) => x.name === op.after) + 1;
      if (op.after !== null && at === 0) fail(`Attribute "${e.name}.${op.after}" not found.`);
      e.attributes.splice(at, 0, a);
      return;
    }
    case 'add_relationship': {
      const { source, target } = op.relationship;
      entityOf(m, source);
      entityOf(m, target);
      const r: Relationship = { ...createRelationship(m, source, target), ...structuredCopy(op.relationship) };
      if (!NAME_RE.test(r.name)) fail(`Relationship name "${r.name}" must be lowercase letters, digits and underscores.`);
      if (m.relationships.some((x) => x.name === r.name)) fail(`Relationship "${r.name}" already exists.`);
      m.relationships.push(r);
      return r.name;
    }
    case 'update_relationship': {
      const r = relationshipOf(m, op.relationship);
      const set = { ...op.set } as Partial<Relationship>;
      delete set.name;
      if (set.source) entityOf(m, set.source);
      if (set.target) entityOf(m, set.target);
      Object.assign(r, structuredCopy(set));
      return;
    }
    case 'rename_relationship':
      relationshipOf(m, op.relationship);
      if (!NAME_RE.test(op.to)) fail(`Relationship name "${op.to}" must be lowercase letters, digits and underscores.`);
      if (op.to !== op.relationship && m.relationships.some((r) => r.name === op.to)) fail(`Relationship "${op.to}" already exists.`);
      renameRelationship(m, op.relationship, op.to);
      return;
    case 'delete_relationship':
      relationshipOf(m, op.relationship);
      deleteRelationship(m, op.relationship);
      return;
    case 'set_reference_values': {
      const e = entityOf(m, op.entity);
      if (e.entity_type !== 'reference') fail(`"${e.name}" is not a reference entity.`);
      e.reference_values = op.values.map((v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x ?? '')])));
      if (op.source !== undefined) e.reference_values_source = op.source;
      return;
    }
    case 'add_note': {
      const id = uid('note');
      m.notes.push({ id, text: op.text, x: op.x ?? 0, y: op.y ?? -200, w: 240, color: '#FEF3C7' });
      return id;
    }
    case 'set_hidden':
      for (const n of op.entities) {
        const e = entityOf(m, n);
        if (!e.ui) continue;
        if (op.hidden) e.ui.hidden = true;
        else delete e.ui.hidden;
      }
      return;
    case 'update_model':
      for (const [k, v] of Object.entries(op.set)) if (['title', 'description', 'organization', 'version', 'author', 'status'].includes(k)) (m as any)[k] = v;
      return;
    case 'add_tab':
    case 'update_tab':
    case 'set_mapping':
    case 'delete_mapping':
    case 'make_primary':
    case 'delete_tab':
    case 'link_term':
    case 'add_comment':
    case 'reply_comment':
    case 'resolve_comment':
      return fail(`${op.op} applies to the whole model, not a tab.`);
  }
}

/**
 * Apply ops to a full model in place (works on immer drafts). Stops at the first failure and throws an
 * OpError naming the op; callers that need all-or-nothing use `applyOps`, which works on a copy.
 */
export function applyOpsInPlace(doc: DataModel, ops: Op[], opts: { tab?: string } = {}): OpResult[] {
  const results: OpResult[] = [];
  ops.forEach((op, i) => {
    try {
      if (op.op === 'add_tab') {
        if (!['conceptual', 'logical', 'physical', 'variant'].includes(op.kind)) fail(`Tab kind "${op.kind}" is not one of conceptual, logical, physical, variant.`);
        const from = op.from === undefined ? undefined : resolveTab(doc, op.from) || fail(`Tab "${op.from}" not found.`);
        if (listTabs(doc).some((t) => t.name.toLowerCase() === op.name.toLowerCase())) fail(`A tab named "${op.name}" already exists.`);
        const content = op.content ? structuredCopy(op.content) : from ? deriveTab(tabView(doc, from), op.kind, { physical: { dialect: op.dialect } }).content : undefined;
        const meta = { name: op.name, kind: op.kind, description: op.description, ...(op.dialect ? { dialect: op.dialect } : {}), ...(op.source ? { source: op.source } : {}) };
        const id = addTab(doc, { ...meta, ...(from ? { derived_from: from, derived_at: new Date().toISOString() } : {}) }, content);
        results.push({ op, ok: true, created: id });
        return;
      }
      const ref = op.tab ?? opts.tab;
      const tab = ref === undefined ? MAIN_TAB : resolveTab(doc, ref) || fail(`Tab "${ref}" not found.`);
      if (op.op === 'set_mapping' || op.op === 'delete_mapping') {
        const end = <E extends MappingEnd>(e: E): E => {
          const t = resolveTab(doc, e.tab) || fail(`Tab "${e.tab}" not found.`);
          const v = tabView(doc, t);
          const ent = v.entities.find((x) => x.name === e.entity) || fail(`Entity "${e.entity}" not found in tab ${e.tab}.`);
          if (e.attribute && !ent.attributes.some((a) => a.name === e.attribute)) fail(`Attribute "${e.entity}.${e.attribute}" not found in tab ${e.tab}.`);
          return { ...e, tab: t };
        };
        const target = end(op.target);
        const same = (x: Mapping) => x.target.tab === target.tab && x.target.entity === target.entity && x.target.attribute === target.attribute;
        const rest = (doc.mappings || []).filter((x) => !same(x));
        if (op.op === 'set_mapping') {
          const old = (doc.mappings || []).find(same);
          rest.push({ id: old?.id || uid('map'), target, sources: op.sources.map(end), ...(op.transform ? { transform: op.transform } : {}), ...(op.notes ? { notes: op.notes } : {}), status: op.status || 'draft' });
        }
        doc.mappings = rest;
        if (!doc.mappings.length) delete doc.mappings;
        results.push({ op, ok: true });
        return;
      }
      if (op.op === 'add_comment' || op.op === 'reply_comment' || op.op === 'resolve_comment') {
        const now = new Date().toISOString();
        doc.comments = doc.comments || [];
        if (op.op === 'add_comment') {
          if (!op.text.trim()) fail('Comment text is empty.');
          const t = op.target.tab ? resolveTab(doc, op.target.tab) || fail(`Tab "${op.target.tab}" not found.`) : tab;
          const c = { id: uid('c'), author: op.author, text: op.text, created_at: now, target: { ...op.target, tab: t } };
          doc.comments.push(c);
          results.push({ op, ok: true, created: c.id });
          return;
        }
        const c = doc.comments.find((x) => x.id === op.id) || fail(`Comment "${op.id}" not found.`);
        if (op.op === 'reply_comment') c.replies = [...(c.replies || []), { id: uid('r'), author: op.author, text: op.text, created_at: now }];
        else if (op.resolved) c.resolved = true;
        else delete c.resolved;
        results.push({ op, ok: true });
        return;
      }
      if (op.op === 'link_term') {
        withTab(doc, tab, (v) => {
          const e = entityOf(v, op.entity);
          const target = op.attribute ? attributeOf(e, op.attribute) : e;
          if (op.term) target.term = op.term.id;
          else delete target.term;
        });
        if (op.term) doc.glossary_snapshot = [...(doc.glossary_snapshot || []).filter((t) => t.id !== op.term!.id), structuredCopy(op.term)].sort((a, b) => a.name.localeCompare(b.name));
        results.push({ op, ok: true });
        return;
      }
      if (op.op === 'make_primary' || op.op === 'delete_tab') {
        if (op.op === 'make_primary') makePrimary(doc, tab);
        else if (tab === MAIN_TAB) fail('The primary tab cannot be deleted; make another tab primary first.');
        else deleteTab(doc, tab);
        results.push({ op, ok: true });
        return;
      }
      if (op.op === 'update_tab') {
        if (op.set.name && listTabs(doc).some((t) => t.id !== tab && t.name.toLowerCase() === op.set.name!.toLowerCase())) fail(`A tab named "${op.set.name}" already exists.`);
        updateTabMeta(doc, tab, structuredCopy(op.set));
        results.push({ op, ok: true });
        return;
      }
      let created: string | undefined;
      withTab(doc, tab, (v) => void (created = applyToView(v, op)));
      results.push({ op, ok: true, created });
    } catch (e: any) {
      throw new OpError(`Operation ${i + 1} (${describeOp(op)}) failed: ${e.message}`);
    }
  });
  return results;
}

/** All-or-nothing: returns a new model with every op applied, or the first error and the model unchanged. */
export function applyOps(doc: DataModel, ops: Op[], opts: { tab?: string } = {}): { doc: DataModel; ok: true; results: OpResult[] } | { doc: DataModel; ok: false; error: string } {
  const next = structuredCopy(doc);
  try {
    return { doc: next, ok: true, results: applyOpsInPlace(next, ops, opts) };
  } catch (e: any) {
    return { doc, ok: false, error: e.message };
  }
}

/**
 * Apply independent batches of ops (fixes, sync changes) in place; a batch that no longer applies after an
 * earlier one is skipped. Single-op batches check before changing anything; longer ones are tried on a copy
 * first so a failure can't leave them half-done. Returns the ops that were applied.
 */
export function applyBatches(doc: DataModel, batches: Op[][], tab: string): { applied: number; skipped: number; ops: Op[] } {
  const ops: Op[] = [];
  let applied = 0;
  let skipped = 0;
  for (const b of batches) {
    if (!b.length) continue;
    try {
      if (b.length > 1) applyOpsInPlace(structuredCopy(doc), b, { tab });
      applyOpsInPlace(doc, b, { tab });
      ops.push(...b.map((o) => ({ ...o, tab: o.tab ?? tab })));
      applied++;
    } catch {
      skipped++;
    }
  }
  return { applied, skipped, ops };
}

/** One line for review lists, e.g. "Rename attribute order.cust_id → customer_id". */
export function describeOp(op: Op): string {
  const where = op.tab ? ` (tab ${op.tab})` : '';
  const keys = (o: object) => Object.keys(o).join(', ');
  switch (op.op) {
    case 'add_entity':
      return `Add ${op.entity.entity_type === 'reference' ? 'reference list' : 'entity'} ${op.entity.name}${op.entity.attributes ? ` with ${op.entity.attributes.length} attributes` : ''}${where}`;
    case 'update_entity':
      return `Update ${op.entity}: ${keys(op.set)}${where}`;
    case 'rename_entity':
      return `Rename entity ${op.entity} → ${op.to}${where}`;
    case 'delete_entity':
      return `Delete entity ${op.entity}${where}`;
    case 'add_attribute':
      return `Add attribute ${op.entity}.${op.attribute.name} (${op.attribute.type || 'STRING'})${where}`;
    case 'update_attribute':
      return `Update ${op.entity}.${op.attribute}: ${Object.entries(op.set).map(([k, v]) => (typeof v === 'object' ? k : `${k} = ${v}`)).join(', ')}${where}`;
    case 'rename_attribute':
      return `Rename attribute ${op.entity}.${op.attribute} → ${op.to}${where}`;
    case 'delete_attribute':
      return `Delete attribute ${op.entity}.${op.attribute}${where}`;
    case 'move_attribute':
      return `Move ${op.entity}.${op.attribute} ${op.after === null ? 'to the top' : `after ${op.after}`}${where}`;
    case 'add_relationship':
      return `Add relationship ${op.relationship.name || `${op.relationship.source} → ${op.relationship.target}`} (${op.relationship.cardinality || 'N:1'})${where}`;
    case 'update_relationship':
      return `Update relationship ${op.relationship}: ${keys(op.set)}${where}`;
    case 'rename_relationship':
      return `Rename relationship ${op.relationship} → ${op.to}${where}`;
    case 'delete_relationship':
      return `Delete relationship ${op.relationship}${where}`;
    case 'set_reference_values':
      return `Set ${op.values.length} values on ${op.entity}${where}`;
    case 'add_note':
      return `Add note “${op.text.slice(0, 60)}${op.text.length > 60 ? '…' : ''}”${where}`;
    case 'set_hidden':
      return `${op.hidden ? 'Hide' : 'Show'} ${op.entities.join(', ')}${where}`;
    case 'update_model':
      return `Update model: ${keys(op.set)}`;
    case 'add_tab':
      return `Add ${op.kind} tab “${op.name}”${op.from ? ` derived from ${op.from}` : op.content ? ` with ${op.content.entities.length} entities` : ''}`;
    case 'update_tab':
      return `Update tab${op.tab ? ` ${op.tab}` : ''}: ${keys(op.set)}`;
    case 'make_primary':
      return `Make tab ${op.tab ?? '(current)'} the primary tab`;
    case 'delete_tab':
      return `Delete tab ${op.tab ?? '(current)'}`;
    case 'set_mapping':
      return `Map ${op.target.entity}.${op.target.attribute} ← ${op.sources.map((s) => `${s.entity}${s.attribute ? `.${s.attribute}` : ''}`).join(' + ') || 'nothing'}${op.transform ? ` as ${op.transform}` : ''}`;
    case 'delete_mapping':
      return `Remove mapping for ${op.target.entity}.${op.target.attribute}`;
    case 'link_term':
      return op.term ? `Link ${op.entity}${op.attribute ? `.${op.attribute}` : ''} to term “${op.term.name}”` : `Unlink ${op.entity}${op.attribute ? `.${op.attribute}` : ''} from its term`;
    case 'add_comment':
      return `Comment on ${op.target.name || 'the model'}${op.target.attribute ? `.${op.target.attribute}` : ''}: “${op.text.slice(0, 50)}${op.text.length > 50 ? '…' : ''}”`;
    case 'reply_comment':
      return `Reply to comment ${op.id}: “${op.text.slice(0, 50)}${op.text.length > 50 ? '…' : ''}”`;
    case 'resolve_comment':
      return `${op.resolved ? 'Resolve' : 'Reopen'} comment ${op.id}`;
  }
}

/** Ops that recreate `entity` from nothing (used by sync and by agents copying entities). */
export function entityOps(e: Entity, tab?: string): Op[] {
  const copy = structuredCopy(e);
  delete copy.ui;
  return [{ op: 'add_entity', entity: copy, ...(tab ? { tab } : {}) }];
}

/** A batch of operations an agent (or anyone) suggests, reviewed and accepted in the UI or CLI. */
export interface Proposal {
  id: string;
  title: string;
  rationale?: string;
  author: string;
  created_at: string;
  /** Default tab for ops without one. */
  tab?: string;
  /** sha1 of model.json when the proposal was made, to warn when the model has changed since. */
  base_hash?: string;
  ops: Op[];
}
