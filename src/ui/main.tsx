import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/schibsted-grotesk/latin-400.css';
import '@fontsource/schibsted-grotesk/latin-500.css';
import '@fontsource/schibsted-grotesk/latin-600.css';
import '@fontsource/dm-serif-display/latin-400.css';
import '@fontsource/dm-serif-display/latin-400-italic.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App';
import { initStorage } from './storage';
import { registerServiceWorker } from './pwa';
import { initInstall } from './install';

initStorage().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  registerServiceWorker();
  initInstall();
});
