import { useEffect, useMemo, useState } from 'react';
import { Bot, CircleX, GitCompareArrows, ListChecks, TriangleAlert } from '../icons';
import { MAIN_TAB, applyOps, applyOpsInPlace, describeOp, diffViews, issueCounts, listTabs, resolveTab, tabView, validateModel, type Proposal } from '../../core';
import { useStore } from '../store';
import { useAgent } from '../agent';
import { storage } from '../storage';
import { DiffList } from './DiffList';
import { Modal, Segmented } from './forms';

/** Viewers of a workspace model see proposals, but accepting or rejecting one takes an editor. */
const canReview = () => {
  const id = useStore.getState().modelId;
  return !id || storage.agentTools?.canReview?.(id) !== false;
};

async function sha1(text: string) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** "Claude proposed …": one line per pending proposal, above the canvas. */
export function ProposalBanner() {
  const proposals = useAgent((s) => s.proposals);
  const { review, dismiss } = useAgent.getState();
  if (!proposals.length) return null;
  const p = proposals[0];
  return (
    <div className="proposal-banner">
      <Bot size={16} />
      <span>
        <b>{p.author}</b> proposed <b>{p.title}</b> · {p.ops.length} change{p.ops.length === 1 ? '' : 's'}
        {proposals.length > 1 && <span className="muted"> (+{proposals.length - 1} more)</span>}
      </span>
      <button className="btn sm primary" onClick={() => review(p.id)}>
        Review
      </button>
      {canReview() && (
        <button className="btn sm ghost" onClick={() => dismiss(p.id)}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export function ProposalDialog() {
  const id = useAgent((s) => s.reviewing);
  const p = useAgent((s) => s.proposals.find((x) => x.id === id));
  if (!p) return null;
  return <Review key={p.id} p={p} />;
}

function Review({ p }: { p: Proposal }) {
  const doc = useStore((s) => s.doc)!;
  const savedText = useStore((s) => s.savedText);
  const { review, dismiss } = useAgent.getState();
  const [checked, setChecked] = useState<boolean[]>(() => p.ops.map(() => true));
  const [view, setView] = useState<'changes' | 'diff'>('changes');
  const [stale, setStale] = useState(false);
  const close = () => review(null);
  const selected = p.ops.filter((_, i) => checked[i]);
  const reviewer = canReview();

  useEffect(() => {
    if (p.base_hash) sha1(savedText).then((h) => setStale(h !== p.base_hash));
  }, [p.base_hash, savedText]);

  // The tab the proposal mostly edits, for the diff and the validation summary.
  const firstOpTab = p.ops.find((o) => o.tab)?.tab;
  const target = (p.tab && resolveTab(doc, p.tab)) || (firstOpTab && resolveTab(doc, firstOpTab)) || MAIN_TAB;
  const result = useMemo(() => applyOps(doc, selected, { tab: p.tab }), [doc, p, checked]); // eslint-disable-line react-hooks/exhaustive-deps
  const after = result.ok ? result.doc : null;
  const diff = useMemo(() => (after && view === 'diff' ? diffViews(tabView(doc, target), tabView(after, target), 'none') : null), [after, view, doc, target]);
  const counts = useMemo(() => {
    if (!after) return null;
    const before = issueCounts(validateModel(tabView(doc, target)));
    const now = issueCounts(validateModel(tabView(after, target)));
    return { before, now };
  }, [after, doc, target]);
  const newTabs = after ? listTabs(after).filter((t) => !listTabs(doc).some((x) => x.id === t.id)) : [];

  const accept = async () => {
    try {
      useStore.getState().updateDoc((d) => void applyOpsInPlace(d, selected, { tab: p.tab }));
    } catch (e: any) {
      useStore.getState().toast(e.message || String(e), 'error');
      return;
    }
    // Save first: on a workspace model the save can be refused, and then the proposal must still be there to accept.
    await useStore.getState().saveNow();
    const saved = useStore.getState();
    if (saved.saveState === 'error' || saved.externalModel) {
      close();
      saved.toast('These changes aren’t saved yet, so the proposal stays open. Resolve the save, then review it again.', 'error');
      return;
    }
    await dismiss(p.id);
    const s = useStore.getState();
    if (s.model?.entities.some((e) => !e.ui)) s.requestLayout();
    if (newTabs.length) s.setActiveTab(newTabs[0].id);
    else if (target !== s.activeTab) s.setActiveTab(target);
    s.toast(`Applied ${selected.length} change${selected.length === 1 ? '' : 's'} from ${p.author}. ⌘Z undoes them all.`, 'success');
  };

  return (
    <Modal
      title={
        <>
          <Bot size={16} /> {p.title}
        </>
      }
      onClose={close}
      width={720}
      footer={
        <>
          {reviewer && (
            <button
              className="btn ghost"
              onClick={() => {
                dismiss(p.id);
                useStore.getState().toast('Proposal rejected.');
              }}
            >
              Reject
            </button>
          )}
          <span className="spacer" />
          {counts && (
            <span className={`muted small${counts.now.error > counts.before.error ? ' warn-text' : ''}`}>
              After: {counts.now.error} errors, {counts.now.warning} warnings (now {counts.before.error}/{counts.before.warning})
            </span>
          )}
          <button className="btn" onClick={close}>
            Later
          </button>
          {reviewer ? (
            <button className="btn primary" disabled={!selected.length || !result.ok} title={!selected.length ? 'Pick at least one change.' : !result.ok ? 'These changes don’t apply cleanly to the current model.' : undefined} onClick={accept}>
              Accept {selected.length === p.ops.length ? 'all' : `${selected.length} of ${p.ops.length}`}
            </button>
          ) : (
            <span className="muted small">Accepting changes takes the editor role.</span>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="muted small">
          By {p.author} · {new Date(p.created_at).toLocaleString()}
          {p.tab ? ` · tab ${p.tab}` : ''}
        </div>
        {p.rationale && <p className="proposal-why">{p.rationale}</p>}
        {stale && (
          <div className="callout warning inline">
            <TriangleAlert size={14} /> The model changed after this was proposed. Changes apply by name; check the diff.
          </div>
        )}
        {!result.ok && (
          <div className="callout error inline">
            <CircleX size={14} /> {result.error}
          </div>
        )}
        <Segmented<'changes' | 'diff'>
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'changes', label: <><ListChecks size={14} /> Changes ({p.ops.length})</> },
            { value: 'diff', label: <><GitCompareArrows size={14} /> Diff</> },
          ]}
        />
        {view === 'changes' ? (
          <div className="op-list">
            <label className="op-row all">
              <input type="checkbox" className="check" checked={checked.every(Boolean)} onChange={(e) => setChecked(p.ops.map(() => e.target.checked))} />
              <span className="muted">Select all</span>
            </label>
            {p.ops.map((o, i) => (
              <label key={i} className={`op-row op-${o.op.split('_')[0]}`}>
                <input type="checkbox" className="check" checked={checked[i]} onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))} />
                <span>{describeOp(o)}</span>
              </label>
            ))}
          </div>
        ) : diff ? (
          <>
            {newTabs.map((t) => (
              <div key={t.id} className="callout">
                New {t.kind} tab “{t.name}” with {t.entities} entities.
              </div>
            ))}
            <DiffList diff={diff} />
          </>
        ) : null}
      </div>
    </Modal>
  );
}
