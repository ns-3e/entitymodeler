import { useEffect, useState } from 'react';
import { Check, ClipboardCopy, Link2, Loader2 } from '../icons';
import { SOURCE_URL, encodeShareFragment, listTabs, tabView, type DataModel } from '../../core';
import { useStore } from '../store';
import { Modal } from './forms';

/** Long links can be cut off by some chat apps and email clients. */
const LONG_LINK = 60_000;

/** "12 entities, 9 relationships" — across every tab when there are several. */
export function shareCounts(m: DataModel): string {
  const tabs = listTabs(m);
  const views = tabs.map((t) => tabView(m, t.id));
  const e = views.reduce((n, v) => n + v.entities.length, 0);
  const r = views.reduce((n, v) => n + v.relationships.length, 0);
  return `${e} entities, ${r} relationships${tabs.length > 1 ? ` in ${tabs.length} tabs` : ''}`;
}

/** A link that carries the whole model (every tab) in its #fragment — nothing is uploaded. */
export function ShareDialog({ model, onClose }: { model: DataModel; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    encodeShareFragment(model).then((hash) => live && setLink(`${SOURCE_URL}/${hash}`));
    return () => {
      live = false;
    };
  }, [model]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy — your browser blocked clipboard access.', 'error');
    }
  };

  return (
    <Modal
      title={
        <>
          <Link2 size={16} /> Share a link
        </>
      }
      onClose={onClose}
      width={600}
      footer={
        <>
          <span className="muted small">{link ? `${(link.length / 1024).toFixed(1)} KB link` : 'Preparing…'}</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" disabled={!link} title={link ? undefined : 'The link is still being made.'} onClick={copy}>
            {copied ? <Check size={16} /> : <ClipboardCopy size={16} />} {copied ? 'Copied' : 'Copy link'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p>
          The link holds a snapshot of <b>{model.title}</b> — {shareCounts(model)}. Anyone who opens it gets their own copy to view and edit; your model is not changed.
        </p>
        <div className="share-link mono">{link ? link : <Loader2 size={14} className="spin" />}</div>
        <p className="muted small">
          Nothing is uploaded: the model travels inside the part of the link after <span className="mono">#</span>, which browsers never send to a server. Later edits are not included — share again to send a newer version.
          {link.length > LONG_LINK && ' This link is long; some chat apps cut long links off. If it fails to open, send the model file instead (Export → Model file).'}
        </p>
      </div>
    </Modal>
  );
}
