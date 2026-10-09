import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at the root of apps.ranjithkumarmadhavan.com; builds first and owns ../dist.
// public/api/ holds the shared account API (auth.php) used by every app on the site.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true },
});
