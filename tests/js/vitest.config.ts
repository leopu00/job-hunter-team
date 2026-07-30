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
    //
    // Il terzo è la stessa trappola un livello più in là: i test di
    // `shared/config/` (profile-schema + il cross-check zod ↔
    // shared/skills/validate_profile.py) usavano `node:test` e nessun job li
    // eseguiva. Il cross-check è un guard di drift TS ↔ Python: si rompe
    // proprio nelle PR che toccano il lato Python, dove pytest gira e questo
    // non girava. Sono stati convertiti a vitest per entrare qui.
    include: [
      "**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "../../web/lib/**/*.test.ts",
      "../../shared/**/*.test.ts",
    ],
    // `**/node_modules/**` è ancorato alla root del progetto (tests/js): non
    // copre i `node_modules` raggiunti risalendo con `../..`. Senza il secondo
    // pattern l'include di `shared/` raccoglie la suite interna di `zod`
    // (~1900 test di una dipendenza, 3 file rossi per pacchetti che non
    // installiamo) e la suite del repo sparisce nel rumore.
    exclude: ["**/node_modules/**", "../../**/node_modules/**"],
  },
});
