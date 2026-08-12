import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Fuori dalla CI il pool si limita a metà dei core, non al default (~core−1).
 *
 * Sulla macchina di sviluppo (12 core, disco che è già il collo di bottiglia
 * documentato) il default significa ~11 processi fork che spawnano node,
 * transformano TypeScript e scrivono SQLite in tmpdir TUTTI INSIEME, sullo
 * stesso disco. I sintomi raccolti nei log del 2026-08-11/12 sono tutti
 * forme della stessa starvation, non difetti dei file che la subiscono:
 *
 *   - 4 file morti INTERI con «Failed to start forks worker: Timeout
 *     waiting for worker to respond» — il fork non parte entro il limite;
 *   - `cloud-restore`: «Hook timed out in 10000ms» su un beforeEach che a
 *     macchina scarica sta sotto il secondo (mkdtemp + DDL su disco);
 *   - `positions-sort-pagination`: «Test timed out in 5000ms» su un test
 *     sincrono che a vuoto costa 4ms — inflazione di tre ordini di grandezza;
 *   - tempi cumulativi transform/environment (135s/141s) molte volte sopra
 *     il wall-clock (89s): i worker passano il tempo a contendersi I/O.
 *
 * Quale file cade è una lotteria: per questo un budget più largo NEI file
 * colpiti nasconderebbe il guasto invece di toglierlo. Metà dei core (6 qui)
 * raddoppia la banda disco per worker e riporta il profilo locale vicino a
 * quello della CI (runner a 4 core, dove queste morti non si vedono). In CI
 * il default resta intatto di proposito: lì il dimensionamento va bene ed è
 * un ambiente che non ha il nostro disco. */
const localMaxWorkers = Math.max(2, Math.floor(os.cpus().length / 2));

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
    ...(process.env.CI ? {} : { maxWorkers: localMaxWorkers }),
  },
});
