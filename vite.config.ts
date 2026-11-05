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
    watch: { ignored: ['**/models/**', '**/_archive/**', '**/bin/**', '**/cloud/.wrangler/**'] },
    // Shared workspaces in development: EM_CLOUD=http://localhost:8787 npm run dev, with `wrangler dev` running in cloud/.
    // Same origin for the app, so the session cookie and live connection work as they will on entitymodel.com.
    // changeOrigin: wrangler dev rewrites an Origin that matches the Host header, and the Worker would then refuse it.
    proxy: process.env.EM_CLOUD ? { '/api/cloud': { target: process.env.EM_CLOUD, ws: true, changeOrigin: true } } : undefined,
  },
});
