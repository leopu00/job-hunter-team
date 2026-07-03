"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import TeamOrgChart from "./_components/TeamOrgChart";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

type RelativeTime = {
  now: string;
  m: (n: number) => string;
  h: (n: number) => string;
  d: (n: number) => string;
  mo: (n: number) => string;
};

const T: Record<
  Locale,
  {
    rt: RelativeTime;
    dashboard: string;
    team: string;
    backToV1: string;
    latestPositions: string;
    mostRecent: (n: number) => string;
    noData: string;
    loadingLower: string;
    colUpdated: string;
    colStatus: string;
    colSource: string;
    colActor: string;
    colCompany: string;
    colScore: string;
    colVoto: string;
    colTitle: string;
    colLocation: string;
    colSalary: string;
    colRemote: string;
    colFoundAt: string;
    noPositionsYet: string;
    loading: string;
  }
> = {
  it: {
    rt: {
      now: "adesso",
      m: (n) => `${n}m fa`,
      h: (n) => `${n}h fa`,
      d: (n) => `${n}g fa`,
      mo: (n) => `${n}me fa`,
    },
    dashboard: "Dashboard",
    team: "Team",
    backToV1: "Torna alla pagina Team v1",
    latestPositions: "Ultime posizioni",
    mostRecent: (n) => `${n} più recenti`,
    noData: "Nessun dato",
    loadingLower: "Caricamento…",
    colUpdated: "Aggiornato",
    colStatus: "Stato",
    colSource: "Fonte",
    colActor: "Attore",
    colCompany: "Azienda",
    colScore: "Score",
    colVoto: "Voto",
    colTitle: "Titolo",
    colLocation: "Località",
    colSalary: "Stipendio",
    colRemote: "Remote",
    colFoundAt: "Trovata il",
    noPositionsYet: "Nessuna posizione ancora.",
    loading: "Caricamento…",
  },
  en: {
    rt: {
      now: "now",
      m: (n) => `${n}m ago`,
      h: (n) => `${n}h ago`,
      d: (n) => `${n}d ago`,
      mo: (n) => `${n}mo ago`,
    },
    dashboard: "Dashboard",
    team: "Team",
    backToV1: "Back to Team v1 page",
    latestPositions: "Latest positions",
    mostRecent: (n) => `${n} most recent`,
    noData: "no data",
    loadingLower: "loading…",
    colUpdated: "Updated",
    colStatus: "Status",
    colSource: "Source",
    colActor: "Actor",
    colCompany: "Company",
    colScore: "Score",
    colVoto: "Score",
    colTitle: "Title",
    colLocation: "Location",
    colSalary: "Salary",
    colRemote: "Remote",
    colFoundAt: "Found at",
    noPositionsYet: "No positions yet.",
    loading: "Loading…",
  },
  es: {
    rt: {
      now: "ahora",
      m: (n) => `hace ${n}m`,
      h: (n) => `hace ${n}h`,
      d: (n) => `hace ${n}d`,
      mo: (n) => `hace ${n} mes${n === 1 ? "" : "es"}`,
    },
    dashboard: "Panel",
    team: "Equipo",
    backToV1: "Volver a la página Equipo v1",
    latestPositions: "Últimas posiciones",
    mostRecent: (n) => `${n} más recientes`,
    noData: "Sin datos",
    loadingLower: "Cargando…",
    colUpdated: "Actualizado",
    colStatus: "Estado",
    colSource: "Fuente",
    colActor: "Actor",
    colCompany: "Empresa",
    colScore: "Score",
    colVoto: "Nota",
    colTitle: "Título",
    colLocation: "Ubicación",
    colSalary: "Salario",
    colRemote: "Remoto",
    colFoundAt: "Encontrada el",
    noPositionsYet: "Aún no hay posiciones.",
    loading: "Cargando…",
  },
  fr: {
    rt: {
      now: "maintenant",
      m: (n) => `il y a ${n} min`,
      h: (n) => `il y a ${n} h`,
      d: (n) => `il y a ${n} j`,
      mo: (n) => `il y a ${n} mois`,
    },
    dashboard: "Tableau de bord",
    team: "Équipe",
    backToV1: "Retour à la page Équipe v1",
    latestPositions: "Derniers postes",
    mostRecent: (n) => `${n} plus récents`,
    noData: "Aucune donnée",
    loadingLower: "Chargement…",
    colUpdated: "Mis à jour",
    colStatus: "Statut",
    colSource: "Source",
    colActor: "Acteur",
    colCompany: "Entreprise",
    colScore: "Score",
    colVoto: "Note",
    colTitle: "Titre",
    colLocation: "Lieu",
    colSalary: "Salaire",
    colRemote: "À distance",
    colFoundAt: "Trouvée le",
    noPositionsYet: "Aucun poste pour l'instant.",
    loading: "Chargement…",
  },
  de: {
    rt: {
      now: "jetzt",
      m: (n) => `vor ${n} Min.`,
      h: (n) => `vor ${n} Std.`,
      d: (n) => `vor ${n} Tg.`,
      mo: (n) => `vor ${n} Mon.`,
    },
    dashboard: "Dashboard",
    team: "Team",
    backToV1: "Zurück zur Team-v1-Seite",
    latestPositions: "Neueste Positionen",
    mostRecent: (n) => `${n} neueste`,
    noData: "Keine Daten",
    loadingLower: "Wird geladen…",
    colUpdated: "Aktualisiert",
    colStatus: "Status",
    colSource: "Quelle",
    colActor: "Akteur",
    colCompany: "Unternehmen",
    colScore: "Score",
    colVoto: "Note",
    colTitle: "Titel",
    colLocation: "Standort",
    colSalary: "Gehalt",
    colRemote: "Remote",
    colFoundAt: "Gefunden am",
    noPositionsYet: "Noch keine Positionen.",
    loading: "Wird geladen…",
  },
  hu: {
    rt: {
      now: "most",
      m: (n) => `${n} perce`,
      h: (n) => `${n} órája`,
      d: (n) => `${n} napja`,
      mo: (n) => `${n} hónapja`,
    },
    dashboard: "Irányítópult",
    team: "Csapat",
    backToV1: "Vissza a Csapat v1 oldalra",
    latestPositions: "Legutóbbi pozíciók",
    mostRecent: (n) => `${n} legutóbbi`,
    noData: "Nincs adat",
    loadingLower: "Betöltés…",
    colUpdated: "Frissítve",
    colStatus: "Állapot",
    colSource: "Forrás",
    colActor: "Szereplő",
    colCompany: "Cég",
    colScore: "Score",
    colVoto: "Pontszám",
    colTitle: "Cím",
    colLocation: "Helyszín",
    colSalary: "Fizetés",
    colRemote: "Távmunka",
    colFoundAt: "Megtalálva",
    noPositionsYet: "Még nincs pozíció.",
    loading: "Betöltés…",
  },
  pt: {
    rt: {
      now: "agora",
      m: (n) => `há ${n}m`,
      h: (n) => `há ${n}h`,
      d: (n) => `há ${n}d`,
      mo: (n) => `há ${n} mês${n === 1 ? "" : "es"}`,
    },
    dashboard: "Painel",
    team: "Equipe",
    backToV1: "Voltar à página Equipe v1",
    latestPositions: "Últimas vagas",
    mostRecent: (n) => `${n} mais recentes`,
    noData: "Sem dados",
    loadingLower: "Carregando…",
    colUpdated: "Atualizado",
    colStatus: "Status",
    colSource: "Fonte",
    colActor: "Ator",
    colCompany: "Empresa",
    colScore: "Score",
    colVoto: "Nota",
    colTitle: "Título",
    colLocation: "Local",
    colSalary: "Salário",
    colRemote: "Remoto",
    colFoundAt: "Encontrada em",
    noPositionsYet: "Ainda não há vagas.",
    loading: "Carregando…",
  },
};

type AgentStatus = "running" | "stopped" | "pending";

const COLORS: Record<string, string> = {
  capitano: "#ff9100",
  sentinella: "#9c27b0",
  scout: "#2196f3",
  analista: "#00e676",
  scorer: "#b388ff",
  scrittore: "#ffd600",
  critico: "#f44336",
};

type AgentInfo = { status: AgentStatus; instances: number };

type RecentPosition = {
  id: string;
  legacy_id?: number | null;
  title: string;
  company: string;
  location?: string | null;
  status: string;
  source?: string | null;
  score?: number | null;
  found_at: string;
  found_by?: string | null;
  last_checked?: string | null;
  scored_at?: string | null;
  last_action_at?: string;
  last_action_by?: string;
  last_action_actor?: string;
  voto?: number | null;
  url?: string | null;
  remote_type?: string | null;
  salary_declared_min?: number | null;
  salary_declared_max?: number | null;
};

const AGENT_BADGE_COLOR: Record<string, string> = {
  scout: "#2196f3",
  analista: "#00e676",
  scorer: "#b388ff",
  scrittore: "#ffd600",
  critico: "#f44336",
  user: "#94a3b8",
};

const AGENT_BADGE_LABEL: Record<string, string> = {
  scout: "Scout",
  analista: "Analyst",
  scorer: "Scorer",
  scrittore: "Writer",
  critico: "Critic",
  user: "User",
};

const STATUS_COLORS: Record<string, string> = {
  new: "#94a3b8",
  checked: "#38bdf8",
  excluded: "#475569",
  scored: "#a78bfa",
  writing: "#f59e0b",
  review: "#fb923c",
  ready: "#34d399",
  applied: "#22c55e",
  response: "#facc15",
};

function formatRelative(iso: string, rt: RelativeTime): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return rt.now;
  const min = Math.floor(diff / 60_000);
  if (min < 60) return rt.m(min);
  const h = Math.floor(min / 60);
  if (h < 24) return rt.h(h);
  const d = Math.floor(h / 24);
  if (d < 30) return rt.d(d);
  const mo = Math.floor(d / 30);
  return rt.mo(mo);
}

// Orario preciso (HH:MM:SS se oggi, altrimenti YYYY-MM-DD HH:MM) +
// tempo trascorso tra parentesi. Risolve l'ambiguità di "2h ago" che
// raggruppa righe trovate in momenti diversi nello stesso slot.
function formatFoundAt(iso: string, rt: RelativeTime): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const head = sameDay
    ? time
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${head} (${formatRelative(iso, rt)})`;
}

export default function TeamV2Page() {
  const t = T[useLocale()];
  const isCloud = useIsCloud();
  const [info, setInfo] = useState<Record<string, AgentInfo>>({});
  const [recent, setRecent] = useState<RecentPosition[]>([]);
  const [recentLoaded, setRecentLoaded] = useState(false);
  const [dbWriteSignal, setDbWriteSignal] = useState<{
    agent: string;
    key: number;
  } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data?.agents)) return;
      const next: Record<string, AgentInfo> = {};
      for (const a of data.agents as {
        id: string;
        status: string;
        instances?: number;
      }[]) {
        next[a.id] = {
          status: (a.status as AgentStatus) ?? "stopped",
          instances:
            typeof a.instances === "number"
              ? a.instances
              : a.status === "running"
                ? 1
                : 0,
        };
      }
      setInfo(next);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/positions/recent?limit=15");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.positions)) {
        setRecent(data.positions as RecentPosition[]);
        setRecentLoaded(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    if (isCloud) return;
    const timer = setInterval(fetchStatus, 3000);
    return () => clearInterval(timer);
  }, [fetchStatus, isCloud]);

  useEffect(() => {
    fetchRecent();
    if (isCloud) return;
    // Le posizioni nuove arrivano dagli Scout — refresh più rilassato
    // dello status agenti, evita di spammare la query DB.
    const timer = setInterval(fetchRecent, 10_000);
    return () => clearInterval(timer);
  }, [fetchRecent, isCloud]);

  // Polling /api/db/recent-writes per individuare quale agente ha
  // appena scritto. Quando un timestamp avanza rispetto all'ultimo
  // visto, emettiamo un signal verso TeamOrgChart (agent + key che si
  // incrementa) e forziamo un refresh della tabella così la nuova
  // riga appare in cima.
  useEffect(() => {
    let cancelled = false;
    const lastSeen = new Map<string, string>();
    let counter = 0;
    let firstFetch = true;

    const poll = async () => {
      try {
        const res = await fetch("/api/db/recent-writes");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const writes: Record<string, string | null> = data?.writes ?? {};
        for (const [agent, ts] of Object.entries(writes)) {
          if (!ts) continue;
          const prev = lastSeen.get(agent);
          if (prev === ts) continue;
          lastSeen.set(agent, ts);
          // Salta il primo fetch: prendiamo lo snapshot, NON animiamo
          // tutto quello che era già nel DB al mount.
          if (firstFetch) continue;
          counter += 1;
          setDbWriteSignal({ agent, key: counter });
          // Refresh tabella subito così la riga aggiornata risale.
          fetchRecent();
        }
        firstFetch = false;
      } catch {
        /* ignore */
      }
    };

    poll();
    if (isCloud) {
      return () => {
        cancelled = true;
      };
    }
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fetchRecent, isCloud]);

  const agentMeta = Object.fromEntries(
    Object.entries(COLORS).map(([id, color]) => [
      id,
      {
        status: info[id]?.status ?? "stopped",
        instances: info[id]?.instances ?? 0,
        color,
        role: id,
        link: `/team/${id}`,
      },
    ]),
  ) as Record<
    string,
    {
      status: AgentStatus;
      instances: number;
      color: string;
      role: string;
      link: string;
    }
  >;

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
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
            v2
          </span>
        </nav>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              Job Hunter Team — v2
            </h1>
          </div>
          <Link
            href="/team"
            className="px-2.5 py-1.5 rounded-md text-[10px] tracking-wide no-underline transition-colors"
            style={{
              background: "transparent",
              color: "var(--color-muted)",
              border: "1px dashed var(--color-border)",
              fontFamily: "inherit",
            }}
            title={t.backToV1}
          >
            ← v1
          </Link>
        </div>
      </div>

      <section className="py-12">
        <div className="mx-auto w-full max-w-[1080px]">
          <TeamOrgChart
            hideStopped
            agents={agentMeta}
            dbWriteSignal={dbWriteSignal}
          />
        </div>
      </section>

      <section className="pt-6 pb-12 border-t border-[var(--color-border)]">
        <div className="mx-auto w-full max-w-[1280px]">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[12px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              {t.latestPositions}
            </h2>
            <span className="text-[10px] text-[var(--color-dim)]">
              {recent.length > 0
                ? t.mostRecent(recent.length)
                : recentLoaded
                  ? t.noData
                  : t.loadingLower}
            </span>
          </div>

          <div
            className="rounded-md border border-[var(--color-border)] overflow-x-auto"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <table
              className="text-[11px]"
              style={{
                borderCollapse: "collapse",
                minWidth: 1400,
                width: "100%",
              }}
            >
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[var(--color-dim)]">
                  <th className="px-3 py-2 font-normal whitespace-nowrap">
                    {t.colUpdated}
                  </th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap">
                    {t.colStatus}
                  </th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap">
                    {t.colSource}
                  </th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap">
                    {t.colActor}
                  </th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap">
                    {t.colCompany}
                  </th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap text-right">
                    {t.colScore}
                  </th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap text-right">
                    {t.colVoto}
                  </th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap">
                    {t.colTitle}
                  </th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap">
                    {t.colLocation}
                  </th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap">
                    {t.colSalary}
                  </th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap">
                    {t.colRemote}
                  </th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap">
                    {t.colFoundAt}
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr>
                    <td
                      colSpan={12}
                      className="px-3 py-6 text-center text-[var(--color-dim)]"
                    >
                      {recentLoaded ? t.noPositionsYet : t.loading}
                    </td>
                  </tr>
                ) : (
                  recent.map((p) => {
                    const statusColor = STATUS_COLORS[p.status] ?? "#94a3b8";
                    const actor =
                      p.last_action_actor ?? p.last_action_by ?? "scout";
                    const updatedAt = p.last_action_at ?? p.found_at;
                    const salary = (() => {
                      const lo = p.salary_declared_min;
                      const hi = p.salary_declared_max;
                      if (
                        typeof lo === "number" &&
                        typeof hi === "number" &&
                        (lo || hi)
                      ) {
                        return `${lo.toLocaleString()}–${hi.toLocaleString()}`;
                      }
                      return "—";
                    })();
                    return (
                      <tr
                        key={p.id}
                        className="border-t border-[var(--color-border)] hover:bg-[rgba(255,255,255,0.03)]"
                      >
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--color-dim)] font-mono tabular-nums">
                          {formatFoundAt(updatedAt, t.rt)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className="inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide"
                            style={{
                              background: `${statusColor}22`,
                              color: statusColor,
                              border: `1px solid ${statusColor}55`,
                            }}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)]">
                          {p.source ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)] font-mono">
                          {actor}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-muted)]">
                          <div
                            className="truncate max-w-[180px]"
                            title={p.company}
                          >
                            {p.company}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-bright)] font-mono tabular-nums">
                          {typeof p.score === "number" ? p.score : "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-bright)] font-mono tabular-nums">
                          {typeof p.voto === "number" ? p.voto.toFixed(1) : "—"}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-bright)]">
                          <div
                            className="truncate max-w-[380px]"
                            title={p.title}
                          >
                            {p.title}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[var(--color-muted)]">
                          <div
                            className="truncate max-w-[200px]"
                            title={p.location ?? ""}
                          >
                            {p.location ?? "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)] font-mono tabular-nums">
                          {salary}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--color-dim)]">
                          {p.remote_type ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--color-dim)] font-mono tabular-nums">
                          {p.found_at ? formatFoundAt(p.found_at, t.rt) : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
