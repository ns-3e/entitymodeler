import { BookMarked, Database, EyeOff, Link2, Layers, LayoutGrid, Map as MapIcon, MousePointer2, Maximize, SlidersHorizontal, StickyNote } from '../icons';
import { useStore, type Detail } from '../store';
import { addArea, addEntityAtCenter, addNote, applyFullLayout, showAll } from './actions';
import { Menu, Segmented, Toggle } from './forms';

export function CanvasToolbar() {
  const tool = useStore((s) => s.tool);
  const display = useStore((s) => s.display);
  const model = useStore((s) => s.model)!;
  const { setTool, setDisplay, requestFit } = useStore.getState();
  const hidden = model.entities.filter((e) => e.ui?.hidden).length;
  return (
    <div className="canvas-toolbar">
      <div className="ct-group">
        <button className={`ct-btn${tool === 'select' ? ' active' : ''}`} title="Select (V)" onClick={() => setTool('select')}>
          <MousePointer2 size={16} />
        </button>
        <button className={`ct-btn${tool === 'relationship' ? ' active' : ''}`} title="Draw relationship (R)" onClick={() => setTool(tool === 'relationship' ? 'select' : 'relationship')}>
          <Link2 size={16} />
        </button>
      </div>
      <div className="ct-group">
        <button className="ct-btn labeled" title="Add entity (E)" onClick={() => addEntityAtCenter('standard')}>
          <Database size={16} /> Entity
        </button>
        <button className="ct-btn labeled" title="Add reference entity (F)" onClick={() => addEntityAtCenter('reference')}>
          <BookMarked size={16} /> Reference
        </button>
        <button className="ct-btn" title="Add subject area" onClick={() => addArea()}>
          <Layers size={16} />
        </button>
        <button className="ct-btn" title="Add note" onClick={() => addNote()}>
          <StickyNote size={16} />
        </button>
      </div>
      <div className="ct-group">
        <Segmented<Detail>
          size="sm"
          value={display.detail}
          onChange={(v) => setDisplay({ detail: v })}
          options={[
            { value: 'full', label: 'All', title: 'All attributes' },
            { value: 'keys', label: 'Keys', title: 'Keys, labels and references' },
            { value: 'title', label: 'Names', title: 'Entity names only' },
          ]}
        />
      </div>
      <div className="ct-group">
        <button
          className="ct-btn"
          title="Auto-layout"
          onClick={() => {
            if (model.entities.some((e) => e.ui) && !window.confirm('Re-arrange all entities automatically? (Undo is available)')) return;
            applyFullLayout();
          }}
        >
          <LayoutGrid size={16} />
        </button>
        <button className="ct-btn" title="Fit to screen (F)" onClick={requestFit}>
          <Maximize size={16} />
        </button>
        <Menu
          align="right"
          trigger={(open) => (
            <button className={`ct-btn${open ? ' active' : ''}`} title="Layers & display">
              <SlidersHorizontal size={16} />
            </button>
          )}
        >
          {() => (
            <div className="menu-panel">
              <div className="menu-title">Show on diagram</div>
              <Toggle checked={display.showRelationships} onChange={(v) => setDisplay({ showRelationships: v })} label="Relationships" />
              <Toggle checked={display.showReferences} onChange={(v) => setDisplay({ showReferences: v })} label="Reference lookups" />
              <Toggle checked={display.showDependencies} onChange={(v) => setDisplay({ showDependencies: v })} label="Dependent references" />
              <Toggle checked={display.showMinimap} onChange={(v) => setDisplay({ showMinimap: v })} label={<>Minimap <MapIcon size={12} /></>} />
              {model.hierarchies.length > 0 && (
                <>
                  <div className="menu-title">Highlight hierarchy</div>
                  <select className="input select" value={display.focusHierarchy || ''} onChange={(e) => setDisplay({ focusHierarchy: e.target.value || null })}>
                    <option value="">— none —</option>
                    {model.hierarchies.map((h) => (
                      <option key={h.name} value={h.name}>
                        {h.display_name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}
        </Menu>
      </div>
      {hidden > 0 && (
        <div className="ct-group">
          <button className="ct-btn labeled hidden-chip" title="Show all hidden entities (Shift+H)" onClick={showAll}>
            <EyeOff size={14} /> {hidden} hidden · Show
          </button>
        </div>
      )}
    </div>
  );
}
