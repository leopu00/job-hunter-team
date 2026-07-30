import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/team-state/auth";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

const DESIRED_FIELDS = [
  "should_run",
  "agents_enabled",
  "restart_token",
  "last_user_activity_at",
  // Rendezvous "Sync now" ([JHT-DATA-SYNC] fase 3): il browser (anche cloud)
  // scrive sync_requested_at per chiedere alla VPS un push fresco on-demand.
  // NON è un'azione di controllo (non avvia/ferma il team) → resta consentita
  // dal cloud anche quando il control bus verrà reso read-only (web-readonly d1).
  "sync_requested_at",
  // [JHT-CHAT-UNIFY] Gemello di sync_requested_at per la chat: il browser lo
  // timbra quando l'utente manda un messaggio a un agente, il daemon lo vede
  // nel giro veloce (~5s) — la stessa riga che legge già — e va a prendersi i
  // turni non consegnati. Non è controllo del team: scrivibile anche dal cloud.
  "chat_requested_at",
] as const;

// [JHT-WEB-READONLY] d1 — sottoinsieme di DESIRED che sono COMANDI al team
// (avvia/ferma/abilita/riavvia). Sul cloud il bus di controllo desired è
// read-only: questi campi NON sono scrivibili dal browser (il controllo passa
// solo da desktop/tunnel SSH). Gli altri DESIRED restano scrivibili dal cloud:
// `sync_requested_at` (Sync-now, vincolo i) e `last_user_activity_at` (presence,
// non è controllo). Il ramo token/device (OBSERVED) NON è MAI toccato qui.
const DESIRED_CONTROL_FIELDS: readonly string[] = [
  "should_run",
  "agents_enabled",
  "restart_token",
];
const OBSERVED_FIELDS = [
  "is_running",
  "last_heartbeat_at",
  "last_restart_token",
  "last_error",
  "last_error_at",
  "last_action",
  "last_action_at",
  // Il daemon VPS (source=token) marca sync_completed_at dopo aver pushato in
  // risposta a una sync_requested_at → il browser lo vede e fa UN refetch.
  "sync_completed_at",
  // Il box marca chat_delivered_at dopo aver consegnato i turni al pane
  // dell'agente: chiude il rendezvous di chat_requested_at.
  "chat_delivered_at",
] as const;

type DesiredField = (typeof DESIRED_FIELDS)[number];
type ObservedField = (typeof OBSERVED_FIELDS)[number];

export async function GET(req: NextRequest) {
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  const { userId, supabase } = resolved.user;

  const { data, error } = await supabase
    .from("team_state")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return sanitizedError(error, { status: 500, scope: "team-state" });
  return NextResponse.json({ state: data ?? null });
}

export async function PATCH(req: NextRequest) {
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  const { source, userId, supabase } = resolved.user;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  let allowed: readonly string[] =
    source === "token" ? OBSERVED_FIELDS : DESIRED_FIELDS;

  // [JHT-WEB-READONLY] d1 — sul cloud il ramo browser/session NON può scrivere i
  // comandi al team (should_run/agents_enabled/restart_token): restano i soli
  // DESIRED non-controllo (sync_requested_at, last_user_activity_at). Il ramo
  // token (device-sync, OBSERVED) NON è toccato → il push della VPS resta intatto.
  if (source !== "token" && isCloudDeploy()) {
    allowed = DESIRED_FIELDS.filter((f) => !DESIRED_CONTROL_FIELDS.includes(f));
  }

  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) update[key as DesiredField | ObservedField] = body[key];
  }

  const rejected = Object.keys(body).filter(
    (k) => !(allowed as readonly string[]).includes(k),
  );
  if (rejected.length > 0) {
    return NextResponse.json(
      {
        error: `Campi non scrivibili da source=${source}: ${rejected.join(", ")}`,
      },
      { status: 403 },
    );
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "Nessun campo da aggiornare" },
      { status: 400 },
    );
  }

  // [JHT-SYNC-UX] `sync_requested_at` è un rendezvous confrontato con
  // `sync_completed_at` scritto dalla VPS: se arrivasse l'orologio del
  // BROWSER (skew arbitrario sulle macchine utente) la richiesta potrebbe
  // risultare "già servita" e il Sync now non fare mai nulla. Timbro lato
  // server; per il client il valore è solo un trigger.
  if (source !== "token" && "sync_requested_at" in update) {
    update.sync_requested_at = new Date().toISOString();
  }
  // Stessa ragione per il rendezvous di chat: il confronto è con
  // `chat_delivered_at` scritto dal box, l'orologio del browser non entra.
  if (source !== "token" && "chat_requested_at" in update) {
    update.chat_requested_at = new Date().toISOString();
  }

  if (typeof update.agents_enabled !== "undefined") {
    if (
      typeof update.agents_enabled !== "object" ||
      Array.isArray(update.agents_enabled) ||
      update.agents_enabled === null
    ) {
      return NextResponse.json(
        { error: "agents_enabled deve essere un oggetto JSON" },
        { status: 400 },
      );
    }
  }

  // Single-team enforcement: solo il device active può scrivere observed.
  // Browser (session) può sempre scrivere desired (un utente loggato è la
  // fonte di verità del desired, indipendentemente da quale device sta
  // runnando). Token non-active viene rifiutato per non sporcare lo stato.
  if (source === "token") {
    const tsCheck = (await supabase
      .from("team_state")
      .select("active_device_id")
      .eq("user_id", userId)
      .maybeSingle()) as {
      data: { active_device_id: string | null } | null;
      error: { message: string } | null;
    };
    if (
      tsCheck.data &&
      tsCheck.data.active_device_id &&
      tsCheck.data.active_device_id !== resolved.user.token.tokenId
    ) {
      return NextResponse.json(
        {
          error: "not_active_device",
          message:
            "Questo device non è più il team attivo. PATCH observed rifiutata: " +
            'fai POST /api/team-state/claim {"force":true} per riprendere il controllo.',
          active_device_id: tsCheck.data.active_device_id,
        },
        { status: 409 },
      );
    }
  }

  const { data, error } = await supabase
    .from("team_state")
    .upsert({ user_id: userId, ...update }, { onConflict: "user_id" })
    .select()
    .single();

  if (error) return sanitizedError(error, { status: 500, scope: "team-state" });
  return NextResponse.json({ state: data });
}
