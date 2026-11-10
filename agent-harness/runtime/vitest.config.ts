import os from "node:os";
import { defineConfig } from "vitest/config";
import { maxWorkers } from "./vitest.workers.ts";

// The cap for both pools (the default pool of vitest 2 is `forks`): see vitest.workers.ts.
const workers = maxWorkers(process.env, os.cpus().length);

export default defineConfig({
  test: {
    poolOptions: {
      forks: { maxForks: workers, minForks: 1 },
      threads: { maxThreads: workers, minThreads: 1 },
    },
  },
});
