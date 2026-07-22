// [JHT-WEB-DEMO] Segnale "l'utente ha già dati sincronizzati sul cloud":
// pilota il promemoria "Collega il tuo team" (UserMenu/Impostazioni) e il
// redirect al wizard /welcome. Query NON demo-aware di proposito: anche in
// demo il conteggio deve guardare i dati REALI, così quando il primo sync
// arriva il promemoria sparisce. React cache() = una sola query per request
// anche se layout e pagina lo chiamano entrambi.
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { isSupabaseConfigured } from "@/lib/workspace";

export const hasSyncedData = cache(async (): Promise<boolean> => {
  // Fuori dal cloud il pairing non riguarda il web: nessun promemoria.
  if (!isCloudDeploy() || !isSupabaseConfigured) return true;
  const supabase = await createClient();
  // Head-count con RLS: conta solo le posizioni dell'utente di sessione.
  const { count, error } = await supabase
    .from("positions")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  if (error) return true; // nel dubbio niente promemoria/redirect
  return (count ?? 0) > 0;
});
