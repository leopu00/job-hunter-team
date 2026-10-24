/**
 * Lettura di file JSON dal disco per le route handler.
 *
 * Due helper che vivevano copiati in giro per `app/api/`: la lettura
 * tollerante (quattro copie, una delle quali aveva perso la tipizzazione
 * per strada) e il caricamento di `jht.config.json` (due copie identiche).
 */
import fs from "node:fs";
import path from "node:path";
import { JHT_HOME } from "@/lib/jht-paths";

/**
 * Legge e deserializza un JSON, `null` se il file manca, è illeggibile o
 * supera `maxBytes` (se dato).
 * Il chiamante dichiara la forma attesa: nessuna validazione a runtime,
 * esattamente come le copie che sostituisce.
 */
export function readJsonSafe<T>(filePath: string, maxBytes?: number): T | null {
  try {
    // Un file che scrive chi non è il web (un agente, lo stesso utente) può
    // essere enorme: con un tetto lo si rifiuta prima di leggerlo tutto. Senza
    // tetto la lettura è quella di sempre (l'export ha file grandi per natura).
    if (maxBytes !== undefined && fs.statSync(filePath).size > maxBytes)
      return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** Il tetto dei file di misura e di versione, piccoli per natura. */
export const SMALL_JSON_MAX_BYTES = 1024 * 1024;

/**
 * Posizioni in cui può trovarsi `jht.config.json`, in ordine di
 * precedenza: la zona nascosta dell'utente, poi la working dir del
 * processo e la sua parent (il web gira sia da `web/` sia dalla radice
 * del monorepo a seconda di come è avviato).
 */
const CONFIG_CANDIDATES = [
  path.join(JHT_HOME, "jht.config.json"),
  path.join(process.cwd(), "jht.config.json"),
  path.join(process.cwd(), "..", "jht.config.json"),
];

/**
 * Carica `jht.config.json` dal primo candidato leggibile; oggetto vuoto
 * se nessuno lo è — le route trattano la config assente come "tutto ai
 * valori di default", mai come errore.
 *
 * Generica di proposito: ogni route dichiara solo la fetta di config che
 * la riguarda (`providers`, `rate_limiter`, …) invece di condividere un
 * tipo onnicomprensivo che nessuno terrebbe aggiornato.
 */
export function loadJhtConfig<T extends object>(): T {
  for (const p of CONFIG_CANDIDATES) {
    if (!fs.existsSync(p)) continue;
    const parsed = readJsonSafe<T>(p);
    if (parsed !== null) return parsed;
  }
  return {} as T;
}
