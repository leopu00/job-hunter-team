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
import {
  NOTE_MAX,
  REASON_KEYS,
  cleanNote,
  isFactualReason as isFactualCode,
  type ReasonKey,
} from "@/lib/feedback-reasons";

export type { ReasonKey };

/** Ordine in cui l'utente li vede: l'elenco del vocabolario chiuso, tutti e dieci. */
export const REASON_ORDER = REASON_KEYS as readonly ReasonKey[] as ReasonKey[];

/**
 * I motivi che parlano della POSIZIONE, non dei gusti di chi la guarda.
 *
 * `agents/scout/scout.md` dice che con `latest_direction='less_like_this'` lo
 * Scout «deprioritizza» quella azienda / famiglia di ruolo / località nelle
 * ricerche future. Una posizione ottima ma SCADUTA archiviata come «non
 * interessante» insegna quindi a evitarne di simili. Per questi motivi
 * (`closed`, `already_applied`, `scam_or_gone`) il gesto non produce nessun
 * segnale di gusto: la posizione esce dal giro e il team non impara niente.
 */
export const FACTUAL_REASONS: ReasonKey[] = REASON_ORDER.filter((r) =>
  isFactualCode(r),
);

export function isFactualReason(reason: string | null | undefined): boolean {
  return isFactualCode(reason);
}

/**
 * Dal 19/10 (JHT-T05) nessun motivo pretende un testo: la nota è facoltativa,
 * max 200 caratteri, e resta all'utente.
 */
export function needsFreeText(_reason: string | null | undefined): boolean {
  return false;
}

/**
 * Che cosa deve succedere quando l'utente sceglie «Escludi» e indica un
 * motivo. L'esclusione è sempre l'effetto primario: il nome del controllo e
 * lo stato persistito non possono più raccontare due cose diverse.
 *
 * I motivi di gusto conservano anche il feedback `less_like_this`, ma solo
 * DOPO che l'esclusione canonica è stata confermata. I motivi fattuali non
 * insegnano preferenze allo Scout. La nota viaggia come `note` sia
 * nell'esclusione sia nel feedback, e nessun agente la legge.
 */
export type NegativeSignal =
  | {
      kind: "exclude";
      reason: ReasonKey;
      note?: string;
      feedback?: { reason: ReasonKey; note?: string };
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
  const text = cleanNote(note).slice(0, NOTE_MAX);
  if (isFactualReason(key)) {
    return { kind: "exclude", reason: key, ...(text ? { note: text } : {}) };
  }
  return {
    kind: "exclude",
    reason: key,
    ...(text ? { note: text } : {}),
    feedback: { reason: key, ...(text ? { note: text } : {}) },
  };
}

export const REASON_LABELS: Record<Locale, Record<ReasonKey, string>> = {
  it: {
    too_senior: "Troppo senior",
    too_junior: "Troppo junior",
    wrong_location: "Sede sbagliata",
    salary_low: "Stipendio troppo basso",
    wrong_stack: "Stack non adatto",
    company: "Azienda non desiderata",
    scam_or_gone: "Truffa o non più valida",
    closed: "Chiusa / non più attiva",
    already_applied: "Già candidato / gestita altrove",
    other: "Altro",
  },
  en: {
    too_senior: "Too senior",
    too_junior: "Too junior",
    wrong_location: "Wrong location",
    salary_low: "Salary too low",
    wrong_stack: "Wrong stack",
    company: "Unwanted company",
    scam_or_gone: "Scam or gone",
    closed: "Closed / no longer active",
    already_applied: "Already applied / handled elsewhere",
    other: "Other",
  },
  es: {
    too_senior: "Demasiado senior",
    too_junior: "Demasiado junior",
    wrong_location: "Ubicación inadecuada",
    salary_low: "Salario demasiado bajo",
    wrong_stack: "Stack inadecuado",
    company: "Empresa no deseada",
    scam_or_gone: "Estafa o ya no existe",
    closed: "Cerrada / ya no activa",
    already_applied: "Ya inscrito / gestionada en otro sitio",
    other: "Otro",
  },
  fr: {
    too_senior: "Trop senior",
    too_junior: "Trop junior",
    wrong_location: "Mauvais lieu",
    salary_low: "Salaire trop bas",
    wrong_stack: "Stack inadapté",
    company: "Entreprise non souhaitée",
    scam_or_gone: "Arnaque ou disparue",
    closed: "Fermée / plus active",
    already_applied: "Déjà postulé / traité ailleurs",
    other: "Autre",
  },
  de: {
    too_senior: "Zu senior",
    too_junior: "Zu junior",
    wrong_location: "Falscher Standort",
    salary_low: "Gehalt zu niedrig",
    wrong_stack: "Falscher Tech-Stack",
    company: "Unerwünschtes Unternehmen",
    scam_or_gone: "Betrug oder nicht mehr verfügbar",
    closed: "Geschlossen / nicht mehr aktiv",
    already_applied: "Bereits beworben / anderweitig erledigt",
    other: "Sonstiges",
  },
  hu: {
    too_senior: "Túl senior",
    too_junior: "Túl junior",
    wrong_location: "Nem megfelelő helyszín",
    salary_low: "Túl alacsony fizetés",
    wrong_stack: "Nem megfelelő technológia",
    company: "Nem kívánt cég",
    scam_or_gone: "Csalás vagy megszűnt",
    closed: "Lezárva / már nem aktív",
    already_applied: "Már jelentkeztem / máshol kezelve",
    other: "Egyéb",
  },
  pt: {
    too_senior: "Demasiado sénior",
    too_junior: "Demasiado júnior",
    wrong_location: "Localização inadequada",
    salary_low: "Salário demasiado baixo",
    wrong_stack: "Stack inadequado",
    company: "Empresa indesejada",
    scam_or_gone: "Fraude ou já não existe",
    closed: "Fechada / já não ativa",
    already_applied: "Já candidatado / tratado noutro lado",
    other: "Outro",
  },
};

/** Strings condivise dal selettore, ovunque venga montato. */
export const PICKER_T: Record<
  Locale,
  {
    pickReason: string;
    writeReason: string;
    notePlaceholder: string;
    notePrivate: string;
  }
> = {
  it: {
    pickReason: "Scegli una causa",
    writeReason: "Scrivi la causa",
    notePlaceholder: "Nota privata (facoltativa)",
    notePrivate: "Solo tua: il team non la legge mai.",
  },
  en: {
    pickReason: "Pick a reason",
    writeReason: "Write the reason",
    notePlaceholder: "Private note (optional)",
    notePrivate: "Only yours: the team never reads it.",
  },
  es: {
    pickReason: "Elige un motivo",
    writeReason: "Escribe el motivo",
    notePlaceholder: "Nota privada (opcional)",
    notePrivate: "Solo tuya: el equipo nunca la lee.",
  },
  fr: {
    pickReason: "Choisissez un motif",
    writeReason: "Écrivez le motif",
    notePlaceholder: "Note privée (facultative)",
    notePrivate: "Rien que pour vous : l'équipe ne la lit jamais.",
  },
  de: {
    pickReason: "Grund auswählen",
    writeReason: "Grund eingeben",
    notePlaceholder: "Private Notiz (optional)",
    notePrivate: "Nur für dich: das Team liest sie nie.",
  },
  hu: {
    pickReason: "Válassz okot",
    writeReason: "Írd be az okot",
    notePlaceholder: "Privát megjegyzés (nem kötelező)",
    notePrivate: "Csak a tiéd: a csapat sosem olvassa.",
  },
  pt: {
    pickReason: "Escolhe um motivo",
    writeReason: "Escreve o motivo",
    notePlaceholder: "Nota privada (opcional)",
    notePrivate: "Só tua: a equipa nunca a lê.",
  },
};
