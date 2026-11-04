import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookMarked, Braces, Database, Download, Eye, EyeOff, GitCompareArrows, LayoutGrid, Link2, ListChecks, Maximize, Moon, Plus, Search, Table, Columns3, PanelsTopLeft, Sparkles } from '../icons';
import { listTabs } from '../../core';
import { useStore } from '../store';
import { useDialogs } from '../dialogs';
import { useAgent } from '../agent';
import { storage } from '../storage';
import { installApp, useInstall } from '../install';
import { addEntityAtCenter, applyFullLayout, focusEntity, hasStructs, setAllFolded, showAll } from './actions';

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  group: 'Entities' | 'Attributes' | 'Relationships' | 'Tabs' | 'Actions';
  icon: ReactNode;
  run: () => void;
  /** Extra text to match against. */
  terms?: string;
}

/** Lower is better; null = no match. Prefix beats word start beats substring beats in-order letters. */
function score(text: string, q: string): number | null {
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 0;
  const i = t.indexOf(q);
  if (i > 0 && /[\s_.·]/.test(t[i - 1])) return 1;
  if (i > 0) return 2;
  let j = 0;
  for (const ch of t) if (ch === q[j]) j++;
  return j === q.length ? 3 + (t.length - q.length) / 100 : null;
}

const LIMIT = 60;

/** ⌘K: jump to any entity, attribute, relationship or tab, or run an action. Built for models with hundreds of entities. */
export function CommandPalette() {
  const open = useDialogs((s) => s.palette);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const model = useStore((s) => s.model)!;
  const doc = useStore((s) => s.doc)!;
  const activeTab = useStore((s) => s.activeTab);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const close = () => useDialogs.getState().close('palette');
  const s = useStore.getState();

  const commands = useMemo((): Cmd[] => {
    const out: Cmd[] = [];
    const hidden = model.entities.filter((e) => e.ui?.hidden).length;
    const act = (id: string, label: string, icon: ReactNode, run: () => void, hint?: string) => out.push({ id: `a:${id}`, label, icon, run, hint, group: 'Actions' });
    if (storage.agentTools?.canRun) act('ask', 'Ask Claude…', <Sparkles size={14} />, () => useAgent.getState().togglePanel(true), '⌘J');
    const pending = useAgent.getState().proposals;
    if (pending.length) act('review', `Review proposal: ${pending[0].title}`, <Sparkles size={14} />, () => useAgent.getState().review(pending[0].id));
    act('new-tab', 'New tab…', <Plus size={14} />, () => useDialogs.getState().open({ newTab: { source: activeTab } }), 'blank, copy, or derive logical/physical');
    act('derive-logical', 'Derive logical model from this tab…', <PanelsTopLeft size={14} />, () => useDialogs.getState().open({ newTab: { source: activeTab, kind: 'logical' } }));
    act('derive-physical', 'Derive physical model from this tab…', <PanelsTopLeft size={14} />, () => useDialogs.getState().open({ newTab: { source: activeTab, kind: 'physical' } }));
    if (listTabs(doc).length > 1) act('compare', 'Compare tabs…', <GitCompareArrows size={14} />, () => useDialogs.getState().open({ compare: {} }), 'diff and migration SQL');
    if (hidden) act('show-all', `Show all hidden entities (${hidden})`, <Eye size={14} />, showAll, '⇧H');
    if (hasStructs(model)) {
      act('fold-all', 'Fold all struct fields', <Braces size={14} />, () => setAllFolded(true), 'one row per struct');
      act('unfold-all', 'Show all struct fields', <Braces size={14} />, () => setAllFolded(false));
    }
    act('add-entity', 'Add entity', <Database size={14} />, () => addEntityAtCenter('standard'), 'E');
    act('add-ref', 'Add reference list', <BookMarked size={14} />, () => addEntityAtCenter('reference'));
    act('fit', 'Fit diagram to screen', <Maximize size={14} />, () => (s.setView('diagram'), s.requestFit()), 'F');
    act('layout', 'Auto-layout all entities', <LayoutGrid size={14} />, applyFullLayout);
    act('tables', 'Open tables view', <Table size={14} />, () => s.setView('tables'));
    act('issues', 'Open issues', <ListChecks size={14} />, () => s.setView('issues'));
    if (useInstall.getState().prompt && !useInstall.getState().standalone) act('install', 'Install EntityModel.com as an app', <Download size={14} />, installApp, 'own window, works offline');
    act('theme', 'Toggle dark mode', <Moon size={14} />, () => s.setDisplay({ theme: s.display.theme === 'dark' ? 'light' : 'dark' }));
    act('detail', 'Show entity names only (faster on big diagrams)', <Columns3 size={14} />, () => s.setDisplay({ detail: 'title' }));
    for (const t of listTabs(doc))
      if (t.id !== activeTab) out.push({ id: `t:${t.id}`, label: t.name, hint: `${t.kind} tab · ${t.entities} entities`, group: 'Tabs', icon: <PanelsTopLeft size={14} />, run: () => s.setActiveTab(t.id) });
    for (const e of model.entities)
      out.push({
        id: `e:${e.name}`,
        label: e.display_name,
        hint: `${e.name}${e.ui?.hidden ? ' · hidden' : ''}`,
        terms: e.name,
        group: 'Entities',
        icon: e.ui?.hidden ? <EyeOff size={14} /> : e.entity_type === 'reference' ? <BookMarked size={14} /> : <Database size={14} />,
        run: () => focusEntity(e.name),
      });
    for (const r of model.relationships)
      out.push({ id: `r:${r.name}`, label: r.name, hint: `${r.source} → ${r.target} · ${r.cardinality}`, group: 'Relationships', icon: <Link2 size={14} />, run: () => (s.setView('diagram'), s.select({ kind: 'relationship', name: r.name })) });
    return out;
  }, [model, doc, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return commands.filter((c) => c.group === 'Actions' || c.group === 'Tabs').slice(0, LIMIT);
    const scored: { c: Cmd; s: number }[] = [];
    for (const c of commands) {
      const sc = Math.min(score(c.label, query) ?? Infinity, c.terms ? score(c.terms, query) ?? Infinity : Infinity);
      if (sc !== Infinity) scored.push({ c, s: sc + (c.group === 'Actions' ? 0.5 : 0) });
    }
    // Attributes only when the query is specific enough, so big models stay fast: "cust" or "order.status".
    if (query.length >= 3) {
      const [ent, attr] = query.includes('.') ? query.split('.', 2) : [null, query];
      for (const e of model.entities) {
        if (ent && !e.name.includes(ent)) continue;
        for (const a of e.attributes) {
          const sc = score(a.name, attr || '');
          if (sc == null || (!attr && !ent)) continue;
          scored.push({ c: { id: `x:${e.name}.${a.name}`, label: `${e.name}.${a.name}`, hint: a.type, group: 'Attributes', icon: <Columns3 size={14} />, run: () => focusEntity(e.name, a.name) }, s: sc + 1 });
        }
        if (scored.length > 2000) break;
      }
    }
    return scored
      .sort((x, y) => x.s - y.s)
      .slice(0, LIMIT)
      .map((x) => x.c);
  }, [q, commands, model]);

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    list.current?.querySelector('.pal-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const runAt = (i: number) => {
    const c = results[i];
    if (!c) return;
    close();
    c.run();
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="pal-search">
          <Search size={16} />
          <input
            autoFocus
            placeholder={`Jump to an entity, attribute (order.status), tab or action — ${model.entities.length} entities`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setCursor(Math.min(results.length - 1, cursor + 1)));
              else if (e.key === 'ArrowUp') (e.preventDefault(), setCursor(Math.max(0, cursor - 1)));
              else if (e.key === 'Enter') (e.preventDefault(), runAt(cursor));
              else if (e.key === 'Escape') close();
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" ref={list}>
          {!results.length && <div className="pal-empty">No matches</div>}
          {results.map((c, i) => (
            <div key={c.id} className={`pal-item${i === cursor ? ' active' : ''}`} onMouseMove={() => i !== cursor && setCursor(i)} onClick={() => runAt(i)}>
              <span className="pal-ico">{c.icon}</span>
              <span className="pal-label">{c.label}</span>
              {c.hint && <span className="pal-hint">{c.hint}</span>}
              <span className="pal-tag">{c.group.replace(/s$/, '').replace(/ie$/, 'y')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
