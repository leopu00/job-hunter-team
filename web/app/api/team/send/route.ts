import { NextRequest, NextResponse } from "next/server";
import { runBash } from "@/lib/shell";
import { requireAuth, requireLocalWrite } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VALID_SESSION = /^[A-Z][A-Z0-9_-]*$/i;

export async function POST(req: NextRequest) {
  const ro = await requireLocalWrite();
  if (ro) return ro;
  const authError = await requireAuth();
  if (authError) return authError;

  const { session, message } = await req.json();
  if (!VALID_SESSION.test(session ?? "")) {
    return NextResponse.json({ error: "invalid session" }, { status: 400 });
  }
  if (typeof message !== "string" || message.length > 1000) {
    return NextResponse.json({ error: "invalid message" }, { status: 400 });
  }

  // Consegna via jht-tmux-send, MAI `tmux send-keys` a mano. send-keys esce 0
  // appena la sessione esiste: non dice nulla su cosa abbia fatto la TUI, e
  // rispondere ok:true su quel codice significa mostrare all'utente un
  // messaggio "inviato" che l'agente non ha mai letto. Il wrapper aspetta che
  // il pane sia libero, verifica che il testo sia comparso e ricontrolla che
  // il turno sia partito; i suoi exit code distinguono i modi di fallire.
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const args = `${q(session)} ${q(message)}`;
  try {
    await runBash(
      `if command -v jht-tmux-send >/dev/null 2>&1; then jht-tmux-send ${args}; ` +
        `else /app/agents/_skills/tmux-send/jht-tmux-send ${args}; fi`,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Ogni stato ha una risposta diversa perché all'utente serve sapere se
    // deve riprovare (occupato), aspettare uno sblocco (muto) o smettere.
    const code = (err as { code?: number }).code;
    switch (code) {
      case 2:
        return NextResponse.json(
          { error: "session not active" },
          { status: 404 },
        );
      case 3:
        return NextResponse.json(
          { error: "agent unresponsive", retryable: false },
          { status: 502 },
        );
      case 4:
        return NextResponse.json(
          { error: "agent busy", retryable: true },
          { status: 503 },
        );
      case 5:
        return NextResponse.json(
          { error: "agent stuck: message not submitted", retryable: true },
          { status: 503 },
        );
      default:
        return NextResponse.json({ error: "send failed" }, { status: 500 });
    }
  }
}
