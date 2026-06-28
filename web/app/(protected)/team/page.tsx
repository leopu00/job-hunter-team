"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "../../components/Toast";
import { useTeamCommandPoller } from "@/app/hooks/useTeamCommandPoller";
import { useTeamState } from "@/app/hooks/useTeamState";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import TeamOrgChart from "./_components/TeamOrgChart";
import UsageChart from "./_components/UsageChart";
import UsageTokensChart from "./_components/UsageTokensChart";
import TokenBreakdown from "./_components/TokenBreakdown";
import TokenTypesChart from "./_components/TokenTypesChart";
import AgentTokensChart from "./_components/AgentTokensChart";
import WriterCriticBreakdown from "./_components/WriterCriticBreakdown";
import ThrottleChart from "./_components/ThrottleChart";
import AgentActivityChart from "./_components/AgentActivityChart";
import DoctorPanel from "./_components/DoctorPanel";

/* ── Tipi ─────────────────────────────────────────────────────────── */

type AgentStatus = "running" | "stopped" | "pending";

type AgentDef = {
  id: string;
  name: string;
  role: string;
  color: string;
  link: string | null;
};

/* ── Definizioni agenti ───────────────────────────────────────────── */

const AGENTS: AgentDef[] = [
  {
    id: "capitano",
    name: "Capitano",
    role: "Capitano",
    color: "#ff9100",
    link: "/team/capitano",
  },
  {
    id: "sentinella",
    name: "Sentinella",
    role: "Sentinella",
    color: "#9c27b0",
    link: "/team/sentinella",
  },
  {
    id: "scout",
    name: "Scout",
    role: "Scout",
    color: "#2196f3",
    link: "/team/scout",
  },
  {
    id: "analista",
    name: "Analista",
    role: "Analista",
    color: "#00e676",
    link: "/team/analista",
  },
  {
    id: "scorer",
    name: "Scorer",
    role: "Scorer",
    color: "#b388ff",
    link: "/team/scorer",
  },
  {
    id: "scrittore",
    name: "Scrittore",
    role: "Scrittore",
    color: "#ffd600",
    link: "/team/scrittore",
  },
  {
    id: "critico",
    name: "Critico",
    role: "Critico",
    color: "#f44336",
    link: "/team/critico",
  },
  {
    id: "assistente",
    name: "Assistente",
    role: "Assistente",
    color: "#26c6da",
    link: "/team/assistente",
  },
];

/* ── i18n ─────────────────────────────────────────────────────────── */

const T: Record<
  Locale,
  {
    online: (name: string) => string;
    stopped: (name: string) => string;
    agentCmdError: string;
    startSent: string;
    teamStartError: string;
    stopSent: string;
    teamStopError: string;
    agentsActive: (n: number, total: number) => string;
    activityTitle: string;
    activity: string;
    v2Title: string;
    starting: string;
    stopping: string;
    start: string;
    stop: string;
    footerHint: string;
  }
> = {
  it: {
    online: (name) => `${name} è online`,
    stopped: (name) => `${name} fermato`,
    agentCmdError: "Errore esecuzione comando agente",
    startSent: "Comando Start inoltrato — attendo conferma container…",
    teamStartError: "Errore avvio team",
    stopSent: "Comando Stop inoltrato — attendo conferma container…",
    teamStopError: "Errore arresto team",
    agentsActive: (n, total) => `${n}/${total} agenti attivi`,
    activityTitle: "Grafici di attività del team (chi ha lavorato ultimamente)",
    activity: "📊 Attività",
    v2Title: "Vai alla pagina Team v2 (work in progress)",
    starting: "Avvio...",
    stopping: "Arresto...",
    start: "Avvia",
    stop: "Ferma",
    footerHint:
      "Aggiornamento automatico ogni 5s · Clicca l'emoji di un agente per i dettagli",
  },
  en: {
    online: (name) => `${name} is online`,
    stopped: (name) => `${name} stopped`,
    agentCmdError: "Agent command execution error",
    startSent: "Start command sent — awaiting container confirmation…",
    teamStartError: "Team start error",
    stopSent: "Stop command sent — awaiting container confirmation…",
    teamStopError: "Team stop error",
    agentsActive: (n, total) => `${n}/${total} agents active`,
    activityTitle: "Team activity charts (who worked recently)",
    activity: "📊 Activity",
    v2Title: "Go to Team v2 page (work in progress)",
    starting: "Starting...",
    stopping: "Stopping...",
    start: "Start",
    stop: "Stop",
    footerHint: "Auto refresh every 5s · Click an agent emoji for details",
  },
  es: {
    online: (name) => `${name} está en línea`,
    stopped: (name) => `${name} detenido`,
    agentCmdError: "Error al ejecutar el comando del agente",
    startSent:
      "Comando Iniciar enviado — esperando confirmación del contenedor…",
    teamStartError: "Error al iniciar el equipo",
    stopSent:
      "Comando Detener enviado — esperando confirmación del contenedor…",
    teamStopError: "Error al detener el equipo",
    agentsActive: (n, total) => `${n}/${total} agentes activos`,
    activityTitle:
      "Gráficos de actividad del equipo (quién trabajó recientemente)",
    activity: "📊 Actividad",
    v2Title: "Ir a la página Equipo v2 (en desarrollo)",
    starting: "Iniciando...",
    stopping: "Deteniendo...",
    start: "Iniciar",
    stop: "Detener",
    footerHint:
      "Actualización automática cada 5s · Haz clic en el emoji de un agente para ver detalles",
  },
  fr: {
    online: (name) => `${name} est en ligne`,
    stopped: (name) => `${name} arrêté`,
    agentCmdError: "Erreur d'exécution de la commande de l'agent",
    startSent:
      "Commande Démarrer envoyée — en attente de confirmation du conteneur…",
    teamStartError: "Erreur de démarrage de l'équipe",
    stopSent:
      "Commande Arrêter envoyée — en attente de confirmation du conteneur…",
    teamStopError: "Erreur d'arrêt de l'équipe",
    agentsActive: (n, total) => `${n}/${total} agents actifs`,
    activityTitle:
      "Graphiques d'activité de l'équipe (qui a travaillé récemment)",
    activity: "📊 Activité",
    v2Title: "Aller à la page Équipe v2 (en cours)",
    starting: "Démarrage...",
    stopping: "Arrêt...",
    start: "Démarrer",
    stop: "Arrêter",
    footerHint:
      "Actualisation automatique toutes les 5 s · Cliquez sur l'emoji d'un agent pour les détails",
  },
  de: {
    online: (name) => `${name} ist online`,
    stopped: (name) => `${name} gestoppt`,
    agentCmdError: "Fehler bei der Ausführung des Agentenbefehls",
    startSent: "Start-Befehl gesendet — warte auf Container-Bestätigung…",
    teamStartError: "Fehler beim Team-Start",
    stopSent: "Stopp-Befehl gesendet — warte auf Container-Bestätigung…",
    teamStopError: "Fehler beim Team-Stopp",
    agentsActive: (n, total) => `${n}/${total} Agenten aktiv`,
    activityTitle: "Aktivitätsdiagramme des Teams (wer zuletzt gearbeitet hat)",
    activity: "📊 Aktivität",
    v2Title: "Zur Team-v2-Seite (in Arbeit)",
    starting: "Wird gestartet...",
    stopping: "Wird gestoppt...",
    start: "Starten",
    stop: "Stoppen",
    footerHint:
      "Automatische Aktualisierung alle 5 s · Klicke auf das Emoji eines Agenten für Details",
  },
  hu: {
    online: (name) => `${name} online`,
    stopped: (name) => `${name} leállítva`,
    agentCmdError: "Hiba az ügynök parancsának végrehajtásakor",
    startSent:
      "Indítás parancs elküldve — várakozás a konténer megerősítésére…",
    teamStartError: "Hiba a csapat indításakor",
    stopSent:
      "Leállítás parancs elküldve — várakozás a konténer megerősítésére…",
    teamStopError: "Hiba a csapat leállításakor",
    agentsActive: (n, total) => `${n}/${total} ügynök aktív`,
    activityTitle: "Csapat tevékenység diagramok (ki dolgozott nemrég)",
    activity: "📊 Tevékenység",
    v2Title: "Ugrás a Csapat v2 oldalra (folyamatban)",
    starting: "Indítás...",
    stopping: "Leállítás...",
    start: "Indítás",
    stop: "Leállítás",
    footerHint:
      "Automatikus frissítés 5 mp-enként · Kattints egy ügynök emojijára a részletekért",
  },
  pt: {
    online: (name) => `${name} está online`,
    stopped: (name) => `${name} parado`,
    agentCmdError: "Erro na execução do comando do agente",
    startSent: "Comando Iniciar enviado — aguardando confirmação do contêiner…",
    teamStartError: "Erro ao iniciar a equipe",
    stopSent: "Comando Parar enviado — aguardando confirmação do contêiner…",
    teamStopError: "Erro ao parar a equipe",
    agentsActive: (n, total) => `${n}/${total} agentes ativos`,
    activityTitle:
      "Gráficos de atividade da equipe (quem trabalhou recentemente)",
    activity: "📊 Atividade",
    v2Title: "Ir para a página Equipe v2 (em desenvolvimento)",
    starting: "Iniciando...",
    stopping: "Parando...",
    start: "Iniciar",
    stop: "Parar",
    footerHint:
      "Atualização automática a cada 5s · Clique no emoji de um agente para ver detalhes",
  },
};

/* ── Componenti ───────────────────────────────────────────────────── */

function Spinner({
  size = 14,
  color = "#ffc107",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="spinner-rotate"
      style={{ display: "inline-block", verticalAlign: "middle" }}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Pagina ────────────────────────────────────────────────────────── */

export default function TeamPage() {
  const { toast } = useToast();
  const t = T[useLocale()];
  const isCloud = useIsCloud();
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>(() => {
    const init: Record<string, AgentStatus> = {};
    AGENTS.forEach((a) => {
      init[a.id] = "stopped";
    });
    return init;
  });
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const prevStatusesRef = useRef<Record<string, AgentStatus> | null>(null);

  // Assistente vive sempre (lifecycle legato al container Desktop, non
  // ai pulsanti Start/Stop all del team). Lo escludiamo dai conteggi
  // e dalle azioni bulk altrimenti il contatore resta inchiodato a 1
  // anche dopo uno Stop all "riuscito".
  const TEAM_AGENTS = AGENTS.filter((a) => a.id !== "assistente");
  const activeCount = TEAM_AGENTS.filter(
    (a) => statuses[a.id] === "running",
  ).length;

  /* ── Fetch status ────────────────────────────────────────────── */

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();

      // Se la response NON è ok (rate-limit 429, 500 server error, auth
      // 401), `data.agents` è undefined e il fallback `?? 'stopped'`
      // farebbe diventare TUTTI gli agenti "stopped" → toast falsi
      // "Agent stopped" anche se gli agenti girano benissimo. Non
      // toccare lo stato in questo caso: la prossima chiamata che
      // riesce ricostruisce verità.
      if (!res.ok || !Array.isArray(data?.agents)) {
        return;
      }
      const agentList: { id: string; status: string }[] = data.agents;

      // Compute next fuori dall'updater: chiamare `toast()` dentro
      // un updater di setState triggera React warning "Cannot update
      // ToastProvider while rendering TeamPage" perché React può
      // rigiocare la callback durante il render. Stato + effetto
      // esterno (toast) vanno tenuti separati.
      const next: Record<string, AgentStatus> = {};
      AGENTS.forEach((a) => {
        const found = agentList.find((x) => x.id === a.id);
        next[a.id] = (found?.status as AgentStatus) ?? "stopped";
      });

      const prevRef = prevStatusesRef.current;
      if (prevRef) {
        AGENTS.forEach((a) => {
          const was = prevRef[a.id];
          const now = next[a.id];
          if (was === now) return;
          if (was !== "running" && now === "running") {
            toast(t.online(a.name), "success", 3000);
          } else if (was === "running" && now === "stopped") {
            toast(t.stopped(a.name), "warning", 3000);
          }
        });
      }
      prevStatusesRef.current = next;
      setStatuses(next);
    } catch {
      /* ignore */
    }
  }, [toast, t]);

  /* ── Polling ─────────────────────────────────────────────────── */

  useEffect(() => {
    fetchStatus();
    // Su cloud niente polling continuo: una fetch all'apertura basta, il
    // resto è on-demand. In locale resta il teatro live del team.
    if (isCloud) return;
    // 15s invece di 5s: orgchart status non cambia spesso, riduce req/min
    // sul rate limit globale. Realtime via useTeamState copre i cambi
    // is_running ad alta frequenza (es. click Start/Stop).
    const interval = setInterval(fetchStatus, 15_000);
    return () => clearInterval(interval);
  }, [fetchStatus, isCloud]);

  /* ── Start/Stop ──────────────────────────────────────────────── */

  const agentActionCmd = useTeamCommandPoller();

  const handleAction = (agentId: string, action: "start" | "stop") => {
    setActionTarget(agentId);
    if (action === "start") {
      setStatuses((prev) => ({ ...prev, [agentId]: "pending" }));
    }
    agentActionCmd.run("/api/agents", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, action }),
    });
  };

  useEffect(() => {
    if (agentActionCmd.state === "done" || agentActionCmd.state === "local") {
      fetchStatus();
      setActionTarget(null);
    } else if (
      agentActionCmd.state === "error" ||
      agentActionCmd.state === "timeout"
    ) {
      toast(
        typeof agentActionCmd.error === "string" && agentActionCmd.error
          ? agentActionCmd.error
          : t.agentCmdError,
        "error",
        6000,
      );
      setActionTarget(null);
    }
  }, [agentActionCmd.state, agentActionCmd.error, fetchStatus, toast, t]);

  // actionLoading retrocompat: i bottoni leggono questo per disabilitarsi.
  const actionLoading: string | null =
    agentActionCmd.state === "posting" ||
    agentActionCmd.state === "pending" ||
    agentActionCmd.state === "running"
      ? actionTarget
      : null;

  /* ── Azioni bulk via team_state desired-state ────────────────── */

  // 2026-05-23 cutover: i bottoni Start/Stop scrivono `should_run` su
  // team_state. Il reconciler `cloud team-state-listen` nel container
  // converge eseguendo `jht team start|stop`. UI feedback in 3 fasi:
  // 1) posting       → PATCH /api/team-state in volo
  // 2) waiting       → should_run cambiato ma container non ha ancora
  //                    aggiornato is_running (5-10s nel caso peggiore)
  // 3) settled       → is_running riflette should_run → bottone idle
  // Realtime hook useTeamState mantiene state aggiornato senza polling.
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = (await createBrowserSupabase().auth.getUser()) as {
        data: { user: { id: string } | null } | null;
        error: { message: string } | null;
      };
      if (cancelled) return;
      setUserId(res.data?.user?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const teamState = useTeamState(userId);
  const [bulkPosting, setBulkPosting] = useState<"start" | "stop" | null>(null);

  const startAll = async () => {
    setBulkPosting("start");
    setStatuses((prev) => {
      const next = { ...prev };
      TEAM_AGENTS.forEach((a) => {
        if (next[a.id] !== "running") next[a.id] = "pending";
      });
      return next;
    });
    try {
      await teamState.start();
      toast(t.startSent, "success", 3000);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : t.teamStartError,
        "error",
        6000,
      );
    } finally {
      setBulkPosting(null);
    }
  };

  const stopAll = async () => {
    setBulkPosting("stop");
    try {
      await teamState.stop();
      toast(t.stopSent, "success", 3000);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : t.teamStopError,
        "error",
        6000,
      );
    } finally {
      setBulkPosting(null);
    }
  };

  // bulkLoading retrocompat: i bottoni leggono questa var per disabilitarsi.
  // Combina HTTP in-flight (bulkPosting) + waiting reconciler convergence
  // (desired ≠ observed) per UX coerente "Start grigio finché il team
  // è effettivamente partito".
  const bulkLoading: "start" | "stop" | null = (() => {
    if (bulkPosting) return bulkPosting;
    if (!teamState.state) return null;
    const { should_run, is_running } = teamState.state;
    if (should_run && !is_running) return "start";
    if (!should_run && is_running) return "stop";
    return null;
  })();

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      <style>{`
        @keyframes spinner-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spinner-rotate { animation: spinner-rotate 0.8s linear infinite; }
      `}</style>

      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              Job Hunter Team
            </h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {t.agentsActive(activeCount, TEAM_AGENTS.length)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/team/attivita"
              className="px-2.5 py-1.5 rounded-md text-[10px] tracking-wide no-underline transition-colors"
              style={{
                background: "transparent",
                color: "var(--color-muted)",
                border: "1px solid var(--color-border)",
                fontFamily: "inherit",
              }}
              title={t.activityTitle}
            >
              {t.activity}
            </Link>
            <Link
              href="/team/v2"
              className="px-2.5 py-1.5 rounded-md text-[10px] tracking-wide no-underline transition-colors"
              style={{
                background: "transparent",
                color: "var(--color-muted)",
                border: "1px dashed var(--color-border)",
                fontFamily: "inherit",
              }}
              title={t.v2Title}
            >
              v2 →
            </Link>
            {/* Team running state derivato da team_state (Realtime), con
                fallback ad activeCount per Local PC mode senza cloud sync.
                [JHT-DASHBOARD-SPLIT] start/stop = CONTROLLO → solo desktop. Sul
                cloud la pagina resta (monitoraggio read-only) ma i comandi spariscono. */}
            {isCloud !== true &&
              (() => {
                const teamRunning =
                  teamState.state?.should_run === true ||
                  teamState.state?.is_running === true ||
                  activeCount > 0;
                return (
                  <>
                    {!teamRunning && (
                      <button
                        onClick={startAll}
                        disabled={bulkLoading !== null}
                        className="px-4 py-2 rounded-lg text-[11px] font-semibold tracking-wide transition-all"
                        style={{
                          background:
                            bulkLoading !== null
                              ? "var(--color-border)"
                              : "rgba(34,197,94,0.1)",
                          color:
                            bulkLoading !== null
                              ? "var(--color-dim)"
                              : "#22c55e",
                          border: `1px solid ${bulkLoading !== null ? "var(--color-border)" : "rgba(34,197,94,0.25)"}`,
                          cursor:
                            bulkLoading !== null ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                          minWidth: 110,
                        }}
                      >
                        {bulkLoading === "start" ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Spinner size={11} color="var(--color-dim)" />{" "}
                            {t.starting}
                          </span>
                        ) : (
                          "\u25B6 " + t.start
                        )}
                      </button>
                    )}
                    {teamRunning && (
                      <button
                        onClick={stopAll}
                        disabled={bulkLoading !== null}
                        className="px-4 py-2 rounded-lg text-[11px] font-semibold tracking-wide transition-all"
                        style={{
                          background:
                            bulkLoading !== null
                              ? "var(--color-border)"
                              : "rgba(244,67,54,0.08)",
                          color:
                            bulkLoading !== null
                              ? "var(--color-dim)"
                              : "#f44336",
                          border: `1px solid ${bulkLoading !== null ? "var(--color-border)" : "rgba(244,67,54,0.2)"}`,
                          cursor:
                            bulkLoading !== null ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                          minWidth: 110,
                        }}
                      >
                        {bulkLoading === "stop" ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Spinner size={11} color="var(--color-dim)" />{" "}
                            {t.stopping}
                          </span>
                        ) : (
                          <>
                            {"\u25A0"} {t.stop}
                          </>
                        )}
                      </button>
                    )}
                  </>
                );
              })()}
          </div>
        </div>
      </div>

      {/* Org chart */}
      <section className="py-10">
        <div className="mx-auto w-full max-w-[1080px]">
          <TeamOrgChart
            agents={Object.fromEntries(
              AGENTS.map((a) => [
                a.id,
                {
                  status: statuses[a.id] ?? "stopped",
                  color: a.color,
                  link: a.link,
                  role: a.role,
                },
              ]),
            )}
            onAction={isCloud === true ? undefined : handleAction}
            actionLoading={actionLoading}
          />
        </div>
      </section>

      {/* Rate budget chart */}
      <section className="py-10 border-t border-[var(--color-border)]">
        <div className="mx-auto w-full max-w-[900px]">
          <UsageChart />
        </div>
      </section>

      {/* Token per agente */}
      <section className="py-10 border-t border-[var(--color-border)]">
        <div className="mx-auto w-full max-w-[900px]">
          <AgentTokensChart />
        </div>
      </section>

      {/* Per-Scrittore cost (own + critic spawnato, RULE C-11) */}
      <section className="py-10 border-t border-[var(--color-border)]">
        <div className="mx-auto w-full max-w-[900px]">
          <WriterCriticBreakdown />
        </div>
      </section>

      {/* Throttle per agente */}
      <section className="py-10 border-t border-[var(--color-border)]">
        <div className="mx-auto w-full max-w-[900px]">
          <ThrottleChart />
        </div>
      </section>

      {/* Attività agenti — rate + throttle combinati */}
      <section className="py-10 border-t border-[var(--color-border)]">
        <div className="mx-auto w-full max-w-[900px]">
          <AgentActivityChart />
        </div>
      </section>

      {/* 👨‍⚕️ Dottore — health-check ogni 30min, ping/diagnosi/restart */}
      <section className="py-10 border-t border-[var(--color-border)]">
        <div className="mx-auto w-full max-w-[900px]">
          <DoctorPanel />
        </div>
      </section>

      {/* Rate budget + cumulativo token (gemello del primo grafico, con
           sovrapposizione dei kT del team sull'asse Y destro per validare
           la correlazione visivamente). Max-width più ampio per dare aria. */}
      <section className="py-10 border-t border-[var(--color-border)]">
        <div className="mx-auto w-full max-w-[1200px]">
          <UsageTokensChart />
        </div>
      </section>

      {/* Distribuzione consumo token per agente — pie + widget media. */}
      <section className="py-10 border-t border-[var(--color-border)]">
        <div className="mx-auto w-full max-w-[900px]">
          <TokenBreakdown />
        </div>
      </section>

      {/* Composizione consumo per tipo di token (input/output/cache). */}
      <section className="py-10 border-t border-[var(--color-border)]">
        <div className="mx-auto w-full max-w-[1200px]">
          <TokenTypesChart />
        </div>
      </section>

      {/* Footer hint */}
      <div className="mt-6 pt-4 border-t border-[var(--color-border)] text-center">
        <p className="text-[10px] text-[var(--color-dim)]">{t.footerHint}</p>
      </div>
    </div>
  );
}
