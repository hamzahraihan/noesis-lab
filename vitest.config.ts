import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Kept separate from vite.config.ts so engine tests never pay for the React
// compiler or JSX pipeline. The engine is plain TypeScript with no DOM needs.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});