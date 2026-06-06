"use client";

import { useLocale } from "@/lib/use-locale";

const T: Record<string, Record<string, string>> = {
  loading: {
    it: "Caricamento",
    en: "Loading",
    hu: "Betöltés",
    es: "Cargando",
    de: "Wird geladen",
    fr: "Chargement",
    pt: "Carregando",
  },
  loading_lower: {
    it: "caricamento…",
    en: "loading…",
    hu: "betöltés…",
    es: "cargando…",
    de: "wird geladen…",
    fr: "chargement…",
    pt: "carregando…",
  },
};

export default function ProtectedLoading() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={tr("loading")}
      className="flex items-center justify-center py-20"
      style={{ animation: "fade-in 0.2s ease both" }}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full animate-bounce"
              style={{
                background: "var(--color-green)",
                animationDelay: `${i * 0.15}s`,
                animationDuration: "0.9s",
              }}
            />
          ))}
        </div>
        <p
          className="text-[10px] uppercase tracking-widest"
          style={{ color: "var(--color-dim)" }}
        >
          {tr("loading_lower")}
        </p>
      </div>
    </div>
  );
}
