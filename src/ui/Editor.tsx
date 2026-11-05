import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { normalizeModel, serializeModel } from '../core';
import { useStore } from './store';
import { storage } from './storage';
import { Canvas } from './canvas/Canvas';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { CanvasToolbar } from './components/CanvasToolbar';
import { TablesView } from './components/TablesView';
import { IssuesView } from './components/IssuesView';
import { MappingsView } from './components/MappingsView';
import { GlossaryView } from './components/GlossaryView';
import { Inspector } from './inspector/Inspector';
import { PanelResizer } from './components/PanelResizer';
import { addEntityAtCenter, copySelection, deleteSelection, duplicateSelection, hideSelection, paste, selectAll, showAll } from './components/actions';
import { TabBar, TabDialogs } from './components/TabBar';
import { CommandPalette } from './components/CommandPalette';
import { useDialogs } from './dialogs';
import { useAgent } from './agent';
import { ProposalBanner, ProposalDialog } from './components/ProposalDialog';
import { WritebackDialog } from './components/WritebackDialog';
import { VersionHistoryDialog } from './components/VersionHistoryDialog';
import { usePresenceSync } from './presence';
import { isCloudId } from './storage/cloud';
import { AgentPanel } from './components/AgentPanel';

function ExternalBanner() {
  const ext = useStore((s) => s.externalModel);
  const shared = useStore((s) => isCloudId(s.modelId));
  const { acceptExternal, dismissExternal } = useStore.getState();
  if (!ext) return null;
  return (
    <div className="ext-banner">
      {shared ? 'Someone else saved this model' : storage.kind === 'files' ? 'The model file changed on disk (e.g. Claude edited it)' : 'This model changed in another tab'} while you had unsaved edits.
      <button className="btn sm primary" onClick={acceptExternal}>
        {shared ? 'Load their version' : storage.kind === 'files' ? 'Load disk version' : 'Load other version'}
      </button>
      <button className="btn sm ghost" onClick={dismissExternal}>
        Keep mine
      </button>
    </div>
  );
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (!s.model) return;
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        s.saveNow();
        return;
      }
      if (mod && e.key.toLowerCase() === 'j' && storage.agentTools?.canRun) {
        e.preventDefault();
        useAgent.getState().togglePanel();
        return;
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useDialogs.getState().open({ palette: !useDialogs.getState().palette });
        return;
      }
      if (typing || document.querySelector('.modal, .palette')) return;
      const onDiagram = s.view === 'diagram';
      if (mod) {
        const k = e.key.toLowerCase();
        // Copy/paste only take over when no text is selected on the page.
        if (k === 'c' && onDiagram && !window.getSelection()?.toString() && copySelection()) e.preventDefault();
        else if (k === 'v' && onDiagram) (e.preventDefault(), paste());
        else if (k === 'd' && onDiagram) (e.preventDefault(), duplicateSelection());
        else if (k === 'a' && onDiagram) (e.preventDefault(), selectAll());
        return;
      }
      if (e.key === 'Escape') {
        s.setTool('select');
        s.select({ kind: 'model' });
      } else if (e.key === 'r' || e.key === 'R') s.setTool(s.tool === 'relationship' ? 'select' : 'relationship');
      else if (e.key === 'v' || e.key === 'V') s.setTool('select');
      else if (e.key === 'e' || e.key === 'E') addEntityAtCenter('standard');
      else if (e.key === 'f') s.requestFit();
      else if (e.key.toLowerCase() === 'h') e.shiftKey ? showAll() : hideSelection();
      else if (e.key === '[') s.setDisplay({ showSidebar: !s.display.showSidebar });
      else if (e.key === ']') s.setDisplay({ showInspector: !s.display.showInspector });
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (deleteSelection()) e.preventDefault();
      } else if (e.key === 'Enter' && s.selection.kind !== 'model') s.setDisplay({ showInspector: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Live reload: storage tells us when a model changed outside this tab (file on disk edited by Claude or git, or another tab). */
function useLiveReload() {
  useEffect(() => {
    return storage.onChange(async (id) => {
      const s = useStore.getState();
      if (s.modelId !== id) return;
      try {
        const text = await storage.get(id);
        if (text === s.savedText) return;
        const m = normalizeModel(JSON.parse(text));
        if (s.doc && serializeModel({ ...m, updated_at: s.doc.updated_at }) === serializeModel(s.doc)) return;
        s.receiveExternal(m);
      } catch (e: any) {
        s.toast(`Could not reload model: ${e.message}`, 'error');
      }
    });
  }, []);
}

/** The open-model workspace. Loaded on demand so the home screen doesn't wait for the canvas. */
export function Editor() {
  const view = useStore((s) => s.view);
  const showSidebar = useStore((s) => s.display.showSidebar);
  const showInspector = useStore((s) => s.display.showInspector);
  useKeyboard();
  useLiveReload();
  usePresenceSync();

  return (
    <ReactFlowProvider>
      <div className="app">
        <Topbar />
        <ExternalBanner />
        <ProposalBanner />
        <div className="workspace">
          {showSidebar && (
            <>
              <Sidebar />
              <PanelResizer panel="sidebar" />
            </>
          )}
          <main className="main">
            {view === 'diagram' && (
              <>
                <CanvasToolbar />
                <Canvas />
              </>
            )}
            {view === 'tables' && <TablesView />}
            {view === 'issues' && <IssuesView />}
            {view === 'mappings' && <MappingsView />}
            {view === 'glossary' && <GlossaryView />}
          </main>
          {view === 'diagram' && showInspector && (
            <>
              <PanelResizer panel="inspector" />
              <Inspector />
            </>
          )}
        </div>
        {/* Diagram tabs sit under the work, like sheet tabs. */}
        <TabBar />
      </div>
      <TabDialogs />
      <ProposalDialog />
      <WritebackDialog />
      <VersionHistoryDialog />
      <AgentPanel />
      <CommandPalette />
    </ReactFlowProvider>
  );
}
