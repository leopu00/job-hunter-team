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
    // The positions the website authorised, with their application, newest first. The rest (sent, by an
    // automated channel, in the last two days) is decided here: a filter on a column of the embedded
    // application would be a dotted column name the schema census cannot read.
    const { data, error } = await supabase
      .from("positions")
      .select(
        "apply_requested_by, applications(applied, applied_at, applied_via)",
      )
      .eq("apply_requested_by", WEB_ORIGIN)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error || !Array.isArray(data)) return [];
    const sends: string[] = [];
    for (const row of data as Array<{ applications?: unknown }>) {
      const apps = Array.isArray(row.applications)
        ? row.applications
        : row.applications
          ? [row.applications]
          : [];
      for (const app of apps as Array<Record<string, unknown>>) {
        if (app.applied !== true) continue;
        if (
          typeof app.applied_via !== "string" ||
          !AUTOMATED_APPLIED_VIA.includes(app.applied_via)
        ) {
          continue;
        }
        if (typeof app.applied_at !== "string") continue;
        const at = Date.parse(app.applied_at);
        if (Number.isNaN(at) || at < since) continue;
        sends.push(app.applied_at);
      }
    }
    return sends;
  } catch {
    return [];
  }
}
