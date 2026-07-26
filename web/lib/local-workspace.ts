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

/**
 * Lettura dal DB locale quando c'è, `null` quando il chiamante deve
 * proseguire su Supabase.
 *
 * Le route "activity" del team ripetevano tutte lo stesso preambolo:
 * `localWorkspace()`, e se c'è un workspace leggi dentro un try/catch che
 * NON rilancia — un jobs.db con schema parziale deve far scendere al ramo
 * cloud, non restituire 500. Quel try/catch è la parte che si dimentica:
 * qui il contratto è garantito una volta per tutte.
 *
 * Il ramo cloud resta interamente del chiamante: le route non lo trattano
 * allo stesso modo (le "activity" degradano a un payload vuoto, `critico`
 * risponde con un errore esplicito) e quella differenza è voluta.
 */
export async function readLocalOr<T>(
  tag: string,
  read: (workspace: string) => T,
): Promise<T | null> {
  const ws = await localWorkspace();
  if (!ws) return null;
  try {
    return read(ws);
  } catch (err) {
    console.error(`[${tag}] local`, err);
    return null;
  }
}
