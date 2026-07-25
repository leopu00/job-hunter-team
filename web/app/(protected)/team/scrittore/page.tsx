"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import AgentInteraction from "@/components/AgentInteraction";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { intlTag } from "@/lib/locale-tag";

const T: Record<
  Locale,
  {
    dashboard: string;
    team: string;
    writer: string;
    subtitle: string;
    inQueue: string;
    writtenToday: string;
    completed: string;
    criticAvg: string;
    inQueueScored: string;
    noQueue: string;
    inProgress: string;
    noActiveWriter: string;
    lastCompleted: string;
    noCompletedCv: string;
    remote: string;
    inWriting: string;
    critic: string;
    round: (n: number) => string;
  }
> = {
  it: {
    dashboard: "Dashboard",
    team: "Team",
    writer: "Scrittore",
    subtitle: "Pipeline scrittura CV · polling 8s",
    inQueue: "In coda",
    writtenToday: "Scritti oggi",
    completed: "Completati",
    criticAvg: "Media critico",
    inQueueScored: "In Coda — Scored (top 15)",
    noQueue: "Nessuna posizione in coda",
    inProgress: "In Lavorazione",
    noActiveWriter: "Nessuno scrittore attivo",
    lastCompleted: "Ultimi 10 Completati",
    noCompletedCv: "Nessun CV completato",
    remote: "Remote",
    inWriting: "IN SCRITTURA",
    critic: "CRITICO",
    round: (n) => `Round ${n}/3`,
  },
  en: {
    dashboard: "Dashboard",
    team: "Team",
    writer: "Writer",
    subtitle: "CV writing pipeline · 8s polling",
    inQueue: "Queued",
    writtenToday: "Written today",
    completed: "Completed",
    criticAvg: "Critic avg",
    inQueueScored: "In Queue — Scored (top 15)",
    noQueue: "No positions in queue",
    inProgress: "In Progress",
    noActiveWriter: "No active writer",
    lastCompleted: "Last 10 Completed",
    noCompletedCv: "No completed CV",
    remote: "Remote",
    inWriting: "WRITING",
    critic: "CRITIC",
    round: (n) => `Round ${n}/3`,
  },
  es: {
    dashboard: "Panel",
    team: "Equipo",
    writer: "Redactor",
    subtitle: "Pipeline de redacción de CV · polling 8s",
    inQueue: "En cola",
    writtenToday: "Escritos hoy",
    completed: "Completados",
    criticAvg: "Media del crítico",
    inQueueScored: "En Cola — Scored (top 15)",
    noQueue: "Ninguna posición en cola",
    inProgress: "En Proceso",
    noActiveWriter: "Ningún redactor activo",
    lastCompleted: "Últimos 10 Completados",
    noCompletedCv: "Ningún CV completado",
    remote: "Remoto",
    inWriting: "ESCRIBIENDO",
    critic: "CRÍTICO",
    round: (n) => `Ronda ${n}/3`,
  },
  fr: {
    dashboard: "Tableau de bord",
    team: "Équipe",
    writer: "Rédacteur",
    subtitle: "Pipeline de rédaction de CV · polling 8s",
    inQueue: "En file",
    writtenToday: "Rédigés aujourd'hui",
    completed: "Terminés",
    criticAvg: "Moy. critique",
    inQueueScored: "En File — Scored (top 15)",
    noQueue: "Aucun poste en file",
    inProgress: "En Cours",
    noActiveWriter: "Aucun rédacteur actif",
    lastCompleted: "10 derniers Terminés",
    noCompletedCv: "Aucun CV terminé",
    remote: "À distance",
    inWriting: "RÉDACTION",
    critic: "CRITIQUE",
    round: (n) => `Tour ${n}/3`,
  },
  de: {
    dashboard: "Dashboard",
    team: "Team",
    writer: "Verfasser",
    subtitle: "CV-Schreib-Pipeline · 8s Polling",
    inQueue: "In Warteschlange",
    writtenToday: "Heute geschrieben",
    completed: "Abgeschlossen",
    criticAvg: "Kritiker-Durchschnitt",
    inQueueScored: "In Warteschlange — Scored (top 15)",
    noQueue: "Keine Positionen in Warteschlange",
    inProgress: "In Bearbeitung",
    noActiveWriter: "Kein aktiver Verfasser",
    lastCompleted: "Letzte 10 Abgeschlossen",
    noCompletedCv: "Kein abgeschlossener CV",
    remote: "Remote",
    inWriting: "IN ARBEIT",
    critic: "KRITIKER",
    round: (n) => `Runde ${n}/3`,
  },
  hu: {
    dashboard: "Irányítópult",
    team: "Csapat",
    writer: "Író",
    subtitle: "Önéletrajz-írási folyamat · 8s polling",
    inQueue: "Sorban",
    writtenToday: "Ma megírva",
    completed: "Befejezve",
    criticAvg: "Kritikus átlag",
    inQueueScored: "Sorban — Scored (top 15)",
    noQueue: "Nincs pozíció a sorban",
    inProgress: "Folyamatban",
    noActiveWriter: "Nincs aktív író",
    lastCompleted: "Utolsó 10 Befejezett",
    noCompletedCv: "Nincs befejezett önéletrajz",
    remote: "Távmunka",
    inWriting: "ÍRÁS ALATT",
    critic: "KRITIKUS",
    round: (n) => `${n}/3. kör`,
  },
  pt: {
    dashboard: "Painel",
    team: "Equipe",
    writer: "Redator",
    subtitle: "Pipeline de redação de CV · polling 8s",
    inQueue: "Na fila",
    writtenToday: "Escritos hoje",
    completed: "Concluídos",
    criticAvg: "Média do crítico",
    inQueueScored: "Na Fila — Scored (top 15)",
    noQueue: "Nenhuma vaga na fila",
    inProgress: "Em Andamento",
    noActiveWriter: "Nenhum redator ativo",
    lastCompleted: "Últimos 10 Concluídos",
    noCompletedCv: "Nenhum CV concluído",
    remote: "Remoto",
    inWriting: "ESCREVENDO",
    critic: "CRÍTICO",
    round: (n) => `Rodada ${n}/3`,
  },
};

type ItemLabels = {
  remote: string;
  inWriting: string;
  critic: string;
  round: (n: number) => string;
};

type PositionItem = {
  id: number;
  title: string;
  company: string;
  location: string | null;
  remote_type: string | null;
  status?: string;
  notes?: string | null;
  total_score?: number | null;
  written_by?: string | null;
  critic_score?: number | null;
  critic_verdict?: string | null;
  critic_round?: number | null;
  written_at?: string | null;
  critic_reviewed_at?: string | null;
  critic_active?: boolean;
};

type ScrittoreActivity = {
  queue: PositionItem[];
  in_progress: PositionItem[];
  recent_completed: PositionItem[];
  queue_size: number;
  writing_today: number;
  completed_today: number;
  avg_critic_score: number | null;
};

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "";
  const parts = ts.split("T");
  const date = (parts[0] ?? ts).split("-");
  const time = (parts[1] ?? "").slice(0, 5);
  if (date.length < 3) return ts;
  return `${date[2]}/${date[1]}/${date[0]} ${time}`;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? "var(--color-green)"
      : score >= 50
        ? "var(--color-yellow)"
        : score >= 40
          ? "var(--color-orange)"
          : "var(--color-red)";
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: "0.7em",
        background: color,
        color: "#000",
        fontWeight: 700,
      }}
    >
      {score}
    </span>
  );
}

function CriticBadge({ score }: { score: number }) {
  const color =
    score >= 7
      ? "var(--color-green)"
      : score >= 5
        ? "var(--color-yellow)"
        : "var(--color-red)";
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: "0.7em",
        background: color,
        color: "#000",
        fontWeight: 700,
      }}
    >
      {score}/10
    </span>
  );
}

function RoundBadge({ round, label }: { round: number; label: string }) {
  const colors: Record<number, string> = {
    1: "var(--color-blue)",
    2: "#b388ff",
    3: "#00bcd4",
  };
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: "0.65em",
        background: colors[round] ?? "var(--color-dim)",
        color: "#000",
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function WritingTag({ label }: { label: string }) {
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: "0.65em",
        background: "var(--color-yellow)",
        color: "#000",
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function CriticoActiveTag({ label }: { label: string }) {
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: "0.65em",
        background: "#b388ff",
        color: "#fff",
        fontWeight: 700,
      }}
    >
      <span aria-hidden="true">⚖️</span> {label}
    </span>
  );
}

function QueueItem({ p, labels }: { p: PositionItem; labels: ItemLabels }) {
  const loc =
    p.remote_type === "full_remote"
      ? labels.remote
      : (p.location ?? "").split(",")[0];
  const inWriting = (p.notes ?? "").includes("IN_WRITING");
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-md hover:bg-[var(--color-border)] transition-colors"
      style={{
        background: inWriting ? "rgba(255,214,0,0.06)" : undefined,
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
          {p.total_score != null && <ScoreBadge score={p.total_score} />}
          {inWriting && <WritingTag label={labels.inWriting} />}
        </div>
      </div>
    </div>
  );
}

function ProgressItem({ p, labels }: { p: PositionItem; labels: ItemLabels }) {
  const loc =
    p.remote_type === "full_remote"
      ? labels.remote
      : (p.location ?? "").split(",")[0];
  const writerTag = p.written_by
    ? p.written_by.replace("scrittore-", "S")
    : null;
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-md hover:bg-[var(--color-border)] transition-colors"
      style={{ background: "rgba(255,214,0,0.04)", fontSize: "0.82em" }}
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
          {writerTag && (
            <span
              style={{ fontSize: "0.85em", color: "#00bcd4", fontWeight: 600 }}
            >
              {writerTag}
            </span>
          )}
          {p.critic_round != null && (
            <RoundBadge
              round={p.critic_round}
              label={labels.round(p.critic_round)}
            />
          )}
          {p.critic_active ? (
            <CriticoActiveTag label={labels.critic} />
          ) : p.critic_score != null ? (
            <CriticBadge score={p.critic_score} />
          ) : (
            <WritingTag label={labels.inWriting} />
          )}
          {p.total_score != null && <ScoreBadge score={p.total_score} />}
        </div>
      </div>
    </div>
  );
}

function CompletedItem({ p }: { p: PositionItem }) {
  const writerTag = p.written_by
    ? p.written_by.replace("scrittore-", "S")
    : null;
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-md hover:bg-[var(--color-border)] transition-colors"
      style={{ fontSize: "0.82em" }}
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
          {writerTag && (
            <span
              style={{ fontSize: "0.85em", color: "#00bcd4", fontWeight: 600 }}
            >
              {writerTag}
            </span>
          )}
          {p.critic_score != null && <CriticBadge score={p.critic_score} />}
          {p.critic_reviewed_at && (
            <span
              className="text-[var(--color-dim)]"
              style={{ fontSize: "0.85em" }}
            >
              {fmtTs(p.critic_reviewed_at)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScrittorePage() {
  const locale = useLocale();
  const t = T[locale];
  const localeTag = intlTag(locale);
  const itemLabels: ItemLabels = {
    remote: t.remote,
    inWriting: t.inWriting,
    critic: t.critic,
    round: t.round,
  };
  const [data, setData] = useState<ScrittoreActivity | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const isCloud = useIsCloud();

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/scrittore/activity");
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

  const avgColor =
    data?.avg_critic_score != null
      ? data.avg_critic_score >= 7
        ? "var(--color-green)"
        : data.avg_critic_score >= 5
          ? "var(--color-yellow)"
          : "var(--color-red)"
      : "var(--color-dim)";

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
            {t.writer}
          </span>
        </nav>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              {t.writer}
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
            label: t.inQueue,
            val: data?.queue_size ?? "—",
            color: "var(--color-orange)",
          },
          {
            label: t.writtenToday,
            val: data?.writing_today ?? "—",
            color: "var(--color-yellow)",
          },
          {
            label: t.completed,
            val: data?.completed_today ?? "—",
            color: "var(--color-green)",
          },
          {
            label: t.criticAvg,
            val:
              data?.avg_critic_score != null
                ? `${data.avg_critic_score}/10`
                : "—",
            color: avgColor,
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

      {/* Coda + In lavorazione */}
      <div
        className="grid sm:grid-cols-2 gap-4 mb-4"
        style={{ animation: "fade-in 0.35s ease 0.05s both" }}
      >
        {/* Coda scored */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
          <h2 className="text-[11px] font-semibold tracking-wider uppercase text-[var(--color-muted)] mb-3">
            {t.inQueueScored}
          </h2>
          {!data || data.queue.length === 0 ? (
            <p className="text-[var(--color-dim)] text-[11px] px-3">
              {t.noQueue}
            </p>
          ) : (
            <div className="space-y-0.5">
              {data.queue.map((p) => (
                <QueueItem key={p.id} p={p} labels={itemLabels} />
              ))}
            </div>
          )}
        </div>

        {/* In lavorazione */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
          <h2
            className="text-[11px] font-semibold tracking-wider uppercase mb-3"
            style={{ color: "var(--color-yellow)" }}
          >
            {t.inProgress}
          </h2>
          {!data || data.in_progress.length === 0 ? (
            <p className="text-[var(--color-dim)] text-[11px] px-3">
              {t.noActiveWriter}
            </p>
          ) : (
            <div className="space-y-0.5">
              {data.in_progress.map((p) => (
                <ProgressItem key={p.id} p={p} labels={itemLabels} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ultimi completati */}
      <div
        className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors"
        style={{ animation: "fade-in 0.35s ease 0.1s both" }}
      >
        <h2
          className="text-[11px] font-semibold tracking-wider uppercase mb-3"
          style={{ color: "var(--color-green)" }}
        >
          {t.lastCompleted}
        </h2>
        {!data || data.recent_completed.length === 0 ? (
          <p className="text-[var(--color-dim)] text-[11px] px-3">
            {t.noCompletedCv}
          </p>
        ) : (
          <div className="space-y-0.5">
            {data.recent_completed.map((p) => (
              <CompletedItem key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>

      <AgentInteraction
        sessionPrefix="SCRITTORE"
        color="#ffd600"
        label={t.writer}
      />
    </div>
  );
}
