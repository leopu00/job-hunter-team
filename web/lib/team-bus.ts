import { NextResponse } from "next/server";
import { isLocalRequest } from "./auth";

/**
 * Quando un endpoint shell legacy (es. /api/assistente/start) viene
 * chiamato da prod cloud (jobhunterteam.ai su Vercel), il filesystem è
 * read-only e tmux/bash non esistono: l'esecuzione diretta crasha. Il
 * design lockato (vedi docs/internal/team-commands-bus.md) è che le
 * richieste cloud vanno dispatchate al bus `team_commands` e il
 * subscriber sulla VPS le esegue dentro al container.
 *
 * `enqueueIfRemote` è il bivio: se la request è local (desktop launcher
 * apre /api/... su localhost) ritorna null e il caller esegue shell come
 * sempre; se la request arriva da cloud, inserisce una riga in
 * team_commands e ritorna la response al client.
 *
 * Action enum: start | stop | restart. Target supportati: vedi
 * /api/team/command/route.ts (VALID_TARGETS).
 */
export async function enqueueIfRemote(
  action: "start" | "stop" | "restart",
  target: string,
): Promise<NextResponse | null> {
  if (await isLocalRequest()) return null;

  // WEB-READONLY (2026-06-20): il controllo del team (start/stop/restart) si fa
  // SOLO dall'app desktop. Niente piu' dispatch al bus team_commands da cloud:
  // dal browser e' sola visualizzazione → 403 read_only. Ritiro del path cloud
  // interattivo (design 2026-06-15). `action`/`target` restano in firma per
  // compatibilita' coi caller esistenti, ma non vengono piu' accodati.
  void action;
  void target;
  return NextResponse.json(
    {
      ok: false,
      error: "read_only",
      message:
        "Il controllo del team si fa dall'app desktop. Dal browser è sola visualizzazione.",
    },
    { status: 403 },
  );
}

/**
 * Variante per endpoint desktop-only (terminal native, backup tar): non
 * c'è dispatch sensato al bus, perché aprire un terminale nativo o
 * generare un tarball richiede filesystem locale. Restituisce 403 chiaro
 * se chiamata da cloud.
 */
export async function blockIfRemote(
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
