import { WorkspacesSection } from './Workspaces';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Download, FileInput, FileJson, FolderOpen, HardDrive, Plus, Sparkles, Trash2, Workflow } from '../icons';
import { createModel, decodeShareFragment, isShareFragment, normalizeModel, toInternalName, type DataModel, type ModelSummary } from '../../core';
import { storage } from '../storage';
import { useStore } from '../store';
import demoText from '../../../models/customer-demo/model.json?raw';
import { Field, Modal, TextArea, TextInput } from './forms';
import { Logo } from './Logo';
import { shareCounts } from './ShareDialog';
import { createAndOpen, installApp, openModelFile, useInstall } from '../install';

const ClaudeDialog = lazy(() => import('./ClaudeDialog').then((m) => ({ default: m.ClaudeDialog })));
const ImportDialog = lazy(() => import('./ImportDialog').then((m) => ({ default: m.ImportDialog })));

const toId = (s: string) => toInternalName(s).replace(/_/g, '-').slice(0, 60);

/** Three planes and a fourth drawn as a dashed gap: the place the person's work goes. */
function MissingPlane() {
  return (
    <svg width="160" height="100" viewBox="0 0 160 100" fill="none" strokeLinejoin="miter" aria-hidden>
      <polygon points="10,60 60,20 90,70 40,92" fill="var(--plane-2)" stroke="var(--contour)" strokeWidth="1.5" />
      <polygon points="60,20 120,12 140,58 90,70" fill="var(--plane-3)" stroke="var(--contour)" strokeWidth="1.5" />
      <polygon points="90,70 140,58 150,90 100,96" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="5 4" />
    </svg>
  );
}

export function ModelHome() {
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', organization: '', description: '' });
  const [dragging, setDragging] = useState(false);
  const [designing, setDesigning] = useState(false);
  const [importing, setImporting] = useState(false);
  const jsonInput = useRef<HTMLInputElement>(null);
  const { openModel, toast } = useStore.getState();
  const canInstall = useInstall((s) => !!s.prompt && !s.standalone);

  const refresh = () =>
    storage
      .list()
      .then(setModels)
      .catch((e) => toast(e.message, 'error'));
  useEffect(() => {
    refresh();
    return storage.onChange(() => refresh());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Share links (#/share/…) carry a whole model; offer to open a copy.
  const [shared, setShared] = useState<{ model?: DataModel; error?: string } | null>(null);
  useEffect(() => {
    const check = () => {
      if (!isShareFragment(location.hash)) return;
      decodeShareFragment(location.hash)
        .then((model) => setShared({ model }))
        .catch((e) => setShared({ error: e.message }));
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);
  const dismissShared = () => {
    setShared(null);
    history.replaceState(null, '', '#/');
  };

  const create = async () => {
    const m = createModel(toInternalName(form.title), form.title.trim(), { organization: form.organization.trim(), description: form.description.trim() });
    try {
      await createAndOpen(m, form.title);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const openJson = async (files: FileList | null) => {
    const f = files?.[0];
    if (f) await openModelFile(f);
  };

  const openDemo = () => createAndOpen(normalizeModel(JSON.parse(demoText)), 'customer-demo').catch((e) => toast(e.message, 'error'));

  // The installed app's shortcuts (manifest "shortcuts") open /?action=new and /?action=demo.
  useEffect(() => {
    const action = new URLSearchParams(location.search).get('action');
    if (!action) return;
    history.replaceState(null, '', location.pathname + location.hash);
    if (action === 'new') setCreating(true);
    else if (action === 'demo' && storage.kind === 'browser') openDemo();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (m: ModelSummary) => {
    if (!storage.remove || !window.confirm(`Delete "${m.title}" from this browser? This cannot be undone — export the model file first if you want a copy.`)) return;
    try {
      await storage.remove(m.id);
      refresh();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  return (
    <div
      className={`home${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        openJson(e.dataTransfer.files);
      }}
    >
      <header className="home-head">
        <Logo />
        <div>
          <h1>
            EntityModel<em>.com</em>
          </h1>
          <p className="muted">
            Design entity-relationship models, then export diagrams, PDFs and design-doc tables. <a href="/docs/">Read the docs</a>
          </p>
        </div>
        {canInstall && (
          <button className="btn home-install" onClick={installApp} title="Install EntityModel.com as an app on this computer. It opens in its own window and works offline.">
            <Download size={16} /> Install app
          </button>
        )}
      </header>
      <div className="home-actions">
        <button className="home-card action primary" onClick={() => setCreating(true)}>
          <Plus size={22} />
          <b>New model</b>
          <span>Start from a blank canvas</span>
        </button>
        <button className="home-card action" onClick={() => jsonInput.current?.click()}>
          <FileJson size={22} />
          <b>Open model file</b>
          <span>A model .json file — or drop one anywhere on this page</span>
        </button>
        <button className="home-card action" onClick={() => setImporting(true)}>
          <FileInput size={22} />
          <b>Import SQL or DBML</b>
          <span>CREATE TABLE scripts (Postgres, MySQL, Snowflake, Databricks) or dbdiagram.io files</span>
        </button>
        <button className="home-card action" onClick={() => setDesigning(true)}>
          <Sparkles size={22} />
          <b>Design with Claude</b>
          <span>Copy a ready-made prompt into Claude, paste back the model it writes</span>
        </button>
        {storage.kind === 'browser' && (
          <button className="home-card action" onClick={openDemo}>
            <Workflow size={22} />
            <b>Open the demo</b>
            <span>A customer model for an outdoor retailer: accounts, contacts and orders, with reference lists and a hierarchy</span>
          </button>
        )}
      </div>
      {shared && (
        <Modal
          title={shared.model ? 'Shared model' : 'Could not open the shared link'}
          onClose={dismissShared}
          footer={
            <>
              <span className="spacer" />
              <button className="btn ghost" onClick={dismissShared}>
                {shared.model ? 'Cancel' : 'Close'}
              </button>
              {shared.model && (
                <button
                  className="btn primary"
                  onClick={() => {
                    const m = shared.model!;
                    setShared(null);
                    createAndOpen(m, m.name || m.title).catch((e) => toast(e.message, 'error'));
                  }}
                >
                  Open a copy
                </button>
              )}
            </>
          }
        >
          {shared.model ? (
            <div className="stack">
              <p>
                <b>{shared.model.title}</b>
                {shared.model.organization ? ` · ${shared.model.organization}` : ''} — {shareCounts(shared.model)}.
              </p>
              {shared.model.description && <p className="muted">{shared.model.description}</p>}
              <p className="muted small">Opening saves a copy {storage.kind === 'browser' ? 'in this browser' : 'in your models/ folder'}. Changes you make are yours; the person who shared it won't see them.</p>
            </div>
          ) : (
            <p>{shared.error}</p>
          )}
        </Modal>
      )}
      <Suspense fallback={null}>
        {importing && <ImportDialog onCreate={(m) => createAndOpen(m, m.name || m.title)} onClose={() => setImporting(false)} />}
        {designing && <ClaudeDialog onCreate={(m) => createAndOpen(m, m.name || m.title)} onClose={() => setDesigning(false)} />}
      </Suspense>
      <input ref={jsonInput} type="file" accept=".json" hidden onChange={(e) => openJson(e.target.files)} />

      <h2 className="home-section">
        {storage.kind === 'files' ? (
          <>
            <FolderOpen size={16} /> Models <span className="muted small mono">{storage.location}</span>
          </>
        ) : (
          <>
            <HardDrive size={16} /> Models <span className="muted small">stored in this browser</span>
          </>
        )}
      </h2>
      {storage.kind === 'browser' && (
        <p className="muted small home-note">Models live only in this browser. To back one up or move it to another device, open it and use Export → Model file.</p>
      )}
      <div className="model-grid">
        {models?.map((m) => (
          <div key={m.id} className="model-card-wrap">
            <button className="model-card" onClick={() => openModel(m.id).catch((e) => toast(e.message, 'error'))}>
              <div className="mc-colors">
                {(m.colors || []).map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </div>
              <div className="mc-title">{m.title}</div>
              <div className="mc-org">{m.organization || <span className="muted">No organization</span>}</div>
              {m.error ? (
                <div className="callout error small">{m.error}</div>
              ) : (
                <div className="mc-stats">
                  <span>
                    <b>{m.standard}</b> entities
                  </span>
                  <span>
                    <b>{m.references}</b> reference
                  </span>
                  <span>
                    <b>{m.relationships}</b> rel
                  </span>
                </div>
              )}
              <div className="mc-foot">
                <span className={`pill status-${(m.status || 'draft').replace(' ', '-')}`}>{m.status}</span>
                <span className="muted small">{m.updated_at ? new Date(m.updated_at).toLocaleString() : ''}</span>
              </div>
            </button>
            {storage.remove && (
              <button className="icon-btn danger model-delete" title="Delete model" onClick={() => remove(m)}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        {models && !models.length && (
          <div className="model-empty">
            <MissingPlane />
            <h3>No models yet</h3>
            <p>Create one, open a model file{storage.kind === 'browser' ? ', or open the demo' : ''}. Your models show up here.</p>
          </div>
        )}
      </div>

      <WorkspacesSection localModels={models || []} />

      <footer className="home-foot">
        © {new Date().getFullYear()}{' '}
        <a href="https://advsys.io" target="_blank" rel="noopener">
          Smith Advanced Systems LLC
        </a>
        . Free and open source under the MIT license.
      </footer>

      {creating && (
        <Modal
          title="New data model"
          onClose={() => setCreating(false)}
          footer={
            <>
              {storage.kind === 'files' && <span className="muted small mono">models/{toId(form.title) || '…'}/</span>}
              <span className="spacer" />
              <button className="btn ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn primary" disabled={!form.title.trim()} title={form.title.trim() ? undefined : 'Give the model a title.'} onClick={create}>
                Create
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Model title">
              <TextInput autoFocus value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Acme Orders" />
            </Field>
            <Field label="Organization">
              <TextInput value={form.organization} onChange={(v) => setForm({ ...form, organization: v })} placeholder="Acme Corp" />
            </Field>
            <Field label="Description">
              <TextArea value={form.description} onChange={(v) => setForm({ ...form, description: v })} rows={3} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
