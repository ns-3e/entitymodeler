import { lazy, Suspense, useState } from 'react';
import { ArrowLeftRight, BookOpen, ChevronLeft, CircleX, Cloud, CloudOff, Command, Download, History, Loader2, Moon, PanelLeft, PanelRight, Redo2, Sparkles, Sun, FileInput, Link2, Table, TriangleAlert, Undo2, Workflow, ListChecks } from '../icons';
import { issueCounts } from '../../core';
import { useStore } from '../store';
import { storage } from '../storage';
import { isCloudId } from '../storage/cloud';
import { useDialogs } from '../dialogs';
import { useAgent } from '../agent';
import { ImportDialog } from './ImportDialog';
import { ShareDialog } from './ShareDialog';
import { Logo } from './Logo';
import { PresenceBar } from './PresenceBar';
// Export code (jsPDF, html-to-image, fonts) loads on first use, not with the app.
const ExportDialog = lazy(() => import('./ExportDialog').then((m) => ({ default: m.ExportDialog })));

export function Topbar() {
  const model = useStore((s) => s.model)!;
  const doc = useStore((s) => s.doc)!;
  const view = useStore((s) => s.view);
  const saveState = useStore((s) => s.saveState);
  const issues = useStore((s) => s.issues);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const theme = useStore((s) => s.display.theme);
  const showSidebar = useStore((s) => s.display.showSidebar);
  const showInspector = useStore((s) => s.display.showInspector);
  const { setView, undo, redo, closeModel, setDisplay } = useStore.getState();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const agentOpen = useAgent((s) => s.panel);
  const c = issueCounts(issues);

  return (
    <header className="topbar">
      <button className={`icon-btn${showSidebar ? ' active' : ''}`} title={`${showSidebar ? 'Hide' : 'Show'} left sidebar ([)`} onClick={() => setDisplay({ showSidebar: !showSidebar })}>
        <PanelLeft size={16} />
      </button>
      <button className="icon-btn" title="All models" onClick={() => closeModel()}>
        <ChevronLeft size={18} />
      </button>
      <span className="tb-wide">
        <Logo />
      </span>
      <div className="tb-title tb-wide">
        <div className="tb-name">{model.title}</div>
        <div className="tb-sub">
          {model.organization || 'EntityModel.com'}
          {model.version ? ` · v${model.version}` : ''}
        </div>
      </div>
      <nav className="tb-views">
        <button className={view === 'diagram' ? 'active' : ''} onClick={() => setView('diagram')} title="Diagram">
          <Workflow size={16} /> <span className="tb-label tb-view-label">Diagram</span>
        </button>
        <button className={view === 'tables' ? 'active' : ''} onClick={() => setView('tables')} title="Tables">
          <Table size={16} /> <span className="tb-label tb-view-label">Tables</span>
        </button>
        <button className={view === 'mappings' ? 'active' : ''} onClick={() => setView('mappings')} title="Source-to-target mappings between tabs">
          <ArrowLeftRight size={16} /> <span className="tb-label tb-view-label">Mappings</span>
        </button>
        <button className={view === 'glossary' ? 'active' : ''} onClick={() => setView('glossary')} title="Shared business glossary">
          <BookOpen size={16} /> <span className="tb-label tb-view-label">Glossary</span>
        </button>
        <button className={view === 'issues' ? 'active' : ''} onClick={() => setView('issues')} title="Issues">
          <ListChecks size={16} /> <span className="tb-label tb-view-label">Issues</span>
          {c.error > 0 ? (
            <span className="badge error">
              <CircleX size={12} />
              {c.error}
            </span>
          ) : c.warning > 0 ? (
            <span className="badge warning">
              <TriangleAlert size={12} />
              {c.warning}
            </span>
          ) : null}
        </button>
      </nav>
      <span className="spacer" />
      <div className="tb-group tb-wide">
        <button className="icon-btn" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)">
          <Undo2 size={16} />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={redo} title="Redo (⌘⇧Z)">
          <Redo2 size={16} />
        </button>
      </div>
      <span className={`save-state ${saveState}`} title={saveState === 'error' ? 'Save failed' : storage.kind === 'files' ? 'Saved to models/ folder' : 'Saved in this browser'}>
        {saveState === 'saved' && <Cloud size={14} />}
        {(saveState === 'pending' || saveState === 'saving') && <Loader2 size={14} className="spin" />}
        {saveState === 'error' && <CloudOff size={14} />}
        <span className="tb-label tb-act-label">{saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : 'Saving'}</span>
      </span>
      <button className="icon-btn tb-wide" title="Toggle theme" onClick={() => setDisplay({ theme: theme === 'dark' ? 'light' : 'dark' })}>
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button className="icon-btn tb-wide" title="Import SQL or DBML into this model" onClick={() => setImporting(true)}>
        <FileInput size={16} />
      </button>
      {storage.agentTools?.canRun && (
        <button className={`btn${agentOpen ? ' active' : ''}`} title="Ask Claude to change this model; you review a proposal (⌘J)" onClick={() => useAgent.getState().togglePanel()}>
          <Sparkles size={16} /> <span className="tb-label tb-act-label">Ask Claude</span>
        </button>
      )}
      <PresenceBar />
      {isCloudId(useStore.getState().modelId) && (
        <button className="icon-btn tb-wide" title="Version history: earlier saves of this model" onClick={() => useDialogs.getState().open({ history: true })}>
          <History size={16} />
        </button>
      )}
      <button className="btn" title="Share a link to a copy of this model (nothing is uploaded)" onClick={() => setSharing(true)}>
        <Link2 size={16} /> <span className="tb-label tb-act-label">Share</span>
      </button>
      <button className="icon-btn" title="Command palette: jump to anything, run any action (⌘K)" onClick={() => useDialogs.getState().open({ palette: true })}>
        <Command size={16} />
      </button>
      <button className="btn primary" onClick={() => setExporting(true)}>
        <Download size={16} /> <span className="tb-label tb-export-label">Export</span>
      </button>
      <button
        className={`icon-btn${showInspector ? ' active' : ''}`}
        title={view !== 'diagram' ? 'The inspector is part of the diagram view.' : `${showInspector ? 'Hide' : 'Show'} inspector (])`}
        disabled={view !== 'diagram'}
        onClick={() => setDisplay({ showInspector: !showInspector })}
      >
        <PanelRight size={16} />
      </button>
      {importing && <ImportDialog model={model} onClose={() => setImporting(false)} />}
      {sharing && <ShareDialog model={doc} onClose={() => setSharing(false)} />}
      {exporting && (
        <Suspense fallback={null}>
          <ExportDialog onClose={() => setExporting(false)} />
        </Suspense>
      )}
    </header>
  );
}
