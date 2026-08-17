import type { Locale } from "@/i18n/config";
import type { LocaleDict } from "@/lib/i18n-dict";

// Il DB conserva gli stati tecnici della pipeline: servono agli agenti per
// riprendere il lavoro esattamente dal punto giusto. La UI, invece, non deve
// esporre "review" (la revisione del Critico è un dettaglio interno) né
// sostituire lo stato con un ticket. Questa è l'unica proiezione DB → API/UI.
export const POSITION_STATUSES = [
  "new",
  "checked",
  "scored",
  "writing",
  "review",
  "ready",
  "applied",
  "response",
  "excluded",
] as const;

export type PositionStatusValue = (typeof POSITION_STATUSES)[number];

export const PUBLIC_POSITION_STATES = [
  "new",
  "checked",
  "scored",
  "preparing",
  "ready",
  "applied",
  "response",
  "excluded",
  "needs_attention",
] as const;

export type PublicPositionState = (typeof PUBLIC_POSITION_STATES)[number];
export type TicketIndicator = "none" | "pending";

const PUBLIC_STATE_BY_APPLICATION_STATUS: Readonly<
  Record<string, PublicPositionState>
> = Object.freeze({
  draft: "preparing",
  review: "preparing",
  approved: "ready",
  ready: "ready",
  applied: "applied",
  response: "response",
});

export const PUBLIC_STATE_BY_STATUS: Readonly<
  Record<PositionStatusValue, PublicPositionState>
> = Object.freeze({
  new: "new",
  checked: "checked",
  scored: "scored",
  writing: "preparing",
  review: "preparing",
  ready: "ready",
  applied: "applied",
  response: "response",
  excluded: "excluded",
});

export const PUBLIC_STATE_COLORS: Readonly<
  Record<PublicPositionState, string>
> = Object.freeze({
  new: "var(--color-muted)",
  checked: "var(--color-blue)",
  scored: "var(--color-purple)",
  preparing: "var(--color-yellow)",
  ready: "var(--color-ready)",
  applied: "var(--color-green)",
  response: "#58a6ff",
  excluded: "var(--color-red)",
  needs_attention: "var(--color-red)",
});

export const PUBLIC_STATE_LABELS: Readonly<
  Record<PublicPositionState, LocaleDict>
> = Object.freeze({
  new: {
    it: "Nuova",
    en: "New",
    hu: "Új",
    es: "Nueva",
    de: "Neu",
    fr: "Nouvelle",
    pt: "Nova",
  },
  checked: {
    it: "Analizzata",
    en: "Analyzed",
    hu: "Elemezve",
    es: "Analizada",
    de: "Analysiert",
    fr: "Analysée",
    pt: "Analisada",
  },
  scored: {
    it: "Valutata",
    en: "Scored",
    hu: "Értékelve",
    es: "Puntuada",
    de: "Bewertet",
    fr: "Évaluée",
    pt: "Avaliada",
  },
  preparing: {
    it: "In preparazione",
    en: "Preparing",
    hu: "Előkészítés alatt",
    es: "En preparación",
    de: "In Vorbereitung",
    fr: "En préparation",
    pt: "Em preparação",
  },
  ready: {
    it: "Pronta",
    en: "Ready",
    hu: "Kész",
    es: "Lista",
    de: "Bereit",
    fr: "Prête",
    pt: "Pronta",
  },
  applied: {
    it: "Candidatura inviata",
    en: "Application sent",
    hu: "Jelentkezés elküldve",
    es: "Candidatura enviada",
    de: "Bewerbung gesendet",
    fr: "Candidature envoyée",
    pt: "Candidatura enviada",
  },
  response: {
    it: "Risposta ricevuta",
    en: "Response received",
    hu: "Válasz érkezett",
    es: "Respuesta recibida",
    de: "Antwort erhalten",
    fr: "Réponse reçue",
    pt: "Resposta recebida",
  },
  excluded: {
    it: "Esclusa",
    en: "Excluded",
    hu: "Kizárva",
    es: "Excluida",
    de: "Ausgeschlossen",
    fr: "Exclue",
    pt: "Excluída",
  },
  needs_attention: {
    it: "Da verificare",
    en: "Needs review",
    hu: "Ellenőrizendő",
    es: "Por verificar",
    de: "Zu prüfen",
    fr: "À vérifier",
    pt: "A verificar",
  },
});

export const TICKET_INDICATOR_LABELS: Readonly<
  Record<Exclude<TicketIndicator, "none">, LocaleDict>
> = Object.freeze({
  pending: {
    it: "Ticket in corso",
    en: "Ticket pending",
    hu: "Folyamatban lévő ticket",
    es: "Ticket en curso",
    de: "Ticket in Bearbeitung",
    fr: "Ticket en cours",
    pt: "Ticket em curso",
  },
});

export function publicPositionState(status: unknown): PublicPositionState {
  return typeof status === "string" && status in PUBLIC_STATE_BY_STATUS
    ? PUBLIC_STATE_BY_STATUS[status as PositionStatusValue]
    : "needs_attention";
}

export function publicApplicationState(status: unknown): PublicPositionState {
  return typeof status === "string" &&
    status in PUBLIC_STATE_BY_APPLICATION_STATUS
    ? PUBLIC_STATE_BY_APPLICATION_STATUS[status]
    : "needs_attention";
}

export function publicPositionStateLabel(
  state: PublicPositionState,
  locale: string,
): string {
  return (
    PUBLIC_STATE_LABELS[state][locale as Locale] ??
    PUBLIC_STATE_LABELS[state].en
  );
}

export function ticketIndicatorLabel(locale: string): string {
  return (
    TICKET_INDICATOR_LABELS.pending[locale as Locale] ??
    TICKET_INDICATOR_LABELS.pending.en
  );
}

// I filtri usano gli stati pubblici. "preparing" espande i due stati tecnici
// writing/review; URL vecchi che contengono uno stato DB restano leggibili.
export function positionStatusesForFilters(
  values: readonly string[],
): string[] {
  const expanded = new Set<string>();
  for (const value of values) {
    if (value === "preparing") {
      expanded.add("writing");
      expanded.add("review");
    } else if ((POSITION_STATUSES as readonly string[]).includes(value)) {
      expanded.add(value);
    }
  }
  return [...expanded];
}

export function attachTicketIndicators<
  T extends { legacy_id?: number | null; status?: unknown },
>(rows: readonly T[], pendingLegacyIds: readonly number[]) {
  const pending = new Set(pendingLegacyIds);
  return rows.map((row) => {
    const hasOpenTicket =
      typeof row.legacy_id === "number" && pending.has(row.legacy_id);
    return {
      ...row,
      public_state: publicPositionState(row.status),
      has_open_ticket: hasOpenTicket,
      ticket_indicator: (hasOpenTicket ? "pending" : "none") as TicketIndicator,
    };
  });
}
