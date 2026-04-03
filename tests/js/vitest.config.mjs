import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      grammy: path.join(__dirname, 'telegram-stubs/grammy.ts'),
      '@grammyjs/auto-retry': path.join(__dirname, 'telegram-stubs/grammy-auto-retry.ts'),
      '@grammyjs/runner': path.join(__dirname, 'telegram-stubs/grammy-runner.ts'),
    },
  },
  test: {
    include: ['config/**/*.test.ts', 'wizard/**/*.test.js', 'telegram/**/*.test.ts', 'deploy/**/*.test.ts', 'assistant/**/*.test.ts', 'tasks/**/*.test.ts'],
    environment: 'node',
  },
});
