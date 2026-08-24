// Il vocabolario dei motivi per cui una posizione non va più seguita.
//
// Vive qui e non dentro `ExcludeButton` perché da O-43 lo usano in due:
// l'esclusione manuale e l'azione rapida «Escludi». Due liste
// separate sarebbero divergite alla prima aggiunta — e infatti erano già
// divergenti da sé: `ReasonKey` dichiarava sette motivi e l'elenco mostrato
// ne aveva sei, con `already_applied` definito e mai raggiungibile.
//
// I CODICI sono il valore stabile nel database (`positions.user_excluded_reason`
// e `position_feedback.reason`); le etichette sono i18n e si possono
// riscrivere senza toccare i dati.
import type { Locale } from "@/i18n/config";

export type ReasonKey =
  | "closed"
  | "not_interested"
  | "mismatch"
  | "already_applied"
  | "company"
  | "conditions"
  | "other";

/** Ordine in cui l'utente li vede. Tutti e sette: mancarne uno lo rende
 *  inesistente per chi usa il prodotto, anche se il tipo lo conosce. */
export const REASON_ORDER: ReasonKey[] = [
  "closed",
  "not_interested",
  "mismatch",
  "already_applied",
  "company",
  "conditions",
  "other",
];

/**
 * I motivi che parlano della POSIZIONE, non dei gusti di chi la guarda.
 *
 * La distinzione non è filosofia: `agents/scout/scout.md` dice che con
 * `latest_direction='less_like_this'` lo Scout «deprioritizza» quella
 * azienda / famiglia di ruolo / località nelle ricerche future. Una
 * posizione ottima ma SCADUTA archiviata come «non interessante» insegna
 * quindi a evitarne di simili: è il difetto che l'operatore ha segnalato
 * cercando lavoro davvero.
 *
 * Per questi due motivi il gesto non deve produrre nessun segnale di gusto:
 * la posizione esce dal giro (esclusione) e il team non impara niente.
 */
export const FACTUAL_REASONS: ReasonKey[] = ["closed", "already_applied"];

export function isFactualReason(reason: string | null | undefined): boolean {
  return (
    !!reason && (FACTUAL_REASONS as readonly string[]).includes(reason as never)
  );
}

/** Il motivo «altro» esiste solo insieme al testo che lo spiega. */
export function needsFreeText(reason: string | null | undefined): boolean {
  return reason === "other";
}

/**
 * Che cosa deve succedere quando l'utente sceglie «Escludi» e indica un
 * motivo. L'esclusione è sempre l'effetto primario: il nome del controllo e
 * lo stato persistito non possono più raccontare due cose diverse.
 *
 * I motivi di gusto conservano anche il feedback `less_like_this`, ma solo
 * DOPO che l'esclusione canonica è stata confermata. I motivi fattuali non
 * insegnano preferenze allo Scout.
 */
export type NegativeSignal =
  | {
      kind: "exclude";
      reason: ReasonKey;
      note?: string;
      feedback?: { reason: ReasonKey; comment?: string };
    }
  | { kind: "invalid"; missing: "reason" | "text" };

export function negativeSignalFor(
  reason: string | null | undefined,
  note: string | null | undefined,
): NegativeSignal {
  const key = (reason ?? "").trim() as ReasonKey;
  if (!key || !REASON_ORDER.includes(key)) {
    return { kind: "invalid", missing: "reason" };
  }
  const text = (note ?? "").trim();
  if (needsFreeText(key) && !text) return { kind: "invalid", missing: "text" };
  if (isFactualReason(key)) {
    return { kind: "exclude", reason: key, ...(text ? { note: text } : {}) };
  }
  return {
    kind: "exclude",
    reason: key,
    ...(text ? { note: text } : {}),
    feedback: { reason: key, ...(text ? { comment: text } : {}) },
  };
}

export const REASON_LABELS: Record<Locale, Record<ReasonKey, string>> = {
  it: {
    closed: "Chiusa / non più attiva",
    not_interested: "Non mi interessa",
    mismatch: "Non in linea col mio profilo",
    already_applied: "Già candidato / gestita altrove",
    company: "Azienda non desiderata",
    conditions: "Condizioni inadatte (stipendio/sede)",
    other: "Altro…",
  },
  en: {
    closed: "Closed / no longer active",
    not_interested: "Not interested",
    mismatch: "Not a match for my profile",
    already_applied: "Already applied / handled elsewhere",
    company: "Unwanted company",
    conditions: "Unsuitable conditions (salary/location)",
    other: "Other…",
  },
  es: {
    closed: "Cerrada / ya no activa",
    not_interested: "No me interesa",
    mismatch: "No encaja con mi perfil",
    already_applied: "Ya inscrito / gestionada en otro sitio",
    company: "Empresa no deseada",
    conditions: "Condiciones inadecuadas (salario/ubicación)",
    other: "Otro…",
  },
  fr: {
    closed: "Fermée / plus active",
    not_interested: "Pas intéressé",
    mismatch: "Pas adapté à mon profil",
    already_applied: "Déjà postulé / traité ailleurs",
    company: "Entreprise non souhaitée",
    conditions: "Conditions inadaptées (salaire/lieu)",
    other: "Autre…",
  },
  de: {
    closed: "Geschlossen / nicht mehr aktiv",
    not_interested: "Kein Interesse",
    mismatch: "Passt nicht zu meinem Profil",
    already_applied: "Bereits beworben / anderweitig erledigt",
    company: "Unerwünschtes Unternehmen",
    conditions: "Ungeeignete Bedingungen (Gehalt/Standort)",
    other: "Sonstiges…",
  },
  hu: {
    closed: "Lezárva / már nem aktív",
    not_interested: "Nem érdekel",
    mismatch: "Nem illik a profilomhoz",
    already_applied: "Már jelentkeztem / máshol kezelve",
    company: "Nem kívánt cég",
    conditions: "Nem megfelelő feltételek (fizetés/helyszín)",
    other: "Egyéb…",
  },
  pt: {
    closed: "Fechada / já não ativa",
    not_interested: "Não tenho interesse",
    mismatch: "Não se adequa ao meu perfil",
    already_applied: "Já candidatado / tratado noutro lado",
    company: "Empresa indesejada",
    conditions: "Condições inadequadas (salário/local)",
    other: "Outro…",
  },
};

/** Strings condivise dal selettore, ovunque venga montato. */
export const PICKER_T: Record<
  Locale,
  { pickReason: string; writeReason: string; notePlaceholder: string }
> = {
  it: {
    pickReason: "Scegli una causa",
    writeReason: "Scrivi la causa",
    notePlaceholder: "Causa…",
  },
  en: {
    pickReason: "Pick a reason",
    writeReason: "Write the reason",
    notePlaceholder: "Reason…",
  },
  es: {
    pickReason: "Elige un motivo",
    writeReason: "Escribe el motivo",
    notePlaceholder: "Motivo…",
  },
  fr: {
    pickReason: "Choisissez un motif",
    writeReason: "Écrivez le motif",
    notePlaceholder: "Motif…",
  },
  de: {
    pickReason: "Grund auswählen",
    writeReason: "Grund eingeben",
    notePlaceholder: "Grund…",
  },
  hu: {
    pickReason: "Válassz okot",
    writeReason: "Írd be az okot",
    notePlaceholder: "Ok…",
  },
  pt: {
    pickReason: "Escolhe um motivo",
    writeReason: "Escreve o motivo",
    notePlaceholder: "Motivo…",
  },
};
