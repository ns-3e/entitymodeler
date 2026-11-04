import { ArrowRight, Copy, EyeOff, Focus, LayoutGrid, Link2, Network, Plus, SquareStack, StickyNote, Trash2, Layers } from '../icons';
import {
  AREA_COLORS,
  ENTITY_COLORS,
  NOTE_COLORS,
  listTabs,
  deleteRelationship,
  inferForeignKey,
  primaryKey,
  relationshipEnds,
  renameRelationship,
  type Cardinality,
  type Hierarchy,
  type HierarchyBranch,
} from '../../core';
import { useStore } from '../store';
import { ColorSwatches, CommitInput, Field, NumberInput, Segmented, Select, TextArea, TextInput, Toggle } from '../components/forms';
import { EntityInspector } from './EntityInspector';
import { StandardsSection } from './StandardsSection';
import { RelationshipAttributes } from './RelationshipAttributes';
import { CommentsSection } from '../components/Comments';
import { arrangeSelection, copySelection, copyToTab, deleteSelection, idsByKind, isolate, setColor, setHidden } from '../components/actions';

export function Inspector() {
  const sel = useStore((s) => s.selection);
  const model = useStore((s) => s.model)!;
  const width = useStore((s) => s.display.inspectorWidth);
  const multi = useStore((s) => s.multi);
  let body: React.ReactNode = <ModelInspector />;
  if (multi.length > 1) body = <MultiInspector />;
  else if (sel.kind === 'entity') {
    const e = model.entities.find((x) => x.name === sel.name);
    if (e) body = <EntityInspector key={e.name} entity={e} tab={sel.tab} attribute={sel.attribute} />;
  } else if (sel.kind === 'relationship') {
    const r = model.relationships.find((x) => x.name === sel.name);
    if (r) body = <RelationshipInspector key={r.name} name={r.name} />;
  } else if (sel.kind === 'hierarchy') {
    const h = model.hierarchies.find((x) => x.name === sel.name);
    if (h) body = <HierarchyInspector key={h.name} h={h} />;
  } else if (sel.kind === 'area') {
    if (model.areas.some((a) => a.id === sel.id)) body = <AreaInspector key={sel.id} id={sel.id} />;
  } else if (sel.kind === 'note') {
    if (model.notes.some((a) => a.id === sel.id)) body = <NoteInspector id={sel.id} />;
  }
  return <aside className="inspector" style={{ width }}>{body}</aside>;
}

function Head({ icon, title, sub, actions }: { icon: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="insp-head plain">
      <div className="insp-icon">{icon}</div>
      <div className="insp-titles">
        <div className="insp-title">{title}</div>
        {sub && <div className="insp-sub">{sub}</div>}
      </div>
      {actions && <div className="insp-actions">{actions}</div>}
    </div>
  );
}

function MultiInspector() {
  const m = useStore((s) => s.model)!;
  const doc = useStore((s) => s.doc)!;
  const activeTab = useStore((s) => s.activeTab);
  const multi = useStore((s) => s.multi);
  const ids = idsByKind(multi);
  const names = ids.entity;
  const tabs = listTabs(doc).filter((t) => t.id !== activeTab);
  const attrs = m.entities.filter((e) => names.includes(e.name)).reduce((n, e) => n + e.attributes.length, 0);
  return (
    <>
      <Head icon={<SquareStack size={18} />} title={`${multi.length} items selected`} sub={[names.length && `${names.length} entities`, ids.area.length && `${ids.area.length} areas`, ids.note.length && `${ids.note.length} notes`].filter(Boolean).join(' · ')} />
      <div className="insp-body stack">
        {names.length > 0 && (
          <>
            <div className="stats">
              <div>
                <b>{names.length}</b>
                <span>Entities</span>
              </div>
              <div>
                <b>{attrs}</b>
                <span>Attributes</span>
              </div>
              <div>
                <b>{m.relationships.filter((r) => names.includes(r.source) && names.includes(r.target)).length}</b>
                <span>Links within</span>
              </div>
            </div>
            <div className="btn-grid">
              <button className="btn sm" onClick={() => setHidden(names, true)} title="H">
                <EyeOff size={14} /> Hide
              </button>
              <button className="btn sm" onClick={() => isolate(names)}>
                <Focus size={14} /> Show only these
              </button>
              <button className="btn sm" onClick={() => arrangeSelection(names)}>
                <LayoutGrid size={14} /> Arrange
              </button>
              <button className="btn sm" onClick={copySelection} title="⌘C, then ⌘V in any tab">
                <Copy size={14} /> Copy
              </button>
            </div>
            {tabs.length > 0 && (
              <Field label="Copy to tab">
                <Select value="" placeholder="Choose a tab…" onChange={(v) => copyToTab(names, v)} options={tabs.map((t) => ({ value: t.id, label: `${t.name} (${t.kind})` }))} />
              </Field>
            )}
            <Field label="Color">
              <ColorSwatches value="#000000" onChange={(c) => setColor(names, c)} colors={ENTITY_COLORS} />
            </Field>
            <div className="section-title">
              <span>Selected entities</span>
            </div>
            <div className="multi-list">
              {m.entities
                .filter((e) => names.includes(e.name))
                .map((e) => (
                  <span key={e.name} className="chip">
                    <i className="dot" style={{ background: e.color_code }} />
                    {e.display_name}
                  </span>
                ))}
            </div>
          </>
        )}
        <button className="btn danger" onClick={deleteSelection} title="Delete / Backspace">
          <Trash2 size={14} /> Delete {multi.length} items
        </button>
        <p className="muted small">Drag on empty canvas to box-select; Shift-click to add or remove. Right-click the selection for more.</p>
      </div>
    </>
  );
}

function ModelInspector() {
  const m = useStore((s) => s.model)!;
  const update = useStore((s) => s.update);
  const counts = {
    standard: m.entities.filter((e) => e.entity_type === 'standard').length,
    reference: m.entities.filter((e) => e.entity_type === 'reference').length,
    attrs: m.entities.reduce((n, e) => n + e.attributes.length, 0),
  };
  return (
    <>
      <Head icon={<Layers size={18} />} title="Model properties" sub={<span className="mono">{m.name}</span>} />
      <div className="insp-body stack">
        <div className="stats">
          <div>
            <b>{counts.standard}</b>
            <span>Entities</span>
          </div>
          <div>
            <b>{counts.reference}</b>
            <span>Reference</span>
          </div>
          <div>
            <b>{m.relationships.length}</b>
            <span>Relationships</span>
          </div>
          <div>
            <b>{counts.attrs}</b>
            <span>Attributes</span>
          </div>
        </div>
        <Field label="Title">
          <TextInput value={m.title} onChange={(v) => update((d) => void (d.title = v), 'm:title')} />
        </Field>
        <div className="grid2">
          <Field label="Organization">
            <TextInput value={m.organization} onChange={(v) => update((d) => void (d.organization = v), 'm:org')} />
          </Field>
          <Field label="Version">
            <TextInput value={m.version} onChange={(v) => update((d) => void (d.version = v), 'm:version')} />
          </Field>
        </div>
        <div className="grid2">
          <Field label="Author">
            <TextInput value={m.author} onChange={(v) => update((d) => void (d.author = v), 'm:author')} />
          </Field>
          <Field label="Status">
            <Select value={m.status || 'draft'} onChange={(v) => update((d) => void (d.status = v))} options={['draft', 'in review', 'approved']} />
          </Field>
        </div>
        <Field label="Description">
          <TextArea rows={4} value={m.description} onChange={(v) => update((d) => void (d.description = v), 'm:desc')} placeholder="Scope and purpose of this data model — used in the design doc and diagram title block." />
        </Field>
        <StandardsSection />
        <CommentsSection target={{ kind: 'model' }} />
        <p className="muted small">Select an entity, relationship or area on the canvas to edit it.</p>
      </div>
    </>
  );
}

function RelationshipInspector({ name }: { name: string }) {
  const m = useStore((s) => s.model)!;
  const { update, select } = useStore.getState();
  const r = m.relationships.find((x) => x.name === name)!;
  const entities = m.entities;
  const set = (fn: (x: typeof r) => void, key?: string) =>
    update((d) => {
      const x = d.relationships.find((y) => y.name === name);
      if (x) fn(x);
    }, key && `rel:${name}:${key}`);
  const ent = (n: string) => m.entities.find((e) => e.name === n);
  return (
    <>
      <Head
        icon={<Link2 size={18} />}
        title={r.forward_label || r.name}
        sub={<span className="mono">{r.name}</span>}
        actions={
          <button
            className="icon-btn danger"
            title="Delete relationship"
            onClick={() => {
              if (!window.confirm(`Delete relationship ${r.name}?`)) return;
              update((d) => deleteRelationship(d, name));
              select({ kind: 'model' });
            }}
          >
            <Trash2 size={16} />
          </button>
        }
      />
      <div className="insp-body stack">
        <div className="rel-hero">
          <button className="rel-end" style={{ ['--c' as any]: ent(r.source)?.color_code }} onClick={() => select({ kind: 'entity', name: r.source })}>
            {ent(r.source)?.display_name || r.source}
          </button>
          <div className="rel-mid">
            <span>{r.forward_label}</span>
            <ArrowRight size={14} />
            <b>{r.cardinality}</b>
            {r.bidirectional && <span className="muted">{r.reverse_label}</span>}
          </div>
          <button className="rel-end" style={{ ['--c' as any]: ent(r.target)?.color_code }} onClick={() => select({ kind: 'entity', name: r.target })}>
            {ent(r.target)?.display_name || r.target}
          </button>
        </div>
        <Field label="Relationship name" hint="Lowercase letters, digits and underscores.">
          <CommitInput
            mono
            value={r.name}
            transform={(v) => v.toLowerCase().replace(/[^a-z0-9_]+/g, '_')}
            validate={(v) => (!/^[a-z][a-z0-9_]*$/.test(v) ? 'Invalid name' : m.relationships.some((x) => x.name === v) ? 'Name in use' : null)}
            onCommit={(v) => {
              update((d) => renameRelationship(d, name, v));
              select({ kind: 'relationship', name: v });
            }}
          />
        </Field>
        <div className="grid2">
          <Field label="Source entity">
            <Select value={r.source} onChange={(v) => set((x) => void (x.source = v))} options={entities.map((e) => ({ value: e.name, label: e.display_name }))} />
          </Field>
          <Field label="Target entity">
            <Select value={r.target} onChange={(v) => set((x) => void (x.target = v))} options={entities.map((e) => ({ value: e.name, label: e.display_name }))} />
          </Field>
        </div>
        <Field label="Cardinality" hint="1:N = each source has many targets.">
          <Segmented<Cardinality>
            value={r.cardinality}
            onChange={(v) => set((x) => void (x.cardinality = v))}
            options={(['1:1', '1:N', 'N:1', 'N:N'] as Cardinality[]).map((c) => ({ value: c, label: c }))}
          />
        </Field>
        <ForeignKeyField name={name} />
        <div className="grid2">
          <Field label="Forward label">
            <TextInput value={r.forward_label} onChange={(v) => set((x) => void (x.forward_label = v), 'fwd')} placeholder="Subsidiary Of" />
          </Field>
          <Field label="Reverse label">
            <TextInput value={r.reverse_label} onChange={(v) => set((x) => void (x.reverse_label = v), 'rev')} placeholder="Parent Of" />
          </Field>
        </div>
        <Toggle checked={r.bidirectional} onChange={(v) => set((x) => void (x.bidirectional = v))} label="Bidirectional (enable reverse label)" />
        <Field label="Description">
          <TextArea rows={2} value={r.description} onChange={(v) => set((x) => void (x.description = v), 'desc')} />
        </Field>
        <RelationshipAttributes r={r} />
        <CommentsSection target={{ kind: 'relationship', name: r.name }} />
      </div>
    </>
  );
}

function HierarchyInspector({ h }: { h: Hierarchy }) {
  const m = useStore((s) => s.model)!;
  const { update, select, setDisplay } = useStore.getState();
  const focus = useStore((s) => s.display.focusHierarchy);
  const set = (fn: (x: Hierarchy) => void, key?: string) =>
    update((d) => {
      const x = d.hierarchies.find((y) => y.name === h.name);
      if (x) fn(x);
    }, key && `hier:${h.name}:${key}`);
  const roots = m.entities;
  const levels = [...h.levels].sort((a, b) => a.level - b.level);
  const rootBranch = h.root_branch_name || 'Root';
  const branchesAt = (level: number) => (level === 1 ? [{ name: rootBranch, entity: h.root }] : levels.find((l) => l.level === level)?.branches || []);
  // relationships that connect a candidate child to the parent branch entity
  const relOptions = (parentEntity: string) =>
    m.relationships.filter((r) => r.source === parentEntity || r.target === parentEntity).map((r) => ({ value: r.name, label: `${r.name} (${r.source} → ${r.target})` }));
  const deriveBranch = (b: HierarchyBranch, parentEntity: string): HierarchyBranch => {
    const r = m.relationships.find((x) => x.name === b.relationship);
    if (!r) return b;
    // forward: edge source is child, destination is parent
    if (r.target === parentEntity && r.source !== parentEntity) return { ...b, direction: 'forward', entity: r.source };
    if (r.source === parentEntity && r.target !== parentEntity) return { ...b, direction: 'reverse', entity: r.target };
    return { ...b, entity: parentEntity };
  };

  return (
    <>
      <Head
        icon={<Network size={18} />}
        title={h.display_name}
        sub={<span className="mono">{h.name}</span>}
        actions={
          <button
            className="icon-btn danger"
            onClick={() => {
              if (!window.confirm(`Delete hierarchy ${h.display_name}?`)) return;
              update((d) => void (d.hierarchies = d.hierarchies.filter((x) => x.name !== h.name)));
              select({ kind: 'model' });
            }}
          >
            <Trash2 size={16} />
          </button>
        }
      />
      <div className="insp-body stack">
        <Toggle checked={focus === h.name} onChange={(v) => setDisplay({ focusHierarchy: v ? h.name : null })} label="Highlight on diagram" />
        <div className="grid2">
          <Field label="Display name">
            <TextInput value={h.display_name} onChange={(v) => set((x) => void (x.display_name = v), 'dn')} />
          </Field>
          <Field label="Status">
            <Select value={h.status} onChange={(v) => set((x) => void (x.status = v))} options={['draft', 'active', 'retired']} />
          </Field>
        </div>
        <Field label="Root entity (Level 1)">
          <Select value={h.root} onChange={(v) => set((x) => void (x.root = v))} options={roots.map((e) => ({ value: e.name, label: e.display_name }))} />
        </Field>
        <Field label="Description">
          <TextArea rows={2} value={h.description} onChange={(v) => set((x) => void (x.description = v), 'desc')} />
        </Field>
        <div className="grid2">
          <Field label="Max depth">
            <NumberInput step={1} min={1} value={h.max_depth ?? null} onChange={(v) => set((x) => void (x.max_depth = Math.round(v)))} />
          </Field>
          <Field label="Multi-parent">
            <Toggle checked={h.allow_multi_parent} onChange={(v) => set((x) => void (x.allow_multi_parent = v))} label="Allow" />
          </Field>
        </div>
        <div className="section-title">
          <span>Levels &amp; branches</span>
          <button className="btn xs" onClick={() => set((x) => void x.levels.push({ level: x.levels.length + 2, branches: [] }))}>
            <Plus size={12} /> Level
          </button>
        </div>
        <div className="level root">
          <span className="lvl">L1</span>
          <b>{rootBranch}</b> <span className="muted">· {h.root}</span>
        </div>
        {levels.map((l) => (
          <div className="level" key={l.level}>
            <div className="level-head">
              <span className="lvl">L{l.level}</span>
              <span className="spacer" />
              <button
                className="btn xs ghost"
                onClick={() =>
                  set((x) => {
                    const lv = x.levels.find((y) => y.level === l.level)!;
                    const parentBranch = branchesAt(l.level - 1)[0];
                    lv.branches.push({ name: `Branch ${lv.branches.length + 1}`, entity: parentBranch?.entity || h.root, relationship: '', direction: 'forward', parent_branch: parentBranch?.name || rootBranch });
                  })
                }
              >
                <Plus size={12} /> Branch
              </button>
              {l.level === levels[levels.length - 1].level && (
                <button className="icon-btn xs danger" onClick={() => set((x) => void (x.levels = x.levels.filter((y) => y.level !== l.level)))}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            {l.branches.map((b, bi) => {
              const parents = branchesAt(l.level - 1);
              const parentEntity = parents.find((p) => p.name === b.parent_branch)?.entity || h.root;
              const setB = (fn: (x: HierarchyBranch) => void, key?: string) => set((x) => fn(x.levels.find((y) => y.level === l.level)!.branches[bi]), key && `b${l.level}.${bi}${key}`);
              return (
                <div className="branch" key={bi}>
                  <TextInput value={b.name} onChange={(v) => setB((x) => void (x.name = v), 'n')} />
                  <Select value={b.parent_branch} onChange={(v) => setB((x) => void (x.parent_branch = v))} options={parents.map((p) => ({ value: p.name, label: `under ${p.name}` }))} />
                  <Select
                    value={b.relationship}
                    placeholder="relationship"
                    onChange={(v) => setB((x) => Object.assign(x, deriveBranch({ ...x, relationship: v }, parentEntity)))}
                    options={relOptions(parentEntity)}
                  />
                  <div className="branch-meta">
                    <span className="mono">{b.entity}</span>
                    <Select
                      value={b.direction}
                      onChange={(v) => setB((x) => void (x.direction = v))}
                      options={[
                        { value: 'forward', label: 'forward' },
                        { value: 'reverse', label: 'reverse' },
                      ]}
                    />
                    <button className="icon-btn xs danger" onClick={() => set((x) => void x.levels.find((y) => y.level === l.level)!.branches.splice(bi, 1))}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function AreaInspector({ id }: { id: string }) {
  const m = useStore((s) => s.model)!;
  const { update, select } = useStore.getState();
  const a = m.areas.find((x) => x.id === id)!;
  const set = (fn: (x: typeof a) => void, key?: string) =>
    update((d) => {
      const x = d.areas.find((y) => y.id === id);
      if (x) fn(x);
    }, key && `area:${id}:${key}`);
  return (
    <>
      <Head
        icon={<Layers size={18} />}
        title={a.name}
        sub="Subject area"
        actions={
          <button
            className="icon-btn danger"
            onClick={() => {
              update((d) => {
                d.areas = d.areas.filter((x) => x.id !== id);
                for (const e of d.entities) if (e.area === a.name) e.area = undefined;
              });
              select({ kind: 'model' });
            }}
          >
            <Trash2 size={16} />
          </button>
        }
      />
      <div className="insp-body stack">
        <Field label="Name">
          <CommitInput
            value={a.name}
            onCommit={(v) =>
              update((d) => {
                const x = d.areas.find((y) => y.id === id)!;
                for (const e of d.entities) if (e.area === x.name) e.area = v;
                x.name = v;
              })
            }
          />
        </Field>
        <Field label="Description">
          <TextArea rows={3} value={a.description} onChange={(v) => set((x) => void (x.description = v), 'desc')} />
        </Field>
        <Field label="Color">
          <ColorSwatches value={a.color} colors={AREA_COLORS} onChange={(c) => set((x) => void (x.color = c), 'color')} />
        </Field>
        <p className="muted small">Drag the area to move everything inside it. Entities dropped inside join the area.</p>
      </div>
    </>
  );
}

function NoteInspector({ id }: { id: string }) {
  const m = useStore((s) => s.model)!;
  const { update, select } = useStore.getState();
  const n = m.notes.find((x) => x.id === id)!;
  const set = (fn: (x: typeof n) => void, key?: string) =>
    update((d) => {
      const x = d.notes.find((y) => y.id === id);
      if (x) fn(x);
    }, key && `note:${id}:${key}`);
  return (
    <>
      <Head
        icon={<StickyNote size={18} />}
        title="Note"
        actions={
          <button
            className="icon-btn danger"
            onClick={() => {
              update((d) => void (d.notes = d.notes.filter((x) => x.id !== id)));
              select({ kind: 'model' });
            }}
          >
            <Trash2 size={16} />
          </button>
        }
      />
      <div className="insp-body stack">
        <TextArea rows={8} value={n.text} onChange={(v) => set((x) => void (x.text = v), 'text')} />
        <Field label="Color">
          <ColorSwatches value={n.color || NOTE_COLORS[0]} colors={NOTE_COLORS} onChange={(c) => set((x) => void (x.color = c))} />
        </Field>
        <Field label="Width">
          <NumberInput step={10} min={140} value={n.w || 220} onChange={(v) => set((x) => void (x.w = v), 'w')} />
        </Field>
      </div>
    </>
  );
}

/** Which child attribute holds the parent's key — drives the SQL/DBML export. */
function ForeignKeyField({ name }: { name: string }) {
  const m = useStore((s) => s.model)!;
  const update = useStore((s) => s.update);
  const r = m.relationships.find((x) => x.name === name)!;
  const ends = relationshipEnds(r);
  if (!ends) return <p className="muted small">N:N relationships export as a junction table holding both keys.</p>;
  const child = m.entities.find((e) => e.name === ends.child);
  const parent = m.entities.find((e) => e.name === ends.parent);
  const pk = parent && primaryKey(parent);
  const inferred = inferForeignKey(m, { ...r, foreign_key: undefined });
  const auto = inferred ? `Auto — ${inferred}` : `None — export adds ${pk ? pk.name : 'a key column'}`;
  return (
    <Field label={`Foreign key on ${child?.display_name || ends.child}`} hint={`Column holding ${parent?.display_name || ends.parent}'s key. Used for SQL and DBML export.`}>
      <Select
        mono
        value={r.foreign_key || ''}
        onChange={(v) =>
          update((d) => {
            const x = d.relationships.find((y) => y.name === name);
            if (!x) return;
            if (v) x.foreign_key = v;
            else delete x.foreign_key;
          })
        }
        options={[{ value: '', label: auto }, ...(child?.attributes || []).filter((a) => a.type !== 'STRUCT' && !a.is_array).map((a) => ({ value: a.name, label: a.name }))]}
      />
    </Field>
  );
}
