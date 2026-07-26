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
    noRealtime: string;
    loadingLive: string;
    live: string;
    offline: string;
    foundToday: string;
    waiting: string;
    excludedToday: string;
    updatedAt: string;
    workQueue: string;
    newLc: string;
    noQueue: string;
    latestFound: string;
    noFound: string;
    excludedTodayTitle: string;
    passedLc: string;
    excludedLc: string;
    passLc: (pct: number) => string;
    noExclusionsToday: string;
  }
> = {
  it: {
    remote: "Remote",
    rt: { now: "adesso", m: (n) => `${n}m fa`, h: (n) => `${n}h fa` },
    noRealtime: "Dati real-time non disponibili.",
    loadingLive: "Caricamento dati live…",
    live: "Live",
    offline: "Offline",
    foundToday: "trovate oggi",
    waiting: "in attesa",
    excludedToday: "escluse oggi",
    updatedAt: "agg. ",
    workQueue: "Coda lavoro",
    newLc: "new",
    noQueue: "Nessuna posizione in attesa",
    latestFound: "Ultime trovate",
    noFound: "Nessuna posizione trovata",
    excludedTodayTitle: "Escluse oggi",
    passedLc: "passate",
    excludedLc: "escluse",
    passLc: (pct) => `(${pct}% pass)`,
    noExclusionsToday: "Nessuna esclusione oggi",
  },
  en: {
    remote: "Remote",
    rt: { now: "now", m: (n) => `${n}m ago`, h: (n) => `${n}h ago` },
    noRealtime: "Real-time data unavailable.",
    loadingLive: "Loading live data…",
    live: "Live",
    offline: "Offline",
    foundToday: "found today",
    waiting: "waiting",
    excludedToday: "excluded today",
    updatedAt: "upd. ",
    workQueue: "Work queue",
    newLc: "new",
    noQueue: "No positions waiting",
    latestFound: "Latest found",
    noFound: "No positions found",
    excludedTodayTitle: "Excluded today",
    passedLc: "passed",
    excludedLc: "excluded",
    passLc: (pct) => `(${pct}% pass)`,
    noExclusionsToday: "No exclusions today",
  },
  es: {
    remote: "Remoto",
    rt: { now: "ahora", m: (n) => `hace ${n}m`, h: (n) => `hace ${n}h` },
    noRealtime: "Datos en tiempo real no disponibles.",
    loadingLive: "Cargando datos en vivo…",
    live: "Live",
    offline: "Offline",
    foundToday: "encontradas hoy",
    waiting: "en espera",
    excludedToday: "excluidas hoy",
    updatedAt: "act. ",
    workQueue: "Cola de trabajo",
    newLc: "new",
    noQueue: "Ninguna posición en espera",
    latestFound: "Últimas encontradas",
    noFound: "Ninguna posición encontrada",
    excludedTodayTitle: "Excluidas hoy",
    passedLc: "pasadas",
    excludedLc: "excluidas",
    passLc: (pct) => `(${pct}% pass)`,
    noExclusionsToday: "Ninguna exclusión hoy",
  },
  fr: {
    remote: "À distance",
    rt: {
      now: "maintenant",
      m: (n) => `il y a ${n} min`,
      h: (n) => `il y a ${n} h`,
    },
    noRealtime: "Données en temps réel indisponibles.",
    loadingLive: "Chargement des données en direct…",
    live: "Live",
    offline: "Offline",
    foundToday: "trouvées aujourd'hui",
    waiting: "en attente",
    excludedToday: "exclues aujourd'hui",
    updatedAt: "maj ",
    workQueue: "File de travail",
    newLc: "new",
    noQueue: "Aucun poste en attente",
    latestFound: "Dernières trouvées",
    noFound: "Aucun poste trouvé",
    excludedTodayTitle: "Exclues aujourd'hui",
    passedLc: "passées",
    excludedLc: "exclues",
    passLc: (pct) => `(${pct}% pass)`,
    noExclusionsToday: "Aucune exclusion aujourd'hui",
  },
  de: {
    remote: "Remote",
    rt: { now: "jetzt", m: (n) => `vor ${n} Min.`, h: (n) => `vor ${n} Std.` },
    noRealtime: "Echtzeitdaten nicht verfügbar.",
    loadingLive: "Live-Daten werden geladen…",
    live: "Live",
    offline: "Offline",
    foundToday: "heute gefunden",
    waiting: "wartend",
    excludedToday: "heute ausgeschlossen",
    updatedAt: "akt. ",
    workQueue: "Arbeitswarteschlange",
    newLc: "new",
    noQueue: "Keine Positionen wartend",
    latestFound: "Zuletzt gefunden",
    noFound: "Keine Positionen gefunden",
    excludedTodayTitle: "Heute ausgeschlossen",
    passedLc: "bestanden",
    excludedLc: "ausgeschlossen",
    passLc: (pct) => `(${pct}% pass)`,
    noExclusionsToday: "Keine Ausschlüsse heute",
  },
  hu: {
    remote: "Távmunka",
    rt: { now: "most", m: (n) => `${n} perce`, h: (n) => `${n} órája` },
    noRealtime: "A valós idejű adatok nem érhetők el.",
    loadingLive: "Élő adatok betöltése…",
    live: "Live",
    offline: "Offline",
    foundToday: "ma találva",
    waiting: "várakozik",
    excludedToday: "ma kizárva",
    updatedAt: "frissítve ",
    workQueue: "Munkasor",
    newLc: "new",
    noQueue: "Nincs várakozó pozíció",
    latestFound: "Legutóbb találva",
    noFound: "Nincs talált pozíció",
    excludedTodayTitle: "Ma kizárva",
    passedLc: "átment",
    excludedLc: "kizárva",
    passLc: (pct) => `(${pct}% pass)`,
    noExclusionsToday: "Nincs kizárás ma",
  },
  pt: {
    remote: "Remoto",
    rt: { now: "agora", m: (n) => `há ${n}m`, h: (n) => `há ${n}h` },
    noRealtime: "Dados em tempo real indisponíveis.",
    loadingLive: "Carregando dados ao vivo…",
    live: "Live",
    offline: "Offline",
    foundToday: "encontradas hoje",
    waiting: "aguardando",
    excludedToday: "excluídas hoje",
    updatedAt: "atual. ",
    workQueue: "Fila de trabalho",
    newLc: "new",
    noQueue: "Nenhuma vaga aguardando",
    latestFound: "Últimas encontradas",
    noFound: "Nenhuma vaga encontrada",
    excludedTodayTitle: "Excluídas hoje",
    passedLc: "passaram",
    excludedLc: "excluídas",
    passLc: (pct) => `(${pct}% pass)`,
    noExclusionsToday: "Nenhuma exclusão hoje",
  },
};

type Position = {
  id: string;
  title: string;
  company: string;
  location: string;
  remote_type: string;
  found_at: string;
  found_by?: string;
  status?: string;
  notes?: string;
};

type ScoutData = {
  stats: { found_today: number; total_new: number };
  queue: Position[];
  recent: Position[];
  excluded_today: Position[];
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
  p: Pick<Position, "remote_type" | "location">,
  remoteLabel: string,
) {
  if (p.remote_type === "full_remote") return remoteLabel;
  return (p.location ?? "").split(",")[0] || "";
}

function scoutBadge(name?: string) {
  if (!name) return "";
  return name.toUpperCase().replace("SCOUT-", "S");
}

function FeedItem({
  p,
  dim,
  localeTag,
  rt,
  remoteLabel,
}: {
  p: Position;
  dim?: boolean;
  localeTag: string;
  rt: RelTime;
  remoteLabel: string;
}) {
  const loc = locLabel(p, remoteLabel);
  return (
    <div
      className="flex flex-col gap-0.5 py-2 border-b border-[var(--color-border)] last:border-0"
      style={{ opacity: dim ? 0.65 : 1 }}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono text-[var(--color-blue)]">
          #{p.id}
        </span>
        <span className="text-[11px] text-[var(--color-bright)] font-medium truncate max-w-[260px]">
          {p.title || "—"}
        </span>
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
        {p.found_by && (
          <span className="text-[9px] font-bold text-[var(--color-blue)] font-mono">
            {scoutBadge(p.found_by)}
          </span>
        )}
        <span className="text-[9px] text-[var(--color-dim)] ml-auto">
          {fmtTs(p.found_at, localeTag, rt)}
        </span>
      </div>
    </div>
  );
}

function ExcludedItem({
  p,
  localeTag,
  rt,
  remoteLabel,
}: {
  p: Position;
  localeTag: string;
  rt: RelTime;
  remoteLabel: string;
}) {
  const loc = locLabel(p, remoteLabel);
  const reason = (p.notes ?? "")
    .replace(/^MOTIVO ESCLUSIONE:\s*/i, "")
    .split("\n")[0]
    .slice(0, 60);
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-[var(--color-border)] last:border-0 opacity-70">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className="text-[10px] font-mono"
          style={{ color: "var(--color-red)" }}
        >
          #{p.id}
        </span>
        <span className="text-[11px] text-[var(--color-dim)] line-through truncate max-w-[260px]">
          {p.title || "—"}
        </span>
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
        {reason && (
          <span className="text-[9px]" style={{ color: "var(--color-red)" }}>
            {reason}
          </span>
        )}
        <span className="text-[9px] text-[var(--color-dim)] ml-auto">
          {fmtTs(p.found_at, localeTag, rt)}
        </span>
      </div>
    </div>
  );
}

export default function ScoutLiveSection() {
  const locale = useLocale();
  const t = T[locale];
  const localeTag = intlTag(locale);
  const [data, setData] = useState<ScoutData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  const [isAgentActive, setIsAgentActive] = useState(false);
  const isCloud = useIsCloud();

  const fetch_ = useCallback(async () => {
    const [activityResult, statusResult] = await Promise.allSettled([
      fetch("/api/scout/activity"),
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

    // Team status — controlla se SCOUT è attivo
    if (statusResult.status === "fulfilled" && statusResult.value.ok) {
      const statusJson = await statusResult.value.json();
      const scoutActive = (statusJson.agents ?? []).some(
        (a: { session: string }) => {
          const s = a.session.toUpperCase();
          return s === "SCOUT" || s.startsWith("SCOUT-");
        },
      );
      setIsAgentActive(scoutActive);
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

  const { stats, queue, recent, excluded_today } = data;
  const sTotal = stats.found_today + excluded_today.length;
  const passPct =
    sTotal > 0 ? Math.round((stats.found_today / sTotal) * 100) : 0;

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
              ? "var(--color-green)"
              : "var(--color-dim)",
            animation: isAgentActive
              ? "pulse-dot 2s ease-in-out infinite"
              : undefined,
          }}
        />
        <span className="text-[9px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mr-3">
          {isAgentActive ? t.live : t.offline}
        </span>

        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-1.5 flex flex-col items-center min-w-[72px]">
          <span
            className="text-[18px] font-bold leading-none"
            style={{ color: "var(--color-green)" }}
          >
            {stats.found_today}
          </span>
          <span className="text-[8px] text-[var(--color-dim)] tracking-wide mt-0.5">
            {t.foundToday}
          </span>
        </div>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-1.5 flex flex-col items-center min-w-[72px]">
          <span
            className="text-[18px] font-bold leading-none"
            style={{ color: "var(--color-blue)" }}
          >
            {stats.total_new}
          </span>
          <span className="text-[8px] text-[var(--color-dim)] tracking-wide mt-0.5">
            {t.waiting}
          </span>
        </div>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-1.5 flex flex-col items-center min-w-[72px]">
          <span
            className="text-[18px] font-bold leading-none"
            style={{ color: "var(--color-red)" }}
          >
            {excluded_today.length}
          </span>
          <span className="text-[8px] text-[var(--color-dim)] tracking-wide mt-0.5">
            {t.excludedToday}
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

      {/* Grid: Coda + Feed */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Coda lavoro */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-dim)]">
              {t.workQueue}
            </span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(33,150,243,0.12)",
                color: "var(--color-blue)",
              }}
            >
              {stats.total_new} {t.newLc}
            </span>
          </div>
          {queue.length === 0 ? (
            <p className="text-[10px] text-[var(--color-dim)] py-4 text-center">
              {t.noQueue}
            </p>
          ) : (
            queue.map((p) => (
              <FeedItem
                key={p.id}
                p={p}
                localeTag={localeTag}
                rt={t.rt}
                remoteLabel={t.remote}
              />
            ))
          )}
        </div>

        {/* Feed ultimi 10 trovati */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-dim)]">
              {t.latestFound}
            </span>
            <span className="text-[9px] text-[var(--color-dim)]">top 10</span>
          </div>
          {recent.length === 0 ? (
            <p className="text-[10px] text-[var(--color-dim)] py-4 text-center">
              {t.noFound}
            </p>
          ) : (
            recent.map((p) => (
              <FeedItem
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

      {/* Sezione esclusioni */}
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
        <div className="flex items-center justify-between mb-3">
          <span
            className="text-[9px] font-semibold tracking-[0.15em] uppercase"
            style={{ color: "var(--color-red)" }}
          >
            {t.excludedTodayTitle}
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: "rgba(244,67,54,0.12)",
              color: "var(--color-red)",
            }}
          >
            {excluded_today.length}
          </span>
        </div>

        {/* Ratio bar */}
        {sTotal > 0 && (
          <div className="flex items-center gap-2 mb-3 text-[9px] font-mono">
            <span style={{ color: "var(--color-green)" }}>
              {stats.found_today} {t.passedLc}
            </span>
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: "var(--color-red)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${passPct}%`,
                  background: "var(--color-green)",
                }}
              />
            </div>
            <span style={{ color: "var(--color-red)" }}>
              {excluded_today.length} {t.excludedLc}
            </span>
            <span className="text-[var(--color-dim)]">{t.passLc(passPct)}</span>
          </div>
        )}

        {excluded_today.length === 0 ? (
          <p className="text-[10px] text-[var(--color-dim)] py-2 text-center">
            {t.noExclusionsToday}
          </p>
        ) : (
          excluded_today.map((p) => (
            <ExcludedItem
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
