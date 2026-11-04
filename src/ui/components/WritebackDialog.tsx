import { useEffect, useState } from 'react';
import { Check, ClipboardCopy, Download, Loader2, Send } from '../icons';
import type { WritebackStatement } from '../../core';
import { useDialogs } from '../dialogs';
import { downloadBlob } from '../download';
import { storage } from '../storage';
import { useStore } from '../store';
import { profileSource } from './actions';
import { Modal } from './forms';

type State = { loading: true } | { loading: false; statements: WritebackStatement[]; notes: string[]; error?: string };

/**
 * What `em writeback` would run: the model's table and column descriptions (and, on Databricks, PII and glossary
 * tags) that the live catalog doesn't have yet. Preview only: the person copies the SQL and runs it themselves.
 */
export function WritebackDialog() {
  const open = useDialogs((s) => s.writeback);
  return open ? <WritebackBody /> : null;
}

function WritebackBody() {
  const close = () => useDialogs.getState().close('writeback');
  const { modelId, activeTab, toast } = useStore.getState();
  const where = profileSource();
  const [state, setState] = useState<State>({ loading: true });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // The server reads the model file: write pending edits first so the plan matches what's on screen.
        if (useStore.getState().saveState === 'pending') await useStore.getState().saveNow();
        const r = await storage.writebackPlan!(modelId!, { tab: activeTab });
        // Progress lines ("Reading schema…") are for the terminal; keep warnings.
        if (live) setState({ loading: false, statements: r.statements, notes: r.notes.filter((x) => !x.endsWith('…')) });
      } catch (e) {
        if (live) setState({ loading: false, statements: [], notes: [], error: (e as Error).message });
      }
    })();
    return () => {
      live = false;
    };
  }, [modelId, activeTab]);

  const sql = state.loading ? '' : state.statements.map((s) => `-- ${s.what}\n${s.sql}`).join('\n\n') + '\n';
  const file = `${modelId}-writeback.sql`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('Could not copy — your browser blocked clipboard access.', 'error');
    }
  };
  const n = state.loading ? 0 : state.statements.length;

  return (
    <Modal
      title={
        <>
          <Send size={16} /> Write descriptions back to {where}
        </>
      }
      onClose={close}
      width={720}
      footer={
        <>
          <span className="muted small">{state.loading ? 'Comparing with the catalog…' : `${n} statement${n === 1 ? '' : 's'}`}</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={close}>
            Close
          </button>
          <button className="btn" disabled={!n} onClick={() => downloadBlob(sql, file, 'application/sql')}>
            <Download size={16} /> Download .sql
          </button>
          <button className="btn primary" disabled={!n} onClick={copy}>
            {copied ? <Check size={16} /> : <ClipboardCopy size={16} />} {copied ? 'Copied' : 'Copy SQL'}
          </button>
        </>
      }
    >
      <div className="stack">
        {state.loading ? (
          <p className="muted">
            <Loader2 size={14} className="spin" /> Reading the current comments{where ? ` in ${where}` : ''}…
          </p>
        ) : state.error ? (
          <p className="text-error">Could not compare with the catalog: {state.error}</p>
        ) : !n ? (
          <p>The catalog already has every description this tab documents. Nothing to write.</p>
        ) : (
          <>
            <p>
              These statements set the descriptions{state.statements.some((s) => s.sql.includes('SET TAGS')) ? ' and tags' : ''} the catalog doesn't have yet. Nothing is removed: a blank description in the model leaves the
              catalog's comment alone.
            </p>
            <div className="code-preview">
              <textarea className="input textarea mono" readOnly rows={Math.min(16, sql.split('\n').length + 1)} value={sql} aria-label="Write-back SQL" />
            </div>
          </>
        )}
        {!state.loading && state.notes.length > 0 && <p className="muted small">{state.notes.join(' ')}</p>}
        <p className="muted small">
          Nothing has been run. Run the SQL in your SQL editor, or from a terminal with <span className="mono">em writeback {modelId} --tab {activeTab} --apply</span>.
        </p>
      </div>
    </Modal>
  );
}
