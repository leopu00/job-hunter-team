"use client";

import { useLocale } from "@/lib/use-locale";

const T: Record<string, Record<string, string>> = {
  loading_positions: {
    it: "Caricamento posizioni",
    en: "Loading positions",
    hu: "Állások betöltése",
    es: "Cargando posiciones",
    de: "Stellen werden geladen",
    fr: "Chargement des postes",
    pt: "Carregando vagas",
  },
};

export default function Loading() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  return (
    <div
      aria-busy="true"
      aria-label={tr("loading_positions")}
      style={{ animation: "fade-in 0.2s ease both" }}
    >
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-7 w-48 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-64 rounded bg-[var(--color-border)] animate-pulse" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4"
          >
            <div className="h-3.5 w-48 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
            <div className="h-2.5 w-32 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
