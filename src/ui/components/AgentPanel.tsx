import { useEffect, useRef, useState } from 'react';
import { Bot, CircleX, Loader2, Send, Sparkles, Square, Wrench, X } from '../icons';
import { useStore } from '../store';
import { useAgent } from '../agent';
import { storage } from '../storage';

const QUICK = [
  'Add clear business descriptions to every entity and attribute that lacks one',
  'Derive a logical model from this tab',
  'Derive a physical model for Databricks from this tab',
  'Review this tab for modeling problems and propose fixes',
  'Add the reference lists this model is missing',
  'Work through the open review comments: propose fixes and reply to each',
  'Draft glossary terms for the main business entities and link them'
];

/** "Ask Claude" (⌘J): requests run Claude Code headless with the EntityModel.com tools; results come back as proposals. */
export function AgentPanel() {
  const open = useAgent((s) => s.panel);
  if (!open || !storage.agentTools?.canRun) return null;
  return <Panel />;
}

function Panel() {
  const run = useAgent((s) => s.run);
  const proposals = useAgent((s) => s.proposals);
  const model = useStore((s) => s.model)!;
  const multi = useStore((s) => s.multi);
  const selection = useStore((s) => s.selection);
  const { ask, cancel, togglePanel, review } = useAgent.getState();
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const busy = run?.status === 'starting' || run?.status === 'running';
  const selected = multi.filter((x) => x.startsWith('entity:')).length || (selection.kind === 'entity' ? 1 : 0);
  const fresh = run && proposals.find((p) => p.created_at >= run.startedAt);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [run?.events.length]);

  const submit = (prompt: string) => {
    if (!prompt.trim() || busy) return;
    ask(prompt.trim());
    setText('');
  };

  return (
    <aside className="agent-panel" role="dialog" aria-label="Ask Claude">
      <div className="agent-head">
        <Sparkles size={16} />
        <b>Ask Claude</b>
        <span className="agent-ctx">
          {model.tab?.name} tab{selected ? ` · ${selected} selected` : ''}
        </span>
        <button className="icon-btn" title="Close (⌘J)" onClick={() => togglePanel(false)}>
          <X size={16} />
        </button>
      </div>
      <div className="agent-log" ref={log}>
        {!run && (
          <div className="agent-empty">
            <p className="muted small">Claude reads this model with the EntityModel.com tools and answers with a proposal you review before anything changes.</p>
            {QUICK.map((q) => (
              <button key={q} className="agent-quick" onClick={() => submit(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        {run && (
          <>
            <div className="agent-msg you">{run.prompt}</div>
            {run.events.map((e, i) =>
              e.kind === 'tool' ? (
                <div key={i} className="agent-tool">
                  <Wrench size={12} /> {e.name}
                  {e.summary && <span className="muted"> · {e.summary}</span>}
                </div>
              ) : e.kind === 'error' ? (
                <div key={i} className="agent-msg error">
                  <CircleX size={14} /> {e.text}
                </div>
              ) : e.kind === 'text' || e.kind === 'done' ? (
                e.kind === 'done' && run.events.some((x) => x.kind === 'text' && x.text === e.text) ? null : (
                  <div key={i} className="agent-msg">
                    <Bot size={14} /> <span>{e.text}</span>
                  </div>
                )
              ) : null,
            )}
            {busy && (
              <div className="agent-tool">
                <Loader2 size={12} className="spin" /> {run.status === 'starting' ? 'Starting Claude…' : 'Working…'}
              </div>
            )}
            {fresh && !busy && (
              <button className="btn sm primary" onClick={() => review(fresh.id)}>
                Review “{fresh.title}” ({fresh.ops.length} changes)
              </button>
            )}
          </>
        )}
      </div>
      <div className="agent-input">
        <textarea
          className="input textarea"
          rows={2}
          placeholder={busy ? 'Claude is working…' : 'Describe a change, e.g. “add a Subscription entity linked to Customer”'}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(text);
            }
          }}
        />
        {busy ? (
          <button className="icon-btn" title="Stop" onClick={cancel}>
            <Square size={14} />
          </button>
        ) : (
          <button className="icon-btn primary" title="Send (Enter)" disabled={!text.trim()} onClick={() => submit(text)}>
            <Send size={14} />
          </button>
        )}
      </div>
    </aside>
  );
}
