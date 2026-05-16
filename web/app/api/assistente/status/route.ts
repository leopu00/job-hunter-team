import { NextResponse } from "next/server";
import { runBash } from "@/lib/shell";
import { isLocalRequest } from "@/lib/auth";
import { inferAgentActiveFromBus } from "@/lib/team-bus";

export const dynamic = "force-dynamic";

export async function GET() {
  // Su Vercel (no tmux) deduciamo l'active state dallo storico del bus
  // team_commands. Il polling UI così vede subito "ATTIVO" dopo che il
  // subscriber sulla VPS ha completato il start, senza dover prendere
  // info da una /tmux che non esiste sul cloud.
  if (!(await isLocalRequest())) {
    const inferred = await inferAgentActiveFromBus("assistente");
    if (!inferred) {
      return NextResponse.json({ active: false, output: "", remote: true });
    }
    return NextResponse.json({
      active: inferred.active,
      output: "",
      remote: true,
    });
  }
  try {
    const { stdout: sessions } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""',
    );
    const active = sessions
      .trim()
      .split("\n")
      .some((s) => s.trim() === "ASSISTENTE");

    if (!active) {
      return NextResponse.json({ active: false, output: "" });
    }

    const { stdout: output } = await runBash(
      'tmux capture-pane -t "ASSISTENTE" -p -S -200 2>/dev/null || echo ""',
    );

    return NextResponse.json({ active: true, output });
  } catch {
    return NextResponse.json({ active: false, output: "" });
  }
}
