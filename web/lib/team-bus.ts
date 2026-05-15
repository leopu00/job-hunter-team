import { NextResponse } from "next/server";
import { isLocalRequest } from "./auth";
import { createClient } from "./supabase/server";

/**
 * Quando un endpoint shell legacy (es. /api/assistente/start) viene
 * chiamato da prod cloud (jobhunterteam.ai su Vercel), il filesystem è
 * read-only e tmux/bash non esistono: l'esecuzione diretta crasha. Il
 * design lockato (vedi docs/internal/team-commands-bus.md) è che le
 * richieste cloud vanno dispatchate al bus `team_commands` e il
 * subscriber sulla VPS le esegue dentro al container.
 *
 * `enqueueIfCompany` è il bivio: se la request è local (desktop launcher
 * apre /api/... su localhost) ritorna null e il caller esegue shell come
 * sempre; se la request arriva da cloud, inserisce una riga in
 * team_commands e ritorna la response al client.
 *
 * Action enum: start | stop | restart. Target supportati: vedi
 * /api/team/command/route.ts (VALID_TARGETS).
 */
export async function enqueueIfCompany(
  action: "start" | "stop" | "restart",
  target: string,
): Promise<NextResponse | null> {
  if (await isLocalRequest()) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "cloud dispatch richiede login Supabase: apri la dashboard da web e accedi",
      },
      { status: 401 },
    );
  }

  const { data, error } = await supabase
    .from("team_commands")
    .insert({
      user_id: user.id,
      action,
      payload: { target },
    })
    .select("id, status, requested_at")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: `dispatch al bus fallito: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    queued: true,
    message: `Comando inoltrato alla VPS (action=${action}, target=${target}). Riprova fra qualche secondo.`,
    command: data,
  });
}

/**
 * Variante per endpoint desktop-only (terminal native, backup tar): non
 * c'è dispatch sensato al bus, perché aprire un terminale nativo o
 * generare un tarball richiede filesystem locale. Restituisce 403 chiaro
 * se chiamata da cloud.
 */
export async function blockIfCompany(
  hint: string,
): Promise<NextResponse | null> {
  if (await isLocalRequest()) return null;
  return NextResponse.json(
    {
      ok: false,
      error: "operation unavailable on cloud deployment",
      hint,
    },
    { status: 403 },
  );
}

/**
 * Per endpoint GET status che fanno tmux ls / capture-pane / docker
 * inspect: invece di crashare su Vercel (no tmux/docker), ritornano uno
 * stato neutro che le UI possono visualizzare senza errori console.
 */
export async function remoteStatusStub<T>(
  stub: T,
): Promise<NextResponse | null> {
  if (await isLocalRequest()) return null;
  return NextResponse.json({ ok: true, remote: true, status: "unknown", ...stub });
}
