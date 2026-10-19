import CATALOG from "../../shared/feedback-reasons.json";

/**
 * Il vocabolario chiuso dei motivi del feedback (JHT-T05), lo stesso di
 * `shared/skills/feedback_reasons.py`: un solo elenco, `shared/feedback-reasons.json`.
 *
 * Il motivo di un giudizio è uno di questi codici; quello che l'utente scrive
 * a parole sue è la NOTA (max 200 caratteri), che resta all'utente: nessun
 * agente la legge e nessun prompt la riceve. Niente Next, SQLite o fs: la
 * desktop importa questo modulo così com'è.
 */

type Catalog = {
  note_max_chars: number;
  proposal_min_positions: number;
  reasons: string[];
  factual: string[];
  proposable: string[];
  legacy: Record<string, string>;
};
const catalog = CATALOG as Catalog;

export const REASON_KEYS = catalog.reasons as readonly string[];
export type ReasonKey =
  | "too_senior"
  | "too_junior"
  | "wrong_location"
  | "salary_low"
  | "wrong_stack"
  | "company"
  | "scam_or_gone"
  | "closed"
  | "already_applied"
  | "other";

export const NOTE_MAX = catalog.note_max_chars;
export const PROPOSAL_MIN_POSITIONS = catalog.proposal_min_positions;

export function isReasonKey(value: unknown): value is ReasonKey {
  return typeof value === "string" && REASON_KEYS.includes(value);
}

/** I motivi che parlano della POSIZIONE, non dei gusti di chi la guarda. */
export function isFactualReason(reason: string | null | undefined): boolean {
  return !!reason && catalog.factual.includes(reason);
}

/** I motivi su cui l'app può proporre un'esclusione del profilo. */
export function isProposableReason(reason: string | null | undefined): boolean {
  return !!reason && catalog.proposable.includes(reason);
}

/**
 * Un motivo salvato come codice del vocabolario: i codici del vecchio elenco si
 * rimappano (`not_interested` → `other`), un testo libero vale `other`, vuoto
 * vale null. Serve a chi riceve da un client vecchio, non a chi scrive.
 */
export function normalizeReason(value: unknown): ReasonKey | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (isReasonKey(text)) return text;
  const mapped = Object.prototype.hasOwnProperty.call(catalog.legacy, text)
    ? catalog.legacy[text]
    : "other";
  return mapped as ReasonKey;
}

/**
 * Il motivo che una richiesta porta, per le route che scrivono: un codice del
 * vocabolario, o un codice del VECCHIO elenco (un client non ancora aggiornato
 * lo manda ancora; vale `other`). Qualunque altra cosa — in particolare un
 * testo libero — è rifiutata: `null`.
 */
export function acceptReason(value: unknown): ReasonKey | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (isReasonKey(text)) return text;
  return Object.prototype.hasOwnProperty.call(catalog.legacy, text)
    ? (catalog.legacy[text] as ReasonKey)
    : null;
}

/**
 * I caratteri invisibili che si TOLGONO: gli stessi di `INVISIBLE_COMMANDS` in
 * `shared/skills/external_content.py` (comandi bidi, soft hyphen, ZWSP, word
 * joiner, BOM, annotazioni interlineari, tag). NON tutta la categoria Cf: ZWJ e
 * ZWNJ restano, con quelli si scrive (emoji composte, persiano, hindi).
 */
const INVISIBLE_COMMANDS =
  /[­​⁠﻿‪-‮⁦-⁩￹-￻\u{e0000}-\u{e007f}]/gu;

/**
 * La nota ripulita: NFC, senza caratteri di controllo né comandi bidi o
 * invisibili, spazi singoli. Non taglia: chi la riceve confronta con
 * `NOTE_MAX` e rifiuta, così un testo lungo non viene accorciato di nascosto.
 */
export function cleanNote(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.normalize("NFC").replace(/[\r\n\t\u2028\u2029]/g, " ");
  return text
    .replace(INVISIBLE_COMMANDS, "")
    .replace(/[\p{Cc}\p{Cs}\p{Co}\p{Cn}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type FeedbackEventLike = {
  id?: string | number | null;
  legacy_id: string | number | null | undefined;
  action: string;
  reason?: string | null;
  created_at?: string | null;
};

export type ExclusionProposal = {
  reason: ReasonKey;
  positions: number;
  legacy_ids: string[];
};

const REJECTIONS = new Set(["dislike", "hide"]);

/**
 * Le proposte di esclusione del profilo: per ogni motivo proponibile, le
 * posizioni DIVERSE il cui ULTIMO giudizio è una bocciatura con quel motivo.
 * La stessa posizione conta 1; se l'ultimo evento è `clear` (voto ritirato)
 * conta 0; `other` e i motivi fattuali non contano mai. Sotto soglia, niente.
 */
export function exclusionProposals(
  events: readonly FeedbackEventLike[],
  minPositions: number = PROPOSAL_MIN_POSITIONS,
): ExclusionProposal[] {
  const stamp = (e: FeedbackEventLike) => {
    const t = e.created_at ? Date.parse(e.created_at) : NaN;
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  const eventId = (e: FeedbackEventLike) => {
    const n = Number(e.id);
    return e.id == null || e.id === "" || !Number.isFinite(n) ? -1 : n;
  };
  // Chi e' piu' recente: l'orario, poi l'id dell'evento, poi, a parita', il
  // voto ritirato. Due eventi nello stesso secondo senza id non hanno un ordine
  // vero: vince `clear`, perche' un voto ritirato deve contare zero.
  const rank = (e: FeedbackEventLike): [number, number, number] => [
    stamp(e),
    eventId(e),
    REJECTIONS.has(e.action) ? 0 : 1,
  ];
  const later = (a: FeedbackEventLike, b: FeedbackEventLike) => {
    const x = rank(a);
    const y = rank(b);
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  };
  const latest = new Map<string, FeedbackEventLike>();
  for (const e of events) {
    if (e.legacy_id == null || e.legacy_id === "") continue;
    const id = String(e.legacy_id);
    const current = latest.get(id);
    if (!current || later(e, current)) latest.set(id, e);
  }
  const by = new Map<ReasonKey, string[]>();
  for (const [id, e] of latest) {
    if (!REJECTIONS.has(e.action)) continue;
    const reason = normalizeReason(e.reason);
    if (!reason || !isProposableReason(reason)) continue;
    by.set(reason, [...(by.get(reason) ?? []), id]);
  }
  return [...by]
    .filter(([, ids]) => ids.length >= minPositions)
    .map(([reason, ids]) => ({ reason, positions: ids.length, legacy_ids: ids.sort() }))
    .sort((a, b) => b.positions - a.positions || a.reason.localeCompare(b.reason));
}
