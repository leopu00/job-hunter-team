"use client";

// Il selettore del sistema operativo.
//
// Resta appiccicato in alto mentre si scorre: la guida cambia sotto le dita
// e chi legge dal telefono deve poter correggere la scelta senza risalire
// tutta la pagina. Tre bersagli a piena larghezza su mobile — 44 px di
// altezza minima, la misura di un pollice — e in riga dal tablet in su.

import { OsIcon } from "./OsIcons";
import { OS_IDS, OS_LABELS, type OsId } from "./guide-types";

export default function OsSelector({
  os,
  onChange,
  label,
}: {
  os: OsId;
  onChange: (next: OsId) => void;
  label: string;
}) {
  return (
    <div
      className="sticky top-[56px] z-20 -mx-6 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-6 py-3 backdrop-blur sm:top-[64px]"
      role="group"
      aria-label={label}
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-dim)]">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {OS_IDS.map((id) => {
          const selected = id === os;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-pressed={selected}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-md border px-2 py-2 text-[13px] font-semibold transition-colors ${
                selected
                  ? "border-[var(--color-green)] text-[var(--color-green)]"
                  : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-muted)] hover:text-[var(--color-bright)]"
              }`}
            >
              <OsIcon os={id} />
              <span>{OS_LABELS[id]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
