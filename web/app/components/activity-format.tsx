"use client";

// Formattazione condivisa del feed/log attività: stessa resa "parlante" per
// ruolo in dashboard (RecentActivityFeed) e nella pagina log (ActivityLogTable).
import Link from "next/link";
import type { RecentActivityEvent } from "@/lib/team-activity";
import { ROLE_META, timeAgo, dmhm } from "@/lib/team-activity-meta";

// Colore del punteggio (stessa scala di MapCharts/dashboard).
export function scoreColor(s: number): string {
  if (s >= 75) return "var(--color-green)";
  if (s >= 55) return "var(--color-yellow)";
  return "var(--color-red)";
}

// Nomi "belli" delle fonti note; per le altre prettify generico.
const SOURCE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  greenhouse: "Greenhouse",
  workday: "Workday",
  ashby: "Ashby",
  lever: "Lever",
  smartrecruiters: "SmartRecruiters",
  icims: "iCIMS",
  recruitee: "Recruitee",
  workable: "Workable",
  bebee: "beBee",
  efinancialcareers: "eFinancialCareers",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
};
export function sourceLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Verbo per ruolo (IT). Scorer/scout sono gestiti a parte (score / piattaforma
// inline). Tutti seguiti da "la posizione" (il titolo è reso separatamente).
const LEAD: Record<string, string> = {
  scout: "ha trovato la posizione",
  analista: "ha analizzato la posizione",
  scorer: "ha assegnato uno score alla posizione",
  scrittore: "ha scritto il CV per la posizione",
  critico: "ha revisionato la posizione",
};

// Frase d'azione per ruolo: score inline (scorer), piattaforma (scout), sempre
// seguita da "la posizione".
export function ActionLead({ ev }: { ev: RecentActivityEvent }) {
  if (ev.role === "scorer") {
    return typeof ev.score === "number" ? (
      <>
        ha assegnato lo score{" "}
        <span
          className="font-bold tabular-nums"
          style={{ color: scoreColor(ev.score) }}
        >
          {ev.score}
        </span>{" "}
        alla posizione
      </>
    ) : (
      <>ha assegnato uno score alla posizione</>
    );
  }
  if (ev.role === "scout") {
    return ev.source ? (
      <>
        ha trovato su{" "}
        <span className="text-[var(--color-bright)]">
          {sourceLabel(ev.source)}
        </span>{" "}
        la posizione
      </>
    ) : (
      <>ha trovato la posizione</>
    );
  }
  return <>{LEAD[ev.role] ?? ""}</>;
}

// Riga completa "a frase" (istanza · azione · posizione · #id · ora). Stessa
// resa in dashboard e nel log. Desktop: il dettaglio è flessibile e tronca con
// "…" → niente scroll orizzontale, #id/ora allineati a destra. Mobile: larghezza
// naturale (la card scrolla orizzontalmente).
export function ActivityRow({ ev }: { ev: RecentActivityEvent }) {
  const meta = ROLE_META[ev.role];
  const label = ev.actor === ev.role ? meta.label : ev.actor;
  return (
    <div className="flex items-center gap-3 px-4 py-2 w-max min-w-full md:w-full hover:bg-[var(--color-bg)] transition-colors">
      <span className="text-[10px] text-[var(--color-dim)] w-14 shrink-0 tabular-nums">
        {timeAgo(ev.ts)}
      </span>
      <span className="text-[13px] leading-none shrink-0">{meta.emoji}</span>
      <span
        className="text-[11px] font-bold w-24 shrink-0 truncate tabular-nums"
        style={{ color: meta.color }}
        title={ev.actor}
      >
        {label}
      </span>
      {ev.title ? (
        <>
          <span className="text-[11px] text-[var(--color-muted)] shrink-0 whitespace-nowrap">
            <ActionLead ev={ev} />
          </span>
          <span className="text-[11px] shrink-0 whitespace-nowrap md:flex-1 md:min-w-0 md:truncate">
            <PositionDetail ev={ev} />
          </span>
        </>
      ) : (
        <span className="text-[11px] text-[var(--color-dim)] shrink-0 whitespace-nowrap md:flex-1">
          {meta.action}
        </span>
      )}
      {ev.pid && (
        <Link
          href={`/positions/${ev.pid}`}
          className="text-[10px] font-semibold shrink-0 tabular-nums no-underline rounded px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-blue)] hover:text-[var(--color-blue)] transition-colors"
          title={`Apri la posizione · ${ev.pid}`}
        >
          #{ev.legacyId ?? ev.pid.slice(0, 8)}
        </Link>
      )}
      <span className="text-[10px] text-[var(--color-dim)] shrink-0 tabular-nums block w-24 text-right">
        {dmhm(ev.ts)}
      </span>
    </div>
  );
}

// Titolo della posizione + azienda/città (queste ultime SOLO per l'analista).
export function PositionDetail({ ev }: { ev: RecentActivityEvent }) {
  return (
    <>
      <span className="text-[var(--color-white)]">{ev.title}</span>
      {ev.role === "analista" && ev.company && (
        <span className="text-[var(--color-dim)]">
          {" · "}
          {ev.company}
        </span>
      )}
      {ev.role === "analista" && ev.city && (
        <span className="text-[var(--color-dim)]">
          {" · "}
          {ev.city}
        </span>
      )}
    </>
  );
}
