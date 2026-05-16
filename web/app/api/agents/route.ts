/**
 * API Route — /api/agents
 *
 * GET  → lista agenti con stato (running/stopped)
 * POST → start o stop di un agente specifico
 */

import { NextRequest, NextResponse } from "next/server";
import { runBash } from "@/lib/shell";
import { requireAuth, isLocalRequest } from "@/lib/auth";
import { enqueueIfRemote } from "@/lib/team-bus";
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({
        agents: AGENTS.map((a) => ({ ...a, status: "stopped", instances: 0 })),
        remote: true,
      });
    }
    const [{ data: cmds }, activity] = await Promise.all([
      supabase
        .from("team_commands")
        .select("action, payload, processed_at")
        .eq("user_id", user.id)
        .eq("status", "done")
        .order("processed_at", { ascending: false })
        .limit(50),
      inferRemoteActivity(supabase),
    ]);
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

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body non valido" }, { status: 400 });
  }

  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
  const action = typeof body.action === "string" ? body.action.trim() : "";

  if (!agentId || !action) {
    return NextResponse.json(
      { error: "agentId e action obbligatori" },
      { status: 400 },
    );
  }

  if (action !== "start" && action !== "stop") {
    return NextResponse.json(
      { error: 'action deve essere "start" o "stop"' },
      { status: 400 },
    );
  }

  // Validazione: solo ID noti (previene injection)
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) {
    return NextResponse.json(
      { error: `Agente sconosciuto: ${agentId}` },
      { status: 404 },
    );
  }

  // Cloud dispatch: la dashboard prod chiama questo endpoint da Vercel
  // (no tmux). Inoltriamo al bus team_commands con target=agent.id; il
  // subscriber sulla VPS esegue `jht team start/stop <agent>`. Local: shell.
  const remote = await enqueueIfRemote(
    action as "start" | "stop",
    agent.id,
  );
  if (remote) return remote;

  const active = await activeSessions();
  const running =
    active.has(agent.session) ||
    Array.from(active).some((s) => s.startsWith(`${agent.session}-`));

  if (action === "start" && running) {
    return NextResponse.json({
      ok: true,
      message: "Agente già attivo",
      status: "running",
    });
  }

  if (action === "stop" && !running) {
    return NextResponse.json({
      ok: true,
      message: "Agente già fermo",
      status: "stopped",
    });
  }

  // Stop: invia SIGTERM alla sessione tmux
  if (action === "stop") {
    try {
      await runBash(`tmux send-keys -t "${agent.session}" C-c`);
      return NextResponse.json({
        ok: true,
        message: "Stop inviato",
        status: "stopping",
      });
    } catch {
      return NextResponse.json(
        { error: "Errore durante lo stop" },
        { status: 500 },
      );
    }
  }

  // Start: info — il lancio effettivo è gestito dal setup.sh o dal team manager
  return NextResponse.json({
    ok: true,
    message: `Avvio agente ${agent.name} richiesto. Usa "jht team start ${agent.id}" dalla CLI.`,
    status: "pending",
  });
}
