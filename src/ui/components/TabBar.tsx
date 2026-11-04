import { useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, ChevronDown, Copy, Crown, GitCompareArrows, Pencil, Plus, Sparkles, Trash2, Wand2 } from '../icons';
import {
  DEFAULT_LOGICAL,
  DEFAULT_PHYSICAL,
  MAIN_TAB,
  SQL_DIALECTS,
  TAB_KINDS,
  addTab,
  copyEntities,
  defaultTabName,
  deleteTab,
  deriveTab,
  diffCounts,
  diffTabs,
  diffToMarkdown,
  applySync,
  syncPlan,
  type SyncChange,
  type DataModel,
  emptyContent,
  listTabs,
  makePrimary,
  migrationSql,
  moveTab,
  nowIso,
  tabView,
  uniqueTabName,
  updateTabMeta,
  type LogicalOptions,
  type ModelContent,
  type PhysicalOptions,
  type SqlDialect,
  type TabInfo,
  type TabKind,
} from '../../core';
import { useStore } from '../store';
import { useDialogs } from '../dialogs';
import { downloadBlob } from '../download';
import { Field, Menu, Modal, Segmented, Select, TextInput, Toggle } from './forms';
import { DiffList } from './DiffList';

const KIND_SHORT: Record<TabKind, string> = { conceptual: 'C', logical: 'L', physical: 'P', variant: 'V' };

/** Entry point for the canvas menu: a new tab holding just these entities. */
export function newTabFromSelection(names: string[]) {
  useDialogs.getState().open({ newTab: { source: useStore.getState().activeTab, entities: names, kind: 'variant' } });
}

export function TabBar() {
  const doc = useStore((s) => s.doc)!;
  const active = useStore((s) => s.activeTab);
  const { setActiveTab, updateDoc, toast } = useStore.getState();
  const openDialog = useDialogs((s) => s.open);
  const tabs = listTabs(doc);
  const [editing, setEditing] = useState<string | null>(null);
  const drag = useRef<string | null>(null);

  const rename = (id: string, name: string) => {
    const n = name.trim();
    setEditing(null);
    if (!n || tabs.find((t) => t.id === id)?.name === n) return;
    if (tabs.some((t) => t.id !== id && t.name.toLowerCase() === n.toLowerCase())) return toast(`A tab named “${n}” already exists.`, 'error');
    updateDoc((d) => updateTabMeta(d, id, { name: n }));
  };

  const remove = (t: TabInfo) => {
    if (!window.confirm(`Delete tab “${t.name}” and its ${t.entities} entities? Other tabs are not affected. (Undo is available)`)) return;
    if (active === t.id) setActiveTab(MAIN_TAB);
    updateDoc((d) => deleteTab(d, t.id));
  };

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`dtab${t.id === active ? ' active' : ''} kind-${t.kind}`}
          title={`${TAB_KINDS.find((k) => k.id === t.kind)?.label} · ${t.entities} entities${t.derived_from ? ` · from “${tabs.find((x) => x.id === t.derived_from)?.name ?? t.derived_from}”` : ''}${t.id === MAIN_TAB ? ' · primary tab' : ''}`}
          onClick={() => setActiveTab(t.id)}
          onDoubleClick={() => setEditing(t.id)}
          draggable={t.id !== MAIN_TAB && editing !== t.id}
          onDragStart={() => (drag.current = t.id)}
          onDragOver={(e) => t.id !== MAIN_TAB && drag.current && e.preventDefault()}
          onDrop={() => {
            const from = drag.current;
            drag.current = null;
            if (from && from !== t.id) updateDoc((d) => moveTab(d, from, i - 1));
          }}
        >
          <span className="dtab-kind" aria-label={t.kind}>
            {KIND_SHORT[t.kind]}
          </span>
          {editing === t.id ? (
            <input
              className="dtab-input"
              autoFocus
              defaultValue={t.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => rename(t.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <span className="dtab-name">{t.name}</span>
          )}
          {t.id === MAIN_TAB && tabs.length > 1 && <Crown size={12} className="dtab-primary" />}
          {t.id === active && (
            <Menu
              trigger={() => (
                <button className="dtab-menu-btn" title="Tab actions">
                  <ChevronDown size={14} />
                </button>
              )}
            >
              {(close) => (
                <div className="menu-panel dtab-menu" onClick={(e) => e.stopPropagation()}>
                  <button className="menu-item" onClick={() => (close(), setEditing(t.id))}>
                    <Pencil size={14} /> Rename
                  </button>
                  <div className="menu-title">Kind</div>
                  <Segmented<TabKind> size="sm" value={t.kind} onChange={(k) => updateDoc((d) => updateTabMeta(d, t.id, { kind: k }))} options={TAB_KINDS.map((k) => ({ value: k.id, label: k.label, title: k.hint }))} />
                  <div className="menu-sep" />
                  <button className="menu-item" onClick={() => (close(), openDialog({ newTab: { source: t.id, kind: t.kind === 'physical' ? 'logical' : t.kind === 'logical' ? 'physical' : 'logical' } }))}>
                    <Wand2 size={14} /> Derive {t.kind === 'physical' ? 'logical' : t.kind === 'logical' ? 'physical' : 'a'} model…
                  </button>
                  <button className="menu-item" onClick={() => (close(), openDialog({ newTab: { source: t.id, kind: 'variant' } }))}>
                    <Copy size={14} /> Duplicate as variant…
                  </button>
                  <button className="menu-item" disabled={tabs.length < 2} title={tabs.length < 2 ? 'Add a second tab to compare with.' : undefined} onClick={() => (close(), openDialog({ compare: { a: t.derived_from || tabs.find((x) => x.id !== t.id)?.id, b: t.id } }))}>
                    <GitCompareArrows size={14} /> Compare with…
                  </button>
                  {t.derived_from && tabs.some((x) => x.id === t.derived_from) && (
                    <button className="menu-item" onClick={() => (close(), openDialog({ compare: { a: t.derived_from, b: t.id, sync: true } }))}>
                      <Wand2 size={14} /> Sync from “{tabs.find((x) => x.id === t.derived_from)?.name}”…
                    </button>
                  )}
                  {t.id !== MAIN_TAB && (
                    <>
                      <button
                        className="menu-item"
                        title="The primary tab is what single-tab tools (CLI without --tab, docs) use by default"
                        onClick={() => {
                          close();
                          updateDoc((d) => makePrimary(d, t.id));
                          useStore.getState().setActiveTab(MAIN_TAB);
                        }}
                      >
                        <Crown size={14} /> Make primary tab
                      </button>
                      <div className="menu-sep" />
                      <button className="menu-item danger" onClick={() => (close(), remove(t))}>
                        <Trash2 size={14} /> Delete tab
                      </button>
                    </>
                  )}
                </div>
              )}
            </Menu>
          )}
        </div>
      ))}
      <button className="dtab-add" title="New tab: blank, copy, or derive a logical/physical model" onClick={() => openDialog({ newTab: { source: active } })}>
        <Plus size={14} />
      </button>
      {tabs.length > 1 && (
        <button className="dtab-add labeled" title="Compare two tabs" onClick={() => openDialog({ compare: {} })}>
          <GitCompareArrows size={14} /> Compare
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- new tab

type Start = 'derive' | 'copy' | 'blank' | 'selection';

function suggestKind(source: TabKind): TabKind {
  return source === 'physical' ? 'logical' : source === 'logical' ? 'physical' : source === 'conceptual' ? 'logical' : 'logical';
}

export function NewTabDialog() {
  const req = useDialogs((s) => s.newTab)!;
  const close = () => useDialogs.getState().close('newTab');
  const doc = useStore((s) => s.doc)!;
  const tabs = listTabs(doc);
  const [source, setSource] = useState(req.source && tabs.some((t) => t.id === req.source) ? req.source : MAIN_TAB);
  const sourceKind = tabs.find((t) => t.id === source)!.kind;
  const [start, setStart] = useState<Start>(req.entities?.length ? 'selection' : req.kind === 'variant' ? 'copy' : req.source ? 'derive' : 'derive');
  const [kind, setKind] = useState<TabKind>(req.kind || suggestKind(sourceKind));
  const [name, setName] = useState('');
  const [logical, setLogical] = useState<LogicalOptions>(DEFAULT_LOGICAL);
  const [physical, setPhysical] = useState<PhysicalOptions>({ ...DEFAULT_PHYSICAL, dialect: 'postgres' });

  const result = useMemo((): { content: ModelContent; lines: string[] } => {
    const src = tabView(doc, source);
    if (start === 'blank') return { content: emptyContent(), lines: ['An empty canvas.'] };
    if (start === 'selection') {
      const target = { ...src, ...emptyContent() };
      const r = copyEntities(src, req.entities || [], target, { rename: false, lineage: true });
      return { content: target, lines: [`${r.added.length} selected entities, with the relationships between them.`] };
    }
    const r = deriveTab(src, start === 'copy' ? 'variant' : kind, { logical, physical });
    return { content: r.content, lines: r.report.lines };
  }, [doc, source, start, kind, logical, physical, req.entities]);

  const finalName = name.trim() || uniqueTabName(doc, start === 'copy' ? `${tabs.find((t) => t.id === source)!.name} copy` : defaultTabName(kind));
  const create = () => {
    let id = '';
    useStore.getState().updateDoc((d) => {
      id = addTab(
        d,
        {
          name: uniqueTabName(d, finalName),
          kind,
          ...(start !== 'blank' ? { derived_from: source, derived_at: nowIso() } : {}),
          ...(kind === 'physical' && physical.dialect ? { dialect: physical.dialect } : {}),
        },
        result.content,
      );
    });
    useStore.getState().setActiveTab(id);
    useStore.getState().toast(`Created tab “${finalName}”.`, 'success');
    close();
  };

  const opt = <K extends keyof LogicalOptions>(k: K, label: string, hint: string) => <Toggle checked={logical[k]} onChange={(v) => setLogical({ ...logical, [k]: v })} label={<span title={hint}>{label}</span>} />;
  const popt = <K extends keyof PhysicalOptions>(k: K, label: string) => <Toggle checked={!!physical[k]} onChange={(v) => setPhysical({ ...physical, [k]: v })} label={label} />;

  return (
    <Modal
      title={
        <>
          <Plus size={16} /> New tab
        </>
      }
      onClose={close}
      width={600}
      footer={
        <>
          <span className="muted small">Each tab has its own entities and layout. Tabs keep lineage, so you can compare them later.</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={create}>
            Create tab
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Start from">
          <Segmented<Start>
            value={start}
            onChange={(v) => {
              setStart(v);
              if (v === 'copy') setKind(sourceKind === 'conceptual' ? 'conceptual' : 'variant');
              if (v === 'derive') setKind(suggestKind(sourceKind));
            }}
            options={[
              { value: 'derive', label: <><Sparkles size={14} /> Derive</>, title: 'Transform another tab: physical → logical, logical → physical, → conceptual' },
              { value: 'copy', label: <><Copy size={14} /> Copy</>, title: 'An exact copy to change freely (a version or variant)' },
              ...(req.entities?.length ? [{ value: 'selection' as Start, label: `Selection (${req.entities.length})` }] : []),
              { value: 'blank', label: 'Blank' },
            ]}
          />
        </Field>
        <div className="grid2">
          {start !== 'blank' && (
            <Field label="Source tab">
              <Select
                value={source}
                onChange={(v) => {
                  setSource(v);
                  if (start === 'derive') setKind(suggestKind(tabs.find((t) => t.id === v)!.kind));
                }}
                options={tabs.map((t) => ({ value: t.id, label: `${t.name} (${t.kind}, ${t.entities})` }))}
              />
            </Field>
          )}
          <Field label={start === 'derive' ? 'Derive a' : 'Kind'}>
            <Select<TabKind> value={kind} onChange={setKind} options={TAB_KINDS.filter((k) => start !== 'derive' || k.id !== 'variant').map((k) => ({ value: k.id, label: k.label }))} />
          </Field>
        </div>
        <Field label="Tab name">
          <TextInput value={name} onChange={setName} placeholder={finalName} />
        </Field>
        {start === 'derive' && kind === 'logical' && (
          <div className="option-list">
            {opt('businessNames', 'Business names', 'tbl_cust_mstr → customer; cust_nm → customer_name')}
            {opt('dropTechnical', 'Drop audit, ETL and SCD columns', 'created_at, etl_batch_id, row_hash, is_current…')}
            {opt('dropForeignKeys', 'Relationships instead of foreign-key columns', 'FK columns covered by a relationship are removed')}
            {opt('collapseJunctions', 'Link tables become N:N relationships', 'Tables holding only two foreign keys')}
            {opt('detectReferences', 'Lookup tables become reference data', '*_status, *_type, lkp_* tables; their FKs become reference attributes')}
            {opt('inferRelationships', 'Infer missing relationships from key names', 'order.customer_id → customer')}
          </div>
        )}
        {start === 'derive' && kind === 'physical' && (
          <div className="option-list">
            <Field label="Target platform">
              <Select<SqlDialect> value={physical.dialect || 'postgres'} onChange={(v) => setPhysical({ ...physical, dialect: v })} options={SQL_DIALECTS.map((d) => ({ value: d.id, label: d.label }))} />
            </Field>
            {popt('addForeignKeys', 'Add foreign-key columns for relationships')}
            {popt('resolveManyToMany', 'Resolve N:N relationships into junction tables')}
            {popt('flattenStructs', 'Flatten structs into columns (for platforms without STRUCT)')}
            {popt('auditColumns', 'Add created_at / updated_at')}
          </div>
        )}
        <div className="derive-preview">
          <div className="menu-title">What you'll get</div>
          <ul>
            {result.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
            <li className="muted">
              {result.content.entities.length} entities · {result.content.relationships.length} relationships
            </li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- compare

export function CompareDialog() {
  const req = useDialogs((s) => s.compare)!;
  const close = () => useDialogs.getState().close('compare');
  const doc = useStore((s) => s.doc)!;
  const active = useStore((s) => s.activeTab);
  const tabs = listTabs(doc);
  const valid = (id?: string) => (id && tabs.some((t) => t.id === id) ? id : undefined);
  const activeTab = tabs.find((t) => t.id === active)!;
  const [b, setB] = useState(valid(req.b) || active);
  const [a, setA] = useState(valid(req.a) || valid(activeTab.derived_from) || tabs.find((t) => t.id !== (valid(req.b) || active))!.id);
  const [dialect, setDialect] = useState<SqlDialect>((tabs.find((t) => t.id === b)?.dialect as SqlDialect) || 'postgres');
  const tabB = tabs.find((t) => t.id === b)!;
  const canSync = tabB.derived_from === a;
  const [mode, setMode] = useState<'diff' | 'sql' | 'sync'>(req.sync && canSync ? 'sync' : 'diff');
  const diff = useMemo(() => diffTabs(doc, a, b), [doc, a, b]);
  const sql = useMemo(() => (mode === 'sql' ? migrationSql(doc, a, b, dialect) : ''), [mode, doc, a, b, dialect]);
  const plan = useMemo(() => (mode === 'sync' && canSync ? syncPlan(doc, a, b) : []), [mode, canSync, doc, a, b]);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [checkedOff, setCheckedOff] = useState<Set<string>>(new Set());
  const isOn = (c: SyncChange) => (c.suggested ? !unchecked.has(c.id) : checkedOff.has(c.id));
  const toggle = (c: SyncChange, on: boolean) => {
    const set = new Set(c.suggested ? unchecked : checkedOff);
    (c.suggested ? !on : on) ? set.add(c.id) : set.delete(c.id);
    c.suggested ? setUnchecked(set) : setCheckedOff(set);
  };
  const chosen = plan.filter(isOn);
  const c = diffCounts(diff);

  // Bring the chosen source changes over, transformed the way this tab was made (one undo step).
  const sync = () => {
    let res = { applied: 0, skipped: 0 };
    useStore.getState().updateDoc((d) => void (res = applySync(d as DataModel, chosen, b)));
    if (active === b && useStore.getState().model?.entities.some((e) => !e.ui)) useStore.getState().requestLayout();
    setUnchecked(new Set());
    setCheckedOff(new Set());
    useStore.getState().toast(`Synced ${res.applied} change${res.applied === 1 ? '' : 's'} into “${tabB.name}”${res.skipped ? `; ${res.skipped} no longer applied` : ''}. ⌘Z undoes it.`, 'success');
  };

  return (
    <Modal
      title={
        <>
          <GitCompareArrows size={16} /> Compare tabs
        </>
      }
      onClose={close}
      width={760}
      footer={
        <>
          <button className="btn" onClick={() => navigator.clipboard.writeText(diffToMarkdown(diff)).then(() => useStore.getState().toast('Copied the comparison as Markdown.', 'success'))}>
            <Copy size={14} /> Copy as Markdown
          </button>
          <span className="spacer" />
          {mode === 'sync' ? (
            <button className="btn primary" disabled={!chosen.length} title={chosen.length ? undefined : 'Pick at least one change.'} onClick={sync}>
              <Wand2 size={14} /> Apply {chosen.length} change{chosen.length === 1 ? '' : 's'} to “{tabB.name}”
            </button>
          ) : (
            <button className="btn primary" onClick={close}>
              Done
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="compare-pick">
          <Select value={a} onChange={setA} options={tabs.map((t) => ({ value: t.id, label: `${t.name} (${t.kind})` }))} />
          <button
            className="icon-btn"
            title="Swap"
            onClick={() => {
              setA(b);
              setB(a);
            }}
          >
            <ArrowRightLeft size={16} />
          </button>
          <Select value={b} onChange={setB} options={tabs.map((t) => ({ value: t.id, label: `${t.name} (${t.kind})` }))} />
        </div>
        <Segmented<'diff' | 'sql' | 'sync'>
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'diff', label: 'Differences' },
            { value: 'sql', label: 'Migration SQL' },
            ...(canSync ? [{ value: 'sync' as const, label: <><Wand2 size={14} /> Sync from source</>, title: `Bring changes in “${tabs.find((t) => t.id === a)?.name}” into “${tabB.name}”, transformed the way it was derived` }] : []),
          ]}
        />
        <div className="compare-summary">
          <span className="chg added">+{c.added} added</span>
          <span className="chg removed">−{c.removed} removed</span>
          <span className="chg changed">~{c.changed} changed</span>
          <span className="muted">
            {diff.unchanged} unchanged · matched by {diff.matching === 'lineage' ? 'derivation lineage (renames tracked)' : 'name'}
          </span>
        </div>
        {mode === 'sync' ? (
          <div className="diff-list">
            {!plan.length && <div className="empty">“{tabB.name}” is in sync with its source.</div>}
            {plan.map((ch) => (
              <label key={ch.id} className={`op-row sync-${ch.kind}`}>
                <input type="checkbox" className="check" checked={isOn(ch)} onChange={(e) => toggle(ch, e.target.checked)} />
                <span>{ch.label}</span>
                {!ch.suggested && <span className="muted small">not selected by default</span>}
              </label>
            ))}
          </div>
        ) : mode === 'sql' ? (
          <div className="stack">
            <Field label="Dialect" inline>
              <Select<SqlDialect> value={dialect} onChange={setDialect} options={SQL_DIALECTS.map((d) => ({ value: d.id, label: d.label }))} />
            </Field>
            <div className="code-preview">
              <textarea className="input textarea mono" rows={16} readOnly value={sql} />
              <button className="btn sm" onClick={() => downloadBlob(new Blob([sql], { type: 'text/sql' }), `${doc.name}-migration-${a}-to-${b}.${dialect}.sql`)}>
                Download
              </button>
            </div>
          </div>
        ) : (
          <DiffList diff={diff} />
        )}
      </div>
    </Modal>
  );
}

/** Mounted once in the app: whichever tab dialogs are open. */
export function TabDialogs() {
  const newTab = useDialogs((s) => s.newTab);
  const compare = useDialogs((s) => s.compare);
  return (
    <>
      {newTab && <NewTabDialog />}
      {compare && <CompareDialog />}
    </>
  );
}
