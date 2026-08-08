/**
 * «C'è una versione più nuova?» — la domanda che nessuno faceva.
 *
 * Un box può stare quattro release indietro per una settimana, e ogni
 * sintomo si legge come «il prodotto è rotto» mentre la release che lo
 * sistema è fuori da giorni. Non esisteva alcun canale: nessun controllo
 * sul box, nessun avviso nel web, nessuna riga in `jht status`, e il
 * one-liner di installazione è una cosa che si lancia una volta sola.
 *
 * Tre regole che questo modulo non tratta:
 *
 *  1. **Aggiornare resta scelta dell'utente.** Nessun self-update: qui si
 *     stampa una riga, e il difetto che stiamo curando è *non saperlo*, non
 *     *non aver aggiornato*. Su una macchina che lavora tutta la notte da
 *     sola, sostituire il software sotto i piedi non è un servizio.
 *  2. **Una domanda al giorno.** Il risultato si tiene in cache in
 *     `JHT_HOME`: `jht status` si lancia anche dieci volte di fila, e
 *     l'API pubblica di GitHub concede 60 richieste l'ora per indirizzo.
 *  3. **Offline non è un guasto.** Rete assente, timeout, GitHub che
 *     risponde storto: si tace. Un avviso che non sappiamo dare non è
 *     un'informazione da dare a metà.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { latestReleaseInfo, updateAvailable } from '../../../shared/release/version.js';

export const REPO = 'leopu00/job-hunter-team';
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASE_CACHE_FILE = join(JHT_HOME, '.release-check.json');

/** Una volta al giorno: le release non escono a raffica. */
export const RELEASE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** `jht status` deve restare istantaneo: oltre questo, si rinuncia. */
const REQUEST_TIMEOUT_MS = 3000;

/** La cache è ancora buona? */
export function cacheFresh(cached, now = Date.now()) {
  const checkedAt = Date.parse(cached?.checked_at || '');
  return Number.isFinite(checkedAt) && now - checkedAt < RELEASE_CACHE_TTL_MS;
}

async function readCache() {
  try {
    return JSON.parse(await readFile(RELEASE_CACHE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

async function writeCache(entry) {
  try {
    await writeFile(RELEASE_CACHE_FILE, JSON.stringify(entry, null, 2));
  } catch {
    /* home in sola lettura: si ricontrolla al prossimo giro, non è un errore */
  }
}

/**
 * L'ultima release pubblicata, dalla cache o dalla rete. Null quando non si
 * riesce a saperlo — e il chiamante in quel caso non deve dire nulla.
 */
export async function fetchLatestRelease({
  fetchFn = fetch,
  now = Date.now(),
  useCache = true,
} = {}) {
  if (useCache) {
    const cached = await readCache();
    if (cacheFresh(cached, now) && cached?.version) {
      return { version: cached.version, page: cached.page, cached: true };
    }
  }

  try {
    const res = await fetchFn(API_LATEST, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const info = latestReleaseInfo(await res.json(), REPO);
    if (!info) return null;
    await writeCache({ ...info, checked_at: new Date(now).toISOString() });
    return { ...info, cached: false };
  } catch {
    // Offline, DNS muto, GitHub lento: oggi non si controlla.
    return null;
  }
}

/**
 * La riga da stampare, o null se non c'è niente da dire. Restituisce testo
 * e non lo stampa: così il contenuto è collaudabile senza catturare stdout.
 */
export function updateNotice(currentVersion, latest) {
  if (!latest?.version || !updateAvailable(latest.version, currentVersion)) {
    return null;
  }
  return {
    current: currentVersion,
    latest: latest.version,
    // Il comando che chiude il divario, per esteso: chi legge questa riga
    // sta cercando proprio quello, e mandarlo a cercarlo nei documenti è il
    // modo di far restare indietro un altro po' di persone. Il runtime è
    // un'immagine immutabile: l'aggiornamento lo esegue il wrapper sull'HOST,
    // non questo processo dentro il container (vedi commands/upgrade.js).
    command: 'jht upgrade',
    where: 'on the computer or VPS that hosts Docker',
  };
}
