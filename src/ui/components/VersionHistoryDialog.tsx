import { useEffect, useMemo, useState } from 'react';
import { History, Loader2, RotateCcw } from '../icons';
import { diffViews, listTabs, normalizeModel, tabView, type DataModel } from '../../core';
import { useDialogs } from '../dialogs';
import { storage } from '../storage';
import { CloudConflict } from '../storage/cloud';
import type { SavedVersion } from '../storage/types';
import { useStore } from '../store';
import { DiffList } from './DiffList';
import { Modal } from './forms';

/** Earlier saves of a workspace model, what changed since each, and restoring one as the newest version. */
export function VersionHistoryDialog() {
  const open = useDialogs((s) => s.history);
  return open ? <HistoryBody /> : null;
}

/** What differs between a saved version and the model on screen, tab by tab. */
function Changes({ then, now }: { then: DataModel; now: DataModel }) {
  const parts = useMemo(() => {
    const before = listTabs(then);
    const after = listTabs(now);
    const out: { id: string; name: string; note?: string; diff?: ReturnType<typeof diffViews> }[] = [];
    for (const t of after) {
      if (!before.some((b) => b.id === t.id)) out.push({ id: t.id, name: t.name, note: 'Tab added since this version.' });
      else {
        const diff = diffViews(tabView(then, t.id), tabView(now, t.id), 'none');
        if (diff.entities.length || diff.relationships.length) out.push({ id: t.id, name: t.name, diff });
      }
    }
    for (const b of before) if (!after.some((t) => t.id === b.id)) out.push({ id: b.id, name: b.name, note: 'Tab removed since this version.' });
    return out;
  }, [then, now]);
  if (!parts.length) return <p className="muted small">Same entities, attributes and relationships as now. Layout or other details may differ.</p>;
  return (
    <>
      {parts.map((p) => (
        <div key={p.id}>
          <h4 className="history-tab">{p.name}</h4>
          {p.note ? <p className="muted small">{p.note}</p> : <DiffList diff={p.diff!} />}
        </div>
      ))}
    </>
  );
}

function HistoryBody() {
  const close = () => useDialogs.getState().close('history');
  const modelId = useStore((s) => s.modelId)!;
  const doc = useStore((s) => s.doc)!;
  const toast = useStore((s) => s.toast);
  const v = storage.versions!;
  const [list, setList] = useState<SavedVersion[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [then, setThen] = useState<DataModel | null>(null);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(false);

  const load = async () => {
    try {
      // Unsaved edits become a version first, so they appear in the list and a restore can't lose them.
      if (useStore.getState().saveState === 'pending') await useStore.getState().saveNow();
      const versions = await v.list(modelId);
      setList(versions);
      setSelected((cur) => cur ?? versions[1]?.version ?? versions[0]?.version ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, [modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selected === null) return;
    let live = true;
    setThen(null);
    setError('');
    v.text(modelId, selected)
      .then((text) => live && setThen(normalizeModel(JSON.parse(text))))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [modelId, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = list?.[0]?.version;
  const canRestore = v.canRestore(modelId) && selected !== null && selected !== latest;

  const restore = async () => {
    const s = useStore.getState();
    setRestoring(true);
    try {
      if (s.saveState === 'pending') await s.saveNow();
      const after = useStore.getState();
      if (after.externalModel || after.saveState === 'error') {
        toast('Sort out the unsaved changes on this model first, then restore.', 'error');
        return;
      }
      const text = await v.restore(modelId, selected!);
      // The same path as loading someone else's version: Undo in this session goes back to what was on screen.
      useStore.setState({ externalModel: normalizeModel(JSON.parse(text)) });
      useStore.getState().acceptExternal();
      toast(`Restored the version from ${when(list!.find((x) => x.version === selected)!.saved_at)}. Everyone with this model open gets it too.`, 'success');
      close();
    } catch (e) {
      if (e instanceof CloudConflict) {
        // Our known version just moved on, so the live update won't reload this: load it here.
        useStore.getState().receiveExternal(normalizeModel(JSON.parse(e.text)));
        toast('Someone else just saved, so nothing was restored. Check the list and try again.', 'error');
        setList(null);
        await load();
      } else toast(`Could not restore: ${(e as Error).message}`, 'error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Modal
      width={820}
      title={
        <>
          <History size={16} /> Version history
        </>
      }
      onClose={close}
      footer={
        <>
          <span className="muted small history-note">Restoring saves that version as the newest one. Nothing is removed.</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={close}>
            Close
          </button>
          {v.canRestore(modelId) && (
            <button className="btn primary" disabled={!canRestore || restoring} onClick={restore}>
              <RotateCcw size={14} /> {restoring ? 'Restoring…' : 'Restore this version'}
            </button>
          )}
        </>
      }
    >
      {!list && !error && (
        <p className="muted small">
          <Loader2 size={14} className="spin" /> Loading versions…
        </p>
      )}
      {list && (
        <div className="history">
          <ul className="history-list">
            {list.map((x) => (
              <li key={x.version}>
                <button className={`history-item${x.version === selected ? ' active' : ''}`} onClick={() => setSelected(x.version)}>
                  <span>{when(x.saved_at)}</span>
                  <span className="muted small">
                    {x.by ?? 'Former member'}
                    {x.via ? ` via ${x.via}` : ''}
                    {x.version === latest ? ' · current' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="history-detail">
            {error ? (
              <p className="small">{error}</p>
            ) : selected === latest ? (
              <p className="muted small">This is the current version.</p>
            ) : then ? (
              <>
                <p className="muted small">Changes from this version to now:</p>
                <Changes then={then} now={doc} />
              </>
            ) : (
              <p className="muted small">
                <Loader2 size={14} className="spin" /> Loading this version…
              </p>
            )}
          </div>
        </div>
      )}
      {!list && error && <p className="small">{error}</p>}
    </Modal>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
