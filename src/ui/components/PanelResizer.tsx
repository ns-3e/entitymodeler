import { useStore, PANEL_WIDTHS } from '../store';

/** Drag handle on the inner edge of a side panel. Double-click resets the width. */
export function PanelResizer({ panel }: { panel: 'sidebar' | 'inspector' }) {
  const key = panel === 'sidebar' ? 'sidebarWidth' : 'inspectorWidth';
  const limits = PANEL_WIDTHS[panel];
  // The sidebar grows as the pointer moves right; the inspector grows as it moves left.
  const dir = panel === 'sidebar' ? 1 : -1;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = useStore.getState().display[key];
    document.body.classList.add('resizing-panel');
    const onMove = (ev: PointerEvent) => {
      const w = Math.round(Math.min(limits.max, Math.max(limits.min, startW + dir * (ev.clientX - startX))));
      useStore.getState().setDisplay({ [key]: w });
    };
    const onUp = () => {
      document.body.classList.remove('resizing-panel');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      className={`panel-resizer panel-resizer-${panel}`}
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useStore.getState().setDisplay({ [key]: limits.default })}
    />
  );
}
