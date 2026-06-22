"use client";

import { useEffect } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<Locale, Record<string, string>> = {
  it: {
    runtime_error: "errore runtime",
    title: "Qualcosa è andato storto",
    fallback: "Errore imprevisto. Riprova o torna al pannello.",
    retry: "Riprova",
    dashboard: "Dashboard →",
  },
  en: {
    runtime_error: "runtime error",
    title: "Something went wrong",
    fallback: "Unexpected error. Please try again or return to the dashboard.",
    retry: "Retry",
    dashboard: "Dashboard →",
  },
  es: {
    runtime_error: "error de ejecución",
    title: "Algo salió mal",
    fallback: "Error inesperado. Inténtalo de nuevo o vuelve al panel.",
    retry: "Reintentar",
    dashboard: "Panel →",
  },
  fr: {
    runtime_error: "erreur d'exécution",
    title: "Une erreur s'est produite",
    fallback: "Erreur inattendue. Réessayez ou retournez au tableau de bord.",
    retry: "Réessayer",
    dashboard: "Tableau de bord →",
  },
  de: {
    runtime_error: "Laufzeitfehler",
    title: "Etwas ist schiefgelaufen",
    fallback:
      "Unerwarteter Fehler. Bitte versuchen Sie es erneut oder kehren Sie zum Dashboard zurück.",
    retry: "Wiederholen",
    dashboard: "Dashboard →",
  },
  hu: {
    runtime_error: "futásidejű hiba",
    title: "Valami hiba történt",
    fallback:
      "Váratlan hiba. Próbálja újra, vagy térjen vissza az irányítópultra.",
    retry: "Újra",
    dashboard: "Irányítópult →",
  },
  pt: {
    runtime_error: "erro de execução",
    title: "Algo correu mal",
    fallback: "Erro inesperado. Tente novamente ou volte ao painel.",
    retry: "Tentar novamente",
    dashboard: "Painel →",
  },
};

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useLocale();
  const tr = (k: string) => T[locale]?.[k] ?? T.en[k] ?? k;

  useEffect(() => {
    console.error("[JHT] page error:", error);
  }, [error]);

  return (
    <main
      role="alert"
      className="min-h-screen flex items-center justify-center px-5"
      style={{
        position: "relative",
        zIndex: 1,
        animation: "fade-in 0.35s ease both",
      }}
    >
      <div className="text-center max-w-md">
        {/* Error code */}
        <div className="mb-6">
          <p
            aria-hidden="true"
            className="text-[80px] font-bold leading-none tracking-tighter"
            style={{
              color: "var(--color-border)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            ERR
          </p>
          <div className="mt-[-12px] flex items-center justify-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              aria-hidden="true"
              style={{
                background: "var(--color-red)",
                animation: "pulse-dot 2s ease-in-out infinite",
              }}
            />
            <span
              className="text-[10px] font-semibold tracking-[0.2em] uppercase"
              style={{ color: "var(--color-red)" }}
            >
              {tr("runtime_error")}
            </span>
          </div>
        </div>

        {/* Message */}
        <h1
          className="text-lg font-bold mb-2"
          style={{ color: "var(--color-white)" }}
        >
          {tr("title")}
        </h1>
        <p
          className="text-[12px] mb-6 leading-relaxed"
          style={{ color: "var(--color-muted)" }}
        >
          {error.message || tr("fallback")}
        </p>

        {error.digest && (
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg mb-6"
            style={{
              background: "var(--color-panel)",
              border: "1px solid var(--color-border)",
            }}
          >
            <span
              className="text-[9px] font-bold tracking-[0.15em] uppercase"
              style={{ color: "var(--color-dim)" }}
            >
              digest
            </span>
            <code
              className="text-[10px] font-mono"
              style={{ color: "var(--color-muted)" }}
            >
              {error.digest}
            </code>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={reset}
            className="px-5 py-2.5 rounded-lg text-[12px] font-bold transition-all cursor-pointer border-0"
            style={{ background: "var(--color-green)", color: "#000" }}
          >
            {tr("retry")}
          </button>
          <button
            onClick={() => (window.location.href = "/dashboard")}
            className="px-5 py-2.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-all"
            style={{
              border: "1px solid var(--color-border)",
              color: "var(--color-muted)",
              background: "transparent",
            }}
          >
            {tr("dashboard")}
          </button>
        </div>
      </div>
    </main>
  );
}
