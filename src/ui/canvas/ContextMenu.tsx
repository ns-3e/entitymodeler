import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  BookMarked,
  Braces,
  Check,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Database,
  Eye,
  EyeOff,
  Focus,
  Layers,
  LayoutGrid,
  Maximize,
  Palette,
  PanelRight,
  SquareDashedMousePointer,
  StickyNote,
  Trash2,
  Waypoints,
  FolderInput,
  Plus,
} from '../icons';
import { ENTITY_COLORS, REFERENCE_COLORS, listTabs, type Cardinality } from '../../core';
import { useStore } from '../store';
import {
  addArea,
  addEntityAtCenter,
  addNote,
  applyFullLayout,
  arrangeSelection,
  copySelection,
  copyToTab,
  deleteSelection,
  hasStructs,
  setAllFolded,
  duplicateSelection,
  hasClipboard,
  idsByKind,
  isolate,
  neighbors,
  paste,
  selectAll,
  setColor,
  setHidden,
  showAll,
} from '../components/actions';
import { newTabFromSelection } from '../components/TabBar';

export type MenuTarget = { x: number; y: number; flow: { x: number; y: number } } & ({ kind: 'nodes' } | { kind: 'pane' } | { kind: 'relationship'; name: string });

const FLIP: Record<Cardinality, Cardinality> = { '1:1': '1:1', '1:N': 'N:1', 'N:1': '1:N', 'N:N': 'N:N' };

function Item({ icon, label, kbd, onClick, danger, disabled, reason, children }: { icon?: ReactNode; label: ReactNode; kbd?: string; onClick?: () => void; danger?: boolean; disabled?: boolean; /** Why it is disabled. */ reason?: string; children?: ReactNode }) {
  return (
    <div className={`cm-item${danger ? ' danger' : ''}${disabled ? ' disabled' : ''}${children ? ' has-sub' : ''}`} role="menuitem" aria-disabled={disabled || undefined} title={disabled ? reason : undefined} onClick={disabled || children ? undefined : onClick}>
      <span className="cm-ico">{icon}</span>
      <span className="cm-label">{label}</span>
      {kbd && <kbd>{kbd}</kbd>}
      {children && <ChevronRight size={14} className="cm-chev" />}
      {children && <div className="cm-sub menu-panel">{children}</div>}
    </div>
  );
}

const Sep = () => <div className="cm-sep" />;

export function CanvasMenu({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });
  const model = useStore((s) => s.model)!;
  const doc = useStore((s) => s.doc)!;
  const activeTab = useStore((s) => s.activeTab);
  const multi = useStore((s) => s.multi);
  const { select, update, setMulti, setDisplay, requestFit } = useStore.getState();

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.min(target.x, window.innerWidth - r.width - 8), top: Math.min(target.y, window.innerHeight - r.height - 8) });
  }, [target]);

  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const ids = idsByKind(multi);
  const names = ids.entity;
  const hiddenCount = model.entities.filter((e) => e.ui?.hidden).length;
  const otherTabs = listTabs(doc).filter((t) => t.id !== activeTab);
  let body: ReactNode;

  if (target.kind === 'pane') {
    body = (
      <>
        <Item icon={<Database size={14} />} label="Add entity here" kbd="E" onClick={run(() => addEntityAtCenter('standard', { x: target.flow.x + 140, y: target.flow.y + 60 }))} />
        <Item icon={<BookMarked size={14} />} label="Add reference here" onClick={run(() => addEntityAtCenter('reference', { x: target.flow.x + 140, y: target.flow.y + 60 }))} />
        <Item icon={<StickyNote size={14} />} label="Add note here" onClick={run(() => addNote({ x: target.flow.x + 110, y: target.flow.y + 40 }))} />
        <Item icon={<Layers size={14} />} label="Add subject area here" onClick={run(() => addArea({ x: target.flow.x + 300, y: target.flow.y + 200 }))} />
        <Item icon={<ClipboardPaste size={14} />} label="Paste here" kbd="⌘V" disabled={!hasClipboard()} reason="Copy entities first." onClick={run(() => paste(target.flow))} />
        <Sep />
        <Item icon={<SquareDashedMousePointer size={14} />} label="Select all" kbd="⌘A" onClick={run(selectAll)} />
        <Item icon={<Eye size={14} />} label={`Show all hidden${hiddenCount ? ` (${hiddenCount})` : ''}`} kbd="⇧H" disabled={!hiddenCount} reason="No entities are hidden." onClick={run(showAll)} />
        <Item icon={<Maximize size={14} />} label="Fit to screen" kbd="F" onClick={run(requestFit)} />
        <Item
          icon={<LayoutGrid size={14} />}
          label="Auto-layout all"
          onClick={run(() => {
            if (window.confirm('Re-arrange all entities automatically? (Undo is available)')) applyFullLayout();
          })}
        />
      </>
    );
  } else if (target.kind === 'relationship') {
    const r = model.relationships.find((x) => x.name === target.name);
    const set = (fn: (x: NonNullable<typeof r>) => void) => update((m) => void fn(m.relationships.find((x) => x.name === target.name)!));
    body = r && (
      <>
        <Item icon={<PanelRight size={14} />} label="Edit relationship" onClick={run(() => setDisplay({ showInspector: true }))} />
        <Item icon={<Waypoints size={14} />} label={`Cardinality: ${r.cardinality}`}>
          {(['1:1', '1:N', 'N:1', 'N:N'] as Cardinality[]).map((c) => (
            <Item key={c} label={c} icon={c === r.cardinality ? <Check size={14} /> : undefined} onClick={run(() => set((x) => void (x.cardinality = c)))} />
          ))}
        </Item>
        <Item
          icon={<ArrowLeftRight size={14} />}
          label="Reverse direction"
          onClick={run(() =>
            set((x) => {
              [x.source, x.target] = [x.target, x.source];
              x.cardinality = FLIP[x.cardinality];
              if (x.reverse_label) [x.forward_label, x.reverse_label] = [x.reverse_label, x.forward_label];
            }),
          )}
        />
        <Sep />
        <Item icon={<Trash2 size={14} />} label="Delete relationship" kbd="⌫" danger onClick={run(deleteSelection)} />
      </>
    );
  } else {
    const single = names.length === 1 && multi.length === 1 ? model.entities.find((e) => e.name === names[0]) : undefined;
    const palette = single?.entity_type === 'reference' ? REFERENCE_COLORS : ENTITY_COLORS;
    body = (
      <>
        {multi.length > 1 && <div className="cm-title">{multi.length} selected</div>}
        {single && (
          <Item
            icon={<PanelRight size={14} />}
            label="Edit"
            kbd="↵"
            onClick={run(() => {
              select({ kind: 'entity', name: single.name, tab: 'general' });
              setDisplay({ showInspector: true });
            })}
          />
        )}
        {names.length > 0 && (
          <>
            <Item icon={<EyeOff size={14} />} label="Hide" kbd="H" onClick={run(() => setHidden(names, true))} />
            <Item icon={<Focus size={14} />} label="Show only these" onClick={run(() => isolate(names))} />
            <Item icon={<Focus size={14} />} label="Show these and their neighbors" onClick={run(() => isolate(names, true))} />
            <Item icon={<SquareDashedMousePointer size={14} />} label="Select related" onClick={run(() => setMulti(neighbors(model, names).filter((n) => !model.entities.find((e) => e.name === n)?.ui?.hidden).map((n) => `entity:${n}`)))} />
            {names.length > 1 && <Item icon={<LayoutGrid size={14} />} label="Arrange selected" onClick={run(() => arrangeSelection(names))} />}
            {hasStructs(model, names) &&
              (model.entities.some((e) => names.includes(e.name) && e.attributes.some((a) => a.type === 'STRUCT' && !e.ui?.folded?.includes(a.name))) ? (
                <Item icon={<Braces size={14} />} label="Fold struct fields" onClick={run(() => setAllFolded(true, names))} />
              ) : (
                <Item icon={<Braces size={14} />} label="Show struct fields" onClick={run(() => setAllFolded(false, names))} />
              ))}
            <Sep />
            <Item icon={<Copy size={14} />} label="Copy" kbd="⌘C" onClick={run(copySelection)} />
            <Item icon={<CopyPlus size={14} />} label="Duplicate" kbd="⌘D" onClick={run(duplicateSelection)} />
            <Item icon={<FolderInput size={14} />} label="Copy to tab">
              {otherTabs.map((t) => (
                <Item key={t.id} label={t.name} onClick={run(() => copyToTab(names, t.id))} />
              ))}
              {otherTabs.length > 0 && <Sep />}
              <Item icon={<Plus size={14} />} label="New tab from selection…" onClick={run(() => newTabFromSelection(names))} />
            </Item>
            <Item icon={<Palette size={14} />} label="Color">
              <div className="cm-swatches">
                {palette.map((c) => (
                  <button key={c} className="swatch" style={{ background: c }} title={c} onClick={run(() => setColor(names, c))} />
                ))}
              </div>
            </Item>
            {single && (
              <Item
                icon={single.entity_type === 'reference' ? <Database size={14} /> : <BookMarked size={14} />}
                label={single.entity_type === 'reference' ? 'Make standard entity' : 'Make reference list'}
                onClick={run(() =>
                  update((m) => {
                    const e = m.entities.find((x) => x.name === single.name)!;
                    e.entity_type = e.entity_type === 'reference' ? 'standard' : 'reference';
                  }),
                )}
              />
            )}
          </>
        )}
        <Sep />
        <Item icon={<Trash2 size={14} />} label={multi.length > 1 ? `Delete ${multi.length} items` : 'Delete'} kbd="⌫" danger onClick={run(deleteSelection)} />
      </>
    );
  }

  return (
    <div ref={ref} className="context-menu menu-panel" style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {body}
    </div>
  );
}
