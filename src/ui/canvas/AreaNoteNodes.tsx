import { memo, useEffect, useRef, useState } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { NOTE_COLORS, type Area, type Note } from '../../core';
import { useStore } from '../store';

export type AreaNodeType = Node<{ area: Area; count: number }, 'area'>;

function AreaNodeImpl({ data, selected }: NodeProps<AreaNodeType>) {
  const update = useStore((s) => s.update);
  const { area, count } = data;
  return (
    <div className={`area-node${selected ? ' selected' : ''}`} style={{ ['--area-color' as any]: area.color }}>
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={160}
        lineClassName="area-resize-line"
        handleClassName="area-resize-handle"
        onResizeEnd={(_, p) =>
          update((m) => {
            const a = m.areas.find((x) => x.id === area.id);
            if (a) Object.assign(a, { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) });
          })
        }
      />
      <div className="area-title">
        <span>{area.name}</span>
        <em>{count} entities</em>
      </div>
      {area.description && <div className="area-desc">{area.description}</div>}
    </div>
  );
}
export const AreaNode = memo(AreaNodeImpl);

export type NoteNodeType = Node<{ note: Note }, 'note'>;

function NoteNodeImpl({ data, selected }: NodeProps<NoteNodeType>) {
  const update = useStore((s) => s.update);
  const { note } = data;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(note.text), [note.text]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    if (text !== note.text)
      update((m) => {
        const n = m.notes.find((x) => x.id === note.id);
        if (n) n.text = text;
      });
  };
  return (
    <div className={`note-node${selected ? ' selected' : ''}`} style={{ width: note.w || 220, ['--note-color' as any]: note.color || NOTE_COLORS[0] }} onDoubleClick={() => setEditing(true)}>
      {editing ? (
        <textarea
          ref={ref}
          className="nodrag"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') commit();
            e.stopPropagation();
          }}
        />
      ) : (
        <div className="note-text">{note.text || 'Double-click to edit'}</div>
      )}
    </div>
  );
}
export const NoteNode = memo(NoteNodeImpl);
