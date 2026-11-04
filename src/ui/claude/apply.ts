// Reading Claude's reply back into a model: find the JSON, normalize it, carry over layout, describe the change.
import { normalizeModel, validateModel, issueCounts, type DataModel } from '../../core';

/** The model JSON in a reply: the whole text, a ```json block, or the outermost {...}. */
export function extractModelJson(text: string): unknown {
  const t = text.trim();
  if (!t) throw new Error('Paste Claude’s reply or the model JSON.');
  const tries = [t];
  const fenced = [...t.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1]).sort((a, b) => b.length - a.length);
  tries.push(...fenced);
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last > first) tries.push(t.slice(first, last + 1));
  for (const s of tries) {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object' && Array.isArray((v as any).entities)) return v;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('No model JSON found. It should be a JSON object with an "entities" array, ideally in a ```json block.');
}

export interface Incoming {
  model: DataModel;
  /** Human-readable differences from the current model (empty for a new model). */
  changes: string[];
  issues: ReturnType<typeof issueCounts>;
}

/** Parse and normalize the reply; when updating, keep layout and identity from the current model. */
export function prepareIncoming(text: string, current?: DataModel): Incoming {
  const raw = extractModelJson(text) as any;
  const keepAreas = current && !Array.isArray(raw.areas);
  const keepNotes = current && !Array.isArray(raw.notes);
  const model = normalizeModel(raw);
  if (current) {
    const pos = new Map(current.entities.map((e) => [e.name, e.ui]));
    for (const e of model.entities) if (!e.ui && pos.get(e.name)) e.ui = pos.get(e.name);
    if (keepAreas) model.areas = current.areas;
    if (keepNotes) model.notes = current.notes;
    model.created_at = current.created_at;
  }
  model.updated_at = new Date().toISOString();
  return { model, changes: current ? describeChanges(current, model) : [], issues: issueCounts(validateModel(model)) };
}

function describeChanges(a: DataModel, b: DataModel): string[] {
  const out: string[] = [];
  const diff = (label: string, xs: string[], ys: string[]) => {
    const added = ys.filter((y) => !xs.includes(y));
    const removed = xs.filter((x) => !ys.includes(x));
    if (added.length) out.push(`Adds ${label}: ${added.join(', ')}`);
    if (removed.length) out.push(`Removes ${label}: ${removed.join(', ')}`);
  };
  diff('entities', a.entities.map((e) => e.name), b.entities.map((e) => e.name));
  const changed: string[] = [];
  for (const e of b.entities) {
    const before = a.entities.find((x) => x.name === e.name);
    if (!before) continue;
    const strip = (x: unknown) => JSON.stringify(x, (k, v) => (k === 'ui' ? undefined : v));
    if (strip(before) !== strip(e)) {
      const added = e.attributes.filter((x) => !before.attributes.some((y) => y.name === x.name)).length;
      const removed = before.attributes.filter((x) => !e.attributes.some((y) => y.name === x.name)).length;
      const detail = [added && `+${added} attr`, removed && `−${removed} attr`].filter(Boolean).join(', ');
      changed.push(detail ? `${e.name} (${detail})` : e.name);
    }
  }
  if (changed.length) out.push(`Changes entities: ${changed.join(', ')}`);
  diff('relationships', a.relationships.map((r) => r.name), b.relationships.map((r) => r.name));
  diff('hierarchies', a.hierarchies.map((h) => h.name), b.hierarchies.map((h) => h.name));
  if (a.title !== b.title || a.description !== b.description || a.organization !== b.organization || a.version !== b.version) out.push('Changes model details');
  if (!out.length) out.push('No changes to entities, relationships or hierarchies');
  return out;
}
