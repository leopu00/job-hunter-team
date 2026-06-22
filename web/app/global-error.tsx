"use client";

import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<Locale, Record<string, string>> = {
  it: {
    critical_error: "errore critico",
    title: "Qualcosa è andato storto",
    fallback: "Errore imprevisto durante il caricamento dell'applicazione.",
    retry: "Riprova",
    back_home: "Torna alla home",
  },
  en: {
    critical_error: "critical error",
    title: "Something went wrong",
    fallback: "Unexpected error loading the application.",
    retry: "Retry",
    back_home: "Back to home",
  },
  es: {
    critical_error: "error crítico",
    title: "Algo salió mal",
    fallback: "Error inesperado al cargar la aplicación.",
    retry: "Reintentar",
    back_home: "Volver al inicio",
  },
  fr: {
    critical_error: "erreur critique",
    title: "Une erreur s'est produite",
    fallback:
      "Erreur inattendue lors du chargement de l'application.",
    retry: "Réessayer",
    back_home: "Retour à l'accueil",
  },
  de: {
    critical_error: "kritischer Fehler",
    title: "Etwas ist schiefgelaufen",
    fallback: "Unerwarteter Fehler beim Laden der Anwendung.",
    retry: "Wiederholen",
    back_home: "Zur Startseite",
  },
  hu: {
    critical_error: "kritikus hiba",
    title: "Valami hiba történt",
    fallback: "Váratlan hiba az alkalmazás betöltése közben.",
    retry: "Újra",
    back_home: "Vissza a főoldalra",
  },
  pt: {
    critical_error: "erro crítico",
    title: "Algo correu mal",
    fallback: "Erro inesperado ao carregar a aplicação.",
    retry: "Tentar novamente",
    back_home: "Voltar ao início",
  },
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // useLocale è privo di provider/context: legge solo document.cookie
  // (NEXT_LOCALE), quindi è sicuro qui dove i provider Next non sono montati.
  const locale = useLocale();
  const tr = (k: string) => T[locale]?.[k] ?? T.en[k] ?? k;
  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          background: "#060608",
          fontFamily: "system-ui, -apple-system, sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          role="alert"
          style={{ textAlign: "center", maxWidth: 420, padding: "0 20px" }}
        >
          <p
            aria-hidden="true"
            style={{
              fontSize: 80,
              fontWeight: 800,
              lineHeight: 1,
              color: "#1a1a1f",
              margin: 0,
              letterSpacing: "-0.04em",
            }}
          >
            ERR
          </p>
          <div
            style={{
              marginTop: -12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#f44336",
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.2em",
                textTransform: "uppercase" as const,
                color: "#f44336",
              }}
            >
              {tr("critical_error")}
            </span>
          </div>

          <h1
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#e0e0f0",
              marginTop: 24,
              marginBottom: 8,
            }}
          >
            {tr("title")}
          </h1>
          <p
            style={{
              fontSize: 12,
              color: "#888",
              lineHeight: 1.6,
              marginBottom: 24,
            }}
          >
            {error.message || tr("fallback")}
          </p>

          {error.digest && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderRadius: 8,
                background: "#0c0c10",
                border: "1px solid #1a1a1f",
                marginBottom: 24,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase" as const,
                  color: "#555",
                }}
              >
                digest
              </span>
              <code
                style={{ fontSize: 10, fontFamily: "monospace", color: "#888" }}
              >
                {error.digest}
              </code>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
            }}
          >
            <button
              onClick={reset}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                background: "#00e87a",
                color: "#000",
                border: "none",
                cursor: "pointer",
              }}
            >
              {tr("retry")}
            </button>
            <button
              onClick={() => {
                window.location.href = "/";
              }}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                background: "transparent",
                color: "#888",
                border: "1px solid #1a1a1f",
                cursor: "pointer",
              }}
            >
              {tr("back_home")}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
