"use client";

// O-105 — perché hanno detto di no.
//
// È un FRATELLO di `ReasonPicker`, non un suo riuso, e la ragione sta in tre
// cose che cambiano tutte insieme: il vocabolario (là «perché NON MI
// interessa», qui «perché HANNO detto di no»), le etichette, e soprattutto
// QUANDO compare il testo libero. `ReasonPicker` lo mostra solo scegliendo
// «altro» — `needsFreeText()` — quindi là il testo è un'ALTERNATIVA ai
// predefiniti. Qui deve essere un di più ACCANTO, sempre disponibile.
//
// La misura che ha deciso questa forma, e che va letta insieme al codice
// perché da sola dice il contrario di quello che sembra: sulle 127 esclusioni
// con motivo, «altro» ne ha 31 e tutte e 31 hanno la nota; ogni altro motivo
// ha ZERO note. Quello zero non è come si comportano gli utenti — è che la
// casella non gliel'hanno mai offerta.
//
// Piegare l'originale per farci stare tre eccezioni avrebbe cambiato di
// striscio la semantica dell'esclusione, che non è di questo ticket.

import { useLocale } from "@/lib/use-locale";
import {
  REJECTION_REASONS,
  REJECTION_NOTE_MAX,
  type RejectionReason,
} from "@/lib/applications/outcome";

type Locale = "it" | "en" | "hu" | "es" | "de" | "fr" | "pt";

// Le etichette stanno qui e non nel modulo condiviso perché quello lo importa
// anche la route API, che di traduzioni non sa niente. Il tipo obbliga a tutte
// e sette le lingue: un motivo nuovo costa una riga nel vocabolario e sette
// qui, e dimenticarne una non compila.
export const REJECTION_LABELS: Record<
  Locale,
  Record<RejectionReason, string>
> = {
  it: {
    location: "Sede / spostamenti",
    salary: "Stipendio",
    experience: "Esperienza richiesta",
    language: "Lingua",
  },
  en: {
    location: "Location / commute",
    salary: "Salary",
    experience: "Required experience",
    language: "Language",
  },
  hu: {
    location: "Helyszín / ingázás",
    salary: "Fizetés",
    experience: "Elvárt tapasztalat",
    language: "Nyelv",
  },
  es: {
    location: "Ubicación / desplazamiento",
    salary: "Salario",
    experience: "Experiencia requerida",
    language: "Idioma",
  },
  de: {
    location: "Standort / Anfahrt",
    salary: "Gehalt",
    experience: "Geforderte Erfahrung",
    language: "Sprache",
  },
  fr: {
    location: "Lieu / trajet",
    salary: "Salaire",
    experience: "Expérience demandée",
    language: "Langue",
  },
  pt: {
    location: "Local / deslocação",
    salary: "Salário",
    experience: "Experiência exigida",
    language: "Idioma",
  },
};

const T: Record<
  Locale,
  { question: string; noReason: string; notePlaceholder: string; save: string }
> = {
  it: {
    question: "Perché? (facoltativo)",
    noReason: "Nessun motivo",
    notePlaceholder: "Aggiungi un dettaglio…",
    save: "Salva",
  },
  en: {
    question: "Why? (optional)",
    noReason: "No reason",
    notePlaceholder: "Add a detail…",
    save: "Save",
  },
  hu: {
    question: "Miért? (nem kötelező)",
    noReason: "Nincs megadva ok",
    notePlaceholder: "Adj hozzá részletet…",
    save: "Mentés",
  },
  es: {
    question: "¿Por qué? (opcional)",
    noReason: "Sin motivo",
    notePlaceholder: "Añade un detalle…",
    save: "Guardar",
  },
  de: {
    question: "Warum? (optional)",
    noReason: "Kein Grund",
    notePlaceholder: "Detail hinzufügen…",
    save: "Speichern",
  },
  fr: {
    question: "Pourquoi ? (facultatif)",
    noReason: "Aucun motif",
    notePlaceholder: "Ajoute un détail…",
    save: "Enregistrer",
  },
  pt: {
    question: "Porquê? (opcional)",
    noReason: "Sem motivo",
    notePlaceholder: "Adiciona um detalhe…",
    save: "Guardar",
  },
};

export function RejectionReasonPicker({
  reason,
  note,
  onReasonChange,
  onNoteChange,
  onSave,
  disabled,
  dirty,
}: {
  reason: string;
  note: string;
  onReasonChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  disabled?: boolean;
  /** C'è qualcosa da salvare: senza questo il bottone mente su cosa farà. */
  dirty: boolean;
}) {
  const locale = (useLocale() ?? "it") as Locale;
  const labels = REJECTION_LABELS[locale] ?? REJECTION_LABELS.it;
  const t = T[locale] ?? T.it;

  return (
    <div className="mt-2">
      <p className="mb-1.5 text-[10px] text-[var(--color-dim)]">{t.question}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          disabled={disabled}
          data-rejection-reason=""
          className="min-w-0 rounded-lg border px-2 py-2 text-[11px] font-semibold disabled:opacity-60"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
            background: "var(--color-row)",
          }}
        >
          <option value="">{t.noReason}</option>
          {REJECTION_REASONS.map((k) => (
            <option key={k} value={k}>
              {labels[k]}
            </option>
          ))}
        </select>
        {/* SEMPRE presente, con qualunque motivo e anche senza: è il campo che
            raccoglie ciò che i quattro predefiniti non coprono — «hanno preso
            un altro» in testa — e da cui la lista crescerà sui dati. */}
        <input
          type="text"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          maxLength={REJECTION_NOTE_MAX}
          placeholder={t.notePlaceholder}
          disabled={disabled}
          data-rejection-note=""
          className="min-w-0 flex-1 rounded-lg border px-2 py-2 text-[11px]"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
            background: "var(--color-row)",
          }}
        />
        {dirty && (
          <button
            type="button"
            onClick={onSave}
            disabled={disabled}
            className="rounded-lg border px-3 py-2 text-[11px] font-semibold disabled:opacity-60"
            style={{
              borderColor: "var(--color-accent)",
              color: "var(--color-accent)",
            }}
          >
            {t.save}
          </button>
        )}
      </div>
    </div>
  );
}
