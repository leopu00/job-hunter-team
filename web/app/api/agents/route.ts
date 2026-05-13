/**
 * API Route — /api/agents
 *
 * GET  → lista agenti con stato (running/stopped)
 * POST → start o stop di un agente specifico
 */

import { NextRequest, NextResponse } from "next/server";
import { runBash } from "@/lib/shell";
import { requireAuth } from "@/lib/auth";

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

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
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
