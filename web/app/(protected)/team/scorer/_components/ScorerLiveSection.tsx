"use client";

import { useEffect, useState, useCallback } from "react";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { intlTag } from "@/lib/locale-tag";

type RelTime = {
  now: string;
  m: (n: number) => string;
  h: (n: number) => string;
};

const T: Record<
  Locale,
  {
    remote: string;
    rt: RelTime;
    monthShort: string;
    noRealtime: string;
    loadingLive: string;
    live: string;
    offline: string;
    inQueue: string;
    scoredTot: string;
    scoredToday: string;
    excludedToday: string;
    avgToday: string;
    updatedAt: string;
    inQueueChecked: string;
    noQueue: string;
    last10Scored: string;
    noScored: string;
    last10Excluded: string;
    todayLc: string;
    scoredLc: string;
    excludedLc: string;
    passLc: (pct: number) => string;
    noRecentExclusion: string;
  }
> = {
  it: {
    remote: "Remote",
    rt: { now: "adesso", m: (n) => `${n}m fa`, h: (n) => `${n}h fa` },
    monthShort: "short",
    noRealtime: "Dati real-time non disponibili.",
    loadingLive: "Caricamento dati live…",
    live: "Live",
    offline: "Offline",
    inQueue: "in coda",
    scoredTot: "scored tot",
    scoredToday: "scored oggi",
    excludedToday: "escluse oggi",
    avgToday: "media oggi",
    updatedAt: "agg. ",
    inQueueChecked: "In Coda — Checked",
    noQueue: "Nessuna posizione in coda",
    last10Scored: "Ultime 10 Scored",
    noScored: "Nessuna posizione scored",
    last10Excluded: "Ultime 10 Escluse (score < 40)",
    todayLc: "oggi",
    scoredLc: "scored",
    excludedLc: "escluse",
    passLc: (pct) => `(${pct}% pass)`,
    noRecentExclusion: "Nessuna esclusione recente",
  },
  en: {
    remote: "Remote",
    rt: { now: "now", m: (n) => `${n}m ago`, h: (n) => `${n}h ago` },
    monthShort: "short",
    noRealtime: "Real-time data unavailable.",
    loadingLive: "Loading live data…",
    live: "Live",
    offline: "Offline",
    inQueue: "in queue",
    scoredTot: "scored tot",
    scoredToday: "scored today",
    excludedToday: "excluded today",
    avgToday: "avg today",
    updatedAt: "upd. ",
    inQueueChecked: "In Queue — Checked",
    noQueue: "No positions in queue",
    last10Scored: "Last 10 Scored",
    noScored: "No scored positions",
    last10Excluded: "Last 10 Excluded (score < 40)",
    todayLc: "today",
    scoredLc: "scored",
    excludedLc: "excluded",
    passLc: (pct) => `(${pct}% pass)`,
    noRecentExclusion: "No recent exclusions",
  },
  es: {
    remote: "Remoto",
    rt: { now: "ahora", m: (n) => `hace ${n}m`, h: (n) => `hace ${n}h` },
    monthShort: "short",
    noRealtime: "Datos en tiempo real no disponibles.",
    loadingLive: "Cargando datos en vivo…",
    live: "Live",
    offline: "Offline",
    inQueue: "en cola",
    scoredTot: "scored tot",
    scoredToday: "scored hoy",
    excludedToday: "excluidas hoy",
    avgToday: "media hoy",
    updatedAt: "act. ",
    inQueueChecked: "En Cola — Checked",
    noQueue: "Ninguna posición en cola",
    last10Scored: "Últimas 10 Scored",
    noScored: "Ninguna posición scored",
    last10Excluded: "Últimas 10 Excluidas (score < 40)",
    todayLc: "hoy",
    scoredLc: "scored",
    excludedLc: "excluidas",
    passLc: (pct) => `(${pct}% pass)`,
    noRecentExclusion: "Ninguna exclusión reciente",
  },
  fr: {
    remote: "À distance",
    rt: {
      now: "maintenant",
      m: (n) => `il y a ${n} min`,
      h: (n) => `il y a ${n} h`,
    },
    monthShort: "short",
    noRealtime: "Données en temps réel indisponibles.",
    loadingLive: "Chargement des données en direct…",
    live: "Live",
    offline: "Offline",
    inQueue: "en file",
    scoredTot: "scored tot",
    scoredToday: "scored aujourd'hui",
    excludedToday: "exclues aujourd'hui",
    avgToday: "moy. aujourd'hui",
    updatedAt: "maj ",
    inQueueChecked: "En File — Checked",
    noQueue: "Aucun poste en file",
    last10Scored: "10 derniers Scored",
    noScored: "Aucun poste scored",
    last10Excluded: "10 dernières Exclues (score < 40)",
    todayLc: "aujourd'hui",
    scoredLc: "scored",
    excludedLc: "exclues",
    passLc: (pct) => `(${pct}% pass)`,
    noRecentExclusion: "Aucune exclusion récente",
  },
  de: {
    remote: "Remote",
    rt: { now: "jetzt", m: (n) => `vor ${n} Min.`, h: (n) => `vor ${n} Std.` },
    monthShort: "short",
    noRealtime: "Echtzeitdaten nicht verfügbar.",
    loadingLive: "Live-Daten werden geladen…",
    live: "Live",
    offline: "Offline",
    inQueue: "in Warteschlange",
    scoredTot: "scored ges.",
    scoredToday: "scored heute",
    excludedToday: "heute ausgeschlossen",
    avgToday: "Ø heute",
    updatedAt: "akt. ",
    inQueueChecked: "In Warteschlange — Checked",
    noQueue: "Keine Positionen in Warteschlange",
    last10Scored: "Letzte 10 Scored",
    noScored: "Keine bewerteten Positionen",
    last10Excluded: "Letzte 10 Ausgeschlossen (score < 40)",
    todayLc: "heute",
    scoredLc: "scored",
    excludedLc: "ausgeschlossen",
    passLc: (pct) => `(${pct}% pass)`,
    noRecentExclusion: "Keine kürzlichen Ausschlüsse",
  },
  hu: {
    remote: "Távmunka",
    rt: { now: "most", m: (n) => `${n} perce`, h: (n) => `${n} órája` },
    monthShort: "short",
    noRealtime: "A valós idejű adatok nem érhetők el.",
    loadingLive: "Élő adatok betöltése…",
    live: "Live",
    offline: "Offline",
    inQueue: "sorban",
    scoredTot: "scored össz.",
    scoredToday: "scored ma",
    excludedToday: "ma kizárva",
    avgToday: "átlag ma",
    updatedAt: "frissítve ",
    inQueueChecked: "Sorban — Checked",
    noQueue: "Nincs pozíció a sorban",
    last10Scored: "Utolsó 10 Scored",
    noScored: "Nincs pontozott pozíció",
    last10Excluded: "Utolsó 10 Kizárt (score < 40)",
    todayLc: "ma",
    scoredLc: "scored",
    excludedLc: "kizárva",
    passLc: (pct) => `(${pct}% pass)`,
    noRecentExclusion: "Nincs friss kizárás",
  },
  pt: {
    remote: "Remoto",
    rt: { now: "agora", m: (n) => `há ${n}m`, h: (n) => `há ${n}h` },
    monthShort: "short",
    noRealtime: "Dados em tempo real indisponíveis.",
    loadingLive: "Carregando dados ao vivo…",
    live: "Live",
    offline: "Offline",
    inQueue: "na fila",
    scoredTot: "scored tot",
    scoredToday: "scored hoje",
    excludedToday: "excluídas hoje",
    avgToday: "média hoje",
    updatedAt: "atual. ",
    inQueueChecked: "Na Fila — Checked",
    noQueue: "Nenhuma vaga na fila",
    last10Scored: "Últimas 10 Scored",
    noScored: "Nenhuma vaga scored",
    last10Excluded: "Últimas 10 Excluídas (score < 40)",
    todayLc: "hoje",
    scoredLc: "scored",
    excludedLc: "excluídas",
    passLc: (pct) => `(${pct}% pass)`,
    noRecentExclusion: "Nenhuma exclusão recente",
  },
};

type QueueItem = {
  id: string;
  title: string;
  company: string;
  location: string;
  remote_type: string;
  last_checked: string;
  notes: string;
};

type ScoredItem = {
  id: string;
  title: string;
  company: string;
  location: string;
  remote_type: string;
  total_score: number;
  scored_at: string;
  scored_by: string;
};

type ScorerData = {
  stats: {
    queue_size: number;
    scored_total: number;
    scored_today: number;
    excluded_today: number;
    avg_score_today: number | null;
  };
  queue: QueueItem[];
  recent_scored: ScoredItem[];
  recent_excluded: ScoredItem[];
};

function fmtTs(ts: string, localeTag: string, rt: RelTime) {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return rt.now;
  if (diffMin < 60) return rt.m(diffMin);
  if (diffMin < 1440) return rt.h(Math.floor(diffMin / 60));
  return d.toLocaleDateString(localeTag, { day: "2-digit", month: "short" });
}

function locLabel(
  item: { remote_type: string; location: string },
  remoteLabel: string,
) {
  if (item.remote_type === "full_remote") return remoteLabel;
  return (item.location ?? "").split(",")[0] || "";
}

function scoreBadge(score: number) {
  let bg = "var(--color-red)";
  let fg = "#fff";
  if (score >= 70) {
    bg = "var(--color-green)";
    fg = "#000";
  } else if (score >= 50) {
    bg = "var(--color-yellow)";
    fg = "#000";
  } else if (score >= 40) {
    bg = "var(--color-orange)";
    fg = "#000";
  }
  return (
    <span
      className="inline-block px-1.5 rounded text-[9px] font-bold"
      style={{ background: bg, color: fg }}
    >
      {score}
    </span>
  );
}

function QueueRow({
  p,
  localeTag,
  rt,
  remoteLabel,
}: {
  p: QueueItem;
  localeTag: string;
  rt: RelTime;
  remoteLabel: string;
}) {
  const loc = locLabel(p, remoteLabel);
  const inScoring = (p.notes ?? "").includes("IN_SCORING");
  return (
    <div
      className="flex flex-col gap-0.5 py-2 border-b border-[var(--color-border)] last:border-0"
      style={inScoring ? { background: "rgba(255,214,0,0.04)" } : undefined}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono text-[var(--color-blue)]">
          #{p.id}
        </span>
        <span className="text-[11px] text-[var(--color-bright)] font-medium truncate max-w-[240px]">
          {p.title || "—"}
        </span>
        {inScoring && (
          <span
            className="text-[8px] font-bold px-1.5 rounded"
            style={{
              background: "var(--color-yellow)",
              color: "#000",
              animation: "pulse-dot 1.5s infinite",
            }}
          >
            IN SCORING
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-[var(--color-muted)]">
          {p.company}
        </span>
        {loc && (
          <span className="text-[9px] text-[var(--color-orange)] font-mono">
            {loc}
          </span>
        )}
        <span
          className="text-[8px] px-1 rounded font-semibold"
          style={{
            background: "rgba(0,230,118,0.15)",
            color: "var(--color-green)",
          }}
        >
          CHECKED
        </span>
        <span className="text-[9px] text-[var(--color-dim)] ml-auto">
          {fmtTs(p.last_checked, localeTag, rt)}
        </span>
      </div>
    </div>
  );
}

function ScoredRow({
  p,
  localeTag,
  rt,
  remoteLabel,
}: {
  p: ScoredItem;
  localeTag: string;
  rt: RelTime;
  remoteLabel: string;
}) {
  const loc = locLabel(p, remoteLabel);
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-[var(--color-border)] last:border-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono text-[var(--color-blue)]">
          #{p.id}
        </span>
        <span className="text-[11px] text-[var(--color-bright)] font-medium truncate max-w-[220px]">
          {p.title || "—"}
        </span>
        {scoreBadge(p.total_score)}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-[var(--color-muted)]">
          {p.company}
        </span>
        {loc && (
          <span className="text-[9px] text-[var(--color-orange)] font-mono">
            {loc}
          </span>
        )}
        <span className="text-[9px] text-[var(--color-dim)] ml-auto">
          {fmtTs(p.scored_at, localeTag, rt)}
        </span>
      </div>
    </div>
  );
}

function ExcludedRow({
  p,
  localeTag,
  rt,
  remoteLabel,
}: {
  p: ScoredItem;
  localeTag: string;
  rt: RelTime;
  remoteLabel: string;
}) {
  const loc = locLabel(p, remoteLabel);
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-[var(--color-border)] last:border-0 opacity-70">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className="text-[10px] font-mono"
          style={{ color: "var(--color-red)" }}
        >
          #{p.id}
        </span>
        <span className="text-[11px] text-[var(--color-dim)] line-through truncate max-w-[220px]">
          {p.title || "—"}
        </span>
        {scoreBadge(p.total_score)}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-[var(--color-muted)]">
          {p.company}
        </span>
        {loc && (
          <span className="text-[9px] text-[var(--color-orange)] font-mono">
            {loc}
          </span>
        )}
        <span className="text-[9px] text-[var(--color-dim)] ml-auto">
          {fmtTs(p.scored_at, localeTag, rt)}
        </span>
      </div>
    </div>
  );
}

export default function ScorerLiveSection() {
  const locale = useLocale();
  const t = T[locale];
  const localeTag = intlTag(locale);
  const [data, setData] = useState<ScorerData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  const [isAgentActive, setIsAgentActive] = useState(false);
  const isCloud = useIsCloud();

  const fetch_ = useCallback(async () => {
    const [activityResult, statusResult] = await Promise.allSettled([
      fetch("/api/scorer/activity"),
      fetch("/api/team/status"),
    ]);

    // Activity data
    if (activityResult.status === "fulfilled" && activityResult.value.ok) {
      const json = await activityResult.value.json();
      setData(json);
      setLastUpdate(new Date());
      setError(false);
    } else {
      setError(true);
    }

    // Team status — controlla se SCORER è attivo
    if (statusResult.status === "fulfilled" && statusResult.value.ok) {
      const statusJson = await statusResult.value.json();
      const scorerActive = (statusJson.agents ?? []).some(
        (a: { session: string }) => {
          const s = a.session.toUpperCase();
          return s === "SCORER" || s.startsWith("SCORER-");
        },
      );
      setIsAgentActive(scorerActive);
    }
  }, []);

  useEffect(() => {
    fetch_();
    if (isCloud) return;
    const id = setInterval(fetch_, 8000);
    return () => clearInterval(id);
  }, [fetch_, isCloud]);

  if (error)
    return (
      <div className="mt-8 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] text-[11px] text-[var(--color-dim)]">
        {t.noRealtime}
      </div>
    );

  if (!data)
    return (
      <div className="mt-8 flex items-center gap-2 text-[11px] text-[var(--color-dim)]">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-dim)] animate-pulse" />
        {t.loadingLive}
      </div>
    );

  const { stats, queue, recent_scored, recent_excluded } = data;
  const sTotal = stats.scored_today + stats.excluded_today;
  const passPct =
    sTotal > 0 ? Math.round((stats.scored_today / sTotal) * 100) : 0;
  const avgColor =
    stats.avg_score_today == null
      ? "var(--color-dim)"
      : stats.avg_score_today >= 70
        ? "var(--color-green)"
        : stats.avg_score_today >= 40
          ? "var(--color-yellow)"
          : "var(--color-orange)";

  return (
    <div
      className="mt-8 space-y-6"
      style={{ animation: "fade-in 0.3s ease both" }}
    >
      {/* Stats bar */}
      <div className="flex items-center gap-1 flex-wrap">
        <div
          className="w-1.5 h-1.5 rounded-full mr-1"
          style={{
            background: isAgentActive
              ? "var(--color-purple)"
              : "var(--color-dim)",
            animation: isAgentActive
              ? "pulse-dot 2s ease-in-out infinite"
              : undefined,
          }}
        />
        <span className="text-[9px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mr-3">
          {isAgentActive ? t.live : t.offline}
        </span>

        {[
          {
            val: stats.queue_size,
            label: t.inQueue,
            color: "var(--color-orange)",
          },
          {
            val: stats.scored_total,
            label: t.scoredTot,
            color: "var(--color-yellow)",
          },
          {
            val: stats.scored_today,
            label: t.scoredToday,
            color: "var(--color-yellow)",
          },
          {
            val: stats.excluded_today,
            label: t.excludedToday,
            color: "var(--color-red)",
          },
        ].map(({ val, label, color }) => (
          <div
            key={label}
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-1.5 flex flex-col items-center min-w-[72px]"
          >
            <span
              className="text-[18px] font-bold leading-none"
              style={{ color }}
            >
              {val}
            </span>
            <span className="text-[8px] text-[var(--color-dim)] tracking-wide mt-0.5">
              {label}
            </span>
          </div>
        ))}

        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-1.5 flex flex-col items-center min-w-[72px]">
          <span
            className="text-[18px] font-bold leading-none"
            style={{ color: avgColor }}
          >
            {stats.avg_score_today ?? "—"}
          </span>
          <span className="text-[8px] text-[var(--color-dim)] tracking-wide mt-0.5">
            {t.avgToday}
          </span>
        </div>

        {lastUpdate && (
          <span className="text-[9px] text-[var(--color-dim)] ml-auto">
            {t.updatedAt}
            {lastUpdate.toLocaleTimeString(localeTag, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
      </div>

      {/* Grid: Coda + Scored */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Coda lavoro */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-dim)]">
              {t.inQueueChecked}
            </span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(255,145,0,0.12)",
                color: "var(--color-orange)",
              }}
            >
              {stats.queue_size}
            </span>
          </div>
          {queue.length === 0 ? (
            <p className="text-[10px] text-[var(--color-dim)] py-4 text-center">
              {t.noQueue}
            </p>
          ) : (
            queue.map((p) => (
              <QueueRow
                key={p.id}
                p={p}
                localeTag={localeTag}
                rt={t.rt}
                remoteLabel={t.remote}
              />
            ))
          )}
        </div>

        {/* Ultime scored */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span
              className="text-[9px] font-semibold tracking-[0.15em] uppercase"
              style={{ color: "var(--color-yellow)" }}
            >
              {t.last10Scored}
            </span>
          </div>
          {recent_scored.length === 0 ? (
            <p className="text-[10px] text-[var(--color-dim)] py-4 text-center">
              {t.noScored}
            </p>
          ) : (
            recent_scored.map((p) => (
              <ScoredRow
                key={p.id}
                p={p}
                localeTag={localeTag}
                rt={t.rt}
                remoteLabel={t.remote}
              />
            ))
          )}
        </div>
      </div>

      {/* Escluse dallo scorer */}
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
        <div className="flex items-center justify-between mb-3">
          <span
            className="text-[9px] font-semibold tracking-[0.15em] uppercase"
            style={{ color: "var(--color-red)" }}
          >
            {t.last10Excluded}
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: "rgba(244,67,54,0.12)",
              color: "var(--color-red)",
            }}
          >
            {stats.excluded_today} {t.todayLc}
          </span>
        </div>

        {/* Ratio bar scored/escluse */}
        {sTotal > 0 && (
          <div className="flex items-center gap-2 mb-3 text-[9px] font-mono">
            <span style={{ color: "var(--color-yellow)" }}>
              {stats.scored_today} {t.scoredLc}
            </span>
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: "var(--color-red)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${passPct}%`,
                  background: "var(--color-yellow)",
                }}
              />
            </div>
            <span style={{ color: "var(--color-red)" }}>
              {stats.excluded_today} {t.excludedLc}
            </span>
            <span className="text-[var(--color-dim)]">{t.passLc(passPct)}</span>
          </div>
        )}

        {recent_excluded.length === 0 ? (
          <p className="text-[10px] text-[var(--color-dim)] py-2 text-center">
            {t.noRecentExclusion}
          </p>
        ) : (
          recent_excluded.map((p) => (
            <ExcludedRow
              key={p.id}
              p={p}
              localeTag={localeTag}
              rt={t.rt}
              remoteLabel={t.remote}
            />
          ))
        )}
      </div>
    </div>
  );
}
