"use client";

import Link from "next/link";
import type { RecentActivityEvent } from "@/lib/team-activity";
import { ActivityRow } from "./activity-format";

// Feed "Attività recente": una riga per azione (istanza + cosa + posizione +
// quando). Condiviso tra la pagina /team/attivita e la card in dashboard.
export default function RecentActivityFeed({
  recent,
  max,
  heading = "🕐 Attività recente",
  description = "Le ultime azioni del team, dalla più recente — con l'istanza che l'ha fatta.",
  viewAllHref,
  maxHeightClass = "max-h-[340px]",
  scroll = true,
}: {
  recent: RecentActivityEvent[];
  max?: number;
  heading?: string;
  description?: string;
  viewAllHref?: string;
  maxHeightClass?: string;
  // false = niente altezza massima/scroll (lista a conteggio fisso, es. la card
  // dashboard mostra sempre 8 righe).
  scroll?: boolean;
}) {
  const rows = typeof max === "number" ? recent.slice(0, max) : recent;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="section-label">{heading}</div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-[10px] font-semibold no-underline text-[var(--color-muted)] hover:text-[var(--color-blue)] transition-colors shrink-0"
          >
            Vedi tutto →
          </Link>
        )}
      </div>
      <p className="text-[10px] text-[var(--color-dim)] mb-4">{description}</p>
      <div
        className={`bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] overflow-x-auto${scroll ? ` ${maxHeightClass} overflow-y-auto` : ""}`}
      >
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-[11px] text-[var(--color-dim)]">
            Nessuna attività recente.
          </div>
        ) : (
          rows.map((ev, i) => (
            <ActivityRow key={`${ev.role}-${ev.actor}-${ev.ts}-${i}`} ev={ev} />
          ))
        )}
      </div>
    </section>
  );
}
