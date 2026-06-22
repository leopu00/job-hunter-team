"use client";

import { useLocale } from "@/lib/use-locale";

const T: Record<string, Record<string, string>> = {
  loading_profile: {
    it: "Caricamento profilo",
    en: "Loading profile",
    hu: "Profil betöltése",
    es: "Cargando perfil",
    de: "Profil wird geladen",
    fr: "Chargement du profil",
    pt: "Carregando perfil",
  },
};

export default function Loading() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  return (
    <div
      aria-busy="true"
      aria-label={tr("loading_profile")}
      style={{ animation: "fade-in 0.2s ease both" }}
    >
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-7 w-48 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-64 rounded bg-[var(--color-border)] animate-pulse" />
      </div>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6">
        <div className="h-4 w-full rounded bg-[var(--color-border)] mb-4 animate-pulse" />
        <div className="h-4 w-5/6 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
        <div className="h-4 w-4/5 rounded bg-[var(--color-border)] animate-pulse" />
      </div>
    </div>
  );
}
