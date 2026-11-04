import { useMemo, useState, type ReactNode } from 'react';
import { BookMarked, ChevronDown, Database, Eye, EyeOff, Link2, MessageSquare, Network, Plus, Search, Layers } from '../icons';
import { uniqueName, type DataModel, type EntityType } from '../../core';
import { useStore } from '../store';
import { addEntityAtCenter, focusEntity, setHidden, showAll } from './actions';
import { OpenComments } from './Comments';
import { viewTabId } from '../../core';

function Group({ title, count, icon, children, onAdd, addTitle }: { title: string; count: number; icon: React.ReactNode; children: React.ReactNode; onAdd?: () => void; addTitle?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`side-group${open ? ' open' : ''}`}>
      <div className="side-group-head" onClick={() => setOpen(!open)}>
        <ChevronDown size={14} className="chev" />
        {icon}
        <span>{title}</span>
        <span className="count">{count}</span>
        {onAdd && (
          <button
            className="icon-btn xs"
            title={addTitle}
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      {open && <div className="side-items">{children}</div>}
    </div>
  );
}

export function Sidebar() {
  const model = useStore((s) => s.model)!;
  const sel = useStore((s) => s.selection);
  const issues = useStore((s) => s.issues);
  const width = useStore((s) => s.display.sidebarWidth);
  const multi = useStore((s) => s.multi);
  const { select, update, requestFit, setMulti } = useStore.getState();
  const [q, setQ] = useState('');
  const hiddenCount = model.entities.filter((e) => e.ui?.hidden).length;
  const doc = useStore((s) => s.doc)!;
  const openComments = (doc.comments || []).filter((c) => !c.resolved && c.target.tab === viewTabId(model)).length;
  const match = (...xs: (string | undefined)[]) => !q || xs.some((x) => x?.toLowerCase().includes(q.toLowerCase()));
  const attrHits = (e: DataModel['entities'][number]) => (q ? e.attributes.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).map((a) => a.name) : []);
  // Counted once per render, not once per row (big models have thousands of both).
  const errorCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of issues) if (i.level === 'error' && i.target.kind === 'entity' && i.target.name) c.set(i.target.name, (c.get(i.target.name) || 0) + 1);
    return c;
  }, [issues]);
  const errorsFor = (name: string) => errorCount.get(name) || 0;
  const multiSet = useMemo(() => new Set(multi), [multi]);

  const entityList = (type: EntityType) =>
    windowed(model.entities
      .filter((e) => e.entity_type === type)
      .filter((e) => match(e.name, e.display_name) || attrHits(e).length)
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .map((e) => {
        const hits = match(e.name, e.display_name) ? [] : attrHits(e);
        return (
          <div key={e.name}>
            <div
              role="button"
              tabIndex={0}
              className={`side-item${(sel.kind === 'entity' && sel.name === e.name) || multiSet.has(`entity:${e.name}`) ? ' active' : ''}${e.ui?.hidden ? ' is-hidden' : ''}`}
              onClick={(ev) => {
                // Shift/⌘-click builds a canvas selection from the list (then right-click the canvas, or press H).
                if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
                  const id = `entity:${e.name}`;
                  setMulti(multi.includes(id) ? multi.filter((x) => x !== id) : [...multi, id]);
                } else focusEntity(e.name);
              }}
            >
              <i className="dot" style={{ background: e.color_code }} />
              <span className="side-label">{e.display_name}</span>
              {errorsFor(e.name) > 0 && <span className="err-dot" title="Has errors" />}
              <span className="side-meta">{e.attributes.length}</span>
              {e.ui && (
                <button
                  className="side-eye"
                  title={e.ui.hidden ? 'Show on diagram' : 'Hide from diagram (H)'}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setHidden([e.name], !e.ui!.hidden);
                  }}
                >
                  {e.ui.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
            {hits.map((h) => (
              <button key={h} className="side-item sub" onClick={() => select({ kind: 'entity', name: e.name, tab: 'attributes', attribute: h })}>
                <span className="mono">.{h}</span>
              </button>
            ))}
          </div>
        );
      }), !q);

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="side-search">
        <Search size={14} />
        <input placeholder="Search entities, attributes…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="side-scroll">
        <Group title="Entities" count={model.entities.filter((e) => e.entity_type === 'standard').length} icon={<Database size={14} />} onAdd={() => addEntityAtCenter('standard')} addTitle="Add entity">
          {entityList('standard')}
        </Group>
        <Group title="Reference data" count={model.entities.filter((e) => e.entity_type === 'reference').length} icon={<BookMarked size={14} />} onAdd={() => addEntityAtCenter('reference')} addTitle="Add reference entity">
          {entityList('reference')}
        </Group>
        <Group title="Relationships" count={model.relationships.length} icon={<Link2 size={14} />}>
          {model.relationships
            .filter((r) => match(r.name, r.forward_label, r.source, r.target))
            .map((r) => (
              <button key={r.name} className={`side-item${sel.kind === 'relationship' && sel.name === r.name ? ' active' : ''}`} onClick={() => select({ kind: 'relationship', name: r.name })}>
                <span className="side-label mono">{r.name}</span>
                <span className="side-meta">{r.cardinality}</span>
              </button>
            ))}
          {!model.relationships.length && <div className="side-empty">Use the relationship tool on the canvas</div>}
        </Group>
        <Group
          title="Hierarchies"
          count={model.hierarchies.length}
          icon={<Network size={14} />}
          addTitle="Add hierarchy"
          onAdd={() => {
            const root = model.entities.find((e) => e.entity_type === 'standard') || model.entities[0];
            if (!root) return useStore.getState().toast('Add an entity first', 'error');
            const name = uniqueName(`${root.name}_hierarchy`, model.hierarchies.map((h) => h.name));
            update((m) => void m.hierarchies.push({ name, display_name: `${root.display_name} Hierarchy`, root: root.name, status: 'draft', levels: [{ level: 2, branches: [] }] }));
            select({ kind: 'hierarchy', name });
          }}
        >
          {model.hierarchies
            .filter((h) => match(h.name, h.display_name))
            .map((h) => (
              <button key={h.name} className={`side-item${sel.kind === 'hierarchy' && sel.name === h.name ? ' active' : ''}`} onClick={() => select({ kind: 'hierarchy', name: h.name })}>
                <span className="side-label">{h.display_name}</span>
                <span className="side-meta">{h.levels.length + 1}L</span>
              </button>
            ))}
        </Group>
        {openComments > 0 && (
          <Group title="Open comments" count={openComments} icon={<MessageSquare size={14} />}>
            <OpenComments />
          </Group>
        )}
        {model.areas.length > 0 && (
          <Group title="Subject areas" count={model.areas.length} icon={<Layers size={14} />}>
            {model.areas.map((a) => (
              <button
                key={a.id}
                className={`side-item${sel.kind === 'area' && sel.id === a.id ? ' active' : ''}`}
                onClick={() => {
                  select({ kind: 'area', id: a.id });
                  import('../canvas/bridge').then(({ fitBoundsClear }) => fitBoundsClear({ x: a.x, y: a.y, width: a.w, height: a.h }, { padding: 0.1, duration: 400 }));
                }}
              >
                <i className="dot square" style={{ background: a.color }} />
                <span className="side-label">{a.name}</span>
              </button>
            ))}
          </Group>
        )}
      </div>
      {hiddenCount > 0 && (
        <button className="side-fit hidden-note" onClick={showAll} title="Shift+H">
          <EyeOff size={14} /> {hiddenCount} hidden · Show all
        </button>
      )}
      <button className="side-fit" onClick={requestFit}>
        Fit diagram to screen
      </button>
    </aside>
  );
}

const ROW = 29; // .side-item height + gap
const WINDOW_AT = 150;

/** Long lists render only the rows in view (plus a margin); short or filtered lists render as they are. */
function windowed(rows: ReactNode[], fixedHeight: boolean): ReactNode {
  if (!fixedHeight || rows.length <= WINDOW_AT) return rows;
  return <WindowedList rows={rows} />;
}

function WindowedList({ rows }: { rows: ReactNode[] }) {
  const [top, setTop] = useState(0);
  const height = Math.min(rows.length * ROW, 520);
  const first = Math.max(0, Math.floor(top / ROW) - 10);
  const last = Math.min(rows.length, Math.ceil((top + height) / ROW) + 10);
  return (
    <div className="side-window" style={{ height }} onScroll={(e) => setTop((e.target as HTMLElement).scrollTop)}>
      <div style={{ height: rows.length * ROW, position: 'relative' }}>
        <div style={{ position: 'absolute', top: first * ROW, left: 0, right: 0 }}>{rows.slice(first, last)}</div>
      </div>
    </div>
  );
}
