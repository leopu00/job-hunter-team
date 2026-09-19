import { createClient } from "@/lib/supabase/server";
import { isLocalRequest } from "@/lib/auth";
import { activeDemoPersona } from "@/lib/demo/mode";
import {
  getWorkspacePath,
  isSupabaseConfigured,
  workspaceHasDb,
} from "@/lib/workspace";
import { getApplyRequestSignalsLocal } from "@/lib/local-queries";
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
