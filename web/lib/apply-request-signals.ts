import { createClient } from "@/lib/supabase/server";
import { isLocalRequest } from "@/lib/auth";
import { activeDemoPersona } from "@/lib/demo/mode";
import {
  getWorkspacePath,
  isSupabaseConfigured,
  workspaceHasDb,
} from "@/lib/workspace";
import {
  getApplyRequestSignalsLocal,
  getWebSendsRecentLocal,
} from "@/lib/local-queries";
import { AUTOMATED_APPLIED_VIA, WEB_ORIGIN } from "@/lib/apply-web-cap";
import type { ApplyRequestSignals } from "@/lib/apply-request-rule";

/**
 * [JHT-CLOSER] I segnali del bottone «candidati»: l'ultima domanda del CLOSER
 * sulla posizione (entrambe le sponde) e il checkpoint del flow (solo box).
 * Stessa scelta di sponda di `getPositionById`: box acceso → jobs.db,
 * altrimenti Supabase. Un errore di lettura degrada a «nessun segnale», che il
 * bottone mostra come «autorizzata», mai come «inviata».
 */
export async function getApplyRequestSignals(
  id: string,
): Promise<ApplyRequestSignals> {
  const none: ApplyRequestSignals = { closerQuestion: null, checkpoint: null };
  if (await activeDemoPersona()) return none;
  if (await isLocalRequest()) {
    const ws = await getWorkspacePath();
    if (ws && workspaceHasDb(ws)) {
      try {
        return getApplyRequestSignalsLocal(ws, id);
      } catch {
        return none;
      }
    }
  }
  if (!isSupabaseConfigured) return none;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pending_user_messages")
    .select("id, body, created_at, user_reply")
    .eq("agent", "closer")
    .eq("kind", "question")
    .eq("related_position_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return none;
  return {
    closerQuestion: {
      id: String(data.id),
      body: data.body,
      created_at: data.created_at,
      user_reply: data.user_reply ?? null,
    },
    checkpoint: null,
  };
}

/**
 * [JHT-CLOSER] Gli istanti delle candidature automatiche partite negli ultimi due giorni la cui
 * autorizzazione l'ha data il sito: servono a dire se il tetto di oggi è pieno (`lib/apply-web-cap.ts`).
 * Due giorni e non uno: «oggi» è il giorno locale dell'utente, e il server non lo sa. Illeggibile = nessun
 * istante: la pagina dice «autorizzata», mai «in coda per domani».
 */
export async function getWebSendsRecent(): Promise<string[]> {
  if (await activeDemoPersona()) return [];
  if (await isLocalRequest()) {
    const ws = await getWorkspacePath();
    if (ws && workspaceHasDb(ws)) {
      try {
        return getWebSendsRecentLocal(ws);
      } catch {
        return [];
      }
    }
  }
  if (!isSupabaseConfigured) return [];
  const since = Date.now() - 2 * 24 * 3600 * 1000;
  try {
    const supabase = await createClient();
    // Two plain reads, so the window is exactly right and the schema census reads every column:
    // 1. the user's automated sends of the last two days (a cancelled application does not count);
    const sent = await supabase
      .from("applications")
      .select("position_id, applied_at")
      .eq("applied", true)
      .in("applied_via", [...AUTOMATED_APPLIED_VIA])
      .is("deleted_at", null)
      .gte("applied_at", new Date(since).toISOString())
      .limit(100);
    if (sent.error || !Array.isArray(sent.data)) return [];
    const recent = (sent.data as Array<Record<string, unknown>>).filter(
      (row) =>
        typeof row.position_id === "string" &&
        typeof row.applied_at === "string" &&
        !Number.isNaN(Date.parse(row.applied_at)),
    );
    if (recent.length === 0) return [];
    // 2. which of those positions the website authorised: the only ones that use its cap. Asked by id, so
    //    it does not depend on how many positions the user has or on which was touched last.
    const ids = [...new Set(recent.map((row) => row.position_id as string))];
    const web = await supabase
      .from("positions")
      .select("id")
      .in("id", ids)
      .eq("apply_requested_by", WEB_ORIGIN)
      .limit(ids.length);
    if (web.error || !Array.isArray(web.data)) return [];
    const byWeb = new Set(
      (web.data as Array<Record<string, unknown>>).map((row) => row.id),
    );
    return recent
      .filter((row) => byWeb.has(row.position_id))
      .map((row) => row.applied_at as string);
  } catch {
    return [];
  }
}
