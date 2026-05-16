import { NextResponse } from "next/server";
import { runBash } from "@/lib/shell";
import { isLocalRequest } from "@/lib/auth";
import { inferAgentActiveFromBus } from "@/lib/team-bus";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isLocalRequest())) {
    const inferred = await inferAgentActiveFromBus("sentinella");
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
      .some((s) => s.trim() === "SENTINELLA");

    if (!active) {
      return NextResponse.json({ active: false, output: "" });
    }

    const { stdout: output } = await runBash(
      'tmux capture-pane -t "SENTINELLA" -p -S -200 2>/dev/null || echo ""',
    );

    return NextResponse.json({ active: true, output });
  } catch {
    return NextResponse.json({ active: false, output: "" });
  }
}
