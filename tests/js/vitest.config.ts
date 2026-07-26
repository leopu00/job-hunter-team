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
    // Il primo pattern è il default di vitest (i test sotto tests/js). Il
    // secondo raccoglie i test che vivono accanto al sorgente in `web/lib`:
    // stavano lì da sempre ma nessun runner li includeva — verdi per
    // definizione perché mai eseguiti. Il default `include` è relativo a
    // questa cartella e non risale, quindi il path esplicito serve.
    include: [
      "**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "../../web/lib/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**"],
  },
});
