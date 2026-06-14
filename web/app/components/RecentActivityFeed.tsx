"use client";

import Link from "next/link";
import type { RecentActivityEvent } from "@/lib/team-activity";
import { ROLE_META, timeAgo, dmhm } from "@/lib/team-activity-meta";

// Feed "Attività recente": una riga per azione (istanza + cosa + posizione +
// quando). Condiviso tra la pagina /team/attivita e la card in dashboard.
export default function RecentActivityFeed({
  recent,
  max,
  heading = "🕐 Attività recente",
  description = "Le ultime azioni del team, dalla più recente — con l'istanza che l'ha fatta.",
  viewAllHref,
  maxHeightClass = "max-h-[340px]",
}: {
  recent: RecentActivityEvent[];
  max?: number;
  heading?: string;
  description?: string;
  viewAllHref?: string;
  maxHeightClass?: string;
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
        className={`bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] ${maxHeightClass} overflow-y-auto`}
      >
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-[11px] text-[var(--color-dim)]">
            Nessuna attività recente.
          </div>
        ) : (
          rows.map((ev, i) => {
            const meta = ROLE_META[ev.role];
            const label = ev.actor === ev.role ? meta.label : ev.actor;
            return (
              <div
                key={`${ev.role}-${ev.actor}-${ev.ts}-${i}`}
                className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-bg)] transition-colors"
              >
                <span className="text-[10px] text-[var(--color-dim)] w-14 shrink-0 tabular-nums">
                  {timeAgo(ev.ts)}
                </span>
                <span className="text-[13px] leading-none shrink-0">
                  {meta.emoji}
                </span>
                <span
                  className="text-[11px] font-bold w-24 shrink-0 truncate tabular-nums"
                  style={{ color: meta.color }}
                  title={ev.actor}
                >
                  {label}
                </span>
                <span className="text-[11px] text-[var(--color-muted)] shrink-0 hidden md:inline whitespace-nowrap">
                  {meta.action}
                </span>
                <span className="text-[11px] flex-1 min-w-0 truncate">
                  {ev.title || ev.company ? (
                    <>
                      {ev.title && (
                        <span className="text-[var(--color-white)]">{ev.title}</span>
                      )}
                      {ev.company && (
                        <span className="text-[var(--color-dim)]">
                          {ev.title ? " · " : ""}
                          {ev.company}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[var(--color-dim)] md:hidden">
                      {meta.action}
                    </span>
                  )}
                </span>
                {ev.pid && (
                  <Link
                    href={`/positions/${ev.pid}`}
                    className="text-[10px] font-semibold shrink-0 tabular-nums no-underline rounded px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-blue)] hover:text-[var(--color-blue)] transition-colors"
                    title={`Apri la posizione · ${ev.pid}`}
                  >
                    #{ev.legacyId ?? ev.pid.slice(0, 8)}
                  </Link>
                )}
                <span className="text-[10px] text-[var(--color-dim)] shrink-0 tabular-nums hidden sm:block w-24 text-right">
                  {dmhm(ev.ts)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
