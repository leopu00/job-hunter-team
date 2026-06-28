"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<
  Locale,
  {
    title: string;
    unexpected: string;
    retry: string;
    backToDashboard: string;
  }
> = {
  it: {
    title: "Errore nel caricamento",
    unexpected: "Si è verificato un errore imprevisto.",
    retry: "Riprova",
    backToDashboard: "Torna alla Dashboard",
  },
  en: {
    title: "Loading error",
    unexpected: "An unexpected error occurred.",
    retry: "Retry",
    backToDashboard: "Back to Dashboard",
  },
  es: {
    title: "Error de carga",
    unexpected: "Se ha producido un error inesperado.",
    retry: "Reintentar",
    backToDashboard: "Volver al Panel",
  },
  fr: {
    title: "Erreur de chargement",
    unexpected: "Une erreur inattendue s'est produite.",
    retry: "Réessayer",
    backToDashboard: "Retour au tableau de bord",
  },
  de: {
    title: "Ladefehler",
    unexpected: "Ein unerwarteter Fehler ist aufgetreten.",
    retry: "Erneut versuchen",
    backToDashboard: "Zurück zum Dashboard",
  },
  hu: {
    title: "Betöltési hiba",
    unexpected: "Váratlan hiba történt.",
    retry: "Újra",
    backToDashboard: "Vissza az irányítópultra",
  },
  pt: {
    title: "Erro de carregamento",
    unexpected: "Ocorreu um erro inesperado.",
    retry: "Tentar de novo",
    backToDashboard: "Voltar ao Painel",
  },
};

export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = T[useLocale()];
  useEffect(() => {
    console.error("[JHT] errore area protetta:", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex items-center justify-center py-20"
      style={{ animation: "fade-in 0.3s ease both" }}
    >
      <div className="w-full max-w-md flex flex-col items-center gap-4 text-center">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{
            background: "rgba(244,67,54,0.1)",
            border: "1px solid rgba(244,67,54,0.25)",
          }}
        >
          <span className="text-[16px]" style={{ color: "var(--color-red)" }}>
            !
          </span>
        </div>
        <h2
          className="text-[16px] font-bold"
          style={{ color: "var(--color-white)" }}
        >
          {t.title}
        </h2>
        <p
          className="text-[11px] leading-relaxed"
          style={{ color: "var(--color-muted)" }}
        >
          {error.message || t.unexpected}
        </p>
        {error.digest && (
          <p
            className="text-[9px] font-mono px-3 py-1 rounded"
            style={{
              color: "var(--color-dim)",
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            {error.digest}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
            style={{ background: "var(--color-green)", color: "#000" }}
          >
            {t.retry}
          </button>
          <Link
            href="/dashboard"
            className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-colors no-underline"
            style={{
              border: "1px solid var(--color-border)",
              color: "var(--color-muted)",
            }}
          >
            {t.backToDashboard}
          </Link>
        </div>
      </div>
    </div>
  );
}
