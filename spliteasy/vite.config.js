import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import mockApi from './dev/mockApi.js';

// Served at apps.ranjithkumarmadhavan.com/spliteasy/
// In production the PHP APIs (public/api/ here, and the shared /api/auth.php from landing/)
// handle data; in dev an in-memory mock does.
export default defineConfig(({ mode }) => {
  // The mock auth API reads GOOGLE_CLIENT_ID from process.env; pick it up from .env files too.
  process.env.GOOGLE_CLIENT_ID ??= loadEnv(mode, process.cwd(), '').GOOGLE_CLIENT_ID ?? '';
  return {
    base: '/spliteasy/',
    plugins: [react(), mockApi()],
    server: { port: 5174, strictPort: true },
    build: { outDir: '../dist/spliteasy', emptyOutDir: true },
  };
});
