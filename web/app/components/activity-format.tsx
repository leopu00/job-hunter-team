"use client";

// Formattazione condivisa del feed/log attività: stessa resa "parlante" per
// ruolo in dashboard (RecentActivityFeed) e nella pagina log (ActivityLogTable).
import { scoreSpectrumCss } from "@/lib/score-color";
import Link from "next/link";
import type { RecentActivityEvent } from "@/lib/team-activity";
import { ROLE_META, timeAgo, dmhm } from "@/lib/team-activity-meta";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import ActorIcon from "@/app/components/ActorIcon";

// Frasi d'azione localizzate (verbo per ruolo + frammenti score/source) e il
// title del link "Apri la posizione". Sempre 7 lingue.
type ActivityStrings = {
  scoutFound: string; // "ha trovato la posizione"
  scoutFoundOn: string; // "ha trovato su" (precede la piattaforma)
  analyzed: string; // "ha analizzato la posizione"
  scored: string; // "ha assegnato uno score alla posizione"
  scoredValuePre: string; // "ha assegnato lo score" (precede il valore)
  scoredValuePost: string; // "alla posizione" (segue il valore)
  written: string; // "ha scritto il CV per la posizione"
  reviewed: string; // "ha revisionato la posizione"
  openPosition: string; // "Apri la posizione"
};

const T: Record<Locale, ActivityStrings> = {
  it: {
    scoutFound: "ha trovato la posizione",
    scoutFoundOn: "ha trovato su",
    analyzed: "ha analizzato la posizione",
    scored: "ha assegnato uno score alla posizione",
    scoredValuePre: "ha assegnato lo score",
    scoredValuePost: "alla posizione",
    written: "ha scritto il CV per la posizione",
    reviewed: "ha revisionato la posizione",
    openPosition: "Apri la posizione",
  },
  en: {
    scoutFound: "found the position",
    scoutFoundOn: "found on",
    analyzed: "analyzed the position",
    scored: "assigned a score to the position",
    scoredValuePre: "assigned the score",
    scoredValuePost: "to the position",
    written: "wrote the CV for the position",
    reviewed: "reviewed the position",
    openPosition: "Open the position",
  },
  es: {
    scoutFound: "encontró la posición",
    scoutFoundOn: "encontró en",
    analyzed: "analizó la posición",
    scored: "asignó un score a la posición",
    scoredValuePre: "asignó el score",
    scoredValuePost: "a la posición",
    written: "escribió el CV para la posición",
    reviewed: "revisó la posición",
    openPosition: "Abrir la posición",
  },
  fr: {
    scoutFound: "a trouvé le poste",
    scoutFoundOn: "a trouvé sur",
    analyzed: "a analysé le poste",
    scored: "a attribué un score au poste",
    scoredValuePre: "a attribué le score",
    scoredValuePost: "au poste",
    written: "a rédigé le CV pour le poste",
    reviewed: "a révisé le poste",
    openPosition: "Ouvrir le poste",
  },
  de: {
    scoutFound: "hat die Position gefunden",
    scoutFoundOn: "hat gefunden auf",
    analyzed: "hat die Position analysiert",
    scored: "hat der Position einen Score zugewiesen",
    scoredValuePre: "hat den Score",
    scoredValuePost: "der Position zugewiesen",
    written: "hat den CV für die Position geschrieben",
    reviewed: "hat die Position geprüft",
    openPosition: "Position öffnen",
  },
  hu: {
    scoutFound: "megtalálta a pozíciót",
    scoutFoundOn: "itt találta:",
    analyzed: "elemezte a pozíciót",
    scored: "score-t adott a pozíciónak",
    scoredValuePre: "ezt a score-t adta:",
    scoredValuePost: "a pozíciónak",
    written: "megírta a CV-t a pozícióhoz",
    reviewed: "felülvizsgálta a pozíciót",
    openPosition: "Pozíció megnyitása",
  },
  pt: {
    scoutFound: "encontrou a posição",
    scoutFoundOn: "encontrou em",
    analyzed: "analisou a posição",
    scored: "atribuiu um score à posição",
    scoredValuePre: "atribuiu o score",
    scoredValuePost: "à posição",
    written: "escreveu o CV para a posição",
    reviewed: "revisou a posição",
    openPosition: "Abrir a posição",
  },
};

// Verbo per ruolo (chiave in ActivityStrings). Scorer/scout sono gestiti a
// parte (score / piattaforma inline).
const LEAD_KEY: Record<string, keyof ActivityStrings> = {
  scout: "scoutFound",
  analista: "analyzed",
  scorer: "scored",
  scrittore: "written",
  critico: "reviewed",
};

// Colore del punteggio (stessa scala di MapCharts/dashboard).
export function scoreColor(s: number): string {
  return scoreSpectrumCss(s);
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

// Frase d'azione per ruolo: score inline (scorer), piattaforma (scout).
export function ActionLead({ ev }: { ev: RecentActivityEvent }) {
  const t = T[useLocale()];
  if (ev.role === "scorer") {
    return typeof ev.score === "number" ? (
      <>
        {t.scoredValuePre}{" "}
        <span
          className="font-bold tabular-nums"
          style={{ color: scoreColor(ev.score) }}
        >
          {ev.score}
        </span>{" "}
        {t.scoredValuePost}
      </>
    ) : (
      <>{t.scored}</>
    );
  }
  if (ev.role === "scout") {
    return ev.source ? (
      <>
        {t.scoutFoundOn}{" "}
        <span className="text-[var(--color-bright)]">
          {sourceLabel(ev.source)}
        </span>
      </>
    ) : (
      <>{t.scoutFound}</>
    );
  }
  const key = LEAD_KEY[ev.role];
  return <>{key ? t[key] : ""}</>;
}

// Riga completa "a frase" (istanza · azione · posizione · #id · ora). Stessa
// resa in dashboard e nel log. Desktop: il dettaglio è flessibile e tronca con
// "…" → niente scroll orizzontale, #id/ora allineati a destra. Mobile: larghezza
// naturale (la card scrolla orizzontalmente).
export function ActivityRow({ ev }: { ev: RecentActivityEvent }) {
  const t = T[useLocale()];
  const meta = ROLE_META[ev.role];
  const label = ev.actor === ev.role ? meta.label : ev.actor;
  return (
    <div className="flex items-center gap-3 px-4 py-2 w-max min-w-full md:w-full hover:bg-[var(--color-bg)] transition-colors">
      <span className="text-[10px] text-[var(--color-dim)] w-14 shrink-0 tabular-nums">
        {timeAgo(ev.ts)}
      </span>
      <ActorIcon role={ev.role} size={13} />
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
          title={`${t.openPosition} · ${ev.pid}`}
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
