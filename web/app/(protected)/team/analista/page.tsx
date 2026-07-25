"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import AgentInteraction from "@/components/AgentInteraction";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { intlTag } from "@/lib/locale-tag";

type Position = {
  id: number;
  title: string;
  company: string;
  location: string | null;
  remote_type: string | null;
  status?: string;
  notes?: string | null;
  last_checked?: string | null;
  found_at?: string;
};

type AnalistaActivity = {
  queue: Position[];
  recent_processed: Position[];
  recent_excluded: Position[];
  queue_size: number;
  checked_total: number;
  analyzed_today: number;
  excluded_today: number;
  ratio: { checked: number; excluded: number };
  exclusion_categories: Record<string, number>;
};

const CAT_COLORS: Record<string, string> = {
  LINK_MORTO: "#ff5252",
  SCORE_BASSO: "#ff9800",
  DUPLICATA: "#9e9e9e",
  GEO: "#42a5f5",
  LINGUA: "#ab47bc",
  SENIORITY: "#ffd600",
  STACK: "#26c6da",
  RUOLO: "#66bb6a",
  SCAM: "#d32f2f",
  CRITICO: "#ef6c00",
  NON_CATEGORIZZATA: "#616161",
};
const CAT_LABELS: Record<Locale, Record<string, string>> = {
  it: {
    LINK_MORTO: "Link morto",
    SCORE_BASSO: "Score < 40",
    DUPLICATA: "Duplicata",
    GEO: "Zona geo",
    LINGUA: "Lingua",
    SENIORITY: "Seniority",
    STACK: "Stack",
    RUOLO: "Ruolo non-dev",
    SCAM: "Scam",
    CRITICO: "Voto critico",
    NON_CATEGORIZZATA: "Non categorizzata",
  },
  en: {
    LINK_MORTO: "Dead link",
    SCORE_BASSO: "Score < 40",
    DUPLICATA: "Duplicate",
    GEO: "Geo area",
    LINGUA: "Language",
    SENIORITY: "Seniority",
    STACK: "Stack",
    RUOLO: "Non-dev role",
    SCAM: "Scam",
    CRITICO: "Critic score",
    NON_CATEGORIZZATA: "Uncategorized",
  },
  es: {
    LINK_MORTO: "Enlace muerto",
    SCORE_BASSO: "Score < 40",
    DUPLICATA: "Duplicada",
    GEO: "Zona geo",
    LINGUA: "Idioma",
    SENIORITY: "Seniority",
    STACK: "Stack",
    RUOLO: "Rol no-dev",
    SCAM: "Scam",
    CRITICO: "Nota del crítico",
    NON_CATEGORIZZATA: "Sin categorizar",
  },
  fr: {
    LINK_MORTO: "Lien mort",
    SCORE_BASSO: "Score < 40",
    DUPLICATA: "Doublon",
    GEO: "Zone géo",
    LINGUA: "Langue",
    SENIORITY: "Séniorité",
    STACK: "Stack",
    RUOLO: "Rôle non-dev",
    SCAM: "Scam",
    CRITICO: "Note du critique",
    NON_CATEGORIZZATA: "Non catégorisé",
  },
  de: {
    LINK_MORTO: "Toter Link",
    SCORE_BASSO: "Score < 40",
    DUPLICATA: "Duplikat",
    GEO: "Geo-Zone",
    LINGUA: "Sprache",
    SENIORITY: "Seniorität",
    STACK: "Stack",
    RUOLO: "Nicht-Dev-Rolle",
    SCAM: "Scam",
    CRITICO: "Kritiker-Note",
    NON_CATEGORIZZATA: "Nicht kategorisiert",
  },
  hu: {
    LINK_MORTO: "Halott link",
    SCORE_BASSO: "Score < 40",
    DUPLICATA: "Duplikátum",
    GEO: "Földrajzi zóna",
    LINGUA: "Nyelv",
    SENIORITY: "Szenioritás",
    STACK: "Stack",
    RUOLO: "Nem-dev szerep",
    SCAM: "Scam",
    CRITICO: "Kritikus pontszám",
    NON_CATEGORIZZATA: "Kategorizálatlan",
  },
  pt: {
    LINK_MORTO: "Link morto",
    SCORE_BASSO: "Score < 40",
    DUPLICATA: "Duplicada",
    GEO: "Zona geo",
    LINGUA: "Idioma",
    SENIORITY: "Senioridade",
    STACK: "Stack",
    RUOLO: "Função não-dev",
    SCAM: "Scam",
    CRITICO: "Nota do crítico",
    NON_CATEGORIZZATA: "Não categorizada",
  },
};

const T: Record<
  Locale,
  {
    dashboard: string;
    team: string;
    analyst: string;
    subtitle: string;
    remote: string;
    inAnalisi: string;
    expiredLinkPrefix: string;
    queued: string;
    checkedTot: string;
    processedToday: string;
    excludedToday: string;
    inQueueTitle: string;
    noQueue: string;
    lastCheckedTitle: string;
    noChecked: string;
    lastExcludedTitle: string;
    noExclusions: string;
    exclusionReasons: string;
    excludedWord: string;
  }
> = {
  it: {
    dashboard: "Dashboard",
    team: "Team",
    analyst: "Analista",
    subtitle: "Pipeline analisi offerte · polling 8s",
    remote: "Remote",
    inAnalisi: "IN ANALISI",
    expiredLinkPrefix: "Link scaduto: ",
    queued: "In coda",
    checkedTot: "Checked tot.",
    processedToday: "Elaborate oggi",
    excludedToday: "Escluse oggi",
    inQueueTitle: "In Coda (prossime 10)",
    noQueue: "Nessuna posizione in coda",
    lastCheckedTitle: "Ultime 10 Checked",
    noChecked: "Nessuna posizione checked",
    lastExcludedTitle: "Ultime 10 Escluse — Log",
    noExclusions: "Nessuna esclusione recente",
    exclusionReasons: "Motivi Esclusione",
    excludedWord: "escluse",
  },
  en: {
    dashboard: "Dashboard",
    team: "Team",
    analyst: "Analyst",
    subtitle: "Job analysis pipeline · 8s polling",
    remote: "Remote",
    inAnalisi: "ANALYZING",
    expiredLinkPrefix: "Expired link: ",
    queued: "Queued",
    checkedTot: "Checked tot.",
    processedToday: "Processed today",
    excludedToday: "Excluded today",
    inQueueTitle: "In Queue (next 10)",
    noQueue: "No positions in queue",
    lastCheckedTitle: "Last 10 Checked",
    noChecked: "No checked positions",
    lastExcludedTitle: "Last 10 Excluded — Log",
    noExclusions: "No recent exclusions",
    exclusionReasons: "Exclusion Reasons",
    excludedWord: "excluded",
  },
  es: {
    dashboard: "Panel",
    team: "Equipo",
    analyst: "Analista",
    subtitle: "Pipeline de análisis de ofertas · polling 8s",
    remote: "Remoto",
    inAnalisi: "EN ANÁLISIS",
    expiredLinkPrefix: "Enlace caducado: ",
    queued: "En cola",
    checkedTot: "Checked tot.",
    processedToday: "Procesadas hoy",
    excludedToday: "Excluidas hoy",
    inQueueTitle: "En Cola (próximas 10)",
    noQueue: "Ninguna posición en cola",
    lastCheckedTitle: "Últimas 10 Checked",
    noChecked: "Ninguna posición checked",
    lastExcludedTitle: "Últimas 10 Excluidas — Log",
    noExclusions: "Ninguna exclusión reciente",
    exclusionReasons: "Motivos de Exclusión",
    excludedWord: "excluidas",
  },
  fr: {
    dashboard: "Tableau de bord",
    team: "Équipe",
    analyst: "Analyste",
    subtitle: "Pipeline d'analyse des offres · polling 8s",
    remote: "À distance",
    inAnalisi: "EN ANALYSE",
    expiredLinkPrefix: "Lien expiré : ",
    queued: "En file",
    checkedTot: "Checked tot.",
    processedToday: "Traitées aujourd'hui",
    excludedToday: "Exclues aujourd'hui",
    inQueueTitle: "En File (10 prochaines)",
    noQueue: "Aucun poste en file",
    lastCheckedTitle: "10 dernières Checked",
    noChecked: "Aucun poste checked",
    lastExcludedTitle: "10 dernières Exclues — Log",
    noExclusions: "Aucune exclusion récente",
    exclusionReasons: "Motifs d'Exclusion",
    excludedWord: "exclues",
  },
  de: {
    dashboard: "Dashboard",
    team: "Team",
    analyst: "Analyst",
    subtitle: "Analyse-Pipeline der Stellen · 8s Polling",
    remote: "Remote",
    inAnalisi: "IN ANALYSE",
    expiredLinkPrefix: "Abgelaufener Link: ",
    queued: "In Warteschlange",
    checkedTot: "Checked ges.",
    processedToday: "Heute verarbeitet",
    excludedToday: "Heute ausgeschlossen",
    inQueueTitle: "In Warteschlange (nächste 10)",
    noQueue: "Keine Positionen in Warteschlange",
    lastCheckedTitle: "Letzte 10 Checked",
    noChecked: "Keine geprüften Positionen",
    lastExcludedTitle: "Letzte 10 Ausgeschlossen — Log",
    noExclusions: "Keine kürzlichen Ausschlüsse",
    exclusionReasons: "Ausschlussgründe",
    excludedWord: "ausgeschlossen",
  },
  hu: {
    dashboard: "Irányítópult",
    team: "Csapat",
    analyst: "Elemző",
    subtitle: "Ajánlat-elemzési folyamat · 8s polling",
    remote: "Távmunka",
    inAnalisi: "ELEMZÉS ALATT",
    expiredLinkPrefix: "Lejárt link: ",
    queued: "Sorban",
    checkedTot: "Checked össz.",
    processedToday: "Ma feldolgozva",
    excludedToday: "Ma kizárva",
    inQueueTitle: "Sorban (következő 10)",
    noQueue: "Nincs pozíció a sorban",
    lastCheckedTitle: "Utolsó 10 Checked",
    noChecked: "Nincs ellenőrzött pozíció",
    lastExcludedTitle: "Utolsó 10 Kizárt — Log",
    noExclusions: "Nincs friss kizárás",
    exclusionReasons: "Kizárási Okok",
    excludedWord: "kizárva",
  },
  pt: {
    dashboard: "Painel",
    team: "Equipe",
    analyst: "Analista",
    subtitle: "Pipeline de análise de vagas · polling 8s",
    remote: "Remoto",
    inAnalisi: "EM ANÁLISE",
    expiredLinkPrefix: "Link expirado: ",
    queued: "Na fila",
    checkedTot: "Checked tot.",
    processedToday: "Processadas hoje",
    excludedToday: "Excluídas hoje",
    inQueueTitle: "Na Fila (próximas 10)",
    noQueue: "Nenhuma vaga na fila",
    lastCheckedTitle: "Últimas 10 Checked",
    noChecked: "Nenhuma vaga checked",
    lastExcludedTitle: "Últimas 10 Excluídas — Log",
    noExclusions: "Nenhuma exclusão recente",
    exclusionReasons: "Motivos de Exclusão",
    excludedWord: "excluídas",
  },
};
const STATUS_COLORS: Record<string, string> = {
  checked: "var(--color-green)",
  analyzed: "var(--color-blue)",
  excluded: "var(--color-red)",
  scored: "var(--color-yellow)",
  ready: "var(--color-cyan, #00bcd4)",
};

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "";
  const parts = ts.split("T");
  const date = (parts[0] ?? ts).split("-");
  const time = (parts[1] ?? "").slice(0, 5);
  if (date.length < 3) return ts;
  return `${date[2]}/${date[1]}/${date[0]} ${time}`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: "0.7em",
        background: STATUS_COLORS[status] ?? "var(--color-border)",
        color: "#000",
        fontWeight: 700,
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

function FeedItem({
  p,
  showStatus,
  remoteLabel,
  inAnalisiLabel,
}: {
  p: Position;
  showStatus: boolean;
  remoteLabel: string;
  inAnalisiLabel: string;
}) {
  const loc =
    p.remote_type === "full_remote"
      ? remoteLabel
      : (p.location ?? "").split(",")[0];
  const inAnalisi = !showStatus && (p.notes ?? "").includes("IN_ANALISI");
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-md transition-colors hover:bg-[var(--color-border)]"
      style={{
        background: inAnalisi ? "rgba(255,214,0,0.06)" : undefined,
        fontSize: "0.82em",
      }}
    >
      <span className="font-mono text-[var(--color-dim)] shrink-0">
        #{p.id}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className="font-medium text-[var(--color-bright)] truncate"
          title={p.title}
        >
          {p.title}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <span className="text-[var(--color-muted)]">{p.company}</span>
          {loc && <span className="text-[var(--color-dim)]">{loc}</span>}
          {inAnalisi && (
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: "0.85em",
                background: "var(--color-yellow)",
                color: "#000",
                fontWeight: 700,
              }}
            >
              {inAnalisiLabel}
            </span>
          )}
          {showStatus && p.status && <StatusBadge status={p.status} />}
          {showStatus && p.last_checked && (
            <span
              className="text-[var(--color-dim)]"
              style={{ fontSize: "0.85em" }}
            >
              {fmtTs(p.last_checked)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ExcludedItem({
  p,
  remoteLabel,
  expiredLinkPrefix,
}: {
  p: Position;
  remoteLabel: string;
  expiredLinkPrefix: string;
}) {
  const reason = (p.notes ?? "")
    .replace(/^MOTIVO ESCLUSIONE:\s*/i, "")
    .replace(/^Link scaduto\s*[-—]\s*/i, expiredLinkPrefix)
    .split("\n")[0]
    .slice(0, 80);
  const loc =
    p.remote_type === "full_remote"
      ? remoteLabel
      : (p.location ?? "").split(",")[0];
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-md hover:bg-[var(--color-border)] transition-colors"
      style={{ opacity: 0.85, fontSize: "0.82em" }}
    >
      <span
        className="font-mono shrink-0"
        style={{ color: "var(--color-red)" }}
      >
        #{p.id}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[var(--color-dim)] truncate line-through">
          {p.title}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <span className="text-[var(--color-muted)]">{p.company}</span>
          {loc && <span className="text-[var(--color-dim)]">{loc}</span>}
          {reason && (
            <span style={{ color: "var(--color-red)", fontSize: "0.9em" }}>
              {reason}
            </span>
          )}
          {p.last_checked && (
            <span
              className="text-[var(--color-dim)]"
              style={{ fontSize: "0.85em" }}
            >
              {fmtTs(p.last_checked)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function DonutChart({
  categories,
  labels,
}: {
  categories: Record<string, number>;
  labels: Record<string, string>;
}) {
  const entries = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const total = entries.reduce((s, e) => s + e[1], 0);

  let cumPct = 0;
  const parts = entries.map(([cat, count]) => {
    const pct = (count / total) * 100;
    const color = CAT_COLORS[cat] ?? "#888";
    const part = `${color} ${cumPct.toFixed(1)}% ${(cumPct + pct).toFixed(1)}%`;
    cumPct += pct;
    return part;
  });

  return (
    <div className="flex gap-6 items-center mt-3">
      <div
        style={{
          width: 110,
          height: 110,
          borderRadius: "50%",
          flexShrink: 0,
          background: `conic-gradient(${parts.join(", ")})`,
          boxShadow: "inset 0 0 0 24px var(--color-card)",
        }}
      />
      <div className="flex flex-col gap-1 flex-1">
        {entries.map(([cat, count]) => {
          const pct = Math.round((count / total) * 100);
          const color = CAT_COLORS[cat] ?? "#888";
          const label = labels[cat] ?? cat;
          return (
            <div
              key={cat}
              className="flex items-center gap-2"
              style={{ fontSize: "0.75em" }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span className="text-[var(--color-text)]">{label}</span>
              <span className="text-[var(--color-dim)] ml-auto">
                {count} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AnalistaPage() {
  const locale = useLocale();
  const t = T[locale];
  const localeTag = intlTag(locale);
  const catLabels = CAT_LABELS[locale] ?? CAT_LABELS.en;
  const [data, setData] = useState<AnalistaActivity | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const isCloud = useIsCloud();

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/analista/activity");
      const json = await res.json();
      setData(json);
      setLastUpdate(new Date());
    } catch {}
  }, []);

  useEffect(() => {
    fetchData();
    if (isCloud) return;
    const id = setInterval(fetchData, 8000);
    return () => clearInterval(id);
  }, [fetchData, isCloud]);

  const ratio = data?.ratio ?? { checked: 0, excluded: 0 };
  const rTotal = ratio.checked + ratio.excluded;
  const rPct = rTotal > 0 ? Math.round((ratio.checked / rTotal) * 100) : 0;

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t.dashboard}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <Link
            href="/team"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t.team}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            {t.analyst}
          </span>
        </nav>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              {t.analyst}
            </h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {t.subtitle}
            </p>
          </div>
          {lastUpdate && (
            <span className="text-[9px] text-[var(--color-dim)] font-mono shrink-0">
              {lastUpdate.toLocaleTimeString(localeTag, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8"
        style={{ animation: "fade-in 0.35s ease both" }}
      >
        {[
          {
            label: t.queued,
            val: data?.queue_size ?? "—",
            color: "var(--color-orange)",
          },
          {
            label: t.checkedTot,
            val: data?.checked_total ?? "—",
            color: "var(--color-green)",
          },
          {
            label: t.processedToday,
            val: data?.analyzed_today ?? "—",
            color: "var(--color-blue)",
          },
          {
            label: t.excludedToday,
            val: data?.excluded_today ?? "—",
            color: "var(--color-red)",
          },
        ].map(({ label, val, color }, i) => (
          <div
            key={label}
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors"
            style={{ animation: `fade-in 0.4s ease ${i * 0.06}s both` }}
          >
            <div className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2 text-[var(--color-dim)]">
              {label}
            </div>
            <div
              className="text-3xl font-bold tracking-tight leading-none"
              style={{ color }}
            >
              {val}
            </div>
          </div>
        ))}
      </div>

      {/* Feed grid */}
      <div
        className="grid sm:grid-cols-2 gap-4 mb-4"
        style={{ animation: "fade-in 0.35s ease 0.05s both" }}
      >
        {/* Coda */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
          <h2 className="text-[11px] font-semibold tracking-wider uppercase text-[var(--color-muted)] mb-3">
            {t.inQueueTitle}
          </h2>
          {data?.queue.length === 0 || !data ? (
            <p className="text-[var(--color-dim)] text-[11px] px-3">
              {t.noQueue}
            </p>
          ) : (
            <div className="space-y-0.5">
              {data.queue.map((p) => (
                <FeedItem
                  key={p.id}
                  p={p}
                  showStatus={false}
                  remoteLabel={t.remote}
                  inAnalisiLabel={t.inAnalisi}
                />
              ))}
            </div>
          )}
        </div>

        {/* Ultime checked */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
          <h2 className="text-[11px] font-semibold tracking-wider uppercase text-[var(--color-muted)] mb-3">
            {t.lastCheckedTitle}
          </h2>
          {data?.recent_processed.length === 0 || !data ? (
            <p className="text-[var(--color-dim)] text-[11px] px-3">
              {t.noChecked}
            </p>
          ) : (
            <div className="space-y-0.5">
              {data.recent_processed.map((p) => (
                <FeedItem
                  key={p.id}
                  p={p}
                  showStatus={true}
                  remoteLabel={t.remote}
                  inAnalisiLabel={t.inAnalisi}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ultime escluse */}
      <div
        className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 mb-4 transition-colors duration-200 hover:border-[var(--color-border-glow)]"
        style={{ animation: "fade-in 0.35s ease 0.1s both" }}
      >
        <h2
          className="text-[11px] font-semibold tracking-wider uppercase mb-3"
          style={{ color: "var(--color-red)" }}
        >
          {t.lastExcludedTitle}
        </h2>
        {data?.recent_excluded.length === 0 || !data ? (
          <p className="text-[var(--color-dim)] text-[11px] px-3">
            {t.noExclusions}
          </p>
        ) : (
          <div className="space-y-0.5">
            {data.recent_excluded.map((p) => (
              <ExcludedItem
                key={p.id}
                p={p}
                remoteLabel={t.remote}
                expiredLinkPrefix={t.expiredLinkPrefix}
              />
            ))}
          </div>
        )}
      </div>

      {/* Motivi esclusione + ratio */}
      {data && Object.keys(data.exclusion_categories).length > 0 && (
        <div
          className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 transition-colors duration-200 hover:border-[var(--color-border-glow)]"
          style={{ animation: "fade-in 0.35s ease 0.15s both" }}
        >
          <h2 className="text-[11px] font-semibold tracking-wider uppercase text-[var(--color-muted)] mb-2">
            {t.exclusionReasons}
          </h2>

          {/* Ratio bar */}
          {rTotal > 0 && (
            <div className="flex items-center gap-2 mb-3 font-mono text-[11px]">
              <span style={{ color: "var(--color-green)", fontWeight: 700 }}>
                {ratio.checked} checked
              </span>
              <div
                className="flex-1 h-1.5 rounded-full overflow-hidden"
                style={{ background: "var(--color-red)" }}
              >
                <div
                  style={{
                    width: `${rPct}%`,
                    height: "100%",
                    background: "var(--color-green)",
                    borderRadius: 3,
                  }}
                />
              </div>
              <span style={{ color: "var(--color-red)", fontWeight: 700 }}>
                {ratio.excluded} {t.excludedWord}
              </span>
              <span className="text-[var(--color-dim)]">({rPct}% pass)</span>
            </div>
          )}

          <DonutChart
            categories={data.exclusion_categories}
            labels={catLabels}
          />
        </div>
      )}

      <AgentInteraction
        sessionPrefix="ANALISTA"
        color="#00e676"
        label={t.analyst}
      />
    </div>
  );
}
