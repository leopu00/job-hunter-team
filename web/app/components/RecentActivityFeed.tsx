"use client";

import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import type { RecentActivityEvent } from "@/lib/team-activity";
import { ActivityRow } from "./activity-format";

const T: Record<
  Locale,
  {
    heading: string;
    description: string;
    viewAll: string;
    empty: string;
  }
> = {
  it: {
    heading: "🕐 Attività recente",
    description:
      "Le ultime azioni del team, dalla più recente — con l'istanza che l'ha fatta.",
    viewAll: "Vedi tutto →",
    empty: "Nessuna attività recente.",
  },
  en: {
    heading: "🕐 Recent activity",
    description:
      "The team's latest actions, newest first — with the instance that performed it.",
    viewAll: "View all →",
    empty: "No recent activity.",
  },
  es: {
    heading: "🕐 Actividad reciente",
    description:
      "Las últimas acciones del equipo, de la más reciente — con la instancia que la realizó.",
    viewAll: "Ver todo →",
    empty: "Sin actividad reciente.",
  },
  fr: {
    heading: "🕐 Activité récente",
    description:
      "Les dernières actions de l'équipe, de la plus récente — avec l'instance qui l'a effectuée.",
    viewAll: "Tout voir →",
    empty: "Aucune activité récente.",
  },
  de: {
    heading: "🕐 Letzte Aktivität",
    description:
      "Die neuesten Aktionen des Teams, neueste zuerst — mit der Instanz, die sie ausgeführt hat.",
    viewAll: "Alle anzeigen →",
    empty: "Keine letzte Aktivität.",
  },
  hu: {
    heading: "🕐 Legutóbbi tevékenység",
    description:
      "A csapat legutóbbi műveletei, a legfrissebbtől — azzal a példánnyal, amelyik végrehajtotta.",
    viewAll: "Összes megtekintése →",
    empty: "Nincs legutóbbi tevékenység.",
  },
  pt: {
    heading: "🕐 Atividade recente",
    description:
      "As últimas ações da equipe, da mais recente — com a instância que a executou.",
    viewAll: "Ver tudo →",
    empty: "Nenhuma atividade recente.",
  },
};

// Feed "Attività recente": una riga per azione (istanza + cosa + posizione +
// quando). Condiviso tra la pagina /team/attivita e la card in dashboard.
export default function RecentActivityFeed({
  recent,
  max,
  heading,
  description,
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
  const t = T[useLocale()];
  const headingText = heading ?? t.heading;
  const descriptionText = description ?? t.description;
  const rows = typeof max === "number" ? recent.slice(0, max) : recent;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="section-label">{headingText}</div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-[10px] font-semibold no-underline text-[var(--color-muted)] hover:text-[var(--color-blue)] transition-colors shrink-0"
          >
            {t.viewAll}
          </Link>
        )}
      </div>
      <p className="text-[10px] text-[var(--color-dim)] mb-4">
        {descriptionText}
      </p>
      <div
        className={`bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] overflow-x-auto${scroll ? ` ${maxHeightClass} overflow-y-auto` : ""}`}
      >
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-[11px] text-[var(--color-dim)]">
            {t.empty}
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
