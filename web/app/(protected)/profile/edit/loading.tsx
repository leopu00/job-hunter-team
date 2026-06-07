"use client";

import { useLocale } from "@/lib/use-locale";

const T: Record<string, Record<string, string>> = {
  loading_profile_edit: {
    it: "Caricamento modifica profilo",
    en: "Loading profile editor",
    hu: "Profilszerkesztő betöltése",
    es: "Cargando edición de perfil",
    de: "Profilbearbeitung wird geladen",
    fr: "Chargement de la modification du profil",
    pt: "Carregando edição de perfil",
  },
};

export default function ProfileEditLoading() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  return (
    <div
      aria-busy="true"
      aria-label={tr("loading_profile_edit")}
      style={{ animation: "fade-in 0.2s ease both" }}
    >
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-7 w-48 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-64 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Form sections */}
      <div className="space-y-8">
        {/* Section 1: basic info */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
          <div className="h-4 w-32 rounded bg-[var(--color-border)] mb-5 animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <div className="h-2.5 w-20 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
                <div className="h-9 w-full rounded bg-[var(--color-border)] animate-pulse opacity-50" />
              </div>
            ))}
          </div>
        </div>

        {/* Section 2: contacts */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
          <div className="h-4 w-24 rounded bg-[var(--color-border)] mb-5 animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <div className="h-2.5 w-16 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
                <div className="h-9 w-full rounded bg-[var(--color-border)] animate-pulse opacity-50" />
              </div>
            ))}
          </div>
        </div>

        {/* Section 3: skills & lists */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
          <div className="h-4 w-36 rounded bg-[var(--color-border)] mb-5 animate-pulse" />
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <div className="h-2.5 w-24 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
                <div className="h-20 w-full rounded bg-[var(--color-border)] animate-pulse opacity-50" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Submit buttons */}
      <div className="flex gap-3 mt-8">
        <div className="h-10 w-28 rounded bg-[var(--color-border)] animate-pulse opacity-40" />
        <div className="h-10 w-28 rounded bg-[var(--color-border)] animate-pulse" />
      </div>
    </div>
  );
}
