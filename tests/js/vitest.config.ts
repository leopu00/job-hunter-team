import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// L'alias `@` → `web/` serve ai test che importano moduli dell'app (es.
// tasks/demo-*.test.ts su `@/lib/demo/...`): senza, l'import non risolve e il
// file fallisce in blocco prima di eseguire un singolo test — modo silenzioso
// di perdere copertura.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(__dirname, "../../web"),
    },
  },
  test: {
    exclude: ["**/node_modules/**"],
  },
});
