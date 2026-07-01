"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<
  Locale,
  {
    tester: string;
    collapse: string;
    collapseAria: string;
    model: string;
    show: string;
    showAria: string;
  }
> = {
  it: {
    tester: "Tester",
    collapse: "Comprimi",
    collapseAria: "Comprimi la lista tester",
    model: "modello",
    show: "Mostra i tester",
    showAria: "Mostra la lista tester",
  },
  en: {
    tester: "Tester",
    collapse: "Collapse",
    collapseAria: "Collapse the tester list",
    model: "model",
    show: "Show testers",
    showAria: "Show the tester list",
  },
  es: {
    tester: "Tester",
    collapse: "Contraer",
    collapseAria: "Contraer la lista de testers",
    model: "modelo",
    show: "Mostrar los testers",
    showAria: "Mostrar la lista de testers",
  },
  fr: {
    tester: "Testeur",
    collapse: "Réduire",
    collapseAria: "Réduire la liste des testeurs",
    model: "modèle",
    show: "Afficher les testeurs",
    showAria: "Afficher la liste des testeurs",
  },
  de: {
    tester: "Tester",
    collapse: "Einklappen",
    collapseAria: "Tester-Liste einklappen",
    model: "Modell",
    show: "Tester anzeigen",
    showAria: "Tester-Liste anzeigen",
  },
  hu: {
    tester: "Tesztelő",
    collapse: "Összecsukás",
    collapseAria: "Tesztelők listájának összecsukása",
    model: "modell",
    show: "Tesztelők megjelenítése",
    showAria: "Tesztelők listájának megjelenítése",
  },
  pt: {
    tester: "Testador",
    collapse: "Recolher",
    collapseAria: "Recolher a lista de testadores",
    model: "modelo",
    show: "Mostrar os testadores",
    showAria: "Mostrar a lista de testadores",
  },
};

/**
 * Layout della pagina /case-studies: sidebar collassabile a sinistra con
 * l'elenco dei tester + contenuto a destra (hero, contribuisci…).
 *
 * Ogni voce della sidebar mette in primo piano ciò che distingue il tester
 * — categoria (Finance), aree geografiche (Italia · Europa) e modello usato
 * (Codex) — più che il numero progressivo "Beta tester N", che resta come
 * etichetta secondaria. Clic su una voce → /case-studies/[id].
 *
 * Lo stato di collapse vive qui (client): da aperto mostra la sidebar (260px),
 * da chiuso compare un pulsante "☰ Tester" che la riapre, e il contenuto
 * prende tutta la larghezza.
 */

export interface CaseStudyTeaser {
  id: string;
  label: string;
  badge: string;
  category: string;
  seniority: string;
  geos: string[];
  model: string;
}

export default function CaseStudiesShell({
  testers,
  children,
  activeId,
}: {
  testers: CaseStudyTeaser[];
  children: React.ReactNode;
  /** id del tester corrente (nelle pagine di dettaglio): la sua voce è evidenziata */
  activeId?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const t = T[useLocale()];

  return (
    <div className="flex items-stretch">
      {/* ── Menu laterale: pannello a tutta altezza agganciato al bordo
            sinistro (desktop). Su mobile è nascosto: le stesse run sono già
            elencate come card nel contenuto principale. ──────────────────── */}
      {!collapsed && (
        <aside
          className="hidden lg:block w-[320px] shrink-0 self-stretch border-r border-[var(--color-border)]"
          style={{
            background:
              "color-mix(in srgb, var(--color-card) 45%, transparent)",
          }}
        >
          <div className="sticky top-14 px-5 py-10">
            <div className="mb-4 h-8 flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-[0.16em] uppercase text-[var(--color-dim)]">
                {t.tester}
              </span>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                title={t.collapse}
                aria-label={t.collapseAria}
                className="h-7 w-7 inline-flex items-center justify-center text-[13px] rounded-md border cursor-pointer transition-colors text-[var(--color-dim)] hover:text-[var(--color-white)]"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-card)",
                }}
              >
                ⟨
              </button>
            </div>

            <nav className="grid grid-cols-1 auto-rows-fr gap-2.5">
              {testers.map((t) => {
                const active = t.id === activeId;
                return (
                <Link
                  key={t.id}
                  href={`/case-studies/${t.id}`}
                  // Su una pagina di dettaglio (activeId presente) non riportare in
                  // cima: così cambiando tester si resta alla stessa altezza e si
                  // vede il grafico equivalente. Dall'indice invece si entra in cima.
                  scroll={!activeId}
                  aria-current={active ? "page" : undefined}
                  className={`group flex h-full flex-col rounded-xl border ${
                    active
                      ? "border-[var(--color-blue)]"
                      : "border-[var(--color-border)]"
                  } bg-[var(--color-card)] px-3.5 py-3 no-underline transition-colors hover:border-[var(--color-blue)]`}
                  style={
                    active
                      ? {
                          background:
                            "color-mix(in srgb, var(--color-blue) 10%, var(--color-card))",
                        }
                      : undefined
                  }
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-[var(--color-white)] truncate">
                        {t.category}
                      </span>
                      <span className="ml-auto text-[var(--color-dim)] group-hover:text-[var(--color-blue)] transition-colors">
                        →
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                      <span
                        className="text-[9px] rounded-full px-1.5 py-0.5 border text-[var(--color-base)]"
                        style={{
                          borderColor:
                            "color-mix(in srgb, var(--color-blue) 35%, transparent)",
                          background:
                            "color-mix(in srgb, var(--color-blue) 10%, transparent)",
                        }}
                      >
                        {t.seniority}
                      </span>
                      {t.geos.map((g) => (
                        <span
                          key={g}
                          className="text-[9px] rounded-full px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-muted)]"
                        >
                          {g}
                        </span>
                      ))}
                      <span
                        className="text-[9px] font-semibold rounded-full px-1.5 py-0.5"
                        style={{
                          background:
                            "color-mix(in srgb, #00e676 14%, transparent)",
                          color: "#00e676",
                        }}
                      >
                        {t.model}
                      </span>
                    </div>
                  </div>
                </Link>
                );
              })}
            </nav>
          </div>
        </aside>
      )}

      <div className="flex-1 min-w-0">
        <div
          className={`px-6 sm:px-10 py-12 ${
            collapsed ? "mx-auto max-w-6xl" : "mx-auto lg:mx-0 max-w-5xl"
          }`}
        >
          {collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              title={t.show}
              aria-label={t.showAria}
              className="mb-6 h-8 px-3 hidden lg:inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] uppercase rounded-lg border cursor-pointer transition-colors"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-base)",
                background: "var(--color-card)",
              }}
            >
              <span aria-hidden>☰</span>
              {t.tester}
            </button>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
