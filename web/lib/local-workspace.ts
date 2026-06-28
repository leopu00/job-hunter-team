import { isLocalRequest } from "@/lib/auth";
import { getWorkspacePath, workspaceHasDb } from "@/lib/workspace";

/**
 * Path del workspace SQLite SE la richiesta è locale (host localhost: Mac/JHT
 * Desktop o container) e il DB esiste; altrimenti `null` → il chiamante usa
 * Supabase.
 *
 * Stessa identica logica dell'helper privato `ws()` di `queries.ts`, estratta
 * qui per essere riusata dalle API route (es. le route "activity" del team) che
 * oggi parlano solo con Supabase e in local-only mostrerebbero vuoto. Direction
 * shift "interaction planes" — gap WEB-READONLY: la VISTA deve leggere dal DB
 * locale senza login cloud.
 */
export async function localWorkspace(): Promise<string | null> {
  if (!(await isLocalRequest())) return null;
  const p = await getWorkspacePath();
  if (!p || !workspaceHasDb(p)) return null;
  return p;
}
