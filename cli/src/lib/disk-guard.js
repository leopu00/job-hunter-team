/**
 * Disco quasi pieno: nessun NUOVO avvio.
 *
 * Specchio in Node di shared/skills/host_vitals.py (`read_disk`, `disk-guard`):
 * le stesse due soglie sullo spazio LIBERO e gli stessi codici chiusi. Ogni
 * soglia e' combinata (percentuale E byte): il 3% di un disco da 500 GiB sono
 * 15 GiB, e con 14 GiB liberi (2,8%) la sola percentuale rifiutava.
 *
 *   - sotto DISK_WARN_FREE_PCT  (10%) E DISK_WARN_FREE_BYTES  (20 GiB)
 *       livello `warn`, codice `disk_warning`
 *   - sotto DISK_BLOCK_FREE_PCT (3%)  E DISK_BLOCK_FREE_BYTES (8 GiB)
 *       livello `low`,  codice `disk_low`
 *
 * `jht team start` lo chiede PRIMA di far nascere una sessione e rifiuta con
 * `disk_low` invece di partire e rompersi a meta': un avvio morto ha gia'
 * speso token. Gli agenti gia' vivi non passano di qui e restano intatti.
 *
 * La frase che l'utente legge non e' scritta qui: viene dalla tabella
 * codice->frase (`disk.low.cli` in shared/locales/*.json). E' la frase di
 * `disk.low` (quella del launcher e dell'app, senza comandi da terminale) con in
 * piu' la via per recuperare spazio a disco pieno, `jht clean-images`: chi legge
 * qui sta gia' in un terminale.
 *
 * Un volume che non si risolve vale «sconosciuto» e NON ferma niente: la
 * guardia rifiuta solo davanti a una misura che dice «sotto soglia».
 *
 * tests/test_disk_guard.py confronta le soglie con quelle di host_vitals.py,
 * di jht-wrapper.sh e di jht-wrapper.ps1.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tf } from '../../wizard/i18n.js';
import { isContainer } from '../../../shared/runtime/container.js';

const GIB = 1024 ** 3;
export const DISK_WARN_FREE_PCT = 10;
export const DISK_WARN_FREE_BYTES = 20 * GIB;
export const DISK_BLOCK_FREE_PCT = 3;
export const DISK_BLOCK_FREE_BYTES = 8 * GIB;
export const DISK_CODE_WARNING = 'disk_warning';
export const DISK_CODE_LOW = 'disk_low';

const LEVEL_RANK = { ok: 0, warn: 1, low: 2 };

/**
 * `ok|warn|low` per uno spazio libero: servono la percentuale E i byte. La
 * percentuale si confronta per moltiplicazione (libero*100 < soglia*totale),
 * come in Python e in shell: nessun arrotondamento sul confine.
 */
export function diskLevel(freeBytes, totalBytes) {
  if (freeBytes * 100 < DISK_BLOCK_FREE_PCT * totalBytes && freeBytes < DISK_BLOCK_FREE_BYTES) return 'low';
  if (freeBytes * 100 < DISK_WARN_FREE_PCT * totalBytes && freeBytes < DISK_WARN_FREE_BYTES) return 'warn';
  return 'ok';
}

const UNKNOWN = Object.freeze({ level: 'unknown', freePct: null, freeBytes: null, totalBytes: null });

function nearestExisting(target, exists) {
  let current = path.resolve(target);
  for (;;) {
    if (exists(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Spazio del volume che contiene `target`: sconosciuto se non si risolve. */
export function volumeState(target, { statfs = fs.statfsSync, exists = fs.existsSync } = {}) {
  if (!target) return { path: null, ...UNKNOWN };
  try {
    const existing = nearestExisting(target, exists);
    if (!existing) return { path: target, ...UNKNOWN };
    const st = statfs(existing);
    const total = Number(st.blocks) * Number(st.bsize);
    const free = Number(st.bavail) * Number(st.bsize);
    if (!Number.isFinite(total) || !Number.isFinite(free) || total <= 0 || free < 0) {
      return { path: target, ...UNKNOWN };
    }
    const pct = (free / total) * 100; // grezza: la decisione non passa da un arrotondamento
    const level = diskLevel(free, total);
    return {
      path: target, level, freePct: Math.round(pct * 100) / 100, freeBytes: free, totalBytes: total, rawPct: pct,
    };
  } catch {
    return { path: target, ...UNKNOWN };
  }
}

/**
 * Dove vive il volume del motore container, se da qui si puo' sapere. Dentro
 * il container e' `/`; su un host Linux la radice dati di Docker/Podman; su
 * macOS e Windows il disco del motore sta dentro una VM che l'host non vede:
 * `null` = sconosciuto, MAI il disco del Mac al suo posto.
 */
export function engineDiskPath({
  env = process.env, inContainer = isContainer(), platform = process.platform, exists = fs.existsSync,
} = {}) {
  if (env.JHT_ENGINE_DISK_PATH !== undefined) return env.JHT_ENGINE_DISK_PATH || null;
  if (inContainer) return '/';
  if (platform === 'linux') {
    for (const candidate of ['/var/lib/docker', '/var/lib/containers']) {
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** Spazio libero dei due volumi e il livello peggiore (`ok|warn|low|unknown`). */
export function readDisk(options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? env.JHT_HOME ?? path.join(os.homedir(), '.jht');
  const volumeOptions = { statfs: options.statfs, exists: options.exists };
  const clean = Object.fromEntries(Object.entries(volumeOptions).filter(([, v]) => v !== undefined));
  const jhtHome = volumeState(home, clean);
  const engine = volumeState(engineDiskPath({
    env, inContainer: options.inContainer, platform: options.platform, exists: options.exists,
  }), clean);
  const known = [jhtHome, engine].filter((v) => v.level !== 'unknown');
  // Il peggiore: prima la gravita', a parita' la percentuale piu' bassa.
  const worst = known.reduce((a, b) => {
    if (!a) return b;
    if (LEVEL_RANK[a.level] !== LEVEL_RANK[b.level]) return LEVEL_RANK[a.level] > LEVEL_RANK[b.level] ? a : b;
    return a.rawPct <= b.rawPct ? a : b;
  }, null);
  const level = worst ? worst.level : 'unknown';
  const code = level === 'low' ? DISK_CODE_LOW : level === 'warn' ? DISK_CODE_WARNING : null;
  const strip = ({ rawPct, ...rest }) => rest;
  return { level, code, minFreePct: worst ? worst.freePct : null, jhtHome: strip(jhtHome), engine: strip(engine) };
}

/**
 * Il rifiuto, o `null` se si puo' partire. `message` e' la frase della tabella
 * codice->frase nella lingua dell'utente; vuota (non improvvisata) se la
 * tabella non risponde.
 */
export function diskLowRefusal(options = {}) {
  const disk = readDisk(options);
  if (disk.level !== 'low') return null;
  const phrase = tf('disk.low.cli', `${disk.minFreePct}%`);
  return { code: DISK_CODE_LOW, message: phrase === 'disk.low.cli' ? '' : phrase, disk };
}
