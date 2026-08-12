/**
 * Policy del push automatico locale→cloud a regime (O-66).
 *
 * Il trasporto NON vive qui: il daemon continua a usare `handlePush`, cioè lo
 * stesso percorso del rendezvous "Sync now" con chunking, safe cursor e
 * verifica della risposta. Qui decidiamo soltanto quando quel percorso può
 * partire, persistiamo un esito leggibile e impediamo due push sovrapposti.
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { JHT_HOME } from "../jht-paths.js";
import { signatureIsEmpty, signaturesDiffer } from "./bootstrap-push.js";

export const PERIODIC_PUSH_STATE_FILE = join(
  JHT_HOME,
  ".cloud-periodic-push.json",
);

const DEFAULT_INTERVAL_SEC = 900; // al massimo 15 minuti di ritardo a regime
const DEFAULT_RETRY_SEC = 60; // errore transitorio: riprova al giro pesante dopo
const DEFAULT_TIMEOUT_SEC = 120; // stesso budget del rendezvous Sync now

function envInt(env, name, fallback, min) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

export function periodicPushLimits(env = process.env) {
  return {
    enabled: env?.JHT_CLOUD_PERIODIC_PUSH !== "0",
    intervalMs:
      envInt(env, "JHT_PERIODIC_PUSH_SEC", DEFAULT_INTERVAL_SEC, 1) * 1000,
    retryMs:
      envInt(env, "JHT_PERIODIC_PUSH_RETRY_SEC", DEFAULT_RETRY_SEC, 1) * 1000,
    timeoutMs:
      envInt(env, "JHT_PERIODIC_PUSH_TIMEOUT_SEC", DEFAULT_TIMEOUT_SEC, 1) *
      1000,
  };
}

export function readPeriodicPushState(path = PERIODIC_PUSH_STATE_FILE) {
  try {
    const value = JSON.parse(readFileSync(path, "utf-8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export async function savePeriodicPushState(
  state,
  path = PERIODIC_PUSH_STATE_FILE,
) {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    // `mode` vale soltanto alla creazione: un file già esistente e troppo
    // permissivo deve essere corretto, non perpetuato a ogni riscrittura.
    await chmod(path, 0o600);
    return true;
  } catch {
    return false;
  }
}

function parseMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function retryableStatus(status) {
  return ["failed", "timeout", "partial", "signature_unavailable"].includes(
    status,
  );
}

/** Decisione pura: la firma si legge soltanto quando la cadenza è scaduta. */
export function decidePeriodicPush({ now, state = {}, limits, signature }) {
  const no = (reason, extra = {}) => ({
    push: false,
    reason,
    needsSignature: false,
    ...extra,
  });
  if (!limits.enabled) return no("disabled");

  const checkedAt = parseMs(state.last_check_at);
  const cadence = retryableStatus(state.status)
    ? limits.retryMs
    : limits.intervalMs;
  if (checkedAt !== null && now - checkedAt < cadence) {
    return no("cadence", { nextAt: checkedAt + cadence });
  }
  if (signature === undefined) {
    return no("signature_required", { needsSignature: true });
  }
  if (signature === null) return no("signature_unavailable", { checked: true });
  if (signatureIsEmpty(signature))
    return no("nothing_local", { checked: true });
  if (!signaturesDiffer(signature, state.signature ?? null)) {
    return no("nothing_new", { checked: true });
  }
  return { push: true, reason: "local_changes", needsSignature: false };
}

/** Stato di un controllo che non ha richiesto traffico remoto. */
export function nextPeriodicCheckState({ state = {}, now, signature, reason }) {
  const next = {
    ...state,
    status:
      reason === "signature_unavailable" ? "signature_unavailable" : "idle",
    last_check_at: new Date(now).toISOString(),
    last_reason: reason,
  };
  if (signature !== null && signature !== undefined) next.signature = signature;
  if (reason === "signature_unavailable") {
    next.consecutive_failures = (Number(state.consecutive_failures) || 0) + 1;
  } else {
    next.consecutive_failures = 0;
  }
  return next;
}

export function periodicPushResultStatus(result) {
  if (result?.ok === true && Number(result?.skipped || 0) === 0)
    return "completed";
  if (result?.timedOut === true) return "timeout";
  if (result?.authFailed === true) return "auth_failed";
  if (Number(result?.skipped || 0) > 0) return "partial";
  return "failed";
}

/** Ogni full-push del daemon aggiorna lo stesso stato, anche Sync now. */
export function nextPeriodicPushState({
  state = {},
  now,
  signature,
  result,
  source,
}) {
  const at = new Date(now).toISOString();
  const status = periodicPushResultStatus(result);
  const completed = status === "completed";
  const next = {
    ...state,
    status,
    source,
    last_check_at: at,
    last_attempt_at: at,
    last_reason: status,
    consecutive_failures: completed
      ? 0
      : (Number(state.consecutive_failures) || 0) + 1,
  };
  if (completed) {
    next.signature = signature;
    next.last_success_at = at;
  }
  return next;
}

/** Testo usato da `jht cloud status`: nessun fallimento resta solo nel log. */
export function periodicPushStatusLine(state = {}) {
  if (!state.status) return "not run yet";
  const last = state.last_attempt_at || state.last_check_at || "unknown time";
  if (state.status === "completed") return `completed at ${last}`;
  if (state.status === "idle") return `idle; checked at ${last}`;
  return `${state.status} at ${last}; retry is automatic`;
}

/** Stato minimo pubblicabile: nessuna firma/conteggio locale lascia il box. */
export function periodicPushObservation(outcome) {
  const state = outcome?.state;
  if (!state?.last_check_at) return null;
  const current = state.status === "completed" || state.status === "idle";
  return {
    cloud_push_status: current ? "current" : state.status || "failed",
    cloud_push_checked_at: state.last_check_at,
  };
}

/**
 * Esegue UN giro della policy. Il producer del payload arriva dal chiamante:
 * in produzione è l'`handlePush` esclusivo già condiviso da bootstrap e
 * "Sync now". Questo modulo non legge tabelle né costruisce richieste cloud.
 */
export async function runPeriodicPushCycle({
  now = Date.now(),
  limits = periodicPushLimits(),
  state = {},
  readSignature,
  push,
  save = savePeriodicPushState,
  signal,
}) {
  let signature;
  let decision = decidePeriodicPush({ now, state, limits });
  if (decision.needsSignature) {
    signature = await readSignature();
    decision = decidePeriodicPush({ now, state, limits, signature });
  }

  if (!decision.push) {
    if (!decision.checked) return decision;
    const nextState = nextPeriodicCheckState({
      state,
      now,
      signature,
      reason: decision.reason,
    });
    const persisted = await save(nextState);
    return { ...decision, state: nextState, persisted };
  }

  const pushSignal = signal || AbortSignal.timeout(limits.timeoutMs);
  let result;
  try {
    result = await push({ signal: pushSignal });
  } catch (error) {
    const name = String(error?.name || "").toLowerCase();
    result = {
      ok: false,
      skipped: 0,
      timedOut: name.includes("timeout") || error?.name === "AbortError",
    };
  }
  const nextState = nextPeriodicPushState({
    state,
    now,
    signature,
    result,
    source: "periodic",
  });
  const persisted = await save(nextState);
  return { ...decision, result, state: nextState, persisted };
}

/** Il file è osservabile senza confondere "mai partito" con "manca". */
export function periodicPushStateExists(path = PERIODIC_PUSH_STATE_FILE) {
  return existsSync(path);
}
