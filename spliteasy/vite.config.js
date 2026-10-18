import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import mockApi from './dev/mockApi.js';

// Served at apps.ranjithkumarmadhavan.com/spliteasy/
// In production the PHP APIs (public/api/ here, and the shared /api/auth.php from landing/)
// handle data; in dev (and `vite preview`) an in-memory mock does.

/** Emits sw.js from sw/sw.js with this build's version and list of files to precache. */
function serviceWorker() {
  return {
    name: 'spliteasy-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.html') && !f.endsWith('.map'));
      const precache = [...files, 'favicon.svg', 'manifest.webmanifest', 'icons/icon-192.png'].sort();
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./sw/sw.js', import.meta.url), 'utf8')
        .replaceAll('__VERSION__', version)
        .replaceAll('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The mock auth API reads GOOGLE_CLIENT_ID from process.env; pick it up from .env files too.
  process.env.GOOGLE_CLIENT_ID ??= loadEnv(mode, process.cwd(), '').GOOGLE_CLIENT_ID ?? '';
  return {
    base: '/spliteasy/',
    plugins: [react(), mockApi(), serviceWorker()],
    server: { port: 5174, strictPort: true },
    preview: { port: 4174, strictPort: true },
    build: { outDir: '../dist/spliteasy', emptyOutDir: true },
  };
});
