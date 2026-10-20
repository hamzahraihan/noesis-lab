import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  // The React Compiler is deliberately off. The bench model is mutable and
  // lives outside React, so a footprint's output depends on state the compiler
  // cannot see change through object identity. It pinned stale pixels to the
  // canvas while the rest of the UI kept updating -- a blank OLED next to a
  // running status bar. Correctness wins over the memoisation here.
  plugins: [tailwindcss(), react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  /*
   * Where the dependency cache goes.
   *
   * The cache is rewritten on every dev-server start, which is a lot of writes
   * for a machine that has a second drive. `VITE_CACHE_DIR` moves it; unset, it
   * stays in `node_modules/.vite` where it has always been. The *bundle* is
   * not relocatable: `dist` is the deployable artifact, and the hosting story
   * expects it at that path.
   */
  cacheDir: process.env.VITE_CACHE_DIR,
  // Every Worker in the app is constructed with `{ type: 'module' }` and the
  // sim worker's graph carries dynamic imports (the wasm seam), which the
  // default iife worker format cannot represent under rolldown -- it fails
  // the production build instead of inlining the way rollup did. Emit ES
  // worker bundles so code splitting matches both the constructors and the
  // app bundle's own format.
  worker: { format: 'es' },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
