import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ⚠️ Questo è il config che Vitest usa davvero: con `vitest.config.ts` e
// `vitest.config.mjs` entrambi presenti, la risoluzione preferisce il `.ts`.
// `npm test` (e il job vitest della CI) passano da qui — il `.mjs` accanto è
// un config alternativo non invocato da nessun workflow.
//
// L'alias `@` → `web/` è lo stesso del `.mjs` e serve ai test che importano
// moduli dell'app (es. tasks/demo-*.test.ts su `@/lib/demo/...`): senza,
// l'import non risolve e il file fallisce in blocco prima di eseguire un
// singolo test — modo silenzioso di perdere copertura.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(__dirname, "../../web"),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/_disabled/**"],
  },
});
