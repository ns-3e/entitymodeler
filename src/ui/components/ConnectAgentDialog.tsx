import { lazy, Suspense, useState } from 'react';
import { Check, ClipboardCopy } from '../icons';
import { useDialogs } from '../dialogs';
import { cloud, storage } from '../storage';
import { isCloudId } from '../storage/cloud';
import { useStore } from '../store';
import { Modal, Segmented } from './forms';
// Loads on first use, as it does on the home page.
const ClaudeDialog = lazy(() => import('./ClaudeDialog').then((m) => ({ default: m.ClaudeDialog })));

const URL = 'https://entitymodel.com/mcp';
const json = (entry: object) => JSON.stringify({ mcpServers: entry }, null, 2);

type Client = 'claude-code' | 'codex' | 'claude-app' | 'other';
const CLIENTS: { value: Client; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'claude-app', label: 'Claude app' },
  { value: 'other', label: 'Cursor, others' },
];

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useStore((s) => s.toast);
  const lines = text.split('\n').length;
  return (
    <div className="copy-line">
      {lines > 1 ? (
        <textarea className="input textarea mono" readOnly rows={lines} value={text} aria-label="Text to copy" />
      ) : (
        <input className="input mono" readOnly value={text} aria-label="Text to copy" onFocus={(e) => e.target.select()} />
      )}
      <button
        className="btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            toast('Could not copy — your browser blocked clipboard access.', 'error');
          }
        }}
      >
        {copied ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function ClientPicker({ children }: { children: (client: Client) => React.ReactNode }) {
  const [client, setClient] = useState<Client>('claude-code');
  return (
    <section>
      <Segmented<Client> size="sm" value={client} onChange={setClient} options={CLIENTS} />
      {children(client)}
    </section>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => <p className="muted small">{children}</p>;

function Hosted({ intro }: { intro: string }) {
  return (
    <>
      <p>{intro}</p>
      <ClientPicker>
        {(client) => (
          <>
            {client === 'claude-code' && (
              <>
                <CopyLine text={`claude mcp add --transport http entitymodel ${URL}`} />
                <Note>Then run /mcp in Claude Code and choose Authenticate.</Note>
              </>
            )}
            {client === 'codex' && (
              <>
                <CopyLine text={`codex mcp add entitymodel --url ${URL}`} />
                <Note>If your browser doesn’t open to sign in, run codex mcp login entitymodel. This needs a recent Codex: sign-in fails on 0.146 and works on 0.167.</Note>
              </>
            )}
            {client === 'claude-app' && (
              <>
                <CopyLine text={URL} />
                <Note>On claude.ai or in the desktop app, add a custom connector in your connector settings, with this address.</Note>
              </>
            )}
            {client === 'other' && (
              <>
                <CopyLine text={json({ entitymodel: { url: URL } })} />
                <Note>In Cursor, this goes in mcp.json. Other apps that support remote MCP servers usually take the same address.</Note>
              </>
            )}
          </>
        )}
      </ClientPicker>
      <Note>You’ll sign in and choose what the agent can do. Then ask it something like “add a loyalty tier to Customer”. Its proposals appear on the model for you to review. Manage connections under Account in Shared workspaces on the home page.</Note>
    </>
  );
}

function Local() {
  return (
    <>
      <p>Your agent works on the model files in your models folder, with no account. What it proposes appears on this model for you to review.</p>
      <ClientPicker>
        {(client) => (
          <>
            {client === 'claude-code' && <CopyLine text="claude mcp add entity-modeler -- npx -y entitymodeler mcp" />}
            {client === 'codex' && <CopyLine text="codex mcp add entity-modeler -- npx -y entitymodeler mcp" />}
            {(client === 'claude-app' || client === 'other') && <CopyLine text={json({ 'entity-modeler': { command: 'npx', args: ['-y', 'entitymodeler', 'mcp'] } })} />}
            <Note>Run it from your project folder, which holds or will hold models/. In a clone of the repository, Claude Code already has it registered.</Note>
          </>
        )}
      </ClientPicker>
    </>
  );
}

/** How to reach a model from an AI agent. Agents connect from their own apps, so what to do depends on where the model lives. */
export function ConnectAgentDialog() {
  const open = useDialogs((s) => s.agents);
  const modelId = useStore((s) => s.modelId);
  const doc = useStore((s) => s.doc);
  const [pasting, setPasting] = useState(false);
  if (pasting && doc) {
    return (
      <Suspense fallback={null}>
        <ClaudeDialog model={doc} onClose={() => setPasting(false)} />
      </Suspense>
    );
  }
  if (!open) return null;
  const close = () => useDialogs.getState().close('agents');
  const shared = isCloudId(modelId);
  const inBrowser = !shared && storage.kind === 'browser';
  // Opened from the home page: the instructions, with no particular model.
  const home = !modelId;
  const browserOnly = inBrowser && !home;
  return (
    <Modal
      title="Connect an agent"
      onClose={close}
      width={620}
      footer={
        <>
          <a className="btn ghost" href="/docs/mcp-server/" target="_blank" rel="noreferrer">
            How this works
          </a>
          <span className="spacer" />
          {browserOnly && cloud && (
            <button
              className="btn"
              onClick={() => {
                close();
                useStore.getState().closeModel();
              }}
            >
              Go to Shared workspaces
            </button>
          )}
          {browserOnly && (
            <button
              className="btn primary"
              onClick={() => {
                close();
                setPasting(true);
              }}
            >
              Edit with Claude
            </button>
          )}
          <button className="btn" onClick={close}>
            Close
          </button>
        </>
      }
    >
      <div className="claude-steps">
        {shared && <Hosted intro="Your agent connects from its own app and works on this model under your account." />}
        {home && inBrowser && <Hosted intro="Claude, Codex, Cursor and other MCP apps can work on the models in your shared workspaces. Models only in this browser stay out of reach." />}
        {!shared && !inBrowser && <Local />}
        {browserOnly && (
          <>
            <p>This model is only in this browser, so an agent can’t connect to it. You have two options.</p>
            <section>
              <h4>Copy and paste</h4>
              <Note>Edit with Claude gives you a prompt to paste into Claude, then you paste its reply back here. Nothing is uploaded except what you paste.</Note>
            </section>
            <section>
              <h4>Connect an agent</h4>
              <Note>{cloud ? 'Add a copy to a shared workspace: on the home page, sign in and choose Add a model in a workspace. Open the copy, then choose Connect agent there.' : 'Export the model to a models folder on your computer, and run the local server.'}</Note>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
