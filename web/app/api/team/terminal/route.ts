import { NextRequest, NextResponse } from "next/server";
import { runBash } from "@/lib/shell";
import { isLocalRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VALID_SESSION = /^[A-Z][A-Z0-9_-]*$/i;

export async function GET(req: NextRequest) {
  const session = req.nextUrl.searchParams.get("session") ?? "";
  if (!VALID_SESSION.test(session)) {
    return NextResponse.json({ error: "invalid session" }, { status: 400 });
  }
  if (!(await isLocalRequest())) {
    // Su Vercel cloud non c'e' un tmux server: ritorniamo subito.
    // Cache-Control private + max-age=4 evita che il polling client (5s
    // con backoff) finisca per invocare la function 1:1: il browser
    // riusa la response cached per 4s, scarichi metà invocations.
    // stale-while-revalidate=30: anche se la response e' "old", il
    // browser la mostra subito e revalida in background per 30s.
    return NextResponse.json(
      { output: "", remote: true },
      {
        headers: {
          "cache-control": "private, max-age=4, stale-while-revalidate=30",
        },
      },
    );
  }

  try {
    const { stdout } = await runBash(
      `tmux capture-pane -t "${session}" -p -S -200 2>/dev/null || echo ""`,
    );
    // Cache lato browser solo 2s: vogliamo freshness sul terminal attivo
    // (utente vede agente che scrive), ma evitiamo refresh a raffica se
    // qualcosa va storto sul client.
    return NextResponse.json(
      { output: stdout },
      { headers: { "cache-control": "private, max-age=2" } },
    );
  } catch {
    return NextResponse.json({ output: "" });
  }
}
