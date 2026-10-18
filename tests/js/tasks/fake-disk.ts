import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Lo spazio libero e' della macchina, non del codice. `jht team start` rifiuta
 * sotto il 3% (disk_low): un test che lo lancia senza un disco finto diventa
 * verde o rosso a seconda del volume su cui gira. Questo modulo scrive nella
 * cartella del test un preload per `NODE_OPTIONS=--import` che sostituisce
 * `fs.statfsSync` con un volume di cui si decide la percentuale libera
 * (FAKE_STATFS_FREE_PCT, 50 di serie). Il codice di produzione non ha nessun
 * gancio di test: cambia solo il processo del test.
 */
const PRELOAD = `import fs from "node:fs";
const pct = Number(process.env.FAKE_STATFS_FREE_PCT ?? 50);
fs.statfsSync = () => {
  const blocks = 1000000;
  const bavail = Math.floor((blocks * pct) / 100);
  return { bsize: 4096, blocks, bfree: bavail, bavail };
};
`;

/** Scrive il preload in `dir` e ritorna il valore di NODE_OPTIONS da passare al processo. */
export function fakeDiskNodeOptions(dir: string): string {
  const file = path.join(dir, "fake-statfs.mjs");
  writeFileSync(file, PRELOAD, "utf-8");
  return `--import ${pathToFileURL(file).href}`;
}
