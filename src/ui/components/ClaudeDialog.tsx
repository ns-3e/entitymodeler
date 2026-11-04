import { useMemo, useRef, useState } from 'react';
import { Check, ClipboardCopy, Download, ExternalLink, FileJson, Sparkles } from '../icons';
import type { DataModel } from '../../core';
import { buildPrompt, skillFiles, SKILL_NAME } from '../claude/prompt';
import { prepareIncoming, type Incoming } from '../claude/apply';
import { downloadBlob } from '../download';
import { storage } from '../storage';
import { useStore } from '../store';
import { zipText } from '../zip';
import { Modal, TextArea } from './forms';

/**
 * Round trip through Claude: copy a prompt (instructions + format + current model), paste the reply back.
 * With `model` it updates that model (one undoable step); without, `onCreate` receives a new model.
 */
export function ClaudeDialog({ model, onCreate, onClose }: { model?: DataModel; onCreate?: (m: DataModel) => Promise<void>; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const [request, setRequest] = useState('');
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const prompt = useMemo(() => buildPrompt({ model, request }), [model, request]);
  const parsed = useMemo((): { ok: Incoming } | { error: string } | null => {
    if (!reply.trim()) return null;
    try {
      return { ok: prepareIncoming(reply, model) };
    } catch (e: any) {
      return { error: e.message || String(e) };
    }
  }, [reply, model]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy — your browser blocked clipboard access.', 'error');
    }
  };

  const apply = async () => {
    if (!parsed || !('ok' in parsed)) return;
    setBusy(true);
    try {
      if (model) {
        useStore.getState().replaceModel(parsed.ok.model);
        toast('Applied Claude’s changes. Undo (⌘Z) to revert.', 'success');
      } else await onCreate?.(parsed.ok.model);
      onClose();
    } catch (e: any) {
      toast(e.message || String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const ok = parsed && 'ok' in parsed ? parsed.ok : null;
  const kb = Math.max(1, Math.round(new Blob([prompt]).size / 1024));

  return (
    <Modal
      title={
        <>
          <Sparkles size={16} /> {model ? 'Edit with Claude' : 'Design with Claude'}
        </>
      }
      onClose={onClose}
      width={720}
      footer={
        <>
          <span className="muted small">{ok ? `${ok.model.entities.length} entities · ${ok.model.relationships.length} relationships` : 'Paste Claude’s reply in step 3 to continue.'}</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ok || busy} title={!ok ? 'Paste the model Claude wrote first.' : undefined} onClick={apply}>
            {model ? 'Apply changes' : 'Create model'}
          </button>
        </>
      }
    >
      <div className="claude-steps">
        <section>
          <h4>
            <span className="step">1</span> Describe {model ? 'the change' : 'the model'} <span className="muted small">(optional — you can also type it in Claude)</span>
          </h4>
          <TextArea
            rows={3}
            value={request}
            onChange={setRequest}
            placeholder={model ? 'e.g. Add a Subscription entity linked to Customer, with start/end dates and a plan reference list' : 'e.g. Customers, orders and products for an online store, with order status and country reference lists'}
          />
        </section>

        <section>
          <h4>
            <span className="step">2</span> Copy the prompt into Claude
          </h4>
          <div className="row-actions">
            <button className="btn primary" onClick={copy}>
              {copied ? <Check size={16} /> : <ClipboardCopy size={16} />} {copied ? 'Copied' : 'Copy prompt'}
            </button>
            <a className="btn" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} /> Open Claude
            </a>
            <span className="muted small">
              {kb} KB — instructions, the file format{model ? ' and your current model' : ''}
            </span>
          </div>
          <details className="claude-skill">
            <summary>Use it often? Add the EntityModel.com skill to Claude instead</summary>
            <p className="muted small">
              The skill teaches Claude the model format once, so you only attach your model file (Export → Model file) and ask for changes.
            </p>
            <ol className="muted small">
              <li>
                <button className="link" onClick={() => downloadBlob(zipText(skillFiles()), `${SKILL_NAME}-skill.zip`, 'application/zip')}>
                  <Download size={12} /> Download the skill (.zip)
                </button>
              </li>
              <li>
                In Claude (claude.ai or the desktop app), open <b>Customize → Skills</b>, click <b>+</b>, then <b>Upload a skill</b> and choose the zip.
              </li>
              <li>
                In Claude Code, unzip it into <span className="mono">~/.claude/skills/</span> instead.
              </li>
            </ol>
          </details>
        </section>

        <section>
          <h4>
            <span className="step">3</span> Paste Claude’s reply
            <button className="link small" onClick={() => fileInput.current?.click()}>
              <FileJson size={12} /> or open the .json file it made
            </button>
          </h4>
          <TextArea rows={6} mono value={reply} onChange={setReply} placeholder="Paste the whole reply — the JSON block is picked out automatically." />
          <input
            ref={fileInput}
            type="file"
            accept=".json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setReply(await f.text());
              e.target.value = '';
            }}
          />
          {parsed && 'error' in parsed && <div className="callout error small">{parsed.error}</div>}
          {ok && (
            <div className={`callout small ${ok.issues.error ? 'warning' : 'success'}`}>
              {model ? (
                <ul className="claude-changes">
                  {ok.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : (
                <div>
                  <b>{ok.model.title}</b> — {ok.model.entities.length} entities, {ok.model.relationships.length} relationships
                </div>
              )}
              <div>
                Validation: {ok.issues.error} error(s), {ok.issues.warning} warning(s){ok.issues.error ? ' — you can apply and fix them in the Issues view, or ask Claude to fix them.' : '.'}
              </div>
            </div>
          )}
        </section>

        {storage.kind === 'files' && (
          <p className="muted small">
            Running locally? Claude Code can also edit <span className="mono">models/&lt;id&gt;/model.json</span> directly with the skills in <span className="mono">.claude/skills/</span>; this page reloads as it changes.
          </p>
        )}
      </div>
    </Modal>
  );
}
