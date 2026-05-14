import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  createSnapshot,
  deleteServer,
  getHetznerToken,
  resolveServerId,
  waitAction,
} from "@/lib/hetzner";

export const dynamic = "force-dynamic";
// Snapshot di un disco 80GB Hetzner puo' richiedere 2-4 minuti. Vercel
// Hobby plan cappa a 300s — alziamo al massimo consentito. In pratica
// uno snapshot Hetzner standard sta sotto i 5min; se eccede il client
// puo' ri-pollare lo stato dopo timeout.
export const maxDuration = 300;

/**
 * Bottone "📸 Snapshot + Elimina VPS" del lifecycle dashboard
 * (docs/internal/vps.md § "Lifecycle e shutdown UX").
 *
 * Flow:
 *  1. Crea snapshot del server via Hetzner API.
 *  2. Polla l'action snapshot finche' `status === 'success'`.
 *  3. Solo allora distrugge il server (fattura si ferma).
 *
 * Costo dopo: ~€0.10/mo per storage snapshot. Riprendi: ricrea VPS
 * dallo snapshot in ~90s (out-of-scope di questa route, gestito dal
 * desktop launcher).
 *
 * Why "wait snapshot prima di delete": se cancellassimo subito, lo
 * snapshot fallirebbe e perderemmo TUTTI i dati. L'utente preme
 * "Snapshot+Elimina" PROPRIO per preservare i dati — meglio fallire
 * la richiesta che eliminare senza backup.
 */
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const token = getHetznerToken();
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Hetzner token non configurato. Setta HCLOUD_TOKEN (o JHT_HETZNER_API_TOKEN) " +
          "in environment, oppure usa il portale Hetzner per fare lo snapshot e " +
          "distruggere il server manualmente.",
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
  const serverId = resolved.id;

  // Descrizione snapshot: timestamp + hint sorgente. La rilegge il
  // restore flow per mostrare "ripristina da snapshot del ...".
  let description = `jht-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    const body = (await req.json().catch(() => null)) as {
      description?: string;
    } | null;
    if (body?.description && typeof body.description === "string") {
      const sanitized = body.description
        .slice(0, 100)
        .replace(/[^a-zA-Z0-9 _.\-:]/g, "");
      if (sanitized) description = sanitized;
    }
  } catch {
    /* body opzionale */
  }

  const snap = await createSnapshot(token, serverId, description);
  if (!snap.ok) {
    return NextResponse.json(
      { ok: false, stage: "snapshot-create", error: snap.error },
      { status: snap.status },
    );
  }

  const snapAction = snap.data.action;
  const snapImage = snap.data.image;
  const wait = await waitAction(token, snapAction.id);
  if (!wait.ok) {
    return NextResponse.json(
      {
        ok: false,
        stage: "snapshot-wait",
        error: wait.error,
        snapshotImageId: snapImage.id,
      },
      { status: wait.status },
    );
  }
  if (wait.data.action.status !== "success") {
    return NextResponse.json(
      {
        ok: false,
        stage: "snapshot-wait",
        error: wait.data.action.error?.message || "snapshot fallito",
        snapshotImageId: snapImage.id,
      },
      { status: 500 },
    );
  }

  // Snapshot completato → safe to delete. Hetzner ferma di fatturare
  // dal momento dell'action delete (anche se il poll dell'action puo'
  // richiedere altri 5-10s a passare success).
  const del = await deleteServer(token, serverId);
  if (!del.ok) {
    return NextResponse.json(
      {
        ok: false,
        stage: "delete-server",
        error: del.error,
        snapshotImageId: snapImage.id,
      },
      { status: del.status },
    );
  }

  return NextResponse.json({
    ok: true,
    action: "snapshot-destroy",
    snapshotImageId: snapImage.id,
    snapshotDescription: description,
    deleteActionId: del.data.action.id,
  });
}
