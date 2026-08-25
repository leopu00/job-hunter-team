// Copia il worker di MapLibre (e il modulo condiviso che importa) dentro
// public/, dove il sito lo serve same-origin.
//
// Perché serve: dal v6 MapLibre spedisce il worker come file separato e lo
// risolve con `new URL(..., import.meta.url)`. Nel bundle di produzione di
// Next `import.meta.url` non è un URL http(s), la risoluzione torna vuota e
// il worker finisce per importare la home del sito: muore in silenzio e la
// mappa resta senza tile né pin (regressione live del 24/08, bump 5.24→6.3).
// L'app fissa quindi l'URL con `setWorkerUrl()` (lib/maplibre-worker.ts) e
// questo hook di postinstall garantisce che i file serviti siano SEMPRE
// quelli della versione installata: niente copie committate che driftano al
// prossimo bump di Dependabot. La cartella public/maplibre/ è in .gitignore.
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "node_modules", "maplibre-gl", "dist");
const dst = path.join(here, "..", "public", "maplibre");

// Il worker importa `./maplibre-gl-shared.mjs`: i due file vanno serviti
// fianco a fianco — copiarne uno solo lascerebbe la mappa rotta come prima.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(dst, { recursive: true });
for (const file of FILES) {
  // copyFileSync esplode se la sorgente manca: un layout dist diverso in un
  // futuro maplibre deve fallire l'install, non produrre un sito senza mappa.
  copyFileSync(path.join(src, file), path.join(dst, file));
}
