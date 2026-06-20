"use client";

import { useState } from "react";
import Link from "next/link";

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
}: {
  testers: CaseStudyTeaser[];
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex gap-8 items-start">
      {!collapsed && (
        <aside className="w-[260px] shrink-0 sticky top-20">
          <div className="mb-4 h-8 flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-[0.16em] uppercase text-[var(--color-dim)]">
              Tester
            </span>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="Comprimi"
              aria-label="Comprimi la lista tester"
              className="h-7 w-7 inline-flex items-center justify-center text-[13px] rounded-md border cursor-pointer transition-colors text-[var(--color-dim)] hover:text-[var(--color-white)]"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-card)",
              }}
            >
              ⟨
            </button>
          </div>

          <nav className="space-y-2">
            {testers.map((t) => (
              <Link
                key={t.id}
                href={`/case-studies/${t.id}`}
                className="group block rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3.5 no-underline transition-colors hover:border-[var(--color-blue)]"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[11px] font-extrabold shrink-0"
                    style={{
                      background:
                        "color-mix(in srgb, var(--color-blue) 18%, transparent)",
                      color: "var(--color-blue)",
                    }}
                  >
                    {t.badge}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-[var(--color-white)] truncate">
                      {t.category}
                    </div>
                    <div className="text-[10px] text-[var(--color-dim)] truncate">
                      {t.label}
                    </div>
                  </div>
                  <span className="ml-auto text-[var(--color-dim)] group-hover:text-[var(--color-blue)] transition-colors">
                    →
                  </span>
                </div>

                <div className="mt-3">
                  <span
                    className="text-[10px] rounded-full px-2 py-0.5 border text-[var(--color-base)]"
                    style={{
                      borderColor:
                        "color-mix(in srgb, var(--color-blue) 35%, transparent)",
                      background:
                        "color-mix(in srgb, var(--color-blue) 10%, transparent)",
                    }}
                  >
                    {t.seniority}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <span aria-hidden className="text-[10px]">
                    📍
                  </span>
                  {t.geos.map((g) => (
                    <span
                      key={g}
                      className="text-[10px] rounded-full px-2 py-0.5 border border-[var(--color-border)] text-[var(--color-muted)]"
                    >
                      {g}
                    </span>
                  ))}
                </div>

                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                    modello
                  </span>
                  <span
                    className="text-[10px] font-semibold rounded-md px-2 py-0.5"
                    style={{
                      background:
                        "color-mix(in srgb, #00e676 14%, transparent)",
                      color: "#00e676",
                    }}
                  >
                    {t.model}
                  </span>
                </div>
              </Link>
            ))}
          </nav>
        </aside>
      )}

      <div className="flex-1 min-w-0">
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="Mostra i tester"
            aria-label="Mostra la lista tester"
            className="mb-6 h-8 px-3 inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] uppercase rounded-lg border cursor-pointer transition-colors"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-base)",
              background: "var(--color-card)",
            }}
          >
            <span aria-hidden>☰</span>
            Tester
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
