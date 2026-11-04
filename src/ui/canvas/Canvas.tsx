import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useNodesState,
  useStore as useFlowStore,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import { columnValues, createRelationship, viewTabId, type DataModel, type Entity, type Issue } from '../../core';
import { useStore, type Display, type Selection } from '../store';
import { EntityNode, type EntityNodeType } from './EntityNode';
import { AreaNode, NoteNode } from './AreaNoteNodes';
import { DependencyEdge, ReferenceEdge, RelationshipEdge } from './edges';
import { NODE_WIDTH, nodeWidth } from './geometry';
import { placeUnpositionedAsync } from './layout';
import { bridge, fitDiagram } from './bridge';
import { Maximize } from '../icons';
import { OVERVIEW_MIN_ENTITIES, OVERVIEW_ZOOM, OverviewLayer, boxAt, entityBoxes } from './OverviewLayer';
import { CanvasMenu, type MenuTarget } from './ContextMenu';

const nodeTypes = { entity: EntityNode, area: AreaNode, note: NoteNode };
const edgeTypes = { relationship: RelationshipEdge, reference: ReferenceEdge, dependency: DependencyEdge };

/** Above this many entities, selecting an entity highlights its edges without dimming all the others. */
const DIM_EDGES_UP_TO = 400;

/** Above this many entities only on-screen nodes and edges are rendered. */
const VIRTUALIZE_AT = 60;

function hierarchyScope(m: DataModel, name: string | null) {
  if (!name) return null;
  const h = m.hierarchies.find((x) => x.name === name);
  if (!h) return null;
  const entities = new Set([h.root]);
  const rels = new Set<string>();
  for (const l of h.levels)
    for (const b of l.branches) {
      entities.add(b.entity);
      rels.add(b.relationship);
    }
  return { entities, rels };
}

/**
 * Rebuilding every node on each change makes every card re-render (new `data` objects defeat memo). The cache
 * keeps a node — and its data object — when nothing it depends on changed, so an edit or a selection change only
 * re-renders the cards it touches. Immer keeps unchanged entities identical, which makes the check cheap.
 */
type Cache<T> = Map<string, { deps: unknown[]; value: T }>;
function cached<T>(cache: Cache<T>, next: Cache<T>, id: string, deps: unknown[], make: () => T): T {
  const hit = cache.get(id);
  const value = hit && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i]) ? hit.value : make();
  next.set(id, { deps, value });
  return value;
}

/** Lookup of reference-list values for hover hints; stable while no list's values change. */
function useLookup(m: DataModel) {
  const lists = m.entities.filter((e) => e.reference_values?.length);
  const prev = useRef<{ lists: Entity[]; fn: (entity?: string, column?: string) => string[] } | null>(null);
  if (!prev.current || prev.current.lists.length !== lists.length || prev.current.lists.some((e, i) => e !== lists[i])) {
    const byName = new Map(lists.map((e) => [e.name, e]));
    const memo = new Map<string, string[]>();
    const fn = (entity?: string, column?: string) => {
      const k = `${entity}.${column}`;
      if (!memo.has(k)) memo.set(k, columnValues(entity ? byName.get(entity) : undefined, column));
      return memo.get(k)!;
    };
    prev.current = { lists, fn };
  }
  return prev.current.fn;
}

function buildNodes(
  m: DataModel,
  display: Display,
  selection: Selection,
  multi: Set<string>,
  issues: Issue[],
  pendingSource: string | null,
  lookup: (entity?: string, column?: string) => string[],
  cache: { current: Cache<Node> },
): Node[] {
  const next: Cache<Node> = new Map();
  const scope = hierarchyScope(m, display.focusHierarchy);
  const selEntity = selection.kind === 'entity' && multi.size <= 1 ? selection.name : null;
  const related = new Set<string>();
  if (selEntity) {
    for (const r of m.relationships) if (r.source === selEntity || r.target === selEntity) related.add(r.source).add(r.target);
    const e = m.entities.find((x) => x.name === selEntity);
    for (const a of e?.attributes || []) if (a.reference) related.add(a.reference.entity);
  }
  const counts = new Map<string, { e: number; w: number }>();
  for (const i of issues) {
    if (i.target.kind !== 'entity' || !i.target.name) continue;
    const c = counts.get(i.target.name) || { e: 0, w: 0 };
    if (i.level === 'error') c.e++;
    if (i.level === 'warning') c.w++;
    counts.set(i.target.name, c);
  }
  const areaCounts = new Map<string, number>();
  for (const e of m.entities) if (e.area) areaCounts.set(e.area, (areaCounts.get(e.area) || 0) + 1);
  const tab = viewTabId(m);
  const talk = new Map<string, number>();
  for (const c of m.comments || []) if (!c.resolved && c.target.tab === tab && c.target.kind === 'entity' && c.target.name) talk.set(c.target.name, (talk.get(c.target.name) || 0) + 1);

  const nodes: Node[] = [];
  for (const a of m.areas) {
    const id = `area:${a.id}`;
    const selected = multi.has(id);
    const count = areaCounts.get(a.name) || 0;
    nodes.push(
      cached(cache.current, next, id, [a, selected, count], () => ({
        id,
        type: 'area',
        position: { x: a.x, y: a.y },
        style: { width: a.w, height: a.h },
        width: a.w,
        height: a.h,
        zIndex: -1,
        selected,
        data: { area: a, count },
      })),
    );
  }
  m.entities.forEach((e, i) => {
    if (e.ui?.hidden) return;
    const id = `entity:${e.name}`;
    const c = counts.get(e.name);
    const selected = multi.has(id);
    const dimmed = !!scope && !scope.entities.has(e.name);
    const highlighted = !!selEntity && related.has(e.name) && e.name !== selEntity;
    const pending = pendingSource === e.name;
    const hl = selection.kind === 'entity' && selection.name === e.name ? selection.attribute : undefined;
    const comments = talk.get(e.name) || 0;
    const deps = [e, display.detail, c?.e || 0, c?.w || 0, selected, dimmed, highlighted, pending, hl, lookup, comments];
    nodes.push(
      cached(cache.current, next, id, deps, () => ({
        id,
        type: 'entity',
        position: e.ui ? { x: e.ui.x, y: e.ui.y } : { x: (i % 5) * (NODE_WIDTH + 60), y: Math.floor(i / 5) * 320 },
        selected,
        data: { entity: e, detail: display.detail, errors: c?.e || 0, warnings: c?.w || 0, dimmed, highlighted, pendingSource: pending, highlightAttr: hl, lookup, comments },
      }) satisfies EntityNodeType),
    );
  });
  for (const n of m.notes) {
    const id = `note:${n.id}`;
    const selected = multi.has(id);
    nodes.push(cached(cache.current, next, id, [n, selected], () => ({ id, type: 'note', position: { x: n.x, y: n.y }, selected, data: { note: n } })));
  }
  cache.current = next;
  return nodes;
}

function buildEdges(m: DataModel, display: Display, selection: Selection, multi: Set<string>, cache: { current: Cache<Edge> }): Edge[] {
  const next: Cache<Edge> = new Map();
  const scope = hierarchyScope(m, display.focusHierarchy);
  const selEntity = selection.kind === 'entity' && multi.size <= 1 ? selection.name : null;
  // Dimming every other edge rebuilds all of them on each click; big models only highlight the selection's own.
  const dimOthers = m.entities.length <= DIM_EDGES_UP_TO;
  const byName = new Map(m.entities.filter((e) => !e.ui?.hidden).map((e) => [e.name, e]));
  const edges: Edge[] = [];
  if (display.showRelationships) {
    const pairCount = new Map<string, number>();
    const pairIndex = new Map<string, number>();
    const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (const r of m.relationships) pairCount.set(key(r.source, r.target), (pairCount.get(key(r.source, r.target)) || 0) + 1);
    for (const r of m.relationships) {
      if (!byName.has(r.source) || !byName.has(r.target)) continue;
      const k = key(r.source, r.target);
      const i = pairIndex.get(k) || 0;
      pairIndex.set(k, i + 1);
      const n = pairCount.get(k)!;
      const id = `rel:${r.name}`;
      const selected = selection.kind === 'relationship' && selection.name === r.name;
      const offset = r.source === r.target ? i * 30 : (i - (n - 1) / 2) * 26;
      const dimmed = (!!scope && !scope.rels.has(r.name)) || (dimOthers && !!selEntity && r.source !== selEntity && r.target !== selEntity);
      const highlighted = (!!scope && scope.rels.has(r.name)) || (!!selEntity && (r.source === selEntity || r.target === selEntity));
      edges.push(
        cached(cache.current, next, id, [r, selected, offset, dimmed, highlighted], () => ({
          id,
          type: 'relationship',
          source: `entity:${r.source}`,
          target: `entity:${r.target}`,
          selected,
          data: { rel: r, offset, dimmed, highlighted },
        })),
      );
    }
  }
  for (const e of byName.values()) {
    if (display.showReferences) {
      const addRef = (attr: string, field: string | undefined, ref?: { entity: string; output_attribute: string }) => {
        const to = ref && byName.get(ref.entity);
        if (!to || to.name === e.name) return;
        const id = `ref:${e.name}.${attr}${field ? '.' + field : ''}`;
        const dimmed = !!scope || (dimOthers && !!selEntity && selEntity !== e.name && selEntity !== to.name);
        const highlighted = selEntity === e.name || selEntity === to.name;
        edges.push(
          cached(cache.current, next, id, [e, to, display.detail, dimmed, highlighted], () => ({
            id,
            type: 'reference',
            source: `entity:${e.name}`,
            target: `entity:${to.name}`,
            data: { from: e, to, attr, field, output: ref!.output_attribute, detail: display.detail, dimmed, highlighted },
          })),
        );
      };
      for (const a of e.attributes) {
        if (a.type === 'REFERENCE_ENTITY') addRef(a.name, undefined, a.reference);
        if (a.type === 'STRUCT') {
          const st = e.struct_types?.find((s) => s.name === a.struct_type);
          for (const f of st?.fields || []) if (f.type === 'REFERENCE_ENTITY') addRef(a.name, f.name, f.reference);
        }
      }
    }
    if (display.showDependencies && e.dependent_reference) {
      const parent = byName.get(e.dependent_reference.parent);
      if (parent) {
        const id = `dep:${e.name}`;
        const dimmed = !!scope || (dimOthers && !!selEntity && selEntity !== e.name && selEntity !== parent.name);
        edges.push(
          cached(cache.current, next, id, [e, parent, display.detail, dimmed], () => ({
            id,
            type: 'dependency',
            source: `entity:${e.name}`,
            target: `entity:${parent.name}`,
            data: { child: e, parent, linked: e.dependent_reference!.linked_column, detail: display.detail, dimmed },
          })),
        );
      }
    }
  }
  cache.current = next;
  return edges;
}

const splitId = (id: string) => [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)] as const;

export function Canvas() {
  const model = useStore((s) => s.model)!;
  const display = useStore((s) => s.display);
  const selection = useStore((s) => s.selection);
  const multiList = useStore((s) => s.multi);
  const issues = useStore((s) => s.issues);
  const tool = useStore((s) => s.tool);
  const pendingSource = useStore((s) => s.pendingSource);
  const layoutRequest = useStore((s) => s.layoutRequest);
  const fitRequest = useStore((s) => s.fitRequest);
  const renderAll = useStore((s) => s.renderAll);
  const { select, update, setPendingSource, setTool, setMulti } = useStore.getState();
  const rf = useReactFlow();
  const areaDrag = useRef<{ id: string; start: { x: number; y: number }; members: Map<string, { x: number; y: number }> } | null>(null);
  const nodeCache = useRef<Cache<Node>>(new Map());
  const edgeCache = useRef<Cache<Edge>>(new Map());
  const [menu, setMenu] = useState<MenuTarget | null>(null);

  const multi = useMemo(() => new Set(multiList), [multiList]);
  const lookup = useLookup(model);
  const built = useMemo(() => buildNodes(model, display, selection, multi, issues, pendingSource, lookup, nodeCache), [model, display, selection, multi, issues, pendingSource, lookup]);
  const edges = useMemo(() => buildEdges(model, display, selection, multi, edgeCache), [model, display, selection, multi]);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>(built);
  const lastBuilt = useRef(new Map<string, Node>());
  useEffect(() => {
    // Read and replace the previous build outside the updater: StrictMode calls updaters twice.
    const prevBuilt = lastBuilt.current;
    lastBuilt.current = new Map(built.map((n) => [n.id, n]));
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return built.map((n) => {
        const p = prevById.get(n.id);
        if (!p) return n;
        // Unchanged since the last build: keep React Flow's copy (measured size, internals) as is.
        if (prevBuilt.get(n.id) === n) return p;
        // Keep measured sizes so edges don't flicker between rebuilds.
        return p.measured ? { ...n, measured: p.measured } : n;
      });
    });
  }, [built, setNodes]);

  useEffect(() => {
    bridge.rf = rf;
    // First view: the whole diagram, clear of the toolbar.
    const t = setTimeout(() => fitDiagram(useStore.getState().model!, useStore.getState().display.detail, { padding: 0.15, duration: 0 }), 0);
    return () => clearTimeout(t);
  }, [rf]);

  // Layout entities without positions (new model, or entities Claude added).
  useEffect(() => {
    if (!layoutRequest) return;
    const m = useStore.getState().model;
    if (!m || !m.entities.some((e) => !e.ui)) return;
    placeUnpositionedAsync(m, display.detail).then((pos) => {
      if (!pos.size) return;
      update((d) => {
        for (const e of d.entities) {
          const p = pos.get(e.name);
          if (p && !e.ui) e.ui = { x: p.x, y: p.y };
        }
      });
      setTimeout(() => fitDiagram(useStore.getState().model!, display.detail, { padding: 0.15 }), 60);
    });
  }, [layoutRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (fitRequest) setTimeout(() => fitDiagram(useStore.getState().model!, useStore.getState().display.detail), 30);
  }, [fitRequest]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Selection lives in the store (drag-select, shift-click); React Flow reports it as select changes.
      const sel = changes.filter((c): c is Extract<NodeChange, { type: 'select' }> => c.type === 'select');
      if (sel.length) {
        const cur = new Set(useStore.getState().multi);
        for (const c of sel) c.selected ? cur.add(c.id) : cur.delete(c.id);
        setMulti([...cur]);
      }
      onNodesChangeBase(changes.filter((c) => c.type !== 'remove' && c.type !== 'select'));
    },
    [onNodesChangeBase, setMulti],
  );

  const onNodeDragStart: OnNodeDrag = useCallback((_, node) => {
    if (node.type !== 'area') return;
    const m = useStore.getState().model!;
    const a = m.areas.find((x) => `area:${x.id}` === node.id);
    if (!a) return;
    const members = new Map<string, { x: number; y: number }>();
    for (const e of m.entities)
      if (e.ui && e.ui.x >= a.x && e.ui.y >= a.y && e.ui.x + nodeWidth(e) <= a.x + a.w + 40 && e.ui.y <= a.y + a.h) members.set(`entity:${e.name}`, { ...e.ui });
    for (const n of m.notes) if (n.x >= a.x && n.y >= a.y && n.x <= a.x + a.w && n.y <= a.y + a.h) members.set(`note:${n.id}`, { x: n.x, y: n.y });
    areaDrag.current = { id: node.id, start: { ...node.position }, members };
  }, []);

  const onNodeDrag: OnNodeDrag = useCallback(
    (_, node) => {
      const d = areaDrag.current;
      if (!d || d.id !== node.id) return;
      const dx = node.position.x - d.start.x;
      const dy = node.position.y - d.start.y;
      setNodes((ns) => ns.map((n) => (d.members.has(n.id) ? { ...n, position: { x: d.members.get(n.id)!.x + dx, y: d.members.get(n.id)!.y + dy } } : n)));
    },
    [setNodes],
  );

  /** Write dragged positions back to the model (one undo step), including area members that are hidden. */
  const persistDrag = useCallback(
    (dragged: Node[]) => {
      const current = new Map(rf.getNodes().map((n) => [n.id, n]));
      const d = areaDrag.current;
      const moved = new Map<string, { x: number; y: number }>();
      for (const n of dragged) moved.set(n.id, current.get(n.id)?.position || n.position);
      if (d) {
        const area = current.get(d.id);
        const dx = (area?.position.x ?? d.start.x) - d.start.x;
        const dy = (area?.position.y ?? d.start.y) - d.start.y;
        d.members.forEach((p, id) => moved.set(id, { x: p.x + dx, y: p.y + dy }));
      }
      areaDrag.current = null;
      update((m) => {
        for (const [id, pos] of moved) {
          const [kind, key] = splitId(id);
          const x = Math.round(pos.x);
          const y = Math.round(pos.y);
          if (kind === 'entity') {
            const e = m.entities.find((z) => z.name === key);
            if (!e) continue;
            e.ui = { ...(e.ui || {}), x, y };
            // Subject area membership follows where the entity is dropped.
            const cx = x + nodeWidth(e) / 2;
            const cy = y + 30;
            const area = m.areas.find((a) => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h);
            e.area = area?.name;
          } else if (kind === 'area') {
            const a = m.areas.find((z) => z.id === key);
            if (a) Object.assign(a, { x, y });
          } else if (kind === 'note') {
            const nn = m.notes.find((z) => z.id === key);
            if (nn) Object.assign(nn, { x, y });
          }
        }
      });
    },
    [rf, update],
  );
  const onNodeDragStop: OnNodeDrag = useCallback((_, __, dragged) => persistDrag(dragged), [persistDrag]);

  const onNodeClick = useCallback(
    (ev: React.MouseEvent, node: Node) => {
      const [kind, key] = splitId(node.id);
      if (kind === 'entity' && tool === 'relationship') {
        if (!pendingSource) return setPendingSource(key);
        let created = '';
        update((m) => {
          const r = createRelationship(m, pendingSource, key);
          m.relationships.push(r);
          created = r.name;
        });
        setTool('select');
        select({ kind: 'relationship', name: created });
        return;
      }
      // Shift/⌘-click adds to the selection; React Flow already reported it.
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) return;
      if (kind === 'entity') {
        // Clicking an attribute row opens that attribute in the inspector; anywhere else keeps the current tab.
        const attr = (ev.target as Element).closest<HTMLElement>('[data-attr]')?.dataset.attr;
        if (attr) return select({ kind: 'entity', name: key, tab: 'attributes', attribute: attr });
        const cur = useStore.getState().selection;
        select({ kind: 'entity', name: key, tab: cur.kind === 'entity' ? cur.tab : undefined });
      } else if (kind === 'area') select({ kind: 'area', id: key });
      else if (kind === 'note') select({ kind: 'note', id: key });
    },
    [tool, pendingSource, select, setPendingSource, setTool, update],
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      if (edge.type === 'relationship') select({ kind: 'relationship', name: edge.id.slice(4) });
      else if (edge.type === 'reference') {
        const d = edge.data as any;
        select({ kind: 'entity', name: d.from.name, tab: 'attributes', attribute: d.attr });
      } else if (edge.type === 'dependency') select({ kind: 'entity', name: (edge.data as any).child.name, tab: 'general' });
    },
    [select],
  );

  const flowAt = (ev: { clientX: number; clientY: number }) => rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });

  const onNodeContextMenu = useCallback(
    (ev: React.MouseEvent, node: Node) => {
      ev.preventDefault();
      // Right-click inside the selection acts on all of it; outside, on that item alone.
      if (!useStore.getState().multi.includes(node.id)) setMulti([node.id]);
      setMenu({ kind: 'nodes', x: ev.clientX, y: ev.clientY, flow: flowAt(ev) });
    },
    [setMulti], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const virtualize = !renderAll && model.entities.length > VIRTUALIZE_AT;
  // Big diagrams zoomed far out: entities and relationships go on one canvas instead of thousands of cards.
  const far = useFlowStore((s) => s.transform[2] < OVERVIEW_ZOOM);
  const overview = far && !renderAll && model.entities.length > OVERVIEW_MIN_ENTITIES;
  const boxes = useMemo(() => (overview ? entityBoxes(model, display.detail) : []), [overview, model, display.detail]);
  const shownNodes = useMemo(() => (overview ? nodes.filter((n) => n.type !== 'entity') : nodes), [overview, nodes]);
  const selectedNames = useMemo(() => new Set(multiList.filter((x) => x.startsWith('entity:')).map((x) => x.slice(7))), [multiList]);

  return (
    <div className={`canvas-wrap${tool === 'relationship' ? ' tool-rel' : ''}`}>
      <ReactFlow
        nodes={shownNodes}
        edges={overview ? [] : edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStop={(_, dragged) => persistDrag(dragged)}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionContextMenu={(ev) => {
          ev.preventDefault();
          setMenu({ kind: 'nodes', x: ev.clientX, y: ev.clientY, flow: flowAt(ev) });
        }}
        onEdgeContextMenu={(ev, edge) => {
          ev.preventDefault();
          onEdgeClick(ev, edge);
          if (edge.type === 'relationship') setMenu({ kind: 'relationship', name: edge.id.slice(4), x: ev.clientX, y: ev.clientY, flow: flowAt(ev) });
        }}
        onPaneContextMenu={(ev) => {
          ev.preventDefault();
          setMenu({ kind: 'pane', x: ev.clientX, y: ev.clientY, flow: flowAt(ev) });
        }}
        onPaneClick={(ev) => {
          if (overview) {
            // Overview: clicking an entity zooms into it.
            const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
            const b = boxAt(boxes, p.x, p.y);
            if (b) {
              select({ kind: 'entity', name: b.e.name });
              rf.setCenter(b.x + b.w / 2, b.y + Math.min(b.h / 2, 200), { zoom: 0.6, duration: 350 });
              return;
            }
          }
          if (tool === 'relationship') setTool('select');
          select({ kind: 'model' });
        }}
        onMoveStart={() => setMenu(null)}
        minZoom={0.05}
        maxZoom={2.5}
        // Trackpad-first: two-finger scroll pans in any direction, pinch zooms (Cmd+scroll also zooms).
        // Dragging on empty canvas draws a selection box; Space+drag or middle-drag pans.
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        selectionOnDrag={tool === 'select'}
        panOnDrag={[1]}
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        onlyRenderVisibleElements={virtualize}
        proOptions={{ hideAttribution: true }}
        elevateNodesOnSelect={false}
        snapToGrid
        snapGrid={[8, 8]}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} className="canvas-bg" />
        <KeepCanvasAnchored />
        <Controls showInteractive={false} showFitView={false} position="bottom-left">
          <ControlButton title="Fit diagram to screen (F)" aria-label="Fit diagram to screen" onClick={() => useStore.getState().requestFit()}>
            <Maximize size={14} />
          </ControlButton>
        </Controls>
        {display.showMinimap && <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => (n.type === 'entity' ? (n.data as any).entity.color_code : 'transparent')} />}
      </ReactFlow>
      {overview && <OverviewLayer boxes={boxes} model={model} selected={selectedNames} />}
      {overview && <div className="overview-hint">Overview · {boxes.length} entities · click one, or zoom in, to see details</div>}
      {menu && <CanvasMenu target={menu} onClose={() => setMenu(null)} />}
      {tool === 'relationship' && (
        <div className="tool-hint">
          {pendingSource ? (
            <>
              Source: <b>{pendingSource}</b> — now click the target entity
            </>
          ) : (
            'Click the source entity, then the target. Esc to cancel.'
          )}
        </div>
      )}
    </div>
  );
}

/**
 * When the left sidebar is shown, hidden or resized, the canvas's left edge moves and the diagram
 * would slide with it. Pan by the same amount so the diagram stays put on screen.
 */
function KeepCanvasAnchored() {
  const rf = useReactFlow();
  const showSidebar = useStore((s) => s.display.showSidebar);
  const sidebarWidth = useStore((s) => s.display.sidebarWidth);
  const lastLeft = useRef<number | null>(null);
  useLayoutEffect(() => {
    const left = document.querySelector('.canvas-wrap')?.getBoundingClientRect().left;
    if (left == null) return;
    if (lastLeft.current != null && left !== lastLeft.current) {
      const vp = rf.getViewport();
      rf.setViewport({ ...vp, x: vp.x - (left - lastLeft.current) });
    }
    lastLeft.current = left;
  }, [rf, showSidebar, sidebarWidth]);
  return null;
}
