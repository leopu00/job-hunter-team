"use client";

import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<
  Locale,
  {
    dashboard: string;
    team: string;
    log: string;
    titleActivity: string;
    titleLog: string;
    subtitleActivity: (from: string, to: string, total: number) => string;
    subtitleLog: (total: number) => string;
    logHint: string;
  }
> = {
  it: {
    dashboard: "Dashboard",
    team: "Team",
    log: "Registro",
    titleActivity: "Attività del team",
    titleLog: "Registro attività",
    subtitleActivity: (from, to, total) =>
      `Chi ha lavorato e quanto · dal ${from} al ${to} · ${total} azioni totali`,
    subtitleLog: (total) =>
      `Tutte le azioni del team, una riga per azione · ${total} azioni totali`,
    logHint:
      "Ogni azione è attribuita all'istanza reale che l'ha eseguita (scout-N, analista-N, scorer-N), dall'event-log sincronizzato delle transizioni di stato.",
  },
  en: {
    dashboard: "Dashboard",
    team: "Team",
    log: "Log",
    titleActivity: "Team activity",
    titleLog: "Activity log",
    subtitleActivity: (from, to, total) =>
      `Who worked and how much · from ${from} to ${to} · ${total} total actions`,
    subtitleLog: (total) =>
      `All team actions, one row per action · ${total} total actions`,
    logHint:
      "Each action is attributed to the real instance that performed it (scout-N, analista-N, scorer-N), from the synced event-log of state transitions.",
  },
  es: {
    dashboard: "Panel",
    team: "Equipo",
    log: "Registro",
    titleActivity: "Actividad del equipo",
    titleLog: "Registro de actividad",
    subtitleActivity: (from, to, total) =>
      `Quién ha trabajado y cuánto · del ${from} al ${to} · ${total} acciones totales`,
    subtitleLog: (total) =>
      `Todas las acciones del equipo, una fila por acción · ${total} acciones totales`,
    logHint:
      "Cada acción se atribuye a la instancia real que la ejecutó (scout-N, analista-N, scorer-N), desde el event-log sincronizado de las transiciones de estado.",
  },
  fr: {
    dashboard: "Tableau de bord",
    team: "Équipe",
    log: "Journal",
    titleActivity: "Activité de l'équipe",
    titleLog: "Journal d'activité",
    subtitleActivity: (from, to, total) =>
      `Qui a travaillé et combien · du ${from} au ${to} · ${total} actions au total`,
    subtitleLog: (total) =>
      `Toutes les actions de l'équipe, une ligne par action · ${total} actions au total`,
    logHint:
      "Chaque action est attribuée à l'instance réelle qui l'a exécutée (scout-N, analista-N, scorer-N), depuis le journal d'événements synchronisé des transitions d'état.",
  },
  de: {
    dashboard: "Dashboard",
    team: "Team",
    log: "Protokoll",
    titleActivity: "Team-Aktivität",
    titleLog: "Aktivitätsprotokoll",
    subtitleActivity: (from, to, total) =>
      `Wer wie viel gearbeitet hat · vom ${from} bis ${to} · ${total} Aktionen insgesamt`,
    subtitleLog: (total) =>
      `Alle Team-Aktionen, eine Zeile pro Aktion · ${total} Aktionen insgesamt`,
    logHint:
      "Jede Aktion wird der realen Instanz zugeordnet, die sie ausgeführt hat (scout-N, analista-N, scorer-N), aus dem synchronisierten Ereignisprotokoll der Statusübergänge.",
  },
  hu: {
    dashboard: "Irányítópult",
    team: "Csapat",
    log: "Napló",
    titleActivity: "Csapat tevékenysége",
    titleLog: "Tevékenységnapló",
    subtitleActivity: (from, to, total) =>
      `Ki dolgozott és mennyit · ${from} – ${to} · összesen ${total} művelet`,
    subtitleLog: (total) =>
      `A csapat összes művelete, soronként egy művelet · összesen ${total} művelet`,
    logHint:
      "Minden műveletet a tényleges példányhoz rendelünk, amely végrehajtotta (scout-N, analista-N, scorer-N), az állapotátmenetek szinkronizált eseménynaplójából.",
  },
  pt: {
    dashboard: "Painel",
    team: "Equipe",
    log: "Registo",
    titleActivity: "Atividade da equipa",
    titleLog: "Registo de atividade",
    subtitleActivity: (from, to, total) =>
      `Quem trabalhou e quanto · de ${from} a ${to} · ${total} ações no total`,
    subtitleLog: (total) =>
      `Todas as ações da equipa, uma linha por ação · ${total} ações no total`,
    logHint:
      "Cada ação é atribuída à instância real que a executou (scout-N, analista-N, scorer-N), a partir do event-log sincronizado das transições de estado.",
  },
};

function Crumb({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[var(--color-border)]" aria-hidden="true">
      {children}
    </span>
  );
}

export function ActivityPageHeader({
  from,
  to,
  totalAll,
}: {
  from: string;
  to: string;
  totalAll: number;
}) {
  const t = T[useLocale()];
  return (
    <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
        <Link
          href="/dashboard"
          className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
        >
          {t.dashboard}
        </Link>
        <Crumb>/</Crumb>
        <span
          className="text-[10px] text-[var(--color-muted)]"
          aria-current="page"
        >
          {t.team}
        </span>
      </nav>
      <div className="mt-3">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
          {t.titleActivity}
        </h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          {t.subtitleActivity(from, to, totalAll)}
        </p>
      </div>
    </div>
  );
}

export function LogPageHeader({ total }: { total: number }) {
  const t = T[useLocale()];
  return (
    <div className="mb-6 pb-6 border-b border-[var(--color-border)]">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
        <Link
          href="/dashboard"
          className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
        >
          {t.dashboard}
        </Link>
        <Crumb>/</Crumb>
        <Link
          href="/team"
          className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
        >
          {t.team}
        </Link>
        <Crumb>/</Crumb>
        <span
          className="text-[10px] text-[var(--color-muted)]"
          aria-current="page"
        >
          {t.log}
        </span>
      </nav>
      <div className="mt-3">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
          {t.titleLog}
        </h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          {t.subtitleLog(total)}
        </p>
        <p className="text-[var(--color-dim)] text-[10px] mt-1">{t.logHint}</p>
      </div>
    </div>
  );
}
