import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { deleteServer, getHetznerToken, resolveServerId } from "@/lib/hetzner";

export const dynamic = "force-dynamic";

/**
 * Bottone "💀 Termina VPS" del lifecycle dashboard
 * (docs/internal/vps.md § "Companycycle e shutdown UX").
 *
 * Quando: "ho trovato lavoro, fine job-hunt". Costo dopo: €0.
 * Riprendi: from scratch (rifare wizard).
 *
 * Differenza con `/api/vps/snapshot-destroy`:
 *  - snapshot-destroy: crea snapshot prima → si puo' ricreare la VPS
 *    dallo snapshot in 90s. Costo storage ~€0.10/mo.
 *  - terminate: NON crea snapshot → riprende from scratch. Costo zero.
 *
 * Il backup dei dati locali (`~/.jht/`, `~/Documents/JHT/`) e' gia'
 * sincronizzato in cloud (vedi `cloud-sync/push/route.ts`) e su disco
 * dell'utente — questa route si limita a distruggere il server, non
 * tocca i dati.
 *
 * Conferma esplicita: il client invia `{ confirm: 'TERMINATE' }` nel
 * body. Senza, rispondiamo 400. Evita destroy accidentali da curl o
 * da redirect XSS (anche se la CSRF guard del proxy ci protegge gia').
 */
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  let body: { confirm?: string } | null = null;
  try {
    body = (await req.json()) as { confirm?: string };
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: 'body JSON obbligatorio: { "confirm": "TERMINATE" }',
      },
      { status: 400 },
    );
  }
  if (body?.confirm !== "TERMINATE") {
    return NextResponse.json(
      {
        ok: false,
        error: 'campo "confirm" deve valere "TERMINATE" per procedere',
      },
      { status: 400 },
    );
  }

  const token = getHetznerToken();
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Hetzner token non configurato. Setta HCLOUD_TOKEN (o JHT_HETZNER_API_TOKEN) " +
          "in environment, oppure usa il portale Hetzner per distruggere il server.",
      },
      { status: 503 },
    );
  }

  const resolved = await resolveServerId(token);
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.error },
      { status: resolved.status },
    );
  }

  const del = await deleteServer(token, resolved.id);
  if (!del.ok) {
    return NextResponse.json(
      { ok: false, stage: "delete-server", error: del.error },
      { status: del.status },
    );
  }

  return NextResponse.json({
    ok: true,
    action: "terminate",
    serverId: resolved.id,
    deleteActionId: del.data.action.id,
  });
}
