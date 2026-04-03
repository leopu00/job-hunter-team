import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['config/**/*.test.ts', 'wizard/**/*.test.js'],
    environment: 'node',
  },
});
