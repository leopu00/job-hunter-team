import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(__dirname, '../../web'),
    },
  },
  test: {
    include: ['config/**/*.test.ts', 'wizard/**/*.test.js', 'deploy/**/*.test.ts', 'assistant/**/*.test.ts', 'context-engine/**/*.test.ts', 'tasks/**/*.test.ts', 'events/**/*.test.ts', 'validators/**/*.test.ts', 'integration/**/*.test.ts', 'sessions/**/*.test.ts', 'queue/**/*.test.ts'],
    environment: 'node',
  },
});
