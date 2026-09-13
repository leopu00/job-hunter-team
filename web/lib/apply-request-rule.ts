// [JHT-CLOSER] La regola dell'autorizzazione alla candidatura, lato sito.
//
// La regola NON sta qui: sta in `shared/cloud/apply-request-rule.json`, che
// legge anche `shared/skills/apply_gate.py`. Il box (CLI `jht apply`, gate,
// coda del CLOSER) e il sito (route `apply-request`, loop delle risposte,
// bottone) decidono sulla stessa riga di JSON: due copie divergono al primo
// cambio, e qui divergere vuol dire un bottone che autorizza ciò che il gate
// scarta, o il contrario.
//
// Fail-closed come il gate: se il file non ha la forma attesa, nessuno stato
// è autorizzabile e nessun canale è utente.
import RULE_FILE from "../../shared/cloud/apply-request-rule.json";

type Rule = {
  authorisableStatus: string | null;
  postSubmissionStates: readonly string[];
  userRequestOrigins: readonly string[];
};

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === "string" && item.length > 0);

export function parseApplyRequestRule(raw: unknown): Rule {
  const closed: Rule = {
    authorisableStatus: null,
    postSubmissionStates: [],
    userRequestOrigins: [],
  };
  if (!raw || typeof raw !== "object") return closed;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.authorisable_status !== "string" ||
    !r.authorisable_status ||
    !isStringList(r.post_submission_states) ||
    !isStringList(r.user_request_origins)
  ) {
    return closed;
  }
  return {
    authorisableStatus: r.authorisable_status,
    postSubmissionStates: r.post_submission_states,
    userRequestOrigins: r.user_request_origins,
  };
}

const RULE = parseApplyRequestRule(RULE_FILE);

export const AUTHORISABLE_STATUS = RULE.authorisableStatus;
export const POST_SUBMISSION_STATES = RULE.postSubmissionStates;
export const USER_REQUEST_ORIGINS = RULE.userRequestOrigins;

export type ApplyToggleRefusal =
  | "rule_unavailable"
  | "already_submitted"
  | "position_not_ready";

/**
 * Lo stesso ordine di `toggle_verdict` nel gate: una candidatura già partita
 * non si autorizza e non si ritira; si autorizza solo dallo stato della regola.
 */
export function applyToggleVerdict(
  input: { status: string | null; applied: boolean; requested: boolean },
  rule: Rule = RULE,
): { ok: true } | { ok: false; reason: ApplyToggleRefusal } {
  if (!rule.authorisableStatus)
    return { ok: false, reason: "rule_unavailable" };
  if (
    input.applied ||
    (input.status != null && rule.postSubmissionStates.includes(input.status))
  ) {
    return { ok: false, reason: "already_submitted" };
  }
  if (input.requested && input.status !== rule.authorisableStatus) {
    return { ok: false, reason: "position_not_ready" };
  }
  return { ok: true };
}

/** Istante SQLite senza fuso = UTC, come `_parse_instant` del gate. */
export function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.trim();
  const zoned = /[zZ]|[+-]\d\d:?\d\d$/.test(text);
  const ms = Date.parse(zoned ? text : `${text.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Il nuovo `apply_requested_at`, sempre STRETTAMENTE dopo il precedente.
 * Il gate rimette in coda una posizione ferma solo se l'autorizzazione è più
 * recente del checkpoint: due click nello stesso secondo non devono sembrare
 * uno solo, e un orologio indietro non deve far tornare indietro il permesso.
 */
export function nextApplyInstant(
  previous: string | null | undefined,
  now: Date = new Date(),
): string {
  const prev = parseInstant(previous);
  const ms = prev != null && prev >= now.getTime() ? prev + 1 : now.getTime();
  return new Date(ms).toISOString();
}

export const IN_FLIGHT_CHECKPOINT_STATES = [
  "detect",
  "fill",
  "upload_cv",
  "screening",
  "review",
  "submit",
] as const;
export const STOPPED_CHECKPOINT_STATES = ["blocked_human", "dry_run", "denied"];

export type ApplyRequestSignals = {
  /** L'ultima domanda del CLOSER su questa posizione, se c'è. */
  closerQuestion: {
    id: string;
    body: string;
    created_at: string;
    user_reply: string | null;
  } | null;
  /** Checkpoint del flow: solo quando il sito gira accanto al box. */
  checkpoint: {
    state: string;
    updated_at: string;
    blocked_reason: string;
  } | null;
};

export type ApplyRequestState =
  | { kind: "hidden" }
  | { kind: "available" }
  | { kind: "authorised"; at: string | null }
  | { kind: "sending"; step: string }
  | { kind: "stopped"; reason: string; messageId: string | null }
  | {
      kind: "sent";
      at: string | null;
      via: string | null;
      withReceipt: boolean;
    };

/**
 * Cosa mostra il bottone. Solo segnali che esistono su entrambe le sponde
 * (posizione, candidatura, domanda del CLOSER) più il checkpoint quando il
 * sito lo vede: sul cloud «in invio» non è osservabile e resta «autorizzata».
 */
export function applyRequestState(
  input: {
    status: string | null;
    apply_requested: boolean;
    apply_requested_at: string | null;
    application: {
      applied: boolean;
      applied_at: string | null;
      applied_via: string | null;
    } | null;
  } & ApplyRequestSignals,
  rule: Rule = RULE,
): ApplyRequestState {
  const applied = input.application?.applied === true;
  if (
    applied ||
    (input.status != null && rule.postSubmissionStates.includes(input.status))
  ) {
    const via = input.application?.applied_via ?? null;
    return {
      kind: "sent",
      at: input.application?.applied_at ?? null,
      via,
      withReceipt: via === "agent_closer",
    };
  }
  if (!rule.authorisableStatus || input.status !== rule.authorisableStatus) {
    return { kind: "hidden" };
  }
  if (!input.apply_requested) return { kind: "available" };

  const authorisedAt = parseInstant(input.apply_requested_at);
  const since = (value: string | null | undefined) => {
    const at = parseInstant(value);
    return at != null && (authorisedAt == null || at >= authorisedAt);
  };
  const question = input.closerQuestion;
  if (question && !question.user_reply && since(question.created_at)) {
    return { kind: "stopped", reason: question.body, messageId: question.id };
  }
  const checkpoint = input.checkpoint;
  if (checkpoint && since(checkpoint.updated_at)) {
    if (STOPPED_CHECKPOINT_STATES.includes(checkpoint.state)) {
      return {
        kind: "stopped",
        reason: checkpoint.blocked_reason || checkpoint.state,
        messageId: null,
      };
    }
    if (
      (IN_FLIGHT_CHECKPOINT_STATES as readonly string[]).includes(
        checkpoint.state,
      )
    ) {
      return { kind: "sending", step: checkpoint.state };
    }
  }
  return { kind: "authorised", at: input.apply_requested_at };
}
