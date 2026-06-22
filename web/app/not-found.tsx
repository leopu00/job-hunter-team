"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<Locale, Record<string, string>> = {
  it: {
    not_found: "pagina non trovata",
    message: "La risorsa richiesta non esiste o è stata spostata.",
    dashboard: "Dashboard",
    back: "← indietro",
  },
  en: {
    not_found: "page not found",
    message: "The requested resource does not exist or has been moved.",
    dashboard: "Dashboard",
    back: "← back",
  },
  es: {
    not_found: "página no encontrada",
    message: "El recurso solicitado no existe o ha sido movido.",
    dashboard: "Panel",
    back: "← atrás",
  },
  fr: {
    not_found: "page introuvable",
    message: "La ressource demandée n'existe pas ou a été déplacée.",
    dashboard: "Tableau de bord",
    back: "← retour",
  },
  de: {
    not_found: "Seite nicht gefunden",
    message: "Die angeforderte Ressource existiert nicht oder wurde verschoben.",
    dashboard: "Dashboard",
    back: "← zurück",
  },
  hu: {
    not_found: "oldal nem található",
    message: "A kért erőforrás nem létezik, vagy áthelyezték.",
    dashboard: "Irányítópult",
    back: "← vissza",
  },
  pt: {
    not_found: "página não encontrada",
    message: "O recurso solicitado não existe ou foi movido.",
    dashboard: "Painel",
    back: "← voltar",
  },
};

export default function NotFound() {
  const pathname = usePathname();
  const locale = useLocale();
  const tr = (k: string) => T[locale]?.[k] ?? T.en[k] ?? k;
  return (
    <div
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
          <h1
            className="text-[120px] font-bold leading-none tracking-tighter"
            style={{
              color: "var(--color-border)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            404
          </h1>
          <div className="mt-[-16px] flex items-center justify-center gap-2">
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
              {tr("not_found")}
            </span>
          </div>
        </div>

        {/* Message */}
        <p
          className="text-[13px] mb-8 leading-relaxed"
          style={{ color: "var(--color-muted)" }}
        >
          {tr("message")}
        </p>

        {/* Actions */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link
            href="/dashboard"
            className="px-5 py-2.5 rounded-lg text-[12px] font-bold no-underline transition-all"
            style={{ background: "var(--color-green)", color: "#000" }}
          >
            {tr("dashboard")}
          </Link>
          <button
            onClick={() => window.history.back()}
            className="px-5 py-2.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-all"
            style={{
              border: "1px solid var(--color-border)",
              color: "var(--color-muted)",
              background: "transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--color-muted)";
              e.currentTarget.style.color = "var(--color-bright)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--color-border)";
              e.currentTarget.style.color = "var(--color-muted)";
            }}
          >
            {tr("back")}
          </button>
        </div>

        {/* Current path: usePathname() è safe SSR+client, evita
             hydration mismatch (window.location.pathname è undefined
             sul server → stringa vuota → il client poi mostra il path
             reale e React protesta). */}
        <p
          className="mt-8 text-[9px] font-mono"
          style={{ color: "var(--color-dim)" }}
        >
          {pathname}
        </p>
      </div>
    </div>
  );
}
