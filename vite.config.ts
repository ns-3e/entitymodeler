import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { modelApi } from './src/server/api';
import { serviceWorker } from './src/server/pwa';
import { docsSite } from './src/server/docs';

export default defineConfig({
  plugins: [react(), modelApi(__dirname), serviceWorker(), docsSite(__dirname)],
  server: {
    port: 5180,
    // Model files change underneath the app (Claude edits them); the API pushes those as events instead of page reloads.
    watch: { ignored: ['**/models/**', '**/_archive/**', '**/bin/**'] },
  },
});
