/**
 * API Route — /api/agents
 *
 * GET → lista agenti con stato (running/stopped)
 *
 * Solo lettura. Lo start/stop di un agente è `POST /api/agents/[id]` (guardato da
 * `requireLocalWrite`); la POST che stava qui (JHT-T25) mandava C-c alla sessione
 * o accodava un comando al team con il solo `requireAuth`, senza che nessuno la
 * chiamasse, ed è stata tolta.
 */

import { NextResponse } from "next/server";
import { runBash } from "@/lib/shell";
import { requireAuth, isLocalRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Agenti JHT con le relative sessioni tmux
const AGENTS = [
  { id: "capitano", name: "Capitano", session: "CAPITANO" },
  { id: "sentinella", name: "Sentinella", session: "SENTINELLA" },
  { id: "scout", name: "Scout", session: "SCOUT" },
  { id: "analista", name: "Analista", session: "ANALISTA" },
  { id: "scorer", name: "Scorer", session: "SCORER" },
  { id: "scrittore", name: "Scrittore", session: "SCRITTORE" },
  { id: "critico", name: "Critico", session: "CRITICO" },
  { id: "assistente", name: "Assistente", session: "ASSISTENTE" },
];

const REMOTE_ACTIVITY_ACTIVE_MS = 30 * 60 * 1000;
type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

/** Set delle sessioni tmux attive (una sola chiamata shell per GET). */
async function activeSessions(): Promise<Set<string>> {
  try {
    const { stdout } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || true',
    );
    return new Set(
      stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

async function latestTimestamp(
  supabase: SupabaseLike,
  table: string,
  column: string,
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .not(column, "is", null)
      .order(column, { ascending: false })
      .limit(1);
    if (error) return null;
    const row = Array.isArray(data)
      ? (data[0] as Record<string, unknown>)
      : null;
    const ts = typeof row?.[column] === "string" ? row[column] : null;
    if (!ts) return null;
    const ms = Date.parse(ts);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

async function inferRemoteActivity(supabase: SupabaseLike) {
  const [scout, analista, scorer, scrittore, critico] = await Promise.all([
    latestTimestamp(supabase, "positions", "found_at"),
    latestTimestamp(supabase, "positions", "last_checked"),
    latestTimestamp(supabase, "scores", "scored_at"),
    latestTimestamp(supabase, "applications", "written_at"),
    latestTimestamp(supabase, "applications", "critic_reviewed_at"),
  ]);
  const activity: Record<string, number | null> = {
    scout,
    analista,
    scorer,
    scrittore,
    critico,
  };

  const pipelineActivity = Object.values(activity).filter(
    (v): v is number => typeof v === "number",
  );
  activity.capitano =
    pipelineActivity.length > 0 ? Math.max(...pipelineActivity) : null;
  return activity;
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  // Su cloud (Vercel) tmux non esiste: deduco lo stato dagli ultimi
  // team_commands e, quando il team e' stato avviato direttamente sulla VPS,
  // dall'attivita' recente sincronizzata nel DB Supabase.
  if (!(await isLocalRequest())) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({
        agents: AGENTS.map((a) => ({ ...a, status: "stopped", instances: 0 })),
        remote: true,
      });
    }
    // Source-of-truth post-refactor 2026-05-23: team_state.is_running scritto
    // dal reconciler container. Se team_state esiste, deduco da quello.
    // Fallback su team_commands legacy quando team_state è null (es. utenti
    // pre-refactor che non hanno ancora rebuilded il container).
    const tsRes = (await supabase
      .from("team_state")
      .select("is_running, agents_enabled, last_action_at")
      .eq("user_id", user.id)
      .maybeSingle()) as {
      data: {
        is_running: boolean | null;
        agents_enabled: Record<string, { enabled?: boolean }> | null;
        last_action_at: string | null;
      } | null;
      error: { message: string } | null;
    };

    const activity = await inferRemoteActivity(supabase);

    if (tsRes.data) {
      // team_state c'è → autoritativo
      const teamRunning = !!tsRes.data.is_running;
      const enabledMap = tsRes.data.agents_enabled || {};
      const agents = AGENTS.map((a) => {
        const entry = enabledMap[a.id];
        // Se agents_enabled è popolato, rispettalo per-agente; altrimenti
        // segui il global is_running.
        const enabled =
          entry?.enabled !== undefined ? entry.enabled : teamRunning;
        const running = teamRunning && enabled;
        const activityAt = activity[a.id];
        return {
          ...a,
          status: running ? "running" : "stopped",
          instances: running ? 1 : 0,
          last_activity_at: activityAt
            ? new Date(activityAt).toISOString()
            : null,
        };
      });
      return NextResponse.json({ agents, remote: true });
    }

    // Fallback legacy team_commands
    const { data: cmds } = await supabase
      .from("team_commands")
      .select("action, payload, processed_at")
      .eq("user_id", user.id)
      .eq("status", "done")
      .order("processed_at", { ascending: false })
      .limit(50);
    const lastFor: Record<
      string,
      { action: "start" | "stop"; processedAt: number }
    > = {};
    for (const c of cmds || []) {
      const target = String(
        (c.payload as { target?: string })?.target ?? "all",
      ).toLowerCase();
      const act =
        c.action === "start" ? "start" : c.action === "stop" ? "stop" : null;
      if (!act) continue;
      const processedAt = c.processed_at ? Date.parse(c.processed_at) : 0;
      if (target === "all") {
        for (const a of AGENTS) {
          if (!lastFor[a.id]) lastFor[a.id] = { action: act, processedAt };
        }
      } else if (!lastFor[target]) {
        lastFor[target] = { action: act, processedAt };
      }
    }
    const agents = AGENTS.map((a) => ({
      ...a,
      ...(() => {
        const cmd = lastFor[a.id];
        const activityAt = activity[a.id];
        const hasFreshActivity =
          typeof activityAt === "number" &&
          Date.now() - activityAt <= REMOTE_ACTIVITY_ACTIVE_MS;
        const activityAfterCommand =
          hasFreshActivity && (!cmd || activityAt > cmd.processedAt);
        const running =
          cmd?.action === "start" || activityAfterCommand ? true : false;
        return {
          status: running ? "running" : "stopped",
          instances: running ? 1 : 0,
          last_activity_at: activityAt
            ? new Date(activityAt).toISOString()
            : null,
        };
      })(),
    }));
    return NextResponse.json({ agents, remote: true });
  }
  const active = await activeSessions();
  const agents = AGENTS.map((agent) => {
    // Conta le istanze attive: il nome esatto della sessione oppure i
    // suffissi numerici usati dal Capitano quando spawna più istanze:
    //   - `-<n>`     standard (SCOUT-1, ANALISTA-2)
    //   - `-S<n>`    convenzione speciale che compare per i critici
    //                (CRITICO-S1, CRITICO-S2). Va riconosciuta perché
    //                altrimenti il critico non viene mai contato.
    // Restano fuori i worker accessori non numerici come
    // SENTINELLA-WORKER (un thread di servizio, non un'istanza extra).
    const instanceRe = new RegExp(`^${agent.session}-S?\\d+$`);
    const instances = Array.from(active).filter(
      (s) => s === agent.session || instanceRe.test(s),
    ).length;
    return {
      ...agent,
      status: instances > 0 ? "running" : "stopped",
      instances,
    };
  });
  return NextResponse.json({ agents });
}
