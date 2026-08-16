"use client";

// Il selettore del motivo, uno solo per le due superfici che lo chiedono:
// l'esclusione manuale (`ExcludeButton`) e il giudizio «Non interessante»
// (`FeedbackButtons`). Prima esisteva solo dentro il primo, e il secondo
// registrava un segnale negativo senza chiedere niente.
//
// Qui dentro non c'è nessuna decisione su COSA farne: il componente
// raccoglie motivo e testo libero, chi lo monta decide se quel motivo
// diventa un'esclusione o un giudizio (vedi `isFactualReason`).

import { useLocale } from "@/lib/use-locale";
import {
  PICKER_T,
  REASON_LABELS,
  REASON_ORDER,
  needsFreeText,
  type ReasonKey,
} from "./exclusion-reasons";

export function ReasonPicker({
  value,
  onChange,
  note,
  onNoteChange,
  disabled,
  placeholder,
  selectTitle,
  className,
}: {
  value: string;
  onChange: (reason: string) => void;
  note: string;
  onNoteChange: (note: string) => void;
  disabled?: boolean;
  /** Prima voce del menu: la superficie che lo monta le dà il suo nome. */
  placeholder: string;
  selectTitle?: string;
  className?: string;
}) {
  const locale = useLocale();
  const labels = REASON_LABELS[locale];
  const t = PICKER_T[locale];

  return (
    <span className={className ?? "flex items-center gap-1.5"}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="px-2 py-2 rounded-lg border text-[11px] font-semibold disabled:opacity-60 min-w-0"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--color-text)",
          background: "var(--color-row)",
        }}
        title={selectTitle}
      >
        <option value="">{placeholder}</option>
        {REASON_ORDER.map((k: ReasonKey) => (
          <option key={k} value={k}>
            {labels[k]}
          </option>
        ))}
      </select>
      {needsFreeText(value) && (
        <input
          type="text"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          maxLength={500}
          placeholder={t.notePlaceholder}
          disabled={disabled}
          className="px-2 py-2 rounded-lg border text-[11px] w-40 min-w-0"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
            background: "var(--color-row)",
          }}
        />
      )}
    </span>
  );
}
