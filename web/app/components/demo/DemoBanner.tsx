"use client";

// [JHT-WEB-DEMO] Banda persistente sotto la navbar quando la modalità demo
// è attiva: etichetta chiaramente i dati come fittizi (richiesta utente
// 22/07) e offre le due uscite — collegare il team vero o uscire dalla
// demo. Renderizzata dal layout protetto, quindi visibile su OGNI pagina.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import type { DemoPersonaKey } from "@/lib/demo/data";
import { PERSONA_LABELS } from "@/app/components/demo/personas";

type Strings = {
  demo_label: string;
  demo_text: string;
  connect: string;
  exit: string;
};

const T: Record<Locale, Strings> = {
  it: {
    demo_label: "Modalità demo",
    demo_text:
      "Stai guardando dati di esempio ({p}). I tuoi dati appariranno quando collegherai il tuo team.",
    connect: "Collega il tuo team",
    exit: "Esci dalla demo",
  },
  en: {
    demo_label: "Demo mode",
    demo_text:
      "You are looking at sample data ({p}). Your own data will appear once you connect your team.",
    connect: "Connect your team",
    exit: "Exit demo",
  },
  es: {
    demo_label: "Modo demo",
    demo_text:
      "Estás viendo datos de ejemplo ({p}). Tus datos aparecerán cuando conectes tu equipo.",
    connect: "Conecta tu equipo",
    exit: "Salir de la demo",
  },
  fr: {
    demo_label: "Mode démo",
    demo_text:
      "Vous consultez des données d'exemple ({p}). Vos données apparaîtront quand vous connecterez votre équipe.",
    connect: "Connecter votre équipe",
    exit: "Quitter la démo",
  },
  de: {
    demo_label: "Demo-Modus",
    demo_text:
      "Du siehst Beispieldaten ({p}). Deine eigenen Daten erscheinen, sobald du dein Team verbindest.",
    connect: "Team verbinden",
    exit: "Demo verlassen",
  },
  hu: {
    demo_label: "Demó mód",
    demo_text:
      "Mintaadatokat látsz ({p}). A saját adataid akkor jelennek meg, amikor összekapcsolod a csapatodat.",
    connect: "Csapat összekapcsolása",
    exit: "Kilépés a demóból",
  },
  pt: {
    demo_label: "Modo demo",
    demo_text:
      "Estás a ver dados de exemplo ({p}). Os teus dados vão aparecer quando ligares a tua equipa.",
    connect: "Liga a tua equipa",
    exit: "Sair da demo",
  },
};

export default function DemoBanner({ persona }: { persona: DemoPersonaKey }) {
  const locale = useLocale();
  const t = T[locale];
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const exitDemo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/demo", { method: "DELETE" });
    } catch {}
    // Full refresh: tutte le pagine server devono rifetchare senza cookie.
    window.location.href = "/dashboard";
  };
  void router;

  return (
    <div
      className="sticky top-14 z-20 border-b px-4 py-2"
      style={{
        background:
          "color-mix(in srgb, var(--color-yellow) 12%, var(--color-panel))",
        borderColor: "color-mix(in srgb, var(--color-yellow) 35%, transparent)",
      }}
    >
      <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] uppercase shrink-0"
          style={{ color: "var(--color-yellow)" }}
        >
          {/* icona beuta (dati di laboratorio/prova) */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M10 2v6L4 20a1.5 1.5 0 0 0 1.4 2h13.2a1.5 1.5 0 0 0 1.4-2L14 8V2" />
            <path d="M8.5 2h7" />
            <path d="M7 15h10" />
          </svg>
          {t.demo_label}
        </span>
        <span className="text-[11px] text-[var(--color-muted)] min-w-0">
          {t.demo_text.replace("{p}", PERSONA_LABELS[locale][persona])}
        </span>
        <span className="flex items-center gap-2 ml-auto shrink-0">
          <Link
            href="/welcome"
            className="text-[10px] font-semibold tracking-[0.08em] uppercase no-underline px-2.5 py-1 rounded border transition-colors"
            style={{
              color: "var(--color-green)",
              borderColor:
                "color-mix(in srgb, var(--color-green) 45%, transparent)",
            }}
          >
            {t.connect}
          </Link>
          <button
            type="button"
            onClick={exitDemo}
            disabled={busy}
            className="text-[10px] font-semibold tracking-[0.08em] uppercase px-2.5 py-1 rounded border border-[var(--color-border)] text-[var(--color-dim)] hover:text-[var(--color-bright)] hover:border-[var(--color-border-glow)] transition-colors cursor-pointer disabled:opacity-50"
          >
            {t.exit}
          </button>
        </span>
      </div>
    </div>
  );
}
