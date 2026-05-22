import { NextResponse } from "next/server";
import { runBash } from "@/lib/shell";
import { isLocalRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Job Hunter agent definitions (session prefix → display info)
const JH_AGENTS: Record<
  string,
  { role: string; emoji: string; color: string; maxInstances: number }
> = {
  CAPITANO: {
    role: "Capitano",
    emoji: "👨‍✈️",
    color: "#ff9100",
    maxInstances: 1,
  },
  SCOUT: { role: "Scout", emoji: "🕵️", color: "#2196f3", maxInstances: 3 },
  ANALISTA: {
    role: "Analista",
    emoji: "🔬",
    color: "#00e676",
    maxInstances: 2,
  },
  SCORER: { role: "Scorer", emoji: "📊", color: "#b388ff", maxInstances: 3 },
  SCRITTORE: {
    role: "Scrittore",
    emoji: "✍️",
    color: "#ffd600",
    maxInstances: 3,
  },
  CRITICO: { role: "Critico", emoji: "⚖️", color: "#f44336", maxInstances: 1 },
  SENTINELLA: {
    role: "Sentinella",
    emoji: "🛡️",
    color: "#607d8b",
    maxInstances: 1,
  },
};

function getAgentInfo(session: string) {
  const s = session.toUpperCase();
  for (const [prefix, info] of Object.entries(JH_AGENTS)) {
    if (s === prefix || s.startsWith(`${prefix}-`)) {
      return { ...info, session };
    }
  }
  return null;
}

export async function GET() {
  if (!(await isLocalRequest())) {
    // Cloud: inferisco active per ogni agente dallo storico team_commands.
    // Per ogni target (capitano/scout/...) o per 'all', l'ultimo done con
    // action='start' significa attivo, 'stop' significa inattivo.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ agents: [], isLocalhost: false, remote: true });
    }
    const { data: cmds } = await supabase
      .from("team_commands")
      .select("action, payload, processed_at")
      .eq("user_id", user.id)
      .eq("status", "done")
      .order("processed_at", { ascending: false })
      .limit(50);
    const lastFor: Record<string, "start" | "stop"> = {};
    for (const c of cmds || []) {
      const target = String((c.payload as { target?: string })?.target ?? "all").toLowerCase();
      const act = c.action === "start" ? "start" : c.action === "stop" ? "stop" : null;
      if (!act) continue;
      if (target === "all") {
        // team-wide: setta tutti gli agenti che non hanno già un override più recente
        for (const k of Object.keys(JH_AGENTS)) {
          if (!lastFor[k.toLowerCase()]) lastFor[k.toLowerCase()] = act;
        }
      } else if (!lastFor[target]) {
        lastFor[target] = act;
      }
    }
    const agents = Object.entries(JH_AGENTS).map(([prefix, info]) => ({
      ...info,
      session: prefix,
      active: lastFor[prefix.toLowerCase()] === "start",
    }));
    // Cache 10s: lo stato active si infersce dallo storico team_commands
    // (ultimo Start/Stop). Cambia raramente: 10s di cache browser sono
    // accettabili per UX e tagliano significativamente Function
    // Invocations Vercel + roundtrip Postgres.
    return NextResponse.json(
      { agents, isLocalhost: false, remote: true },
      {
        headers: {
          "cache-control": "private, max-age=10, stale-while-revalidate=60",
        },
      },
    );
  }
  try {
    const { stdout } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""',
    );
    const sessions = stdout.trim().split("\n").filter(Boolean);

    const agents = sessions
      .map((s) => getAgentInfo(s))
      .filter(Boolean)
      .map((a) => ({ ...a, active: true }));

    // Locale: cache 3s. tmux list-sessions e' veloce ma il polling
    // dashboard (5s default post-fix 542a94f2) puo' comunque trarne
    // beneficio se l'utente naviga tra schede.
    return NextResponse.json(
      { agents, isLocalhost: true },
      { headers: { "cache-control": "private, max-age=3" } },
    );
  } catch {
    return NextResponse.json({ agents: [], isLocalhost: false });
  }
}
