import { lazy, Suspense, useEffect } from 'react';
import { isShareFragment } from '../core';
import { useStore } from './store';
import { useGlossarySync } from './glossary';
import { ModelHome } from './components/ModelHome';
import { useAgentSync } from './agent';
import { CircleCheck, CircleX, Info } from './icons';

const loadEditor = () => import('./Editor');
const Editor = lazy(() => loadEditor().then((m) => ({ default: m.Editor })));

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.kind === 'error' ? <CircleX size={16} /> : t.kind === 'success' ? <CircleCheck size={16} /> : <Info size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const model = useStore((s) => s.model);
  const theme = useStore((s) => s.display.theme);
  useAgentSync();
  useGlossarySync();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const m = location.hash.match(/^#\/model\/(.+)$/);
    if (m) useStore.getState().openModel(decodeURIComponent(m[1])).catch(() => history.replaceState(null, '', '#/'));
    // A share link pasted into an open tab: go home, where the link is offered as a copy.
    const onHash = () => isShareFragment(location.hash) && useStore.getState().model && useStore.getState().closeModel(false);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Fetch the editor once the home screen is idle, so opening a model doesn't wait on the download.
  useEffect(() => {
    const t = setTimeout(() => loadEditor().catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    document.title = model ? `${model.title} — EntityModel.com` : 'EntityModel.com — free, open-source data modeling and ER diagram tool';
  }, [model?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!model)
    return (
      <>
        <ModelHome />
        <Toasts />
      </>
    );

  return (
    <>
      <Suspense fallback={<div className="app" />}>
        <Editor />
      </Suspense>
      <Toasts />
    </>
  );
}
