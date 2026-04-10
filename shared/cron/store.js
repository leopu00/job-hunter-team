/**
 * JHT Cron — Persistenza jobs in ~/.jht/cron/jobs.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { JHT_HOME } from '../paths.js';

const JHT_CRON_DIR = path.join(JHT_HOME, 'cron');
const JHT_CRON_STORE_PATH = path.join(JHT_CRON_DIR, 'jobs.json');

const serializedCache = new Map();

export { JHT_CRON_DIR, JHT_CRON_STORE_PATH };

/**
 * Risolve il path dello store (default o custom).
 * @param {string} [storePath]
 * @returns {string}
 */
export function resolveCronStorePath(storePath) {
  if (storePath?.trim()) return path.resolve(storePath.trim());
  return JHT_CRON_STORE_PATH;
}

/**
 * Carica lo store dal disco. Ritorna { version: 1, jobs: [] } se non esiste.
 * @param {string} storePath
 * @returns {Promise<import('./types.js').CronStoreFile>}
 */
export async function loadCronStore(storePath) {
  try {
    const raw = await fs.promises.readFile(storePath, 'utf-8');
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      throw new Error(`JSON non valido in ${storePath}`);
    }
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs.filter(Boolean) : [];
    const store = { version: 1, jobs };
    serializedCache.set(storePath, JSON.stringify(store, null, 2));
    return store;
  } catch (err) {
    if (err.code === 'ENOENT') {
      serializedCache.delete(storePath);
      return { version: 1, jobs: [] };
    }
    throw err;
  }
}

/**
 * Salva lo store su disco con scrittura atomica e backup.
 * @param {string} storePath
 * @param {import('./types.js').CronStoreFile} store
 */
export async function saveCronStore(storePath, store) {
  const storeDir = path.dirname(storePath);
  await fs.promises.mkdir(storeDir, { recursive: true, mode: 0o700 });

  const json = JSON.stringify(store, null, 2);
  const cached = serializedCache.get(storePath);
  if (cached === json) return; // nessun cambiamento

  // Backup del file esistente
  let previousExists = false;
  try {
    await fs.promises.access(storePath);
    previousExists = true;
  } catch { /* non esiste */ }

  if (previousExists) {
    try {
      await fs.promises.copyFile(storePath, `${storePath}.bak`);
    } catch { /* best-effort */ }
  }

  // Scrittura atomica: scrivi su .tmp, poi rinomina
  const tmp = `${storePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  await fs.promises.writeFile(tmp, json, { encoding: 'utf-8', mode: 0o600 });

  try {
    await fs.promises.rename(tmp, storePath);
  } catch (err) {
    // Windows fallback: copy + unlink
    if (err.code === 'EPERM' || err.code === 'EEXIST') {
      await fs.promises.copyFile(tmp, storePath);
      await fs.promises.unlink(tmp).catch(() => {});
    } else {
      throw err;
    }
  }

  serializedCache.set(storePath, json);
}
