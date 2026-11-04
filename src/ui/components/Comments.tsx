import { useState } from 'react';
import { Check, MessageSquare, RotateCcw } from '../icons';
import { applyOpsInPlace, viewTabId, type CommentTarget, type DataModel, type ReviewComment } from '../../core';
import { useStore } from '../store';
import { focusEntity } from './actions';

const AUTHOR_KEY = 'em.author';
function author(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) || '';
  } catch {
    return '';
  }
}

function run(ops: Parameters<typeof applyOpsInPlace>[1]) {
  try {
    useStore.getState().updateDoc((d) => void applyOpsInPlace(d as DataModel, ops, { tab: useStore.getState().activeTab }));
  } catch (e: any) {
    useStore.getState().toast(e.message, 'error');
  }
}

const sameTarget = (a: CommentTarget, b: Omit<CommentTarget, 'tab'> & { tab: string }) => a.tab === b.tab && a.kind === b.kind && (a.name || '') === (b.name || '') && (a.attribute || '') === (b.attribute || '');
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Review threads on one thing (the model, an entity, an attribute or a relationship), for the inspector. */
export function CommentsSection({ target, includeAttributes }: { target: Omit<CommentTarget, 'tab'>; includeAttributes?: boolean }) {
  const doc = useStore((s) => s.doc)!;
  const tab = useStore((s) => s.activeTab);
  const [text, setText] = useState('');
  const [name, setName] = useState(author);
  const [showResolved, setShowResolved] = useState(false);
  const full = { ...target, tab };
  const all = (doc.comments || []).filter((c) => sameTarget(c.target, full) || (includeAttributes && c.target.tab === tab && c.target.kind === target.kind && c.target.name === target.name && !!c.target.attribute));
  const open = all.filter((c) => !c.resolved);
  const shown = showResolved ? all : open;
  const post = () => {
    if (!text.trim() || !name.trim()) return;
    try {
      localStorage.setItem(AUTHOR_KEY, name.trim());
    } catch {
      /* storage unavailable */
    }
    run([{ op: 'add_comment', target, text: text.trim(), author: name.trim() }]);
    setText('');
  };
  return (
    <div className="comments">
      <div className="section-title">
        <span>
          <MessageSquare size={12} /> Review comments {open.length ? `(${open.length} open)` : ''}
        </span>
        {all.length > open.length && (
          <button className="btn xs ghost" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? 'Hide resolved' : `Show ${all.length - open.length} resolved`}
          </button>
        )}
      </div>
      {shown.map((c) => (
        <Thread key={c.id} c={c} me={name} />
      ))}
      <div className="comment-new">
        {!author() && <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />}
        <textarea
          className="input textarea"
          rows={2}
          placeholder={`Comment on ${target.attribute ? `${target.name}.${target.attribute}` : target.name || 'this model'}… (⌘↵ to post)`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && post()}
        />
        <button className="btn xs" disabled={!text.trim() || !name.trim()} title={!name.trim() ? 'Add your name first.' : !text.trim() ? 'Write a comment first.' : undefined} onClick={post}>
          Comment
        </button>
      </div>
    </div>
  );
}

function Thread({ c, me }: { c: ReviewComment; me: string }) {
  const [reply, setReply] = useState('');
  return (
    <div className={`comment${c.resolved ? ' resolved' : ''}`}>
      <div className="comment-head">
        <b>{c.author}</b>
        {c.target.attribute && <span className="mono small">.{c.target.attribute}</span>}
        <span className="muted small">{when(c.created_at)}</span>
        <span className="spacer" />
        <button className="icon-btn xs" title={c.resolved ? 'Reopen' : 'Resolve'} onClick={() => run([{ op: 'resolve_comment', id: c.id, resolved: !c.resolved }])}>
          {c.resolved ? <RotateCcw size={12} /> : <Check size={12} />}
        </button>
      </div>
      <div className="comment-text">{c.text}</div>
      {(c.replies || []).map((r) => (
        <div key={r.id} className="comment-reply">
          <b>{r.author}</b> <span className="muted small">{when(r.created_at)}</span>
          <div className="comment-text">{r.text}</div>
        </div>
      ))}
      {!c.resolved && (
        <input
          className="input comment-reply-input"
          placeholder="Reply… (Enter)"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && reply.trim() && (me || author())) {
              run([{ op: 'reply_comment', id: c.id, text: reply.trim(), author: me || author() }]);
              setReply('');
            }
          }}
        />
      )}
    </div>
  );
}

/** Open comments in the active tab, as a sidebar group: click to go to what they are about. */
export function OpenComments() {
  const doc = useStore((s) => s.doc)!;
  const model = useStore((s) => s.model)!;
  const tab = viewTabId(model);
  const open = (doc.comments || []).filter((c) => !c.resolved && c.target.tab === tab);
  if (!open.length) return null;
  const go = (c: ReviewComment) => {
    const s = useStore.getState();
    if (c.target.kind === 'entity' && c.target.name) focusEntity(c.target.name, c.target.attribute);
    else if (c.target.kind === 'relationship' && c.target.name) s.select({ kind: 'relationship', name: c.target.name });
    else s.select({ kind: 'model' });
    s.setDisplay({ showInspector: true });
  };
  return (
    <>
      {open.map((c) => (
        <button key={c.id} className="side-item comment-item" onClick={() => go(c)} title={c.text}>
          <MessageSquare size={12} />
          <span className="side-label">
            <span className="mono">{c.target.name ? `${c.target.name}${c.target.attribute ? `.${c.target.attribute}` : ''}` : 'model'}</span> {c.text}
          </span>
          {!!c.replies?.length && <span className="side-meta">{c.replies.length}</span>}
        </button>
      ))}
    </>
  );
}
