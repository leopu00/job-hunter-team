// [CLOUDSYNC-PUSH-ONLY-WHEN-WATCHED] Il primo periodo di vita di un account.
//
// Il push locale→cloud è ON-DEMAND per scelta ([PUSH ON-DEMAND 2026-06-25]):
// il daemon spinge solo quando un browser scrive `team_state.sync_requested_at`
// (apertura dashboard o "Sync now"). A regime è la decisione giusta e resta
// intatta: nessun poller permanente, quota Vercel/Supabase protetta.
//
// La lacuna è STRETTA e sta tutta all'inizio: `jht cloud login` pusha una volta
// sola, ma un box appena creato ha il DB VUOTO per definizione → quel push porta
// zero righe. Finché nessuno apre la dashboard, il cloud resta vuoto anche
// mentre il box lavora (misurato 2026-07-27: 25 posizioni + profilo completo sul
// box, 0 righe su Supabase ~50 minuti dopo il pairing). Ne soffrono le
// notifiche, i digest, un secondo dispositivo, e chiunque ispezioni l'account
// direttamente — incluso un beta tester nuovo, che si porta via l'impressione
// di un prodotto che non ha prodotto nulla.
//
// Qui sta la decisione di QUANDO spingere senza browser. Il push vero e proprio
// NON è reimplementato: si riusa `handlePush` con il suo chunking anti-413 e il
// suo `safeCursor` (vedi postmortem 2026-07-15). Questo modulo decide soltanto,
// e soprattutto decide quando SMETTERE.
//
// Tre garanzie di terminazione, INDIPENDENTI fra loro: basta che scatti la
// prima. Nessuna dipende dal buon comportamento delle altre.
//   1. `phase: steady` in `~/.jht/state/first-run.json` — l'uscita normale.
//      La scrive `first_run.py` quando il burst raggiunge il suo obiettivo di
//      posizioni CON PUNTEGGIO o quando la sua finestra (5h) è esaurita.
//   2. budget di push esaurito (`maxPushes`) — protegge dal caso in cui la fase
//      non passi MAI a steady (es. piano mai dichiarato → `awaiting_profile`
//      per sempre): il contatore è persistito, quindi nemmeno un daemon che
//      riparte di continuo può ricaricarlo.
//   3. finestra a orologio (`windowMs`) dal primo push — protegge dal caso di
//      un box che produce pochissimo e spalma il budget su giorni.
// Più due uscite immediate: fallimento di auth (401/403, inutile insistere) e
// interruttore d'emergenza `JHT_CLOUD_BOOTSTRAP_PUSH=0`.
//
// Una volta `done`, lo stato resta scritto su disco: per quell'installazione
// non si spinge più senza browser, mai. Il costo è per-account e una tantum.

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';

/** Stato del primo avvio scritto da `shared/skills/first_run.py`. */
export const FIRST_RUN_STATE_FILE = join(JHT_HOME, 'state', 'first-run.json');
/** Stato locale del bootstrap-push (contatore, finestra, firma già pushata). */
export const BOOTSTRAP_STATE_FILE = join(JHT_HOME, '.cloud-bootstrap.json');

export const PHASE_STEADY = 'steady';

// Difetti scelti sulla forma reale del primo avvio: il burst dura al massimo 5h
// (BURST_MAX_HOURS in first_run.py) e il suo obiettivo si misura in decine di
// posizioni, non migliaia. 15 minuti di latenza massima trasformano "account
// vuoto dopo 50 minuti" in "account popolato entro un quarto d'ora" senza
// avvicinarsi nemmeno da lontano a un poller.
const DEFAULT_INTERVAL_SEC = 900; // 15 min
const DEFAULT_MAX_PUSHES = 24; // 24 × 15 min = 6h di copertura massima
const DEFAULT_WINDOW_HOURS = 6; // pari alla copertura massima del budget

function envInt(env, name, fallback, min) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

/**
 * Limiti effettivi (con override da env, usati anche dai test e dalla verifica
 * manuale: vedi `jht cloud bootstrap-status`).
 */
export function bootstrapLimits(env = process.env) {
  return {
    enabled: env?.JHT_CLOUD_BOOTSTRAP_PUSH !== '0',
    intervalMs: envInt(env, 'JHT_BOOTSTRAP_PUSH_SEC', DEFAULT_INTERVAL_SEC, 1) * 1000,
    maxPushes: envInt(env, 'JHT_BOOTSTRAP_PUSH_MAX', DEFAULT_MAX_PUSHES, 0),
    windowMs: envInt(env, 'JHT_BOOTSTRAP_PUSH_WINDOW_H', DEFAULT_WINDOW_HOURS, 1) * 3600 * 1000,
  };
}

function parseMs(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Fase del primo avvio. `null` = file assente o illeggibile → NON siamo
 * autorizzati a dedurre che l'account sia nuovo, quindi non si spinge (ma
 * nemmeno si chiude: il file può comparire più tardi, appena il Capitano
 * interroga `first_run.py`).
 */
export function readFirstRunPhase(path = FIRST_RUN_STATE_FILE) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    const phase = data?.phase;
    return typeof phase === 'string' && phase ? phase : null;
  } catch {
    return null;
  }
}

export function readBootstrapState(path = BOOTSTRAP_STATE_FILE) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export async function saveBootstrapState(state, path = BOOTSTRAP_STATE_FILE) {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    return true;
  } catch {
    // Best-effort come gli altri cursori: se non riusciamo a scrivere, il tick
    // dopo ripartirà dallo stato precedente. Il budget è comunque limitato
    // dalla finestra a orologio, che non dipende dal contatore.
    return false;
  }
}

// Firma del contenuto locale: per ogni tabella `{ n, max }` dove `max` è il
// massimo della colonna-timbro DI QUELLA tabella. Serve a rispondere a una sola
// domanda — "è cambiato qualcosa da quando ho pushato l'ultima volta?" — senza
// aprire una connessione al cloud per scoprirlo.
//
// ⚠️ Confronti solo di UGUAGLIANZA, e solo fra la stessa colonna della stessa
// tabella. Mai un ordinamento, mai un confronto fra formati diversi: è
// esattamente il passo falso che ha congelato il cursore del pull nel 2026-07
// (`...Z` vs `...+00:00` confrontati come stringhe, vedi postmortem
// 2026-07-15). Qui una differenza di formato al massimo provoca un push in più,
// mai un blocco.
const SIGNATURE_TABLES = [
  ['positions', 'updated_at'],
  ['scores', 'updated_at'],
  ['applications', 'updated_at'],
  ['companies', 'updated_at'],
  ['position_highlights', 'updated_at'],
  ['position_state_transitions', 'ts'],
  ['_tombstones', 'deleted_at'],
  ['pending_user_messages', 'created_at'],
];

/**
 * Firma del DB locale + del profilo YAML. Ogni sonda è difensiva: tabella o
 * colonna assente (schema vecchio) → voce `null`, che non fa differenza.
 *
 * @param {Function} DatabaseSync classe `node:sqlite` (iniettata: il modulo
 *   resta importabile e testabile senza toccare il filesystem)
 */
export function readLocalSignature(DatabaseSync, dbPath, profilePath) {
  const sig = {};
  if (existsSync(dbPath)) {
    let db = null;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      for (const [table, stamp] of SIGNATURE_TABLES) {
        try {
          const row = db.prepare(
            `SELECT COUNT(*) AS n, MAX(${stamp}) AS max FROM ${table}`
          ).get();
          sig[table] = { n: Number(row?.n ?? 0), max: row?.max ?? null };
        } catch {
          sig[table] = null;
        }
      }
    } catch {
      // DB illeggibile (lock, corruzione): nessuna firma → nessun push. Il
      // percorso on-demand resta l'unico, come oggi.
      return null;
    } finally {
      try { db?.close(); } catch { /* ignore */ }
    }
  }
  try {
    const st = statSync(profilePath);
    sig.profile = { n: st.size, max: String(st.mtimeMs) };
  } catch {
    sig.profile = null;
  }
  return sig;
}

/** Vero se c'è almeno una riga (o un profilo) da qualche parte. */
export function signatureIsEmpty(sig) {
  if (!sig) return true;
  for (const v of Object.values(sig)) {
    if (v && v.n > 0) return false;
  }
  return true;
}

/** Confronto per UGUAGLIANZA, chiave per chiave. */
export function signaturesDiffer(a, b) {
  if (!a || !b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (!x || !y) {
      if (x !== y) return true;
      continue;
    }
    if (x.n !== y.n) return true;
    if (String(x.max ?? '') !== String(y.max ?? '')) return true;
  }
  return false;
}

/**
 * Attesa dopo l'ultimo tentativo. Ogni fallimento consecutivo raddoppia la
 * cadenza (15m → 30m → 60m…), con tetto alla finestra bootstrap: un endpoint
 * guasto riceve sempre meno traffico e budget/finestra continuano a garantire
 * la terminazione. Un successo azzera `consecutive_failures`.
 */
export function bootstrapRetryDelayMs(limits, state = {}) {
  const failures = Math.max(
    0,
    Number.isFinite(state.consecutive_failures)
      ? Math.trunc(state.consecutive_failures)
      : 0,
  );
  const multiplier = 2 ** Math.min(failures, 8);
  return Math.min(limits.intervalMs * multiplier, limits.windowMs);
}

/**
 * La decisione, pura. Nessun IO: tutto quello che serve arriva dai parametri,
 * così il comportamento è verificabile in millisecondi invece che in ore.
 *
 * @param {object} o
 * @param {number} o.now            timestamp corrente (ms)
 * @param {string|null} o.phase     fase da first-run.json (`null` = sconosciuta)
 * @param {object} o.state          stato bootstrap persistito
 * @param {object} o.limits         `bootstrapLimits()`
 * @param {object|null} [o.signature] firma locale corrente (omessa = non ancora
 *   calcolata: la decisione si ferma comunque prima, se un cancello lo impone)
 * @returns {{push: boolean, reason: string, done: boolean, doneReason: string|null,
 *            needsSignature: boolean}}
 */
export function decideBootstrapPush({ now, phase, state = {}, limits, signature }) {
  const no = (reason, done = false, doneReason = null) =>
    ({ push: false, reason, done, doneReason, needsSignature: false });

  if (!limits.enabled) return no('disabled');
  if (state.done === true) return no('done', false, state.done_reason ?? null);

  // Cancello 1 — l'uscita normale. Un'installazione già a regime (o un
  // aggiornamento di un'installazione esistente, che `first_run.py` fa nascere
  // direttamente `steady`) non riceve mai un push senza browser.
  if (phase === PHASE_STEADY) return no('steady', true, 'steady');
  // Fase sconosciuta: non spingiamo, ma non chiudiamo. Il file compare appena
  // un agente interroga `first_run.py`.
  if (phase === null) return no('first-run-state-assente');

  // Cancello 2 — budget. Indipendente dalla fase: anche `awaiting_profile` per
  // sempre si esaurisce qui.
  const pushes = Number.isFinite(state.pushes) ? state.pushes : 0;
  if (pushes >= limits.maxPushes) return no('budget', true, 'budget');

  // Cancello 3 — finestra a orologio dal primo push.
  const startedAt = parseMs(state.started_at);
  if (startedAt !== null && now - startedAt >= limits.windowMs) {
    return no('finestra', true, 'finestra');
  }

  // Cadenza. Il PRIMO push non è ritardato: appena il box produce qualcosa, il
  // cloud lo sa entro un tick del daemon. È la metà del valore di questa
  // funzione — un account che si popola subito non sembra mai rotto.
  const lastAt = parseMs(state.last_push_at);
  const retryDelayMs = bootstrapRetryDelayMs(limits, state);
  if (lastAt !== null && now - lastAt < retryDelayMs) {
    return no((state.consecutive_failures ?? 0) > 0 ? 'backoff' : 'cadenza');
  }

  if (signature === undefined) {
    return { push: false, reason: 'firma-richiesta', done: false, doneReason: null, needsSignature: true };
  }
  if (signature === null) return no('db-illeggibile');
  if (signatureIsEmpty(signature)) return no('niente-in-locale');
  if (!signaturesDiffer(signature, state.signature ?? null)) return no('niente-di-nuovo');

  return {
    push: true,
    reason: lastAt === null ? 'primo-push' : 'periodico',
    done: false,
    doneReason: null,
    needsSignature: false,
  };
}

/**
 * Stato successivo dopo un tentativo di push. Il contatore avanza SEMPRE (anche
 * su fallimento): un endpoint rotto consuma il budget e poi si tace, invece di
 * essere martellato per sempre. La firma avanza SOLO su successo pieno —
 * stessa regola dell'ack del rendezvous: un push che ha scartato righe dopo un
 * 413 non è integro, quindi il tick dopo ritenta (il `safeCursor` di handlePush
 * ha lasciato indietro proprio quelle righe).
 */
export function nextBootstrapState({ state = {}, now, signature, result }) {
  const nowIso = new Date(now).toISOString();
  const pushes = (Number.isFinite(state.pushes) ? state.pushes : 0) + 1;
  const next = {
    ...state,
    pushes,
    started_at: state.started_at || nowIso,
    last_push_at: nowIso,
  };
  const fullSuccess = !!result && result.ok === true && (result.skipped || 0) === 0;
  if (fullSuccess) {
    next.signature = signature;
    next.last_ok_at = nowIso;
    next.consecutive_failures = 0;
  } else {
    next.consecutive_failures =
      (Number.isFinite(state.consecutive_failures)
        ? state.consecutive_failures
        : 0) + 1;
  }
  if (result && result.authFailed === true) {
    next.done = true;
    next.done_reason = 'auth';
  }
  return next;
}
